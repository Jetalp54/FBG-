#!/bin/bash

# Quick Setup Script for Ubuntu Server
echo "🚀 Setting up Firebase Email Campaign App on Ubuntu Server..."

# Get server IP
SERVER_IP=$(hostname -I | awk '{print $1}')
echo "📍 Server IP: $SERVER_IP"

# Create .env file
echo "⚙️ Creating environment configuration..."
cat > .env << EOF
VITE_API_BASE_URL=http://$SERVER_IP:8000
EOF

echo "✅ Environment file created with IP: $SERVER_IP"

# Build frontend
echo "🔨 Building frontend..."
npm run build

# Create directories
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
sudo nginx -t && sudo systemctl restart nginx

# Setup backend service
echo "🔧 Setting up backend service..."
CURRENT_DIR=$(pwd)
sudo cp firebase-backend.service /etc/systemd/system/
sudo sed -i "s|/path/to/your/app|$CURRENT_DIR|g" /etc/systemd/system/firebase-backend.service
sudo systemctl daemon-reload
sudo systemctl enable firebase-backend
sudo systemctl start firebase-backend

# Setup firewall
echo "🔥 Configuring firewall..."
sudo ufw allow 80
sudo ufw allow 443
sudo ufw allow 8000
sudo ufw --force enable

echo ""
echo "✅ Setup completed!"
echo ""
echo "📋 Access Information:"
echo "Frontend: http://$SERVER_IP"
echo "Backend API: http://$SERVER_IP:8000"
echo "Health Check: http://$SERVER_IP:8000/health"
echo ""
echo "📊 Service Status:"
sudo systemctl status firebase-backend --no-pager -l
echo ""
echo "📝 Next Steps:"
echo "1. Test the application by visiting http://$SERVER_IP"
echo "2. Add your Firebase projects through the web interface"
echo "3. Check logs if needed: sudo journalctl -u firebase-backend -f" 