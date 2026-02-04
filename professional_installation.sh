#!/bin/bash

# =============================================================================
# Firebase Email Campaign App - Professional Installation Script
# =============================================================================
# This script provides a complete, automated installation of the Firebase
# Email Campaign App on Ubuntu 22.04+ servers.
# 
# Features:
# - Server preparation and security
# - Node.js and Python environment setup
# - Frontend build and deployment
# - Backend service configuration
# - Nginx reverse proxy setup
# - Firewall configuration
# - SSL certificate setup (optional)
# - Health checks and monitoring
# =============================================================================

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Logging function
log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}"
}

warn() {
    echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] WARNING: $1${NC}"
}

error() {
    echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] ERROR: $1${NC}"
    exit 1
}

info() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')] INFO: $1${NC}"
}

# Configuration
APP_NAME="firebase-app"
APP_DIR="/var/www/$APP_NAME"
BACKEND_PORT="8000"
FRONTEND_PORT="80"
SERVICE_USER="www-data"
LOG_FILE="/var/log/firebase-app-install.log"

# Get server IP
SERVER_IP=$(curl -s ifconfig.me || curl -s ipinfo.io/ip || echo "localhost")

# Function to check if running as root
check_root() {
    if [[ $EUID -ne 0 ]]; then
        error "This script must be run as root. Use: sudo $0"
    fi
}

# Function to check Ubuntu version
check_ubuntu_version() {
    if ! command -v lsb_release &> /dev/null; then
        apt update && apt install -y lsb-release
    fi
    
    UBUNTU_VERSION=$(lsb_release -rs)
    if [[ "$UBUNTU_VERSION" != "22.04" && "$UBUNTU_VERSION" != "24.04" ]]; then
        warn "This script is tested on Ubuntu 22.04 and 24.04. Current version: $UBUNTU_VERSION"
    fi
}

# Function to update system
update_system() {
    log "Updating system packages..."
    apt update -y
    apt upgrade -y
    apt autoremove -y
    apt autoclean
}

# Function to install essential packages
install_essential_packages() {
    log "Installing essential packages..."
    apt install -y \
        curl \
        wget \
        git \
        unzip \
        software-properties-common \
        apt-transport-https \
        ca-certificates \
        gnupg \
        lsb-release \
        build-essential \
        python3-dev \
        python3-pip \
        python3-venv \
        python3-full \
        nginx \
        ufw \
        certbot \
        python3-certbot-nginx \
        supervisor \
        htop \
        nano \
        vim \
        tree \
        jq \
        bc
}

# Function to install Node.js
install_nodejs() {
    log "Installing Node.js 20.x..."
    
    # Remove old Node.js if exists
    apt remove -y nodejs npm 2>/dev/null || true
    
    # Install Node.js 20.x
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt install -y nodejs
    
    # Verify installation
    NODE_VERSION=$(node --version)
    NPM_VERSION=$(npm --version)
    log "Node.js $NODE_VERSION and npm $NPM_VERSION installed successfully"
}

# Function to install Python dependencies
install_python_dependencies() {
    log "Installing Python dependencies..."
    
    # Create virtual environment
    python3 -m venv /opt/firebase-app-venv
    source /opt/firebase-app-venv/bin/activate
    
    # Upgrade pip
    pip install --upgrade pip
    
    # Install Python packages
    pip install \
        setuptools \
        wheel \
        fastapi \
        uvicorn[standard] \
        firebase-admin \
        pyrebase4 \
        google-cloud-resource-manager \
        requests \
        python-multipart \
        python-jose[cryptography] \
        passlib[bcrypt] \
        python-dotenv \
        aiofiles \
        httpx \
        google-auth
    
    log "Python dependencies installed successfully"
}

# Function to create application directory
create_app_directory() {
    log "Creating application directory..."
    
    mkdir -p $APP_DIR
    mkdir -p $APP_DIR/logs
    mkdir -p $APP_DIR/data
    mkdir -p /etc/firebase-app
    
    # Set proper permissions
    chown -R $SERVICE_USER:$SERVICE_USER $APP_DIR
    chmod -R 755 $APP_DIR
}

# Function to setup environment variables
setup_environment() {
    log "Setting up environment variables..."
    
    cat > $APP_DIR/.env << EOF
# Firebase Email Campaign App Environment
VITE_API_BASE_URL=http://$SERVER_IP:$BACKEND_PORT
VITE_WS_URL=ws://$SERVER_IP:$BACKEND_PORT
NODE_ENV=production
EOF
    
    chown $SERVICE_USER:$SERVICE_USER $APP_DIR/.env
    chmod 600 $APP_DIR/.env
}

# Function to build frontend
build_frontend() {
    log "Building frontend application..."
    
    # Copy project files to application directory
    log "Copying project files..."
    cp -r . $APP_DIR/
    chown -R $SERVICE_USER:$SERVICE_USER $APP_DIR
    chmod -R 755 $APP_DIR
    
    cd $APP_DIR
    
    # Install Node.js dependencies
    log "Installing Node.js dependencies..."
    npm install
    
    # Build frontend
    log "Building frontend for production..."
    npm run build
    
    # Verify build
    if [[ ! -d "dist" ]]; then
        error "Frontend build failed - dist directory not found"
    fi
    
    log "Frontend built successfully"
}

# Function to setup backend service
setup_backend_service() {
    log "Setting up backend service..."
    
    cat > /etc/systemd/system/firebase-backend.service << EOF
[Unit]
Description=Firebase Email Campaign Backend
After=network.target
Wants=network.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_USER
WorkingDirectory=$APP_DIR
Environment=PATH=/opt/firebase-app-venv/bin:/usr/bin:/usr/local/bin
Environment=PYTHONPATH=$APP_DIR
Environment=PYTHONUNBUFFERED=1
ExecStart=/opt/firebase-app-venv/bin/python src/utils/firebaseBackend.py
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=firebase-backend

# Security settings
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$APP_DIR

[Install]
WantedBy=multi-user.target
EOF
    
    # Reload systemd and enable service
    systemctl daemon-reload
    systemctl enable firebase-backend
}

# Function to setup Nginx
setup_nginx() {
    log "Setting up Nginx reverse proxy..."
    
    # Backup default nginx config
    cp /etc/nginx/sites-available/default /etc/nginx/sites-available/default.backup 2>/dev/null || true
    
    # Create nginx configuration
    cat > /etc/nginx/sites-available/$APP_NAME << EOF
server {
    listen 80;
    server_name $SERVER_IP;
    
    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "no-referrer-when-downgrade" always;
    add_header Content-Security-Policy "default-src 'self' http: https: data: blob: 'unsafe-inline'" always;
    
    # Frontend
    location / {
        root $APP_DIR/dist;
        try_files \$uri \$uri/ /index.html;
        
        # Cache static assets
        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg)$ {
            expires 1y;
            add_header Cache-Control "public, immutable";
        }
    }
    
    # Backend API
    location /api/ {
        proxy_pass http://127.0.0.1:$BACKEND_PORT/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }
    
    # WebSocket support
    location /ws/ {
        proxy_pass http://127.0.0.1:$BACKEND_PORT/ws/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
    
    # Health check
    location /health {
        proxy_pass http://127.0.0.1:$BACKEND_PORT/health;
        access_log off;
    }
    
    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_proxied expired no-cache no-store private auth;
    gzip_types text/plain text/css text/xml text/javascript application/x-javascript application/xml+rss application/javascript;
}
EOF
    
    # Enable site
    ln -sf /etc/nginx/sites-available/$APP_NAME /etc/nginx/sites-enabled/
    rm -f /etc/nginx/sites-enabled/default
    
    # Test nginx configuration
    nginx -t
    
    # Restart nginx
    systemctl restart nginx
    systemctl enable nginx
}

# Function to setup firewall
setup_firewall() {
    log "Setting up firewall..."
    
    # Reset UFW
    ufw --force reset
    
    # Set default policies
    ufw default deny incoming
    ufw default allow outgoing
    
    # Allow SSH
    ufw allow ssh
    
    # Allow HTTP and HTTPS
    ufw allow 80/tcp
    ufw allow 443/tcp
    
    # Allow backend port (if needed externally)
    # ufw allow $BACKEND_PORT/tcp
    
    # Enable firewall
    ufw --force enable
    
    log "Firewall configured successfully"
}

# Function to setup SSL (optional)
setup_ssl() {
    read -p "Do you want to setup SSL certificate with Let's Encrypt? (y/n): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        read -p "Enter your domain name (or press Enter to skip): " DOMAIN_NAME
        if [[ -n "$DOMAIN_NAME" ]]; then
            log "Setting up SSL certificate for $DOMAIN_NAME..."
            
            # Update nginx config with domain
            sed -i "s/server_name $SERVER_IP;/server_name $DOMAIN_NAME $SERVER_IP;/" /etc/nginx/sites-available/$APP_NAME
            
            # Reload nginx
            systemctl reload nginx
            
            # Get SSL certificate
            certbot --nginx -d $DOMAIN_NAME --non-interactive --agree-tos --email admin@$DOMAIN_NAME
            
            # Setup auto-renewal
            (crontab -l 2>/dev/null; echo "0 12 * * * /usr/bin/certbot renew --quiet") | crontab -
            
            log "SSL certificate setup completed"
        fi
    fi
}

# Function to create health check script
create_health_check() {
    log "Creating health check script..."
    
    cat > /usr/local/bin/firebase-app-health << 'EOF'
#!/bin/bash

APP_DIR="/var/www/firebase-app"
BACKEND_PORT="8000"

# Check if backend is running
if ! curl -s http://localhost:$BACKEND_PORT/health > /dev/null; then
    echo "Backend health check failed"
    systemctl restart firebase-backend
    exit 1
fi

# Check if nginx is running
if ! systemctl is-active --quiet nginx; then
    echo "Nginx is not running"
    systemctl restart nginx
    exit 1
fi

echo "All services are healthy"
exit 0
EOF
    
    chmod +x /usr/local/bin/firebase-app-health
    
    # Add to crontab for monitoring
    (crontab -l 2>/dev/null; echo "*/5 * * * * /usr/local/bin/firebase-app-health") | crontab -
}

# Function to create backup script
create_backup_script() {
    log "Creating backup script..."
    
    cat > /usr/local/bin/firebase-app-backup << 'EOF'
#!/bin/bash

BACKUP_DIR="/var/backups/firebase-app"
APP_DIR="/var/www/firebase-app"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR

# Backup application data
tar -czf $BACKUP_DIR/app_data_$DATE.tar.gz -C $APP_DIR data/ 2>/dev/null || true

# Keep only last 7 backups
find $BACKUP_DIR -name "app_data_*.tar.gz" -mtime +7 -delete

echo "Backup completed: $BACKUP_DIR/app_data_$DATE.tar.gz"
EOF
    
    chmod +x /usr/local/bin/firebase-app-backup
    
    # Add to crontab for daily backups
    (crontab -l 2>/dev/null; echo "0 2 * * * /usr/local/bin/firebase-app-backup") | crontab -
}

# Function to create log rotation
setup_log_rotation() {
    log "Setting up log rotation..."
    
    cat > /etc/logrotate.d/firebase-app << EOF
$APP_DIR/logs/*.log {
    daily
    missingok
    rotate 30
    compress
    delaycompress
    notifempty
    create 644 $SERVICE_USER $SERVICE_USER
    postrotate
        systemctl reload firebase-backend > /dev/null 2>&1 || true
    endscript
}
EOF
}

# Function to start services
start_services() {
    log "Starting services..."
    
    # Start backend
    systemctl start firebase-backend
    
    # Wait for backend to start
    sleep 5
    
    # Check service status
    if systemctl is-active --quiet firebase-backend; then
        log "Backend service started successfully"
    else
        error "Backend service failed to start"
    fi
    
    if systemctl is-active --quiet nginx; then
        log "Nginx service is running"
    else
        error "Nginx service failed to start"
    fi
}

# Function to run health checks
run_health_checks() {
    log "Running health checks..."
    
    # Check backend health
    if curl -s http://localhost:$BACKEND_PORT/health > /dev/null; then
        log "✅ Backend health check passed"
    else
        warn "❌ Backend health check failed"
    fi
    
    # Check frontend
    if curl -s http://localhost > /dev/null; then
        log "✅ Frontend is accessible"
    else
        warn "❌ Frontend is not accessible"
    fi
    
    # Check services
    if systemctl is-active --quiet firebase-backend; then
        log "✅ Backend service is running"
    else
        warn "❌ Backend service is not running"
    fi
    
    if systemctl is-active --quiet nginx; then
        log "✅ Nginx service is running"
    else
        warn "❌ Nginx service is not running"
    fi
}

# Function to display installation summary
display_summary() {
    echo
    echo "============================================================================="
    echo "🎉 FIREBASE EMAIL CAMPAIGN APP INSTALLATION COMPLETED SUCCESSFULLY!"
    echo "============================================================================="
    echo
    echo "📋 Installation Summary:"
    echo "   • Server IP: $SERVER_IP"
    echo "   • Frontend URL: http://$SERVER_IP"
    echo "   • Backend API: http://$SERVER_IP:$BACKEND_PORT"
    echo "   • Health Check: http://$SERVER_IP/health"
    echo
    echo "🔧 Services:"
    echo "   • Backend: systemctl status firebase-backend"
    echo "   • Nginx: systemctl status nginx"
    echo "   • Firewall: ufw status"
    echo
    echo "📁 Application Directory: $APP_DIR"
    echo "📝 Logs: journalctl -u firebase-backend -f"
    echo "🔍 Health Check: /usr/local/bin/firebase-app-health"
    echo "💾 Backup: /usr/local/bin/firebase-app-backup"
    echo
    echo "🚀 Next Steps:"
    echo "   1. Upload your Firebase service account key to: $APP_DIR/admin_service_account.json"
    echo "   2. Upload your API keys to: $APP_DIR/apikeys.txt"
    echo "   3. Upload your private keys to: $APP_DIR/private_keys.json"
    echo "   4. Restart the backend: systemctl restart firebase-backend"
    echo "   5. Access the application at: http://$SERVER_IP"
    echo
    echo "📞 Support: Check logs with 'journalctl -u firebase-backend -f'"
    echo "============================================================================="
}

# Main installation function
main() {
    echo "============================================================================="
    echo "🚀 FIREBASE EMAIL CAMPAIGN APP - PROFESSIONAL INSTALLATION"
    echo "============================================================================="
    echo
    
    # Check prerequisites
    check_root
    check_ubuntu_version
    
    # Installation steps
    update_system
    install_essential_packages
    install_nodejs
    install_python_dependencies
    create_app_directory
    setup_environment
    build_frontend
    setup_backend_service
    setup_nginx
    setup_firewall
    setup_ssl
    create_health_check
    create_backup_script
    setup_log_rotation
    start_services
    run_health_checks
    display_summary
    
    log "Installation completed successfully!"
}

# Run main function
main "$@" 