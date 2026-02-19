"""
Enhanced FastAPI Backend Service for Firebase Operations with Multi-Project Parallelism
Run this with: python src/utils/firebaseBackend.py
"""

from fastapi import FastAPI, HTTPException, BackgroundTasks, Request, Body, WebSocket, WebSocketDisconnect, Depends, Path, Query, File, UploadFile, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict, Any, Optional, Set
import firebase_admin
from firebase_admin import credentials, auth
import pyrebase
import hashlib
import json
import os
import shutil
import asyncio
import time
# FIX: Add project root to sys.path to allow 'src.utils' imports
import sys
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if BASE_DIR not in sys.path:
    sys.path.append(BASE_DIR)

from datetime import datetime, date, timedelta, timezone
import logging
import concurrent.futures
import threading
from collections import defaultdict
import uuid
import random
from concurrent.futures import ThreadPoolExecutor, ProcessPoolExecutor
import math
import requests
from google.oauth2 import service_account
from google.auth.transport.requests import AuthorizedSession

# CRITICAL FIX: Load environment variables
try:
    from dotenv import load_dotenv
    load_dotenv()  # Load .env file
    print("✅ Environment variables loaded successfully")
except ImportError:
    print("⚠️ python-dotenv not available, using system environment variables")

# Database imports and connection
import psycopg2
import redis
import re
from psycopg2.extras import RealDictCursor
from urllib.parse import urlparse

# Database connection pool
import threading
# Database connection pool
import threading
db_connection_lock = threading.Lock()

# Global Concurrency Semaphore to prevent system overload
# Even with Buffered I/O, we must limit total active network requests across all projects.
GLOBAL_CONCURRENCY_LIMIT = 500
global_semaphore = threading.Semaphore(GLOBAL_CONCURRENCY_LIMIT)

def get_db_connection():
    """Get database connection with proper error handling"""
    try:
        db_url = os.getenv('DB_URL')
        if not db_url:
            raise Exception("Database URL not configured")
        
        parsed = urlparse(db_url)
        conn = psycopg2.connect(
            host=parsed.hostname,
            port=parsed.port or 5432,
            database=parsed.path[1:],
            user=parsed.username,
            password=parsed.password,
            cursor_factory=RealDictCursor
        )
        return conn
    except Exception as e:
        logger.error(f"Database connection failed: {e}")
        raise

def init_database():
    """Initialize database tables and admin user"""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Create tables with proper permissions
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS app_users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(100) UNIQUE NOT NULL,
                email VARCHAR(255) UNIQUE,
                password_hash VARCHAR(255) NOT NULL,
                role VARCHAR(50) DEFAULT 'user',
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS user_permissions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES app_users(id) ON DELETE CASCADE,
                permission_name VARCHAR(100) NOT NULL,
                is_granted BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, permission_name)
            )
        ''')
        
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS profiles (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                description TEXT,
                owner_id INTEGER REFERENCES app_users(id) ON DELETE CASCADE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS projects (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                admin_email VARCHAR(255) NOT NULL,
                service_account JSONB NOT NULL,
                api_key VARCHAR(500) NOT NULL,
                profile_id INTEGER REFERENCES profiles(id) ON DELETE SET NULL,
                owner_id INTEGER REFERENCES app_users(id) ON DELETE CASCADE,
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS campaigns (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
                batch_size INTEGER DEFAULT 100,
                workers INTEGER DEFAULT 5,
                template TEXT,
                status VARCHAR(50) DEFAULT 'draft',
                owner_id INTEGER REFERENCES app_users(id) ON DELETE CASCADE,
                processed INTEGER DEFAULT 0,
                successful INTEGER DEFAULT 0,
                failed INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')

        cursor.execute('''
            CREATE TABLE IF NOT EXISTS campaign_logs (
                id SERIAL PRIMARY KEY,
                campaign_id VARCHAR(100) NOT NULL,
                project_id VARCHAR(100) NOT NULL,
                user_id VARCHAR(255),
                email VARCHAR(255),
                status VARCHAR(20), -- 'sent', 'failed'
                error_message TEXT,
                attempted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_campaign_logs_campaign_id ON campaign_logs(campaign_id);
            CREATE INDEX IF NOT EXISTS idx_campaign_logs_project_id ON campaign_logs(project_id);
        ''')
        
        # Migration: Add progress columns and configuration columns if they don't exist
        try:
            # Progress Columns
            cursor.execute("""
                ALTER TABLE campaigns 
                ADD COLUMN IF NOT EXISTS processed INTEGER DEFAULT 0,
                ADD COLUMN IF NOT EXISTS successful INTEGER DEFAULT 0,
                ADD COLUMN IF NOT EXISTS failed INTEGER DEFAULT 0
            """)
            
            # Configuration Columns (Crucial for Persistence)
            cursor.execute("""
                ALTER TABLE campaigns
                ADD COLUMN IF NOT EXISTS sending_mode VARCHAR(50) DEFAULT 'turbo',
                ADD COLUMN IF NOT EXISTS project_ids JSONB DEFAULT '[]',
                ADD COLUMN IF NOT EXISTS turbo_config JSONB DEFAULT '{}',
                ADD COLUMN IF NOT EXISTS throttle_config JSONB DEFAULT '{}',
                ADD COLUMN IF NOT EXISTS schedule_config JSONB DEFAULT '{}',
                ADD COLUMN IF NOT EXISTS target_user_count INTEGER DEFAULT 0,
                ADD COLUMN IF NOT EXISTS campaign_uuid VARCHAR(100)
            """)
            
            # Backfill UUIDs for existing rows if needed (using ID as fallback)
            cursor.execute("UPDATE campaigns SET campaign_uuid = CAST(id AS VARCHAR) WHERE campaign_uuid IS NULL")
            conn.commit()
        except Exception as e:
            logger.info(f"Schema migration note: {e}")
        
        # Create admin user if doesn't exist
        cursor.execute("SELECT id FROM app_users WHERE username = 'admin'")
        if not cursor.fetchone():
            cursor.execute('''
                INSERT INTO app_users (username, email, password_hash, role, is_active)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING id
            ''', ('admin', 'admin@firebase-manager.com', 
                  'admin', 
                  'admin', True))
            
            admin_id = cursor.fetchone()['id']
            
            # Add admin permissions
            permissions = ['projects', 'users', 'campaigns', 'templates', 'ai', 'test', 
                          'profiles', 'auditLogs', 'settings', 'smtp']
            
            for perm in permissions:
                cursor.execute('''
                    INSERT INTO user_permissions (user_id, permission_name, is_granted)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (user_id, permission_name) DO NOTHING
                ''', (admin_id, perm, True))
            
            logger.info("Admin user created successfully")
        
        conn.commit()
        cursor.close()
        conn.close()
        logger.info("Database initialized successfully")
        
    except Exception as e:
        logger.error(f"Database initialization failed: {e}")
        raise

# Google Cloud imports for project deletion
try:
    from google.cloud import resourcemanager
    GOOGLE_CLOUD_AVAILABLE = True
except ImportError:
    GOOGLE_CLOUD_AVAILABLE = False
from fastapi.security import HTTPBasic, HTTPBasicCredentials
import secrets
from fastapi.responses import JSONResponse
from fastapi import Response

# Advanced scheduling support
try:
    from apscheduler.schedulers.asyncio import AsyncIOScheduler
    from apscheduler.triggers.date import DateTrigger
    SCHEDULER_AVAILABLE = True
    logger_temp = logging.getLogger(__name__)
    logger_temp.info("✅ APScheduler imported successfully")
except ImportError:
    SCHEDULER_AVAILABLE = False
    logger_temp = logging.getLogger(__name__)
    logger_temp.warning("⚠️ APScheduler not available - scheduled campaigns disabled")

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Log environment configuration
logger.info(f"Environment: {os.getenv('ENVIRONMENT', 'development')}")
logger.info(f"Database URL configured: {'DB_URL' in os.environ}")
logger.info(f"Use Database: {os.getenv('USE_DATABASE', 'false')}")

# Log Google Cloud availability
if not GOOGLE_CLOUD_AVAILABLE:
    logger.warning("Google Cloud libraries not available. Project deletion from Google Cloud will not work.")

# ============================================================================
# ENTERPRISE RATE LIMITER - Token Bucket Algorithm (Millisecond-based)
# ============================================================================
class TokenBucketRateLimiter:
    """
    Token bucket algorithm for precise rate limiting.
    Configured in milliseconds for maximum control over email sending rates.
    
    Example: 10 emails per 1000ms (1 second) = 10 emails/second
             1 email per 100ms = 10 emails/second
             50 emails per 5000ms = 10 emails/second
    """
    def __init__(self, rate_per_ms: float, burst_capacity: int = None):
        """
        Initialize rate limiter with millisecond-based rate.
        
        Args:
            rate_per_ms: Emails allowed per millisecond (e.g., 0.01 = 10 emails/second)
            burst_capacity: Maximum burst size (default: rate * 1000 for 1-second burst)
        """
        self.rate_per_ms = rate_per_ms
        self.burst_capacity = burst_capacity or max(int(rate_per_ms * 1000), 1)
        self.tokens = float(self.burst_capacity)
        self.last_update = time.time() * 1000  # Convert to milliseconds
        self.lock = threading.Lock()
        
        logger.info(f"🎯 Rate Limiter initialized: {rate_per_ms} emails/ms, burst: {self.burst_capacity}")
    
    async def acquire(self, tokens: int = 1) -> float:
        """
        Acquire tokens from the bucket. Blocks until tokens are available.
        Returns the wait time in seconds.
        """
        with self.lock:
            current_time_ms = time.time() * 1000
            time_passed_ms = current_time_ms - self.last_update
            
            # Refill tokens based on time passed
            self.tokens = min(
                self.burst_capacity,
                self.tokens + (time_passed_ms * self.rate_per_ms)
            )
            self.last_update = current_time_ms
            
            # Calculate wait time if not enough tokens
            if self.tokens < tokens:
                needed_tokens = tokens - self.tokens
                wait_time_ms = needed_tokens / self.rate_per_ms
                wait_time_sec = wait_time_ms / 1000.0
                
                # Wait for tokens to refill
                await asyncio.sleep(wait_time_sec)
                
                # Update tokens after waiting
                self.tokens = 0
                self.last_update = time.time() * 1000
                
                return wait_time_sec
            else:
                # Consume tokens immediately
                self.tokens -= tokens
                return 0.0
    
    def reset(self):
        """Reset the rate limiter to full capacity"""
        with self.lock:
            self.tokens = float(self.burst_capacity)
            self.last_update = time.time() * 1000

# Global campaign scheduler
campaign_scheduler = None
scheduled_campaigns = {}  # Track scheduled campaigns

def get_scheduler():
    """Get or create the campaign scheduler"""
    global campaign_scheduler
    if campaign_scheduler is None and SCHEDULER_AVAILABLE:
        campaign_scheduler = AsyncIOScheduler()
        campaign_scheduler.start()
        logger.info("✅ Campaign scheduler started")
    return campaign_scheduler

app = FastAPI(title="Firebase Email Campaign Backend", version="2.0.0")

# Configure request size limits for large HTML templates
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    max_age=3600,
)

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# Standardize paths for Enterprise (Absolute Paths)
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Global storage
firebase_apps = {}
pyrebase_apps = {}
active_campaigns = {}
campaign_stats = {}
daily_counts = {}
campaign_results = {}  # New: Store detailed campaign results
campaign_errors = {}   # New: Store detailed error logs

# ABSOLUTE PATHS for Data Persistence
PROJECTS_FILE = os.path.join(BASE_DIR, 'projects.json')
CAMPAIGNS_FILE = os.path.join(BASE_DIR, 'campaigns.json')
DAILY_COUNTS_FILE = os.path.join(BASE_DIR, 'daily_counts.json')
CAMPAIGN_RESULTS_FILE = os.path.join(BASE_DIR, 'campaign_results.json')
AUDIT_LOG_FILE = os.path.join(BASE_DIR, 'audit.log')
AI_KEYS_FILE = os.path.join(BASE_DIR, 'ai_keys.json')
AI_NEGATIVE_PROMPT_FILE = os.path.join(BASE_DIR, 'ai_negative_prompt.txt')
PROFILES_FILE = os.path.join(BASE_DIR, 'profiles.json')
ROLE_PERMISSIONS_FILE = os.path.join(BASE_DIR, 'role_permissions.json')
SMTP_SETTINGS_FILE = os.path.join(BASE_DIR, 'smtp_settings.json')
PASSWORD_RESET_TOKENS_FILE = os.path.join(BASE_DIR, 'password_reset_tokens.json')

# Log critical persistence paths on startup
logger.info(f"📂 BASE_DIR: {BASE_DIR}")
logger.info(f"💾 CAMPAIGNS_FILE: {CAMPAIGNS_FILE}")
APP_USERS_FILE = os.path.join(BASE_DIR, 'app_users.json')
DATA_LISTS_FILE = os.path.join(BASE_DIR, 'data_lists.json')
PROJECTS_JSON_PATH = PROJECTS_FILE # Alias just in case

projects = {}
ai_keys = {}
data_lists = {}


# Admin service account for Google Cloud operations
ADMIN_SERVICE_ACCOUNT_FILE = 'admin_service_account.json'
admin_credentials = None

# WebSocket manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: set[WebSocket] = set()

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.add(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.discard(websocket)

    async def broadcast(self, message: dict):
        for connection in list(self.active_connections):
            try:
                await connection.send_json(message)
            except Exception:
                self.disconnect(connection)

ws_manager = ConnectionManager()

# Basic admin security for privileged endpoints (local-only)
security = HTTPBasic()

def verify_basic_admin(credentials: HTTPBasicCredentials = Depends(security)) -> None:
    correct_username = secrets.compare_digest(credentials.username, "admin")
    correct_password = secrets.compare_digest(credentials.password, "admin")
    if not (correct_username and correct_password):
        raise HTTPException(status_code=401, detail="Unauthorized")

# App users store (for login and team management)
def _hash_password(password: str) -> str:
    return hashlib.sha256(password.encode('utf-8')).hexdigest()

# Define available features
DEFAULT_FEATURES = ['projects','users','campaigns','templates','ai','test','profiles','auditLogs','settings','smtp']

def compute_effective_permissions(username: str) -> Dict[str, bool]:
    """Compute effective permissions for a user based on role and overrides"""
    users = load_app_users()
    user = next((u for u in users.get('users', []) if u.get('username') == username), None)
    if not user:
        return { feature: False for feature in DEFAULT_FEATURES }
    
    role = user.get('role', 'user')
    # Admin: full access; others: deny-by-default so only overrides apply
    if role == 'admin':
        base = { feature: True for feature in DEFAULT_FEATURES }
    else:
        base = { feature: False for feature in DEFAULT_FEATURES }
    
    overrides = user.get('overrides', {}) or {}
    effective = { **{ feature: False for feature in DEFAULT_FEATURES }, **base }
    for k, v in overrides.items():
        if k in DEFAULT_FEATURES:
            effective[k] = bool(v)
    return effective

def load_app_users() -> Dict[str, Dict[str, str]]:
    # Structure: { "users": [{"username":"admin","password_hash":"...","role":"admin"}, ...] }
    if not os.path.exists(APP_USERS_FILE):
        # Initialize with default admin matching current local setup
        default = {
            "users": [
                {"username": "admin", "password_hash": _hash_password("Batata010..++"), "role": "admin"}
            ]
        }
        with open(APP_USERS_FILE, 'w', encoding='utf-8') as f:
            json.dump(default, f, indent=2)
        return default
    try:
        with open(APP_USERS_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {"users": []}

def save_app_users(data: Dict[str, Any]) -> None:
    try:
        with open(APP_USERS_FILE, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2)
    except Exception as e:
        logger.error(f"Failed to save app users: {e}")

# Role permissions management
DEFAULT_FEATURES = [
    'projects','users','campaigns','templates','ai','test','profiles','auditLogs','settings','smtp'
]

def load_role_permissions() -> Dict[str, Dict[str, bool]]:
    if not os.path.exists(ROLE_PERMISSIONS_FILE):
        default = {
            'admin': { feature: True for feature in DEFAULT_FEATURES },
            'it': { feature: False for feature in DEFAULT_FEATURES },
            'user': { feature: False for feature in DEFAULT_FEATURES }
        }
        with open(ROLE_PERMISSIONS_FILE, 'w', encoding='utf-8') as f:
            json.dump(default, f, indent=2)
        return default
    try:
        with open(ROLE_PERMISSIONS_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {}

def save_role_permissions(perms: Dict[str, Dict[str, bool]]) -> None:
    with open(ROLE_PERMISSIONS_FILE, 'w', encoding='utf-8') as f:
        json.dump(perms, f, indent=2)

def compute_effective_permissions(username: str) -> Dict[str, bool]:
    users = load_app_users()
    roles = load_role_permissions()
    user = next((u for u in users.get('users', []) if u.get('username') == username), None)
    if not user:
        return { feature: False for feature in DEFAULT_FEATURES }
    role = user.get('role', 'user')
    # Admin: full access; others: deny-by-default so only overrides apply
    if role == 'admin':
        base = { feature: True for feature in DEFAULT_FEATURES }
    else:
        base = { feature: False for feature in DEFAULT_FEATURES }
    overrides = user.get('overrides', {}) or {}
    effective = { **{ feature: False for feature in DEFAULT_FEATURES }, **base }
    for k, v in overrides.items():
        effective[k] = bool(v)
    return effective

# SMTP settings and password reset tokens
def load_smtp_settings() -> Dict[str, Any]:
    if not os.path.exists(SMTP_SETTINGS_FILE):
        default = {"host": "","port": 587,"username": "","password": "","from": "","use_tls": True}
        with open(SMTP_SETTINGS_FILE, 'w', encoding='utf-8') as f:
            json.dump(default, f, indent=2)
        return default
    with open(SMTP_SETTINGS_FILE, 'r', encoding='utf-8') as f:
        return json.load(f)

def save_smtp_settings(data: Dict[str, Any]) -> None:
    with open(SMTP_SETTINGS_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2)

def load_reset_tokens() -> Dict[str, Any]:
    if not os.path.exists(PASSWORD_RESET_TOKENS_FILE):
        with open(PASSWORD_RESET_TOKENS_FILE, 'w', encoding='utf-8') as f:
            json.dump({}, f)
        return {}
    with open(PASSWORD_RESET_TOKENS_FILE, 'r', encoding='utf-8') as f:
        return json.load(f)

def save_reset_tokens(data: Dict[str, Any]) -> None:
    with open(PASSWORD_RESET_TOKENS_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2)

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await ws_manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()  # Keep connection alive
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)

# Helper to broadcast events
async def notify_ws(event: str, data: dict):
    await ws_manager.broadcast({"event": event, "data": data})

def write_audit_log(user, action, details):
    entry = {
        'timestamp': datetime.utcnow().isoformat() + 'Z',
        'user': user or 'unknown',
        'action': action,
        'details': details
    }
    try:
        with open(AUDIT_LOG_FILE, 'a') as f:
            f.write(json.dumps(entry) + '\n')
    except Exception as e:
        print(f"Failed to write audit log: {e}")

# --- App User Management Endpoints ---

class AppUserCreate(BaseModel):
    username: str
    password: str
    role: str = "member"  # admin|member
    overrides: Optional[Dict[str, bool]] = None

class AppUserUpdate(BaseModel):
    password: Optional[str] = None
    role: Optional[str] = None
    overrides: Optional[Dict[str, bool]] = None

@app.post("/auth/login")
def auth_login(body: Dict[str, str] = Body(...)):
    username = (body.get('username') or '').strip()
    password = body.get('password') or ''
    
    if not username or not password:
        raise HTTPException(status_code=401, detail="Username and password required")
    
    try:
        # Check if using database
        if os.getenv('USE_DATABASE', 'false').lower() == 'true':
            # Use database for authentication
            conn = get_db_connection()
            cursor = conn.cursor()
            
            cursor.execute("""
                SELECT u.username, u.password_hash, u.role, u.id 
                FROM app_users u 
                WHERE u.username = %s AND u.is_active = TRUE
            """, (username,))
            
            user_data = cursor.fetchone()
            
            if not user_data:
                cursor.close()
                conn.close()
                raise HTTPException(status_code=401, detail="Invalid credentials")
            
            # Check password (plain text as per existing DB logic)
            if user_data['password_hash'] != password:
                cursor.close()
                conn.close()
                raise HTTPException(status_code=401, detail="Invalid credentials")
            
            # Get permissions from database
            cursor.execute("""
                SELECT permission_name 
                FROM user_permissions 
                WHERE user_id = %s AND is_granted = TRUE
            """, (user_data['id'],))
            
            permissions = [row['permission_name'] for row in cursor.fetchall()]
            
            cursor.close()
            conn.close()
            
            logger.info(f"User {username} authenticated successfully with {len(permissions)} permissions (DB)")
            return {
                "success": True, 
                "username": username, 
                "role": user_data['role'], 
                "permissions": permissions
            }
        else:
            # File-based authentication
            data = load_app_users()
            user = next((u for u in data.get('users', []) if u.get('username') == username), None)
            
            if not user:
                raise HTTPException(status_code=401, detail="Invalid credentials")
            
            # Check password (hashed for file-based)
            if user.get('password_hash') != _hash_password(password):
                raise HTTPException(status_code=401, detail="Invalid credentials")
            
            # Compute permissions
            permissions_dict = compute_effective_permissions(username)
            permissions = [k for k, v in permissions_dict.items() if v]
            
            logger.info(f"User {username} authenticated successfully (File)")
            return {
                "success": True, 
                "username": username, 
                "role": user.get('role', 'user'), 
                "permissions": permissions
            }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Authentication error for {username}: {e}")
        raise HTTPException(status_code=500, detail="Authentication service error")

@app.get("/app-users")
def list_app_users(_: None = Depends(verify_basic_admin)):
    data = load_app_users()
    # Do not return password hashes
    return {"users": [{"username": u.get('username'), "role": u.get('role', 'member'), "overrides": u.get('overrides', {}), "email": u.get('email', '')} for u in data.get('users', [])]}

@app.post("/app-users")
def create_app_user(user: dict, _: None = Depends(verify_basic_admin)):
    data = load_app_users()
    if any(u.get('username') == user.get('username') for u in data.get('users', [])):
        raise HTTPException(status_code=400, detail="Username already exists")
    # Always initialize overrides field to prevent missing permissions
    clean_overrides = {}
    user_overrides = user.get('overrides', {}) or {}
    if user_overrides:
        # Only accept known features
        for k, v in user_overrides.items():
            if k in DEFAULT_FEATURES:
                clean_overrides[k] = bool(v)
    
    entry = {
        "username": user.get('username'), 
        "password_hash": _hash_password(user.get('password', '')), 
        "role": user.get('role', 'user'),
        "overrides": clean_overrides,
        "email": user.get('email', '')  # Add email field
    }
    data['users'].append(entry)
    save_app_users(data)
    return {"success": True}

@app.put("/app-users/{username}")
def update_app_user(username: str, update: dict, _: None = Depends(verify_basic_admin)):
    data = load_app_users()
    found = False
    for u in data.get('users', []):
        if u.get('username') == username:
            if update.get('password') is not None:
                u['password_hash'] = _hash_password(update.get('password'))
            if update.get('role') is not None:
                u['role'] = update.get('role')
            if update.get('overrides') is not None and isinstance(update.get('overrides'), dict):
                # Merge overrides instead of replacing completely, only accept known features
                existing_overrides = u.get('overrides', {}) or {}
                for k, v in update.get('overrides', {}).items():
                    if k in DEFAULT_FEATURES:
                        existing_overrides[k] = bool(v)
                u['overrides'] = existing_overrides
            # Update email if provided
            if update.get('email') is not None:
                u['email'] = update.get('email', '')
            # Ensure overrides field exists for all users
            if 'overrides' not in u:
                u['overrides'] = {}
            # Ensure email field exists
            if 'email' not in u:
                u['email'] = ''
            found = True
            break
    if not found:
        raise HTTPException(status_code=404, detail="User not found")
    save_app_users(data)
    # Broadcast permission update to connected clients
    try:
        asyncio.create_task(ws_manager.broadcast({"event": "permissions_updated", "data": {"username": username}}))
    except Exception:
        pass
    return {"success": True}

# Role permissions endpoints
@app.get("/role-permissions")
def get_role_permissions(_: None = Depends(verify_basic_admin)):
    return load_role_permissions()

@app.get("/auth/test-db")
def test_database_connection():
    """Test database connection and show admin user info"""
    try:
        import psycopg2
        import os
        
        db_url = os.getenv('DB_URL')
        if not db_url:
            return {"status": "error", "message": "No database URL configured"}
        
        from urllib.parse import urlparse
        parsed = urlparse(db_url)
        
        conn = psycopg2.connect(
            host=parsed.hostname,
            port=parsed.port or 5432,
            database=parsed.path[1:],
            user=parsed.username,
            password=parsed.password
        )
        
        cursor = conn.cursor()
        
        # Check if admin user exists
        cursor.execute("SELECT username, role, is_active FROM app_users WHERE username = 'admin'")
        admin_user = cursor.fetchone()
        
        # Count total users
        cursor.execute("SELECT COUNT(*) FROM app_users")
        total_users = cursor.fetchone()[0]
        
        # Count permissions
        cursor.execute("SELECT COUNT(*) FROM user_permissions")
        total_permissions = cursor.fetchone()[0]
        
        cursor.close()
        conn.close()
        
        return {
            "status": "success",
            "database": "connected",
            "admin_user": {
                "exists": admin_user is not None,
                "username": admin_user[0] if admin_user else None,
                "role": admin_user[1] if admin_user else None,
                "active": admin_user[2] if admin_user else None
            },
            "total_users": total_users,
            "total_permissions": total_permissions
        }
        
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.put("/role-permissions")
def put_role_permissions(perms: Dict[str, Dict[str, bool]], _: None = Depends(verify_basic_admin)):
    # Basic validation
    for role, feats in perms.items():
        for k, v in feats.items():
            if k not in DEFAULT_FEATURES:
                raise HTTPException(status_code=400, detail=f"Unknown feature: {k}")
            feats[k] = bool(v)
    save_role_permissions(perms)
    try:
        asyncio.create_task(ws_manager.broadcast({"event": "roles_updated", "data": {}}))
    except Exception:
        pass
    return {"success": True}

# SMTP settings endpoints
@app.get("/settings/smtp")
def get_smtp_settings(_: None = Depends(verify_basic_admin)):
    return load_smtp_settings()

@app.put("/settings/smtp")
def put_smtp_settings(data: Dict[str, Any], _: None = Depends(verify_basic_admin)):
    save_smtp_settings(data)
    return {"success": True}

@app.get("/auth/effective")
def get_effective_permissions(username: str = Query(..., description="Username to get permissions for")):
    """Return effective role and permissions for a given username."""
    users = load_app_users()
    user = next((u for u in users.get('users', []) if u.get('username') == username), None)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    perms = compute_effective_permissions(username)
    return {"username": username, "role": user.get('role', 'user'), "permissions": perms}

@app.delete("/app-users/{username}")
def delete_app_user(username: str, _: None = Depends(verify_basic_admin)):
    data = load_app_users()
    before = len(data.get('users', []))
    data['users'] = [u for u in data.get('users', []) if u.get('username') != username]
    if len(data['users']) == before:
        raise HTTPException(status_code=404, detail="User not found")
    save_app_users(data)
    return {"success": True}

@app.post("/app-users/migrate")
def migrate_app_users(_: None = Depends(verify_basic_admin)):
    """Ensure all users have an overrides field"""
    data = load_app_users()
    migrated = 0
    for u in data.get('users', []):
        if 'overrides' not in u:
            u['overrides'] = {}
            migrated += 1
    if migrated > 0:
        save_app_users(data)
    return {"success": True, "migrated": migrated}

@app.post("/auth/forgot-password")
def forgot_password(request: dict):
    """Send password reset email via SMTP"""
    username_or_email = request.get('username', '').strip()
    if not username_or_email:
        raise HTTPException(status_code=400, detail="Username or email is required")
    
    # Check if user exists by username OR email
    users = load_app_users()
    user = None
    
    # First try to find by username
    user = next((u for u in users.get('users', []) if u.get('username') == username_or_email), None)
    
    # If not found by username, try by email
    if not user:
        user = next((u for u in users.get('users', []) if u.get('email') == username_or_email), None)
    
    if not user:
        # Don't reveal if user exists or not for security
        return {"success": True, "message": "If the username or email exists, a reset email has been sent."}
    
    # Generate reset token (simple implementation)
    import secrets
    reset_token = secrets.token_urlsafe(32)
    
    # Store reset token with expiration (24 hours)
    from datetime import datetime, timedelta
    expiry = (datetime.now() + timedelta(hours=24)).isoformat()
    
    # Save reset token to user record
    user['reset_token'] = reset_token
    user['reset_token_expiry'] = expiry
    save_app_users(users)
    
    # Send email via SMTP
    try:
        smtp_settings = load_smtp_settings()
        if not smtp_settings.get('host'):
            raise HTTPException(status_code=500, detail="SMTP not configured")
        
        import smtplib
        from email.mime.text import MIMEText
        from email.mime.multipart import MIMEMultipart
        
        # Create reset URL (assuming frontend runs on same host)
        reset_url = f"http://localhost:8080/reset-password?token={reset_token}&username={user.get('username')}"
        
        # Create email
        msg = MIMEMultipart()
        msg['From'] = smtp_settings.get('from', smtp_settings.get('username'))
        
        # Use user's email if available, otherwise use the input (which might be email)
        recipient_email = user.get('email') or username_or_email
        msg['To'] = recipient_email
        msg['Subject'] = "Password Reset Request"
        
        body = f"""
        Hello {user.get('username')},
        
        You requested a password reset for your Firebase Manager account.
        
        Click the link below to reset your password:
        {reset_url}
        
        This link will expire in 24 hours.
        
        If you didn't request this reset, please ignore this email.
        
        Best regards,
        Firebase Manager Team
        """
        
        msg.attach(MIMEText(body, 'plain'))
        
        # Send email
        server = smtplib.SMTP(smtp_settings['host'], smtp_settings.get('port', 587))
        if smtp_settings.get('use_tls', True):
            server.starttls()
        if smtp_settings.get('username') and smtp_settings.get('password'):
            server.login(smtp_settings['username'], smtp_settings['password'])
        server.send_message(msg)
        server.quit()
        
        logger.info(f"Password reset email sent to {user.get('username')}")
        return {"success": True, "message": "Password reset email sent successfully."}
        
    except Exception as e:
        logger.error(f"Failed to send password reset email: {e}")
        raise HTTPException(status_code=500, detail="Failed to send password reset email")

@app.post("/auth/reset-password")
def reset_password(request: dict):
    """Reset password using token"""
    username = request.get('username', '').strip()
    token = request.get('token', '').strip()
    new_password = request.get('password', '').strip()
    
    if not all([username, token, new_password]):
        raise HTTPException(status_code=400, detail="Username, token, and new password are required")
    
    # Find user and validate token
    users = load_app_users()
    user = next((u for u in users.get('users', []) if u.get('username') == username), None)
    if not user:
        raise HTTPException(status_code=400, detail="Invalid reset token")
    
    if user.get('reset_token') != token:
        raise HTTPException(status_code=400, detail="Invalid reset token")
    
    # Check token expiry
    from datetime import datetime
    try:
        expiry = datetime.fromisoformat(user.get('reset_token_expiry', ''))
        if datetime.now() > expiry:
            raise HTTPException(status_code=400, detail="Reset token has expired")
    except:
        raise HTTPException(status_code=400, detail="Invalid reset token")
    
    # Reset password
    user['password_hash'] = _hash_password(new_password)
    # Clear reset token
    user.pop('reset_token', None)
    user.pop('reset_token_expiry', None)
    
    save_app_users(users)
    logger.info(f"Password reset successfully for user: {username}")
    
    return {"success": True, "message": "Password reset successfully"}

def save_projects_to_file():
    try:
        # Create list of projects with ID injected (Critical for Celery Worker)
        project_list = []
        for p_id, p_data in projects.items():
            p_copy = p_data.copy()
            if 'id' not in p_copy:
                 p_copy['id'] = p_id
            project_list.append(p_copy)
            
        with open(PROJECTS_FILE, 'w') as f:
            json.dump(project_list, f, indent=2)
    except Exception as e:
        logger.error(f"Error saving projects: {str(e)}")

def load_projects_from_file():
    global projects
    logger.info(f"load_projects_from_file called. Current projects count: {len(projects) if projects else 0}")
    
    if not os.path.exists(PROJECTS_FILE):
        logger.info("PROJECTS_FILE does not exist, setting projects to empty dict")
        projects = {}
        return []
    try:
        with open(PROJECTS_FILE, 'r') as f:
            loaded = json.load(f)
            logger.info(f"Loaded {len(loaded)} projects from file")
            
            # Only update global projects if it's empty (first load)
            if not projects:
                logger.info("Global projects is empty, initializing from file")
                projects = {}
                for project in loaded:
                    project_id = project['serviceAccount'].get('project_id')
                    if project_id:
                        projects[project_id] = project
                logger.info(f"Initialized global projects with {len(projects)} projects")
                
                # --- Auto-reinitialize all projects into firebase_apps AND pyrebase_apps on startup ---
                for project_id, project in projects.items():
                    try:
                        from firebase_admin import credentials, initialize_app
                        cred = credentials.Certificate(project['serviceAccount'])
                        firebase_app = initialize_app(cred, name=project_id)
                        firebase_apps[project_id] = firebase_app
                        logger.info(f"Auto-initialized project {project_id} into firebase_apps on startup.")
                        
                        # CRITICAL FIX: Also initialize Pyrebase for email sending
                        pyrebase_config = {
                            "apiKey": project.get('apiKey', ''),
                            "authDomain": f"{project_id}.firebaseapp.com",
                            "databaseURL": f"https://{project_id}.firebaseio.com",
                            "storageBucket": f"{project_id}.appspot.com"
                        }
                        pyrebase_app = pyrebase.initialize_app(pyrebase_config)
                        pyrebase_apps[project_id] = pyrebase_app
                        logger.info(f"Auto-initialized project {project_id} into pyrebase_apps on startup.")
                    except Exception as e:
                        logger.error(f"Failed to auto-initialize project {project_id} on startup: {e}")
            else:
                logger.info(f"Global projects already has {len(projects)} projects, skipping reinitialization")
        return loaded
    except Exception as e:
        logger.error(f"Error loading projects: {str(e)}")
        return []

def save_campaigns_to_file():
    try:
        # Create backup before overwrite
        if os.path.exists(CAMPAIGNS_FILE):
             try:
                 shutil.copy2(CAMPAIGNS_FILE, f"{CAMPAIGNS_FILE}.bak")
             except:
                 pass
        
        # Atomic write
        temp_file = f"{CAMPAIGNS_FILE}.tmp"
        with open(temp_file, 'w') as f:
            json.dump(list(active_campaigns.values()), f, indent=2)
        os.replace(temp_file, CAMPAIGNS_FILE)
        logger.info(f"✅ Saved campaigns to {CAMPAIGNS_FILE}")
    except Exception as e:
        logger.error(f"Error saving campaigns: {str(e)}")

def load_campaigns_from_file():
    target_file = CAMPAIGNS_FILE
    
    # Auto-Recovery Logic
    if not os.path.exists(target_file) or os.path.getsize(target_file) < 5:
        logger.warning(f"Main campaigns file missing or empty. Checking backup...")
        if os.path.exists(f"{CAMPAIGNS_FILE}.bak"):
             logger.info(f"✅ Recovering campaigns from backup: {CAMPAIGNS_FILE}.bak")
             shutil.copy2(f"{CAMPAIGNS_FILE}.bak", target_file)
        else:
             return # No backup, start fresh

    try:
        with open(target_file, 'r') as f:
            loaded = json.load(f)
            for campaign in loaded:
                active_campaigns[campaign['id']] = campaign
            logger.info(f"Loaded {len(active_campaigns)} campaigns from file.")
    except Exception as e:
        logger.error(f"Error loading campaigns: {str(e)}")
        # Try backup as last resort if JSON is corrupt
        try:
            if os.path.exists(f"{CAMPAIGNS_FILE}.bak"):
                 logger.warning("JSON Corrupt. Attempting backup restore...")
                 with open(f"{CAMPAIGNS_FILE}.bak", 'r') as f_bak:
                     loaded = json.load(f_bak)
                     for campaign in loaded:
                        active_campaigns[campaign['id']] = campaign
        except:
             pass

def save_daily_counts():
    try:
        with open(DAILY_COUNTS_FILE, 'w') as f:
            json.dump(daily_counts, f, indent=2)
    except Exception as e:
        logger.error(f"Error saving daily counts: {str(e)}")

def load_daily_counts():
    if not os.path.exists(DAILY_COUNTS_FILE):
        return
    try:
        with open(DAILY_COUNTS_FILE, 'r') as f:
            loaded = json.load(f)
            daily_counts.clear()
            daily_counts.update(loaded)
    except Exception as e:
        logger.error(f"Error loading daily counts: {str(e)}")

# Global lock for campaign results file
import threading
import time
import os
results_lock = threading.RLock()

# Buffered Saver Implementation
save_buffer_lock = threading.Lock()
last_save_time = 0
SAVE_INTERVAL = 5 # Seconds

def persist_campaign_results_to_disk(force=False):
    """Save campaign results to file with buffering"""
    global last_save_time
    
    # If not forced and not enough time passed, skip disk write
    if not force and (time.time() - last_save_time < SAVE_INTERVAL):
        return

    # Use RLock for thread safety during write
    with results_lock:
        try:
            # Create a temp file first to prevent corruption if write fails mid-way
            temp_file = f"{CAMPAIGN_RESULTS_FILE}.tmp"
            with open(temp_file, 'w') as f:
                json.dump(campaign_results, f, indent=2)
            
            # Atomic rename (replace)
            os.replace(temp_file, CAMPAIGN_RESULTS_FILE)
            last_save_time = time.time()
        except Exception as e:
            logger.error(f"Failed to save campaign results: {e}")

# Background Auto-Saver
def start_auto_saver():
    while True:
        time.sleep(SAVE_INTERVAL)
        persist_campaign_results_to_disk(force=True)

# Start auto-saver in a daemon thread
saver_thread = threading.Thread(target=start_auto_saver, daemon=True)
saver_thread.start()

def load_campaign_results_from_file():
    """Load campaign results from file with thread safety"""
    global campaign_results
    with results_lock:
        if not os.path.exists(CAMPAIGN_RESULTS_FILE):
            campaign_results = {}
            return

        try:
            with open(CAMPAIGN_RESULTS_FILE, 'r') as f:
                content = f.read().strip()
                if not content:
                    campaign_results = {}
                    return
                campaign_results = json.loads(content)
        except json.JSONDecodeError:
            logger.error(f"Corrupted campaign results file. Backing up and resetting.")
            try:
                os.rename(CAMPAIGN_RESULTS_FILE, f"{CAMPAIGN_RESULTS_FILE}.bak.{int(time.time())}")
            except:
                pass
            campaign_results = {}
        except Exception as e:
            logger.error(f"Failed to load campaign results: {e}")
            campaign_results = {}

# NEW: Redis Stats Sync for Enterprise Mode
def monitor_redis_progress():
    """Background thread to sync stats from Redis to local memory for UI updates"""
    try:
        import redis
        # Use localhost for now, user can config via env
        r = redis.Redis(host=os.getenv('REDIS_HOST', 'localhost'), port=int(os.getenv('REDIS_PORT', 6379)), db=0)
    except Exception as e:
        logger.warning(f"Redis not available for monitoring: {e}")
        return

    logger.info("✅ Started Redis Stats Monitor")
    
    while True:
        time.sleep(2) # Sync every 2 seconds
        try:
            # Iterate over active campaigns in memory
            # We use a copy of keys to avoid modification errors
            current_campaigns = list(campaign_results.keys())
            
            for c_id in current_campaigns:
                # Check if this campaign has Redis stats
                key = f"campaign:{c_id}:stats"
                if r.exists(key):
                    stats = r.hgetall(key)
                    if stats:
                        with results_lock:
                            if c_id not in campaign_results:
                                campaign_results[c_id] = {}
                            
                            # Merge Redis stats (Source of Truth for Turbo)
                            campaign_results[c_id]['successful'] = int(stats.get(b'successful', 0))
                            campaign_results[c_id]['failed'] = int(stats.get(b'failed', 0))
                            campaign_results[c_id]['processed'] = int(stats.get(b'processed', 0))
                            
                            # Calculate status
                            total = campaign_results[c_id].get('total', 0)
                            processed = campaign_results[c_id]['processed']
                            if total > 0 and processed >= total:
                                campaign_results[c_id]['status'] = 'completed'
                            else:
                                campaign_results[c_id]['status'] = 'running'

        except Exception as e:
            logger.error(f"Redis sync error: {e}")
            time.sleep(5)

# Start Monitor in Background
threading.Thread(target=monitor_redis_progress, daemon=True).start()

# NEW: Data Lists Storage Functions
def save_data_lists_to_file():
    try:
        with open(DATA_LISTS_FILE, 'w', encoding='utf-8') as f:
            json.dump(data_lists, f, indent=2, ensure_ascii=False)
        logger.info(f"Saved {len(data_lists)} data lists to file")
    except Exception as e:
        logger.error(f"Error saving data lists: {str(e)}")

def load_data_lists_from_file():
    global data_lists
    if not os.path.exists(DATA_LISTS_FILE):
        data_lists = {}
        return
    try:
        with open(DATA_LISTS_FILE, 'r', encoding='utf-8') as f:
            data_lists = json.load(f)
        logger.info(f"Loaded {len(data_lists)} data lists from file")
    except Exception as e:
        logger.error(f"Error loading data lists: {str(e)}")
        data_lists = {}

def load_admin_service_account():
    """Load admin service account credentials from file"""
    global admin_credentials
    try:
        if os.path.exists(ADMIN_SERVICE_ACCOUNT_FILE):
            with open(ADMIN_SERVICE_ACCOUNT_FILE, 'r') as f:
                admin_credentials = json.load(f)
            logger.info(f"Loaded admin service account from {ADMIN_SERVICE_ACCOUNT_FILE}")
            return True
    except Exception as e:
        logger.error(f"Failed to load admin service account: {e}")
    return False

def reset_daily_counts_at_midnight():
    def reset_loop():
        while True:
            now = datetime.now(timezone.utc).astimezone(timezone(timedelta(hours=1)))
            next_midnight = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
            sleep_seconds = (next_midnight - now).total_seconds()
            time.sleep(max(1, sleep_seconds))
            daily_counts.clear()
            save_daily_counts()
            logger.info("Daily counts reset at midnight GMT+1")
    t = threading.Thread(target=reset_loop, daemon=True)
    t.start()

# Module level initialization (only for non-database mode)
if os.getenv('USE_DATABASE') != 'true':
    # Call on startup for JSON file mode
    load_projects_from_file()
    load_campaigns_from_file()
    load_daily_counts()
    load_campaign_results_from_file()  # New: Load campaign results
    load_data_lists_from_file()  # NEW: Load data lists
    load_admin_service_account() # NEW: Load admin service account

# Always start the reset thread
reset_daily_counts_at_midnight()

# Data models
class ProjectCreate(BaseModel):
    name: str
    adminEmail: str
    serviceAccount: Dict[str, Any]
    apiKey: str

class UserImport(BaseModel):
    emails: List[str]
    projectIds: List[str]

class CampaignCreate(BaseModel):
    name: str
    projectIds: List[str]
    selectedUsers: Optional[Dict[str, List[str]]] = None
    batchSize: int = 50
    workers: int = 5
    template: Optional[str] = None
    # NEW: Enterprise sending modes
    sending_mode: str = "turbo"  # "turbo", "throttled", "scheduled"
    turbo_config: Optional[Dict[str, Any]] = None
    throttle_config: Optional[Dict[str, Any]] = None
    schedule_config: Optional[Dict[str, Any]] = None
    # NEW: Per-project sending controls
    sending_limit: Optional[int] = None
    sending_offset: Optional[int] = 0

class CampaignUpdate(BaseModel):
    name: Optional[str] = None
    batchSize: Optional[int] = None
    workers: Optional[int] = None
    template: Optional[str] = None
    sending_limit: Optional[int] = None
    sending_offset: Optional[int] = None
    sending_mode: Optional[str] = None
    turbo_config: Optional[Dict[str, Any]] = None
    throttle_config: Optional[Dict[str, Any]] = None
    schedule_config: Optional[Dict[str, Any]] = None

class DataListCreate(BaseModel):
    name: str
    isp: str
    geo: str
    status: str
    emails: List[str]

class DataListDistribute(BaseModel):
    projectIds: List[str]

class BulkUserDelete(BaseModel):
    projectIds: List[str]
    userIds: Optional[List[str]] = None  # If None, delete all users

# NEW: Data List Management Models
class DataListCreate(BaseModel):
    name: str
    isp: str  # gmail, outlook, yahoo, other
    geo: str  # US, UK, CA, etc.
    status: str  # fresh, open, click, unsub
    emails: List[str]

class DataListDistribute(BaseModel):
    projectIds: List[str]  # Projects to distribute to

# New: Enhanced campaign tracking models
class CampaignResult(BaseModel):
    campaign_id: str
    project_id: str
    total_users: int
    successful: int
    failed: int
    errors: List[Dict[str, Any]]
    start_time: str
    end_time: Optional[str] = None
    status: str  # 'running', 'completed', 'failed', 'partial'

class UserResult(BaseModel):
    user_id: str
    email: str
    status: str  # 'success', 'failed', 'pending'
    error_message: Optional[str] = None
    timestamp: str

# Daily count management
def increment_daily_count(project_id: str):
    """Increment daily count for a project"""
    today = date.today().isoformat()
    key = f"{project_id}_{today}"
    
    if key not in daily_counts:
        daily_counts[key] = {"project_id": project_id, "date": today, "sent": 0}
    
    daily_counts[key]["sent"] += 1
    save_daily_counts()

def get_daily_count(project_id: str) -> int:
    """Get daily count for a project"""
    today = date.today().isoformat()
    key = f"{project_id}_{today}"
    return daily_counts.get(key, {}).get("sent", 0)

@app.get("/")
async def root():
    """Root endpoint for basic connectivity test"""
    return {
        "message": "Firebase Manager Professional Backend",
        "status": "running",
        "timestamp": datetime.now().isoformat(),
        "version": "2.0.0",
        "environment": os.getenv('ENVIRONMENT', 'development')
    }

@app.get("/health")
async def health_check():
    """Health check endpoint to verify backend is running and database is connected"""
    try:
        # Check if we can load environment variables
        env_status = {
            "environment": os.getenv('ENVIRONMENT', 'development'),
            "use_database": os.getenv('USE_DATABASE', 'false'),
            "db_url_configured": 'DB_URL' in os.environ,
            "backend_port": os.getenv('BACKEND_PORT', '8000')
        }
        
        # Check database connection if configured
        db_status = {"connected": False, "error": None}
        if os.getenv('USE_DATABASE') == 'true' and os.getenv('DB_URL'):
            try:
                import psycopg2
                from urllib.parse import urlparse
                
                db_url = os.getenv('DB_URL')
                parsed = urlparse(db_url)
                
                conn = psycopg2.connect(
                    host=parsed.hostname,
                    port=parsed.port or 5432,
                    database=parsed.path[1:],
                    user=parsed.username,
                    password=parsed.password
                )
                
                cursor = conn.cursor()
                cursor.execute("SELECT 1")
                cursor.fetchone()
                cursor.close()
                conn.close()
                
                db_status = {"connected": True, "error": None}
            except Exception as e:
                db_status = {"connected": False, "error": str(e)}
        
        return {
            "status": "healthy",
            "timestamp": datetime.now().isoformat(),
            "environment": env_status,
            "database": db_status,
            "services": {
                "fastapi": "running",
                "postgresql": "connected" if db_status["connected"] else "disconnected"
            }
        }
    except Exception as e:
        return {
            "status": "unhealthy",
            "timestamp": datetime.now().isoformat(),
            "error": str(e)
        }

@app.post("/projects")
async def add_project(project: ProjectCreate, request: Request):
    try:
        logger.info(f"Adding project: {project.name}")
        project_id = project.serviceAccount.get('project_id')
        if not project_id:
            logger.error("Invalid service account - missing project_id")
            raise HTTPException(status_code=400, detail="Invalid service account - missing project_id")
        
        # Get profile ID from request body if provided
        profile_id = None
        try:
            body = await request.json()
            profile_id = body.get('profileId')
            logger.info(f"Profile ID from request: {profile_id}")
        except Exception as e:
            logger.warning(f"Could not parse request body for profileId: {e}")
            pass
        
        # Remove existing project if it exists
        if project_id in firebase_apps:
            try:
                firebase_admin.delete_app(firebase_apps[project_id])
            except Exception as e:
                logger.warning(f"Error removing old Firebase app: {e}")
            del firebase_apps[project_id]
        if project_id in pyrebase_apps:
            del pyrebase_apps[project_id]
        
        # Initialize Firebase Admin SDK
        try:
            cred = credentials.Certificate(project.serviceAccount)
            firebase_app = firebase_admin.initialize_app(cred, name=project_id)
            firebase_apps[project_id] = firebase_app
        except Exception as e:
            logger.error(f"Failed to initialize Firebase Admin SDK for {project_id}: {e}")
            raise HTTPException(status_code=400, detail=f"Failed to initialize Firebase Admin SDK: {e}")
        
        # Initialize Pyrebase
        try:
            # Check if this project already has a custom authDomain saved
            stored_project = projects.get(project_id, {})
            auth_domain = stored_project.get('authDomain', f"{project_id}.firebaseapp.com")
            
            pyrebase_config = {
                "apiKey": project.apiKey,
                "authDomain": auth_domain,
                "databaseURL": f"https://{project_id}-default-rtdb.firebaseio.com",
                "storageBucket": f"{project_id}.appspot.com",
            }
            pyrebase_app = pyrebase.initialize_app(pyrebase_config)
            pyrebase_apps[project_id] = pyrebase_app
        except Exception as e:
            logger.error(f"Failed to initialize Pyrebase for {project_id}: {e}")
            raise HTTPException(status_code=400, detail=f"Failed to initialize Pyrebase: {e}")
        
        # Get current user for ownership
        current_user = get_current_user_from_request(request)
        
        # Store project with profile association and ownership
        projects[project_id] = {
            'name': project.name,
            'adminEmail': project.adminEmail,
            'serviceAccount': project.serviceAccount,
            'apiKey': project.apiKey,
            'profileId': profile_id,
            'ownerId': current_user
        }
        save_projects_to_file()
        
        # Link project to profile if profile_id provided
        if profile_id:
            profiles = load_profiles_from_file()
            profile_found = False
            for profile in profiles:
                if profile['id'] == profile_id:
                    if project_id not in profile['projectIds']:
                        profile['projectIds'].append(project_id)
                    profile_found = True
                    break
            if profile_found:
                save_profiles_to_file(profiles)
                logger.info(f"Project {project_id} linked to profile {profile_id}")
            else:
                logger.warning(f"Profile {profile_id} not found when linking project {project_id}")
        
        logger.info(f"Project {project_id} added successfully")
        logger.info(f"Current projects in firebase_apps: {list(firebase_apps.keys())}")
        return {"success": True, "project_id": project_id, "profile_id": profile_id}
    except Exception as e:
        logger.error(f"Failed to add project: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to add project: {str(e)}")

@app.delete("/projects/{project_id}")
async def remove_project(project_id: str):
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")
    
    # Remove project from all profiles
    profiles = load_profiles_from_file()
    profiles_updated = False
    for profile in profiles:
        if project_id in profile['projectIds']:
            profile['projectIds'].remove(project_id)
            profiles_updated = True
    
    if profiles_updated:
        save_profiles_to_file(profiles)
        logger.info(f"Project {project_id} removed from all profiles")
    
    # Remove from Firebase apps
    if project_id in firebase_apps:
        try:
            firebase_admin.delete_app(firebase_apps[project_id])
        except Exception as e:
            logger.warning(f"Error removing Firebase app: {e}")
        del firebase_apps[project_id]
    
    if project_id in pyrebase_apps:
        del pyrebase_apps[project_id]
    
    del projects[project_id]
    save_projects_to_file()
    write_audit_log('admin', 'delete_project', {'project_id': project_id})
    asyncio.create_task(notify_ws('delete_project', {'project_id': project_id}))
    return {"success": True}

@app.delete("/projects/{project_id}/google-cloud")
async def delete_project_from_google_cloud(project_id: str):
    """
    Delete a Firebase project from Google Cloud.
    Tries to use Admin Service Account first, then falls back to project's own credentials.
    This will permanently delete the project from Google Cloud Console.
    """
    if not GOOGLE_CLOUD_AVAILABLE:
        raise HTTPException(
            status_code=500, 
            detail="Google Cloud libraries not available. Please install google-cloud-resource-manager"
        )
    
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")
    
    try:
        client = None
        creds_source = "unknown"

        # 1. Try Admin Service Account (Preferred)
        if admin_credentials:
            try:
                logger.info(f"Attempting to delete project {project_id} using Admin Service Account...")
                admin_creds = service_account.Credentials.from_service_account_info(admin_credentials)
                client = resourcemanager.ProjectsClient(credentials=admin_creds)
                creds_source = "admin_service_account"
            except Exception as e:
                logger.warning(f"Failed to create client with admin credentials: {e}")

        # 2. Fallback to Project Service Account
        if not client:
            project_data = projects[project_id]
            service_account_data = project_data.get('serviceAccount')
            
            if service_account_data:
                try:
                    logger.info(f"Attempting to delete project {project_id} using project credentials...")
                    project_creds = service_account.Credentials.from_service_account_info(service_account_data)
                    client = resourcemanager.ProjectsClient(credentials=project_creds)
                    creds_source = "project_service_account"
                except Exception as e:
                    logger.warning(f"Failed to create client with project credentials: {e}")
        
        if not client:
             raise HTTPException(
                status_code=500,
                detail="No valid credentials found to perform deletion. Please upload an Admin Service Account."
            )

        # Execute Deletion
        try:
            operation = client.delete_project(name=f"projects/{project_id}")
            result = operation.result()
            success_msg = f"Successfully deleted project {project_id} from Google Cloud using {creds_source}"
        except Exception as e:
            # Check if project is already deleted
            error_str = str(e)
            if "Project has been deleted" in error_str or "CONSUMER_INVALID" in error_str:
                success_msg = f"Project {project_id} was already deleted from Google Cloud (verified). Removing from local storage."
                result = "Already deleted"
            else:
                raise e
        
        logger.info(success_msg)
        
        # Also remove from local storage
        await remove_project(project_id)
        
        write_audit_log('admin', 'delete_project_from_google_cloud', {
            'project_id': project_id,
            'status': 'success',
            'creds_source': creds_source,
            'note': success_msg
        })
        
        return {
            "success": True,
            "message": success_msg,
            "operation": str(result)
        }
        
    except Exception as e:
        error_msg = f"Failed to delete project {project_id} from Google Cloud: {str(e)}"
        logger.error(error_msg)
        
        write_audit_log('admin', 'delete_project_from_google_cloud', {
            'project_id': project_id,
            'status': 'failed',
            'error': str(e)
        })
        
        raise HTTPException(status_code=500, detail=error_msg)

@app.post("/projects/bulk-delete-google-cloud")
async def bulk_delete_projects_from_google_cloud(request: Request):
    """
    Bulk delete multiple Firebase projects from Google Cloud.
    Tries Admin Service Account first, then falls back to individual project credentials.
    """
    if not GOOGLE_CLOUD_AVAILABLE:
        raise HTTPException(
            status_code=500, 
            detail="Google Cloud libraries not available. Please install google-cloud-resource-manager"
        )
    
    try:
        data = await request.json()
        project_ids = data.get('projectIds', [])
        
        if not isinstance(project_ids, list) or not project_ids:
            raise HTTPException(status_code=400, detail="No project IDs provided")
        
        results = []
        successful = []
        failed = []
        
        # Initialize Admin Client if available
        admin_client = None
        if admin_credentials:
            try:
                if isinstance(admin_credentials, dict):
                    admin_creds = service_account.Credentials.from_service_account_info(admin_credentials)
                else:
                    # Assume it's already a Credentials object or compatible
                    admin_creds = admin_credentials
                
                admin_client = resourcemanager.ProjectsClient(credentials=admin_creds)
                logger.info("Initialized Admin Client for bulk deletion")
            except Exception as e:
                logger.warning(f"Failed to initialize Admin Client: {e}")

        for project_id in project_ids:
            try:
                client = admin_client
                creds_source = "admin_service_account"

                # If no admin client, try project credentials
                if not client:
                    if project_id not in projects:
                        raise Exception("Project not found locally and no Admin credentials available")
                    
                    project_data = projects[project_id]
                    service_account_data = project_data.get('serviceAccount')
                    if not service_account_data:
                         raise Exception("No service account data found for project")
                    
                    project_creds = service_account.Credentials.from_service_account_info(service_account_data)
                    client = resourcemanager.ProjectsClient(credentials=project_creds)
                    creds_source = "project_service_account"

                # Delete the project
                logger.info(f"Deleting {project_id} using {creds_source}...")
                
                try:
                    operation = client.delete_project(name=f"projects/{project_id}")
                    result = operation.result()
                    status_msg = "success"
                except Exception as e:
                    # Check if project is already deleted
                    error_str = str(e)
                    if "Project has been deleted" in error_str or "CONSUMER_INVALID" in error_str:
                        status_msg = "already_deleted"
                        result = "Already deleted"
                        logger.info(f"Project {project_id} was already deleted. Removing local reference.")
                    else:
                        raise e
                
                # Also remove from local storage
                await remove_project(project_id)
                
                successful.append(project_id)
                results.append({
                    "project_id": project_id,
                    "status": "success",
                    "operation": str(result),
                    "source": creds_source,
                    "note": status_msg
                })
                logger.info(f"Successfully processed deletion for {project_id}")
                
            except Exception as e:
                logger.error(f"Failed to delete {project_id}: {e}")
                failed.append({
                    "project_id": project_id,
                    "reason": str(e)
                })
                results.append({
                    "project_id": project_id,
                    "status": "failed",
                    "error": str(e)
                })
        
        write_audit_log('admin', 'bulk_delete_projects_from_google_cloud', {
            'project_ids': project_ids,
            'successful': successful,
            'failed': failed
        })
        
        return {
            "success": len(failed) == 0,
            "results": results,
            "summary": {
                "total": len(project_ids),
                "successful": len(successful),
                "failed": len(failed)
            }
        }
        
    except Exception as e:
        logger.error(f"Bulk delete error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

class AdminServiceAccount(BaseModel):
    serviceAccount: Dict[str, Any]

@app.post("/admin/service-account")
async def upload_admin_service_account(data: AdminServiceAccount, _: None = Depends(verify_basic_admin)):
    """Upload admin service account credentials for Google Cloud operations"""
    try:
        global admin_credentials
        
        # Verify credentials structure
        sa = data.serviceAccount
        if not sa.get('project_id') or not sa.get('private_key') or not sa.get('client_email'):
             raise HTTPException(status_code=400, detail="Invalid service account JSON structure")

        # Save to file
        with open(ADMIN_SERVICE_ACCOUNT_FILE, 'w') as f:
            json.dump(sa, f, indent=2)
            
        # Update in-memory
        admin_credentials = sa
        logger.info(f"Admin service account updated for project: {sa.get('project_id')}")
        
        return {
            "success": True, 
            "message": "Admin service account uploaded successfully",
            "project_id": sa.get('project_id'),
            "client_email": sa.get('client_email')
        }
    except Exception as e:
        logger.error(f"Failed to save admin service account: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/projects")
async def list_projects(request: Request, search: Optional[str] = None, limit: Optional[int] = None, offset: Optional[int] = None):
    current_user = get_current_user_from_request(request)
    
    # Check if user is admin
    users = load_app_users()
    user_data = next((u for u in users.get('users', []) if u.get('username') == current_user), None)
    is_admin = user_data and user_data.get('role') == 'admin'
    
    # Get projects from global variable (already loaded)
    projects_data = list(projects.values()) if projects else []
    logger.info(f"list_projects: current_user={current_user}, is_admin={is_admin}, projects_count={len(projects_data)}")
    logger.info(f"Global projects keys: {list(projects.keys()) if projects else 'None'}")
    
    # Add status to each project and support search/pagination
    project_list = []
    term = (search or "").strip().lower()
    
    for project in projects_data:
        # Get project_id from serviceAccount
        project_id = project.get('serviceAccount', {}).get('project_id')
        if not project_id:
            continue
            
        # Migrate existing projects to admin ownership if no owner set
        if 'ownerId' not in project:
            project['ownerId'] = 'admin'
            
        # Filter by ownership (admin sees all, users see only their own)
        if not is_admin and project.get('ownerId') != current_user:
            continue
            
        status = "active" if project_id in firebase_apps else "error"
        project_with_status = dict(project)
        project_with_status["status"] = status
        project_with_status["id"] = project_id  # Ensure id is present
        
        if term:
            name_lc = (project_with_status.get('name') or '').lower()
            email_lc = (project_with_status.get('adminEmail') or '').lower()
            if term not in name_lc and term not in email_lc and term not in project_id.lower():
                continue
        project_list.append(project_with_status)
    
    # Save projects if we migrated any
    if any('ownerId' not in project for project in projects_data):
        save_projects_to_file()
    
    # Sort projects by creation time (assuming order in file is roughly creation order) or name
    # project_list.sort(key=lambda x: x.get('name', '').lower())
    
    total = len(project_list)
    
    # Apply pagination only if limit/offset are provided
    if limit is not None and offset is not None:
        try:
            l = max(1, min(int(limit), 1000)) # Increased max limit
            o = max(0, int(offset))
            project_list = project_list[o:o+l]
        except Exception:
            pass
    elif limit is not None:
        try:
             l = max(1, min(int(limit), 1000))
             project_list = project_list[:l]
        except Exception:
            pass
            
    return {"projects": project_list, "total": total}

@app.post("/projects/refresh")
async def refresh_projects_list(request: Request):
    """Manually reload projects from file without restart"""
    try:
        load_projects_from_file()
        return {"success": True, "message": f"Projects reloaded. Total: {len(projects)}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/projects/{project_id}/users")
async def load_users(project_id: str, limit: Optional[int] = 1000, page_token: Optional[str] = None, search: Optional[str] = None):
    try:
        if project_id not in firebase_apps:
            # Project not initialized or not found
            raise HTTPException(status_code=404, detail="Project not found or not initialized. Please check your service account and project setup.")

        app = firebase_apps[project_id]
        # Firebase Admin SDK does not support arbitrary offset; use page tokens.
        # If a page_token is provided, resume from there; otherwise start fresh.
        try:
            page = auth.list_users(app=app, page_token=page_token) if page_token else auth.list_users(app=app)
        except Exception as e:
            logger.error(f"Firebase connection error for project {project_id}: {str(e)}")
            raise HTTPException(status_code=400, detail=f"Failed to connect to Firebase: {str(e)}")

        result_users = []
        next_token: Optional[str] = None
        max_to_collect = int(limit) if limit else 1000000 # Effectively unlimited default or user specified
        search_lc = (search or "").strip().lower()

        # Collect users across multiple pages until limit is reached
        while len(result_users) < max_to_collect:
            for user in page.users:
                if len(result_users) >= max_to_collect:
                    break
                    
                if search_lc:
                    email_lc = (user.email or "").lower()
                    name_lc = (user.display_name or "").lower()
                    if search_lc not in email_lc and search_lc not in name_lc:
                        continue
                        
                created_at = None
                if user.user_metadata and user.user_metadata.creation_timestamp:
                    try:
                        if hasattr(user.user_metadata.creation_timestamp, 'timestamp'):
                            created_at = datetime.fromtimestamp(user.user_metadata.creation_timestamp.timestamp()).isoformat()
                        else:
                            created_at = str(user.user_metadata.creation_timestamp)
                    except Exception:
                        created_at = None
                result_users.append({
                    "uid": user.uid,
                    "email": user.email or "",
                    "displayName": user.display_name,
                    "disabled": user.disabled,
                    "emailVerified": user.email_verified,
                    "createdAt": created_at,
                })
            
            # Check for next page
            if not page.next_page_token or len(result_users) >= max_to_collect:
                break
                
            # Fetch next page
            try:
                page = auth.list_users(app=app, page_token=page.next_page_token)
            except Exception as e:
                logger.error(f"Failed to fetch next page of users: {e}")
                break

        next_token = page.next_page_token if hasattr(page, 'next_page_token') and len(result_users) < max_to_collect else None
        return {"users": result_users, "nextPageToken": next_token}
    except HTTPException as he:
        raise he
    except Exception as e:
        logger.error(f"Failed to load users for project {project_id}: {str(e)}")
        # Return a clear error message
        raise HTTPException(status_code=500, detail=f"Failed to load users: {str(e)}")

@app.post("/projects/users/import")
async def import_users_parallel(user_import: UserImport):
    """Import users across multiple projects in parallel"""
    try:
        project_ids = user_import.projectIds
        emails = user_import.emails
        user = getattr(user_import, 'user', 'admin') if hasattr(user_import, 'user') else 'admin'
        # Split emails across projects
        emails_per_project = len(emails) // len(project_ids)
        remainder = len(emails) % len(project_ids)
        project_email_chunks = {}
        start_idx = 0
        for i, project_id in enumerate(project_ids):
            chunk_size = emails_per_project + (1 if i < remainder else 0)
            project_email_chunks[project_id] = emails[start_idx:start_idx + chunk_size]
            start_idx += chunk_size
        # Import in parallel
        async def import_to_project(project_id: str, emails_chunk: List[str]):
            if project_id not in firebase_apps:
                return {"project_id": project_id, "imported": 0, "error": "Project not found"}
            app = firebase_apps[project_id]
            batch_size = 1000
            total_imported = 0
            for i in range(0, len(emails_chunk), batch_size):
                batch_emails = emails_chunk[i:i + batch_size]
                batch = []
                for email in batch_emails:
                    uid = hashlib.md5(email.encode()).hexdigest().lower()
                    user_record = auth.ImportUserRecord(email=email, uid=uid)
                    batch.append(user_record)
                try:
                    results = auth.import_users(batch, app=app)
                    total_imported += results.success_count
                    await asyncio.sleep(0.1)  # Brief pause between batches
                except Exception as e:
                    logger.error(f"Import batch failed for {project_id}: {str(e)}")
            return {"project_id": project_id, "imported": total_imported}
        # Execute imports in parallel
        tasks = []
        for project_id, emails_chunk in project_email_chunks.items():
            task = import_to_project(project_id, emails_chunk)
            tasks.append(task)
        results = await asyncio.gather(*tasks)
        total_imported = sum(result["imported"] for result in results)
        # Audit log and WebSocket notification
        write_audit_log(user, 'import_users', {'project_ids': project_ids, 'total_imported': total_imported, 'emails': emails})
        asyncio.create_task(notify_ws('import_users', {'project_ids': project_ids, 'total_imported': total_imported, 'user': user}))
        return {
            "success": True,
            "total_imported": total_imported,
            "results": results
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to import users: {str(e)}")

@app.post("/projects/bulk-import-v2")
async def bulk_import_projects_v2(
    profile_id: str = Form(...),
    credentials_file: UploadFile = File(...),
    service_accounts: List[UploadFile] = File(...),
):
    """
    Bulk import projects using a credentials text file and multiple service account JSONs.
    Text file format per line: email project_id api_key json_filename
    Example: support@example.com my-project AIzaSy... my-project.json
    """
    logger.info(f"Starting bulk import v2: {credentials_file.filename}, {len(service_accounts)} json files")
    
    results = {
        "successful": 0,
        "failed": 0,
        "details": []
    }
    
    try:
        # Read all service account files into dictionaries for valid lookups
        sa_files_content = {}
        sa_by_project_id = {}
        
        for sa_file in service_accounts:
            content = await sa_file.read()
            try:
                data = json.loads(content)
                sa_files_content[sa_file.filename] = data
                
                # Index by project_id inside the JSON for robust matching
                if 'project_id' in data:
                    sa_by_project_id[data['project_id']] = data
            except Exception as e:
                logger.warning(f"Failed to parse JSON file {sa_file.filename}: {e}")
                
        # Read credentials file
        creds_content = await credentials_file.read()
        creds_text = creds_content.decode('utf-8')
        
        lines = creds_text.strip().split('\n')
        
        for line_num, line in enumerate(lines, 1):
            line = line.strip()
            if not line or line.startswith('#'):
                continue
                
            parts = line.split()
            if len(parts) < 4:
                results["failed"] += 1
                results["details"].append({
                    "line": line_num,
                    "error": "Invalid format. Expected: email project_id api_key json_filename",
                    "content": line
                })
                continue
                
            email, project_id, api_key, json_filename = parts[0], parts[1], parts[2], parts[3]
            
            # --- Matching Logic ---
            service_account_data = None
            match_method = "none"

            # 1. Try matching by Project ID (Most Robust)
            # This handles cases where filename in text is wrong, but project_id matches the JSON content.
            # AND it handles cases where JSON filename is long/generated.
            if project_id in sa_by_project_id:
                service_account_data = sa_by_project_id[project_id]
                match_method = "project_id"

            # 2. Try Exact Filename Match (Legacy)
            if not service_account_data:
                service_account_data = sa_files_content.get(json_filename)
                if service_account_data: match_method = "filename"
                
            # 3. Try Cleaned Filename Match (e.g. if text has path)
            if not service_account_data:
                clean_json_filename = os.path.basename(json_filename)
                service_account_data = sa_files_content.get(clean_json_filename)
                if service_account_data: match_method = "clean_filename"

            # 4. Try Prefix/Fuzzy Match (User Request)
            # "detect it using the first words of the name"
            if not service_account_data:
                # Remove extension from text file entry to get the "stem"
                # e.g. "pulse-plus-4293.jso" -> "pulse-plus-4293"
                target_stem = os.path.splitext(os.path.basename(json_filename))[0]
                
                # Search all uploaded files
                for fname, data in sa_files_content.items():
                    # Check if uploaded filename starts with the stem
                    # e.g. "pulse-plus-4293-firebase-adminsdk...json" starts with "pulse-plus-4293"
                    if fname.startswith(target_stem):
                        service_account_data = data
                        match_method = "prefix_match"
                        break
            
            if not service_account_data:
                results["failed"] += 1
                results["details"].append({
                    "line": line_num,
                    "project_id": project_id,
                    "error": f"Service account not found. Checked project_id='{project_id}', filename='{json_filename}', and prefix match.",
                })
                continue
            
            # Additional validation: check if project_id in JSON matches
            sa_project_id = service_account_data.get('project_id')
            if sa_project_id and sa_project_id != project_id:
                logger.warning(f"Project ID mismatch for {project_id}: JSON has {sa_project_id}. Using JSON's project_id.")
                
            # Create project dictionary
            new_project = {
                "id": project_id,
                "name": project_id, # Default name to ID
                "adminEmail": email,
                "apiKey": api_key,
                "serviceAccount": service_account_data,
                "profileId": profile_id,
                "status": "active", # Assume active initially
                "dataCollection": True,
                "createdAt": datetime.now().isoformat()
            }
            
            # Add to global projects
            if project_id in projects:
                # Update existing
                projects[project_id].update(new_project)
                action = "Updated"
            else:
                projects[project_id] = new_project
                action = "Created"
                
            # Initialize Firebase App
            try:
                if project_id in firebase_apps:
                    firebase_admin.delete_app(firebase_apps[project_id])
                    del firebase_apps[project_id]
                
                cred = credentials.Certificate(service_account_data)
                firebase_apps[project_id] = firebase_admin.initialize_app(cred, name=project_id)
            except Exception as e:
                logger.error(f"Failed to initialize app for {project_id}: {e}")
                new_project["status"] = "error"
                
            results["successful"] += 1
            results["details"].append({
                "line": line_num,
                "project_id": project_id,
                "status": "Success",
                "action": action,
                "match_method": match_method
            })
            
        # Save all projects
        save_projects_to_file()
        
        return results
        
    except Exception as e:
        logger.error(f"Bulk import v2 failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/projects/bulk-import-automated")
async def bulk_import_projects_automated(request: Request):
    """
    Automatically import projects from the 'credentials/' directory.
    Uses 'credentials/credentials.txt' for metadata and matching JSON files in the same directory.
    """
    logger.info("Starting automated bulk import from credentials/ directory")
    
    # Debug info
    # Define potential credentials directories
    potential_dirs = [
        "credentials",                                      # Relative to CWD
        "/opt/FBG-/credentials",                           # Source directory (User's upload location)
        "/var/www/firebase-manager/credentials",           # Deployment directory
        os.path.join(os.getcwd(), "credentials")           # Absolute CWD
    ]
    
    abs_credentials_dir = None
    credentials_file_path = None
    
    # Find the valid directory
    for potential_dir in potential_dirs:
        full_path = os.path.abspath(potential_dir)
        check_file = os.path.join(full_path, "credentials.txt")
        
        logger.info(f"Checking for credentials in: {full_path}")
        
        if os.path.exists(full_path) and os.path.exists(check_file):
            abs_credentials_dir = full_path
            credentials_file_path = check_file
            logger.info(f"✅ Found valid credentials directory: {abs_credentials_dir}")
            break
            
    if not abs_credentials_dir:
        logger.error("Could not find 'credentials/credentials.txt' in any standard location.")
        logger.info(f"Checked: {potential_dirs}")
        raise HTTPException(status_code=404, detail="Credentials directory or credentials.txt not found in /opt/FBG-/credentials or local directory.")
    
    results = {
        "successful": 0,
        "failed": 0,
        "details": []
    }
    
    try:
        # Get profile_id from request if provided, otherwise use default or first available
        data = await request.json()
        profile_id = data.get('profileId')
        
        # If no profileId, try to find the first one
        if not profile_id:
            profiles_data = load_profiles_from_file()
            if profiles_data:
                profile_id = profiles_data[0].get('id')
            else:
                profile_id = "default"

        # Read all JSON files in the credentials directory
        sa_files_content = {}
        sa_by_project_id = {}
        
        for filename in os.listdir(abs_credentials_dir):
            if filename.endswith(".json"):
                file_path = os.path.join(abs_credentials_dir, filename)
                try:
                    with open(file_path, 'r', encoding='utf-8') as f:
                        sa_data = json.load(f)
                        sa_files_content[filename] = sa_data
                        if 'project_id' in sa_data:
                            sa_by_project_id[sa_data['project_id']] = sa_data
                except Exception as e:
                    logger.warning(f"Failed to parse JSON file {filename}: {e}")
        
        # Read credentials file
        with open(credentials_file_path, 'r', encoding='utf-8') as f:
            lines = f.readlines()
        
        for line_num, line in enumerate(lines, 1):
            line = line.strip()
            if not line or line.startswith('#'):
                continue
                
            parts = line.split()
            if len(parts) < 4:
                results["failed"] += 1
                results["details"].append({
                    "line": line_num,
                    "error": "Invalid format. Expected: email project_id api_key json_filename",
                    "content": line
                })
                continue
                
            email, project_id, api_key, json_filename = parts[0], parts[1], parts[2], parts[3]
            
            # --- Matching Logic ---
            service_account_data = None
            match_method = "none"

            # 1. Try matching by Project ID
            if project_id in sa_by_project_id:
                service_account_data = sa_by_project_id[project_id]
                match_method = "project_id"

            # 2. Try Exact Filename Match
            if not service_account_data:
                service_account_data = sa_files_content.get(json_filename)
                if service_account_data: match_method = "filename"
                
            # 3. Try Cleaned Filename Match
            if not service_account_data:
                clean_json_filename = os.path.basename(json_filename)
                service_account_data = sa_files_content.get(clean_json_filename)
                if service_account_data: match_method = "clean_filename"

            # 4. Try Prefix/Fuzzy Match
            if not service_account_data:
                target_stem = os.path.splitext(os.path.basename(json_filename))[0]
                for fname, sa_data in sa_files_content.items():
                    if fname.startswith(target_stem):
                        service_account_data = sa_data
                        match_method = "prefix_match"
                        break
            
            if not service_account_data:
                results["failed"] += 1
                results["details"].append({
                    "line": line_num,
                    "project_id": project_id,
                    "error": f"JSON file '{json_filename}' not found for project '{project_id}'",
                })
                logger.warning(f"Failed match for {project_id} at line {line_num}")
                continue
            
            # Create project dictionary
            new_project = {
                "id": project_id,
                "name": project_id,
                "adminEmail": email,
                "apiKey": api_key,
                "serviceAccount": service_account_data,
                "profileId": profile_id,
                "status": "active",
                "dataCollection": True,
                "createdAt": datetime.now().isoformat()
            }
            
            # Add to global projects
            if project_id in projects:
                projects[project_id].update(new_project)
                action = "Updated"
            else:
                projects[project_id] = new_project
                action = "Created"
                
            # Initialize Firebase App
            try:
                if project_id in firebase_apps:
                    firebase_admin.delete_app(firebase_apps[project_id])
                    del firebase_apps[project_id]
                
                cred = credentials.Certificate(service_account_data)
                firebase_apps[project_id] = firebase_admin.initialize_app(cred, name=project_id)
            except Exception as e:
                logger.error(f"Failed to initialize app for {project_id}: {e}")
                new_project["status"] = "error"
                
            results["successful"] += 1
            results["details"].append({
                "line": line_num,
                "project_id": project_id,
                "status": "Success",
                "action": action,
                "match_method": match_method
            })
            
        # Save all projects
        save_projects_to_file()
        
        return results
        
    except Exception as e:
        logger.error(f"Automated bulk import failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/projects/users/bulk")
async def bulk_delete_users(bulk_delete: dict):
    logger.info("/projects/users/bulk endpoint called")
    try:
        project_ids = bulk_delete.get('projectIds')
        user_ids = bulk_delete.get('userIds')
        if not isinstance(project_ids, list):
            return error_response("Expected list of project IDs", code="invalid_input", status_code=400)
        
        deleted = []
        failed = []
        total_deleted = 0
        
        for project_id in project_ids:
            try:
                if project_id not in firebase_apps:
                    failed.append({"project_id": project_id, "reason": "Project not found or not initialized"})
                    continue
                
                # Get Firebase Admin Auth instance for this project
                admin_auth = firebase_apps[project_id]
                project_deleted = 0
                project_failed = 0
                
                if user_ids:
                    # Delete specific users
                    for user_id in user_ids:
                        try:
                            # Use Firebase Admin SDK to delete user
                            auth.delete_user(user_id, app=admin_auth)
                            project_deleted += 1
                            total_deleted += 1
                            logger.info(f"Deleted user {user_id} from project {project_id}")
                        except Exception as e:
                            project_failed += 1
                            logger.error(f"Failed to delete user {user_id} from project {project_id}: {e}")
                else:
                    # Delete all users in the project
                    try:
                        # List and delete in batches until no users remain
                        while True:
                            # Always list the first page; effectively popping users off the stack
                            page = auth.list_users(app=admin_auth, max_results=1000)
                            if not page.users:
                                break
                            
                            user_uids = [user.uid for user in page.users]
                            try:
                                # Delete users in batch using Firebase Admin SDK
                                results = auth.delete_users(user_uids, app=admin_auth)
                                project_deleted += results.success_count
                                total_deleted += results.success_count
                                project_failed += results.failure_count
                                logger.info(f"Deleted {results.success_count} users from project {project_id}")
                            except Exception as e:
                                logger.error(f"Failed to delete batch of users from project {project_id}: {e}")
                                project_failed += len(user_uids)
                                # Start fresh on next iteration or break if critical
                                break
                                
                            # Brief pause to avoid rate limits
                            await asyncio.sleep(0.1)
                            
                    except Exception as e:
                        failed.append({"project_id": project_id, "reason": f"Failed to list users: {str(e)}"})
                        continue
                
                deleted.append({
                    "project_id": project_id, 
                    "deleted_count": project_deleted,
                    "failed_count": project_failed
                })
                
            except Exception as e:
                logger.error(f"Failed to delete users for project {project_id}: {e}")
                failed.append({"project_id": project_id, "reason": str(e)})
        
        if failed:
            return {
                "success": len(deleted) > 0,
                "deleted": deleted,
                "failed": failed,
                "total_deleted": total_deleted,
                "error": "Some user deletions failed.",
                "code": "partial_failure"
            }
            
        return {
            "success": True, 
            "deleted": deleted,
            "total_deleted": total_deleted,
            "message": f"Successfully deleted {total_deleted} users"
        }
        
    except Exception as e:
        logger.error(f"Error in bulk delete users: {str(e)}")
        return error_response(f"Failed to delete users: {str(e)}", code="server_error", status_code=500)

# Campaign Management
@app.post("/campaigns")
async def create_campaign(campaign: CampaignCreate, request: Request):
    """Create a new campaign with user ownership"""
    try:
        current_user = get_current_user_from_request(request)
        campaign_id = str(uuid.uuid4())
        
        campaign_data = {
            "id": campaign_id,
            "name": campaign.name,
            "projectIds": campaign.projectIds,
            "selectedUsers": campaign.selectedUsers,
            "batchSize": campaign.batchSize,
            "workers": campaign.workers,
            "template": campaign.template,
            "status": "pending",
            "createdAt": datetime.now().isoformat(),
            "processed": 0,
            "successful": 0,
            "failed": 0,
            "errors": [],
            "projectStats": {pid: {"processed": 0, "successful": 0, "failed": 0} for pid in campaign.projectIds},
            "ownerId": current_user,  # Set ownership to current user
            # NEW: Enterprise sending modes
            "sending_mode": campaign.sending_mode,
            "turbo_config": campaign.turbo_config,
            "throttle_config": campaign.throttle_config,
            "schedule_config": campaign.schedule_config
        }
        
        # PERSIST TO DATABASE (The Next Level)
        # We try to write to DB. If it fails (e.g. connection error), we log but continue in memory.
        try:
            conn = get_db_connection()
            if conn:
                cursor = conn.cursor()
                cursor.execute("""
                    INSERT INTO campaigns (
                        name, project_ids, batch_size, workers, template, status, 
                        owner_id, sending_mode, turbo_config, throttle_config, schedule_config,
                        campaign_uuid
                    ) VALUES (%s, %s, %s, %s, %s, %s, (SELECT id FROM app_users WHERE username=%s), %s, %s, %s, %s, %s)
                    RETURNING id
                """, (
                    campaign.name, 
                    json.dumps(campaign.projectIds),
                    campaign.batchSize,
                    campaign.workers,
                    campaign.template,
                    "pending",
                    current_user,
                    campaign.sending_mode,
                    json.dumps(campaign.turbo_config),
                    json.dumps(campaign.throttle_config),
                    json.dumps(campaign.schedule_config),
                    campaign_id
                ))
                db_id = cursor.fetchone()[0]
                campaign_data['db_id'] = db_id 
                conn.commit()
                conn.close()
        except Exception as e:
            logger.error(f"⚠️ DB Persistence Warning: {e}. Falling back to file-only.")
        
        # Save to Memory & File
        active_campaigns[campaign_id] = campaign_data
        save_campaigns_to_file()
        
        return {"success": True, "campaign_id": campaign_id, "campaign": campaign_data}
        
    except Exception as e:
        logger.error(f"Create Campaign Error: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to create campaign: {str(e)}")

@app.get("/campaigns")
async def list_campaigns(request: Request, page: int = 1, limit: int = 10):
    """
    List campaigns.
    STRATEGY: File/memory is source of truth for FULL config (throttle_config,
    selectedUsers, schedule_config, etc.). DB is queried ONLY for live status/counts.
    This ensures campaigns NEVER lose their config on refresh.
    """
    try:
        current_user = get_current_user_from_request(request)
        users_data   = load_app_users()
        user_obj     = next((u for u in users_data.get('users', []) if u.get('username') == current_user), None)
        is_admin     = user_obj and user_obj.get('role') == 'admin'

        # ── 1. Load full campaign data from file (source of truth for all fields) ──
        file_campaigns = load_campaigns_from_file() or []
        if not is_admin:
            file_campaigns = [c for c in file_campaigns if c.get('ownerId') == current_user]
        file_map = {c.get('id'): c for c in file_campaigns if c.get('id')}

        # ── 2. Query DB for live status/counts only ────────────────────────────────
        db_status_map = {}
        try:
            conn = get_db_connection()
            if conn:
                q = """
                    SELECT c.campaign_uuid, c.status, c.processed, c.successful, c.failed
                    FROM campaigns c
                    LEFT JOIN app_users u ON c.owner_id = u.id
                """
                params = []
                if not is_admin:
                    q += " WHERE u.username = %s"
                    params.append(current_user)
                cursor = conn.cursor()
                cursor.execute(q, tuple(params))
                for row in cursor.fetchall():
                    c_uuid = row[0]
                    if c_uuid:
                        db_status_map[c_uuid] = {
                            'status': row[1], 'processed': row[2] or 0,
                            'successful': row[3] or 0, 'failed': row[4] or 0,
                        }
                conn.close()
        except Exception as e:
            logger.warning(f"DB status overlay failed: {e}")

        # ── 3. Merge: file (full config) + DB (live counts) + memory (real-time) ──
        final_list = []
        for c in file_campaigns:
            c_id = c.get('id')

            if c_id in active_campaigns:
                # Memory version has the most current data; patch missing config fields from file
                mem_c = dict(active_campaigns[c_id])
                for field in ('throttle_config', 'schedule_config', 'selectedUsers', 'turbo_config', 'sending_mode'):
                    if not mem_c.get(field) and c.get(field):
                        mem_c[field] = c[field]
                final_list.append(mem_c)
            else:
                merged = dict(c)  # start with full file data
                if c_id in db_status_map:
                    db = db_status_map[c_id]
                    merged.update({
                        'status':     db.get('status',     merged.get('status', 'pending')),
                        'processed':  db.get('processed',  merged.get('processed', 0)),
                        'successful': db.get('successful', merged.get('successful', 0)),
                        'failed':     db.get('failed',     merged.get('failed', 0)),
                    })
                final_list.append(merged)

        # Sort newest first
        final_list.sort(key=lambda x: x.get('createdAt', ''), reverse=True)

        # ── 4. Pagination ──────────────────────────────────────────────────────────
        total_campaigns = len(final_list)
        total_pages     = (total_campaigns + limit - 1) // limit
        start_index     = (page - 1) * limit
        paginated       = final_list[start_index: start_index + limit]

        return {
            "campaigns":    paginated,
            "total":        total_campaigns,
            "total_pages":  total_pages,
            "page":         page,
            "limit":        limit
        }

    except Exception as e:
        logger.error(f"List campaigns error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/campaigns/{campaign_id}")
async def get_campaign(campaign_id: str):
    """Get campaign details - merges Redis live stats from Celery worker"""
    if campaign_id not in active_campaigns:
        raise HTTPException(status_code=404, detail="Campaign not found")
    
    campaign = dict(active_campaigns[campaign_id])  # copy to avoid mutation
    
    # Read live stats from Redis (written by Celery worker)
    try:
        import redis as redis_lib
        r = redis_lib.Redis.from_url(os.getenv('REDIS_URL', 'redis://localhost:6379/0'))
        
        # Aggregate stats across all projects
        total_processed = 0
        total_successful = 0
        total_failed = 0
        
        project_ids = campaign.get('projectIds', [])
        for pid in project_ids:
            stats_key = f"campaign:{campaign_id}:{pid}:stats"
            stats = r.hgetall(stats_key)
            if stats:
                total_processed += int(stats.get(b'processed', 0))
                total_successful += int(stats.get(b'successful', 0))
                total_failed += int(stats.get(b'failed', 0))
        
        # Also check global stats key
        global_key = f"campaign:{campaign_id}:stats"
        global_stats = r.hgetall(global_key)
        if global_stats and not project_ids:
            total_processed += int(global_stats.get(b'processed', 0))
            total_successful += int(global_stats.get(b'successful', 0))
            total_failed += int(global_stats.get(b'failed', 0))
        
        if total_processed > 0 or total_successful > 0 or total_failed > 0:
            campaign['processed'] = total_processed
            campaign['successful'] = total_successful
            campaign['failed'] = total_failed
            
            # Update active_campaigns in memory so file saves are correct
            active_campaigns[campaign_id]['processed'] = total_processed
            active_campaigns[campaign_id]['successful'] = total_successful
            active_campaigns[campaign_id]['failed'] = total_failed
            
            # Determine if still running or completed
            total_expected = sum(
                len(campaign.get('selectedUsers', {}).get(pid, []))
                for pid in project_ids
            ) or campaign.get('totalUsers', 0)
            
            if total_expected > 0 and total_processed >= total_expected:
                if campaign.get('status') == 'running':
                    active_campaigns[campaign_id]['status'] = 'completed'
                    campaign['status'] = 'completed'
                    save_campaigns_to_file()
    except Exception as redis_err:
        logger.warning(f"Could not read Redis stats for campaign {campaign_id}: {redis_err}")
    
    return campaign

@app.put("/campaigns/{campaign_id}")
async def update_campaign(campaign_id: str, campaign_update: CampaignUpdate):
    """Update campaign settings"""
    campaign = _get_campaign(campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    if campaign["status"] == "running":
        raise HTTPException(status_code=400, detail="Cannot update running campaign")
    
    if campaign_update.name:
        campaign["name"] = campaign_update.name
    if campaign_update.batchSize:
        campaign["batchSize"] = campaign_update.batchSize
    if campaign_update.workers:
        campaign["workers"] = campaign_update.workers
    if campaign_update.template:
        campaign["template"] = campaign_update.template
    # NEW: Enterprise settings updates
    if campaign_update.sending_mode:
        campaign["sending_mode"] = campaign_update.sending_mode
    if campaign_update.turbo_config:
        campaign["turbo_config"] = campaign_update.turbo_config
    if campaign_update.throttle_config:
        campaign["throttle_config"] = campaign_update.throttle_config
    if campaign_update.schedule_config:
        campaign["schedule_config"] = campaign_update.schedule_config
    
    save_campaigns_to_file()
    write_audit_log('admin', 'update_template', {'project_ids': campaign['projectIds'], 'fields_updated': list(campaign_update.dict(exclude_none=True).keys())})
    asyncio.create_task(notify_ws('template_update', {'project_id': campaign['id'], 'fields_updated': list(campaign_update.dict(exclude_none=True).keys())}))
    return {"success": True, "campaign": campaign}

@app.delete("/campaigns/{campaign_id}")
async def delete_campaign(campaign_id: str):
    """Delete a campaign"""
    campaign = _get_campaign(campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    if campaign["status"] == "running":
        raise HTTPException(status_code=400, detail="Cannot delete running campaign")
    
    del active_campaigns[campaign_id]
    if campaign_id in campaign_stats:
        del campaign_stats[campaign_id]
    
    save_campaigns_to_file()
    write_audit_log('admin', 'delete_campaign', {'campaign_id': campaign_id})
    asyncio.create_task(notify_ws('delete_campaign', {'campaign_id': campaign_id}))
    return {"success": True}

@app.post("/campaigns/{campaign_id}/start")
async def start_campaign(campaign_id: str):
    """Start a campaign with multi-project parallelism"""
    try:
        if campaign_id not in active_campaigns:
            raise HTTPException(status_code=404, detail="Campaign not found")
        
        campaign = active_campaigns[campaign_id]
        
        if campaign["status"] == "running":
            raise HTTPException(status_code=400, detail="Campaign already running")
        
        campaign["status"] = "running"
        campaign["startedAt"] = datetime.now().isoformat()
        save_campaigns_to_file()
        
        # Prepare payload for send_campaign
        projects_payload = []
        for pid in campaign.get('projectIds', []):
            uids = campaign.get('selectedUsers', {}).get(pid, [])
            projects_payload.append({
                'projectId': pid,
                'userIds': uids
            })
            
        payload = {
            'projects': projects_payload,
            'sending_mode': campaign.get('sending_mode', 'turbo'),
            'turbo_config': campaign.get('turbo_config'),
            'throttle_config': campaign.get('throttle_config'),
            'schedule_config': campaign.get('schedule_config'),
            'sending_limit': campaign.get('sending_limit'),
            'sending_offset': campaign.get('sending_offset', 0),
            'workers': campaign.get('workers', 50), # Pass configured workers
            'batchSize': campaign.get('batchSize', 50), # Pass configured batch size
            'campaignId': campaign_id
        }
        logger.info(f"[{campaign_id}] Start payload prepared. Mode: {payload['sending_mode']}. Projects: {len(projects_payload)}")
        for p in projects_payload:
            logger.info(f"   -> Project {p['projectId']}: {len(p['userIds'])} users")
        
        # Define background task
        async def run_background_process():
            try:
                # Create request-like object
                class FakeRequest:
                    async def json(self):
                        return payload
                
                logger.info(f"🚀 Starting background execution for campaign {campaign_id} in {payload['sending_mode']} mode")
                response = await send_campaign(FakeRequest())
                logger.info(f"Background execution response: {response}")
                
                error_message = None
                
                if not response.get('success'):
                    final_status = 'failed'
                    error_message = response.get('error', 'Unknown error during sending')
                    logger.error(f"Campaign execution failed: {error_message}")
                    if campaign_id in active_campaigns:
                        active_campaigns[campaign_id]['status'] = final_status
                        active_campaigns[campaign_id]['errors'].append(error_message)
                        save_campaigns_to_file()
                    return
                
                # For enterprise turbo/throttle modes, Celery workers run ASYNC.
                # We must NOT mark as complete immediately - poll Redis until done.
                turbo_modes = ('enterprise_turbo', 'enterprise_throttle')
                if response.get('mode') in turbo_modes:
                    logger.info(f"🔄 Celery dispatched for campaign {campaign_id} - polling Redis for completion...")
                    total_users = sum(len(p.get('userIds', [])) for p in projects_payload)
                    if not total_users:
                        total_users = 1  # avoid div by zero
                    
                    import redis as redis_lib
                    try:
                        r = redis_lib.Redis.from_url(os.getenv('REDIS_URL', 'redis://localhost:6379/0'))
                        max_wait = 600  # 10 minutes max poll
                        elapsed = 0
                        while elapsed < max_wait:
                            await asyncio.sleep(3)
                            elapsed += 3
                            
                            # Read per-project stats
                            total_processed = 0
                            total_successful = 0
                            total_failed = 0
                            
                            for p in projects_payload:
                                pid = p.get('projectId')
                                stats_key = f"campaign:{campaign_id}:{pid}:stats"
                                stats = r.hgetall(stats_key)
                                if stats:
                                    total_processed += int(stats.get(b'processed', 0))
                                    total_successful += int(stats.get(b'successful', 0))
                                    total_failed += int(stats.get(b'failed', 0))
                            
                            if campaign_id in active_campaigns:
                                active_campaigns[campaign_id]['processed'] = total_processed
                                active_campaigns[campaign_id]['successful'] = total_successful
                                active_campaigns[campaign_id]['failed'] = total_failed
                            
                            logger.info(f"📊 Campaign {campaign_id}: {total_processed}/{total_users} processed, {total_successful} OK, {total_failed} failed")
                            
                            if total_processed >= total_users:
                                logger.info(f"✅ Campaign {campaign_id} fully processed by Celery workers!")
                                break
                        else:
                            logger.warning(f"⏰ Campaign {campaign_id} polling timeout after {max_wait}s")
                    except Exception as redis_err:
                        logger.error(f"Redis polling error for campaign {campaign_id}: {redis_err}")
                    
                    # Mark completed regardless (timeout or done)
                    if campaign_id in active_campaigns:
                        if active_campaigns[campaign_id].get('status') == 'running':
                            active_campaigns[campaign_id]['status'] = 'completed'
                            active_campaigns[campaign_id]['completedAt'] = datetime.now().isoformat()
                            save_campaigns_to_file()
                            logger.info(f"Updated campaign {campaign_id} status to completed")
                    return
                
                # Synchronous final_status for non-celery modes
                if response.get('mode') == 'scheduled':
                    final_status = 'scheduled'
                else:
                    final_status = 'completed'
                
                # Update campaign status
                if campaign_id in active_campaigns:
                    if active_campaigns[campaign_id]['status'] == 'running':
                        active_campaigns[campaign_id]['status'] = final_status
                        if final_status == 'completed':
                            active_campaigns[campaign_id]['completedAt'] = datetime.now().isoformat()
                        
                        save_campaigns_to_file()
                        logger.info(f"Updated campaign {campaign_id} status to {final_status}")
                    
            except Exception as e:
                logger.error(f"❌ Background campaign execution failed: {e}")
                if campaign_id in active_campaigns:
                    active_campaigns[campaign_id]['status'] = 'failed'
                    active_campaigns[campaign_id]['errors'].append(str(e))
                    save_campaigns_to_file()

        # Launch background task
        asyncio.create_task(run_background_process())

        return {"success": True, "message": "Campaign execution started"}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to start campaign: {str(e)}")

@app.get("/projects/{project_id}/daily-count")
async def get_project_daily_count(project_id: str):
    """Get daily count for a project"""
    count = get_daily_count(project_id)
    return {"project_id": project_id, "date": date.today().isoformat(), "sent": count}

@app.get("/daily-counts")
async def get_all_daily_counts():
    """Get all daily counts"""
    return {"daily_counts": daily_counts}

def fire_all_emails(project_id, user_ids, campaign_id, workers, lightning, app_name=None, limit=None, offset=0):
    import concurrent.futures
    import logging
    
    # Ensure all IDs are strings and not None
    project_id = str(project_id) if project_id is not None else ''
    campaign_id = str(campaign_id) if campaign_id is not None else ''
    user_ids = [str(uid) for uid in user_ids if uid is not None]
    
    # Apply Offset and Limit to the user_ids list if provided
    original_count = len(user_ids)
    if offset and offset > 0:
        if offset < len(user_ids):
            user_ids = user_ids[offset:]
        else:
            user_ids = []
            
    if limit and limit > 0:
        user_ids = user_ids[:limit]
        
    logger.info(f"[{project_id}] Starting fire_all_emails: {len(user_ids)} users (Original: {original_count}, Offset: {offset}, Limit: {limit}), workers={workers}, lightning={lightning}")
    
    # Use existing Firebase apps instead of re-initializing
    if project_id not in firebase_apps:
        logger.error(f"[{project_id}] Project not found in firebase_apps")
        return 0
    
    if project_id not in pyrebase_apps:
        logger.error(f"[{project_id}] Project not found in pyrebase_apps")
        return 0
    
    firebase_app = firebase_apps[project_id]
    pyrebase_app = pyrebase_apps[project_id]
    pyrebase_auth = pyrebase_app.auth()
    
    # CRITICAL FIX: Initialize campaign result tracking for this project
    # This creates the campaign_results.json entry so update_campaign_result can track progress
    logger.info(f"[{project_id}] Initializing campaign result tracking for {len(user_ids)} users")
    create_campaign_result(campaign_id, project_id, len(user_ids))
    
    # Optimize worker configuration
    if workers is None:
        workers = 50  # Increased default workers for Turbo
    try:
        workers = int(workers)
    except Exception:
        workers = 50
    
    # Turbo/Lightning mode scaling
    if lightning:
        # Allow up to 100 workers for turbo mode (200 was causing crashes)
        # Check if workers was passed explicitly, otherwise default to 50
        max_workers = int(workers) if workers else 50
        max_workers = min(max_workers, 100) # Cap at 100 to prevent OS thread exhaustion
    else:
        max_workers = min(workers, 50)

    logger.info(f"[{project_id}] Starting optimized lookup and send with {max_workers} workers.")

    # Optimized Batch User Lookup
    user_emails = {} # map uid -> email
    
    # SAFETY: Always try to fetch ALL users if we suspect the passed list is problematic
    # But to be performant, let's try the passed list first.
    
    # Chunk user_ids into batches of 100 IF specific users provided
    if user_ids:
        # Apply Limit and Offset if provided via kwargs (or if passed in user_ids list, but here we expect full list or subset)
        # However, fire_all_emails signature doesn't take limit/offset directly, it takes user_ids.
        # The calling function should probably slice it, OR we add args.
        # Let's add them to the function signature if needed, or rely on caller? 
        # Actually, let's update signature to accept keyword args or just handle it here if passed in some other way?
        # WAIT: The caller `process_project_turbo` or `send_campaign` extracts these from the campaign config.
        # So we should update `fire_all_emails` signature.
        pass
        
    chunks = [user_ids[i:i + 100] for i in range(0, len(user_ids), 100)]
    
    def fetch_batch_emails(batch_uids):
        found = {}
        try:
            # Correctly use UidIdentifier for batch lookup
            identifiers = [auth.UidIdentifier(uid) for uid in batch_uids]
            result = auth.get_users(identifiers, app=firebase_app)
            for user in result.users:
                if user.email:
                    found[user.uid] = user.email
            if len(found) < len(batch_uids):
                logger.debug(f"[{project_id}] Batch lookup found {len(found)}/{len(batch_uids)} users")
        except Exception as e:
            logger.error(f"[{project_id}] Batch user lookup failed: {e}")
            # Fallback: Try fetching individually if batch fails
            for uid in batch_uids:
                try:
                    u = auth.get_user(uid, app=firebase_app)
                    if u.email:
                        found[u.uid] = u.email
                except:
                    pass
        return found

        # Parallelize the lookup itself
        with concurrent.futures.ThreadPoolExecutor(max_workers=20) as lookup_executor:
            future_to_batch = {lookup_executor.submit(fetch_batch_emails, chunk): chunk for chunk in chunks}
            for future in concurrent.futures.as_completed(future_to_batch):
                try:
                    batch_result = future.result()
                    user_emails.update(batch_result)
                except Exception as e:
                    logger.error(f"[{project_id}] Lookup future failed: {e}")

    # ULTIMATE FALLBACK: If we still have 0 emails, fetch ALL users from the project
    if len(user_emails) == 0:
        logger.info(f"[{project_id}] No emails found via ID lookup (provided {len(user_ids) if user_ids else 0} IDs). Fetching ALL users from project...")
        try:
            # Use list_users pagination to get everyone
            page = auth.list_users(app=firebase_app, max_results=1000)
            while page:
                for user in page.users:
                    if user.email:
                        user_emails[user.uid] = user.email
                if not page.next_page_token:
                    break
                page = auth.list_users(app=firebase_app, max_results=1000, page_token=page.next_page_token)
            logger.info(f"[{project_id}] Fallback fetched {len(user_emails)} users from auth.")
        except Exception as e:
            logger.error(f"[{project_id}] Failed to fetch all users via fallback: {e}")

    email_list = list(user_emails.items()) # List of (uid, email) tuples
    logger.info(f"[{project_id}] Resolved {len(email_list)} emails from {len(user_ids) if user_ids else 'ALL'} UIDs")

    # --- CAMPAIGN TRACKING ---
    # create_campaign_result was already called at the start of the function.
    # calling it again here would RESET progress to 0, which is bad.
    # create_campaign_result(campaign_id, project_id, len(user_emails))
    


    def fire_email_task(item):
        uid, email = item
        # Acquire global semaphore to ensure we don't exceed server limits
        with global_semaphore:
            try:
                # logger.info(f"[{project_id}] Sending to: {email}") # Reduce logging for speed?
                pyrebase_auth.send_password_reset_email(str(email))
                update_campaign_result(campaign_id, project_id, True, user_id=uid, email=email)
                return True
            except Exception as e:
                err_str = str(e)
                # Don't log full stack trace for every failure to keep logs clean
                logger.error(f"[ERROR][{project_id}] Failed {email}: {err_str[:100]}") 
                update_campaign_result(campaign_id, project_id, False, user_id=uid, email=email, error=err_str)
                return False
    
    # Process emails in batches (or rather, just concurrently)
    successful_sends = 0
    
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        # Submit all emails for processing
        # We process 'email_list' which is now [(uid, email), ...]
        future_to_item = {executor.submit(fire_email_task, item): item for item in email_list}
        
        # Collect results as they complete
        for future in concurrent.futures.as_completed(future_to_item):
            item = future_to_item[future]
            uid, email = item
            try:
                result = future.result()
                if result:
                    successful_sends += 1
                    # Progress is already updated inside fire_email_task!
                else:
                    # Failure is already updated inside fire_email_task!
                    pass
            except Exception as e:
                logger.error(f"[ERROR][{project_id}] Exception for {email}: {e}")
                # Failure is already updated inside fire_email_task!
    
    logger.info(f"[{project_id}] Finished sending {len(email_list)} emails with {max_workers} workers. Successful: {successful_sends}")
    
    # Update daily count
    increment_daily_count(project_id)
    
    # Audit logging
    write_audit_log('admin', 'send_campaign', {
        'campaign_id': campaign_id, 
        'project_id': project_id,
        'workers': max_workers, 
        'lightning': lightning,
        'emails_sent': successful_sends,
        'total_emails': len(email_list)
    })
    
    return successful_sends


def _get_campaign(campaign_id: str):
    """Load campaign from active_campaigns memory OR file (persistence-safe)."""
    if campaign_id in active_campaigns:
        return active_campaigns[campaign_id]
    # Fallback: search in campaigns file
    all_campaigns = load_campaigns_from_file() or []
    for c in all_campaigns:
        if c.get("id") == campaign_id:
            active_campaigns[campaign_id] = c  # re-hydrate memory
            return c
    return None


@app.post("/campaigns/send")
async def send_campaign(request: Request):
    """
    ⚡ Enterprise Campaign Send Engine v5.0 — DIRECT ASYNC
    =======================================================
    TURBO    : asyncio.gather() all emails CONCURRENTLY via Firebase REST API.
               300 simultaneous connections. No Celery. No workers.
    THROTTLED: Each project runs concurrently; emails within project are
               rate-limited with asyncio.sleep(delay_ms/1000). ms-precision.
    Both modes check Redis pause/stop signal before every send.
    """
    import asyncio
    import aiohttp

    try:
        try:
            request_data = await request.json()
        except Exception:
            return {"success": False, "error": "Invalid JSON request"}

        sending_mode = request_data.get("sending_mode", "turbo")
        campaign_id  = request_data.get("campaignId", f"campaign_{int(time.time())}")

        projects_raw = request_data.get("projects")
        project_id   = request_data.get("projectId")
        user_ids_raw = request_data.get("userIds")
        if project_id and user_ids_raw:
            projects_raw = [{"projectId": project_id, "userIds": user_ids_raw}]
        if not projects_raw or not isinstance(projects_raw, list):
            return {"success": False, "error": "No projects provided"}

        logger.info(f"⚡ Campaign {campaign_id} | mode={sending_mode.upper()} | {len(projects_raw)} project(s)")

        # ── Throttle config ───────────────────────────────────────────────
        throttle_config = request_data.get("throttle_config") or {}
        delay_ms = float(throttle_config.get("delay_ms") or throttle_config.get("delayMs") or 0)
        if delay_ms <= 0 and sending_mode == "throttled":
            eps = float(throttle_config.get("emails_per_ms") or throttle_config.get("emailsPerMs") or 0)
            delay_ms = (1.0 / eps) if eps > 0 else 10.0

        # ── Redis helpers ─────────────────────────────────────────────────
        redis_url = os.getenv("REDIS_URL", "redis://localhost:6379/0")
        _r = redis.Redis.from_url(redis_url, decode_responses=True)

        def _ctrl():
            return _r.get(f"campaign:{campaign_id}:control")

        def _flush(proj_id, ok, fail):
            if ok == 0 and fail == 0:
                return
            key = f"campaign:{campaign_id}:{proj_id}:stats"
            pipe = _r.pipeline()
            pipe.hincrby(key, "processed", ok + fail)
            if ok:   pipe.hincrby(key, "successful", ok)
            if fail: pipe.hincrby(key, "failed",     fail)
            pipe.expire(key, 86400)
            pipe.execute()

        # ── UID → email resolution (sync, in thread executor) ────────────
        def _resolve(proj_id, uid_list):
            app_obj = firebase_apps.get(proj_id)
            if not app_obj:
                logger.warning(f"[{proj_id}] No firebase app initialised")
                return {}
            result = {}
            for i in range(0, len(uid_list), 100):
                chunk = uid_list[i:i+100]
                try:
                    ids = [auth.UidIdentifier(u) for u in chunk]
                    res = auth.get_users(ids, app=app_obj)
                    for u in res.users:
                        if u.email:
                            result[u.uid] = u.email
                except Exception as ex:
                    logger.warning(f"[{proj_id}] batch lookup err: {ex}")
                    for uid in chunk:
                        try:
                            u = auth.get_user(uid, app=app_obj)
                            if u.email:
                                result[u.uid] = u.email
                        except Exception:
                            pass
            return result

        # ── Async REST sender (no pyrebase, fully async) ─────────────────
        async def _send_one(session, api_key, email, proj_id):
            url = (
                "https://identitytoolkit.googleapis.com/v1/"
                f"accounts:sendOobCode?key={api_key}"
            )
            try:
                async with session.post(
                    url, json={"requestType": "PASSWORD_RESET", "email": email},
                    timeout=aiohttp.ClientTimeout(total=15)
                ) as resp:
                    return resp.status == 200
            except Exception as ex:
                logger.debug(f"[{proj_id}] send err {email}: {ex}")
                return False

        # ── Build project metadata + resolve emails in parallel ──────────
        loop = asyncio.get_event_loop()
        proj_meta = {}
        for proj in projects_raw:
            p_id = str(proj.get("projectId", ""))
            u_ids = proj.get("userIds", [])
            if not u_ids or not p_id:
                continue
            info = projects.get(p_id) or {}
            api_key = (info.get("apiKey") or info.get("api_key") or
                       proj.get("apiKey") or proj.get("api_key") or "")
            proj_meta[p_id] = {"api_key": api_key, "uid_list": u_ids}

        if not proj_meta:
            return {"success": False, "error": "No valid projects found"}

        # Resolve UIDs for all projects concurrently
        resolve_coros = {
            p_id: loop.run_in_executor(None, _resolve, p_id, meta["uid_list"])
            for p_id, meta in proj_meta.items()
        }
        resolved = {}
        for p_id, coro in resolve_coros.items():
            uid_email = await coro
            resolved[p_id] = [(uid, email) for uid, email in uid_email.items()]
            unresolved = len(proj_meta[p_id]["uid_list"]) - len(resolved[p_id])
            if unresolved:
                _flush(p_id, 0, unresolved)
            logger.info(f"[{p_id}] Resolved {len(resolved[p_id])}/{len(proj_meta[p_id]['uid_list'])} emails")

        total_users = sum(len(v) for v in resolved.values())
        if total_users == 0:
            return {"success": False, "error": "No emails resolved from UIDs"}

        # ==================================================================
        # TURBO: all emails for all projects fired simultaneously
        # ==================================================================
        if sending_mode == "turbo":
            logger.info(f"🚀 [TURBO] {total_users} emails → all concurrent")
            sem = asyncio.Semaphore(300)
            stats = {p: [0, 0] for p in resolved}  # [ok, fail]

            async def _do_turbo(proj_id, uid, email, api_key, session):
                sig = _ctrl()
                if sig == "stop":
                    return
                while sig == "pause":
                    await asyncio.sleep(0.5)
                    sig = _ctrl()
                if sig == "stop":
                    return
                async with sem:
                    ok = await _send_one(session, api_key, email, proj_id)
                s = stats[proj_id]
                if ok:
                    s[0] += 1
                else:
                    s[1] += 1
                if (s[0]+s[1]) % 25 == 0:
                    _flush(proj_id, s[0], s[1])
                    stats[proj_id] = [0, 0]

            connector = aiohttp.TCPConnector(limit=300, limit_per_host=100)
            async with aiohttp.ClientSession(connector=connector) as session:
                coros = []
                for p_id, pairs in resolved.items():
                    api_key = proj_meta[p_id]["api_key"]
                    for uid, email in pairs:
                        coros.append(_do_turbo(p_id, uid, email, api_key, session))
                await asyncio.gather(*coros, return_exceptions=True)

            for p_id in stats:
                _flush(p_id, stats[p_id][0], stats[p_id][1])

            grand_ok   = sum(int(_r.hget(f"campaign:{campaign_id}:{p}:stats", "successful") or 0) for p in resolved)
            grand_fail = sum(int(_r.hget(f"campaign:{campaign_id}:{p}:stats", "failed")     or 0) for p in resolved)

            if campaign_id in active_campaigns:
                active_campaigns[campaign_id].update({
                    "status": "completed", "processed": total_users,
                    "successful": grand_ok, "failed": grand_fail,
                    "completedAt": datetime.now().isoformat()
                })
                save_campaigns_to_file()

            return {
                "success": True, "mode": "turbo", "campaignId": campaign_id,
                "total": total_users, "successful": grand_ok, "failed": grand_fail,
                "message": f"Turbo done: {grand_ok} sent, {grand_fail} failed out of {total_users}"
            }

        # ==================================================================
        # THROTTLED: rate-paced concurrent dispatch
        # Launch each email as a task every delay_ms — they execute in
        # parallel. Firebase round-trip latency does NOT limit throughput.
        # Rate = 1000 / delay_ms  emails/sec (true ms-precision).
        # ==================================================================
        elif sending_mode == "throttled":
            delay_s = delay_ms / 1000.0 if delay_ms > 0 else 0.01
            # Cap concurrent in-flight requests to avoid memory explosion
            # at very high rates (e.g. 1ms = 1000/sec × 300ms latency = 300 in-flight)
            max_inflight = max(1, int(min(500, (0.3 / delay_s) + 10)))
            sem_t = asyncio.Semaphore(max_inflight)

            logger.info(
                f"⚙️ [THROTTLE] target={1.0/delay_s:.1f}/sec "
                f"delay={delay_ms}ms max_inflight={max_inflight} | {len(resolved)} project(s)"
            )

            # outcome tracking per project
            proj_stats = {p: [0, 0] for p in resolved}

            async def _one_email(proj_id, email, api_key, session):
                async with sem_t:
                    ok = await _send_one(session, api_key, email, proj_id)
                s = proj_stats[proj_id]
                if ok:
                    s[0] += 1
                else:
                    s[1] += 1
                if (s[0] + s[1]) % 25 == 0:
                    _flush(proj_id, s[0], s[1])
                    proj_stats[proj_id] = [0, 0]

            async def _launch_project(proj_id, pairs, api_key, session):
                """Launch emails at delay_ms intervals; all run concurrently."""
                tasks = []
                for uid, email in pairs:
                    sig = _ctrl()
                    if sig == "stop":
                        break
                    while sig == "pause":
                        await asyncio.sleep(0.5)
                        sig = _ctrl()
                    if sig == "stop":
                        break
                    tasks.append(asyncio.create_task(
                        _one_email(proj_id, email, api_key, session)
                    ))
                    await asyncio.sleep(delay_s)   # ← controls LAUNCH RATE only
                # Wait for all in-flight tasks to finish
                if tasks:
                    await asyncio.gather(*tasks, return_exceptions=True)
                # Flush remainder
                s = proj_stats[proj_id]
                if s[0] or s[1]:
                    _flush(proj_id, s[0], s[1])

            connector = aiohttp.TCPConnector(limit=max_inflight + 50, limit_per_host=max_inflight)
            async with aiohttp.ClientSession(connector=connector) as session:
                # All projects launch in parallel
                await asyncio.gather(*[
                    _launch_project(p_id, pairs, proj_meta[p_id]["api_key"], session)
                    for p_id, pairs in resolved.items()
                ], return_exceptions=True)

            if campaign_id in active_campaigns:
                active_campaigns[campaign_id]["status"] = "completed"
                active_campaigns[campaign_id]["completedAt"] = datetime.now().isoformat()
                save_campaigns_to_file()

            return {
                "success": True, "mode": "throttled", "campaignId": campaign_id,
                "rate": f"{1.0/delay_s:.1f} emails/sec", "total": total_users,
                "message": f"Throttled send complete at {1.0/delay_s:.1f}/sec"
            }

        # ==================================================================
        # SCHEDULED — store in Redis, fire via APScheduler
        # ==================================================================
        elif sending_mode == "scheduled":
            schedule_config = request_data.get("schedule_config", {})
            scheduled_datetime_str = schedule_config.get("scheduled_datetime")
            execution_mode = schedule_config.get("execution_mode", "turbo")
            if not scheduled_datetime_str:
                return {"success": False, "error": "No scheduled_datetime provided"}
            try:
                scheduled_dt = datetime.fromisoformat(scheduled_datetime_str.replace("Z", "+00:00"))
            except Exception as e:
                return {"success": False, "error": f"Invalid datetime: {e}"}
            if scheduled_dt <= datetime.now(timezone.utc):
                return {"success": False, "error": "Scheduled time must be in the future"}

            _r.set(
                f"scheduled_campaign:{campaign_id}",
                json.dumps({
                    "campaign_id": campaign_id, "projects": projects_raw,
                    "execution_mode": execution_mode, "throttle_config": throttle_config,
                    "batch_size": request_data.get("batchSize", 100),
                    "scheduled_datetime": scheduled_datetime_str,
                    "created_at": datetime.now().isoformat()
                }),
                ex=int((scheduled_dt - datetime.now(timezone.utc)).total_seconds()) + 3600
            )
            if SCHEDULER_AVAILABLE:
                scheduler = get_scheduler()
                try:
                    from src.utils.celery_tasks import execute_scheduled_campaign
                except ImportError:
                    from celery_tasks import execute_scheduled_campaign
                scheduler.add_job(
                    execute_scheduled_campaign.delay,
                    DateTrigger(run_date=scheduled_dt),
                    args=[campaign_id], id=f"campaign_{campaign_id}", replace_existing=True
                )
            if campaign_id in active_campaigns:
                active_campaigns[campaign_id]["status"] = "scheduled"
                active_campaigns[campaign_id]["scheduledAt"] = scheduled_datetime_str
                save_campaigns_to_file()
            return {
                "success": True, "mode": "scheduled", "campaign_id": campaign_id,
                "scheduled_datetime": scheduled_datetime_str,
                "message": f"Scheduled for {scheduled_dt}"
            }

        else:
            return {"success": False, "error": f"Invalid sending_mode: {sending_mode}"}

    except Exception as e:
        logger.error(f"send_campaign failed: {e}")
        return {"success": False, "error": str(e)}


@app.post("/campaigns/{campaign_id}/pause")
async def pause_campaign(campaign_id: str, request: Request):
    """Pause a running campaign — Celery workers will stop and wait."""
    try:
        campaign = _get_campaign(campaign_id)
        if not campaign:
            raise HTTPException(status_code=404, detail="Campaign not found")
        r = _get_ctrl_redis()
        r.set(f"campaign:{campaign_id}:control", "pause", ex=86400)
        campaign["status"] = "paused"
        active_campaigns[campaign_id] = campaign
        save_campaigns_to_file()
        logger.info(f"⏸️ Campaign {campaign_id} paused")
        return {"success": True, "status": "paused", "campaign_id": campaign_id}
    except Exception as e:
        logger.error(f"Pause campaign {campaign_id} failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/campaigns/{campaign_id}/resume")
async def resume_campaign(campaign_id: str, request: Request):
    """Resume a paused campaign — Celery workers will continue sending."""
    try:
        campaign = _get_campaign(campaign_id)
        if not campaign:
            raise HTTPException(status_code=404, detail="Campaign not found")
        r = _get_ctrl_redis()
        r.delete(f"campaign:{campaign_id}:control")
        campaign["status"] = "running"
        active_campaigns[campaign_id] = campaign
        save_campaigns_to_file()
        logger.info(f"▶️ Campaign {campaign_id} resumed")
        return {"success": True, "status": "running", "campaign_id": campaign_id}
    except Exception as e:
        logger.error(f"Resume campaign {campaign_id} failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/campaigns/{campaign_id}/stop")
async def stop_campaign(campaign_id: str, request: Request):
    """Stop a campaign permanently — Celery workers will abort immediately."""
    try:
        campaign = _get_campaign(campaign_id)
        if not campaign:
            raise HTTPException(status_code=404, detail="Campaign not found")
        r = _get_ctrl_redis()
        r.set(f"campaign:{campaign_id}:control", "stop", ex=86400)
        campaign["status"] = "stopped"
        active_campaigns[campaign_id] = campaign
        save_campaigns_to_file()
        logger.info(f"⏹️ Campaign {campaign_id} stopped")
        return {"success": True, "status": "stopped", "campaign_id": campaign_id}
    except Exception as e:
        logger.error(f"Stop campaign {campaign_id} failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/test-reset-email")
async def test_reset_email(request: Request):
    data = await request.json()
    email = data.get("email")
    project_id = data.get("project_id")
    
    logger.info(f"Test reset email request: email={email}, project_id={project_id}")
    
    if not email or not project_id:
        return {"success": False, "error": "Missing email or project_id"}
    
    if project_id not in pyrebase_apps:
        logger.error(f"Project {project_id} not found in pyrebase_apps")
        return {"success": False, "error": "Project not initialized"}
    
    if project_id not in firebase_apps:
        logger.error(f"Project {project_id} not found in firebase_apps")
        return {"success": False, "error": "Firebase Admin not initialized for this project"}
    
    firebase = pyrebase_apps[project_id]
    auth_client = firebase.auth()
    admin_auth = firebase_apps[project_id]
    
    created_user_uid = None
    user_deleted = False
    
    try:
        logger.info(f"Starting test email process for {email} in project {project_id}")
        
        # Generate random password
        an = random.randint(50, 9215)
        password = f'r{an}ompa{an}ordmf'
        
        # Create user with Firebase Auth
        logger.info(f"Creating test user: {email}")
        user = auth_client.create_user_with_email_and_password(email, password)
        created_user_uid = user['localId']
        
        logger.info(f"Test user created: {email} with UID: {created_user_uid}")
        
        # Send password reset email
        logger.info(f"Sending password reset email to: {email}")
        auth_client.send_password_reset_email(email)
        
        logger.info(f"Password reset email sent successfully to: {email}")
        
        # Wait a moment for the email to be sent
        await asyncio.sleep(2)
        
        # Force delete the test user using Firebase Admin SDK
        logger.info(f"Deleting test user: {email} with UID: {created_user_uid}")
        try:
            auth.delete_user(created_user_uid, app=admin_auth)
            logger.info(f"Test user deleted successfully: {email} with UID: {created_user_uid}")
            user_deleted = True
        except Exception as delete_error:
            logger.error(f"Failed to delete test user {created_user_uid}: {delete_error}")
            
            # Try alternative deletion method
            try:
                logger.info(f"Trying alternative deletion by email: {email}")
                user_record = auth.get_user_by_email(email, app=admin_auth)
                auth.delete_user(user_record.uid, app=admin_auth)
                logger.info(f"Test user deleted by email: {email}")
                user_deleted = True
            except Exception as alt_delete_error:
                logger.error(f"Alternative deletion also failed: {alt_delete_error}")
                user_deleted = False
        
        logger.info(f"Test email process completed: email={email}, user_deleted={user_deleted}")
        
        return {
            "success": True, 
            "message": f"Test email sent to {email} and test user {'deleted' if user_deleted else 'deletion failed'}",
            "user_created": True,
            "user_deleted": user_deleted
        }
        
    except Exception as e:
        logger.error(f"Test reset email failed: {str(e)}")
        
        # Cleanup: Try to delete the user if it was created
        if created_user_uid:
            logger.info(f"Attempting cleanup for created user: {created_user_uid}")
            try:
                auth.delete_user(created_user_uid, app=admin_auth)
                logger.info(f"Cleanup: Test user {created_user_uid} deleted after error")
                cleanup_success = True
            except Exception as cleanup_error:
                logger.error(f"Cleanup failed: {str(cleanup_error)}")
                cleanup_success = False
                
                # Try alternative cleanup
                try:
                    logger.info(f"Trying alternative cleanup for: {email}")
                    user_record = auth.get_user_by_email(email, app=admin_auth)
                    auth.delete_user(user_record.uid, app=admin_auth)
                    logger.info(f"Alternative cleanup successful for {email}")
                    cleanup_success = True
                except Exception as alt_cleanup_error:
                    logger.error(f"Alternative cleanup also failed: {alt_cleanup_error}")
                    cleanup_success = False
        else:
            cleanup_success = False
        
        return {
            "success": False, 
            "error": str(e),
            "user_created": bool(created_user_uid),
            "user_deleted": cleanup_success
        }

@app.post("/gemini")
async def gemini_api(request: Request):
    data = await request.json()
    prompt = data.get("prompt")
    # Dummy response for now
    return {"response": f"Gemini API would respond to: {prompt}"}

@app.post("/test-smtp")
async def test_smtp(request: Request):
    """Simple SMTP test endpoint"""
    try:
        smtp_settings = load_smtp_settings()
        logger.info(f"SMTP Settings loaded: {smtp_settings}")
        
        if not smtp_settings.get('host'):
            return {"success": False, "message": "SMTP host not configured", "settings": smtp_settings}
        
        return {"success": True, "message": "SMTP settings loaded", "settings": smtp_settings}
        
    except Exception as e:
        logger.error(f"Error testing SMTP: {e}")
        return {"success": False, "message": f"Error: {str(e)}"}

@app.post("/projects/{project_id}/reconnect")
async def reconnect_project(project_id: str):
    try:
        project = projects.get(project_id)
        if not project:
            return {"success": False, "error": "Project not found"}
        # Remove existing app if present
        if project_id in firebase_apps:
            try:
                firebase_admin.delete_app(firebase_apps[project_id])
            except Exception as e:
                logger.warning(f"Error removing old Firebase app: {e}")
            del firebase_apps[project_id]
        # Re-initialize Firebase Admin SDK
        cred = credentials.Certificate(project['serviceAccount'])
        firebase_app = firebase_admin.initialize_app(cred, name=project_id)
        firebase_apps[project_id] = firebase_app
        # Re-initialize Pyrebase with custom authDomain if available
        auth_domain = project.get('authDomain', f"{project_id}.firebaseapp.com")
        pyrebase_config = {
            "apiKey": project['apiKey'],
            "authDomain": auth_domain,
            "databaseURL": f"https://{project_id}-default-rtdb.firebaseio.com",
            "storageBucket": f"{project_id}.appspot.com",
        }
        pyrebase_app = pyrebase.initialize_app(pyrebase_config)
        pyrebase_apps[project_id] = pyrebase_app
        logger.info(f"Project {project_id} reconnected successfully")
        return {"success": True, "project_id": project_id}
    except Exception as e:
        logger.error(f"Failed to reconnect project {project_id}: {str(e)}")
        return {"success": False, "error": str(e)}

@app.get("/projects/analytics")
def get_projects_analytics():
    today = date.today().isoformat()
    analytics = {}
    # Aggregate total and today counts
    for key, count_data in daily_counts.items():
        project_id = count_data["project_id"]
        analytics.setdefault(project_id, {"total_sent": 0, "sent_today": 0, "campaigns": 0})
        analytics[project_id]["total_sent"] += count_data["sent"]
        if count_data["date"] == today:
            analytics[project_id]["sent_today"] += count_data["sent"]
    # Count campaigns per project
    for campaign in active_campaigns.values():
        for pid in campaign.get("projectIds", []):
            analytics.setdefault(pid, {"total_sent": 0, "sent_today": 0, "campaigns": 0})
            analytics[pid]["campaigns"] += 1
    return analytics

@app.post("/users/move")
async def move_users(data: dict = Body(...)):
    user = data.get('user', 'admin')
    try:
        source = data.get('source_project')
        target = data.get('target_project')
        user_ids = data.get('user_ids', [])
        if not source or not target or not user_ids:
            return {"success": False, "error": "Missing source, target, or user_ids"}
        if source not in firebase_apps or target not in firebase_apps:
            return {"success": False, "error": "Invalid project(s)"}
        admin_src = firebase_apps[source]
        admin_tgt = firebase_apps[target]
        pyrebase_tgt = pyrebase_apps[target]
        auth_src = auth
        auth_tgt = pyrebase_tgt.auth()
        moved = 0
        for uid in user_ids:
            try:
                user = auth.get_user(uid, app=admin_src)
                email = user.email
                if not email:
                    continue
                # Remove from source
                auth.delete_user(uid, app=admin_src)
                # Add to target
                password = 'TempPass123!@#'  # You may want to generate a random password
                user_tgt = auth_tgt.create_user_with_email_and_password(email, password)
                moved += 1
            except Exception as e:
                continue
        write_audit_log(user, 'move_users', {'from_project': data.get('from_project'), 'to_project': data.get('to_project'), 'userIds': data.get('userIds')})
        asyncio.create_task(notify_ws('move_users', {'from_project': data.get('from_project'), 'to_project': data.get('to_project'), 'userIds': data.get('userIds'), 'user': user}))
        return {"success": True, "moved": moved}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to move users: {str(e)}")

@app.post("/users/copy")
async def copy_users(data: dict = Body(...)):
    user = data.get('user', 'admin')
    try:
        source = data.get('source_project')
        targets = data.get('target_projects', [])
        user_ids = data.get('user_ids', [])
        if not source or not targets or not user_ids:
            return {"success": False, "error": "Missing source, targets, or user_ids"}
        if source not in firebase_apps:
            return {"success": False, "error": "Invalid source project"}
        admin_src = firebase_apps[source]
        users_to_copy = []
        for uid in user_ids:
            try:
                user = auth.get_user(uid, app=admin_src)
                email = user.email
                if email:
                    users_to_copy.append(email)
            except Exception as e:
                continue
        copied = 0
        for tgt in targets:
            if tgt not in pyrebase_apps:
                continue
            pyrebase_tgt = pyrebase_apps[tgt]
            auth_tgt = pyrebase_tgt.auth()
            for email in users_to_copy:
                try:
                    password = 'TempPass123!@#'  # You may want to generate a random password
                    auth_tgt.create_user_with_email_and_password(email, password)
                    copied += 1
                except Exception as e:
                    continue
        write_audit_log(user, 'copy_users', {'from_project': data.get('from_project'), 'to_project': data.get('to_project'), 'userIds': data.get('userIds')})
        asyncio.create_task(notify_ws('copy_users', {'from_project': data.get('from_project'), 'to_project': data.get('to_project'), 'userIds': data.get('userIds'), 'user': user}))
        return {"success": True, "copied": copied}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to copy users: {str(e)}")


# New: Campaign management functions
def save_campaign_results_to_file():
    """Save campaign results dictionary to campaign_results.json file"""
    try:
        with open(CAMPAIGN_RESULTS_FILE, 'w') as f:
            json.dump(campaign_results, f, indent=2)
        logger.info(f"Saved {len(campaign_results)} campaign results to {CAMPAIGN_RESULTS_FILE}")
    except Exception as e:
        logger.error(f"Failed to save campaign results to file: {e}")

def create_campaign_result(campaign_id: str, project_id: str, total_users: int):
    """Create a new campaign result entry"""
    with results_lock:
        result = {
            "campaign_id": str(campaign_id) if campaign_id is not None else '',
            "project_id": str(project_id) if project_id is not None else '',
            "total_users": total_users,
            "successful": 0,
            "failed": 0,
            "errors": [],
            "start_time": datetime.now().isoformat(),
            "end_time": None,
            "status": "running"
        }
        key = f"{campaign_id}_{project_id}"
        campaign_results[key] = result
        save_campaign_results_to_file()
        return result

def update_campaign_result(campaign_id: str, project_id: str, success: bool, user_id: Optional[str] = None, email: Optional[str] = None, error: Optional[str] = None):
    """Update campaign result with success/failure"""
    with results_lock:
        campaign_id = str(campaign_id) if campaign_id is not None else ''
        project_id = str(project_id) if project_id is not None else ''
        user_id = str(user_id) if user_id is not None else ''
        email = str(email) if email is not None else ''
        error = str(error) if error is not None else ''
        key = f"{campaign_id}_{project_id}"
        
        # Initialize if missing (safety)
        if key not in campaign_results:
             create_campaign_result(campaign_id, project_id, 0)
             
        if success:
            campaign_results[key]["successful"] += 1
        else:
            campaign_results[key]["failed"] += 1
            if error and user_id:
                campaign_results[key]["errors"].append({
                    "user_id": user_id,
                    "email": email,
                    "error": error,
                    "timestamp": datetime.now().isoformat()
                })
        # Update status if all users processed
        total = campaign_results[key]["total_users"]
        # Safety check for total=0 to avoid division by zero or premature completion if total wasn't set correctly
        if total > 0:
            processed = campaign_results[key]["successful"] + campaign_results[key]["failed"]
            if processed >= total:
                campaign_results[key]["end_time"] = datetime.now().isoformat()
                campaign_results[key]["status"] = "completed" if campaign_results[key]["failed"] == 0 else "partial"
        
        save_campaign_results_to_file()
        
        # CRITICAL FIX: Also update the campaign object itself with progress data for frontend display
        try:
            # Update in-memory active_campaigns immediately to prevent overwrite by status updates
            if campaign_id in active_campaigns:
                active_campaigns[campaign_id]['processed'] = campaign_results[key]["successful"] + campaign_results[key]["failed"]
                active_campaigns[campaign_id]['successful'] = campaign_results[key]["successful"]
                active_campaigns[campaign_id]['failed'] = campaign_results[key]["failed"]
    
            if os.getenv('USE_DATABASE') == 'true':
                # Database mode: Update campaign in DB
                conn = get_db_connection()
                cursor = conn.cursor()
                cursor.execute("""
                    UPDATE campaigns 
                SET processed = %s, successful = %s, failed = %s 
                WHERE id = %s
            """, (processed, campaign_results[key]["successful"], campaign_results[key]["failed"], campaign_id))
                conn.commit()
                cursor.close()
                conn.close()
            else:
                # File mode: Update campaign in CAMPAIGNS_FILE
                logger.info(f"Attempting to update campaign {campaign_id} in {CAMPAIGNS_FILE}")
                logger.info(f"campaign_results[{key}] = {campaign_results.get(key, 'KEY NOT FOUND!')}")
                logger.info(f"Progress data: processed={processed}, successful={campaign_results[key]['successful']}, failed={campaign_results[key]['failed']}")
                if os.path.exists(CAMPAIGNS_FILE):
                    with open(CAMPAIGNS_FILE, 'r') as f:
                        campaigns_data = json.load(f)
                    
                    campaign_found = False
                    for campaign in campaigns_data:
                        if campaign.get('id') == campaign_id:
                            logger.info(f"Found campaign {campaign_id}, updating progress fields")
                            campaign['processed'] = processed
                            campaign['successful'] = campaign_results[key]["successful"]
                            campaign['failed'] = campaign_results[key]["failed"]
                            campaign_found = True
                            break
                    
                    if campaign_found:
                        with open(CAMPAIGNS_FILE, 'w') as f:
                            json.dump(campaigns_data, f, indent=2)
                        logger.info(f"Successfully updated campaign {campaign_id} in campaigns.json")
                    else:
                        logger.warning(f"Campaign {campaign_id} NOT found in campaigns.json!")
                else:
                    logger.error(f"CAMPAIGNS_FILE {CAMPAIGNS_FILE} does not exist!")
        except Exception as e:
            logger.error(f"Failed to update campaign progress in storage: {e}")

def get_campaign_results(campaign_id: Optional[str] = None, project_id: Optional[str] = None):
    """Get campaign results, optionally filtered"""
    campaign_id = str(campaign_id) if campaign_id is not None else ''
    project_id = str(project_id) if project_id is not None else ''
    if campaign_id and project_id:
        key = f"{campaign_id}_{project_id}"
        return campaign_results.get(key)
    elif campaign_id:
        return {k: v for k, v in campaign_results.items() if k.startswith(f"{campaign_id}_")}
    else:
        return campaign_results

@app.get("/campaigns/{campaign_id}/results")
async def get_campaign_results_endpoint(campaign_id: str, project_id: Optional[str] = None):
    """Get detailed results for a specific campaign"""
    try:
        campaign_id = str(campaign_id) if campaign_id is not None else ''
        project_id = str(project_id) if project_id is not None else ''
        results = get_campaign_results(campaign_id, project_id)
        if not results:
            return {"success": False, "error": "Campaign not found"}
        return {"success": True, "results": results}
    except Exception as e:
        logger.error(f"Error getting campaign results: {str(e)}")
        return {"success": False, "error": str(e)}

@app.get("/campaigns/results/all")
async def get_all_campaign_results():
    """Get all campaign results"""
    try:
        return {"success": True, "results": campaign_results}
    except Exception as e:
        logger.error(f"Error getting all campaign results: {str(e)}")
        return {"success": False, "error": str(e)}

@app.post("/campaigns/{campaign_id}/retry")
async def retry_failed_campaign(campaign_id: str, request: dict):
    """Retry failed emails from a campaign"""
    try:
        campaign_id = str(campaign_id) if campaign_id is not None else ''
        project_id = str(request.get('projectId')) if request.get('projectId') is not None else ''
        if not project_id:
            return {"success": False, "error": "Project ID required"}
        # Get campaign results
        campaign_result = get_campaign_results(campaign_id, project_id)
        if not campaign_result:
            return {"success": False, "error": "Campaign not found"}
        # Get failed emails
        failed_emails = campaign_result.get("errors", [])
        if not failed_emails:
            return {"success": False, "error": "No failed emails to retry"}
        # Extract user IDs and emails for retry
        retry_users = []
        for error in failed_emails:
            email_val = error.get("email")
            user_id_val = error.get("user_id")
            if email_val:
                retry_users.append({
                    "user_id": str(user_id_val) if user_id_val is not None else '',
                    "email": str(email_val) if email_val is not None else ''
                })
        if not retry_users:
            return {"success": False, "error": "No valid emails to retry"}
        # Create new retry campaign
        retry_campaign_id = f"{campaign_id}_retry_{int(time.time())}"
        # Call lightning send batch for retry
        retry_request = {
            "projectId": project_id,
            "userIds": [user["user_id"] for user in retry_users if user["user_id"]],
            "lightning": True,
            "campaignId": retry_campaign_id
        }
        # This would normally call the lightning endpoint, but for now return the retry data
        return {
            "success": True,
            "retry_campaign_id": retry_campaign_id,
            "retry_users": retry_users,
            "message": f"Retry campaign created for {len(retry_users)} failed emails"
        }
    except Exception as e:
        logger.error(f"Error retrying campaign: {str(e)}")
        return {"success": False, "error": str(e)}

@app.get("/campaigns/{campaign_id}/export")
async def export_campaign_results(campaign_id: str, format: str = "json"):
    """Export campaign results in various formats"""
    try:
        campaign_id = str(campaign_id) if campaign_id is not None else ''
        results = get_campaign_results(campaign_id)
        if not results:
            return {"success": False, "error": "Campaign not found"}
        if format.lower() == "csv":
            # Convert to CSV format
            csv_data = []
            for key, result in results.items():
                project_id = str(result.get("project_id", "") or "")
                total = result.get("total_users", 0)
                successful = result.get("successful", 0)
                failed = result.get("failed", 0)
                status = str(result.get("status", "") or "")
                start_time = str(result.get("start_time", "") or "")
                end_time = str(result.get("end_time", "") or "")
                csv_data.append(f"{campaign_id},{project_id},{total},{successful},{failed},{status},{start_time},{end_time}")
            csv_header = "campaign_id,project_id,total_users,successful,failed,status,start_time,end_time\n"
            csv_content = csv_header + "\n".join(csv_data)
            return {
                "success": True,
                "format": "csv",
                "data": csv_content,
                "filename": f"campaign_{campaign_id}_results.csv"
            }
        else:
            # Default JSON format
            return {
                "success": True,
                "format": "json",
                "data": results,
                "filename": f"campaign_{campaign_id}_results.json"
            }
    except Exception as e:
        logger.error(f"Error exporting campaign results: {str(e)}")
        return {"success": False, "error": str(e)}

@app.get("/campaigns/analytics/summary")
async def get_campaign_analytics():
    """Get overall campaign analytics"""
    try:
        total_campaigns = len(set([k.split('_')[0] for k in campaign_results.keys()]))
        total_projects = len(set([v.get('project_id') for v in campaign_results.values()]))
        
        # Calculate totals
        total_users = sum([v.get('total_users', 0) for v in campaign_results.values()])
        total_successful = sum([v.get('successful', 0) for v in campaign_results.values()])
        total_failed = sum([v.get('failed', 0) for v in campaign_results.values()])
        
        # Calculate success rate
        success_rate = (total_successful / total_users * 100) if total_users > 0 else 0
        
        # Get recent campaigns (last 7 days)
        week_ago = datetime.now() - timedelta(days=7)
        recent_campaigns = [
            v for v in campaign_results.values() 
            if datetime.fromisoformat(v.get('start_time', '1970-01-01')) > week_ago
        ]
        
        return {
            "success": True,
            "analytics": {
                "total_campaigns": total_campaigns,
                "total_projects": total_projects,
                "total_users": total_users,
                "total_successful": total_successful,
                "total_failed": total_failed,
                "success_rate": round(success_rate, 2),
                "recent_campaigns": len(recent_campaigns)
            }
        }
        
    except Exception as e:
        logger.error(f"Error getting campaign analytics: {str(e)}")
        return {"success": False, "error": str(e)}

class ResetTemplateUpdate(BaseModel):
    senderName: Optional[str] = None
    fromAddress: Optional[str] = None
    replyTo: Optional[str] = None
    subject: Optional[str] = None
    body: Optional[str] = None
    project_id: str
    user: Optional[str] = None

class BulkResetTemplateUpdate(BaseModel):
    senderName: Optional[str] = None
    fromAddress: Optional[str] = None
    replyTo: Optional[str] = None
    subject: Optional[str] = None
    body: Optional[str] = None
    authDomain: Optional[str] = None  # Add domain field
    project_ids: List[str]
    user: Optional[str] = None

@app.post("/update-reset-template")
async def update_reset_template(data: ResetTemplateUpdate, request: Request):
    """Update reset password template for a single project"""
    try:
        logger.info(f"Template update request received for project {data.project_id}")
        logger.info(f"Body length: {len(data.body) if data.body else 0} characters")
        return await _update_reset_template_internal(data.senderName, data.fromAddress, data.replyTo, data.subject, data.body, None, [data.project_id], data.user)
    except Exception as e:
        logger.error(f"Template update failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Template update failed: {str(e)}")

@app.post("/update-reset-template-bulk")
async def update_reset_template_bulk(data: BulkResetTemplateUpdate, request: Request):
    """Update reset password template for multiple projects in parallel"""
    try:
        logger.info(f"Bulk template update request received for {len(data.project_ids)} projects")
        logger.info(f"Body length: {len(data.body) if data.body else 0} characters")
        return await _update_reset_template_internal(data.senderName, data.fromAddress, data.replyTo, data.subject, data.body, data.authDomain, data.project_ids, data.user)
    except Exception as e:
        logger.error(f"Bulk template update failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Bulk template update failed: {str(e)}")

async def _update_reset_template_internal(senderName: Optional[str] = None, fromAddress: Optional[str] = None, replyTo: Optional[str] = None, subject: Optional[str] = None, body: Optional[str] = None, authDomain: Optional[str] = None, project_ids: List[str] = [], user: Optional[str] = None):
    # Sanitize and build payload only with provided fields
    def build_payload():
        template = {}
        if senderName is not None:
            if not isinstance(senderName, str) or len(senderName) > 100000:
                raise HTTPException(status_code=400, detail="Invalid senderName - too long")
            template["senderDisplayName"] = senderName
        if fromAddress is not None:
            if not isinstance(fromAddress, str) or len(fromAddress) > 100000:
                raise HTTPException(status_code=400, detail="Invalid fromAddress - too long")
            template["senderLocalPart"] = fromAddress
        if replyTo is not None:
            if not isinstance(replyTo, str) or len(replyTo) > 100000:
                raise HTTPException(status_code=400, detail="Invalid replyTo - too long")
            template["replyTo"] = replyTo
        if subject is not None:
            if not isinstance(subject, str) or len(subject) > 100000:
                raise HTTPException(status_code=400, detail="Invalid subject - too long")
            template["subject"] = subject
        if body is not None:
            if not isinstance(body, str) or len(body) > 1000000:  # Increased to 1MB for large HTML templates
                raise HTTPException(status_code=400, detail="Invalid body - too long (max 1MB)")
            template["body"] = body
        return template

    results = []
    template_patch = build_payload()
    if not template_patch:
        return {"success": False, "error": "No fields to update"}

    async def update_single_project(project_id: str):
        try:
            logger.info(f"Updating template for project: {project_id}")
            project = projects.get(project_id)
            if not project:
                logger.error(f"Project not found: {project_id}")
                return {"project_id": project_id, "success": False, "error": "Project not found"}
            
            service_account_info = project['serviceAccount']
            if not service_account_info:
                return {"project_id": project_id, "success": False, "error": "Service account missing"}
            credentials = service_account.Credentials.from_service_account_info(
                service_account_info,
                scopes=["https://www.googleapis.com/auth/cloud-platform"]
            )
            authed_session = AuthorizedSession(credentials)
            
            # Update reset password template
            if template_patch:
                # 1. Fetch current config to merge template fields (avoiding destructive overwrite)
                config_url = f"https://identitytoolkit.googleapis.com/v2/projects/{project_id}/config"
                config_resp = authed_session.get(config_url)
                
                merged_template = template_patch
                if config_resp.ok:
                    current_config = config_resp.json()
                    existing_template = current_config.get('notification', {}).get('sendEmail', {}).get('resetPasswordTemplate', {})
                    if existing_template:
                        merged_template = {**existing_template, **template_patch}
                        logger.info(f"Merged existing template fields for project {project_id}")
                
                # 2. Patch with merged template
                url = f"https://identitytoolkit.googleapis.com/v2/projects/{project_id}/config?updateMask=notification.sendEmail.resetPasswordTemplate"
                payload = {
                    "notification": {
                        "sendEmail": {
                            "resetPasswordTemplate": merged_template
                        }
                    }
                }
                logger.info(f"Sending merged template update to Firebase API for project {project_id}")
                response = authed_session.patch(url, json=payload)
                if not response.ok:
                    error_text = response.text
                    logger.error(f"Firebase API error for project {project_id}: {response.status_code} - {error_text}")
                    return {"project_id": project_id, "success": False, "error": f"Firebase API error: {response.status_code} - {error_text}"}
                response.raise_for_status()
                logger.info(f"Reset template updated for project {project_id} by {user or 'unknown'}")
            
            # Update domain configuration if provided (using our non-destructive helper)
            if authDomain and authDomain.strip():
                logger.info(f"Adding auth domain {authDomain.strip()} to project {project_id}")
                domain_results = await update_firebase_projects_domain(authDomain.strip(), [project_id])
                if not domain_results.get(project_id, {}).get('success'):
                    logger.warning(f"Domain addition result for {project_id}: {domain_results.get(project_id)}")
                
                # SMTP configuration removed as per user request
                # We only update the dnsConfig via update_firebase_projects_domain above
                pass
                
                logger.info(f"Updated auth domain for project {project_id} to {authDomain.strip()}")
                write_audit_log(user, "update_domain", {
                    "project_id": project_id,
                    "old_domain": f"{project_id}.firebaseapp.com",
                    "new_domain": authDomain.strip()
                })
            
            write_audit_log(user, 'update_template', {'project_ids': project_ids, 'fields_updated': list(template_patch.keys()) if template_patch else []})
            asyncio.create_task(notify_ws('template_update', {'project_id': project_id, 'fields_updated': list(template_patch.keys()) if template_patch else [], 'user': user}))
            return {"project_id": project_id, "success": True, "message": "Reset password template and domain updated."}
        except Exception as e:
            logger.error(f"Failed to update reset template for project {project_id}: {e}")
            return {"project_id": project_id, "success": False, "error": str(e)}

    update_tasks = [update_single_project(project_id) for project_id in project_ids]
    results = await asyncio.gather(*update_tasks)
    successful = [r for r in results if r["success"]]
    failed = [r for r in results if not r["success"]]
    
    # Save projects if any domain was updated
    if authDomain and authDomain.strip() and len(successful) > 0:
        save_projects_to_file()
    
    return {
        "success": len(failed) == 0,
        "results": results,
        "summary": {
            "total": len(project_ids),
            "successful": len(successful),
            "failed": len(failed)
        }
    }

@app.get('/audit-logs')
async def get_audit_logs(limit: int = 100):
    if not os.path.exists(AUDIT_LOG_FILE):
        return {'logs': []}
    with open(AUDIT_LOG_FILE, 'r') as f:
        lines = f.readlines()
        logs = [json.loads(line) for line in lines[-limit:]]
    logs.reverse()  # Most recent first
    return {'logs': logs}

def error_response(detail, code=None, status_code=400, context=None):
    logger.error(f"API Error [{code or status_code}]: {detail} | Context: {context}")
    return {"success": False, "error": detail, "code": code or status_code, "context": context}

@app.post("/campaigns/bulk-delete")
async def bulk_delete_campaigns(request: Request):
    logger.info("/campaigns/bulk-delete endpoint called")
    try:
        ids = await request.json()
        logger.info(f"Received for bulk delete: {ids}")
        if not isinstance(ids, list):
            return error_response("Expected list of campaign IDs", code="invalid_input", status_code=400)
        deleted = []
        failed = []
        for campaign_id in ids:
            try:
                if campaign_id in active_campaigns:
                    del active_campaigns[campaign_id]
                    deleted.append(campaign_id)
                    write_audit_log('admin', 'delete_campaign', {'campaign_id': campaign_id})
                    asyncio.create_task(notify_ws('delete_campaign', {'campaign_id': campaign_id}))
                else:
                    failed.append({"campaign_id": campaign_id, "reason": "Not found or not active"})
            except Exception as e:
                logger.error(f"Failed to delete campaign {campaign_id}: {e}")
                failed.append({"campaign_id": campaign_id, "reason": str(e)})
        save_campaigns_to_file()
        logger.info(f"Deleted campaigns: {deleted}")
        if failed:
            return {
                "success": False,
                "deleted": deleted,
                "failed": failed,
                "error": "Some campaigns could not be deleted.",
                "code": "partial_failure"
            }
        return {"success": True, "deleted": deleted}
    except Exception as e:
        logger.error(f"Error in bulk delete campaigns: {str(e)}")
        return error_response(f"Failed to delete campaigns: {str(e)}", code="server_error", status_code=500)

@app.post("/projects/bulk-delete")
async def bulk_delete_projects(request: Request):
    logger.info("/projects/bulk-delete endpoint called")
    try:
        ids = await request.json()
        logger.info(f"Received for bulk delete: {ids}")
        logger.info(f"Current projects before deletion: {list(projects.keys())}")
        if not isinstance(ids, list):
            return error_response("Expected list of project IDs", code="invalid_input", status_code=400)
        
        # Remove projects from all profiles first
        profiles = load_profiles_from_file()
        profiles_updated = False
        for profile in profiles:
            for project_id in ids:
                if project_id in profile['projectIds']:
                    profile['projectIds'].remove(project_id)
                    profiles_updated = True
        
        if profiles_updated:
            save_profiles_to_file(profiles)
            logger.info(f"Projects removed from all profiles")
        
        deleted = []
        failed = []
        for project_id in ids:
            try:
                if project_id in projects:
                    # Remove from firebase_apps and pyrebase_apps
                    if project_id in firebase_apps:
                        try:
                            firebase_admin.delete_app(firebase_apps[project_id])
                        except Exception as e:
                            logger.warning(f"Error removing Firebase app for {project_id}: {e}")
                        del firebase_apps[project_id]
                    if project_id in pyrebase_apps:
                        del pyrebase_apps[project_id]
                    del projects[project_id]
                    write_audit_log('admin', 'delete_project', {'project_id': project_id})
                    asyncio.create_task(notify_ws('delete_project', {'project_id': project_id}))
                    deleted.append(project_id)
                else:
                    logger.warning(f"Project {project_id} not found for bulk delete.")
                    failed.append({"project_id": project_id, "reason": "Not found"})
            except Exception as e:
                logger.error(f"Failed to delete project {project_id}: {e}")
                failed.append({"project_id": project_id, "reason": str(e)})
        
        save_projects_to_file()
        logger.info(f"Deleted projects: {deleted}")
        logger.info(f"Current projects after deletion: {list(projects.keys())}")
        if failed:
            return {
                "success": False,
                "deleted": deleted,
                "failed": failed,
                "error": "Some projects could not be deleted.",
                "code": "partial_failure"
            }
        return {"success": True, "deleted": deleted}
    except Exception as e:
        logger.error(f"Error in bulk delete projects: {str(e)}")
        return error_response(f"Failed to delete projects: {str(e)}", code="server_error", status_code=500)

def load_ai_keys():
    global ai_keys
    if os.path.exists(AI_KEYS_FILE):
        try:
            with open(AI_KEYS_FILE, 'r') as f:
                ai_keys = json.load(f)
        except Exception as e:
            logger.error(f"Failed to load AI keys: {e}")
            ai_keys = {}
    else:
        ai_keys = {}

def save_ai_keys():
    try:
        with open(AI_KEYS_FILE, 'w') as f:
            json.dump(ai_keys, f)
    except Exception as e:
        logger.error(f"Failed to save AI keys: {e}")

# Load keys on startup
load_ai_keys()

def load_admin_service_account():
    """Load admin service account for Google Cloud operations"""
    global admin_credentials
    if not os.path.exists(ADMIN_SERVICE_ACCOUNT_FILE):
        logger.warning(f"Admin service account file not found: {ADMIN_SERVICE_ACCOUNT_FILE}")
        return False
    
    try:
        with open(ADMIN_SERVICE_ACCOUNT_FILE, 'r') as f:
            service_account_data = json.load(f)
        
        admin_credentials = service_account.Credentials.from_service_account_info(service_account_data)
        logger.info("Admin service account loaded successfully")
        return True
    except Exception as e:
        logger.error(f"Error loading admin service account: {str(e)}")
        return False

def get_admin_credentials():
    """Get admin credentials for Google Cloud operations"""
    if admin_credentials is None:
        if not load_admin_service_account():
            return None
    return admin_credentials

security = HTTPBasic()

def is_admin(credentials: HTTPBasicCredentials = Depends(security)):
    # Simple admin check (replace with real auth in production)
    return credentials.username == 'admin' and credentials.password == 'admin'

@app.post('/ai/set-key')
async def set_ai_key(service: str, key: str, credentials: HTTPBasicCredentials = Depends(security)):
    if not is_admin(credentials):
        logger.warning(f"Unauthorized attempt to set AI key for {service}")
        raise HTTPException(status_code=401, detail='Unauthorized')
    
    if not key or not key.strip():
        logger.error(f"Empty key provided for {service}")
        raise HTTPException(status_code=400, detail='API key cannot be empty')
    
    try:
        ai_keys[service] = key.strip()
        save_ai_keys()
        logger.info(f"AI key for {service} set by admin successfully")
        return {"success": True, "message": f"API key for {service} saved successfully"}
    except Exception as e:
        logger.error(f"Failed to save AI key for {service}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to save API key: {str(e)}")

@app.get('/ai/get-key')
async def get_ai_key(service: str, credentials: HTTPBasicCredentials = Depends(security)):
    if not is_admin(credentials):
        raise HTTPException(status_code=401, detail='Unauthorized')
    key = ai_keys.get(service)
    return {"key": key}

@app.get('/ai/status')
async def get_ai_status():
    """Get status of all AI services (no auth required)"""
    status = {}
    for service in ['mistral', 'githubai']:
        key = ai_keys.get(service)
        status[service] = {
            'configured': bool(key),
            'key_length': len(key) if key else 0
        }
    return status

@app.post('/ai/mistral-generate')
async def mistral_generate(request: Request):
    data = await request.json()
    prompt = data.get('prompt')
    max_tokens = data.get('max_tokens', 256)
    temperature = data.get('temperature', 0.7)
    use_negative = data.get('use_negative', False)
    if not prompt:
        raise HTTPException(status_code=400, detail='Prompt is required')
    if use_negative:
        neg = load_negative_prompt()
        if neg:
            prompt = f"{prompt}\nNegative prompt: {neg}"
    api_key = ai_keys.get('mistral')
    if not api_key:
        raise HTTPException(status_code=400, detail='Mistral API key not set')
    headers = {
        'Authorization': f'Bearer {api_key}',
        'Content-Type': 'application/json',
    }
    payload = {
        'model': 'mistral-tiny',
        'messages': [
            {'role': 'user', 'content': prompt}
        ],
        'max_tokens': max_tokens,
        'temperature': temperature,
    }
    try:
        response = requests.post('https://api.mistral.ai/v1/chat/completions', headers=headers, json=payload)
        if response.status_code == 200:
            result = response.json()
            return {'success': True, 'result': result}
        else:
            logger.error(f"Mistral API error: {response.status_code} - {response.text}")
            return {'success': False, 'error': response.text, 'status_code': response.status_code}
    except Exception as e:
        logger.error(f"Mistral API call failed: {e}")
        raise HTTPException(status_code=500, detail=f"Mistral API call failed: {e}")

@app.post('/ai/githubai-generate')
async def githubai_generate(request: Request):
    data = await request.json()
    prompt = data.get('prompt')
    max_tokens = data.get('max_tokens', 256)
    temperature = data.get('temperature', 0.7)
    if not prompt:
        raise HTTPException(status_code=400, detail='Prompt is required')
    api_key = ai_keys.get('githubai')
    if not api_key:
        raise HTTPException(status_code=400, detail='GitHub AI API key not set')
    headers = {
        'Authorization': f'Bearer {api_key}',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28'
    }
    payload = {
        'model': 'github/gpt4o-mini',
        'messages': [
            {'role': 'user', 'content': prompt}
        ],
        'max_tokens': max_tokens,
        'temperature': temperature,
    }
    try:
        response = requests.post('https://api.github.com/v1/chat/completions', headers=headers, json=payload)
        if response.status_code == 200:
            result = response.json()
            return {'success': True, 'result': result}
        else:
            logger.error(f"GitHub AI API error: {response.status_code} - {response.text}")
            return {'success': False, 'error': response.text, 'status_code': response.status_code}
    except Exception as e:
        logger.error(f"GitHub AI API call failed: {e}")
        raise HTTPException(status_code=500, detail=f"GitHub AI API call failed: {e}")

def load_negative_prompt():
    if os.path.exists(AI_NEGATIVE_PROMPT_FILE):
        with open(AI_NEGATIVE_PROMPT_FILE, 'r', encoding='utf-8') as f:
            return f.read()
    return ''

def save_negative_prompt(prompt: str):
    with open(AI_NEGATIVE_PROMPT_FILE, 'w', encoding='utf-8') as f:
        f.write(prompt or '')

@app.get('/ai/negative-prompt')
async def get_negative_prompt():
    return {"negative_prompt": load_negative_prompt()}

@app.post('/ai/negative-prompt')
async def set_negative_prompt(data: dict, credentials: HTTPBasicCredentials = Depends(security)):
    if not is_admin(credentials):
        raise HTTPException(status_code=401, detail='Unauthorized')
    prompt = data.get('negative_prompt', '')
    save_negative_prompt(prompt)
    logger.info(f"Negative prompt updated by admin.")
    return {"success": True, "negative_prompt": prompt}

@app.post('/admin/service-account')
async def upload_admin_service_account(request: Request, credentials: HTTPBasicCredentials = Depends(security)):
    """Upload admin service account for Google Cloud operations"""
    if not is_admin(credentials):
        raise HTTPException(status_code=401, detail='Unauthorized')
    
    try:
        data = await request.json()
        service_account_data = data.get('serviceAccount')
        
        if not service_account_data:
            raise HTTPException(status_code=400, detail='Service account data is required')
        
        # Validate service account structure
        required_fields = ['type', 'project_id', 'private_key_id', 'private_key', 'client_email', 'client_id']
        for field in required_fields:
            if field not in service_account_data:
                raise HTTPException(status_code=400, detail=f'Service account missing required field: {field}')
        
        # Save to file
        with open(ADMIN_SERVICE_ACCOUNT_FILE, 'w') as f:
            json.dump(service_account_data, f, indent=2)
        
        # Reload admin credentials
        global admin_credentials
        admin_credentials = None
        if load_admin_service_account():
            logger.info("Admin service account uploaded and loaded successfully")
            return {"success": True, "message": "Admin service account uploaded successfully"}
        else:
            raise HTTPException(status_code=500, detail="Failed to load admin service account")
            
    except Exception as e:
        logger.error(f"Failed to upload admin service account: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to upload admin service account: {str(e)}")

@app.get('/admin/service-account/status')
async def get_admin_service_account_status(credentials: HTTPBasicCredentials = Depends(security)):
    """Check if admin service account is configured"""
    if not is_admin(credentials):
        raise HTTPException(status_code=401, detail='Unauthorized')
    
    admin_creds = get_admin_credentials()
    return {
        "configured": admin_creds is not None,
        "file_exists": os.path.exists(ADMIN_SERVICE_ACCOUNT_FILE)
    }

SESSION_TOKENS = set()
SESSION_SECRET = 'supersecretkey'  # In production, use a secure random value

@app.post('/login')
async def login(data: dict):
    username = data.get('username')
    password = data.get('password')
    if username == 'admin' and password == 'Batata010..++':
        # Generate a simple session token
        token = secrets.token_hex(32)
        SESSION_TOKENS.add(token)
        resp = JSONResponse({"success": True, "token": token})
        resp.set_cookie(key="session_token", value=token, httponly=True, samesite="lax")
        return resp
    return {"success": False, "error": "Invalid username or password."}

def require_session(request: Request):
    token = request.cookies.get("session_token")
    if not token or token not in SESSION_TOKENS:
        raise HTTPException(status_code=401, detail="Not authenticated")

# Example usage in a protected endpoint:
# @app.get('/protected')
# async def protected(request: Request):
#     require_session(request)
#     return {"success": True, "message": "You are authenticated."}

def load_profiles_from_file():
    if not os.path.exists(PROFILES_FILE):
        return []
    try:
        with open(PROFILES_FILE, 'r') as f:
            return json.load(f)
    except Exception as e:
        logger.error(f"Error loading profiles: {str(e)}")
        return []

def save_profiles_to_file(profiles):
    try:
        with open(PROFILES_FILE, 'w') as f:
            json.dump(profiles, f, indent=2)
    except Exception as e:
        logger.error(f"Error saving profiles: {str(e)}")

def get_current_user_from_request(request: Request) -> str:
    """Extract current user from request headers or return 'anonymous'"""
    try:
        # Try to get from app-username header (set by frontend)
        username = request.headers.get('X-App-Username')
        logger.info(f"Request headers: {dict(request.headers)}")
        logger.info(f"Extracted username: {username}")
        if username and username.strip():
            return username.strip()
        
        # Try to get from referer header to extract username from URL
        referer = request.headers.get('referer', '')
        if referer and 'localhost:8080' in referer:
            # This is likely a frontend request, try to get username from localStorage or session
            # For now, fallback to 'admin' for frontend requests to prevent projects from disappearing
            logger.warning("No X-App-Username header found, but this appears to be a frontend request. Treating as admin to prevent data loss.")
            return 'admin'
        
        # Fallback to 'anonymous' - no admin privileges by default
        logger.warning("No X-App-Username header found, treating as anonymous")
        return 'anonymous'
    except Exception as e:
        logger.error(f"Error extracting username: {e}")
        return 'anonymous'

def filter_user_data(data_list: list, user: str, is_admin: bool = False) -> list:
    """Filter data to show only user's own data, unless user is admin"""
    logger.info(f"Filtering data for user: {user}, is_admin: {is_admin}, total items: {len(data_list)}")
    
    if is_admin:
        logger.info("User is admin, returning all data")
        return data_list
    
    # Only return items owned by this specific user
    filtered = [item for item in data_list if item.get('ownerId') == user]
    logger.info(f"After filtering for user {user}: {len(filtered)} items")
    for item in filtered:
        logger.info(f"  - {item.get('name', 'NO_NAME')} owned by {item.get('ownerId', 'NO_OWNER')}")
    
    return filtered

@app.get('/profiles')
def get_profiles(request: Request):
    current_user = get_current_user_from_request(request)
    logger.info(f"=== GET /profiles - Current user: {current_user} ===")
    
    # Check if user is admin
    users = load_app_users()
    user_data = next((u for u in users.get('users', []) if u.get('username') == current_user), None)
    is_admin = user_data and user_data.get('role') == 'admin'
    logger.info(f"User data found: {bool(user_data)}, is_admin: {is_admin}")
    
    all_profiles = load_profiles_from_file()
    logger.info(f"Total profiles in file: {len(all_profiles)}")
    
    # Migrate existing profiles to admin ownership if no owner set
    migrated = 0
    for profile in all_profiles:
        if 'ownerId' not in profile:
            profile['ownerId'] = 'admin'
            migrated += 1
    if migrated > 0:
        save_profiles_to_file(all_profiles)
        logger.info(f"Migrated {migrated} profiles to admin ownership")
    
    # Filter profiles based on user access
    user_profiles = filter_user_data(all_profiles, current_user, is_admin)
    logger.info(f"Returning {len(user_profiles)} profiles for user {current_user}")
    return {"profiles": user_profiles}

@app.post('/profiles')
def add_profile(profile: dict, request: Request):
    try:
        current_user = get_current_user_from_request(request)
        profiles = load_profiles_from_file()
        
        # Always assign a unique id and createdAt if not present
        if 'id' not in profile or not profile['id']:
            profile['id'] = str(int(time.time() * 1000))
        if 'createdAt' not in profile:
            profile['createdAt'] = datetime.utcnow().isoformat() + 'Z'
        if 'projectIds' not in profile:
            profile['projectIds'] = []
        
        # Set ownership to current user
        profile['ownerId'] = current_user
        
        profiles.append(profile)
        save_profiles_to_file(profiles)
        logger.info(f"✅ Profile added: {profile['id']} by {current_user}")
        return {"success": True, "profile": profile}
    except Exception as e:
        logger.error(f"❌ CRASH in add_profile: {e}")
        import traceback
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))

@app.put('/profiles/{profile_id}')
def update_profile(profile_id: str, updates: dict, request: Request):
    current_user = get_current_user_from_request(request)
    
    # Check if user is admin
    users = load_app_users()
    user_data = next((u for u in users.get('users', []) if u.get('username') == current_user), None)
    is_admin = user_data and user_data.get('role') == 'admin'
    
    profiles = load_profiles_from_file()
    found = False
    for p in profiles:
        if p["id"] == profile_id:
            # Check ownership (admin can edit all, users can only edit their own)
            if not is_admin and p.get('ownerId') != current_user:
                raise HTTPException(status_code=403, detail="Permission denied")
            p.update(updates)
            found = True
            break
    if not found:
        raise HTTPException(status_code=404, detail="Profile not found")
    save_profiles_to_file(profiles)
    return {"success": True}

@app.delete('/profiles/{profile_id}')
def delete_profile(profile_id: str, request: Request):
    current_user = get_current_user_from_request(request)
    
    # Check if user is admin
    users = load_app_users()
    user_data = next((u for u in users.get('users', []) if u.get('username') == current_user), None)
    is_admin = user_data and user_data.get('role') == 'admin'
    
    profiles = load_profiles_from_file()
    profile_to_delete = None

    # Find the profile to delete
    for profile in profiles:
        if profile["id"] == profile_id:
            # Check ownership (admin can delete all, users can only delete their own)
            if not is_admin and profile.get('ownerId') != current_user:
                raise HTTPException(status_code=403, detail="Permission denied")
            profile_to_delete = profile
            break

    if not profile_to_delete:
        raise HTTPException(status_code=404, detail="Profile not found")
    
    # Remove profile association from all projects
    project_ids_to_unlink = profile_to_delete.get('projectIds', [])
    projects_updated = False
    
    for project_id in project_ids_to_unlink:
        if project_id in projects:
            projects[project_id]['profileId'] = None
            projects_updated = True
    
    if projects_updated:
        save_projects_to_file()
        logger.info(f"Unlinked projects from deleted profile {profile_id}")
    
    # Remove the profile
    profiles = [p for p in profiles if p["id"] != profile_id]
    save_profiles_to_file(profiles)
    
    return {"success": True}

@app.post('/profiles/{profile_id}/link-projects')
async def link_projects_to_profile(profile_id: str, request: Request):
    try:
        data = await request.json()
        project_ids = data.get('projectIds', [])
        
        profiles = load_profiles_from_file()
        profile_found = False
        
        for profile in profiles:
            if profile["id"] == profile_id:
                # Add new project IDs to profile
                for project_id in project_ids:
                    if project_id not in profile['projectIds']:
                        profile['projectIds'].append(project_id)
                
                # Update project associations
                for project_id in project_ids:
                    if project_id in projects:
                        projects[project_id]['profileId'] = profile_id
                
                profile_found = True
                break
        
        if not profile_found:
            raise HTTPException(status_code=404, detail="Profile not found")
        
        save_profiles_to_file(profiles)
        save_projects_to_file()
        
        return {"success": True, "linked_projects": project_ids}
    except Exception as e:
        logger.error(f"Failed to link projects to profile: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to link projects: {str(e)}")

@app.post('/profiles/{profile_id}/unlink-projects')
async def unlink_projects_from_profile(profile_id: str, request: Request):
    try:
        data = await request.json()
        project_ids = data.get('projectIds', [])
        
        profiles = load_profiles_from_file()
        profile_found = False
        
        for profile in profiles:
            if profile["id"] == profile_id:
                # Remove project IDs from profile
                for project_id in project_ids:
                    if project_id in profile['projectIds']:
                        profile['projectIds'].remove(project_id)
                
                # Remove project associations
                for project_id in project_ids:
                    if project_id in projects:
                        projects[project_id]['profileId'] = None
                
                profile_found = True
                break
        
        if not profile_found:
            raise HTTPException(status_code=404, detail="Profile not found")
        
        save_profiles_to_file(profiles)
        save_projects_to_file()
        
        return {"success": True, "unlinked_projects": project_ids}
    except Exception as e:
        logger.error(f"Failed to unlink projects from profile: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to unlink projects: {str(e)}")

# Domain Management Models
class DomainUpdate(BaseModel):
    project_id: str
    new_auth_domain: str
    user: Optional[str] = None

class BulkDomainUpdate(BaseModel):
    project_ids: List[str]
    new_auth_domain: str
    user: Optional[str] = None

class SMTPConfig(BaseModel):
    project_id: str
    sender_email: str
    smtp_host: str
    smtp_port: int
    smtp_username: str
    smtp_password: str
    security_mode: str = "START_TLS"  # START_TLS, SSL, or NONE
    user: Optional[str] = None

class BulkSMTPConfig(BaseModel):
    project_ids: List[str]
    sender_email: str
    smtp_host: str
    smtp_port: int
    smtp_username: str
    smtp_password: str
    security_mode: str = "START_TLS"
    user: Optional[str] = None

@app.post("/update-project-domain")
async def update_project_domain(data: DomainUpdate, request: Request):
    """Update the auth domain for a single Firebase project"""
    try:
        project_id = data.project_id
        new_auth_domain = data.new_auth_domain.strip()
        user = data.user or 'admin'
        
        # Validate domain format
        if not new_auth_domain or '.' not in new_auth_domain:
            raise HTTPException(status_code=400, detail="Invalid domain format")
        
        # Check if project exists
        if project_id not in projects:
            raise HTTPException(status_code=404, detail="Project not found")
        
        project = projects[project_id]
        
        # Update the project's auth domain in Firebase
        domain_results = await update_firebase_projects_domain(new_auth_domain, [project_id])
        
        if not domain_results.get(project_id, {}).get('success'):
            error_msg = domain_results.get(project_id, {}).get('error', 'Unknown error')
            raise HTTPException(status_code=500, detail=f"Failed to update Firebase config: {error_msg}")
        
        # Save to file (handled inside update_firebase_projects_domain but for clarity)
        save_projects_to_file()
        
        # Log the change
        write_audit_log(user, "update_domain", {
            "project_id": project_id,
            "old_domain": f"{project_id}.firebaseapp.com",
            "new_domain": new_auth_domain
        })
        
        logger.info(f"Updated Firebase auth domain for project {project_id} to {new_auth_domain}")
        
        return {
            "success": True,
            "project_id": project_id,
            "new_auth_domain": new_auth_domain,
            "message": f"Domain updated successfully to {new_auth_domain} in Firebase Identity Platform"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update domain for project {data.project_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to update domain: {str(e)}")

@app.post("/update-project-domain-bulk")
async def update_project_domain_bulk(data: BulkDomainUpdate, request: Request):
    """Update the auth domain for multiple Firebase projects"""
    try:
        project_ids = data.project_ids
        new_auth_domain = data.new_auth_domain.strip()
        user = data.user or 'admin'
        
        # Validate domain format
        if not new_auth_domain or '.' not in new_auth_domain:
            raise HTTPException(status_code=400, detail="Invalid domain format")
        
        if not project_ids:
            raise HTTPException(status_code=400, detail="No projects selected")
        
        results = []
        successful = 0
        failed = 0
        
        for project_id in project_ids:
            try:
                # Check if project exists
                if project_id not in projects:
                    results.append({
                        "project_id": project_id,
                        "success": False,
                        "error": "Project not found"
                    })
                    failed += 1
                    continue
                
                # Update the project's auth domain in Firebase
                domain_results = await update_firebase_projects_domain(new_auth_domain, [project_id])
                
                if domain_results.get(project_id, {}).get('success'):
                    # Log the change
                    write_audit_log(user, "update_domain", {
                        "project_id": project_id,
                        "old_domain": f"{project_id}.firebaseapp.com",
                        "new_domain": new_auth_domain
                    })
                    
                    results.append({
                        "project_id": project_id,
                        "success": True,
                        "new_auth_domain": new_auth_domain
                    })
                    successful += 1
                else:
                    error_msg = domain_results.get(project_id, {}).get('error', 'Unknown error')
                    results.append({
                        "project_id": project_id,
                        "success": False,
                        "error": error_msg
                    })
                    failed += 1
                
            except Exception as e:
                logger.error(f"Failed to update domain for project {project_id}: {e}")
                results.append({
                    "project_id": project_id,
                    "success": False,
                    "error": str(e)
                })
                failed += 1
        
        # Save all changes to file
        if successful > 0:
            save_projects_to_file()
        
        return {
            "success": True,
            "summary": {
                "total": len(project_ids),
                "successful": successful,
                "failed": failed
            },
            "results": results,
            "new_auth_domain": new_auth_domain
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update domains in bulk: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to update domains: {str(e)}")

@app.get("/api/project-domains")
async def get_project_domains():
    """Get current auth domains for all projects with verification info"""
    try:
        domain_info = []
        for project_id, project in projects.items():
            current_auth_domain = project.get('authDomain', f"{project_id}.firebaseapp.com")
            default_domain = f"{project_id}.firebaseapp.com"
            has_custom_domain = current_auth_domain != default_domain
            
            domain_info.append({
                "project_id": project_id,
                "project_name": project.get('name', 'Unknown'),
                "current_auth_domain": current_auth_domain,
                "default_domain": default_domain,
                "has_custom_domain": has_custom_domain,
                "is_firebase_initialized": project_id in firebase_apps,
                "is_pyrebase_initialized": project_id in pyrebase_apps,
                "smtp_configured": "smtpConfig" in project,
                "status": "✅ Active" if project_id in firebase_apps else "❌ Inactive"
            })
        
        custom_domain_count = sum(1 for d in domain_info if d["has_custom_domain"])
        active_count = sum(1 for d in domain_info if d["is_firebase_initialized"])
        
        return {
            "success": True,
            "domains": domain_info,
            "summary": {
                "total_projects": len(domain_info),
                "custom_domain_count": custom_domain_count,
                "active_projects": active_count,
                "smtp_configured_count": sum(1 for d in domain_info if d["smtp_configured"])
            }
        }
        
    except Exception as e:
        logger.error(f"Failed to get project domains: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get domains: {str(e)}")

# ===================================================================
# Cloudflare Configuration Endpoints
# ===================================================================


# Determine absolute path to config file in project root
try:
    # src/utils/firebaseBackend.py -> src/utils -> src -> root
    ROOT_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    CLOUDFLARE_CONFIG_FILE = os.path.join(ROOT_DIR, "cloudflare_config.json")
    logger.info(f"Cloudflare config file path resolved to: {CLOUDFLARE_CONFIG_FILE}")
except Exception as e:
    # Fallback to current directory if path resolution fails
    CLOUDFLARE_CONFIG_FILE = "cloudflare_config.json"
    logger.error(f"Failed to resolve absolute path, using relative: {e}")

def load_cloudflare_config_from_file():
    """Load Cloudflare config from file"""
    try:
        if os.path.exists(CLOUDFLARE_CONFIG_FILE):
            logger.info(f"Loading Cloudflare config from: {CLOUDFLARE_CONFIG_FILE}")
            with open(CLOUDFLARE_CONFIG_FILE, 'r') as f:
                data = json.load(f)
                logger.info(f"Loaded config keys: {list(data.keys())}")
                return data
        else:
            logger.warning(f"Cloudflare config file not found at: {CLOUDFLARE_CONFIG_FILE}")
    except Exception as e:
        logger.error(f"Failed to load Cloudflare config file: {e}")
    return {}

def save_cloudflare_config_to_file(config):
    """Save Cloudflare config to file"""
    try:
        logger.info(f"Saving Cloudflare config to: {CLOUDFLARE_CONFIG_FILE}")
        with open(CLOUDFLARE_CONFIG_FILE, 'w') as f:
            json.dump(config, f, indent=2)
        logger.info("Config saved successfully")
    except Exception as e:
        logger.error(f"Failed to save Cloudflare config file: {e}")
        raise

# Initialize environment from file on module load
_initial_config = load_cloudflare_config_from_file()
if _initial_config.get('api_token'):
    os.environ['CLOUDFLARE_API_TOKEN'] = _initial_config['api_token']
    logger.info("Loaded Cloudflare API token from config file on startup")
else:
    logger.warning("No Cloudflare API token found in config file on startup")

def get_cf_client():
    """Get Cloudflare client with error handling"""
    try:
        # Load fresh config
        config = load_cloudflare_config_from_file()
        file_token = config.get('api_token')
        env_token = os.getenv('CLOUDFLARE_API_TOKEN')
        
        token = file_token or env_token
        
        logger.info(f"get_cf_client check: File Token exists? {bool(file_token)}, Env Token exists? {bool(env_token)}")
        
        if not token:
            # Debug info for the user/developer
            debug_info = f"File: {CLOUDFLARE_CONFIG_FILE}, Exists: {os.path.exists(CLOUDFLARE_CONFIG_FILE)}, FileToken: {bool(file_token)}, EnvToken: {bool(env_token)}"
            logger.error(f"Cloudflare token missing. Debug: {debug_info}")
            raise HTTPException(
                status_code=500, 
                detail=f"Cloudflare not configured. Please set CLOUDFLARE_API_TOKEN in Settings. (Debug: {debug_info})"
            )
        
        # Ensure env var is up to date
        if file_token and file_token != env_token:
            os.environ['CLOUDFLARE_API_TOKEN'] = file_token
            logger.info("Updated process environment variable with token from file")
        
        # Try multiple import strategies to handle different working directories
        try:
            from cloudflare_client import get_cloudflare_client
        except ImportError:
            try:
                from utils.cloudflare_client import get_cloudflare_client
            except ImportError:
                from src.utils.cloudflare_client import get_cloudflare_client
        
        return get_cloudflare_client()
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to initialize Cloudflare client: {e}")
        raise HTTPException(
            status_code=500, 
            detail=f"Cloudflare initialization failed: {str(e)}"
        )

@app.get("/cloudflare/config")
async def get_cloudflare_config(request: Request):
    """Get Cloudflare configuration (token masked)"""
    try:
        config = load_cloudflare_config_from_file()
        token = config.get('api_token') or os.getenv('CLOUDFLARE_API_TOKEN') or ''
        
        # Mask the token for display
        masked_token = token[:8] + '*' * (len(token) - 8) if len(token) > 8 else ''
        return {
            "success": True,
            "api_token": masked_token,
            "configured": bool(token)
        }
    except Exception as e:
        logger.error(f"Failed to get Cloudflare config: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/cloudflare/config")
async def save_cloudflare_config(request: Request):
    """Save Cloudflare API token"""
    try:
        data = await request.json()
        api_token = data.get('api_token', '').strip()
        
        if not api_token:
            raise HTTPException(status_code=400, detail="API token is required")
        
        # Save to file
        config = {'api_token': api_token}
        save_cloudflare_config_to_file(config)
        
        # Update environment variable immediately
        os.environ['CLOUDFLARE_API_TOKEN'] = api_token
        
        logger.info("Cloudflare API token saved successfully to file")
        return {
            "success": True,
            "message": "Cloudflare API token saved successfully"
        }
    except HTTPException:
        raise
@app.get("/cloudflare/debug")
async def debug_cloudflare_config(request: Request):
    """Debug endpoint to inspect server-side Cloudflare configuration"""
    try:
        config = load_cloudflare_config_from_file()
        file_token = config.get('api_token', '')
        env_token = os.getenv('CLOUDFLARE_API_TOKEN', '')
        
        # Determine paths
        cwd = os.getcwd()
        abs_file = os.path.abspath(__file__)
        root_dir_calc = ROOT_DIR
        config_path = CLOUDFLARE_CONFIG_FILE
        config_exists = os.path.exists(config_path)
        
        # Mask tokens
        def mask(t): return (t[:4] + '...' + t[-4:]) if len(t) > 8 else 'Not Set'
        
        return {
            "success": True,
            "debug_info": {
                "server_time": datetime.utcnow().isoformat(),
                "working_directory": cwd,
                "script_path": abs_file,
                "calculated_root": root_dir_calc,
                "config_file_path": config_path,
                "config_file_exists": config_exists,
                "token_sources": {
                    "file_token": mask(file_token),
                    "env_token": mask(env_token),
                    "match": file_token == env_token
                },
                "python_path": sys.path
            }
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }


@app.get("/cloudflare/test-connection")
async def test_cloudflare_connection(request: Request):
    """Test Cloudflare API connection"""
    try:
        config = load_cloudflare_config_from_file()
        api_token = config.get('api_token') or os.getenv('CLOUDFLARE_API_TOKEN')
        
        if not api_token:
            return {
                "success": False,
                "message": "Cloudflare API token not configured"
            }
        
        # Test the connection by making a simple API call
        import requests
        headers = {
            'Authorization': f'Bearer {api_token}',
            'Content-Type': 'application/json'
        }
        
        response = requests.get(
            'https://api.cloudflare.com/client/v4/user/tokens/verify',
            headers=headers,
            timeout=10
        )
        
        if response.status_code == 200:
            result = response.json()
            if result.get('success'):
                return {
                    "success": True,
                    "message": "Successfully connected to Cloudflare API"
                }
        
        return {
            "success": False,
            "message": f"Connection failed: {response.text}"
        }
    except Exception as e:
        logger.error(f"Failed to test Cloudflare connection: {e}")
        return {
            "success": False,
            "message": f"Connection test failed: {str(e)}"
        }

# =================================================================== 
# Cloudflare Domain Verification Endpoints
# ===================================================================

# Helper function to add domain to Firebase project
async def update_firebase_projects_domain(domain: str, project_ids: List[str]) -> Dict:
    """
    Add verified domain to Firebase project's authorized domains
    Uses Firebase REST API to update project configuration
    """
    results = {}
    
    for project_id in project_ids:
        try:
            # Get project from in-memory storage
            if project_id not in projects:
                results[project_id] = {"success": False, "error": "Project not found"}
                continue
            
            project = projects[project_id]
            service_account_json = project.get('serviceAccount')
            
            if not service_account_json:
                results[project_id] = {"success": False, "error": "Service account not configured"}
                continue
            
            # Use service account to authenticate
            credentials_obj = service_account.Credentials.from_service_account_info(
                service_account_json,
                scopes=['https://www.googleapis.com/auth/firebase', 'https://www.googleapis.com/auth/cloud-platform']
            )
            
            authed_session = AuthorizedSession(credentials_obj)
            
            # Fetch current authorized domains - CORRECT V2 URL (removed /admin)
            config_url = f"https://identitytoolkit.googleapis.com/v2/projects/{project_id}/config"
            response = authed_session.get(config_url)
            
            if response.status_code != 200:
                results[project_id] = {"success": False, "error": f"Failed to fetch config: {response.text}"}
                continue
            
            config = response.json()
            
            # Get existing authorized domains
            authorized_domains = config.get('authorizedDomains', [])
            
            # Add domain if not already present
            domain_added = False
            if domain not in authorized_domains:
                authorized_domains.append(domain)
                domain_added = True
            
            # Update configuration including dnsConfig for custom email domain
            # This is the critical part to enable the "Custom email handler domain" in Firebase console
            update_payload = {
                "authorizedDomains": authorized_domains,
                "notification": {
                    "sendEmail": {
                        "dnsConfig": {
                            "customDomain": domain,
                            "useCustomDomain": True
                        }
                    }
                }
            }
            
            update_mask = "authorizedDomains,notification.sendEmail.dnsConfig"
            
            logger.info(f"Updating Firebase Identity Platform config for {project_id} with custom domain {domain}")
            
            update_response = authed_session.patch(
                config_url,
                json=update_payload,
                params={"updateMask": update_mask}
            )
            
            if update_response.status_code == 200:
                results[project_id] = {
                    "success": True,
                    "message": f"Domain {domain} authorized and configured for email templates",
                    "authorized_domains": authorized_domains
                }
                # Update local project record
                project['authDomain'] = domain
                logger.info(f"Successfully configured custom domain {domain} for project {project_id}")
            else:
                results[project_id] = {
                    "success": False,
                    "error": f"Failed to update Firebase config: {update_response.text}"
                }
                logger.error(f"Failed to update Firebase config for {project_id}: {update_response.status_code} - {update_response.text}")
                
        except Exception as e:
            logger.error(f"Failed to add domain to project {project_id}: {e}")
            results[project_id] = {"success": False, "error": str(e)}
    
    return results

# In-memory storage for domain verifications
domain_verifications = {}

class DomainVerificationRequest(BaseModel):
    domain: str
    project_ids: List[str]
    setup_email_dns: bool = False
    email_provider: str = "google"

@app.post("/cloudflare/initiate-verification")
async def initiate_domain_verification(request: DomainVerificationRequest):
    """
    Initiate domain verification process
    1. Create TXT verification record in Cloudflare
    2. Start verification polling in background
    3. Return verification details
    """
    try:
        cf_client = get_cf_client()
        domain = request.domain.strip().lower()
        
        # Validate domain format
        if not domain or '.' not in domain:
            raise HTTPException(status_code=400, detail="Invalid domain format")
            
        # Initiate verification for all projects
        verification_details = []
        for project_id in request.project_ids:
            if project_id not in projects:
                logger.warning(f"Project {project_id} not found, skipping in verification")
                continue
                
            # Create record in Cloudflare for this project
            v_domain, v_token = cf_client.create_verification_record(domain, project_id)
            verification_details.append({
                "project_id": project_id,
                "verification_domain": v_domain,
                "verification_token": v_token
            })
        
        if not verification_details:
             raise HTTPException(status_code=400, detail="No valid projects found for verification.")

        # Store verification status (using the details from the first project for UI compatibility)
        verification_id = hashlib.md5(f"{domain}:{datetime.now()}".encode()).hexdigest()[:16]
        domain_verifications[verification_id] = {
            "domain": domain,
            "verification_domain": verification_details[0]["verification_domain"],
            "verification_token": verification_details[0]["verification_token"],
            "verification_details": verification_details,
            "project_ids": request.project_ids,
            "setup_email_dns": request.setup_email_dns,
            "email_provider": request.email_provider,
            "status": "pending",
            "created_at": datetime.now().isoformat(),
            "attempts": 0
        }
        
        logger.info(f"Initiated bulk verification for domain: {domain} across {len(verification_details)} projects")
        
        return {
            "success": True,
            "verification_id": verification_id,
            "domain": domain,
            "verification_domain": verification_details[0]["verification_domain"],
            "verification_token": verification_details[0]["verification_token"],
            "status": "pending",
            "message": f"Cloudflare records created for {len(verification_details)} projects. Verification will take 1-5 minutes."
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to initiated domain verification: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/cloudflare/verification-status/{verification_id}")
async def get_verification_status(verification_id: str):
    """Check verification status and attempt DNS verification if pending"""
    try:
        if verification_id not in domain_verifications:
            raise HTTPException(status_code=404, detail="Verification not found")
        
        verification = domain_verifications[verification_id]
        
        # If already verified or failed, return current status
        if verification["status"] in ["verified", "failed", "timeout"]:
            return {
                "success": verification["status"] == "verified",
                "verification_id": verification_id,
                **verification
            }
        
        # Attempt DNS verification
        cf_client = get_cf_client()
        verification["attempts"] += 1
        
        # Check if we've exceeded max attempts (100 attempts = ~16 minutes with 10s polls)
        if verification["attempts"] > 100:
            verification["status"] = "timeout"
            verification["message"] = "Verification timeout. DNS propagation still pending. You can check manually later."
            return {
                "success": False,
                "verification_id": verification_id,
                **verification
            }
        
        # Verify TXT records for ALL projects
        all_verified = True
        failed_messages = []
        
        details = verification.get("verification_details", [])
        if not details:
            # Fallback for old records
            details = [{
                "project_id": verification["project_ids"][0],
                "verification_domain": verification["verification_domain"],
                "verification_token": verification["verification_token"]
            }]
            
        for detail in details:
            v_domain = detail["verification_domain"]
            v_token = detail["verification_token"]
            p_id = detail["project_id"]
            
            is_v, msg = cf_client.verify_txt_record(v_domain, v_token, max_attempts=1)
            if not is_v:
                all_verified = False
                failed_messages.append(f"{p_id}: {msg}")
        
        if all_verified:
            verification["status"] = "verified"
            verification["verified_at"] = datetime.now().isoformat()
            verification["message"] = "Domain verified successfully"
            
            # Update Firebase projects
            try:
                update_result = await update_firebase_projects_domain(
                    verification["domain"],
                    verification["project_ids"]
                )
                verification["firebase_update"] = update_result
            except Exception as e:
                logger.error(f"Failed to update Firebase projects: {e}")
                verification["firebase_update"] = {"error": str(e)}
            
            # Setup email DNS if requested
            if verification["setup_email_dns"]:
                try:
                    email_result = cf_client.setup_email_dns(
                        verification["domain"],
                        verification["email_provider"]
                    )
                    verification["email_dns"] = email_result
                except Exception as e:
                    logger.error(f"Failed to setup email DNS: {e}")
                    verification["email_dns"] = {"error": str(e)}
            
            logger.info(f"Domain verified: {verification['domain']}")
        else:
            verification["message"] = "Waiting for records: " + "; ".join(failed_messages)
        
        return {
            "success": all_verified,
            "verification_id": verification_id,
            **verification
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to check verification status: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/cloudflare/verified-domains")
async def list_verified_domains():
    """List all verified domains"""
    try:
        verified = [
            {
                "verification_id": vid,
                "domain": v["domain"],
                "verified_at": v.get("verified_at"),
                "project_ids": v["project_ids"]
            }
            for vid, v in domain_verifications.items()
            if v["status"] == "verified"
        ]
        
        return {
            "success": True,
            "verified_domains": verified,
            "count": len(verified)
        }
    except Exception as e:
        logger.error(f"Failed to list verified domains: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/cloudflare/verification/{verification_id}")
async def delete_verification(verification_id: str):
    """Delete verification record"""
    try:
        if verification_id not in domain_verifications:
            raise HTTPException(status_code=404, detail="Verification not found")
        
        verification = domain_verifications[verification_id]
        
        # Optionally delete DNS record from Cloudflare
        try:
            cf_client = get_cf_client()
            zone_id = cf_client.get_zone_id(verification["domain"])
            if zone_id:
                records = cf_client.list_dns_records(
                    zone_id,
                    "TXT",
                    verification["verification_domain"]
                )
                for record in records:
                    cf_client.delete_dns_record(zone_id, record['id'])
        except Exception as e:
            logger.warning(f"Failed to delete DNS record: {e}")
        
        # Remove from memory
        del domain_verifications[verification_id]
        
        return {
            "success": True,
            "message": "Verification deleted"
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete verification: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ===================================================================
# Main Execution
# ===================================================================

@app.post("/api/configure-smtp")
async def configure_smtp(data: SMTPConfig, request: Request):
    """Configure SMTP settings for a single Firebase project"""
    try:
        project_id = data.project_id
        user = data.user or 'admin'
        
        # Check if project exists
        if project_id not in projects:
            raise HTTPException(status_code=404, detail="Project not found")
        
        project = projects[project_id]
        service_account_info = project['serviceAccount']
        
        credentials = service_account.Credentials.from_service_account_info(
            service_account_info,
            scopes=["https://www.googleapis.com/auth/cloud-platform"]
        )
        authed_session = AuthorizedSession(credentials)
        
        # Configure SMTP settings
        url = f"https://identitytoolkit.googleapis.com/v2/projects/{project_id}/config?updateMask=notification.sendEmail.method,notification.sendEmail.smtp"
        payload = {
            "notification": {
                "sendEmail": {
                    "method": "SMTP",
                    "smtp": {
                        "senderEmail": data.sender_email,
                        "host": data.smtp_host,
                        "port": data.smtp_port,
                        "username": data.smtp_username,
                        "password": data.smtp_password,
                        "securityMode": data.security_mode
                    }
                }
            }
        }
        
        response = authed_session.patch(url, json=payload)
        response.raise_for_status()
        
        # Store SMTP config in project (without password for security)
        project['smtpConfig'] = {
            "senderEmail": data.sender_email,
            "host": data.smtp_host,
            "port": data.smtp_port,
            "username": data.smtp_username,
            "securityMode": data.security_mode
        }
        save_projects_to_file()
        
        logger.info(f"SMTP configuration updated for project {project_id}")
        write_audit_log(user, "configure_smtp", {
            "project_id": project_id,
            "sender_email": data.sender_email,
            "smtp_host": data.smtp_host
        })
        
        return {
            "success": True,
            "project_id": project_id,
            "message": f"SMTP configuration updated for {project_id}"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to configure SMTP for project {data.project_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to configure SMTP: {str(e)}")

@app.post("/api/configure-smtp-bulk")
async def configure_smtp_bulk(data: BulkSMTPConfig, request: Request):
    """Configure SMTP settings for multiple Firebase projects"""
    try:
        project_ids = data.project_ids
        user = data.user or 'admin'
        
        if not project_ids:
            raise HTTPException(status_code=400, detail="No projects selected")
        
        results = []
        successful = 0
        failed = 0
        
        for project_id in project_ids:
            try:
                # Check if project exists
                if project_id not in projects:
                    results.append({
                        "project_id": project_id,
                        "success": False,
                        "error": "Project not found"
                    })
                    failed += 1
                    continue
                
                project = projects[project_id]
                service_account_info = project['serviceAccount']
                
                credentials = service_account.Credentials.from_service_account_info(
                    service_account_info,
                    scopes=["https://www.googleapis.com/auth/cloud-platform"]
                )
                authed_session = AuthorizedSession(credentials)
                
                # Configure SMTP settings
                url = f"https://identitytoolkit.googleapis.com/v2/projects/{project_id}/config?updateMask=notification.sendEmail.method,notification.sendEmail.smtp"
                payload = {
                    "notification": {
                        "sendEmail": {
                            "method": "SMTP",
                            "smtp": {
                                "senderEmail": data.sender_email,
                                "host": data.smtp_host,
                                "port": data.smtp_port,
                                "username": data.smtp_username,
                                "password": data.smtp_password,
                                "securityMode": data.security_mode
                            }
                        }
                    }
                }
                
                response = authed_session.patch(url, json=payload)
                response.raise_for_status()
                
                # Store SMTP config in project (without password for security)
                project['smtpConfig'] = {
                    "senderEmail": data.sender_email,
                    "host": data.smtp_host,
                    "port": data.smtp_port,
                    "username": data.smtp_username,
                    "securityMode": data.security_mode
                }
                
                logger.info(f"SMTP configuration updated for project {project_id}")
                write_audit_log(user, "configure_smtp", {
                    "project_id": project_id,
                    "sender_email": data.sender_email,
                    "smtp_host": data.smtp_host
                })
                
                results.append({
                    "project_id": project_id,
                    "success": True,
                    "message": "SMTP configuration updated"
                })
                successful += 1
                
            except Exception as e:
                logger.error(f"Failed to configure SMTP for project {project_id}: {e}")
                results.append({
                    "project_id": project_id,
                    "success": False,
                    "error": str(e)
                })
                failed += 1
        
        # Save all changes to file
        if successful > 0:
            save_projects_to_file()
        
        return {
            "success": True,
            "summary": {
                "total": len(project_ids),
                "successful": successful,
                "failed": failed
            },
            "results": results
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to configure SMTP in bulk: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to configure SMTP: {str(e)}")

class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    adminEmail: Optional[str] = None
    serviceAccount: Optional[Dict[str, Any]] = None
    apiKey: Optional[str] = None
    profileId: Optional[str] = None

@app.put("/projects/{project_id}")
async def update_project(
    project_id: str = Path(..., description="The project ID to update"),
    update: ProjectUpdate = Body(...)
):
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")
    project = projects[project_id]
    updated = False
    # Update fields if provided
    if update.name is not None:
        project['name'] = update.name
        updated = True
    if update.adminEmail is not None:
        project['adminEmail'] = update.adminEmail
        updated = True
    if update.apiKey is not None:
        project['apiKey'] = update.apiKey
        updated = True
    if update.profileId is not None:
        project['profileId'] = update.profileId
        updated = True
    if update.serviceAccount is not None:
        project['serviceAccount'] = update.serviceAccount
        updated = True
        # Re-initialize Firebase Admin SDK
        try:
            if project_id in firebase_apps:
                firebase_admin.delete_app(firebase_apps[project_id])
                del firebase_apps[project_id]
            cred = credentials.Certificate(update.serviceAccount)
            firebase_app = firebase_admin.initialize_app(cred, name=project_id)
            firebase_apps[project_id] = firebase_app
        except Exception as e:
            logger.error(f"Failed to re-initialize Firebase Admin SDK for {project_id}: {e}")
            raise HTTPException(status_code=400, detail=f"Failed to re-initialize Firebase Admin SDK: {e}")
        # Re-initialize Pyrebase
        try:
            auth_domain = project.get('authDomain', f"{project_id}.firebaseapp.com")
            pyrebase_config = {
                "apiKey": project['apiKey'],
                "authDomain": auth_domain,
                "databaseURL": f"https://{project_id}-default-rtdb.firebaseio.com",
                "storageBucket": f"{project_id}.appspot.com",
            }
            pyrebase_app = pyrebase.initialize_app(pyrebase_config)
            pyrebase_apps[project_id] = pyrebase_app
        except Exception as e:
            logger.error(f"Failed to re-initialize Pyrebase for {project_id}: {e}")
            raise HTTPException(status_code=400, detail=f"Failed to re-initialize Pyrebase: {e}")
    save_projects_to_file()
    return {"success": True, "project_id": project_id, "updated": updated}

# ============================================================================
# CLOUDFLARE DOMAIN VERIFICATION ENDPOINTS
# ============================================================================


# Store domain verification status (in-memory for now, could move to DB)
domain_verifications: Dict[str, Dict] = {}

class DomainVerificationRequest(BaseModel):
    domain: str
    project_ids: List[str]
    setup_email_dns: bool = False
    email_provider: str = "google"

class DomainStatusRequest(BaseModel):
    domain: str

@app.post("/cloudflare/initiate-verification")
async def initiate_domain_verification(request: DomainVerificationRequest):
    """
    Initiate domain verification process
    1. Create TXT verification record in Cloudflare
    2. Start verification polling in background
    3. Return verification details
    """
    try:
        cf_client = get_cf_client()
        domain = request.domain.strip().lower()
        
        # Validate domain format
        if not domain or '.' not in domain:
            raise HTTPException(status_code=400, detail="Invalid domain format")
        
        # Generate verification record
        # Use first project ID for verification token generation
        project_id = request.project_ids[0] if request.project_ids else "unknown"
        verification_domain, verification_token = cf_client.create_verification_record(domain, project_id)
        
        # Store verification status
        verification_id = hashlib.md5(f"{domain}:{datetime.now()}".encode()).hexdigest()[:16]
        domain_verifications[verification_id] = {
            "domain": domain,
            "project_ids": request.project_ids,
            "verification_domain": verification_domain,
            "verification_token": verification_token,
            "status": "pending",
            "created_at": datetime.now().isoformat(),
            "setup_email_dns": request.setup_email_dns,
            "email_provider": request.email_provider,
            "attempts": 0,
            "max_attempts": 30
        }
        
        logger.info(f"Initiated verification for domain: {domain}")
        
        return {
            "success": True,
            "verification_id": verification_id,
            "domain": domain,
            "verification_domain": verification_domain,
            "verification_token": verification_token,
            "status": "pending",
            "message": f"TXT record created. Verification will complete automatically in 1-5 minutes."
        }
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to initiate domain verification: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Verification failed: {str(e)}")

@app.get("/cloudflare/verification-status/{verification_id}")
async def get_verification_status(verification_id: str):
    """Get current verification status and attempt verification if still pending"""
    if verification_id not in domain_verifications:
        raise HTTPException(status_code=404, detail="Verification ID not found")
    
    verification = domain_verifications[verification_id]
    
    # If still pending, try to verify
    if verification["status"] == "pending":
        try:
            cf_client = get_cf_client()
            verification["attempts"] += 1
            
            # Check if we've exceeded max attempts
            if verification["attempts"] > verification["max_attempts"]:
                verification["status"] = "timeout"
                verification["message"] = "Verification timeout. DNS propagation may take longer. Please try again later."
                return {
                    "success": False,
                    "verification_id": verification_id,
                    **verification
                }
            
            # Attempt verification
            is_verified, message = cf_client.verify_txt_record(
                verification["verification_domain"],
                verification["verification_token"],
                max_attempts=1  # Single attempt per status check
            )
            
            if is_verified:
                verification["status"] = "verified"
                verification["verified_at"] = datetime.now().isoformat()
                verification["message"] = "Domain verified successfully!"
                
                # Update Firebase projects with new domain
                try:
                    await update_firebase_projects_domain(
                        verification["domain"],
                        verification["project_ids"]
                    )
                    verification["firebase_updated"] = True
                except Exception as e:
                    logger.error(f"Failed to update Firebase projects: {e}")
                    verification["firebase_updated"] = False
                    verification["firebase_error"] = str(e)
                
                # Setup email DNS if requested
                if verification.get("setup_email_dns"):
                    try:
                        email_results = cf_client.setup_email_dns(
                            verification["domain"],
                            verification["email_provider"]
                        )
                        verification["email_dns_results"] = email_results
                        verification["email_dns_configured"] = all(email_results.values())
                    except Exception as e:
                        logger.error(f"Failed to setup email DNS: {e}")
                        verification["email_dns_configured"] = False
                        verification["email_dns_error"] = str(e)
            
            else:
                verification["message"] = f"Verification in progress... (Attempt {verification['attempts']}/{verification['max_attempts']})"
        
        except Exception as e:
            logger.error(f"Verification check failed: {str(e)}")
            verification["status"] = "error"
            verification["message"] = f"Verification error: {str(e)}"
    
    return {
        "success": verification["status"] in ["verified", "pending"],
        "verification_id": verification_id,
        **verification
    }

async def update_firebase_projects_domain(domain: str, project_ids: List[str]) -> Dict:
    """Update Firebase projects with authorized domain"""
    results = {"successful": 0, "failed": 0, "details": []}
    
    for project_id in project_ids:
        try:
            # Load project
            project = next((p for p in projects if p['id'] == project_id), None)
            if not project:
                results["failed"] += 1
                results["details"].append({"project_id": project_id, "success": False, "error": "Project not found"})
                continue
            
            # Update authDomain
            project['authDomain'] = domain
            
            # Update Firebase Auth configuration
            try:
                cred_path = project.get('serviceAccount')
                if cred_path and os.path.exists(cred_path):
                    cred = credentials.Certificate(cred_path)
                    scoped_credentials = cred.with_scopes([
                        'https://www.googleapis.com/auth/cloud-platform',
                        'https://www.googleapis.com/auth/identitytoolkit'
                    ])
                    authed_session = AuthorizedSession(scoped_credentials)
                    
                    # Update authorized domains
                    url = f"https://identitytoolkit.googleapis.com/admin/v2/projects/{project_id}/config"
                    config_data = {
                        "authorizedDomains": [domain, f"{project_id}.firebaseapp.com"],
                    }
                    
                    response = authed_session.patch(url, json=config_data, params={"updateMask": "authorizedDomains"})
                    
                    if response.status_code == 200:
                        logger.info(f"Updated Firebase Auth domain for {project_id}: {domain}")
                        results["successful"] += 1
                        results["details"].append({"project_id": project_id, "success": True})
                    else:
                        raise Exception(f"API returned {response.status_code}: {response.text}")
            
            except Exception as e:
                logger.error(f"Failed to update Firebase Auth for {project_id}: {e}")
                results["failed"] += 1
                results["details"].append({"project_id": project_id, "success": False, "error": str(e)})
        
        except Exception as e:
            logger.error(f"Failed to update project {project_id}: {e}")
            results["failed"] += 1
            results["details"].append({"project_id": project_id, "success": False, "error": str(e)})
    
    # Save projects
    save_projects_to_file()
    
    return results

@app.get("/cloudflare/verified-domains")
async def list_verified_domains():
    """List all verified domains"""
    verified = [
        {
            "verification_id": vid,
            "domain": v["domain"],
            "verified_at": v.get("verified_at"),
            "project_ids": v.get("project_ids", []),
            "email_dns_configured": v.get("email_dns_configured", False)
        }
        for vid, v in domain_verifications.items()
        if v["status"] == "verified"
    ]
    
    return {
        "success": True,
        "verified_domains": verified,
        "count": len(verified)
    }

@app.delete("/cloudflare/verification/{verification_id}")
async def cancel_verification(verification_id: str):
    """Cancel/delete a verification"""
    if verification_id in domain_verifications:
        del domain_verifications[verification_id]
        return {"success": True, "message": "Verification cancelled"}
    else:
        raise HTTPException(status_code=404, detail="Verification not found")


# ============================================================================
# DATA LIST MANAGEMENT ENDPOINTS
# ============================================================================

@app.post("/data-lists")
async def create_data_list(data_list: DataListCreate, request: Request):
    """Create a new data list with metadata"""
    try:
        current_user = get_current_user_from_request(request)
        list_id = str(uuid.uuid4())
        
        # Validate emails
        valid_emails = [email.strip() for email in data_list.emails if email.strip() and '@' in email]
        
        list_data = {
            "id": list_id,
            "name": data_list.name,
            "isp": data_list.isp,
            "geo": data_list.geo,
            "status": data_list.status,
            "email_count": len(valid_emails),
            "emails": valid_emails,
            "created_at": datetime.now().isoformat(),
            "uploaded_by": current_user
        }
        
        data_lists[list_id] = list_data
        save_data_lists_to_file()
        
        logger.info(f"Created data list {list_id} with {len(valid_emails)} emails by {current_user}")
        
        return {
            "success": True,
            "list_id": list_id,
            "email_count": len(valid_emails)
        }
        
    except Exception as e:
        logger.error(f"Failed to create data list: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to create data list: {str(e)}")

@app.get("/data-lists")
async def list_data_lists(
    request: Request,
    isp: Optional[str] = None,
    geo: Optional[str] = None,
    status: Optional[str] = None
):
    """List all data lists with optional filtering"""
    try:
        current_user = get_current_user_from_request(request)
        
        # Get all lists
        lists = list(data_lists.values())
        
        # Apply filters
        if isp:
            lists = [l for l in lists if l.get('isp') == isp]
        if geo:
            lists = [l for l in lists if l.get('geo') == geo]
        if status:
            lists = [l for l in lists if l.get('status') == status]
        
        # Remove email arrays from response for performance (only metadata)
        lists_meta = []
        for l in lists:
            meta = {k: v for k, v in l.items() if k != 'emails'}
            lists_meta.append(meta)
        
        return {
            "success": True,
            "data_lists": lists_meta,
            "total": len(lists_meta)
        }
        
    except Exception as e:
        logger.error(f"Failed to list data lists: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to list data lists: {str(e)}")

@app.get("/data-lists/{list_id}")
async def get_data_list(list_id: str):
    """Get a specific data list by ID"""
    if list_id not in data_lists:
        raise HTTPException(status_code=404, detail="Data list not found")
    
    return {
        "success": True,
        "data_list": data_lists[list_id]
    }

@app.delete("/data-lists/{list_id}")
async def delete_data_list(list_id: str):
    """Delete a data list"""
    if list_id not in data_lists:
        raise HTTPException(status_code=404, detail="Data list not found")
    
    del data_lists[list_id]
    save_data_lists_to_file()
    
    return {
        "success": True,
        "message": "Data list deleted successfully"
    }

@app.post("/data-lists/{list_id}/distribute")
async def distribute_data_list(list_id: str, distribute: DataListDistribute):
    """Distribute email list across selected projects"""
    try:
        # Validate list exists
        if list_id not in data_lists:
            raise HTTPException(status_code=404, detail="Data list not found")
        
        data_list = data_lists[list_id]
        emails = data_list.get('emails', [])
        project_ids = distribute.projectIds
        
        if not project_ids:
            raise HTTPException(status_code=400, detail="No projects selected")
        
        if not emails:
            raise HTTPException(status_code=400, detail="Data list is empty")
        
        # Split emails equally across projects
        emails_per_project = len(emails) // len(project_ids)
        remainder = len(emails) % len(project_ids)
        
        distribution_results = []
        start_idx = 0
        
        for i, project_id in enumerate(project_ids):
            # Calculate chunk size (distribute remainder)
            chunk_size = emails_per_project + (1 if i < remainder else 0)
            email_chunk = emails[start_idx:start_idx + chunk_size]
            start_idx += chunk_size
            
            # Import to Firebase Auth
            if project_id not in firebase_apps:
                distribution_results.append({
                    "project_id": project_id,
                    "success": False,
                    "error": "Project not initialized",
                    "imported": 0
                })
                continue
            
            try:
                app = firebase_apps[project_id]
                imported = 0
                failed = 0
                
                # Import in batches of 1000 (Firebase limit)
                batch_size = 1000
                for j in range(0, len(email_chunk), batch_size):
                    batch_emails = email_chunk[j:j + batch_size]
                    batch_users = []
                    
                    for email in batch_emails:
                        uid = hashlib.md5(email.encode()).hexdigest()[:28]  # Valid UID
                        user_record = auth.ImportUserRecord(email=email, uid=uid)
                        batch_users.append(user_record)
                    
                    try:
                        result = auth.import_users(batch_users, app=app)
                        imported += result.success_count
                        failed += result.failure_count
                    except Exception as batch_error:
                        logger.error(f"Batch import failed for {project_id}: {batch_error}")
                        failed += len(batch_users)
                
                distribution_results.append({
                    "project_id": project_id,
                    "success": True,
                    "imported": imported,
                    "failed": failed,
                    "total": len(email_chunk)
                })
                
                logger.info(f"Distributed {imported} emails to {project_id}")
                
            except Exception as project_error:
                logger.error(f"Failed to distribute to {project_id}: {project_error}")
                distribution_results.append({
                    "project_id": project_id,
                    "success": False,
                    "error": str(project_error),
                    "imported": 0
                })
        
        total_imported = sum(r.get('imported', 0) for r in distribution_results)
        
        return {
            "success": True,
            "total_emails": len(emails),
            "total_imported": total_imported,
            "projects_count": len(project_ids),
            "results": distribution_results
        }
        
    except HTTPException as he:
        raise he
    except Exception as e:
        logger.error(f"Failed to distribute data list: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to distribute data list: {str(e)}")


# --- Test Email Management ---
TEST_EMAILS_FILE = "test_emails.json"

@app.get("/test-emails")
async def get_test_emails():
    """Get list of saved test emails"""
    try:
        data = {"emails": []}
        if os.path.exists(TEST_EMAILS_FILE):
            with open(TEST_EMAILS_FILE, 'r') as f:
                data = json.load(f)
        return data
    except Exception as e:
        logger.error(f"Failed to load test emails: {e}")
        return {"emails": []}

class TestEmailRequest(BaseModel):
    email: str

@app.post("/test-emails")
async def save_test_email(request: TestEmailRequest):
    """Save a new test email if it doesn't exist"""
    try:
        email = request.email
        if not email:
            raise HTTPException(status_code=400, detail="Email is required")
            
        emails = []
        if os.path.exists(TEST_EMAILS_FILE):
            with open(TEST_EMAILS_FILE, 'r') as f:
                try:
                    data = json.load(f)
                    emails = data.get('emails', [])
                except json.JSONDecodeError:
                    emails = []
        
        if email not in emails:
            emails.append(email)
            # Keep only last 20 emails
            if len(emails) > 20:
                emails = emails[-20:]
                
            with open(TEST_EMAILS_FILE, 'w') as f:
                json.dump({"emails": emails}, f)
                
        return {"success": True, "emails": emails}
    except Exception as e:
        logger.error(f"Failed to save test email: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/test-emails/{email}")
async def delete_test_email(email: str):
    """Delete a test email"""
    try:
        if os.path.exists(TEST_EMAILS_FILE):
            with open(TEST_EMAILS_FILE, 'r') as f:
                try:
                    data = json.load(f)
                    emails = data.get('emails', [])
                except json.JSONDecodeError:
                    return {"success": True}
            
            if email in emails:
                emails.remove(email)
                with open(TEST_EMAILS_FILE, 'w') as f:
                    json.dump({"emails": emails}, f)
                    
        return {"success": True}
    except Exception as e:
        logger.error(f"Failed to delete test email: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    


# ============================================================================
# DATA LIST MANAGEMENT ENDPOINTS
# ============================================================================

def get_current_user_from_request(request: Request) -> str:
    """Helper to get current user from request (Simplified)"""
    # In a real app, parse Authorization header or session cookie
    # For this local tool, we default to 'admin' or try to parse basic auth if present
    try:
        auth_header = request.headers.get('Authorization')
        if auth_header and auth_header.startswith('Basic '):
            import base64
            encoded = auth_header.split(' ')[1]
            decoded = base64.b64decode(encoded).decode('utf-8')
            username, _ = decoded.split(':', 1)
            return username
    except:
        pass
    return "admin"

@app.post("/data-lists")
async def create_data_list(data_list: DataListCreate, request: Request):
    """Create a new data list with metadata"""
    try:
        current_user = get_current_user_from_request(request)
        list_id = str(uuid.uuid4())
        
        # Validate emails
        valid_emails = [email.strip() for email in data_list.emails if email.strip() and '@' in email]
        
        list_data = {
            "id": list_id,
            "name": data_list.name,
            "isp": data_list.isp,
            "geo": data_list.geo,
            "status": data_list.status,
            "email_count": len(valid_emails),
            "emails": valid_emails,
            "created_at": datetime.now().isoformat(),
            "uploaded_by": current_user
        }
        
        data_lists[list_id] = list_data
        save_data_lists_to_file()
        
        logger.info(f"Created data list {list_id} with {len(valid_emails)} emails by {current_user}")
        
        return {
            "success": True,
            "list_id": list_id,
            "email_count": len(valid_emails)
        }
        
    except Exception as e:
        logger.error(f"Failed to create data list: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to create data list: {str(e)}")

@app.get("/data-lists")
async def list_data_lists(
    request: Request,
    isp: Optional[str] = None,
    geo: Optional[str] = None,
    status: Optional[str] = None
):
    """List all data lists with optional filtering"""
    try:
        current_user = get_current_user_from_request(request)
        
        # Get all lists
        lists = list(data_lists.values())
        
        # Apply filters
        if isp:
            lists = [l for l in lists if l.get('isp') == isp]
        if geo:
            lists = [l for l in lists if l.get('geo') == geo]
        if status:
            lists = [l for l in lists if l.get('status') == status]
        
        # Remove email arrays from response for performance (only metadata)
        lists_meta = []
        for l in lists:
            meta = {k: v for k, v in l.items() if k != 'emails'}
            lists_meta.append(meta)
        
        return {
            "success": True,
            "data_lists": lists_meta,
            "total": len(lists_meta)
        }
        
    except Exception as e:
        logger.error(f"Failed to list data lists: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to list data lists: {str(e)}")

@app.get("/data-lists/{list_id}")
async def get_data_list(list_id: str):
    """Get a specific data list by ID"""
    if list_id not in data_lists:
        raise HTTPException(status_code=404, detail="Data list not found")
    
    return {
        "success": True,
        "data_list": data_lists[list_id]
    }

@app.delete("/data-lists/{list_id}")
async def delete_data_list(list_id: str):
    """Delete a data list"""
    if list_id not in data_lists:
        raise HTTPException(status_code=404, detail="Data list not found")
    
    del data_lists[list_id]
    save_data_lists_to_file()
    
    return {
        "success": True,
        "message": "Data list deleted successfully"
    }

@app.post("/data-lists/{list_id}/distribute")
async def distribute_data_list(list_id: str, distribute: DataListDistribute):
    """Distribute email list across selected projects"""
    try:
        # Validate list exists
        if list_id not in data_lists:
            raise HTTPException(status_code=404, detail="Data list not found")
        
        data_list = data_lists[list_id]
        emails = data_list.get('emails', [])
        project_ids = distribute.projectIds
        
        if not project_ids:
            raise HTTPException(status_code=400, detail="No projects selected")
        
        if not emails:
            raise HTTPException(status_code=400, detail="Data list is empty")
        
        # Split emails equally across projects
        emails_per_project = len(emails) // len(project_ids)
        remainder = len(emails) % len(project_ids)
        
        distribution_results = []
        start_idx = 0
        
        for i, project_id in enumerate(project_ids):
            # Calculate chunk size (distribute remainder)
            chunk_size = emails_per_project + (1 if i < remainder else 0)
            email_chunk = emails[start_idx:start_idx + chunk_size]
            start_idx += chunk_size
            
            # Import to Firebase Auth
            if project_id not in firebase_apps:
                distribution_results.append({
                    "project_id": project_id,
                    "success": False,
                    "error": "Project not initialized",
                    "imported": 0
                })
                continue
            
            try:
                app = firebase_apps[project_id]
                imported = 0
                failed = 0
                
                # Import in batches of 1000 (Firebase limit)
                batch_size = 1000
                for j in range(0, len(email_chunk), batch_size):
                    batch_emails = email_chunk[j:j + batch_size]
                    batch_users = []
                    
                    for email in batch_emails:
                        uid = hashlib.md5(email.encode()).hexdigest()[:28]  # Valid UID
                        user_record = auth.ImportUserRecord(email=email, uid=uid)
                        batch_users.append(user_record)
                    
                    try:
                        result = auth.import_users(batch_users, app=app)
                        imported += result.success_count
                        failed += result.failure_count
                    except Exception as batch_error:
                        logger.error(f"Batch import failed for {project_id}: {batch_error}")
                        failed += len(batch_users)
                
                distribution_results.append({
                    "project_id": project_id,
                    "success": True,
                    "imported": imported,
                    "failed": failed,
                    "total": len(email_chunk)
                })
                
                logger.info(f"Distributed {imported} emails to {project_id}")
                
            except Exception as project_error:
                logger.error(f"Failed to distribute to {project_id}: {project_error}")
                distribution_results.append({
                    "project_id": project_id,
                    "success": False,
                    "error": str(project_error),
                    "imported": 0
                })
        
        total_imported = sum(r.get('imported', 0) for r in distribution_results)
        
        return {
            "success": True,
            "total_emails": len(emails),
            "total_imported": total_imported,
            "projects_count": len(project_ids),
            "results": distribution_results
        }
        
    except HTTPException as he:
        raise he
    except Exception as e:
        logger.error(f"Failed to distribute data list: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to distribute data list: {str(e)}")


@app.get("/campaigns/{campaign_id}/logs")
async def get_campaign_logs(campaign_id: str, limit: int = 50, offset: int = 0, status: str = None):
    """
    Fetch paginated logs from PostgreSQL for high-volume campaigns.
    Replaces the need to load 1M+ items into memory.
    """
    try:
        conn = get_db_connection()
        if not conn:
            return {"logs": [], "total": 0, "error": "Database not connected"}
            
        cursor = conn.cursor()
        
        # Base Query
        query = "SELECT log.email, log.status, log.error_message, log.attempted_at FROM campaign_logs log WHERE log.campaign_id = %s"
        params = [campaign_id]
        
        # Optional Filter
        if status:
            query += " AND log.status = %s"
            params.append(status)
            
        # Count Total for Pagination
        count_query = f"SELECT COUNT(*) FROM campaign_logs WHERE campaign_id = %s {'AND status = %s' if status else ''}"
        cursor.execute(count_query, params)
        total_count = cursor.fetchone()['count']
        
        # Fetch Page
        query += " ORDER BY log.attempted_at DESC LIMIT %s OFFSET %s"
        params.extend([limit, offset])
        
        cursor.execute(query, params)
        rows = cursor.fetchall()
        
        logs = []
        for row in rows:
            logs.append({
                "email": row['email'],
                "status": row['status'],
                "error": row['error_message'],
                "timestamp": str(row['attempted_at'])
            })
            
        cursor.close()
        conn.close()
        
        return {
            "logs": logs,
            "total": total_count,
            "limit": limit,
            "offset": offset
        }
        
    except Exception as e:
        logger.error(f"Failed to fetch logs: {e}")
        return {"logs": [], "total": 0, "error": str(e)}



# Startup: Hydrate Active Campaigns from DB
def load_active_campaigns_from_db():
    """Recover running state from DB on restart"""
    try:
        conn = get_db_connection()
        if not conn: return
        cursor = conn.cursor()
        
        # Fetch pending or running campaigns
        cursor.execute("""
            SELECT id, campaign_uuid, name, project_ids, batch_size, workers, template, 
                   status, processed, successful, failed, created_at, owner_id, 
                   sending_mode, turbo_config, throttle_config, schedule_config
            FROM campaigns 
            WHERE status IN ('pending', 'running')
        """)
        
        rows = cursor.fetchall()
        if not rows:
            logger.info("No active campaigns found in DB to recover.")
            conn.close()
            return

        cols = [desc[0] for desc in cursor.description]
        
        count = 0
        for row in rows:
            c = dict(zip(cols, row))
            c_uuid = c.get('campaign_uuid') or str(c['id'])
            
            # Reconstruct Object
            campaign_data = {
                "id": c_uuid,
                "db_id": c['id'],
                "name": c['name'],
                "projectIds": c['project_ids'] if isinstance(c['project_ids'], list) else json.loads(c['project_ids'] if c['project_ids'] else '[]'),
                "batchSize": c['batch_size'],
                "workers": c['workers'],
                "template": c['template'],
                "status": c['status'],
                "createdAt": c['created_at'].isoformat() if c['created_at'] else "",
                "processed": c['processed'],
                "successful": c['successful'],
                "failed": c['failed'],
                "ownerId": str(c['owner_id']), 
                "sending_mode": c.get('sending_mode', 'turbo'),
                "turbo_config": c['turbo_config'] if isinstance(c['turbo_config'], dict) else json.loads(c['turbo_config'] if c['turbo_config'] else '{}'),
                "projectStats": {}, 
                "errors": []
            }
            
            active_campaigns[c_uuid] = campaign_data
            count += 1
            
        logger.info(f"🔄 Recovered {count} active campaigns from Database.")
        conn.close()
    except Exception as e:
        logger.error(f"Failed to hydrate active campaigns: {e}")

# Startup: Recover Active State from Redis
def recover_state_from_redis():
    """
    On restart, scan Redis for any 'running' campaign stats 
    and hydrate the in-memory active_campaigns.
    """
    try:
        redis_host = os.getenv('REDIS_HOST', 'localhost')
        r = redis.Redis(host=redis_host, port=6379, db=0, decode_responses=True)
        
        # 1. Load known campaigns from file
        file_campaigns = load_campaigns_from_file()
        if not file_campaigns:
            logger.info("No campaigns in file to recover.")
            return

        # 2. Scan Redis for active stats
        # Pattern: campaign:{cid}:{pid}:stats
        cursor = '0'
        found_keys = []
        while cursor != 0:
            cursor, batch = r.scan(cursor=cursor, match='campaign:*:*:stats', count=100)
            found_keys.extend(batch)
            
        if not found_keys:
            logger.info("No active campaigns found in Redis.")
            return

        logger.info(f"🔄 Found {len(found_keys)} stat keys in Redis. recovering...")
        
        # 3. Update Memory
        count = 0
        for key in found_keys:
            # key: campaign:{cid}:{pid}:stats
            parts = key.split(':')
            if len(parts) != 4: continue
            
            c_id = parts[1]
            p_id = parts[2]
            
            # Fetch stats
            stats = r.hgetall(key)
            if not stats: continue
            
            succ = int(stats.get('successful', 0))
            fail = int(stats.get('failed', 0))
            
            # Find campaign in file data
            campaign = next((c for c in file_campaigns if c['id'] == c_id), None)
            
            if campaign:
                # Add to active_campaigns if not there
                if c_id not in active_campaigns:
                    active_campaigns[c_id] = campaign.copy()
                    # Ensure stats are initialized
                    if 'processed' not in active_campaigns[c_id]: active_campaigns[c_id]['processed'] = 0
                    if 'successful' not in active_campaigns[c_id]: active_campaigns[c_id]['successful'] = 0
                    if 'failed' not in active_campaigns[c_id]: active_campaigns[c_id]['failed'] = 0
                
                # Update Granular (Optional but good for monitor)
                mem_key = f"{c_id}_{p_id}"
                campaign_results[mem_key] = {
                    'project_id': p_id,
                    'successful': succ,
                    'failed': fail,
                    'status': 'running'
                }
                count += 1

        # 4. Trigger a recalc of totals
        for c_id, campaign in active_campaigns.items():
            t_succ = 0
            t_fail = 0
            for k, v in campaign_results.items():
                if k.startswith(f"{c_id}_"):
                    t_succ += v.get('successful', 0)
                    t_fail += v.get('failed', 0)
            
            if t_succ + t_fail > 0:
                campaign['successful'] = t_succ
                campaign['failed'] = t_fail
                campaign['processed'] = t_succ + t_fail
                logger.info(f"   -> Recovered {c_id}: {t_succ} sent, {t_fail} failed")

        logger.info(f"✅ Recovered state for {len(active_campaigns)} campaigns.")

    except Exception as e:
        logger.error(f"Failed to recover state from Redis: {e}")

# --- ENTERPRISE MONITORING ---
@app.on_event("startup")
async def startup_event():
    # 1. Initialize DB Tables (Try)
    db_available = False
    try:
        init_database()
        logger.info("✅ Database Schema Initialized")
        db_available = True
    except Exception as e:
        logger.warning(f"⚠️ DB Init Failed: {e}. Running in File-Only Mode.")
        
    # 2. Recover State (Hybrid)
    if db_available:
        try:
            load_active_campaigns_from_db()
        except Exception as e:
            logger.error(f"DB Recovery Failed: {e}")
            
    # Always run Redis/File recovery as a safety net (it merges/overlays)
    recover_state_from_redis()
    
    # 3. Start Redis Monitor
    logger.info("🚀 Starting Enterprise Redis Monitor...")
    threading.Thread(target=monitor_redis_progress, daemon=True).start()

def monitor_redis_progress():
    """Sync Redis stats to in-memory campaign_results and active_campaigns"""
    try:
        redis_host = os.getenv('REDIS_HOST', 'localhost')
        redis_port = int(os.getenv('REDIS_PORT', 6379))
        redis_db = int(os.getenv('REDIS_DB', 0))
        r = redis.Redis(host=redis_host, port=redis_port, db=redis_db, decode_responses=True)
        
        logger.info(f"✅ Monitor connected to Redis at {redis_host}:{redis_port}")
        
        while True:
            try:
                # Scan for active campaign project stats
                # Pattern: campaign:{campaign_id}:{project_id}:stats
                keys = []
                cursor = '0'
                while cursor != 0:
                    cursor, batch = r.scan(cursor=cursor, match='campaign:*:*:stats', count=500)
                    keys.extend(batch)
                
                if not keys:
                    time.sleep(2)
                    continue
                
                pipe = r.pipeline()
                for key in keys:
                    pipe.hgetall(key)
                results = pipe.execute()
                
                updated_campaign_ids = set()
                
                for key, data in zip(keys, results):
                    if not data: continue
                    parts = key.split(':')
                    # Expecting campaign:{cid}:{pid}:stats (4 parts)
                    if len(parts) != 4: continue
                    
                    c_id, p_id = parts[1], parts[2]
                    
                    succ = int(data.get('successful', 0))
                    fail = int(data.get('failed', 0))
                    
                    mem_key = f"{c_id}_{p_id}"
                    
                    # Ensure initialized in granular dict
                    if mem_key not in campaign_results:
                        campaign_results[mem_key] = {
                            'project_id': p_id, 
                            'successful': 0, 
                            'failed': 0, 
                            'total_users': 0,
                            'status': 'running'
                        }
                    
                    # Update Granular Stats
                    campaign_results[mem_key]['successful'] = succ
                    campaign_results[mem_key]['failed'] = fail
                    # If total_users is 0 (missing), we might want to infer it or leave it
                    # But crucially, we update success/fail which drives the progress bar
                    
                    updated_campaign_ids.add(c_id)

                # Aggregate for UI Summary
                for c_id in updated_campaign_ids:
                    total_succ = 0
                    total_fail = 0
                    
                    # Sum up all projects for this campaign
                    for k, v in campaign_results.items():
                        if k.startswith(f"{c_id}_"):
                            total_succ += v.get('successful', 0)
                            total_fail += v.get('failed', 0)
                    
                    # Update active_campaigns entry
                    if c_id in active_campaigns:
                        active_campaigns[c_id]['successful'] = total_succ
                        active_campaigns[c_id]['failed'] = total_fail
                        active_campaigns[c_id]['processed'] = total_succ + total_fail
                        
                        # Check Completion
                        total = active_campaigns[c_id].get('total_users', 0)
                        if total > 0 and (total_succ + total_fail) >= total:
                            if active_campaigns[c_id]['status'] != 'completed':
                                active_campaigns[c_id]['status'] = 'completed'
                                active_campaigns[c_id]['completedAt'] = datetime.now().isoformat()
                                logger.info(f"🏁 Campaign {c_id} completed via Redis Monitor")
                                save_campaigns_to_file()

            except Exception as e:
                logger.error(f"Redis Monitor Loop Error: {e}")
            
            time.sleep(1.0)
            
    except Exception as e:
        logger.error(f"Failed to start Redis Monitor: {e}")

if __name__ == "__main__":
    import uvicorn
    import os
    
    # Initialize database first
    if os.getenv('USE_DATABASE', 'false').lower() == 'true':
        try:
            init_database()
            logger.info("Database initialized successfully")
        except Exception as e:
            logger.error(f"Failed to initialize database: {e}")
            exit(1)
    else:
        logger.info("Skipping database initialization (USE_DATABASE is not true)")
    
    # Load initial data (only if not using database)
    if os.getenv('USE_DATABASE') != 'true':
        load_projects_from_file()
        load_campaigns_from_file()
        load_daily_counts()
        load_campaign_results_from_file()
        load_profiles_from_file()
    
    # Always load AI keys and service account (still file-based)
    load_ai_keys()
    load_admin_service_account()
    
    # Start the daily reset thread
    reset_daily_counts_at_midnight()
    
    logger.info("Starting Firebase Campaign Backend...")
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
