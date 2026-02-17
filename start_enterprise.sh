#!/bin/bash
echo "🚀 Starting Enterprise Firebase Manager..."

# 1. Check Redis
if ! command -v redis-server &> /dev/null; then
    echo "❌ Redis is not installed. Installing..."
    sudo apt update && sudo apt install -y redis-server
fi

# Ensure Redis is running
sudo service redis-server start

# 2. Install Python Dependencies
echo "📦 Installing Enterprise Dependencies..."
pip install -r requirements-enterprise.txt

# 3. Start Celery Worker (Background)
echo "👷 Starting Celery Worker (100 Concurrent Threads)..."
# Using gevent for high concurrency I/O
# -P gevent: Asynchronous pool
# -c 100: 100 concurrent tasks per worker process
nohup celery -A src.utils.celery_app worker --loglevel=info -P gevent -c 100 > celery_worker.log 2>&1 &
CELERY_PID=$!
echo "   -> Worker PID: $CELERY_PID"

# 4. Start API Backend
echo "🌐 Starting FastAPI Backend..."
nohup python3 src/utils/firebaseBackend.py > backend.log 2>&1 &
BACKEND_PID=$!
echo "   -> Backend PID: $BACKEND_PID"

echo "✅ Enterprise System Online!"
echo "   - Logs: tail -f celery_worker.log backend.log"
