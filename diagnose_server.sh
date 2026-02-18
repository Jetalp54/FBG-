#!/bin/bash
echo "🔍 DIAGNOSING 502 ERROR..."
echo "--------------------------------"

echo "1. Checking Port 8000 (Backend)..."
sudo lsof -i:8000 || echo "❌ No process listening on port 8000"

echo "\n2. Checking Python Processes..."
ps aux | grep python | grep -v grep

echo "\n3. Checking System Status..."
sudo systemctl status firebase-backend --no-pager || echo "Systemd service not active (using manual script?)"

echo "\n4. Last 50 lines of backend.log (THE CRASH REASON):"
echo "---------------------------------------------------"
tail -n 50 backend.log
echo "---------------------------------------------------"

echo "\n5. Last 20 lines of celery_worker.log:"
echo "---------------------------------------------------"
tail -n 20 celery_worker.log
echo "---------------------------------------------------"

echo "\n6. Checking setup.log (Installation Errors):"
tail -n 20 setup.log
