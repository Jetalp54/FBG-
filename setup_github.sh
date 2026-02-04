#!/bin/bash

# =============================================================================
# GitHub Repository Setup Script
# =============================================================================
# This script helps you set up a GitHub repository for the Firebase Email
# Campaign App and configure Git for easy synchronization.
# =============================================================================

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

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

# Check if git is installed
check_git() {
    if ! command -v git &> /dev/null; then
        error "Git is not installed. Please install Git first."
    fi
}

# Initialize git repository
init_git() {
    log "Initializing Git repository..."
    
    if [ -d ".git" ]; then
        warn "Git repository already exists. Skipping initialization."
        return
    fi
    
    git init
    log "Git repository initialized successfully"
}

# Configure git user
configure_git_user() {
    log "Configuring Git user..."
    
    # Check if git user is already configured
    if git config --global user.name &> /dev/null && git config --global user.email &> /dev/null; then
        info "Git user already configured:"
        echo "  Name: $(git config --global user.name)"
        echo "  Email: $(git config --global user.email)"
        return
    fi
    
    echo "Please enter your Git configuration:"
    read -p "Enter your name: " GIT_NAME
    read -p "Enter your email: " GIT_EMAIL
    
    git config --global user.name "$GIT_NAME"
    git config --global user.email "$GIT_EMAIL"
    
    log "Git user configured successfully"
}

# Add files to git
add_files() {
    log "Adding files to Git..."
    
    # Add all files except those in .gitignore
    git add .
    
    # Check what files will be committed
    info "Files to be committed:"
    git status --porcelain | while read -r line; do
        echo "  $line"
    done
    
    log "Files added to Git successfully"
}

# Create initial commit
create_initial_commit() {
    log "Creating initial commit..."
    
    git commit -m "Initial commit: Firebase Email Campaign App

- React/TypeScript frontend with Firebase integration
- FastAPI Python backend with Firebase Admin SDK
- Campaign management and automation features
- User management and template system
- Professional deployment scripts and documentation

Features:
- Email campaign creation and sending
- User bulk operations (add, delete, update)
- Template management with auth domain updates
- Real-time campaign monitoring
- Audit logging and backup system
- Professional server deployment automation"
    
    log "Initial commit created successfully"
}

# Create GitHub repository
create_github_repo() {
    log "Setting up GitHub repository..."
    
    echo "Please follow these steps to create a GitHub repository:"
    echo
    echo "1. Go to https://github.com/new"
    echo "2. Enter repository name (e.g., 'firebase-email-campaign-app')"
    echo "3. Choose visibility (Public or Private)"
    echo "4. DO NOT initialize with README, .gitignore, or license (we already have these)"
    echo "5. Click 'Create repository'"
    echo
    read -p "Press Enter when you've created the repository..."
    
    echo "Please enter your GitHub repository URL:"
    read -p "Repository URL (e.g., https://github.com/username/repo-name.git): " REPO_URL
    
    if [[ -z "$REPO_URL" ]]; then
        error "Repository URL is required"
    fi
    
    # Add remote origin
    git remote add origin "$REPO_URL"
    log "GitHub remote added successfully"
    
    # Push to GitHub
    log "Pushing to GitHub..."
    git branch -M main
    git push -u origin main
    
    log "Repository pushed to GitHub successfully!"
    echo
    echo "Your repository is now available at: $REPO_URL"
}

# Create deployment script for server
create_server_deploy_script() {
    log "Creating server deployment script..."
    
    cat > deploy_from_github.sh << 'EOF'
#!/bin/bash

# =============================================================================
# Server Deployment from GitHub
# =============================================================================
# This script deploys the Firebase Email Campaign App from GitHub
# =============================================================================

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

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

# Configuration
APP_NAME="firebase-app"
APP_DIR="/var/www/$APP_NAME"
BACKUP_DIR="/var/backups/firebase-app"
GITHUB_REPO=""

# Get GitHub repository URL
get_repo_url() {
    echo "Please enter your GitHub repository URL:"
    read -p "Repository URL: " GITHUB_REPO
    
    if [[ -z "$GITHUB_REPO" ]]; then
        error "Repository URL is required"
    fi
}

# Backup current version
backup_current() {
    if [[ -d "$APP_DIR" ]]; then
        log "Backing up current version..."
        mkdir -p "$BACKUP_DIR"
        cp -r "$APP_DIR" "$BACKUP_DIR/backup_$(date +%Y%m%d_%H%M%S)"
        log "Backup completed"
    fi
}

# Clone or pull from GitHub
update_from_github() {
    log "Updating from GitHub..."
    
    if [[ -d "$APP_DIR/.git" ]]; then
        # Repository exists, pull latest changes
        cd "$APP_DIR"
        git pull origin main
        log "Pulled latest changes from GitHub"
    else
        # Clone repository
        rm -rf "$APP_DIR"
        git clone "$GITHUB_REPO" "$APP_DIR"
        log "Cloned repository from GitHub"
    fi
}

# Install dependencies and build
build_application() {
    log "Installing dependencies and building application..."
    
    cd "$APP_DIR"
    
    # Install Node.js dependencies
    npm ci --production=false
    
    # Build frontend
    npm run build
    
    # Install Python dependencies (if using virtual environment)
    if [[ -f "/opt/firebase-app-venv/bin/activate" ]]; then
        source /opt/firebase-app-venv/bin/activate
        pip install -r requirements.txt
    else
        pip3 install -r requirements.txt
    fi
    
    log "Application built successfully"
}

# Restart services
restart_services() {
    log "Restarting services..."
    
    # Restart backend
    systemctl restart firebase-backend
    
    # Reload nginx
    systemctl reload nginx
    
    log "Services restarted successfully"
}

# Check deployment
check_deployment() {
    log "Checking deployment..."
    
    # Check backend health
    if curl -s http://localhost:8000/health > /dev/null; then
        log "✅ Backend is healthy"
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
}

# Main deployment function
main() {
    echo "============================================================================="
    echo "🚀 DEPLOYING FIREBASE EMAIL CAMPAIGN APP FROM GITHUB"
    echo "============================================================================="
    echo
    
    # Check if running as root
    if [[ $EUID -ne 0 ]]; then
        error "This script must be run as root. Use: sudo $0"
    fi
    
    # Get repository URL
    get_repo_url
    
    # Deployment steps
    backup_current
    update_from_github
    build_application
    restart_services
    check_deployment
    
    echo
    echo "============================================================================="
    echo "🎉 DEPLOYMENT COMPLETED SUCCESSFULLY!"
    echo "============================================================================="
    echo
    echo "📋 Next Steps:"
    echo "   1. Upload your configuration files:"
    echo "      - $APP_DIR/admin_service_account.json"
    echo "      - $APP_DIR/apikeys.txt"
    echo "      - $APP_DIR/private_keys.json"
    echo "   2. Restart the backend: systemctl restart firebase-backend"
    echo "   3. Access the application at: http://$(curl -s ifconfig.me)"
    echo
    echo "📞 Support: Check logs with 'journalctl -u firebase-backend -f'"
    echo "============================================================================="
}

# Run main function
main "$@"
EOF
    
    chmod +x deploy_from_github.sh
    log "Server deployment script created: deploy_from_github.sh"
}

# Create README for GitHub
update_readme() {
    log "Updating README for GitHub..."
    
    cat > README.md << 'EOF'
# 🚀 Firebase Email Campaign App

A professional Firebase-based email campaign management application with React/TypeScript frontend and FastAPI Python backend.

## 🌟 Features

- **Email Campaign Management**: Create, send, and monitor email campaigns
- **User Management**: Bulk user operations (add, delete, update)
- **Template System**: Manage email templates with Firebase Auth domain updates
- **Real-time Monitoring**: Live campaign progress tracking
- **Audit Logging**: Comprehensive activity logging
- **Professional Deployment**: Automated server setup and deployment

## 🛠️ Tech Stack

- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS, Shadcn/ui
- **Backend**: FastAPI, Python 3.9+, Firebase Admin SDK
- **Database**: Firebase Firestore
- **Authentication**: Firebase Auth
- **Deployment**: Nginx, Systemd, UFW Firewall

## 📋 Prerequisites

- Node.js 20.x
- Python 3.9+
- Firebase project with Admin SDK
- Ubuntu 22.04+ server (for deployment)

## 🚀 Quick Start

### Local Development

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/firebase-email-campaign-app.git
   cd firebase-email-campaign-app
   ```

2. **Install dependencies**
   ```bash
   # Frontend dependencies
   npm install
   
   # Backend dependencies
   pip install -r requirements.txt
   ```

3. **Configure Firebase**
   - Upload your Firebase service account key as `admin_service_account.json`
   - Upload your API keys as `apikeys.txt`
   - Upload your private keys as `private_keys.json`

4. **Start development servers**
   ```bash
   # Frontend (port 8080)
   npm run dev
   
   # Backend (port 8000)
   python src/utils/firebaseBackend.py
   ```

5. **Access the application**
   - Frontend: http://localhost:8080
   - Backend API: http://localhost:8000

### Server Deployment

1. **Run the professional installation script**
   ```bash
   chmod +x professional_installation.sh
   sudo ./professional_installation.sh
   ```

2. **Upload configuration files**
   ```bash
   cd /var/www/firebase-app
   # Upload admin_service_account.json, apikeys.txt, private_keys.json
   ```

3. **Restart services**
   ```bash
   sudo systemctl restart firebase-backend
   ```

4. **Access the application**
   - Frontend: http://YOUR_SERVER_IP
   - Backend API: http://YOUR_SERVER_IP:8000

## 📚 Documentation

- [Deployment Guide](DEPLOYMENT_GUIDE.md) - Complete server deployment instructions
- [API Documentation](http://localhost:8000/docs) - FastAPI auto-generated docs

## 🔧 Configuration

### Environment Variables

Create a `.env` file in the root directory:

```bash
VITE_API_BASE_URL=http://localhost:8000
VITE_WS_URL=ws://localhost:8000
NODE_ENV=development
```

### Firebase Configuration

1. **Service Account Key**: Download from Firebase Console → Project Settings → Service Accounts
2. **API Keys**: Your Firebase API keys and other service keys
3. **Private Keys**: Additional private keys for your projects

## 📁 Project Structure

```
firebase-email-campaign-app/
├── src/                    # React/TypeScript source code
│   ├── components/         # React components
│   ├── contexts/          # React contexts
│   ├── services/          # API services
│   └── utils/             # Utility functions
├── public/                # Static assets
├── src/utils/             # Python backend
│   └── firebaseBackend.py # FastAPI backend
├── professional_installation.sh  # Server installation script
├── deploy_from_github.sh  # GitHub deployment script
└── README.md              # This file
```

## 🔒 Security

- All sensitive files (API keys, service accounts) are excluded from Git
- Environment variables for configuration
- Proper file permissions and service isolation
- Firewall configuration with UFW
- Security headers in Nginx

## 🛠️ Development

### Adding New Features

1. **Frontend**: Add components in `src/components/`
2. **Backend**: Add endpoints in `src/utils/firebaseBackend.py`
3. **Styling**: Use Tailwind CSS classes
4. **State Management**: Use React Context API

### Testing

```bash
# Frontend tests
npm run test

# Backend tests
python -m pytest tests/
```

## 📞 Support

- **Issues**: Create an issue on GitHub
- **Documentation**: Check the [Deployment Guide](DEPLOYMENT_GUIDE.md)
- **Logs**: Check service logs with `journalctl -u firebase-backend -f`

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

**🎉 Happy coding!**
EOF
    
    log "README updated for GitHub"
}

# Main function
main() {
    echo "============================================================================="
    echo "🚀 GITHUB REPOSITORY SETUP"
    echo "============================================================================="
    echo
    
    # Check prerequisites
    check_git
    
    # Setup steps
    init_git
    configure_git_user
    add_files
    create_initial_commit
    create_github_repo
    create_server_deploy_script
    update_readme
    
    echo
    echo "============================================================================="
    echo "🎉 GITHUB SETUP COMPLETED SUCCESSFULLY!"
    echo "============================================================================="
    echo
    echo "📋 What was created:"
    echo "   ✅ Git repository initialized"
    echo "   ✅ GitHub remote configured"
    echo "   ✅ Initial commit created and pushed"
    echo "   ✅ Server deployment script: deploy_from_github.sh"
    echo "   ✅ Updated README.md for GitHub"
    echo
    echo "🚀 Next Steps:"
    echo "   1. Your code is now on GitHub!"
    echo "   2. Use 'git push' to sync local changes"
    echo "   3. Use 'deploy_from_github.sh' on your server to deploy from GitHub"
    echo "   4. Set up GitHub Actions for automated deployment (optional)"
    echo
    echo "📞 Support: Check the README.md for detailed instructions"
    echo "============================================================================="
}

# Run main function
main "$@" 