#!/bin/bash

# Firebase Email Campaign App - Complete Installation Script
# This script automates the entire deployment process on Ubuntu server

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to get server IP
get_server_ip() {
    if command_exists curl; then
        SERVER_IP=$(curl -s ifconfig.me)
    elif command_exists wget; then
        SERVER_IP=$(wget -qO- ifconfig.me)
    else
        SERVER_IP="YOUR_SERVER_IP"
        print_warning "Could not automatically detect server IP. Please update .env file manually."
    fi
    echo $SERVER_IP
}

# Function to check if running as root
check_root() {
    if [[ $EUID -eq 0 ]]; then
        print_warning "Running as root. This is acceptable for server deployment."
        # Set USER to a default value if running as root
        if [ -z "$USER" ]; then
            USER="root"
        fi
    else
        print_status "Running as regular user with sudo privileges."
    fi
}

# Function to update system
update_system() {
    print_status "Updating Ubuntu system..."
    if [[ $EUID -eq 0 ]]; then
        apt update
        apt upgrade -y
    else
        sudo apt update
        sudo apt upgrade -y
    fi
    print_success "System updated successfully"
}

# Function to install dependencies
install_dependencies() {
    print_status "Installing required packages..."
    
    # Install system packages
    if [[ $EUID -eq 0 ]]; then
        apt install -y python3 python3-pip python3-venv nginx git curl wget unzip
        
        # Install Node.js
        if ! command_exists node; then
            print_status "Installing Node.js..."
            curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
            apt-get install -y nodejs
        fi
    else
        sudo apt install -y python3 python3-pip python3-venv nginx git curl wget unzip
        
        # Install Node.js
        if ! command_exists node; then
            print_status "Installing Node.js..."
            curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
            sudo apt-get install -y nodejs
        fi
    fi
    
    print_success "Dependencies installed successfully"
}

# Function to setup application directory
setup_app_directory() {
    print_status "Setting up application directory..."
    
    # Create directory
    mkdir -p /var/www/firebase-app
    
    # Set ownership based on user
    if [[ $EUID -eq 0 ]]; then
        # Running as root, set ownership to root
        chown -R root:root /var/www/firebase-app
    else
        # Running as regular user, use sudo
        sudo mkdir -p /var/www/firebase-app
        sudo chown -R $USER:$USER /var/www/firebase-app
    fi
    
    # Copy application files if they exist in current directory
    if [ -d "src" ] && [ -f "package.json" ]; then
        print_status "Copying application files..."
        cp -r * /var/www/firebase-app/
    else
        print_warning "Application files not found in current directory."
        print_status "Please upload your application files to /var/www/firebase-app/"
    fi
    
    cd /var/www/firebase-app
    print_success "Application directory setup complete"
}

# Function to install frontend dependencies
install_frontend_deps() {
    print_status "Installing frontend dependencies..."
    
    if [ -f "package.json" ]; then
        npm install
        print_success "Frontend dependencies installed"
    else
        print_warning "package.json not found. Skipping frontend setup."
    fi
}

# Function to build frontend
build_frontend() {
    print_status "Building frontend..."
    
    if [ -f "package.json" ]; then
        npm run build
        print_success "Frontend built successfully"
    else
        print_warning "package.json not found. Skipping frontend build."
    fi
}

# Function to install Python dependencies
install_python_deps() {
    print_status "Installing Python dependencies..."
    
    if [ -f "requirements.txt" ]; then
        pip3 install -r requirements.txt
        print_success "Python dependencies installed"
    else
        print_warning "requirements.txt not found. Installing common dependencies..."
        pip3 install fastapi uvicorn firebase-admin pyrebase4 google-cloud-resourcemanager requests
    fi
}

# Function to create environment file
create_env_file() {
    print_status "Creating environment configuration..."
    
    SERVER_IP=$(get_server_ip)
    
    cat > .env << EOF
VITE_API_BASE_URL=http://${SERVER_IP}:8000
VITE_WS_URL=ws://${SERVER_IP}:8000/ws
EOF
    
    print_success "Environment file created with IP: ${SERVER_IP}"
}

# Function to create Nginx configuration
create_nginx_config() {
    print_status "Creating Nginx configuration..."
    
    if [[ $EUID -eq 0 ]]; then
        tee /etc/nginx/sites-available/firebase-app > /dev/null << 'EOF'
server {
    listen 80;
    server_name _;

    # Frontend files
    location / {
        root /var/www/firebase-app;
        try_files $uri $uri/ /index.html;
    }

    # Backend API
    location /api/ {
        proxy_pass http://localhost:8000/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # WebSocket support
    location /ws {
        proxy_pass http://localhost:8000/ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Backend endpoints
    location ~ ^/(health|projects|campaigns|profiles|daily-counts|test-reset-email|api/) {
        proxy_pass http://localhost:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
EOF
        
        # Enable site
        ln -sf /etc/nginx/sites-available/firebase-app /etc/nginx/sites-enabled/
        
        # Test and restart Nginx
        nginx -t
        systemctl restart nginx
    else
        sudo tee /etc/nginx/sites-available/firebase-app > /dev/null << 'EOF'
server {
    listen 80;
    server_name _;

    # Frontend files
    location / {
        root /var/www/firebase-app;
        try_files $uri $uri/ /index.html;
    }

    # Backend API
    location /api/ {
        proxy_pass http://localhost:8000/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # WebSocket support
    location /ws {
        proxy_pass http://localhost:8000/ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Backend endpoints
    location ~ ^/(health|projects|campaigns|profiles|daily-counts|test-reset-email|api/) {
        proxy_pass http://localhost:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
EOF
        
        # Enable site
        sudo ln -sf /etc/nginx/sites-available/firebase-app /etc/nginx/sites-enabled/
        
        # Test and restart Nginx
        sudo nginx -t
        sudo systemctl restart nginx
    fi
    
    print_success "Nginx configuration created and enabled"
}

# Function to create systemd service
create_systemd_service() {
    print_status "Creating systemd service..."
    
    if [[ $EUID -eq 0 ]]; then
        tee /etc/systemd/system/firebase-backend.service > /dev/null << 'EOF'
[Unit]
Description=Firebase Email Campaign Backend
After=network.target

[Service]
Type=exec
User=root
WorkingDirectory=/var/www/firebase-app
Environment=PYTHONPATH=/var/www/firebase-app
ExecStart=/usr/bin/python3 src/utils/firebaseBackend.py
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
        
        # Reload systemd and enable service
        systemctl daemon-reload
        systemctl enable firebase-backend
    else
        sudo tee /etc/systemd/system/firebase-backend.service > /dev/null << 'EOF'
[Unit]
Description=Firebase Email Campaign Backend
After=network.target

[Service]
Type=exec
User=root
WorkingDirectory=/var/www/firebase-app
Environment=PYTHONPATH=/var/www/firebase-app
ExecStart=/usr/bin/python3 src/utils/firebaseBackend.py
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
        
        # Reload systemd and enable service
        sudo systemctl daemon-reload
        sudo systemctl enable firebase-backend
    fi
    
    print_success "Systemd service created and enabled"
}

# Function to configure firewall
configure_firewall() {
    print_status "Configuring firewall..."
    
    if [[ $EUID -eq 0 ]]; then
        apt install -y ufw
        ufw allow ssh
        ufw allow 80
        ufw allow 443
        ufw allow 8000
        ufw --force enable
    else
        sudo apt install -y ufw
        sudo ufw allow ssh
        sudo ufw allow 80
        sudo ufw allow 443
        sudo ufw allow 8000
        sudo ufw --force enable
    fi
    
    print_success "Firewall configured"
}

# Function to start services
start_services() {
    print_status "Starting services..."
    
    if [[ $EUID -eq 0 ]]; then
        systemctl start firebase-backend
        systemctl restart nginx
    else
        sudo systemctl start firebase-backend
        sudo systemctl restart nginx
    fi
    
    print_success "Services started"
}

# Function to check installation
check_installation() {
    print_status "Checking installation..."
    
    # Check backend service
    if [[ $EUID -eq 0 ]]; then
        if systemctl is-active --quiet firebase-backend; then
            print_success "Backend service is running"
        else
            print_error "Backend service is not running"
            return 1
        fi
        
        # Check nginx service
        if systemctl is-active --quiet nginx; then
            print_success "Nginx service is running"
        else
            print_error "Nginx service is not running"
            return 1
        fi
    else
        if sudo systemctl is-active --quiet firebase-backend; then
            print_success "Backend service is running"
        else
            print_error "Backend service is not running"
            return 1
        fi
        
        # Check nginx service
        if sudo systemctl is-active --quiet nginx; then
            print_success "Nginx service is running"
        else
            print_error "Nginx service is not running"
            return 1
        fi
    fi
    
    # Test backend API
    if curl -s http://localhost:8000/health > /dev/null; then
        print_success "Backend API is responding"
    else
        print_error "Backend API is not responding"
        return 1
    fi
    
    print_success "Installation check completed successfully"
}

# Function to display final information
display_final_info() {
    SERVER_IP=$(get_server_ip)
    
    echo ""
    echo "=================================================="
    echo "🎉 INSTALLATION COMPLETED SUCCESSFULLY! 🎉"
    echo "=================================================="
    echo ""
    echo "📋 Access Information:"
    echo "   Frontend: http://${SERVER_IP}"
    echo "   Backend API: http://${SERVER_IP}:8000"
    echo "   Health Check: http://${SERVER_IP}:8000/health"
    echo ""
    echo "📊 Service Status:"
    if [[ $EUID -eq 0 ]]; then
        systemctl status firebase-backend --no-pager -l
    else
        sudo systemctl status firebase-backend --no-pager -l
    fi
    echo ""
    echo "📝 Next Steps:"
    echo "   1. Upload your Firebase configuration files:"
    echo "      - admin_service_account.json"
    echo "      - private_keys.json"
    echo "      - apikeys.txt"
    echo "   2. Access the application at http://${SERVER_IP}"
    echo "   3. Import your Firebase projects"
    echo "   4. Test all features"
    echo ""
    echo "🔧 Useful Commands:"
    echo "   Check backend logs: sudo journalctl -u firebase-backend -f"
    echo "   Restart backend: sudo systemctl restart firebase-backend"
    echo "   Check nginx logs: sudo tail -f /var/log/nginx/access.log"
    echo ""
    echo "=================================================="
}

# Function to handle errors
handle_error() {
    print_error "Installation failed at step: $1"
    print_error "Please check the logs and try again"
    exit 1
}

# Main installation function
main() {
    echo "=================================================="
    echo "🚀 Firebase Email Campaign App - Complete Installation"
    echo "=================================================="
    echo ""
    
    # Check if not running as root
    check_root
    
    # Run installation steps
    update_system || handle_error "System update"
    install_dependencies || handle_error "Dependencies installation"
    setup_app_directory || handle_error "App directory setup"
    install_frontend_deps || handle_error "Frontend dependencies"
    build_frontend || handle_error "Frontend build"
    install_python_deps || handle_error "Python dependencies"
    create_env_file || handle_error "Environment configuration"
    create_nginx_config || handle_error "Nginx configuration"
    create_systemd_service || handle_error "Systemd service"
    configure_firewall || handle_error "Firewall configuration"
    start_services || handle_error "Service startup"
    check_installation || handle_error "Installation verification"
    
    # Display final information
    display_final_info
}

# Run main function
main "$@" 