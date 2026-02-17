#!/bin/bash
echo "🚀 Starting Enterprise Firebase Manager..."

# 1. Check Redis
if ! command -v redis-server &> /dev/null; then
    echo "❌ Redis is not installed. Installing..."
    sudo apt update && sudo apt install -y redis-server python3-venv python3-pip
fi

# Ensure Redis is running
sudo service redis-server start

# 2. Setup Virtual Environment (Fixes Externally Managed Environment Error)
if [ ! -d "venv" ]; then
    echo "📦 Creating Python Virtual Environment..."
    python3 -m venv venv
fi

echo "🔌 Activating Virtual Environment..."
source venv/bin/activate

# 3. Install Python Dependencies
echo "📦 Installing Enterprise Dependencies..."
pip install -r requirements-enterprise.txt

# 4. Start Celery Worker (Background)
echo "👷 Starting Celery Worker (100 Concurrent Threads)..."
# Using gevent for high concurrency I/O
# -P gevent: Asynchronous pool
# -c 100: 100 concurrent tasks per worker process
nohup celery -A src.utils.celery_app worker --loglevel=info -P gevent -c 100 > celery_worker.log 2>&1 &
CELERY_PID=$!
echo "   -> Worker PID: $CELERY_PID"

# 5. Start API Backend
echo "🌐 Starting FastAPI Backend..."
nohup python src/utils/firebaseBackend.py > backend.log 2>&1 &
BACKEND_PID=$!
echo "   -> Backend PID: $BACKEND_PID"

echo "✅ Enterprise System Online!"
echo "   - Logs: tail -f celery_worker.log backend.log"
