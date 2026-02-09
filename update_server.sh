#!/bin/bash

# Configuration
APP_DIR="/var/www/firebase-manager"
SERVICE_USER="firebase"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}🚀 Starting Firebase Manager Update${NC}"

# 1. Pull latest changes
echo -e "${BLUE}📥 Pulling latest changes...${NC}"
git pull origin main

# 2. Update Application Code (Preserving Config)
echo -e "${BLUE}📂 Updating application files...${NC}"
# Copy everything except config files and virtualenv
rsync -av --exclude='app_users.json' --exclude='.env' --exclude='venv' --exclude='.git' --exclude='node_modules' . $APP_DIR/
chown -R $SERVICE_USER:$SERVICE_USER $APP_DIR

# 3. Update Dependencies
echo -e "${BLUE}📦 Updating dependencies...${NC}"
cd $APP_DIR
# Python (includes APScheduler for enterprise scheduled campaigns)
sudo -u $SERVICE_USER ./venv/bin/pip install -r requirements.txt
# Node
sudo -u $SERVICE_USER npm install

# 4. Rebuild Frontend
echo -e "${BLUE}🔨 Rebuilding frontend...${NC}"
if sudo -u $SERVICE_USER npm run build; then
    echo -e "${GREEN}✅ Frontend built successfully${NC}"
else
    echo -e "${RED}❌ Frontend build failed${NC}"
    exit 1
fi

# 5. Restart Configuration
echo -e "${BLUE}🔄 Restarting service...${NC}"
if systemctl restart firebase-manager; then
    echo -e "${GREEN}✅ Service restarted successfully${NC}"
else
    echo -e "${RED}❌ Failed to restart service${NC}"
    echo "Check status with: systemctl status firebase-manager"
    exit 1
fi

echo -e "${GREEN}✨ Update Complete!${NC}"
