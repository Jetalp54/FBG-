"""
Enterprise Campaign Sending Engine v4.0
========================================
TRUE enterprise-grade: ThreadPoolExecutor for Turbo, ETA-dispatch for Throttle,
Redis-based pause/stop/resume controls.

TURBO    → ThreadPoolExecutor(20 threads) per batch. All 100 emails fire in parallel.
           No delays, no rate limiting, maximum Firebase throughput.
THROTTLE → Every email dispatched as a micro-task with Celery ETA (countdown).
           No blocking sleep inside any task. True ms-precision.
CONTROL  → Before/during each send, check Redis key campaign:{id}:control.
           Values: none=run, "pause"=wait, "stop"=abort immediately.
"""
import os
import json
import time
import logging
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta

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
logger.info("✅ Celery Tasks Module Loaded (Version 4.0 - Thread-Parallel + Control Signals)")

# ------------------------------------------------------------------ #
# Redis                                                                #
# ------------------------------------------------------------------ #
REDIS_URL = os.getenv('REDIS_URL', 'redis://localhost:6379/0')
redis_client = redis.Redis.from_url(REDIS_URL, decode_responses=True)

# ------------------------------------------------------------------ #
# Firebase App Cache (per-worker-process)                              #
# ------------------------------------------------------------------ #
firebase_apps = {}
pyrebase_apps = {}
projects_cache = {}
cache_lock = threading.Lock()

import uuid
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PROJECTS_FILE = os.path.join(BASE_DIR, 'projects.json')

# Turbo: max threads per Celery task (I/O bound → greedy is fine)
TURBO_THREADS = int(os.getenv('TURBO_THREADS', '20'))
# Batch size for UID→email resolution
RESOLVE_CHUNK = 100


# ------------------------------------------------------------------ #
# Campaign Control (pause / stop)                                      #
# ------------------------------------------------------------------ #
def _ctrl_key(campaign_id):
    return f"campaign:{campaign_id}:control"

def _stats_key(campaign_id, project_id):
    return f"campaign:{campaign_id}:{project_id}:stats"

def _should_stop(campaign_id):
    """Returns 'stop', 'pause', or None"""
    return redis_client.get(_ctrl_key(campaign_id))

def _wait_if_paused(campaign_id, poll_interval=0.5, max_wait=3600):
    """Block until resumed or stopped. Returns True if should continue, False if stopped."""
    waited = 0
    while True:
        signal = redis_client.get(_ctrl_key(campaign_id))
        if signal == 'stop':
            return False
        if signal != 'pause':
            return True
        time.sleep(poll_interval)
        waited += poll_interval
        if waited >= max_wait:
            logger.warning(f"[{campaign_id}] Paused >1hr, stopping")
            return False

def set_campaign_control(campaign_id, signal):
    """Set control signal. signal: 'pause' | 'stop' | None (resume)"""
    key = _ctrl_key(campaign_id)
    if signal is None:
        redis_client.delete(key)
    else:
        redis_client.set(key, signal, ex=86400)  # 24h TTL


# ------------------------------------------------------------------ #
# Redis Stats (pipeline)                                               #
# ------------------------------------------------------------------ #
def _record_results_bulk(campaign_id, project_id, n_success, n_fail):
    """Bulk-update stats for N successes + M failures in one pipeline call."""
    if n_success == 0 and n_fail == 0:
        return
    key = _stats_key(campaign_id, project_id)
    pipe = redis_client.pipeline()
    pipe.hincrby(key, "processed", n_success + n_fail)
    if n_success:
        pipe.hincrby(key, "successful", n_success)
    if n_fail:
        pipe.hincrby(key, "failed", n_fail)
    pipe.expire(key, 86400)
    pipe.execute()

def _record_error(campaign_id, project_id, error_msg):
    key = f"campaign:{campaign_id}:errors"
    redis_client.lpush(key, json.dumps({'project': project_id, 'error': str(error_msg)[:200]}))
    redis_client.ltrim(key, 0, 9999)
    redis_client.expire(key, 86400)


# ------------------------------------------------------------------ #
# Project / Firebase Helpers                                           #
# ------------------------------------------------------------------ #
def get_project_credentials(project_id):
    global projects_cache
    project_id = str(project_id)
    with cache_lock:
        if project_id in projects_cache:
            return projects_cache[project_id]

    try:
        if os.path.exists(PROJECTS_FILE):
            with open(PROJECTS_FILE, 'r') as f:
                projects = json.load(f)
            with cache_lock:
                for p in projects:
                    pid = (
                        p.get('id') or
                        (p.get('service_account') or {}).get('project_id') or
                        p.get('project_id') or
                        str(uuid.uuid4())
                    )
                    p.setdefault('id', str(pid))
                    projects_cache[str(p['id'])] = p
    except Exception as e:
        logger.error(f"Failed to load projects file: {e}")

    return projects_cache.get(project_id)


def initialize_firebase_for_project(project_id):
    project_id = str(project_id)
    with cache_lock:
        if project_id in firebase_apps:
            return firebase_apps[project_id], pyrebase_apps.get(project_id)

    project = get_project_credentials(project_id)
    if not project:
        return None, None

    try:
        service_account = project.get('serviceAccount') or project.get('service_account')
        api_key = project.get('apiKey') or project.get('api_key')
        if not service_account:
            logger.error(f"Missing service account for project {project_id}")
            return None, None

        cred = credentials.Certificate(service_account)
        app_name = f"worker_{project_id}_{os.getpid()}"
        try:
            app = firebase_admin.get_app(app_name)
        except ValueError:
            app = firebase_admin.initialize_app(cred, name=app_name)

        sa_pid = service_account.get('project_id')
        pyrebase_config = {
            "apiKey": api_key,
            "authDomain": f"{sa_pid}.firebaseapp.com",
            "databaseURL": f"https://{sa_pid}.firebaseio.com",
            "storageBucket": f"{sa_pid}.appspot.com",
            "serviceAccount": service_account
        }
        pb_app = pyrebase.initialize_app(pyrebase_config)

        with cache_lock:
            firebase_apps[project_id] = app
            pyrebase_apps[project_id] = pb_app

        logger.info(f"✅ Initialized Firebase for project {project_id}")
        return app, pb_app

    except Exception as e:
        logger.error(f"Failed to initialize Firebase for {project_id}: {e}")
        return None, None


# ------------------------------------------------------------------ #
# UID → Email Batch Resolution                                         #
# ------------------------------------------------------------------ #
def _batch_resolve_emails(project_id, admin_app, user_ids):
    uid_email = {}
    chunks = [user_ids[i:i+RESOLVE_CHUNK] for i in range(0, len(user_ids), RESOLVE_CHUNK)]
    for chunk in chunks:
        try:
            identifiers = [auth.UidIdentifier(uid) for uid in chunk]
            result = auth.get_users(identifiers, app=admin_app)
            for user in result.users:
                if user.email:
                    uid_email[user.uid] = user.email
        except Exception as e:
            logger.error(f"[{project_id}] Batch lookup error: {e} – individual fallback")
            for uid in chunk:
                try:
                    u = auth.get_user(uid, app=admin_app)
                    if u.email:
                        uid_email[u.uid] = u.email
                except Exception:
                    pass
    return uid_email


# ==================================================================
# CELERY TASK: send_single_email
# Used by Throttle mode — each email dispatched with its own ETA.
# No blocking sleep anywhere, true ms-precision scheduling.
# ==================================================================
@celery_app.task(bind=True, max_retries=2, default_retry_delay=3)
def send_single_email(self, campaign_id, project_id, uid, email):
    """
    Send exactly one password-reset email.
    Scheduled in the future by process_campaign_batch (throttle mode).
    Checks for stop/pause signals before sending.
    """
    # Control check
    signal = _should_stop(campaign_id)
    if signal == 'stop':
        logger.info(f"[{campaign_id}] Stopped before sending {email}")
        return {'skipped': True}
    if signal == 'pause':
        if not _wait_if_paused(campaign_id):
            return {'skipped': True}

    admin_app, client_app = initialize_firebase_for_project(project_id)
    if not client_app:
        _record_results_bulk(campaign_id, project_id, 0, 1)
        _record_error(campaign_id, project_id, f"Firebase init failed for {uid}")
        return {'success': False}

    auth_client = client_app.auth()
    try:
        auth_client.send_password_reset_email(email)
        _record_results_bulk(campaign_id, project_id, 1, 0)
        return {'success': True, 'email': email}
    except Exception as e:
        _record_results_bulk(campaign_id, project_id, 0, 1)
        _record_error(campaign_id, project_id, str(e))
        return {'success': False, 'error': str(e)[:200]}


# ==================================================================
# CELERY TASK: process_campaign_batch
# TURBO: ThreadPoolExecutor — all emails in parallel, no delay.
# THROTTLE: Dispatch each email as send_single_email with countdown.
# ==================================================================
@celery_app.task(bind=True, max_retries=2, default_retry_delay=5)
def process_campaign_batch(self, campaign_id, project_id, user_ids,
                           rate_limit=None,
                           mode='turbo',
                           emails_per_second=None,
                           delay_ms_between_emails=0):
    """
    Enterprise batch dispatcher.

    TURBO   : Thread-parallel sends. All emails fired concurrently via ThreadPoolExecutor.
    THROTTLE: Each email scheduled as an individual Celery task at the correct ETA.
              No time.sleep() anywhere. True ms-precision, non-blocking.
    """
    # ── Check stop/pause before doing any work ────────────────────────────────
    signal = _should_stop(campaign_id)
    if signal == 'stop':
        logger.info(f"[{campaign_id}] Batch skipped — stop signal")
        return {'skipped': True}
    if signal == 'pause':
        if not _wait_if_paused(campaign_id):
            return {'skipped': True}

    # ── Initialize Firebase ───────────────────────────────────────────────────
    admin_app, client_app = initialize_firebase_for_project(project_id)
    if not client_app:
        n = len(user_ids)
        _record_results_bulk(campaign_id, project_id, 0, n)
        return {'success': 0, 'failed': n, 'error': 'Firebase init failed'}

    # ── Batch-resolve UIDs → emails ───────────────────────────────────────────
    uid_email_map = _batch_resolve_emails(project_id, admin_app, user_ids)
    logger.info(f"[{project_id}] Resolved {len(uid_email_map)}/{len(user_ids)} emails → mode={mode}")

    # Mark users with no email as failed immediately
    no_email = [uid for uid in user_ids if uid not in uid_email_map]
    if no_email:
        _record_results_bulk(campaign_id, project_id, 0, len(no_email))

    emails = [(uid, email) for uid, email in uid_email_map.items()]

    # ==================================================================
    # TURBO MODE — ThreadPoolExecutor, all in parallel
    # ==================================================================
    if mode == 'turbo':
        auth_client = client_app.auth()

        def _send_one(uid_email_tuple):
            uid, email = uid_email_tuple
            # Check control before each send
            sig = redis_client.get(_ctrl_key(campaign_id))
            if sig == 'stop':
                return (False, 'stopped')
            if sig == 'pause':
                if not _wait_if_paused(campaign_id):
                    return (False, 'stopped')
            try:
                auth_client.send_password_reset_email(email)
                return (True, None)
            except Exception as e:
                return (False, str(e)[:200])

        successful = 0
        failed = 0

        # Use ThreadPoolExecutor for true parallel I/O
        with ThreadPoolExecutor(max_workers=TURBO_THREADS) as executor:
            futures = {executor.submit(_send_one, pair): pair for pair in emails}
            batch_ok = 0
            batch_fail = 0

            for future in as_completed(futures):
                ok, err = future.result()
                if ok:
                    batch_ok += 1
                else:
                    batch_fail += 1
                    if err and err not in ('stopped',):
                        _record_error(campaign_id, project_id, err)

                # Flush stats every 50 completions
                if (batch_ok + batch_fail) % 50 == 0:
                    _record_results_bulk(campaign_id, project_id, batch_ok, batch_fail)
                    successful += batch_ok
                    failed += batch_fail
                    batch_ok = 0
                    batch_fail = 0

            # Flush remainder
            if batch_ok or batch_fail:
                _record_results_bulk(campaign_id, project_id, batch_ok, batch_fail)
                successful += batch_ok
                failed += batch_fail

        logger.info(f"[{project_id}][TURBO] Batch done: {successful} sent, {failed} failed")
        return {'project_id': project_id, 'successful': successful, 'failed': failed}

    # ==================================================================
    # THROTTLE MODE — ETA-based dispatch, zero blocking
    # Each email is a separate Celery task scheduled in the future.
    # ==================================================================
    elif mode == 'throttled':
        delay_ms = delay_ms_between_emails
        if delay_ms <= 0 and emails_per_second and float(emails_per_second) > 0:
            delay_ms = 1000.0 / float(emails_per_second)
        if delay_ms <= 0:
            delay_ms = 10  # fallback: 100/sec

        delay_s = delay_ms / 1000.0  # convert to seconds for Celery countdown

        now = datetime.utcnow()
        queued = 0

        for i, (uid, email) in enumerate(emails):
            # ETA = now + i * delay_s
            eta = now + timedelta(seconds=i * delay_s)
            send_single_email.apply_async(
                args=[campaign_id, project_id, uid, email],
                eta=eta
            )
            queued += 1

        logger.info(
            f"[{project_id}][THROTTLE] Queued {queued} emails "
            f"@ {1000/delay_ms:.1f}/sec (delay={delay_ms}ms). "
            f"ETA for last: {(len(emails)-1)*delay_s:.1f}s from now."
        )
        return {'project_id': project_id, 'queued': queued, 'delay_ms': delay_ms}

    else:
        logger.error(f"Unknown mode '{mode}'")
        return {'error': f"Unknown mode: {mode}"}


# ==================================================================
# CELERY TASK: execute_scheduled_campaign
# Triggered at the exact scheduled time by APScheduler / Celery Beat
# ==================================================================
@celery_app.task(bind=True, max_retries=0)
def execute_scheduled_campaign(self, campaign_id):
    key = f"scheduled_campaign:{campaign_id}"
    raw = redis_client.get(key)
    if not raw:
        logger.error(f"[SCHEDULED] Campaign {campaign_id} data not found in Redis")
        return

    data = json.loads(raw)
    execution_mode = data.get('execution_mode', 'turbo')
    projects_list = data.get('projects', [])
    throttle_config = data.get('throttle_config') or {}
    batch_size = int(data.get('batch_size', 100))

    delay_ms = 0
    emails_per_second = None

    if execution_mode == 'throttled':
        delay_ms = float(throttle_config.get('delay_ms') or throttle_config.get('delayMs', 10))
        if delay_ms > 0:
            emails_per_second = 1000.0 / delay_ms

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
    redis_client.delete(key)


# ------------------------------------------------------------------ #
# Database Helper (optional – no-op if DB not configured)            #
# ------------------------------------------------------------------ #
try:
    import psycopg2
    _psycopg2_available = True
except ImportError:
    _psycopg2_available = False

def get_db_connection():
    if not _psycopg2_available:
        return None
    try:
        db_url = os.getenv('DB_URL')
        if not db_url:
            return None
        result = urlparse(db_url)
        return psycopg2.connect(
            database=result.path[1:], user=result.username,
            password=result.password, host=result.hostname, port=result.port
        )
    except Exception as e:
        logger.error(f"DB Connect Error: {e}")
        return None
