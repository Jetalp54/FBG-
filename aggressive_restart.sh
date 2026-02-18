#!/bin/bash
echo "💀 AGGRESSIVE RESTART - KILLING EVERYTHING 💀"

# 1. Verify Code on Disk
echo "🔍 Verifying Code Version..."
if grep -q "Version 2.2" src/utils/celery_tasks.py; then
    echo "✅ Code on disk is UPDATED (Version 2.2 found)."
else
    echo "❌ Code on disk is OUTDATED! Pulling now..."
    git pull origin main
fi

# 2. Kill Processes
echo "🔪 Killing ALL Python and Celery processes..."
sudo systemctl stop firebase-manager || true
sudo systemctl stop firebase-backend || true
sudo pkill -9 -f "celery"
sudo pkill -9 -f "python"
sudo pkill -9 -f "uvicorn"
# Ensure they are dead
sleep 2

# 3. Clear Redis (Optional but good for stuck tasks)
echo "🧹 Flushing Redis..."
redis-cli FLUSHALL

# 4. Clean Cache
echo "🧹 Cleaning Python Cache..."
find . -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null
find . -name "*.pyc" -delete

# 5. Restart
echo "🚀 Restarting Enterprise System..."
./start_enterprise.sh

echo "👀 Watching logs for Startup Message (Press Ctrl+C to exit log view)..."
echo "Waiting for worker to initialize..."
sleep 5
tail -f celery_worker.log | grep --line-buffered -E "Version 2.2|Error|ready"
