#!/bin/bash

# Fixed Setup Script for Ubuntu Server
echo "🚀 Setting up Firebase Email Campaign App on Ubuntu Server..."

# Get server IP
SERVER_IP=$(hostname -I | awk '{print $1}')
echo "📍 Server IP: $SERVER_IP"

# Update system and install nginx
echo "📦 Installing required packages..."
sudo apt update
sudo apt install nginx python3-pip -y

# Install Python dependencies
echo "🐍 Installing Python dependencies..."
pip3 install flask flask-cors requests python-dotenv

# Create .env file
echo "⚙️ Creating environment configuration..."
cat > .env << EOF
VITE_API_BASE_URL=http://$SERVER_IP:8000
EOF

echo "✅ Environment file created with IP: $SERVER_IP"

# Stop dev server if running
pkill -f "vite"

# Build frontend
echo "🔨 Building frontend..."
npm run build

# Create directories and copy files
echo "📁 Creating web directories..."
sudo mkdir -p /var/www/firebase-app
sudo cp -r dist/* /var/www/firebase-app/
sudo chown -R www-data:www-data /var/www/firebase-app

# Setup nginx
echo "🌐 Setting up Nginx..."
sudo cp nginx-config.conf /etc/nginx/sites-available/firebase-app
sudo sed -i "s/your-domain.com/$SERVER_IP/g" /etc/nginx/sites-available/firebase-app
sudo ln -sf /etc/nginx/sites-available/firebase-app /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

# Test nginx config
echo "🔍 Testing Nginx configuration..."
sudo nginx -t

if [ $? -eq 0 ]; then
    echo "✅ Nginx configuration is valid"
    sudo systemctl restart nginx
    sudo systemctl enable nginx
else
    echo "❌ Nginx configuration error"
    exit 1
fi

# Setup backend service
echo "🔧 Setting up backend service..."
CURRENT_DIR=$(pwd)

# Stop any existing service
sudo systemctl stop firebase-backend 2>/dev/null

# Update service file with correct path
sudo cp firebase-backend.service /etc/systemd/system/
sudo sed -i "s|/path/to/your/app|$CURRENT_DIR|g" /etc/systemd/system/firebase-backend.service

# Reload and start service
sudo systemctl daemon-reload
sudo systemctl enable firebase-backend

# Check if backend file exists
if [ -f "src/utils/firebaseBackend.py" ]; then
    echo "✅ Backend file found"
    sudo systemctl start firebase-backend
else
    echo "❌ Backend file not found at src/utils/firebaseBackend.py"
    echo "📁 Current directory contents:"
    ls -la src/utils/ 2>/dev/null || echo "src/utils/ directory not found"
fi

# Setup firewall
echo "🔥 Configuring firewall..."
sudo ufw allow 80
sudo ufw allow 443
sudo ufw allow 8000
sudo ufw --force enable

# Show status
echo ""
echo "✅ Setup completed!"
echo ""
echo "📋 Access Information:"
echo "Frontend: http://$SERVER_IP"
echo "Backend API: http://$SERVER_IP:8000"
echo "Health Check: http://$SERVER_IP:8000/health"
echo ""
echo "📊 Service Status:"
sudo systemctl status nginx --no-pager -l
echo ""
sudo systemctl status firebase-backend --no-pager -l
echo ""
echo "📝 Next Steps:"
echo "1. Test the application by visiting http://$SERVER_IP"
echo "2. Check backend logs: sudo journalctl -u firebase-backend -f"
echo "3. Check nginx logs: sudo tail -f /var/log/nginx/error.log" 