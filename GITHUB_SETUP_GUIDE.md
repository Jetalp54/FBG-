# 🚀 GitHub Integration & Automated Deployment Guide

## 📋 Table of Contents
1. [Local GitHub Setup](#local-github-setup)
2. [Server GitHub Integration](#server-github-integration)
3. [Automated Deployment](#automated-deployment)
4. [Workflow Management](#workflow-management)
5. [Troubleshooting](#troubleshooting)

---

## 🖥️ Local GitHub Setup

### Step 1: Run the GitHub Setup Script

```bash
# Make the script executable
chmod +x setup_github.sh

# Run the setup script
./setup_github.sh
```

**What the script does:**
- ✅ Initializes Git repository
- ✅ Configures Git user (name and email)
- ✅ Adds all files to Git (excluding sensitive files via .gitignore)
- ✅ Creates initial commit with detailed description
- ✅ Guides you through GitHub repository creation
- ✅ Pushes code to GitHub
- ✅ Creates server deployment script
- ✅ Updates README.md for GitHub

### Step 2: Create GitHub Repository

The script will guide you through creating a GitHub repository:

1. **Go to GitHub**: https://github.com/new
2. **Repository Name**: `firebase-email-campaign-app` (or your preferred name)
3. **Visibility**: Choose Public or Private
4. **DO NOT** initialize with README, .gitignore, or license (we already have these)
5. **Click "Create repository"**

### Step 3: Complete the Setup

After creating the repository, the script will:
- Add the GitHub remote
- Push your code to GitHub
- Create deployment scripts

---

## 🖥️ Server GitHub Integration

### Option 1: Manual Deployment from GitHub

```bash
# On your server, use the deployment script
chmod +x deploy_from_github.sh
sudo ./deploy_from_github.sh
```

**What this does:**
- ✅ Backs up current version
- ✅ Clones/pulls from GitHub
- ✅ Installs dependencies
- ✅ Builds the application
- ✅ Restarts services
- ✅ Runs health checks

### Option 2: Automated Deployment with GitHub Actions

#### Step 1: Set up GitHub Secrets

1. **Go to your GitHub repository**
2. **Settings** → **Secrets and variables** → **Actions**
3. **Add the following secrets:**

```
SERVER_HOST=your-server-ip
SERVER_USER=root
SERVER_SSH_KEY=your-private-ssh-key
SERVER_PORT=22
```

#### Step 2: Generate SSH Key for GitHub Actions

```bash
# On your local machine, generate a new SSH key
ssh-keygen -t rsa -b 4096 -C "github-actions@yourdomain.com" -f ~/.ssh/github_actions

# Copy the public key to your server
ssh-copy-id -i ~/.ssh/github_actions.pub root@your-server-ip

# Copy the private key content (this goes in GitHub Secrets)
cat ~/.ssh/github_actions
```

#### Step 3: Enable GitHub Actions

The workflow file `.github/workflows/deploy.yml` will automatically:
- Deploy when you push to the `main` branch
- Pull latest changes from GitHub
- Install dependencies and build
- Restart services
- Run health checks

---

## 🔄 Workflow Management

### Daily Development Workflow

```bash
# 1. Make your changes locally
# 2. Test your changes
npm run dev  # Frontend
python src/utils/firebaseBackend.py  # Backend

# 3. Commit your changes
git add .
git commit -m "Description of your changes"

# 4. Push to GitHub
git push origin main

# 5. GitHub Actions will automatically deploy to server
```

### Branch-based Development

```bash
# Create a feature branch
git checkout -b feature/new-feature

# Make your changes
# ... your development work ...

# Commit and push
git add .
git commit -m "Add new feature"
git push origin feature/new-feature

# Create Pull Request on GitHub
# After review and merge, it will deploy automatically
```

### Manual Deployment

```bash
# If you need to deploy manually
# Go to GitHub → Actions → Deploy to Server → Run workflow
```

---

## 🔧 Configuration Management

### Environment-specific Configuration

Create different `.env` files for different environments:

```bash
# .env.local (local development)
VITE_API_BASE_URL=http://localhost:8000
VITE_WS_URL=ws://localhost:8000
NODE_ENV=development

# .env.production (server - created by installation script)
VITE_API_BASE_URL=http://your-server-ip:8000
VITE_WS_URL=ws://your-server-ip:8000
NODE_ENV=production
```

### Sensitive Files Management

**Never commit these files to GitHub:**
- `admin_service_account.json`
- `apikeys.txt`
- `private_keys.json`
- `.env` files

**Upload them manually to the server:**
```bash
# On your server
cd /var/www/firebase-app
# Upload the files via SCP, SFTP, or file manager
```

---

## 📊 Monitoring and Logs

### GitHub Actions Logs

1. **Go to your GitHub repository**
2. **Actions** tab
3. **Click on the latest workflow run**
4. **View detailed logs**

### Server Logs

```bash
# Backend logs
sudo journalctl -u firebase-backend -f

# Nginx logs
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log

# Application logs
tail -f /var/www/firebase-app/logs/*.log
```

### Health Monitoring

```bash
# Manual health check
sudo /usr/local/bin/firebase-app-health

# Check service status
sudo systemctl status firebase-backend nginx
```

---

## 🔧 Troubleshooting

### Common Issues

#### 1. GitHub Actions Deployment Fails

**Check:**
- SSH key is correct in GitHub Secrets
- Server is accessible
- User has proper permissions

**Solution:**
```bash
# Test SSH connection
ssh -i ~/.ssh/github_actions root@your-server-ip

# Check permissions
ls -la /var/www/firebase-app/
```

#### 2. Git Push Fails

**Check:**
- Git credentials are configured
- Repository URL is correct

**Solution:**
```bash
# Check remote URL
git remote -v

# Reconfigure if needed
git remote set-url origin https://github.com/username/repo-name.git
```

#### 3. Server Deployment Fails

**Check:**
- Dependencies are installed
- Services are running
- File permissions are correct

**Solution:**
```bash
# Check service status
sudo systemctl status firebase-backend

# Check logs
sudo journalctl -u firebase-backend -n 50

# Fix permissions
sudo chown -R www-data:www-data /var/www/firebase-app
```

### Rollback Procedure

```bash
# If deployment fails, rollback to previous version
cd /var/www/firebase-app
git log --oneline -5  # See recent commits
git reset --hard HEAD~1  # Rollback one commit
sudo systemctl restart firebase-backend
```

---

## 🎯 Best Practices

### 1. Commit Messages

Use descriptive commit messages:
```bash
git commit -m "feat: add user bulk delete functionality"
git commit -m "fix: resolve template update issue"
git commit -m "docs: update deployment guide"
```

### 2. Testing Before Deployment

```bash
# Test locally first
npm run build
python -m pytest tests/  # if you have tests

# Then push to GitHub
git push origin main
```

### 3. Backup Strategy

```bash
# Automatic backups (configured by installation script)
sudo /usr/local/bin/firebase-app-backup

# Manual backup before major changes
sudo cp -r /var/www/firebase-app /var/backups/firebase-app/manual_backup_$(date +%Y%m%d_%H%M%S)
```

### 4. Security

- Keep SSH keys secure
- Regularly update dependencies
- Monitor logs for suspicious activity
- Use HTTPS for production

---

## 📞 Support

### Useful Commands

```bash
# Git operations
git status
git log --oneline -10
git diff HEAD~1

# Server operations
sudo systemctl restart firebase-backend
sudo nginx -t && sudo systemctl reload nginx

# Deployment
./deploy_from_github.sh
```

### Emergency Recovery

```bash
# If everything fails
sudo systemctl stop firebase-backend nginx
sudo cp -r /var/backups/firebase-app/latest_backup /var/www/firebase-app
sudo systemctl start firebase-backend nginx
```

---

## 🎉 Quick Setup Checklist

- [ ] Run `setup_github.sh` locally
- [ ] Create GitHub repository
- [ ] Push code to GitHub
- [ ] Set up server with `professional_installation.sh`
- [ ] Upload sensitive files to server
- [ ] Test deployment with `deploy_from_github.sh`
- [ ] Set up GitHub Actions (optional)
- [ ] Test automated deployment
- [ ] Configure monitoring and alerts

---

**🎉 Congratulations! Your Firebase Email Campaign App is now fully integrated with GitHub for easy development and deployment!** 