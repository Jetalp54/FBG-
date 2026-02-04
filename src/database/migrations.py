"""
Database Migration Script
Creates tables and migrates data from JSON files to PostgreSQL
"""

import asyncio
import json
import os
import logging
from datetime import datetime
from src.database.connection import db_manager
from src.database.models import Base
from sqlalchemy import text

logger = logging.getLogger(__name__)

async def create_tables():
    """Create all database tables"""
    try:
        async with db_manager.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        logger.info("Database tables created successfully")
    except Exception as e:
        logger.error(f"Failed to create tables: {e}")
        raise

async def migrate_app_users():
    """Migrate app users from JSON to database"""
    try:
        if not os.path.exists('app_users.json'):
            logger.warning("app_users.json not found, skipping migration")
            return
        
        with open('app_users.json', 'r') as f:
            users_data = json.load(f)
        
        users = users_data.get('users', [])
        if not users:
            logger.warning("No users found in app_users.json")
            return
        
        conn = await db_manager.get_pool_connection()
        try:
            for user in users:
                # Check if user already exists
                existing = await conn.fetchrow(
                    "SELECT id FROM app_users WHERE username = $1",
                    user.get('username')
                )
                
                if not existing:
                    await conn.execute("""
                        INSERT INTO app_users (username, email, password_hash, role, is_active, created_at)
                        VALUES ($1, $2, $3, $4, $5, $6)
                    """, 
                    user.get('username'),
                    user.get('email'),
                    user.get('password_hash'),
                    user.get('role', 'user'),
                    True,
                    datetime.now()
                    )
                    
                    # Get the user ID for permissions
                    user_id = await conn.fetchval(
                        "SELECT id FROM app_users WHERE username = $1",
                        user.get('username')
                    )
                    
                    # Migrate permissions
                    if user_id:
                        await migrate_user_permissions(conn, user_id, user)
        finally:
            await db_manager.release_pool_connection(conn)
        
        logger.info(f"Migrated {len(users)} app users successfully")
        
    except Exception as e:
        logger.error(f"Failed to migrate app users: {e}")
        raise

async def migrate_user_permissions(conn, user_id: str, user_data: dict):
    """Migrate user permissions"""
    try:
        # Default permissions based on role
        default_permissions = {
            'admin': ['projects', 'users', 'campaigns', 'templates', 'ai', 'test', 'profiles', 'auditLogs', 'settings', 'smtp'],
            'it': ['projects', 'users', 'campaigns', 'templates', 'ai', 'test', 'profiles', 'auditLogs'],
            'user': ['projects', 'campaigns', 'profiles']
        }
        
        role = user_data.get('role', 'user')
        permissions = default_permissions.get(role, [])
        
        # Add any custom permissions from overrides
        if 'overrides' in user_data:
            for perm_name, is_granted in user_data['overrides'].items():
                if is_granted and perm_name not in permissions:
                    permissions.append(perm_name)
        
                            # Insert permissions
                    for perm_name in permissions:
                        await conn.execute("""
                            INSERT INTO user_permissions (user_id, permission_name, is_granted, created_at)
                            VALUES ($1, $2, $3, $4)
                        """,
                        user_id,
                        perm_name,
                        True,
                        datetime.now()
                        )
        
        logger.info(f"Migrated permissions for user {user_data.get('username')}")
        
    except Exception as e:
        logger.error(f"Failed to migrate permissions for user {user_data.get('username')}: {e}")

async def migrate_profiles():
    """Migrate profiles from JSON to database"""
    try:
        if not os.path.exists('profiles.json'):
            logger.warning("profiles.json not found, skipping migration")
            return
        
        with open('profiles.json', 'r') as f:
            profiles_data = json.load(f)
        
        profiles = profiles_data if isinstance(profiles_data, list) else []
        if not profiles:
            logger.warning("No profiles found in profiles.json")
            return
        
        conn = await db_manager.get_pool_connection()
        try:
            for profile in profiles:
                # Get owner ID
                owner_username = profile.get('ownerId', 'admin')
                owner = await conn.fetchrow(
                    "SELECT id FROM app_users WHERE username = $1",
                    owner_username
                )
                
                if owner:
                    # Check if profile already exists
                    existing = await conn.fetchrow(
                        "SELECT id FROM profiles WHERE name = $1 AND owner_id = $2",
                        profile.get('name'),
                        owner['id']
                    )
                    
                    if not existing:
                        await conn.execute("""
                            INSERT INTO profiles (name, description, owner_id, created_at)
                            VALUES ($1, $2, $3, $4)
                        """,
                        profile.get('name'),
                        profile.get('description'),
                        owner['id'],
                        datetime.now()
                        )
        finally:
            await db_manager.release_pool_connection(conn)
        
        logger.info(f"Migrated {len(profiles)} profiles successfully")
        
    except Exception as e:
        logger.error(f"Failed to migrate profiles: {e}")
        raise

async def migrate_projects():
    """Migrate projects from JSON to database"""
    try:
        if not os.path.exists('projects.json'):
            logger.warning("projects.json not found, skipping migration")
            return
        
        with open('projects.json', 'r') as f:
            projects_data = json.load(f)
        
        projects = projects_data if isinstance(projects_data, list) else []
        if not projects:
            logger.warning("No projects found in projects.json")
            return
        
        conn = await db_manager.get_pool_connection()
        try:
            for project in projects:
                # Get owner ID
                owner_username = project.get('ownerId', 'admin')
                owner = await conn.fetchrow(
                    "SELECT id FROM app_users WHERE username = $1",
                    owner_username
                )
                
                if owner:
                    # Check if project already exists
                    project_id = project.get('serviceAccount', {}).get('project_id')
                    if project_id:
                        existing = await conn.fetchrow(
                            "SELECT id FROM projects WHERE id = $1",
                            project_id
                        )
                        
                        if not existing:
                            await conn.execute("""
                                INSERT INTO projects (id, name, admin_email, service_account, api_key, owner_id, created_at)
                                VALUES ($1, $2, $3, $4, $5, $6)
                            """,
                            project_id,
                            project.get('name'),
                            project.get('adminEmail'),
                            json.dumps(project.get('serviceAccount')),
                            project.get('apiKey'),
                            owner['id']
                            )
        finally:
            await db_manager.release_pool_connection(conn)
        
        logger.info(f"Migrated {len(projects)} projects successfully")
        
    except Exception as e:
        logger.error(f"Failed to migrate projects: {e}")
        raise

async def migrate_campaigns():
    """Migrate campaigns from JSON to database"""
    try:
        if not os.path.exists('campaigns.json'):
            logger.warning("campaigns.json not found, skipping migration")
            return
        
        with open('campaigns.json', 'r') as f:
            campaigns_data = json.load(f)
        
        campaigns = campaigns_data if isinstance(campaigns_data, list) else []
        if not campaigns:
            logger.warning("No campaigns found in campaigns.json")
            return
        
        conn = await db_manager.get_pool_connection()
        try:
            for campaign in campaigns:
                # Get owner ID
                owner_username = campaign.get('ownerId', 'admin')
                owner = await conn.fetchrow(
                    "SELECT id FROM app_users WHERE username = $1",
                    owner_username
                )
                
                if owner:
                    # Check if campaign already exists
                    existing = await conn.fetchrow(
                        "SELECT id FROM campaigns WHERE name = $1 AND owner_id = $2",
                        campaign.get('name'),
                        owner['id']
                    )
                    
                    if not existing:
                        await conn.execute("""
                            INSERT INTO campaigns (id, name, project_id, batch_size, workers, template, status, owner_id, created_at)
                            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                        """,
                        campaign.get('id', None),
                        campaign.get('name'),
                        campaign.get('projectId'),  # This should be updated to use actual project ID
                        100,  # Default batch size
                        5,    # Default workers
                        campaign.get('template'),
                        'draft',
                        owner['id']
                        )
        finally:
            await db_manager.release_pool_connection(conn)
        
        logger.info(f"Migrated {len(campaigns)} campaigns successfully")
        
    except Exception as e:
        logger.error(f"Failed to migrate campaigns: {e}")
        raise

async def create_default_admin():
    """Create default admin user if none exists"""
    try:
        conn = await db_manager.get_pool_connection()
        try:
            # Check if admin exists
            admin = await conn.fetchrow(
                "SELECT id FROM app_users WHERE username = 'admin'"
            )
            
            if not admin:
                # Create admin user
                admin_id = await conn.fetchval("""
                    INSERT INTO app_users (username, email, password_hash, role, is_active, created_at)
                    VALUES ($1, $2, $3, $4, $5, $6)
                    RETURNING id
                """,
                'admin',
                'admin@firebase-manager.com',
                '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj/RK.s5u.Ge',  # Default: admin
                'admin',
                True,
                datetime.now()
                )
                
                # Create admin permissions
                admin_permissions = ['projects', 'users', 'campaigns', 'templates', 'ai', 'test', 'profiles', 'auditLogs', 'settings', 'smtp']
                
                for perm_name in admin_permissions:
                    await conn.execute("""
                        INSERT INTO user_permissions (user_id, permission_name, is_granted, created_at)
                        VALUES ($1, $2, $3, $4)
                    """,
                    admin_id,
                    perm_name,
                    True,
                    datetime.now()
                    )
                
                logger.info("Default admin user created successfully")
            else:
                logger.info("Admin user already exists")
        finally:
            await db_manager.release_pool_connection(conn)
                
    except Exception as e:
        logger.error(f"Failed to create default admin: {e}")
        raise

async def run_migrations():
    """Run all database migrations"""
    try:
        logger.info("Starting database migrations...")
        
        # Initialize database connection
        await db_manager.initialize()
        
        # Create tables
        await create_tables()
        
        # Create default admin user
        await create_default_admin()
        
        # Migrate existing data
        await migrate_app_users()
        await migrate_profiles()
        await migrate_projects()
        await migrate_campaigns()
        
        logger.info("Database migrations completed successfully!")
        
    except Exception as e:
        logger.error(f"Migration failed: {e}")
        raise
    finally:
        await db_manager.close()

if __name__ == "__main__":
    asyncio.run(run_migrations())
