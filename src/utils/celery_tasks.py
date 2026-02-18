import os
import json
import time
import logging
import threading
from .celery_app import celery_app
import firebase_admin
from firebase_admin import credentials, auth
import pyrebase
import redis
import asyncio

# Configure Logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Redis Connection for Progress Tracking
redis_client = redis.Redis.from_url(celery_app.conf.broker_url)

# Rate Limiter Import
from .rate_limiter import RedisRateLimiter

# Global Cache for Initialized Apps in this Worker Process
firebase_apps = {}
pyrebase_apps = {}
projects_cache = {}

# Load Projects (File Based for now, DB later)
# Use absolute path relative to this file's directory to ensure worker finds it
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PROJECTS_FILE = os.path.join(BASE_DIR, 'projects.json')

def get_project_credentials(project_id):
    """Retrieve project credentials from cache or file"""
    global projects_cache
    
    # Refresh cache if empty or project missing
    if not projects_cache or project_id not in projects_cache:
        try:
            if os.path.exists(PROJECTS_FILE):
                with open(PROJECTS_FILE, 'r') as f:
                    projects = json.load(f)
                    # Robust loading: skip entries without ID
                    projects_cache = {}
                    for p in projects:
                        if 'id' in p:
                            projects_cache[str(p['id'])] = p
                        else:
                            logger.warning(f"Skipping malformed project entry in projects.json: {str(p)[:50]}...")
            else:
                logger.error(f"projects.json not found at {PROJECTS_FILE}")
        except Exception as e:
            logger.error(f"Failed to load projects file: {e}")
            return None
            
    return projects_cache.get(str(project_id))

def initialize_firebase_for_project(project_id):
    """Initialize Firebase App for specific project if not already done"""
    project_id = str(project_id)
    if project_id in firebase_apps:
        return firebase_apps[project_id], pyrebase_apps.get(project_id)

    project = get_project_credentials(project_id)
    if not project:
        logger.error(f"Project {project_id} not found in configuration")
        return None, None

    try:
        # 1. Initialize Firebase Admin SDK
        cred = credentials.Certificate(project['service_account'])
        app_name = f"worker_{project_id}_{os.getpid()}" # Unique name per worker process
        
        try:
            app = firebase_admin.get_app(app_name)
        except ValueError:
            app = firebase_admin.initialize_app(cred, name=app_name)
            
        firebase_apps[project_id] = app

        # 2. Initialize Pyrebase (Client SDK) for sending resets
        config = {
            "apiKey": project['api_key'],
            "authDomain": f"{project['service_account']['project_id']}.firebaseapp.com",
            "databaseURL": f"https://{project['service_account']['project_id']}.firebaseio.com",
            "storageBucket": f"{project['service_account']['project_id']}.appspot.com",
            "serviceAccount": project['service_account']
        }
        pyrebase_app = pyrebase.initialize_app(config)
        pyrebase_apps[project_id] = pyrebase_app
        
        return app, pyrebase_app
        
    except Exception as e:
        logger.error(f"Failed to initialize Firebase for project {project_id}: {e}")
        return None, None

@celery_app.task(bind=True, max_retries=3)
def process_campaign_batch(self, campaign_id, project_id, user_ids, rate_limit=None):
    """
    Celery Task: Process a batch of UIDs for a campaign.
    1. Resolves UIDs to Emails.
    2. Sends Password Reset Emails (Rate Limited).
    3. Updates Progress in Redis.
    """
    admin_app, client_app = initialize_firebase_for_project(project_id)
    if not client_app:
        logger.error(f"Skipping batch for {project_id}: Initialization failed")
        # Update failed count in Redis
        redis_client.hincrby(f"campaign:{campaign_id}:stats", "failed", len(user_ids))
        return {'success': 0, 'failed': len(user_ids), 'error': 'Init Failed'}

    auth_client = client_app.auth()
    
    # Initialize Global Rate Limiter if configured
    limiter = None
    if rate_limit and int(rate_limit) > 0:
        limit_key = f"campaign:{campaign_id}:global_limit"
        limiter = RedisRateLimiter(redis_client, limit_key, int(rate_limit))
    
    # 1. Resolve Emails (Batch Lookup)
    uid_email_map = {}
    try:
        # Use firebase_admin auth to get users
        identifiers = [auth.UidIdentifier(uid) for uid in user_ids]
        result = auth.get_users(identifiers, app=admin_app)
        for user in result.users:
            if user.email:
                uid_email_map[user.uid] = user.email
    except Exception as e:
        logger.error(f"Batch lookup failed for {project_id}: {e}")
        # Fallback: individual lookup? Or just fail?
        # For Enterprise scale, batch failure is critical.
        # We'll treat missing emails as failed.

    successful = 0
    failed = 0
    
    stats_key = f"campaign:{campaign_id}:{project_id}:stats"
    errors_key = f"campaign:{campaign_id}:errors"

    # 2. Iterate and Send
    logs_to_insert = []
    
    for uid in user_ids:
        # Rate Limiting Check
        if limiter:
            allowed, wait_time = limiter.acquire()
            if not allowed and wait_time > 0:
                time.sleep(wait_time)

        email = uid_email_map.get(uid)
        
        # Prepare Log Entry Template
        log_entry = {
            'campaign_id': str(campaign_id),
            'project_id': str(project_id),
            'user_id': str(uid),
            'email': email,
            'status': 'failed',
            'error': None
        }
        
        if not email:
            failed += 1
            log_entry['error'] = "Email not found for UID"
            logs_to_insert.append(log_entry)
            
            redis_client.hincrby(stats_key, "failed", 1)
            redis_client.hincrby(stats_key, "processed", 1)
            redis_client.hincrby(f"campaign:{campaign_id}:stats", "failed", 1)
            continue

        try:
            auth_client.send_password_reset_email(email)
            successful += 1
            log_entry['status'] = 'sent'
            logs_to_insert.append(log_entry)
            
            redis_client.hincrby(stats_key, "successful", 1)
            redis_client.hincrby(stats_key, "processed", 1)
            redis_client.hincrby(f"campaign:{campaign_id}:stats", "successful", 1)
        except Exception as e:
            failed += 1
            log_entry['error'] = str(e)[:200]
            logs_to_insert.append(log_entry)
            
            redis_client.hincrby(stats_key, "failed", 1)
            redis_client.hincrby(stats_key, "processed", 1)
            redis_client.hincrby(f"campaign:{campaign_id}:stats", "failed", 1)
            
            # Legacy error list for quick debug (optional, can be disabled if DB is reliable)
            error_data = json.dumps({'email': email, 'uid': uid, 'error': str(e)[0:200], 'project': project_id})
            redis_client.lpush(errors_key, error_data)
            redis_client.ltrim(errors_key, 0, 999) 
            
    # 3. Bulk Insert into Database
    try:
        save_batch_logs(logs_to_insert)
    except Exception as e:
        logger.error(f"DB Log Insertion Failed: {e}")
        # We don't fail the task because emails were sent/failed, just logging failed.

    return {'project_id': project_id, 'successful': successful, 'failed': failed} 

# Database Helper
import psycopg2
from urllib.parse import urlparse

def get_db_connection():
    try:
        db_url = os.getenv('DB_URL')
        if not db_url: return None
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
    if not logs: return
    conn = get_db_connection()
    if not conn: return
    
    try:
        cursor = conn.cursor()
        # Efficient Bulk Insert
        args_str = ','.join(cursor.mogrify("(%s,%s,%s,%s,%s,%s)", (
            x['campaign_id'], x['project_id'], x['user_id'], x['email'], x['status'], x['error']
        )).decode('utf-8') for x in logs)
        
        cursor.execute("INSERT INTO campaign_logs (campaign_id, project_id, user_id, email, status, error_message) VALUES " + args_str)
        conn.commit()
    except Exception as e:
        logger.error(f"Batch Insert Error: {e}")
    finally:
        if conn: conn.close()
