#!/bin/bash

echo "🔧 Fixing Firebase Campaign App API Issues..."

# 1. Check if backend is running
echo "📊 Checking backend status..."
if ! systemctl is-active --quiet firebase-backend; then
    echo "❌ Backend service is not running. Starting it..."
    sudo systemctl start firebase-backend
    sleep 3
fi

# 2. Check backend logs for errors
echo "📋 Recent backend logs:"
sudo journalctl -u firebase-backend --no-pager -n 20

# 3. Check if backend dependencies are installed
echo "🐍 Installing missing Python dependencies..."
pip3 install --upgrade flask flask-cors requests python-dotenv firebase-admin pyrebase4 google-cloud-resourcemanager fastapi uvicorn websockets

# 4. Fix backend service configuration
echo "⚙️ Fixing backend service configuration..."
CURRENT_DIR=$(pwd)
sudo systemctl stop firebase-backend

# Update service file with correct configuration
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
ExecStart=/usr/bin/python3 -m uvicorn src.utils.firebaseBackend:app --host 0.0.0.0 --port 8000
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

# 5. Reload and start backend service
sudo systemctl daemon-reload
sudo systemctl enable firebase-backend
sudo systemctl start firebase-backend

# 6. Wait for backend to start
echo "⏳ Waiting for backend to start..."
sleep 5

# 7. Test backend connectivity
echo "🔍 Testing backend connectivity..."
SERVER_IP=$(hostname -I | awk '{print $1}')
echo "Testing: http://$SERVER_IP:8000/health"

if curl -f "http://$SERVER_IP:8000/health" >/dev/null 2>&1; then
    echo "✅ Backend is responding correctly"
else
    echo "❌ Backend is not responding. Checking errors..."
    sudo journalctl -u firebase-backend --no-pager -n 10
fi

# 8. Check firewall settings
echo "🔥 Ensuring firewall allows backend traffic..."
sudo ufw allow 8000

# 9. Create proper environment file
echo "📝 Creating environment file..."
cat > .env << EOF
VITE_API_BASE_URL=http://$SERVER_IP:8000
EOF

# 10. Rebuild frontend with correct API URL
echo "🔨 Rebuilding frontend..."
npm run build

# 11. Update nginx with rebuilt frontend
echo "🌐 Updating nginx with rebuilt frontend..."
sudo cp -r dist/* /var/www/firebase-app/
sudo chown -R www-data:www-data /var/www/firebase-app

# 12. Restart nginx
sudo systemctl restart nginx

# 13. Final status check
echo ""
echo "✅ Fix completed! Status check:"
echo "Backend service: $(systemctl is-active firebase-backend)"
echo "Nginx service: $(systemctl is-active nginx)"
echo ""
echo "🌐 Access URLs:"
echo "Frontend: http://$SERVER_IP"
echo "Backend API: http://$SERVER_IP:8000"
echo "Health Check: http://$SERVER_IP:8000/health"
echo ""
echo "🔧 If issues persist, check logs:"
echo "Backend: sudo journalctl -u firebase-backend -f"
echo "Nginx: sudo tail -f /var/log/nginx/error.log"

# 14. Test key endpoints
echo ""
echo "🧪 Testing key endpoints..."
echo "Testing /health:"
curl -s "http://$SERVER_IP:8000/health" || echo "❌ Health check failed"
echo ""
echo "Testing /projects:"
curl -s "http://$SERVER_IP:8000/projects" | head -100 || echo "❌ Projects endpoint failed"
echo "" 