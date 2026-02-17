import os
from celery import Celery
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Redis Configuration (Default to localhost for local dev, override in env for prod)
REDIS_HOST = os.getenv('REDIS_HOST', 'localhost')
REDIS_PORT = os.getenv('REDIS_PORT', '6379')
REDIS_DB = os.getenv('REDIS_DB', '0')
REDIS_URL = f"redis://{REDIS_HOST}:{REDIS_PORT}/{REDIS_DB}"

# Create Celery App
celery_app = Celery(
    'firebase_manager',
    broker=REDIS_URL,
    backend=REDIS_URL,
    include=['src.utils.celery_tasks']
)

# Enterprise Configuration for High Performance
celery_app.conf.update(
    task_serializer='json',
    accept_content=['json'],
    result_serializer='json',
    timezone='UTC',
    enable_utc=True,
    
    # Task Execution Settings
    task_acks_late=True,  # Ensure task is acknowledged only after completion
    worker_prefetch_multiplier=1,  # Prevent worker from hogging tasks
    
    # Connection Settings
    broker_connection_retry_on_startup=True,
    
    # Rate Limiting (Optional default)
    task_default_rate_limit='100/s',
)

if __name__ == '__main__':
    celery_app.start()
