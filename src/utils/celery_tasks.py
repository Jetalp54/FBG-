"""
Enterprise Campaign Sending Engine
===================================
All 3 modes are Celery-backed for true 1M-scale sending.

TURBO   → Max concurrency, no rate limit. All batches dispatched immediately.
THROTTLE → Celery ETA-based scheduling (ms-precision). No batch fires before its ms-slot.
SCHEDULED → Store in Redis, APScheduler fires at exact time, then runs as TURBO/THROTTLE.
"""
import os
import json
import time
import logging
import threading
import asyncio
from .celery_app import celery_app
import firebase_admin
from firebase_admin import credentials, auth
import pyrebase
import redis
from urllib.parse import urlparse

# ------------------------------------------------------------------ #
# Logging                                                              #
# ------------------------------------------------------------------ #
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
logger.info("✅ Celery Tasks Module Loaded (Version 3.0 - Enterprise Multi-Mode)")

# ------------------------------------------------------------------ #
# Redis                                                                #
# ------------------------------------------------------------------ #
REDIS_URL = os.getenv('REDIS_URL', 'redis://localhost:6379/0')
redis_client = redis.Redis.from_url(celery_app.conf.broker_url)

# ------------------------------------------------------------------ #
# Rate Limiter Import                                                  #
# ------------------------------------------------------------------ #
from .rate_limiter import RedisRateLimiter

# ------------------------------------------------------------------ #
# Firebase App Cache (per-worker-process)                             #
# ------------------------------------------------------------------ #
firebase_apps = {}
pyrebase_apps = {}
projects_cache = {}

import uuid

# Path to projects file
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PROJECTS_FILE = os.path.join(BASE_DIR, 'projects.json')


# ------------------------------------------------------------------ #
# Project / Firebase Helpers                                           #
# ------------------------------------------------------------------ #
def get_project_credentials(project_id):
    """Retrieve project credentials from cache or file"""
    global projects_cache

    if not projects_cache or project_id not in projects_cache:
        try:
            if os.path.exists(PROJECTS_FILE):
                with open(PROJECTS_FILE, 'r') as f:
                    projects = json.load(f)

                projects_cache = {}
                dirty = False

                for p in projects:
                    if 'id' not in p:
                        if 'service_account' in p and 'project_id' in p['service_account']:
                            p['id'] = str(p['service_account']['project_id'])
                            dirty = True
                        elif 'project_id' in p:
                            p['id'] = str(p['project_id'])
                            dirty = True
                        else:
                            p['id'] = str(uuid.uuid4())
                            dirty = True
                            logger.warning(f"Generated temp ID for malformed project: {p.get('name', 'unknown')}")

                    projects_cache[str(p['id'])] = p

                if dirty:
                    try:
                        with open(PROJECTS_FILE, 'w') as f_out:
                            json.dump(projects, f_out, indent=2)
                        logger.info("✅ Auto-repaired projects.json with missing IDs")
                    except Exception as e:
                        logger.error(f"Failed to save repaired projects.json: {e}")
            else:
                logger.error(f"projects.json not found at {PROJECTS_FILE}")
        except Exception as e:
            logger.error(f"Failed to load projects file: {e}")
            return None

    return projects_cache.get(str(project_id))


def initialize_firebase_for_project(project_id):
    """Initialize Firebase Admin + Pyrebase for a project (cached per worker)"""
    project_id = str(project_id)
    if project_id in firebase_apps:
        return firebase_apps[project_id], pyrebase_apps.get(project_id)

    project = get_project_credentials(project_id)
    if not project:
        logger.error(f"Project {project_id} not found in configuration")
        return None, None

    try:
        service_account = project.get('serviceAccount') or project.get('service_account')
        api_key = project.get('apiKey') or project.get('api_key')

        if not service_account:
            logger.error(f"Missing service account for project {project_id}")
            return None, None

        # Firebase Admin SDK
        cred = credentials.Certificate(service_account)
        app_name = f"worker_{project_id}_{os.getpid()}"

        try:
            app = firebase_admin.get_app(app_name)
        except ValueError:
            app = firebase_admin.initialize_app(cred, name=app_name)

        firebase_apps[project_id] = app

        # Pyrebase (Client SDK) for sending password reset emails
        sa_project_id = service_account.get('project_id')
        config = {
            "apiKey": api_key,
            "authDomain": f"{sa_project_id}.firebaseapp.com",
            "databaseURL": f"https://{sa_project_id}.firebaseio.com",
            "storageBucket": f"{sa_project_id}.appspot.com",
            "serviceAccount": service_account
        }
        pyrebase_app = pyrebase.initialize_app(config)
        pyrebase_apps[project_id] = pyrebase_app

        logger.info(f"✅ Initialized Firebase for project {project_id}")
        return app, pyrebase_app

    except Exception as e:
        logger.error(f"Failed to initialize Firebase for project {project_id}: {e}")
        return None, None


# ------------------------------------------------------------------ #
# Redis Stats Helpers                                                  #
# ------------------------------------------------------------------ #
def _record_result(campaign_id, project_id, success: bool, error_msg=None):
    """Atomically update Redis stats for a campaign"""
    stats_key = f"campaign:{campaign_id}:{project_id}:stats"
    pipe = redis_client.pipeline()
    pipe.hincrby(stats_key, "processed", 1)
    if success:
        pipe.hincrby(stats_key, "successful", 1)
    else:
        pipe.hincrby(stats_key, "failed", 1)
    pipe.expire(stats_key, 86400)  # 24h TTL
    pipe.execute()

    if error_msg:
        errors_key = f"campaign:{campaign_id}:errors"
        redis_client.lpush(errors_key, json.dumps({'project': project_id, 'error': error_msg[:200]}))
        redis_client.ltrim(errors_key, 0, 9999)


def _batch_resolve_emails(project_id, admin_app, user_ids):
    """
    Resolve up to 100 UIDs → emails using Firebase batch API.
    Falls back to individual lookups on error.
    Returns dict {uid: email}
    """
    uid_email = {}
    # Firebase allows max 100 per batch
    chunks = [user_ids[i:i+100] for i in range(0, len(user_ids), 100)]
    for chunk in chunks:
        try:
            identifiers = [auth.UidIdentifier(uid) for uid in chunk]
            result = auth.get_users(identifiers, app=admin_app)
            for user in result.users:
                if user.email:
                    uid_email[user.uid] = user.email
        except Exception as e:
            logger.error(f"[{project_id}] Batch user lookup error: {e} – falling back to individual")
            for uid in chunk:
                try:
                    u = auth.get_user(uid, app=admin_app)
                    if u.email:
                        uid_email[u.uid] = u.email
                except Exception:
                    pass
    return uid_email


# ==================================================================
# CELERY TASK: process_campaign_batch
# Handles all modes: turbo (no delay), throttled (ms sleep between emails)
# ==================================================================
@celery_app.task(bind=True, max_retries=3, default_retry_delay=5)
def process_campaign_batch(self, campaign_id, project_id, user_ids,
                           rate_limit=None,
                           mode='turbo',
                           emails_per_second=None,
                           delay_ms_between_emails=0):
    """
    Enterprise batch email sender.

    Args:
        campaign_id     : Campaign UUID
        project_id      : Firebase project ID
        user_ids        : List of Firebase UIDs to process in this batch
        rate_limit      : Global Redis rate limit (emails/sec) – legacy turbo param
        mode            : 'turbo' | 'throttled'
        emails_per_second: For throttled mode (overrides rate_limit)
        delay_ms_between_emails: Fixed ms gap between sends in throttled mode
    """
    admin_app, client_app = initialize_firebase_for_project(project_id)
    if not client_app:
        logger.error(f"[{project_id}] Firebase init failed – marking {len(user_ids)} users as failed")
        for _ in user_ids:
            _record_result(campaign_id, project_id, False, "Firebase init failed")
        return {'success': 0, 'failed': len(user_ids), 'error': 'Firebase init failed'}

    auth_client = client_app.auth()

    # ---------------------------------------------------------------
    # 1. Resolve UIDs → Emails (batch API, 100 at a time)
    # ---------------------------------------------------------------
    uid_email_map = _batch_resolve_emails(project_id, admin_app, user_ids)
    logger.info(f"[{project_id}] Resolved {len(uid_email_map)}/{len(user_ids)} emails")

    # ---------------------------------------------------------------
    # 2. Rate Limiter (for throttled mode via Redis)
    # ---------------------------------------------------------------
    limiter = None
    effective_rate = emails_per_second or rate_limit
    if mode == 'throttled' and effective_rate and float(effective_rate) > 0:
        limit_key = f"campaign:{campaign_id}:global_limit"
        limiter = RedisRateLimiter(
            redis_client, limit_key,
            rate_per_second=float(effective_rate),
            burst_capacity=max(int(float(effective_rate) * 2), 10)
        )

    # ---------------------------------------------------------------
    # 3. Send Emails
    # ---------------------------------------------------------------
    successful = 0
    failed = 0

    for uid in user_ids:
        email = uid_email_map.get(uid)

        if not email:
            failed += 1
            _record_result(campaign_id, project_id, False, f"Email not found for UID {uid}")
            continue

        # Throttle: wait for rate limiter token
        if limiter:
            allowed, wait_time = limiter.acquire()
            if not allowed and wait_time > 0:
                time.sleep(min(wait_time, 30))  # cap sleep at 30s

        # Fixed ms-based delay (alternative to rate limiter)
        if delay_ms_between_emails > 0 and not limiter:
            time.sleep(delay_ms_between_emails / 1000.0)

        try:
            auth_client.send_password_reset_email(email)
            successful += 1
            _record_result(campaign_id, project_id, True)
        except Exception as e:
            err_str = str(e)
            failed += 1
            _record_result(campaign_id, project_id, False, err_str)
            logger.debug(f"[{project_id}] Send failed for {email}: {err_str[:100]}")

    logger.info(f"[{project_id}][{campaign_id}] Batch done: {successful} sent, {failed} failed")
    return {'project_id': project_id, 'successful': successful, 'failed': failed}


# ==================================================================
# CELERY TASK: execute_scheduled_campaign
# Triggered at the exact scheduled time by APScheduler / Celery Beat
# ==================================================================
@celery_app.task(bind=True, max_retries=0)
def execute_scheduled_campaign(self, campaign_id):
    """
    Called by APScheduler at the exact scheduled time.
    Reads campaign data from Redis and dispatches batches.
    """
    import json

    key = f"scheduled_campaign:{campaign_id}"
    raw = redis_client.get(key)
    if not raw:
        logger.error(f"[SCHEDULED] Campaign {campaign_id} data not found in Redis")
        return

    data = json.loads(raw)
    execution_mode = data.get('execution_mode', 'turbo')
    projects_list = data.get('projects', [])
    throttle_config = data.get('throttle_config') or {}
    batch_size = data.get('batch_size', 100)

    emails_per_second = None
    delay_ms = 0

    if execution_mode == 'throttled':
        # Convert ms-based config to per-second for the rate limiter
        emails_per_ms = throttle_config.get('emails_per_ms') or throttle_config.get('emailsPerMs', 0)
        delay_ms = throttle_config.get('delay_ms') or throttle_config.get('delayMs', 0)
        if emails_per_ms:
            emails_per_second = float(emails_per_ms) * 1000.0  # ms → per-second

    logger.info(f"[SCHEDULED] Executing campaign {campaign_id} in {execution_mode.upper()} mode")

    total_queued = 0
    for proj in projects_list:
        p_id = str(proj.get('projectId', ''))
        u_ids = proj.get('userIds', [])
        if not u_ids:
            continue

        batches = [u_ids[i:i + batch_size] for i in range(0, len(u_ids), batch_size)]
        for batch in batches:
            process_campaign_batch.delay(
                campaign_id, p_id, batch,
                mode=execution_mode,
                emails_per_second=emails_per_second,
                delay_ms_between_emails=delay_ms
            )
            total_queued += len(batch)

    logger.info(f"[SCHEDULED] Campaign {campaign_id}: queued {total_queued} sends")
    redis_client.delete(key)  # Clean up scheduled data after dispatch


# ------------------------------------------------------------------ #
# Database Helper (optional – no-op if DB not configured)            #
# ------------------------------------------------------------------ #
import psycopg2

def get_db_connection():
    try:
        db_url = os.getenv('DB_URL')
        if not db_url:
            return None
        result = urlparse(db_url)
        return psycopg2.connect(
            database=result.path[1:],
            user=result.username,
            password=result.password,
            host=result.hostname,
            port=result.port
        )
    except Exception as e:
        logger.error(f"DB Connect Error: {e}")
        return None


def save_batch_logs(logs):
    if not logs:
        return
    conn = get_db_connection()
    if not conn:
        return
    try:
        cursor = conn.cursor()
        args_str = ','.join(cursor.mogrify("(%s,%s,%s,%s,%s,%s)", (
            x['campaign_id'], x['project_id'], x['user_id'],
            x['email'], x['status'], x['error']
        )).decode('utf-8') for x in logs)
        cursor.execute(
            "INSERT INTO campaign_logs (campaign_id, project_id, user_id, email, status, error_message) VALUES " + args_str
        )
        conn.commit()
    except Exception as e:
        logger.error(f"Batch Insert Error: {e}")
    finally:
        if conn:
            conn.close()
