#!/bin/bash
echo "🚀 Starting Enterprise Firebase Manager..."

# 1. Cleanup Old Processes (Force Kill & Stop Systemd)
echo "🛑 Stopping Conflicting Systemd Services..."
sudo systemctl stop firebase-manager || true
sudo systemctl stop firebase-backend || true
sudo systemctl disable firebase-manager || true
sudo systemctl disable firebase-backend || true

echo "🧹 Cleaning up old processes..."
sudo pkill -9 -f "celery worker" || true
sudo pkill -9 -f "firebaseBackend.py" || true

# Kill any process holding port 8000
if command -v fuser &> /dev/null; then
    sudo fuser -k 8000/tcp || true
fi

# Wait for port to be free
echo "⏳ Waiting for port 8000 to clear..."
while sudo lsof -i:8000 -t >/dev/null 2>&1; do
    sleep 1
    echo "."
done
echo "✅ Port 8000 is free."

# 2. Check Dependencies (Redis, Postgres, Utils)
echo "🔍 Checking System Dependencies..."
MISSING_DEPS=()

if ! command -v redis-server &> /dev/null; then MISSING_DEPS+=("redis-server"); fi
if ! command -v psql &> /dev/null; then MISSING_DEPS+=("postgresql" "postgresql-contrib" "libpq-dev"); fi
if ! command -v fuser &> /dev/null; then MISSING_DEPS+=("psmisc"); fi  # For fuser
if ! command -v lsof &> /dev/null; then MISSING_DEPS+=("lsof"); fi    # For checking ports

if [ ${#MISSING_DEPS[@]} -ne 0 ]; then
    echo "📦 Installing Missing Dependencies: ${MISSING_DEPS[*]} (Check setup.log)"
    sudo apt update >> setup.log 2>&1
    sudo apt install -y "${MISSING_DEPS[@]}" python3-venv python3-pip >> setup.log 2>&1
    
    # Configure Postgres if it was just installed
    if [[ " ${MISSING_DEPS[*]} " =~ "postgresql" ]]; then
        echo "🐘 Configuring PostgreSQL User..."
        sudo -u postgres psql -c "CREATE USER firebase_user WITH PASSWORD 'firebase_password';" || true >> setup.log 2>&1
        sudo -u postgres psql -c "CREATE DATABASE firebase_db OWNER firebase_user;" || true >> setup.log 2>&1
        sudo -u postgres psql -c "ALTER USER firebase_user CREATEDB;" || true >> setup.log 2>&1
    fi
fi

# Export DB Connection String for App
export DB_URL="postgresql://firebase_user:firebase_password@localhost/firebase_db"
export USE_DATABASE="true"

# Ensure Redis is running
sudo service redis-server start >> setup.log 2>&1

# 2. Setup Virtual Environment (Fixes Externally Managed Environment Error)
if [ ! -d "venv" ]; then
    echo "📦 Creating Python Virtual Environment..."
    python3 -m venv venv
fi

echo "🔌 Activating Virtual Environment..."
source venv/bin/activate

# 2.5 Setup Systemd Service (if needed)
if [ -f "firebase-backend.service" ]; then
    echo "🔧 Updating Systemd Service..."
    # Copy service file
    sudo cp firebase-backend.service /etc/systemd/system/
    sudo systemctl daemon-reload
    # Ensure it's not conflicting with our manual run, but good to have ready
fi

# 2.6 Clean Python Cache (Prevent Zombie Code)
echo "🧹 Cleaning Python Bytecode Cache..."
find . -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true
find . -name "*.pyc" -delete 2>/dev/null || true

# 3. Install Python Dependencies
echo "📦 Installing Enterprise Dependencies (Check setup.log)..."
pip install -r requirements-enterprise.txt >> setup.log 2>&1

# 4. Start Celery Worker (Background, Detached)
echo "👷 Starting Celery Worker (100 Concurrent Threads)..."
# < /dev/null is CRITICAL to prevent the background process from stealing terminal input
nohup celery -A src.utils.celery_app worker --loglevel=info -P gevent -c 100 > celery_worker.log 2>&1 < /dev/null &
CELERY_PID=$!
echo "   -> Worker PID: $CELERY_PID"

# 5. Start API Backend (Background, Detached)
echo "🌐 Starting FastAPI Backend..."
nohup python src/utils/firebaseBackend.py > backend.log 2>&1 < /dev/null &
BACKEND_PID=$!
echo "   -> Backend PID: $BACKEND_PID"

# 6. Restore Terminal Settings (Just in case)
stty sane 2>/dev/null || true

echo "✅ Enterprise System Online!"
echo "   - Logs: tail -f celery_worker.log backend.log"
