#!/bin/bash
echo "☢️ NUCLEAR FORCE-FIX INITIATED ☢️"

echo "🛑 1. Stopping all processes..."
sudo systemctl stop firebase-manager || true
sudo systemctl stop firebase-backend || true
sudo pkill -9 -f "celery worker" || true
sudo pkill -9 -f "firebaseBackend.py" || true

echo "🔄 2. Forcing Repository Update (Bypassing conflicts)..."
git fetch --all
git reset --hard origin/main

echo "🧹 3. Purging Python Caches..."
find . -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true
find . -name "*.pyc" -delete 2>/dev/null || true

echo "🔧 4. Repairing Data Files..."
python3 repair_projects.py || echo "⚠️ Repair script failed, check projects.json"

echo "📦 5. Verifying Dependencies..."
source venv/bin/activate
pip install -r requirements-enterprise.txt

echo "🚀 6. Restarting System..."
./start_enterprise.sh

echo "✅ System Restarted. Please monitor logs: tail -f celery_worker.log backend.log"
