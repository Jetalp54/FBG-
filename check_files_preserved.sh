#!/bin/bash

# Check if files are preserved and show current state
# Run this to verify your repo is safe

echo "🔍 Checking File Preservation Status"
echo "==================================="

# Get current directory
CURRENT_DIR=$(pwd)
echo "📁 Current directory: $CURRENT_DIR"

# Check if this looks like the Firebase Manager repo
if [ -f "src/utils/firebaseBackend.py" ] && [ -f "package.json" ]; then
    echo "✅ This appears to be the Firebase Manager repository"
else
    echo "❌ This doesn't look like the Firebase Manager repository"
    echo "   Looking for: src/utils/firebaseBackend.py and package.json"
    exit 1
fi

# Check if application is installed
APP_DIR="/var/www/firebase-manager"
if [ -d "$APP_DIR" ]; then
    echo "✅ Application is installed at: $APP_DIR"
    
    # Check if it's a copy or moved
    if [ "$(realpath $CURRENT_DIR)" = "$(realpath $APP_DIR)" ]; then
        echo "❌ WARNING: Your repo was MOVED, not copied!"
        echo "   Current dir: $CURRENT_DIR"
        echo "   App dir: $APP_DIR"
        echo "   They are the same location!"
    else
        echo "✅ Your repo is PRESERVED (different from app directory)"
        echo "   Current dir: $CURRENT_DIR"
        echo "   App dir: $APP_DIR"
    fi
else
    echo "⚠️  Application is not installed at: $APP_DIR"
fi

# Check services
echo ""
echo "🔧 Service Status:"
echo "=================="

if systemctl is-active --quiet firebase-manager; then
    echo "✅ firebase-manager service: ACTIVE"
else
    echo "❌ firebase-manager service: INACTIVE"
fi

if systemctl is-active --quiet nginx; then
    echo "✅ nginx service: ACTIVE"
else
    echo "❌ nginx service: INACTIVE"
fi

# Check ports
echo ""
echo "🌐 Port Status:"
echo "==============="

if netstat -tlnp | grep :8000 > /dev/null; then
    echo "✅ Port 8000 (Backend): IN USE"
    netstat -tlnp | grep :8000
else
    echo "❌ Port 8000 (Backend): NOT IN USE"
fi

if netstat -tlnp | grep :80 > /dev/null; then
    echo "✅ Port 80 (Frontend): IN USE"
    netstat -tlnp | grep :80
else
    echo "❌ Port 80 (Frontend): NOT IN USE"
fi

# Check server IP
echo ""
echo "🌐 Server IP Detection:"
echo "======================"

# Force IPv4 only
SERVER_IP=$(curl -4 -s ifconfig.me 2>/dev/null || curl -s ipv4.icanhazip.com 2>/dev/null || curl -s checkip.amazonaws.com 2>/dev/null || echo "localhost")

if [[ $SERVER_IP =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "✅ Server IPv4: $SERVER_IP"
else
    echo "⚠️  Server IP: $SERVER_IP (not valid IPv4)"
fi

# Test connectivity
echo ""
echo "🧪 Connectivity Tests:"
echo "====================="

# Test backend
if curl -s --max-time 5 http://localhost:8000/ > /dev/null 2>&1; then
    echo "✅ Backend (localhost:8000): RESPONDING"
else
    echo "❌ Backend (localhost:8000): NOT RESPONDING"
fi

# Test frontend
if curl -s --max-time 5 http://localhost/ > /dev/null 2>&1; then
    echo "✅ Frontend (localhost): RESPONDING"
else
    echo "❌ Frontend (localhost): NOT RESPONDING"
fi

# Test external access
if [ "$SERVER_IP" != "localhost" ]; then
    if curl -s --max-time 5 http://$SERVER_IP/ > /dev/null 2>&1; then
        echo "✅ Frontend ($SERVER_IP): RESPONDING"
    else
        echo "❌ Frontend ($SERVER_IP): NOT RESPONDING"
    fi
    
    if curl -s --max-time 5 http://$SERVER_IP:8000/ > /dev/null 2>&1; then
        echo "✅ Backend ($SERVER_IP:8000): RESPONDING"
    else
        echo "❌ Backend ($SERVER_IP:8000): NOT RESPONDING"
    fi
fi

# Check environment files
echo ""
echo "⚙️ Environment Files:"
echo "===================="

if [ -f ".env" ]; then
    echo "✅ .env file exists in current directory"
    echo "   Contents (without passwords):"
    grep -v PASSWORD .env | head -10
else
    echo "❌ .env file not found in current directory"
fi

if [ -f ".env.local" ]; then
    echo "✅ .env.local file exists in current directory"
    echo "   Contents:"
    cat .env.local
else
    echo "❌ .env.local file not found in current directory"
fi

# Summary
echo ""
echo "🎯 Summary:"
echo "==========="

if [ -d "$APP_DIR" ] && [ "$(realpath $CURRENT_DIR)" != "$(realpath $APP_DIR)" ]; then
    echo "✅ Your repo is PRESERVED and application is installed"
    echo "✅ You can continue working in: $CURRENT_DIR"
    echo "✅ Application runs from: $APP_DIR"
else
    echo "❌ Your repo may have been moved or deleted"
    echo "❌ You should restore from backup or re-clone"
fi

echo ""
echo "📋 Next Steps:"
echo "=============="

if [ -d "$APP_DIR" ] && [ "$(realpath $CURRENT_DIR)" != "$(realpath $APP_DIR)" ]; then
    echo "1. Your files are safe - continue working"
    echo "2. To check app status: $APP_DIR/status.sh"
    echo "3. To view logs: journalctl -u firebase-manager -f"
    echo "4. To restart: systemctl restart firebase-manager"
else
    echo "1. Your repo was moved/deleted - restore from backup"
    echo "2. Re-clone the repository"
    echo "3. Run the installation script again"
fi
