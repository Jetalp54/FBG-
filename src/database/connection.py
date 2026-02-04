"""
Database Connection Manager for PostgreSQL
Handles connection pooling and async operations
"""

import os
import asyncpg
import asyncio
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool
from typing import Optional
import logging

logger = logging.getLogger(__name__)

class DatabaseManager:
    def __init__(self):
        self.engine = None
        self.async_session = None
        self.pool = None
        self._initialized = False
    
    async def initialize(self):
        """Initialize database connections"""
        if self._initialized:
            return
        
        try:
            # Load environment variables
            db_host = os.getenv("DB_HOST", "localhost")
            db_port = int(os.getenv("DB_PORT", "5432"))
            db_name = os.getenv("DB_NAME", "firebase_manager")
            db_user = os.getenv("DB_USER", "emedia")
            db_password = os.getenv("DB_PASSWORD", "Batata010..++")
            
            # Create async engine for SQLAlchemy
            database_url = f"postgresql+asyncpg://{db_user}:{db_password}@{db_host}:{db_port}/{db_name}"
            
            self.engine = create_async_engine(
                database_url,
                echo=False,  # Set to True for SQL debugging
                poolclass=NullPool,  # We'll use asyncpg pool instead
                future=True
            )
            
            # Create session factory
            self.async_session = sessionmaker(
                self.engine,
                class_=AsyncSession,
                expire_on_commit=False
            )
            
            # Create asyncpg connection pool
            self.pool = await asyncpg.create_pool(
                host=db_host,
                port=db_port,
                database=db_name,
                user=db_user,
                password=db_password,
                min_size=5,
                max_size=50,
                command_timeout=60,
                server_settings={
                    'application_name': 'firebase_manager'
                }
            )
            
            self._initialized = True
            logger.info("Database connections initialized successfully")
            
        except Exception as e:
            logger.error(f"Failed to initialize database connections: {e}")
            raise
    
    async def get_session(self) -> AsyncSession:
        """Get a database session"""
        if not self._initialized:
            await self.initialize()
        return self.async_session()
    
    async def get_pool_connection(self):
        """Get a connection from the pool"""
        if not self._initialized:
            await self.initialize()
        return await self.pool.acquire()
    
    async def release_pool_connection(self, connection):
        """Release a connection back to the pool"""
        if self.pool:
            await self.pool.release(connection)
    
    async def execute_query(self, query: str, *args):
        """Execute a raw SQL query"""
        async with self.pool.acquire() as connection:
            return await connection.execute(query, *args)
    
    async def fetch_query(self, query: str, *args):
        """Fetch results from a raw SQL query"""
        async with self.pool.acquire() as connection:
            return await connection.fetch(query, *args)
    
    async def fetch_one(self, query: str, *args):
        """Fetch one result from a raw SQL query"""
        async with self.pool.acquire() as connection:
            return await connection.fetchrow(query, *args)
    
    async def close(self):
        """Close all database connections"""
        if self.engine:
            await self.engine.dispose()
        
        if self.pool:
            await self.pool.close()
        
        self._initialized = False
        logger.info("Database connections closed")

# Global database manager instance
db_manager = DatabaseManager()

async def get_db():
    """Dependency to get database session"""
    async with db_manager.get_session() as session:
        yield session

async def get_db_pool():
    """Dependency to get database pool connection"""
    return await db_manager.get_pool_connection()

# Health check function
async def check_database_health():
    """Check if database is accessible"""
    try:
        async with db_manager.get_pool_connection() as connection:
            await connection.execute("SELECT 1")
        return True
    except Exception as e:
        logger.error(f"Database health check failed: {e}")
        return False
