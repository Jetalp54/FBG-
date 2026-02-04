"""
Enterprise Firebase Manager Backend Server
PostgreSQL-based backend for production deployment
"""

import os
import asyncio
import logging
import structlog
from fastapi import FastAPI, HTTPException, Request, Depends, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.security import HTTPBearer
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
import firebase_admin
from firebase_admin import credentials, auth
import pyrebase
from datetime import datetime, timedelta
import jwt
from passlib.context import CryptContext
import redis.asyncio as redis
from prometheus_client import Counter, Histogram, Gauge
import time
import json

# Import our database modules
from src.database.connection import db_manager, get_db, get_db_pool
from src.database.models import Base

# Configure structured logging
structlog.configure(
    processors=[
        structlog.stdlib.filter_by_level,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.stdlib.PositionalArgumentsFormatter(),
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        structlog.processors.UnicodeDecoder(),
        structlog.processors.JSONRenderer()
    ],
    context_class=dict,
    logger_factory=structlog.stdlib.LoggerFactory(),
    wrapper_class=structlog.stdlib.BoundLogger,
    cache_logger_on_first_use=True,
)

logger = structlog.get_logger()

# Create FastAPI app
app = FastAPI(
    title="Firebase Manager Enterprise Server",
    version="3.0.0",
    description="Enterprise-grade Firebase project and campaign management system",
    docs_url="/docs" if os.getenv("DEBUG", "false").lower() == "true" else None,
    redoc_url="/redoc" if os.getenv("DEBUG", "false").lower() == "true" else None
)

# Security middleware
app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=["*"]  # Configure this properly for production
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure this properly for production
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# Rate limiting
limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Security
security = HTTPBearer()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Redis client
redis_client = None

# Prometheus metrics
CAMPAIGN_CREATED = Counter('campaigns_created_total', 'Total campaigns created')
CAMPAIGN_PROCESSING_TIME = Histogram('campaign_processing_seconds', 'Time spent processing campaigns')
ACTIVE_CAMPAIGNS = Gauge('active_campaigns', 'Number of currently active campaigns')
ACTIVE_USERS = Gauge('active_users', 'Number of currently active users')

# Global storage for Firebase apps
firebase_apps = {}
pyrebase_apps = {}

@app.on_event("startup")
async def startup_event():
    """Initialize services on startup"""
    global redis_client
    
    try:
        # Initialize database
        await db_manager.initialize()
        logger.info("Database initialized successfully")
        
        # Initialize Redis
        redis_host = os.getenv("REDIS_HOST", "localhost")
        redis_port = int(os.getenv("REDIS_PORT", "6379"))
        redis_password = os.getenv("REDIS_PASSWORD", "")
        
        redis_client = redis.Redis(
            host=redis_host,
            port=redis_port,
            password=redis_password if redis_password else None,
            decode_responses=True
        )
        
        # Test Redis connection
        await redis_client.ping()
        logger.info("Redis connected successfully")
        
        # Load existing Firebase projects
        await load_firebase_projects()
        logger.info("Firebase projects loaded successfully")
        
    except Exception as e:
        logger.error(f"Startup failed: {e}")
        raise

@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown"""
    try:
        await db_manager.close()
        if redis_client:
            await redis_client.close()
        logger.info("Services shutdown successfully")
    except Exception as e:
        logger.error(f"Shutdown error: {e}")

async def load_firebase_projects():
    """Load existing Firebase projects from database"""
    try:
        async with db_manager.get_pool_connection() as conn:
            projects = await conn.fetch("""
                SELECT id, name, service_account FROM projects WHERE is_active = true
            """)
            
            for project in projects:
                try:
                    service_account = project['service_account']
                    if isinstance(service_account, str):
                        service_account = json.loads(service_account)
                    
                    # Initialize Firebase Admin SDK
                    cred = credentials.Certificate(service_account)
                    firebase_app = firebase_admin.initialize_app(cred, name=project['id'])
                    firebase_apps[project['id']] = firebase_app
                    
                    # Initialize Pyrebase
                    pyrebase_config = {
                        "apiKey": service_account.get("api_key"),
                        "authDomain": service_account.get("auth_domain"),
                        "projectId": service_account.get("project_id"),
                        "storageBucket": service_account.get("storage_bucket"),
                        "messagingSenderId": service_account.get("messaging_sender_id"),
                        "appId": service_account.get("client_id")
                    }
                    
                    pyrebase_app = pyrebase.initialize_app(pyrebase_config)
                    pyrebase_apps[project['id']] = pyrebase_app
                    
                    logger.info(f"Loaded Firebase project: {project['name']}")
                    
                except Exception as e:
                    logger.error(f"Failed to load Firebase project {project['name']}: {e}")
                    
    except Exception as e:
        logger.error(f"Failed to load Firebase projects: {e}")

# Authentication functions
def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a password against its hash"""
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password: str) -> str:
    """Hash a password"""
    return pwd_context.hash(password)

async def authenticate_user(username: str, password: str):
    """Authenticate a user"""
    try:
        async with db_manager.get_pool_connection() as conn:
            user = await conn.fetchrow("""
                SELECT id, username, email, password_hash, role, is_active 
                FROM app_users 
                WHERE username = $1 AND is_active = true
            """, username)
            
            if not user:
                return None
            
            if not verify_password(password, user['password_hash']):
                return None
            
            return dict(user)
            
    except Exception as e:
        logger.error(f"Authentication error: {e}")
        return None

def create_access_token(data: dict, expires_delta: timedelta = None):
    """Create JWT access token"""
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=15)
    
    to_encode.update({"exp": expire})
    secret_key = os.getenv("JWT_SECRET_KEY", "your-secret-key")
    encoded_jwt = jwt.encode(to_encode, secret_key, algorithm="HS256")
    return encoded_jwt

async def get_current_user(token: str = Depends(security)):
    """Get current authenticated user"""
    try:
        secret_key = os.getenv("JWT_SECRET_KEY", "your-secret-key")
        payload = jwt.decode(token.credentials, secret_key, algorithms=["HS256"])
        username: str = payload.get("sub")
        if username is None:
            raise HTTPException(status_code=401, detail="Invalid token")
            
        async with db_manager.get_pool_connection() as conn:
            user = await conn.fetchrow("""
                SELECT id, username, email, role, is_active 
                FROM app_users 
                WHERE username = $1 AND is_active = true
            """, username)
            
            if not user:
                raise HTTPException(status_code=401, detail="User not found")
                
            return dict(user)
            
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")
    except Exception as e:
        logger.error(f"Token validation error: {e}")
        raise HTTPException(status_code=401, detail="Invalid token")

async def get_user_permissions(user_id: str):
    """Get user permissions"""
    try:
        async with db_manager.get_pool_connection() as conn:
            permissions = await conn.fetch("""
                SELECT permission_name, is_granted 
                FROM user_permissions 
                WHERE user_id = $1 AND is_granted = true
            """, user_id)
            
            return {perm['permission_name']: perm['is_granted'] for perm in permissions}
            
    except Exception as e:
        logger.error(f"Failed to get user permissions: {e}")
        return {}

# Health check endpoint
@app.get("/health")
async def health_check():
    """Health check endpoint"""
    try:
        # Check database
        db_healthy = await check_database_health()
        
        # Check Redis
        redis_healthy = False
        if redis_client:
            try:
                await redis_client.ping()
                redis_healthy = True
            except:
                pass
        
        return {
            "status": "healthy" if db_healthy and redis_healthy else "unhealthy",
            "timestamp": datetime.utcnow().isoformat(),
            "services": {
                "database": "healthy" if db_healthy else "unhealthy",
                "redis": "healthy" if redis_healthy else "unhealthy",
                "firebase_projects": len(firebase_apps)
            }
        }
        
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return {
            "status": "unhealthy",
            "error": str(e),
            "timestamp": datetime.utcnow().isoformat()
        }

# Authentication endpoints
@app.post("/auth/login")
@limiter.limit("10/minute")
async def login(request: Request, username: str, password: str):
    """User login endpoint"""
    try:
        user = await authenticate_user(username, password)
        if not user:
            raise HTTPException(status_code=401, detail="Invalid credentials")
        
        # Get user permissions
        permissions = await get_user_permissions(user['id'])
        
        # Create access token
        access_token_expires = timedelta(minutes=int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "30")))
        access_token = create_access_token(
            data={"sub": user['username']}, 
            expires_delta=access_token_expires
        )
        
        # Update metrics
        ACTIVE_USERS.inc()
        
        logger.info(f"User logged in: {username}")
        
        return {
            "access_token": access_token,
            "token_type": "bearer",
            "user": {
                "id": user['id'],
                "username": user['username'],
                "email": user['email'],
                "role": user['role']
            },
            "permissions": permissions
        }
        
    except Exception as e:
        logger.error(f"Login error: {e}")
        raise HTTPException(status_code=500, detail="Login failed")

@app.post("/auth/forgot-password")
@limiter.limit("5/minute")
async def forgot_password(request: Request, username: str):
    """Password reset request endpoint"""
    try:
        # Implementation for password reset
        # This would send an email with reset link
        return {"message": "If the username exists, a reset email has been sent"}
        
    except Exception as e:
        logger.error(f"Forgot password error: {e}")
        raise HTTPException(status_code=500, detail="Failed to process request")

@app.post("/auth/reset-password")
@limiter.limit("5/minute")
async def reset_password(request: Request, username: str, token: str, new_password: str):
    """Password reset endpoint"""
    try:
        # Implementation for password reset
        # This would validate token and update password
        return {"message": "Password reset successfully"}
        
    except Exception as e:
        logger.error(f"Reset password error: {e}")
        raise HTTPException(status_code=500, detail="Failed to reset password")

# Projects endpoints
@app.get("/projects")
@limiter.limit("100/minute")
async def list_projects(
    request: Request,
    current_user: dict = Depends(get_current_user),
    search: str = None,
    limit: int = 50,
    offset: int = 0
):
    """List projects with pagination and search"""
    try:
        start_time = time.time()
        
        # Get user permissions
        permissions = await get_user_permissions(current_user['id'])
        if 'projects' not in permissions:
            raise HTTPException(status_code=403, detail="Access denied")
        
        # Build query
        query = """
            SELECT p.*, u.username as owner_username
            FROM projects p
            JOIN app_users u ON p.owner_id = u.id
            WHERE p.is_active = true
        """
        params = []
        param_count = 0
        
        # Add ownership filter (admin sees all, users see only their own)
        if current_user['role'] != 'admin':
            query += f" AND p.owner_id = ${param_count + 1}"
            params.append(current_user['id'])
            param_count += 1
        
        # Add search filter
        if search:
            query += f" AND (p.name ILIKE ${param_count + 1} OR p.admin_email ILIKE ${param_count + 1})"
            search_term = f"%{search}%"
            params.append(search_term)
            param_count += 1
        
        # Add pagination
        query += f" ORDER BY p.created_at DESC LIMIT ${param_count + 1} OFFSET ${param_count + 2}"
        params.extend([limit, offset])
        
        # Execute query
        async with db_manager.get_pool_connection() as conn:
            projects = await conn.fetch(query, *params)
            
            # Get total count
            count_query = """
                SELECT COUNT(*) FROM projects p
                WHERE p.is_active = true
            """
            count_params = []
            
            if current_user['role'] != 'admin':
                count_query += " AND p.owner_id = $1"
                count_params.append(current_user['id'])
            
            if search:
                count_query += " AND (p.name ILIKE $2 OR p.admin_email ILIKE $2)"
                count_params.append(f"%{search}%")
            
            total = await conn.fetchval(count_query, *count_params)
            
            # Format response
            result = []
            for project in projects:
                project_dict = dict(project)
                project_dict['status'] = 'active' if project['id'] in firebase_apps else 'error'
                result.append(project_dict)
            
            processing_time = time.time() - start_time
            logger.info(f"Projects listed in {processing_time:.3f}s", 
                       user=current_user['username'], 
                       count=len(result))
            
            return {
                "projects": result,
                "total": total,
                "limit": limit,
                "offset": offset,
                "processing_time": processing_time
            }
            
    except Exception as e:
        logger.error(f"Failed to list projects: {e}")
        raise HTTPException(status_code=500, detail="Failed to list projects")

@app.post("/projects")
@limiter.limit("50/minute")
async def create_project(
    request: Request,
    project_data: dict,
    current_user: dict = Depends(get_current_user)
):
    """Create a new project"""
    try:
        # Check permissions
        permissions = await get_user_permissions(current_user['id'])
        if 'projects' not in permissions:
            raise HTTPException(status_code=403, detail="Access denied")
        
        # Validate project data
        required_fields = ['name', 'adminEmail', 'serviceAccount', 'apiKey']
        for field in required_fields:
            if field not in project_data:
                raise HTTPException(status_code=400, detail=f"Missing required field: {field}")
        
        # Extract project ID from service account
        service_account = project_data['serviceAccount']
        if isinstance(service_account, str):
            service_account = json.loads(service_account)
        
        project_id = service_account.get('project_id')
        if not project_id:
            raise HTTPException(status_code=400, detail="Invalid service account: missing project_id")
        
        # Check if project already exists
        async with db_manager.get_pool_connection() as conn:
            existing = await conn.fetchrow(
                "SELECT id FROM projects WHERE id = $1",
                project_id
            )
            
            if existing:
                raise HTTPException(status_code=409, detail="Project already exists")
            
            # Create project
            await conn.execute("""
                INSERT INTO projects (id, name, admin_email, service_account, api_key, owner_id, created_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
            """,
            project_id,
            project_data['name'],
            project_data['adminEmail'],
            json.dumps(service_account),
            project_data['apiKey'],
            current_user['id'],
            datetime.now()
            )
            
            # Initialize Firebase app
            try:
                cred = credentials.Certificate(service_account)
                firebase_app = firebase_admin.initialize_app(cred, name=project_id)
                firebase_apps[project_id] = firebase_app
                
                # Initialize Pyrebase
                pyrebase_config = {
                    "apiKey": service_account.get("api_key"),
                    "authDomain": service_account.get("auth_domain"),
                    "projectId": service_account.get("project_id"),
                    "storageBucket": service_account.get("storage_bucket"),
                    "messagingSenderId": service_account.get("messaging_sender_id"),
                    "appId": service_account.get("client_id")
                }
                
                pyrebase_app = pyrebase.initialize_app(pyrebase_config)
                pyrebase_apps[project_id] = pyrebase_app
                
                logger.info(f"Project created and initialized: {project_data['name']}")
                
            except Exception as e:
                logger.error(f"Failed to initialize Firebase for project {project_id}: {e}")
                # Project is created but Firebase initialization failed
        
        return {
            "success": True,
            "message": "Project created successfully",
            "project_id": project_id
        }
        
    except Exception as e:
        logger.error(f"Failed to create project: {e}")
        raise HTTPException(status_code=500, detail="Failed to create project")

# Add more endpoints for campaigns, users, etc.
# This is a foundation - you can add the rest based on your needs

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "src.server.enterprise_backend:app",
        host=os.getenv("SERVER_HOST", "0.0.0.0"),
        port=int(os.getenv("SERVER_PORT", "8000")),
        reload=os.getenv("DEBUG", "false").lower() == "true"
    )
