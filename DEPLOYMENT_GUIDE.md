# 🚀 Firebase Email Campaign App - Professional Deployment Guide

## 📋 Table of Contents
1. [Project Cleanup](#project-cleanup)
2. [Server Preparation](#server-preparation)
3. [Application Deployment](#application-deployment)
4. [Configuration](#configuration)
5. [Verification](#verification)
6. [Troubleshooting](#troubleshooting)
7. [Maintenance](#maintenance)

---

## 🧹 Project Cleanup

### Step 1: Clean the Project
Before deploying, we need to remove unused files to reduce the project size and avoid confusion.

```bash
# Make the cleanup script executable
chmod +x cleanup_project.sh

# Run the cleanup script
./cleanup_project.sh
```

**This will remove:**
- Old version directories and large zip files
- Duplicate/old directories (FBZ_WEB, FBZ_Link, Auto_Link, postcss.config)
- Old scripts and test files
- Documentation files (keeping only README.md)
- Example files
- Build artifacts and node_modules
- Data files (will be recreated on server)
- Lock files (will be regenerated)
- Service account and API key files (should be uploaded by user)

### Step 2: Verify Essential Files Remain
After cleanup, ensure these essential files are present:
```
📁 Essential Files:
├── src/                    # React/TypeScript source code
├── public/                 # Static assets
├── package.json            # Node.js dependencies
├── requirements.txt        # Python dependencies
├── setup-server.sh         # Basic server setup script
├── professional_installation.sh  # Complete installation script
├── nginx-config.conf       # Nginx configuration
├── firebase-backend.service # Systemd service
├── README.md               # Documentation
└── Configuration files     # .env, tsconfig, etc.
```

---

## 🖥️ Server Preparation

### Step 1: Create a New Ubuntu Server
- **Recommended:** Ubuntu 22.04 LTS or 24.04 LTS
- **Minimum Specs:** 1 vCPU, 1GB RAM, 20GB Storage
- **Recommended Specs:** 2 vCPU, 4GB RAM, 50GB Storage

### Step 2: Access Your Server
```bash
# Connect via SSH
ssh root@YOUR_SERVER_IP

# Or if using a regular user
ssh username@YOUR_SERVER_IP
sudo su -
```

### Step 3: Upload the Project
```bash
# Option 1: Using SCP (from your local machine)
scp -r /path/to/your/project root@YOUR_SERVER_IP:/tmp/firebase-app

# Option 2: Using Git (if project is in a repository)
git clone YOUR_REPOSITORY_URL /tmp/firebase-app

# Option 3: Using wget/curl (if hosted online)
wget YOUR_PROJECT_URL -O firebase-app.zip
unzip firebase-app.zip -d /tmp/firebase-app
```

---

## 🚀 Application Deployment

### Option 1: Manual Deployment

#### Step 1: Run the Professional Installation Script
```bash
# Navigate to the project directory
cd /tmp/firebase-app

# Make the installation script executable
chmod +x professional_installation.sh

# Run the installation script
sudo ./professional_installation.sh
```

### Option 2: GitHub-based Deployment (Recommended)

#### Step 1: Set up GitHub Repository
```bash
# On your local machine, run the GitHub setup script
chmod +x setup_github.sh
./setup_github.sh
```

#### Step 2: Deploy from GitHub on Server
```bash
# On your server, use the GitHub deployment script
chmod +x deploy_from_github.sh
sudo ./deploy_from_github.sh
```

**Benefits of GitHub-based deployment:**
- ✅ Version control and history
- ✅ Easy collaboration
- ✅ Automated deployment with GitHub Actions
- ✅ Rollback capabilities
- ✅ Branch-based development

**What the script does:**
- ✅ Updates system packages
- ✅ Installs essential packages (curl, git, nginx, etc.)
- ✅ Installs Node.js 20.x
- ✅ Creates Python virtual environment
- ✅ Installs Python dependencies
- ✅ Creates application directory structure
- ✅ Sets up environment variables
- ✅ Builds the frontend application
- ✅ Configures backend systemd service
- ✅ Sets up Nginx reverse proxy
- ✅ Configures firewall (UFW)
- ✅ Optional SSL certificate setup
- ✅ Creates health check and backup scripts
- ✅ Sets up log rotation
- ✅ Starts all services
- ✅ Runs health checks

### Step 2: Upload Required Files
After installation, upload these essential files:

```bash
# Navigate to the application directory
cd /var/www/firebase-app

# Upload your Firebase service account key
# (You'll need to upload this file manually)
# admin_service_account.json

# Upload your API keys
# (You'll need to upload this file manually)
# apikeys.txt

# Upload your private keys
# (You'll need to upload this file manually)
# private_keys.json
```

### Step 3: Restart the Backend
```bash
# Restart the backend service to load new configuration
sudo systemctl restart firebase-backend

# Check the status
sudo systemctl status firebase-backend
```

---

## ⚙️ Configuration

### Environment Variables
The installation script automatically creates a `.env` file with:
```bash
VITE_API_BASE_URL=http://YOUR_SERVER_IP:8000
VITE_WS_URL=ws://YOUR_SERVER_IP:8000
NODE_ENV=production
```

### Nginx Configuration
The script creates an optimized Nginx configuration with:
- Security headers
- Gzip compression
- Static asset caching
- WebSocket support
- Health check endpoint

### Systemd Service
The backend runs as a systemd service with:
- Auto-restart on failure
- Proper logging
- Security restrictions
- Resource limits

---

## ✅ Verification

### Step 1: Check Service Status
```bash
# Check backend service
sudo systemctl status firebase-backend

# Check nginx service
sudo systemctl status nginx

# Check firewall
sudo ufw status
```

### Step 2: Test Endpoints
```bash
# Test backend health
curl http://YOUR_SERVER_IP/health

# Test frontend
curl http://YOUR_SERVER_IP

# Test API
curl http://YOUR_SERVER_IP/api/
```

### Step 3: Check Logs
```bash
# View backend logs
sudo journalctl -u firebase-backend -f

# View nginx logs
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log
```

### Step 4: Access the Application
Open your browser and navigate to:
```
http://YOUR_SERVER_IP
```

---

## 🔧 Troubleshooting

### Common Issues and Solutions

#### 1. Backend Service Not Starting
```bash
# Check detailed logs
sudo journalctl -u firebase-backend -n 50

# Check if Python dependencies are installed
sudo /opt/firebase-app-venv/bin/pip list

# Check file permissions
ls -la /var/www/firebase-app/
```

#### 2. Frontend Not Loading
```bash
# Check nginx configuration
sudo nginx -t

# Check nginx logs
sudo tail -f /var/log/nginx/error.log

# Verify frontend files exist
ls -la /var/www/firebase-app/dist/
```

#### 3. API Connection Issues
```bash
# Check if backend is listening
sudo netstat -tlnp | grep 8000

# Test backend directly
curl http://localhost:8000/health

# Check firewall rules
sudo ufw status
```

#### 4. Permission Issues
```bash
# Fix ownership
sudo chown -R www-data:www-data /var/www/firebase-app

# Fix permissions
sudo chmod -R 755 /var/www/firebase-app
```

### Health Check Script
The installation creates a health check script:
```bash
# Run health check manually
sudo /usr/local/bin/firebase-app-health

# Check cron job
sudo crontab -l
```

---

## 🛠️ Maintenance

### Daily Operations

#### 1. Monitor Services
```bash
# Check service status
sudo systemctl status firebase-backend nginx

# Monitor logs
sudo journalctl -u firebase-backend -f
```

#### 2. Backup Data
```bash
# Run backup manually
sudo /usr/local/bin/firebase-app-backup

# Check backup directory
ls -la /var/backups/firebase-app/
```

#### 3. Update Application
```bash
# Stop services
sudo systemctl stop firebase-backend

# Backup current version
sudo cp -r /var/www/firebase-app /var/backups/firebase-app/backup_$(date +%Y%m%d_%H%M%S)

# Upload new version
# (Upload your updated files to /var/www/firebase-app/)

# Install dependencies and build
cd /var/www/firebase-app
sudo -u www-data npm ci
sudo -u www-data npm run build

# Restart services
sudo systemctl start firebase-backend
```

### System Maintenance

#### 1. Update System Packages
```bash
sudo apt update && sudo apt upgrade -y
```

#### 2. Clean Up Logs
```bash
# Logs are automatically rotated, but you can clean manually
sudo journalctl --vacuum-time=30d
```

#### 3. Monitor Disk Space
```bash
df -h
du -sh /var/www/firebase-app/
du -sh /var/backups/firebase-app/
```

---

## 📞 Support

### Useful Commands
```bash
# Service management
sudo systemctl start/stop/restart firebase-backend
sudo systemctl start/stop/restart nginx

# Log viewing
sudo journalctl -u firebase-backend -f
sudo tail -f /var/log/nginx/error.log

# Configuration files
sudo nano /etc/systemd/system/firebase-backend.service
sudo nano /etc/nginx/sites-available/firebase-app

# Application directory
cd /var/www/firebase-app
```

### Emergency Recovery
```bash
# If everything fails, restart all services
sudo systemctl restart firebase-backend nginx

# If still failing, check the installation log
sudo cat /var/log/firebase-app-install.log

# Re-run health check
sudo /usr/local/bin/firebase-app-health
```

---

## 🎯 Quick Deployment Checklist

- [ ] Project cleaned using `cleanup_project.sh`
- [ ] New Ubuntu server created (22.04+)
- [ ] Project uploaded to server
- [ ] `professional_installation.sh` executed successfully
- [ ] Required files uploaded (admin_service_account.json, apikeys.txt, private_keys.json)
- [ ] Backend service restarted
- [ ] Health checks passed
- [ ] Application accessible via browser
- [ ] All features tested (campaigns, templates, etc.)

---

**🎉 Congratulations! Your Firebase Email Campaign App is now professionally deployed and ready for production use!** 