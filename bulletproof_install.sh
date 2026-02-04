#!/bin/bash

# BULLETPROOF FIREBASE MANAGER INSTALLER
# =====================================
# This script WILL work on a fresh Ubuntu server - guaranteed.

set -e  # Exit on any error

print_status() {
    echo "🔵 $1"
}

print_success() {
    echo "✅ $1"
}

print_error() {
    echo "❌ $1"
}

print_status "Starting bulletproof Firebase Manager installation..."

# Get server IPv4
print_status "Detecting server IPv4 address..."
SERVER_IP=$(curl -4 -s --max-time 10 ifconfig.me || curl -4 -s --max-time 10 icanhazip.com || curl -4 -s --max-time 10 ipinfo.io/ip || echo "localhost")
print_success "Server IP: $SERVER_IP"

# Update system
print_status "Updating system packages..."
apt update -y
apt upgrade -y

# Install basic dependencies
print_status "Installing system dependencies..."
apt install -y curl wget git software-properties-common apt-transport-https ca-certificates gnupg lsb-release

# Install Python 3 and pip
print_status "Installing Python..."
apt install -y python3 python3-pip python3-venv python3-dev

# Install PostgreSQL
print_status "Installing PostgreSQL..."
apt install -y postgresql postgresql-contrib libpq-dev

# Clean any existing Node.js installations
print_status "Cleaning any existing Node.js..."
apt remove -y nodejs npm libnode-dev nodejs-legacy nodejs-doc 2>/dev/null || true
apt autoremove -y
apt --fix-broken install -y

# Install Node.js 18 from NodeSource
print_status "Installing Node.js 18..."
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt install -y nodejs

# Verify installations
print_success "Python version: $(python3 --version)"
print_success "Node.js version: $(node --version)"
print_success "npm version: $(npm --version)"

# Install and configure Nginx
print_status "Installing Nginx..."
apt install -y nginx
systemctl enable nginx

# Configure firewall
print_status "Configuring firewall..."
ufw allow 22
ufw allow 80
ufw allow 443
echo "y" | ufw enable

# Create application directory
APP_DIR="/var/www/firebase-manager"
print_status "Creating application directory: $APP_DIR"
rm -rf $APP_DIR
mkdir -p $APP_DIR
cd $APP_DIR

# Clone repository
print_status "Cloning Firebase Manager repository..."
git clone https://github.com/wbennettmary/FBG-.git .

# Set up PostgreSQL database
print_status "Setting up PostgreSQL database..."
sudo -u postgres psql << EOF
DROP DATABASE IF EXISTS firebase_manager;
DROP ROLE IF EXISTS emedia;
CREATE ROLE emedia WITH LOGIN PASSWORD 'Batata010..++' SUPERUSER;
CREATE DATABASE firebase_manager OWNER emedia;
GRANT ALL PRIVILEGES ON DATABASE firebase_manager TO emedia;
\q
EOF

# Create environment file
print_status "Creating environment configuration..."
cat > .env << EOF
# Firebase Manager Configuration
USE_DATABASE=true
USE_JSON_FILES=false
ENVIRONMENT=production
LOG_LEVEL=INFO
SERVER_IP=$SERVER_IP
BACKEND_PORT=8000

# Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_NAME=firebase_manager
DB_USER=emedia
DB_PASSWORD=Batata010..++
DB_URL=postgresql://emedia:Batata010..++@localhost:5432/firebase_manager

# SMTP Configuration (optional)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password
SMTP_FROM=your-email@gmail.com
EOF

# Set up Python virtual environment
print_status "Setting up Python virtual environment..."
python3 -m venv venv
source venv/bin/activate

# Install Python dependencies
print_status "Installing Python dependencies..."
pip install --upgrade pip

# Install ALL required dependencies from requirements.txt
print_status "Installing all Python dependencies from requirements.txt..."
pip install -r requirements.txt

# Install additional dependencies that might not be in requirements.txt
print_status "Installing additional Python dependencies..."
pip install \
    firebase-admin \
    pyrebase4 \
    google-auth \
    google-api-python-client \
    psycopg2-binary \
    fastapi \
    uvicorn \
    python-dotenv \
    requests \
    pydantic \
    python-jose[cryptography] \
    passlib[bcrypt] \
    python-multipart || true

print_success "All Python dependencies installed"

# Create Python module structure
print_status "Setting up Python module structure..."
touch src/__init__.py
touch src/utils/__init__.py

# Verify all critical dependencies are installed
print_status "Verifying Python dependencies..."
python3 -c "
import sys
missing = []
required_modules = [
    'fastapi', 'uvicorn', 'firebase_admin', 'pyrebase', 
    'psycopg2', 'dotenv', 'requests', 'pydantic',
    'jose', 'passlib', 'google.auth'
]

for module in required_modules:
    try:
        __import__(module)
        print(f'✅ {module}')
    except ImportError:
        print(f'❌ {module}')
        missing.append(module)

if missing:
    print(f'Missing modules: {missing}')
    sys.exit(1)
else:
    print('✅ All required Python modules are available')
"

if [ $? -ne 0 ]; then
    print_error "Some Python dependencies are missing!"
    exit 1
fi

# Create frontend environment file
print_status "Creating frontend environment configuration..."
cat > .env.local << EOF
VITE_API_BASE_URL=http://$SERVER_IP
VITE_SERVER_IP=$SERVER_IP
VITE_BACKEND_PORT=80
EOF

# Fix npm permissions
print_status "Setting up npm permissions..."
mkdir -p /var/www/.npm
chown -R www-data:www-data /var/www/.npm
chown -R www-data:www-data $APP_DIR

# Install frontend dependencies and build
print_status "Installing frontend dependencies..."
sudo -u www-data npm install

print_status "Building frontend..."
sudo -u www-data npm run build

# Verify frontend build
if [ ! -f "dist/index.html" ]; then
    print_error "Frontend build failed!"
    exit 1
fi
print_success "Frontend built successfully"

# Deploy frontend to nginx
print_status "Deploying frontend..."
rm -rf /var/www/html/*
cp -r dist/* /var/www/html/
chown -R www-data:www-data /var/www/html/
chmod -R 755 /var/www/html/

# Create nginx configuration
print_status "Configuring Nginx..."
cat > /etc/nginx/sites-available/firebase-manager << EOF
server {
    listen 80;
    server_name $SERVER_IP _;
    
    root /var/www/html;
    index index.html;
    
    # Frontend
    location / {
        try_files \$uri \$uri/ /index.html;
    }
    
    # Backend API
    location ~ ^/(auth|api|health|projects|campaigns|profiles|app-users|role-permissions|settings|audit-logs|ai|test|ws) {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

# Enable site and disable default
ln -sf /etc/nginx/sites-available/firebase-manager /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
rm -f /etc/nginx/sites-available/default

# Test nginx configuration
nginx -t
if [ $? -ne 0 ]; then
    print_error "Nginx configuration test failed"
    exit 1
fi

# Create systemd service
print_status "Creating systemd service..."
cat > /etc/systemd/system/firebase-manager.service << EOF
[Unit]
Description=Firebase Manager Backend
After=network.target postgresql.service

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=$APP_DIR
Environment=PATH=$APP_DIR/venv/bin
EnvironmentFile=$APP_DIR/.env
ExecStart=$APP_DIR/venv/bin/python src/utils/firebaseBackend.py
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

# Set correct permissions
chown -R www-data:www-data $APP_DIR
chmod +x $APP_DIR/venv/bin/python

# Test backend before creating service
print_status "Testing backend startup..."
source venv/bin/activate
timeout 10 python3 src/utils/firebaseBackend.py &
BACKEND_PID=$!
sleep 5

if kill -0 $BACKEND_PID 2>/dev/null; then
    print_success "Backend test successful"
    kill $BACKEND_PID 2>/dev/null || true
else
    print_error "Backend failed to start during test"
    echo "Backend logs:"
    python3 src/utils/firebaseBackend.py 2>&1 | head -20
    exit 1
fi

# Reload systemd and start services
print_status "Starting services..."
systemctl daemon-reload
systemctl enable firebase-manager
systemctl restart nginx
systemctl start firebase-manager

# Wait for services to start
sleep 15

# Verify installation
print_status "Verifying installation..."

# Check nginx
if systemctl is-active --quiet nginx; then
    print_success "Nginx is running"
else
    print_error "Nginx failed to start"
    exit 1
fi

# Check backend
if systemctl is-active --quiet firebase-manager; then
    print_success "Backend is running"
else
    print_error "Backend failed to start"
    systemctl status firebase-manager --no-pager
    exit 1
fi

# Test frontend
FRONTEND_RESPONSE=$(curl -s --max-time 10 http://$SERVER_IP/ | head -1)
if [[ "$FRONTEND_RESPONSE" == *"<!DOCTYPE html>"* ]] && ! [[ "$FRONTEND_RESPONSE" == *"nginx"* ]]; then
    print_success "Frontend is serving correctly"
elif [[ "$FRONTEND_RESPONSE" == *"Welcome to nginx"* ]]; then
    print_error "Still serving nginx default page"
    exit 1
else
    print_error "Frontend test failed"
    echo "Response: $FRONTEND_RESPONSE"
    exit 1
fi

# Test backend
BACKEND_RESPONSE=$(curl -s --max-time 10 http://$SERVER_IP/health)
if [[ "$BACKEND_RESPONSE" == *"healthy"* ]]; then
    print_success "Backend is responding correctly"
else
    print_error "Backend health check failed"
    echo "Response: $BACKEND_RESPONSE"
    exit 1
fi

# Test login
LOGIN_RESPONSE=$(curl -s --max-time 10 -X POST http://$SERVER_IP/auth/login \
    -H "Content-Type: application/json" \
    -d '{"username":"admin","password":"admin"}')

if [[ "$LOGIN_RESPONSE" == *"success"* ]]; then
    print_success "Login test successful"
else
    print_error "Login test failed"
    echo "Response: $LOGIN_RESPONSE"
    exit 1
fi

echo ""
echo "🎉 INSTALLATION COMPLETED SUCCESSFULLY!"
echo "======================================"
echo ""
echo "✅ Firebase Manager is now running on your server!"
echo ""
echo "🌐 Access your application:"
echo "   URL: http://$SERVER_IP"
echo ""
echo "🔑 Login credentials:"
echo "   Username: admin"
echo "   Password: admin"
echo ""
echo "📊 Service management:"
echo "   Check status: systemctl status firebase-manager"
echo "   View logs: journalctl -u firebase-manager -f"
echo "   Restart: systemctl restart firebase-manager"
echo ""
echo "📁 Application files:"
echo "   Location: $APP_DIR"
echo "   Config: $APP_DIR/.env"
echo ""
echo "🔧 Database:"
echo "   Type: PostgreSQL"
echo "   Database: firebase_manager"
echo "   User: emedia"
echo ""
echo "✅ Everything is working perfectly!"
