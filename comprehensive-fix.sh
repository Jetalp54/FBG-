#!/bin/bash

echo "🔧 Comprehensive Firebase Campaign App Fix Script"
echo "================================================"

# Get server IP
SERVER_IP=$(hostname -I | awk '{print $1}')
echo "📍 Server IP: $SERVER_IP"

# 1. Stop all running processes
echo "🛑 Stopping existing processes..."
pkill -f "vite" 2>/dev/null
sudo systemctl stop firebase-backend 2>/dev/null

# 2. Update environment variables
echo "📝 Setting up environment variables..."
cat > .env << EOF
VITE_API_BASE_URL=http://$SERVER_IP:8000
EOF

echo "✅ Environment file created with server IP"

# 3. Install/update all dependencies
echo "📦 Installing/updating dependencies..."
pip3 install --upgrade fastapi uvicorn websockets firebase-admin pyrebase4 google-cloud-resourcemanager pydantic python-multipart

# 4. Check if all required files exist
echo "📋 Checking required files..."
if [ ! -f "src/utils/firebaseBackend.py" ]; then
    echo "❌ Backend file missing!"
    exit 1
fi

if [ ! -f "admin_service_account.json" ]; then
    echo "⚠️  Warning: admin_service_account.json not found"
fi

# 5. Test backend directly
echo "🧪 Testing backend startup..."
timeout 10s python3 -c "
import sys
sys.path.append('.')
from src.utils.firebaseBackend import app
print('✅ Backend imports successfully')
" || echo "❌ Backend import failed"

# 6. Configure proper systemd service
echo "⚙️ Configuring backend service..."
CURRENT_DIR=$(pwd)

sudo tee /etc/systemd/system/firebase-backend.service > /dev/null << EOF
[Unit]
Description=Firebase Email Campaign Backend
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$CURRENT_DIR
Environment=PATH=/usr/bin:/usr/local/bin
Environment=PYTHONPATH=$CURRENT_DIR
Environment=PYTHONUNBUFFERED=1
ExecStart=/usr/bin/python3 -m uvicorn src.utils.firebaseBackend:app --host 0.0.0.0 --port 8000 --reload
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

# 7. Start backend service
echo "🚀 Starting backend service..."
sudo systemctl daemon-reload
sudo systemctl enable firebase-backend
sudo systemctl start firebase-backend

# Wait for backend to start
echo "⏳ Waiting for backend to start..."
sleep 8

# 8. Test backend connectivity
echo "🔍 Testing backend connectivity..."
HEALTH_CHECK=""
for i in {1..10}; do
    if curl -f -s "http://$SERVER_IP:8000/health" > /dev/null; then
        HEALTH_CHECK="✅ Backend responding"
        break
    else
        echo "Attempt $i: Backend not ready..."
        sleep 2
    fi
done

if [ -z "$HEALTH_CHECK" ]; then
    echo "❌ Backend failed to start properly"
    echo "Backend logs:"
    sudo journalctl -u firebase-backend --no-pager -n 20
    exit 1
else
    echo "$HEALTH_CHECK"
fi

# 9. Test specific endpoints
echo "🧪 Testing key endpoints..."

echo "Testing /projects endpoint:"
curl -s "http://$SERVER_IP:8000/projects" | head -200

echo ""
echo "Testing /campaigns endpoint:"
curl -s "http://$SERVER_IP:8000/campaigns" | head -200

# 10. Rebuild frontend with correct API URL
echo "🔨 Rebuilding frontend..."
if ! npm run build; then
    echo "❌ Frontend build failed"
    exit 1
fi

# 11. Update nginx
echo "🌐 Updating nginx..."
sudo cp -r dist/* /var/www/firebase-app/
sudo chown -R www-data:www-data /var/www/firebase-app

# Ensure nginx is running
if ! sudo systemctl is-active --quiet nginx; then
    sudo systemctl start nginx
fi

sudo systemctl restart nginx

# 12. Test complete pipeline
echo "🔗 Testing complete pipeline..."

# Test user deletion endpoint
echo "Testing user deletion endpoint:"
curl -s -X DELETE "http://$SERVER_IP:8000/projects/users/bulk" \
  -H "Content-Type: application/json" \
  -d '{"projectIds":["test"],"userIds":["test"]}' | head -100

echo ""

# Test campaign send endpoint
echo "Testing campaign send endpoint:"
curl -s -X POST "http://$SERVER_IP:8000/campaigns/send" \
  -H "Content-Type: application/json" \
  -d '{"projectId":"test","userIds":["test"],"lightning":true}' | head -100

echo ""

# Test reset email endpoint
echo "Testing test email endpoint:"
curl -s -X POST "http://$SERVER_IP:8000/test-reset-email" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","project_id":"test"}' | head -100

echo ""

# 13. Final status report
echo ""
echo "📊 Final Status Report:"
echo "======================"
echo "Backend service: $(systemctl is-active firebase-backend)"
echo "Nginx service: $(systemctl is-active nginx)"
echo "Backend URL: http://$SERVER_IP:8000"
echo "Frontend URL: http://$SERVER_IP"
echo "API Documentation: http://$SERVER_IP:8000/docs"
echo ""

# 14. Show recent logs
echo "📋 Recent backend logs:"
sudo journalctl -u firebase-backend --no-pager -n 10

echo ""
echo "✅ Comprehensive fix completed!"
echo ""
echo "🚀 Access your application:"
echo "Frontend: http://$SERVER_IP"
echo "Backend API: http://$SERVER_IP:8000"
echo "API Documentation: http://$SERVER_IP:8000/docs"
echo ""
echo "🔧 If issues persist:"
echo "1. Check backend logs: sudo journalctl -u firebase-backend -f"
echo "2. Check nginx logs: sudo tail -f /var/log/nginx/error.log"
echo "3. Test specific endpoints manually with curl"
echo "4. Verify your Firebase projects are properly configured" 