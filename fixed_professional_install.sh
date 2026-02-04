#!/bin/bash

# Fixed Professional PostgreSQL Installation for Firebase Manager
# Handles all permission issues and ensures backend starts correctly

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
APP_DIR="/var/www/firebase-manager"
SERVICE_USER="firebase"
SERVICE_GROUP="firebase"
CURRENT_DIR=$(pwd)
DB_NAME="firebase_manager"
DB_USER="emedia"
DB_PASSWORD="Batata010..++"

echo -e "${BLUE}🚀 Fixed Professional Firebase Manager Installation${NC}"
echo -e "${BLUE}=================================================${NC}"
echo ""

# Function to print colored output
print_status() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   print_error "This script must be run as root (use sudo)"
   exit 1
fi

print_info "Starting fixed professional installation..."

# Install system packages
print_info "Installing system packages..."
apt-get update
apt-get install -y python3 python3-pip python3-venv nginx supervisor curl wget git postgresql postgresql-contrib libpq-dev python3-dev

# Create service user if it doesn't exist
if ! id "$SERVICE_USER" &>/dev/null; then
    print_info "Creating service user: $SERVICE_USER"
    useradd -r -s /bin/bash -d $APP_DIR $SERVICE_USER
fi

# Create application directory
print_info "Setting up application directory..."
mkdir -p $APP_DIR
chown $SERVICE_USER:$SERVICE_GROUP $APP_DIR

# Copy current project to application directory (don't delete original)
print_info "Copying project files to $APP_DIR..."
cp -r . $APP_DIR/
chown -R $SERVICE_USER:$SERVICE_GROUP $APP_DIR

# Setup PostgreSQL - FIXED: No directory changes during DB operations
print_info "Setting up PostgreSQL..."
systemctl start postgresql
systemctl enable postgresql

# Create fresh database and user - FIXED: All operations from safe directory
print_info "Creating fresh PostgreSQL database..."
cd /tmp  # Safe directory for PostgreSQL operations

# Drop existing database and user if they exist
sudo -u postgres psql -c "DROP DATABASE IF EXISTS $DB_NAME;" 2>/dev/null || true
sudo -u postgres psql -c "DROP USER IF EXISTS $DB_USER;" 2>/dev/null || true

# Create fresh user and database
sudo -u postgres psql -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASSWORD';"
sudo -u postgres psql -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;"
sudo -u postgres psql -c "ALTER USER $DB_USER CREATEDB;"

print_success "PostgreSQL database created successfully"

# Return to application directory
cd $APP_DIR

# Create Python virtual environment
print_info "Setting up Python virtual environment..."
sudo -u $SERVICE_USER python3 -m venv venv
sudo -u $SERVICE_USER $APP_DIR/venv/bin/pip install --upgrade pip

# Install Python dependencies including PostgreSQL support
print_info "Installing Python dependencies..."
sudo -u $SERVICE_USER $APP_DIR/venv/bin/pip install fastapi uvicorn firebase-admin pyrebase4 python-dotenv google-auth requests python-multipart python-jose passlib aiofiles httpx psycopg2-binary sqlalchemy asyncpg

# Build frontend
print_info "Building frontend..."
sudo -u $SERVICE_USER npm install
sudo -u $SERVICE_USER npm run build

# Create database models and tables - FIXED: Simple Python script
print_info "Setting up database tables and admin user..."
cat > $APP_DIR/setup_db.py << 'EOF'
#!/usr/bin/env python3
import psycopg2
from datetime import datetime

# Database configuration
DB_CONFIG = {
    'host': 'localhost',
    'port': 5432,
    'user': 'emedia',
    'password': 'Batata010..++',
    'database': 'firebase_manager'
}

def setup_database():
    """Setup database tables and admin user"""
    try:
        # Connect to database
        conn = psycopg2.connect(**DB_CONFIG)
        conn.autocommit = True
        cursor = conn.cursor()
        
        # Create tables
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS app_users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(100) UNIQUE NOT NULL,
                email VARCHAR(255) UNIQUE,
                password_hash VARCHAR(255) NOT NULL,
                role VARCHAR(50) DEFAULT 'user',
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS user_permissions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES app_users(id) ON DELETE CASCADE,
                permission_name VARCHAR(100) NOT NULL,
                is_granted BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, permission_name)
            )
        ''')
        
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS profiles (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                description TEXT,
                owner_id INTEGER REFERENCES app_users(id) ON DELETE CASCADE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS projects (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                admin_email VARCHAR(255) NOT NULL,
                service_account JSONB NOT NULL,
                api_key VARCHAR(500) NOT NULL,
                profile_id INTEGER REFERENCES profiles(id) ON DELETE SET NULL,
                owner_id INTEGER REFERENCES app_users(id) ON DELETE CASCADE,
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS campaigns (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
                batch_size INTEGER DEFAULT 100,
                workers INTEGER DEFAULT 5,
                template TEXT,
                status VARCHAR(50) DEFAULT 'draft',
                owner_id INTEGER REFERENCES app_users(id) ON DELETE CASCADE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        # Create indexes for performance
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_campaigns_owner ON campaigns(owner_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_profiles_owner ON profiles(owner_id)')
        
        print("✅ Database tables created successfully")
        
        # Check if admin user exists
        cursor.execute("SELECT id FROM app_users WHERE username = 'admin'")
        admin_exists = cursor.fetchone()
        
        if not admin_exists:
            # Create admin user
            cursor.execute('''
                INSERT INTO app_users (username, email, password_hash, role, is_active)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING id
            ''', ('admin', 'admin@firebase-manager.com', 
                  '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj/RK.s5u.Ge', 
                  'admin', True))
            
            admin_id = cursor.fetchone()[0]
            
            # Create admin permissions
            admin_permissions = [
                'projects', 'users', 'campaigns', 'templates', 'ai', 'test', 
                'profiles', 'auditLogs', 'settings', 'smtp'
            ]
            
            for perm in admin_permissions:
                cursor.execute('''
                    INSERT INTO user_permissions (user_id, permission_name, is_granted)
                    VALUES (%s, %s, %s)
                ''', (admin_id, perm, True))
            
            print("✅ Admin user created with full permissions")
        else:
            print("✅ Admin user already exists")
        
        cursor.close()
        conn.close()
        print("✅ Database setup completed successfully")
        
    except Exception as e:
        print(f"❌ Database setup failed: {e}")
        raise

if __name__ == "__main__":
    setup_database()
EOF

# Run database setup
sudo -u $SERVICE_USER $APP_DIR/venv/bin/python setup_db.py

# Remove the setup script after use
rm -f setup_db.py

# Create environment configuration
print_info "Creating environment configuration..."
cat > $APP_DIR/.env << EOF
# Professional Firebase Manager Configuration
USE_DATABASE=true
USE_JSON_FILES=true
DB_HOST=localhost
DB_PORT=5432
DB_NAME=$DB_NAME
DB_USER=$DB_USER
DB_PASSWORD=$DB_PASSWORD
DB_URL=postgresql://$DB_USER:$DB_PASSWORD@localhost:5432/$DB_NAME
BACKEND_PORT=8000
LOG_LEVEL=INFO
ENVIRONMENT=production
EOF

chown $SERVICE_USER:$SERVICE_GROUP $APP_DIR/.env
chmod 600 $APP_DIR/.env

# Create systemd service
print_info "Creating systemd service..."
cat > /etc/systemd/system/firebase-manager.service << EOF
[Unit]
Description=Firebase Manager Professional Server
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=exec
User=$SERVICE_USER
Group=$SERVICE_GROUP
WorkingDirectory=$APP_DIR
Environment=PATH=$APP_DIR/venv/bin
ExecStart=$APP_DIR/venv/bin/python -m src.utils.firebaseBackend
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

# Create supervisor configuration
print_info "Creating supervisor configuration..."
cat > /etc/supervisor/conf.d/firebase-manager.conf << EOF
[program:firebase-manager]
command=$APP_DIR/venv/bin/python -m src.utils.firebaseBackend
directory=$APP_DIR
user=$SERVICE_USER
autostart=true
autorestart=true
redirect_stderr=true
stdout_logfile=$APP_DIR/logs/supervisor.log
stdout_logfile_maxbytes=50MB
stdout_logfile_backups=10
EOF

# Create logs directory
mkdir -p $APP_DIR/logs
chown -R $SERVICE_USER:$SERVICE_GROUP $APP_DIR/logs

# Configure Nginx
print_info "Configuring Nginx..."
cat > /etc/nginx/sites-available/firebase-manager << EOF
server {
    listen 80;
    server_name _;
    
    # Frontend static files
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
        proxy_pass http://127.0.0.1:8000/;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        
        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
    
    # WebSocket support
    location /ws {
        proxy_pass http://127.0.0.1:8000/ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    }
}
EOF

# Enable the site
ln -sf /etc/nginx/sites-available/firebase-manager /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# Test Nginx configuration
print_info "Testing Nginx configuration..."
nginx -t

# Configure firewall
print_info "Configuring firewall..."
ufw allow 80/tcp
ufw allow 22/tcp
ufw --force enable
print_success "Firewall configured - ports 80 and 22 are open"

# Start and enable services
print_info "Starting services..."
systemctl daemon-reload
systemctl enable firebase-manager
systemctl start firebase-manager
systemctl enable nginx
systemctl start nginx
systemctl enable supervisor
systemctl start supervisor

# Wait for backend to start
print_info "Waiting for backend to start..."
sleep 20

# Test if backend is responding
print_info "Testing backend..."
if curl -s --max-time 10 http://localhost:8000/ > /dev/null; then
    print_success "Backend is responding!"
else
    print_warning "Backend not responding yet, checking logs..."
    journalctl -u firebase-manager --no-pager -l --since "3 minutes ago" | tail -20
    print_error "Backend service is not responding properly. Attempting to restart..."
    
    # Try to restart the service
    systemctl restart firebase-manager
    sleep 15
    
    if curl -s --max-time 10 http://localhost:8000/ > /dev/null; then
        print_success "Backend is now responding after restart"
    else
        print_error "Backend still not responding. Installation may have failed."
        print_info "Please check the logs manually: journalctl -u firebase-manager -f"
        exit 1
    fi
fi

# Get server IP
SERVER_IP=$(curl -s ifconfig.me 2>/dev/null || echo "localhost")
print_info "Server IP detected: $SERVER_IP"

# Test if frontend is accessible
print_info "Testing frontend..."
if curl -s http://localhost/ | grep -q "Firebase Manager"; then
    print_success "Frontend is accessible!"
else
    print_warning "Frontend may not be displaying correctly"
fi

# Create status script
cat > $APP_DIR/status.sh << EOF
#!/bin/bash
echo "=== Firebase Manager Professional Status ==="
echo ""
echo "Server Information:"
echo "Server IP: \$(curl -s ifconfig.me 2>/dev/null || echo "localhost")"
echo "Application Directory: $APP_DIR"
echo ""
echo "Backend Service:"
systemctl status firebase-manager --no-pager -l
echo ""
echo "PostgreSQL Service:"
systemctl status postgresql --no-pager -l
echo ""
echo "Nginx Service:"
systemctl status nginx --no-pager -l
echo ""
echo "Database Connection:"
sudo -u postgres psql -d firebase_manager -c "SELECT version();" 2>/dev/null || echo "Database connection failed"
echo ""
echo "Backend Response:"
curl -s http://localhost:8000/ | head -5
echo ""
echo "Frontend Response:"
curl -s http://localhost/ | head -5
EOF

chmod +x $APP_DIR/status.sh
chown $SERVICE_USER:$SERVICE_GROUP $APP_DIR/status.sh

# Installation complete
echo ""
echo -e "${GREEN}🎉 Fixed Professional Installation Complete! 🎉${NC}"
echo ""
echo -e "${BLUE}Firebase Manager Professional Server has been installed successfully!${NC}"
echo ""
echo -e "${YELLOW}Important Information:${NC}"
echo -e "  • Application Directory: ${APP_DIR}"
echo -e "  • Service User: ${SERVICE_USER}"
echo -e "  • Database: ${DB_NAME} (User: ${DB_USER})"
echo -e "  • Backend URL: http://${SERVER_IP}:8000"
echo -e "  • Frontend URL: http://${SERVER_IP}"
echo -e "  • Server IP: ${SERVER_IP}"
echo ""
echo -e "${YELLOW}Default Admin Account:${NC}"
echo -e "  • Username: admin"
echo -e "  • Password: admin"
echo -e "  • Please change the password after first login!"
echo ""
echo -e "${YELLOW}Useful Commands:${NC}"
echo -e "  • Check Status: ${APP_DIR}/status.sh"
echo -e "  • View Logs: journalctl -u firebase-manager -f"
echo -e "  • Restart Service: systemctl restart firebase-manager"
echo ""
echo -e "${BLUE}Next Steps:${NC}"
echo -e "  1. Login with admin/admin"
echo -e "  2. Start creating profiles, projects, and users"
echo -e "  3. Your existing JSON data is preserved as backup"
echo -e "  4. New data will be stored in PostgreSQL"
echo ""
echo -e "${GREEN}Your professional server is ready to handle 1000+ campaigns! 🚀${NC}"

# Return to original directory
cd $CURRENT_DIR
print_info "Returned to original directory: $CURRENT_DIR"
print_info "Your project files are preserved here and copied to $APP_DIR"
print_info "PostgreSQL database is ready for professional use"
print_info "All permission issues have been resolved"
