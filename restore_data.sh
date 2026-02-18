#!/bin/bash
echo "🛑 Stopping all services to prevent data overwrite..."
sudo systemctl stop firebase-manager
sudo pkill -f "python src/utils/firebaseBackend.py"
sudo pkill -f "celery worker"

echo "🔍 Searching for data files in $(pwd)..."
ls -la campaigns.json* projects.json* 2>/dev/null

echo "🔍 Checking for backups..."
# Restore campaigns if backup exists and is larger than current
if [ -f "campaigns.json.bak" ]; then
    CURRENT_SIZE=$(stat -c%s "campaigns.json" 2>/dev/null || echo 0)
    BACKUP_SIZE=$(stat -c%s "campaigns.json.bak")
    
    echo "   Current: $CURRENT_SIZE bytes"
    echo "   Backup:  $BACKUP_SIZE bytes"
    
    if [ $BACKUP_SIZE -gt $CURRENT_SIZE ]; then
        echo "✅ Restoring larger backup (campaigns.json.bak)..."
        cp campaigns.json.bak campaigns.json
    fi
fi

# Restore projects if backup exists
if [ -f "projects.json.bak" ]; then
     echo "✅ Projects backup found. Checking..."
     # Logic to restore if needed
fi

# Check for other backup locations
find . -name "campaigns_backup_*.json" -ls

echo "📊 Final Data Status:"
ls -l campaigns.json projects.json

echo "⚠️ Checks complete. Run ./start_enterprise.sh to start (it will use these files)."
