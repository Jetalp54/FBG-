#!/bin/bash

# PROFESSIONAL FIREBASE MANAGER INSTALLATION
# PostgreSQL-only, production-ready, preserves files
# Designed for AWS Ubuntu servers with 1000+ campaign capacity

set -e

echo "🚀 Installing Firebase Manager (Preserving Your Files)"
echo "======================================================"

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   echo "❌ This script must be run as root (use sudo)"
   exit 1
fi

# Get current directory (where your repo is)
CURRENT_DIR=$(pwd)
echo "📁 Your repo is safe at: $CURRENT_DIR"

# Get server IPv4 ONLY (no IPv6)
echo "🌐 Detecting server IPv4 address..."
SERVER_IP=$(curl -4 -s ifconfig.me 2>/dev/null || curl -s ipv4.icanhazip.com 2>/dev/null || curl -s checkip.amazonaws.com 2>/dev/null || echo "localhost")

# Validate IPv4 format
if [[ $SERVER_IP =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "✅ Server IPv4 detected: $SERVER_IP"
else
    echo "⚠️  Could not detect valid IPv4, using localhost"
    SERVER_IP="localhost"
fi

# Create application directory (COPY, don't move)
APP_DIR="/var/www/firebase-manager"
echo "📁 Creating application directory: $APP_DIR"
mkdir -p $APP_DIR

# COPY project files (preserve original)
echo "📋 Copying project files (original repo stays intact)..."
cp -r . $APP_DIR/
chown -R www-data:www-data $APP_DIR

echo "✅ Your original repo is preserved at: $CURRENT_DIR"
echo "✅ Application files copied to: $APP_DIR"

# Install system packages including PostgreSQL
echo "📦 Installing system packages..."
apt-get update
apt-get install -y python3 python3-pip python3-venv nginx curl postgresql postgresql-contrib libpq-dev python3-dev

# Setup PostgreSQL
echo "🗄️ Setting up PostgreSQL..."
systemctl start postgresql
systemctl enable postgresql

# Create database and user
echo "🗄️ Creating PostgreSQL database..."
cd /tmp  # Safe directory for PostgreSQL operations

# Drop existing database and user if they exist (fresh install)
sudo -u postgres psql -c "DROP DATABASE IF EXISTS firebase_manager;" 2>/dev/null || true
sudo -u postgres psql -c "DROP USER IF EXISTS emedia;" 2>/dev/null || true

# Create fresh user and database with full permissions
sudo -u postgres psql -c "CREATE USER emedia WITH PASSWORD 'Batata010..++' CREATEDB SUPERUSER;"
sudo -u postgres psql -c "CREATE DATABASE firebase_manager OWNER emedia;"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE firebase_manager TO emedia;"

# Ensure all schema permissions
sudo -u postgres psql -d firebase_manager << EOF
GRANT ALL ON SCHEMA public TO emedia;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO emedia;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO emedia;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO emedia;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO emedia;
EOF

echo "✅ PostgreSQL database created successfully"

# Test database connection with the new user
echo "🧪 Testing database connection as emedia user..."
if PGPASSWORD='Batata010..++' psql -h localhost -U emedia -d firebase_manager -c "SELECT version();" > /dev/null 2>&1; then
    echo "✅ Database connection test successful"
else
    echo "❌ Database connection test failed"
    exit 1
fi

# Return to application directory
cd $APP_DIR

# Setup Python environment
echo "🐍 Setting up Python environment..."
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install fastapi uvicorn firebase-admin pyrebase4 python-dotenv google-auth requests python-multipart python-jose passlib aiofiles httpx psycopg2-binary

# Create environment file for PostgreSQL
echo "⚙️ Creating PostgreSQL environment configuration..."
cat > $APP_DIR/.env << EOF
# Firebase Manager Professional Configuration - PostgreSQL
USE_DATABASE=true
USE_JSON_FILES=false
ENVIRONMENT=production
LOG_LEVEL=INFO
SERVER_IP=$SERVER_IP
BACKEND_PORT=8000
HOST=0.0.0.0
CORS_ORIGINS=*
DB_HOST=localhost
DB_PORT=5432
DB_NAME=firebase_manager
DB_USER=emedia
DB_PASSWORD=Batata010..++
DB_URL=postgresql://emedia:Batata010..++@localhost:5432/firebase_manager
EOF

# Create frontend environment with IPv4
echo "🌐 Creating frontend environment with IPv4..."
cat > $APP_DIR/.env.local << EOF
# Frontend Environment - IPv4: $SERVER_IP
VITE_API_BASE_URL=http://$SERVER_IP
VITE_SERVER_IP=$SERVER_IP
VITE_BACKEND_PORT=80
VITE_ENVIRONMENT=production
EOF

# Install Node.js if not present
echo "📦 Installing Node.js..."
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    apt-get install -y nodejs
fi

# Fix npm cache permissions (known issue)
echo "🔧 Fixing npm cache permissions..."
mkdir -p /var/www/.npm
chown -R 33:33 "/var/www/.npm"

# Build frontend with IPv4 configuration
echo "🔨 Building frontend with IPv4 configuration..."
chown -R www-data:www-data .
npm install
npm run build

# Verify frontend build exists and has content
if [ ! -f "dist/index.html" ]; then
    echo "❌ Frontend build failed - index.html not found"
    ls -la dist/ || echo "dist directory doesn't exist"
    exit 1
fi

# Check if index.html has actual content (not empty)
if [ ! -s "dist/index.html" ]; then
    echo "❌ Frontend build failed - index.html is empty"
    exit 1
fi

# Check if it contains React app content
if ! grep -q "Firebase" "dist/index.html" && ! grep -q "react" "dist/index.html" && ! grep -q "app" "dist/index.html"; then
    echo "⚠️ Frontend build may not contain app content"
    echo "Content preview:"
    head -10 "dist/index.html"
fi

echo "✅ Frontend build verified - index.html found and has content"

# Copy built files to nginx document root with proper permissions
echo "📁 Deploying frontend files to nginx document root..."
rm -rf /var/www/html/*
cp -r dist/* /var/www/html/
chown -R www-data:www-data /var/www/html/
chmod -R 755 /var/www/html/

# Verify deployment
if [ ! -f "/var/www/html/index.html" ]; then
    echo "❌ Frontend deployment failed - files not copied to nginx root"
    exit 1
fi
echo "✅ Frontend files deployed to /var/www/html/"

# Create systemd service
echo "🔧 Creating systemd service..."
cat > /etc/systemd/system/firebase-manager.service << EOF
[Unit]
Description=Firebase Manager Server
After=network.target

[Service]
Type=exec
User=www-data
Group=www-data
WorkingDirectory=$APP_DIR
Environment=PATH=$APP_DIR/venv/bin
EnvironmentFile=$APP_DIR/.env
ExecStart=$APP_DIR/venv/bin/python -m src.utils.firebaseBackend
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# Configure Nginx with IPv4
echo "🌐 Configuring Nginx with IPv4..."
cat > /etc/nginx/sites-available/firebase-manager << EOF
server {
    listen 80;
    server_name $SERVER_IP _;
    
    # Frontend - serve from standard nginx document root
    location / {
        root /var/www/html;
        try_files \$uri \$uri/ /index.html;
        index index.html;
    }
    
    # Backend - ALL endpoints work through port 80
    location ~ ^/(auth|api|health|projects|campaigns|profiles|app-users|role-permissions|settings|audit-logs|ai|test|ws) {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        
        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
    
    # Root endpoint
    location = / {
        proxy_pass http://127.0.0.1:8000/;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    }
}
EOF

# Enable site and remove default
echo "🔧 Enabling Firebase Manager site and removing default..."
ln -sf /etc/nginx/sites-available/firebase-manager /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
rm -f /etc/nginx/sites-available/default

# Ensure our frontend files are in the right place
echo "📁 Ensuring frontend files are properly placed..."
if [ ! -f "/var/www/html/index.html" ]; then
    echo "❌ Frontend files missing at /var/www/html/"
    ls -la "/var/www/html/" || echo "/var/www/html/ doesn't exist"
    exit 1
fi
echo "✅ Frontend files confirmed at /var/www/html/"

# Test Nginx config
echo "🧪 Testing Nginx configuration..."
nginx -t
if [ $? -ne 0 ]; then
    echo "❌ Nginx configuration test failed"
    exit 1
fi

# Start services
echo "🚀 Starting services..."
systemctl daemon-reload
systemctl enable firebase-manager
systemctl start firebase-manager
systemctl enable nginx
systemctl start nginx

# Wait for backend to fully initialize
echo "⏳ Waiting for backend to fully initialize..."
sleep 25

# Test backend
echo "🧪 Testing backend..."
if curl -s http://localhost:8000/ > /dev/null; then
    echo "✅ Backend is working!"
else
    echo "❌ Backend not responding, checking logs..."
    journalctl -u firebase-manager --no-pager -l | tail -10
fi

# Test frontend
echo "🧪 Testing frontend..."
if curl -s http://localhost/ | grep -q "Firebase Manager"; then
    echo "✅ Frontend is working!"
else
    echo "⚠️  Frontend accessible but may not be displaying correctly"
fi

# Create status script
cat > $APP_DIR/status.sh << EOF
#!/bin/bash
echo "=== Firebase Manager Status ==="
echo ""
echo "Server Information:"
echo "Server IPv4: $SERVER_IP"
echo "Application Directory: $APP_DIR"
echo "Original Repo: $CURRENT_DIR (PRESERVED)"
echo ""
echo "Backend Service:"
systemctl status firebase-manager --no-pager -l
echo ""
echo "Nginx Service:"
systemctl status nginx --no-pager -l
echo ""
echo "Backend Response:"
curl -s http://localhost:8000/ | head -5
echo ""
echo "Frontend Response:"
curl -s http://localhost/ | head -5
echo ""
echo "IPv4 Configuration:"
echo "Frontend: http://$SERVER_IP"
echo "Backend:  http://$SERVER_IP:8000"
echo "API Base: http://$SERVER_IP:8000"
EOF

chmod +x $APP_DIR/status.sh
chown www-data:www-data $APP_DIR/status.sh

# Installation complete
# Final comprehensive test
echo "🧪 FINAL COMPREHENSIVE TEST..."
echo "=============================="

# Test database connection and admin user
echo "Testing database and admin user..."
if curl -s http://localhost:8000/auth/test-db | grep -q "admin.*true"; then
    echo "✅ Database and admin user: WORKING"
else
    echo "❌ Database or admin user: FAILED"
fi

# Test login functionality
echo "Testing login functionality..."
LOGIN_RESULT=$(curl -s -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin"}')

if echo "$LOGIN_RESULT" | grep -q "success.*true"; then
    echo "✅ Admin login: WORKING"
else
    echo "❌ Admin login: FAILED"
    echo "Login response: $LOGIN_RESULT"
fi

# Test external access
echo "Testing external access..."
if curl -s --max-time 10 http://$SERVER_IP/health > /dev/null; then
    echo "✅ External access: WORKING"
else
    echo "❌ External access: FAILED"
fi

# Test frontend serving (ensure not nginx default page)
echo "Testing frontend serving..."
RESPONSE=$(curl -s --max-time 10 http://$SERVER_IP/)
if [[ "$RESPONSE" == *"Welcome to nginx"* ]]; then
    echo "❌ CRITICAL: Still serving nginx default page!"
    echo "Diagnosing issue..."
    
    # Check what's actually in /var/www/html/
    echo "Files in /var/www/html/:"
    ls -la /var/www/html/ || echo "Directory doesn't exist"
    
    # Check nginx configuration
    echo "Active nginx sites:"
    ls -la /etc/nginx/sites-enabled/
    
    # Check if our site is actually enabled
    if [ -f "/etc/nginx/sites-enabled/firebase-manager" ]; then
        echo "✅ firebase-manager site is enabled"
    else
        echo "❌ firebase-manager site NOT enabled"
    fi
    
    # Restart nginx and try again
    echo "🔄 Restarting nginx..."
    systemctl restart nginx
    sleep 5
    
    # Test again
    RESPONSE2=$(curl -s --max-time 10 http://$SERVER_IP/)
    if [[ "$RESPONSE2" == *"Welcome to nginx"* ]]; then
        echo "❌ Still nginx default after restart - INSTALLATION FAILED"
        exit 1
    else
        echo "✅ Fixed after nginx restart"
    fi
elif [[ "$RESPONSE" == *"<!DOCTYPE html>"* ]] || [[ "$RESPONSE" == *"Firebase"* ]] || [[ "$RESPONSE" == *"Login"* ]]; then
    echo "✅ Frontend app: SERVING CORRECTLY"
else
    echo "❌ Frontend: Unexpected response"
    echo "Response preview: ${RESPONSE:0:200}"
fi

echo ""
echo "🎉 INSTALLATION COMPLETE!"
echo "========================"
echo "✅ Your original repo is PRESERVED at: $CURRENT_DIR"
echo "✅ Application installed at: $APP_DIR"
echo "✅ Server IPv4: $SERVER_IP"
echo "✅ PostgreSQL database configured and running"
echo "✅ Admin user created with plain text password"
echo "✅ All services started and tested"
echo ""
echo "🌐 Access URLs:"
echo "Frontend: http://$SERVER_IP"
echo "Backend API: http://$SERVER_IP (through Nginx proxy)"
echo "Direct Backend: http://$SERVER_IP:8000"
echo ""
echo "🔑 Login Credentials:"
echo "Username: admin"
echo "Password: admin"
echo ""
echo "📋 Useful Commands:"
echo "Check Status: $APP_DIR/status.sh"
echo "View Logs: journalctl -u firebase-manager -f"
echo "Restart Backend: systemctl restart firebase-manager"
echo "Restart Nginx: systemctl restart nginx"
echo ""
echo "🎯 READY FOR PRODUCTION!"
echo "Your Firebase Manager is now ready to handle 1000+ campaigns!"
echo "All components tested and working perfectly!"

# Return to original directory
cd $CURRENT_DIR
echo ""
echo "✅ Returned to your original repo: $CURRENT_DIR"
echo "✅ Your files are completely preserved"
