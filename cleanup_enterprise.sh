#!/bin/bash

# Firebase Manager Enterprise Server - Cleanup Script
# Removes old JSON files and unused components after PostgreSQL migration

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🧹 Firebase Manager Enterprise Server - Cleanup Script${NC}"
echo -e "${BLUE}====================================================${NC}"
echo ""

# Function to print colored output
print_status() {
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

# Check if we're in the right directory
if [ ! -f "src/database/models.py" ]; then
    print_error "Please run this script from the Firebase Manager project root directory"
    exit 1
fi

print_info "Starting cleanup process..."

# Backup old files before deletion
BACKUP_DIR="backup_old_files_$(date +%Y%m%d_%H%M%S)"
print_info "Creating backup of old files in: $BACKUP_DIR"
mkdir -p "$BACKUP_DIR"

# Backup old JSON files
if [ -f "app_users.json" ]; then
    cp app_users.json "$BACKUP_DIR/"
    print_status "Backed up app_users.json"
fi

if [ -f "profiles.json" ]; then
    cp profiles.json "$BACKUP_DIR/"
    print_status "Backed up profiles.json"
fi

if [ -f "projects.json" ]; then
    cp projects.json "$BACKUP_DIR/"
    print_status "Backed up projects.json"
fi

if [ -f "campaigns.json" ]; then
    cp campaigns.json "$BACKUP_DIR/"
    print_status "Backed up campaigns.json"
fi

if [ -f "campaign_results.json" ]; then
    cp campaign_results.json "$BACKUP_DIR/"
    print_status "Backed up campaign_results.json"
fi

if [ -f "daily_counts.json" ]; then
    cp daily_counts.json "$BACKUP_DIR/"
    print_status "Backed up daily_counts.json"
fi

if [ -f "role_permissions.json" ]; then
    cp role_permissions.json "$BACKUP_DIR/"
    print_status "Backed up role_permissions.json"
fi

if [ -f "smtp_settings.json" ]; then
    cp smtp_settings.json "$BACKUP_DIR/"
    print_status "Backed up smtp_settings.json"
fi

if [ -f "ai_keys.json" ]; then
    cp ai_keys.json "$BACKUP_DIR/"
    print_status "Backed up ai_keys.json"
fi

# Backup old backend file
if [ -f "src/utils/firebaseBackend.py" ]; then
    cp src/utils/firebaseBackend.py "$BACKUP_DIR/"
    print_status "Backed up old firebaseBackend.py"
fi

# Remove old JSON files (after backup)
print_info "Removing old JSON files..."
rm -f app_users.json
rm -f profiles.json
rm -f projects.json
rm -f campaigns.json
rm -f campaign_results.json
rm -f daily_counts.json
rm -f role_permissions.json
rm -f smtp_settings.json
rm -f ai_keys.json

print_status "Old JSON files removed"

# Remove old backend file
print_info "Removing old backend file..."
rm -f src/utils/firebaseBackend.py

print_status "Old backend file removed"

# Remove old installation scripts
print_info "Removing old installation scripts..."
rm -f setup-server.sh
rm -f setup-server-fixed.sh
rm -f comprehensive-fix.sh
rm -f fix-api-issues.sh
rm -f fix-localhost.sh
rm -f build-for-server.sh
rm -f server-config.js
rm -f nginx-config.conf
rm -f firebase-backend.service

print_status "Old installation scripts removed"

# Remove old documentation
print_info "Removing old documentation..."
rm -f LOCAL-DEVELOPMENT.md
rm -f BACKEND-SETUP.md
rm -f DEPLOYMENT_GUIDE.md
rm -f GITHUB_SETUP_GUIDE.md
rm -f UBUNTU-DEPLOYMENT.md
rm -f SERVER-DEPLOYMENT-COMPLETE.md
rm -f critical-fixes-applied.md
rm -f instalation.txt

print_status "Old documentation removed"

# Remove old test files
print_info "Removing old test files..."
rm -f test-campaign-send.js
rm -f debug-campaign-issues.js
rm -f test_bulk_delete.py
rm -f fbz_script.py

print_status "Old test files removed"

# Remove old directories
print_info "Removing old directories..."
rm -rf old\ versions/
rm -rf FBG_Setup/
rm -rf Auto_Link/
rm -rf FBZ_WEB/
rm -rf FBZ_Link/
rm -rf postcss.config/

print_status "Old directories removed"

# Remove old database file
if [ -f "app.db" ]; then
    cp app.db "$BACKUP_DIR/"
    rm -f app.db
    print_status "Old SQLite database backed up and removed"
fi

# Remove old private keys (if they exist)
if [ -f "private_keys.json" ]; then
    cp private_keys.json "$BACKUP_DIR/"
    rm -f private_keys.json
    print_warning "Private keys backed up and removed - ensure they're properly secured"
fi

# Remove old admin service account
if [ -f "admin_service_account.json" ]; then
    cp admin_service_account.json "$BACKUP_DIR/"
    rm -f admin_service_account.json
    print_warning "Admin service account backed up and removed - ensure it's properly secured"
fi

# Remove old apikeys
if [ -f "apikeys.txt" ]; then
    cp apikeys.txt "$BACKUP_DIR/"
    rm -f apikeys.txt
    print_warning "API keys backed up and removed - ensure they're properly secured"
fi

# Remove old audit log
if [ -f "audit.log" ]; then
    cp audit.log "$BACKUP_DIR/"
    rm -f audit.log
    print_status "Old audit log backed up and removed"
fi

# Remove old Python cache files
print_info "Removing Python cache files..."
find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
find . -type f -name "*.pyc" -delete 2>/dev/null || true
find . -type f -name "*.pyo" -delete 2>/dev/null || true

print_status "Python cache files removed"

# Remove old Node.js files
print_info "Removing old Node.js files..."
rm -rf node_modules/
rm -f package-lock.json
rm -f bun.lockb

print_status "Old Node.js files removed"

# Remove old virtual environment
if [ -d "venv" ]; then
    print_info "Removing old virtual environment..."
    rm -rf venv/
    print_status "Old virtual environment removed"
fi

# Remove old dist directory
if [ -d "dist" ]; then
    print_info "Removing old build directory..."
    rm -rf dist/
    print_status "Old build directory removed"
fi

# Create new directory structure
print_info "Creating new directory structure..."
mkdir -p src/database
mkdir -p src/server
mkdir -p logs
mkdir -p uploads

print_status "New directory structure created"

# Set proper permissions
print_info "Setting proper permissions..."
chmod -R 755 .
chmod 600 .env 2>/dev/null || true
chmod 600 env.example 2>/dev/null || true

print_status "Permissions set correctly"

# Create new README
print_info "Creating new README..."
cat > README.md << 'EOF'
# 🚀 Firebase Manager Enterprise Server

## **Enterprise-Grade Firebase Project & Campaign Management**

A production-ready, scalable system designed to handle **1000+ campaigns** with enterprise-grade performance, security, and reliability.

## **🚀 Features**

- **PostgreSQL Database** - Scalable, ACID-compliant data storage
- **Redis Caching** - High-performance caching and session management
- **JWT Authentication** - Secure, stateless authentication
- **Rate Limiting** - Protection against abuse and DDoS
- **Structured Logging** - Professional logging with structured data
- **Prometheus Metrics** - Production monitoring and alerting
- **Nginx Reverse Proxy** - High-performance web server
- **Systemd Service** - Professional service management
- **Auto-scaling Ready** - Built for horizontal scaling

## **📊 Performance**

- **1000+ Concurrent Campaigns** - Enterprise-grade scalability
- **Sub-second Response Times** - Optimized database queries
- **Connection Pooling** - Efficient database resource management
- **Async Processing** - Non-blocking I/O operations
- **Memory Optimization** - Efficient data structures and caching

## **🔒 Security**

- **JWT Tokens** - Secure authentication
- **Rate Limiting** - Protection against abuse
- **Input Validation** - SQL injection prevention
- **CORS Protection** - Cross-origin request security
- **Security Headers** - XSS and clickjacking protection

## **🚀 Quick Start**

### **Automated Installation**

```bash
# Download and run installation script
curl -fsSL https://raw.githubusercontent.com/your-repo/firebase-manager/main/install_enterprise_server.sh | sudo bash
```

### **Manual Installation**

See [ENTERPRISE_DEPLOYMENT_GUIDE.md](ENTERPRISE_DEPLOYMENT_GUIDE.md) for detailed instructions.

## **🔧 Configuration**

Copy `env.example` to `.env` and update with your settings:

```bash
cp env.example .env
nano .env
```

## **📊 Monitoring**

- **Health Check**: `/health`
- **Metrics**: Prometheus-compatible metrics
- **Logs**: Structured JSON logging
- **Status**: `./status.sh`

## **🚀 Deployment**

### **Requirements**

- Ubuntu 20.04+ LTS
- 4GB+ RAM
- 50GB+ Storage
- PostgreSQL 12+
- Redis 6+

### **Architecture**

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Nginx (80)    │    │  FastAPI (8000) │    │  PostgreSQL     │
│   (Frontend)    │◄──►│   (Backend)     │◄──►│   (Database)    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                │
                                ▼
                       ┌─────────────────┐
                       │     Redis       │
                       │   (Cache)       │
                       └─────────────────┘
```

## **📈 Scaling**

### **Vertical Scaling**

- Increase server resources (CPU, RAM, Storage)
- Optimize database configuration
- Tune application parameters

### **Horizontal Scaling**

- Load balancer with multiple backend servers
- Database read replicas
- Redis cluster for distributed caching

## **🔒 Security Features**

- **Authentication**: JWT-based user authentication
- **Authorization**: Role-based access control (RBAC)
- **Rate Limiting**: Configurable request limits
- **Input Validation**: Comprehensive data validation
- **SQL Injection Protection**: Parameterized queries
- **XSS Protection**: Security headers and validation

## **📊 Monitoring & Alerting**

- **Health Checks**: Automated service monitoring
- **Metrics Collection**: Prometheus-compatible metrics
- **Log Aggregation**: Structured logging with rotation
- **Performance Monitoring**: Database and application metrics
- **Alerting**: Automated notifications for issues

## **🔄 Backup & Recovery**

- **Automated Backups**: Daily database and file backups
- **Point-in-time Recovery**: Database transaction logs
- **Disaster Recovery**: Automated recovery procedures
- **Data Retention**: Configurable backup retention policies

## **🚀 Performance Optimization**

- **Database Indexing**: Optimized query performance
- **Connection Pooling**: Efficient resource management
- **Caching Strategy**: Multi-layer caching system
- **Async Processing**: Non-blocking operations
- **Load Balancing**: Traffic distribution

## **📞 Support**

For issues and questions:

1. Check the logs: `/var/www/firebase-manager/logs/`
2. Review service status: `sudo systemctl status firebase-manager`
3. Check database: `sudo -u postgres psql -d firebase_manager`
4. Monitor performance: `./status.sh`

## **🔧 Development**

### **Local Development**

```bash
# Install dependencies
pip install -r requirements.txt
npm install

# Set up environment
cp env.example .env
# Edit .env with local settings

# Run migrations
python -m src.database.migrations

# Start backend
python -m src.server.enterprise_backend

# Start frontend (in another terminal)
npm run dev
```

### **Testing**

```bash
# Run tests
python -m pytest

# Run with coverage
python -m pytest --cov=src
```

## **📄 License**

This project is licensed under the MIT License - see the LICENSE file for details.

## **🤝 Contributing**

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

---

**Built for enterprise-scale Firebase management with professional-grade performance and reliability! 🚀**
EOF

print_status "New README created"

# Create .gitignore for enterprise version
print_info "Creating new .gitignore..."
cat > .gitignore << 'EOF'
# Environment files
.env
.env.local
.env.production

# Python
__pycache__/
*.py[cod]
*$py.class
*.so
.Python
build/
develop-eggs/
dist/
downloads/
eggs/
.eggs/
lib/
lib64/
parts/
sdist/
var/
wheels/
*.egg-info/
.installed.cfg
*.egg
MANIFEST

# Virtual environments
venv/
env/
ENV/
env.bak/
venv.bak/

# Node.js
node_modules/
npm-debug.log*
yarn-debug.log*
yarn-error.log*
lerna-debug.log*
.pnpm-debug.log*

# Build outputs
dist/
build/
.next/
out/

# Logs
logs/
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*
lerna-debug.log*
.pnpm-debug.log*

# Runtime data
pids
*.pid
*.seed
*.pid.lock

# Coverage directory used by tools like istanbul
coverage/
*.lcov

# nyc test coverage
.nyc_output

# Dependency directories
jspm_packages/

# Optional npm cache directory
.npm

# Optional eslint cache
.eslintcache

# Microbundle cache
.rpt2_cache/
.rts2_cache_cjs/
.rts2_cache_es/
.rts2_cache_umd/

# Optional REPL history
.node_repl_history

# Output of 'npm pack'
*.tgz

# Yarn Integrity file
.yarn-integrity

# dotenv environment variables file
.env.test

# parcel-bundler cache (https://parceljs.org/)
.cache
.parcel-cache

# Next.js build output
.next

# Nuxt.js build / generate output
.nuxt
dist

# Gatsby files
.cache/
public

# Storybook build outputs
.out
.storybook-out

# Temporary folders
tmp/
temp/

# Editor directories and files
.vscode/
.idea/
*.swp
*.swo
*~

# OS generated files
.DS_Store
.DS_Store?
._*
.Spotlight-V100
.Trashes
ehthumbs.db
Thumbs.db

# Backup files
backup_old_files_*/
*.backup
*.bak

# Database files
*.db
*.sqlite
*.sqlite3

# SSL certificates
*.pem
*.key
*.crt

# Service files
*.service

# Configuration backups
*.conf.bak
*.conf.old
EOF

print_status "New .gitignore created"

# Final summary
echo ""
echo -e "${GREEN}🎉 Cleanup Complete! 🎉${NC}"
echo ""
echo -e "${BLUE}What was cleaned up:${NC}"
echo -e "  ✅ Old JSON files (backed up to $BACKUP_DIR)"
echo -e "  ✅ Old backend files"
echo -e "  ✅ Old installation scripts"
echo -e "  ✅ Old documentation"
echo -e "  ✅ Old test files"
echo -e "  ✅ Old directories"
echo -e "  ✅ Python cache files"
echo -e "  ✅ Old virtual environment"
echo -e "  ✅ Old build files"
echo ""
echo -e "${BLUE}What was created:${NC}"
echo -e "  ✅ New directory structure"
echo -e "  ✅ New README.md"
echo -e "  ✅ New .gitignore"
echo -e "  ✅ Proper permissions"
echo ""
echo -e "${YELLOW}Backup location:${NC} $BACKUP_DIR"
echo -e "${YELLOW}Keep this backup until you verify the new system is working!${NC}"
echo ""
echo -e "${GREEN}Your project is now clean and ready for enterprise deployment! 🚀${NC}"
echo ""
echo -e "${BLUE}Next steps:${NC}"
echo -e "  1. Test the new enterprise backend"
echo -e "  2. Run database migrations"
echo -e "  3. Deploy to your Ubuntu server"
echo -e "  4. Verify all functionality works"
echo -e "  5. Delete the backup directory when ready"
echo ""
