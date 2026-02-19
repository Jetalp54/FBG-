#!/bin/bash

# Configuration
APP_DIR="/var/www/firebase-manager"
SERVICE_USER="firebase"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN}🚀 Starting Fix: UI & Permissions${NC}"

cd $APP_DIR

# 1. Pull latest code
echo "📥 Pulling latest code..."
git pull

# 2. Fix Permissions (Crucial for persistence)
echo "🔒 Fixing file permissions (chown $SERVICE_USER)..."
chown -R $SERVICE_USER:$SERVICE_USER $APP_DIR
chmod -R 755 $APP_DIR
# Ensure JSON files are writable
touch campaigns.json
chown $SERVICE_USER:$SERVICE_USER campaigns.json
chmod 664 campaigns.json

# 3. Rebuild Frontend (Crucial for Throttle UI)
echo "🔨 Rebuilding frontend..."
sudo -u $SERVICE_USER npm install
sudo -u $SERVICE_USER npm run build

# 4. Restart Backend
echo "🔄 Restarting backend..."
systemctl restart firebase-backend

# 5. Verify
echo "🔍 Checking status..."
systemctl status firebase-backend --no-pager

echo -e "${GREEN}✅ Fix Complete! Please clear your browser cache and refresh.${NC}"
