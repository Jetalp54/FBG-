#!/bin/bash

echo "🔍 COMPREHENSIVE FIREBASE MANAGER DIAGNOSTICS & FIX"
echo "=================================================="

# Get server IP
SERVER_IP=$(curl -4 -s --max-time 10 ifconfig.me || curl -4 -s --max-time 10 icanhazip.com || curl -4 -s --max-time 10 ipinfo.io/ip || echo "localhost")
echo "📍 Server IP: $SERVER_IP"

echo ""
echo "1️⃣ CHECKING NGINX STATUS"
echo "========================"
systemctl status nginx --no-pager -l | head -10
echo ""

echo "2️⃣ CHECKING NGINX CONFIGURATION"
echo "==============================="
echo "Sites enabled:"
ls -la /etc/nginx/sites-enabled/
echo ""
echo "Sites available:"
ls -la /etc/nginx/sites-available/
echo ""

echo "3️⃣ CHECKING FRONTEND FILES"
echo "=========================="
echo "/var/www/html/ contents:"
ls -la /var/www/html/
echo ""

if [ -f "/var/www/html/index.html" ]; then
    echo "✅ index.html exists"
    echo "File size: $(stat -c%s /var/www/html/index.html) bytes"
    echo "First 5 lines:"
    head -5 /var/www/html/index.html
else
    echo "❌ index.html MISSING from /var/www/html/"
fi

echo ""
echo "4️⃣ CHECKING NGINX CONFIG CONTENT"
echo "================================"
if [ -f "/etc/nginx/sites-available/firebase-manager" ]; then
    echo "✅ firebase-manager config exists"
    cat /etc/nginx/sites-available/firebase-manager
else
    echo "❌ firebase-manager config MISSING"
fi

echo ""
echo "5️⃣ TESTING NGINX CONFIG"
echo "======================"
nginx -t

echo ""
echo "6️⃣ CHECKING WHAT NGINX IS ACTUALLY SERVING"
echo "=========================================="
RESPONSE=$(curl -s --max-time 10 http://$SERVER_IP/)
echo "Response length: ${#RESPONSE} characters"
echo "First 300 characters:"
echo "${RESPONSE:0:300}"
echo ""

if [[ "$RESPONSE" == *"Welcome to nginx"* ]]; then
    echo "❌ PROBLEM: Serving nginx default page"
elif [[ "$RESPONSE" == *"Firebase"* ]] || [[ "$RESPONSE" == *"Login"* ]] || [[ "$RESPONSE" == *"react"* ]]; then
    echo "✅ GOOD: Serving Firebase Manager app"
else
    echo "⚠️ UNKNOWN: Serving something else"
fi

echo ""
echo "7️⃣ CHECKING BACKEND STATUS"
echo "========================="
systemctl status firebase-manager --no-pager -l | head -10
echo ""

# Test backend
BACKEND_TEST=$(curl -s --max-time 10 http://localhost:8000/health 2>/dev/null || echo "FAILED")
if [[ "$BACKEND_TEST" == *"healthy"* ]]; then
    echo "✅ Backend: RESPONDING"
else
    echo "❌ Backend: NOT RESPONDING"
    echo "Response: $BACKEND_TEST"
fi

echo ""
echo "🔧 APPLYING COMPREHENSIVE FIX"
echo "============================="

# Stop services
echo "Stopping services..."
systemctl stop nginx
systemctl stop firebase-manager

# Remove any existing nginx default content
echo "Removing nginx default content..."
rm -rf /var/www/html/*
rm -f /etc/nginx/sites-enabled/default
rm -f /etc/nginx/sites-available/default

# Ensure /var/www/html exists
mkdir -p /var/www/html

# Check if we have a built frontend
APP_DIR="/var/www/firebase-manager"
if [ -f "$APP_DIR/dist/index.html" ]; then
    echo "✅ Found built frontend at $APP_DIR/dist/"
    echo "Copying frontend files..."
    cp -r $APP_DIR/dist/* /var/www/html/
    chown -R www-data:www-data /var/www/html/
    chmod -R 755 /var/www/html/
else
    echo "❌ No built frontend found. Building now..."
    cd $APP_DIR
    
    # Create .env.local with IPv4
    cat > .env.local << EOF
VITE_API_BASE_URL=http://$SERVER_IP
VITE_SERVER_IP=$SERVER_IP
VITE_BACKEND_PORT=80
EOF
    
    # Build frontend
    npm install
    npm run build
    
    if [ -f "dist/index.html" ]; then
        echo "✅ Frontend built successfully"
        cp -r dist/* /var/www/html/
        chown -R www-data:www-data /var/www/html/
        chmod -R 755 /var/www/html/
    else
        echo "❌ Frontend build failed"
        exit 1
    fi
fi

# Create nginx config
echo "Creating nginx configuration..."
cat > /etc/nginx/sites-available/firebase-manager << 'EOF'
server {
    listen 80;
    server_name _;
    
    root /var/www/html;
    index index.html;
    
    # Frontend
    location / {
        try_files $uri $uri/ /index.html;
    }
    
    # Backend API
    location ~ ^/(auth|api|health|projects|campaigns|profiles|app-users|role-permissions|settings|audit-logs|ai|test|ws) {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF

# Enable the site
ln -sf /etc/nginx/sites-available/firebase-manager /etc/nginx/sites-enabled/

# Test nginx config
nginx -t
if [ $? -ne 0 ]; then
    echo "❌ Nginx configuration test failed"
    exit 1
fi

# Start services
echo "Starting services..."
systemctl start nginx
systemctl start firebase-manager

# Wait for services to start
sleep 10

echo ""
echo "🧪 FINAL VERIFICATION"
echo "===================="

# Check nginx
if systemctl is-active --quiet nginx; then
    echo "✅ Nginx: RUNNING"
else
    echo "❌ Nginx: NOT RUNNING"
fi

# Check backend
if systemctl is-active --quiet firebase-manager; then
    echo "✅ Backend: RUNNING"
else
    echo "❌ Backend: NOT RUNNING"
fi

# Test what's being served
FINAL_RESPONSE=$(curl -s --max-time 10 http://$SERVER_IP/)
echo ""
echo "Final test response (first 200 chars):"
echo "${FINAL_RESPONSE:0:200}"

if [[ "$FINAL_RESPONSE" == *"Welcome to nginx"* ]]; then
    echo ""
    echo "❌ STILL SERVING NGINX DEFAULT PAGE"
    echo "Listing /var/www/html/:"
    ls -la /var/www/html/
    exit 1
elif [[ "$FINAL_RESPONSE" == *"Firebase"* ]] || [[ "$FINAL_RESPONSE" == *"Login"* ]] || [[ "$FINAL_RESPONSE" == *"<!DOCTYPE html>"* ]]; then
    echo ""
    echo "🎉 SUCCESS! Firebase Manager app is now serving correctly!"
    echo "🌐 Access your app at: http://$SERVER_IP"
    echo "🔑 Login with: admin / admin"
else
    echo ""
    echo "⚠️ Unexpected response - please check manually"
fi

echo ""
echo "📊 SUMMARY"
echo "=========="
echo "App URL: http://$SERVER_IP"
echo "Backend: http://$SERVER_IP/health"
echo "Files: /var/www/html/"
echo "Logs: journalctl -u firebase-manager -f"
