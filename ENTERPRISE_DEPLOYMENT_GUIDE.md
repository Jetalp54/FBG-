# 🚀 Firebase Manager Enterprise Server - Deployment Guide

## **Overview**

This guide will help you deploy the Firebase Manager Enterprise Server on any Ubuntu server. The system is designed to handle **1000+ campaigns** with enterprise-grade performance, security, and scalability.

## **🚀 Quick Start (Automated Installation)**

### **1. Prerequisites**
- Ubuntu 20.04, 22.04, or 24.04 LTS
- Root access (sudo)
- Minimum 4GB RAM, 50GB storage
- Internet connection

### **2. One-Command Installation**

```bash
# Download and run the installation script
curl -fsSL https://raw.githubusercontent.com/your-repo/firebase-manager/main/install_enterprise_server.sh | sudo bash
```

**Or manually:**
```bash
# Clone the repository
git clone https://github.com/your-repo/firebase-manager.git
cd firebase-manager

# Make script executable and run
chmod +x install_enterprise_server.sh
sudo ./install_enterprise_server.sh
```

## **🔧 Manual Installation (Step-by-Step)**

### **Phase 1: System Preparation**

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install required packages
sudo apt install -y \
    python3 python3-pip python3-venv \
    postgresql postgresql-contrib \
    redis-server nginx supervisor \
    curl wget git unzip \
    build-essential libpq-dev python3-dev \
    nodejs npm
```

### **Phase 2: Database Setup**

```bash
# Start PostgreSQL
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Create database and user
sudo -u postgres psql -c "CREATE USER emedia WITH PASSWORD 'Batata010..++';"
sudo -u postgres psql -c "CREATE DATABASE firebase_manager OWNER emedia;"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE firebase_manager TO emedia;"
sudo -u postgres psql -c "ALTER USER emedia CREATEDB;"
```

### **Phase 3: Application Setup**

```bash
# Create application directory
sudo mkdir -p /var/www/firebase-manager
sudo useradd -r -s /bin/bash -d /var/www/firebase-manager firebase

# Copy application files
sudo cp -r . /var/www/firebase-manager/
sudo chown -R firebase:firebase /var/www/firebase-manager

# Set up Python environment
cd /var/www/firebase-manager
sudo -u firebase python3 -m venv venv
sudo -u firebase venv/bin/pip install -r requirements.txt

# Install Node.js dependencies
sudo -u firebase npm install
sudo -u firebase npm run build
```

### **Phase 4: Configuration**

```bash
# Create environment file
sudo -u firebase cp env.example .env
sudo -u firebase nano .env

# Update with your settings:
DB_USER=emedia
DB_PASSWORD=Batata010..++
DB_NAME=firebase_manager
SMTP_USERNAME=your-email@gmail.com
SMTP_PASSWORD=your-app-password
```

### **Phase 5: Database Migration**

```bash
# Run migrations
cd /var/www/firebase-manager
sudo -u firebase venv/bin/python -m src.database.migrations
```

### **Phase 6: Service Configuration**

```bash
# Create systemd service
sudo tee /etc/systemd/system/firebase-manager.service > /dev/null << EOF
[Unit]
Description=Firebase Manager Enterprise Server
After=network.target postgresql.service redis-server.service

[Service]
Type=exec
User=firebase
Group=firebase
WorkingDirectory=/var/www/firebase-manager
Environment=PATH=/var/www/firebase-manager/venv/bin
ExecStart=/var/www/firebase-manager/venv/bin/python -m src.server.enterprise_backend
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# Enable and start service
sudo systemctl daemon-reload
sudo systemctl enable firebase-manager
sudo systemctl start firebase-manager
```

### **Phase 7: Nginx Configuration**

```bash
# Create Nginx site
sudo tee /etc/nginx/sites-available/firebase-manager > /dev/null << EOF
server {
    listen 80;
    server_name _;
    
    location / {
        root /var/www/firebase-manager/dist;
        try_files \$uri \$uri/ /index.html;
    }
    
    location /api/ {
        proxy_pass http://127.0.0.1:8000/;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
    }
    
    location /ws {
        proxy_pass http://127.0.0.1:8000/ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
EOF

# Enable site
sudo ln -sf /etc/nginx/sites-available/firebase-manager /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

## **🔒 Security Configuration**

### **Firewall Setup**

```bash
# Configure UFW firewall
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP
sudo ufw allow 443/tcp   # HTTPS
sudo ufw --force enable
```

### **SSL Certificate (Let's Encrypt)**

```bash
# Install Certbot
sudo apt install -y certbot python3-certbot-nginx

# Get SSL certificate
sudo certbot --nginx -d yourdomain.com

# Auto-renewal
sudo crontab -e
# Add: 0 12 * * * /usr/bin/certbot renew --quiet
```

### **Security Headers**

```bash
# Add to Nginx configuration
add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-XSS-Protection "1; mode=block" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "no-referrer-when-downgrade" always;
```

## **📊 Monitoring & Maintenance**

### **Health Checks**

```bash
# Check service status
sudo systemctl status firebase-manager

# Check database
sudo -u postgres psql -d firebase_manager -c "SELECT version();"

# Check Redis
redis-cli ping

# View logs
sudo tail -f /var/www/firebase-manager/logs/supervisor.log
```

### **Performance Monitoring**

```bash
# Check resource usage
htop
df -h
free -h

# Monitor database connections
sudo -u postgres psql -d firebase_manager -c "SELECT count(*) FROM pg_stat_activity;"

# Check Redis memory
redis-cli info memory
```

### **Backup Strategy**

```bash
# Database backup
sudo -u postgres pg_dump firebase_manager > backup_$(date +%Y%m%d_%H%M%S).sql

# Application backup
sudo tar -czf firebase-manager-backup-$(date +%Y%m%d).tar.gz /var/www/firebase-manager

# Automated backup script
sudo tee /usr/local/bin/backup-firebase-manager.sh > /dev/null << EOF
#!/bin/bash
BACKUP_DIR="/var/backups/firebase-manager"
DATE=\$(date +%Y%m%d_%H%M%S)

mkdir -p \$BACKUP_DIR

# Database backup
sudo -u postgres pg_dump firebase_manager > \$BACKUP_DIR/db_\$DATE.sql

# Application backup
sudo tar -czf \$BACKUP_DIR/app_\$DATE.tar.gz /var/www/firebase-manager

# Keep only last 7 days
find \$BACKUP_DIR -name "*.sql" -mtime +7 -delete
find \$BACKUP_DIR -name "*.tar.gz" -mtime +7 -delete
EOF

sudo chmod +x /usr/local/bin/backup-firebase-manager.sh

# Add to crontab (daily at 2 AM)
sudo crontab -e
# Add: 0 2 * * * /usr/local/bin/backup-firebase-manager.sh
```

## **🚀 Scaling Configuration**

### **For 1000+ Campaigns**

```bash
# Increase PostgreSQL connections
sudo nano /etc/postgresql/*/main/postgresql.conf
# max_connections = 200
# shared_buffers = 256MB
# effective_cache_size = 1GB

# Increase Redis memory
sudo nano /etc/redis/redis.conf
# maxmemory 512mb
# maxmemory-policy allkeys-lru

# Restart services
sudo systemctl restart postgresql redis-server
```

### **Load Balancing (Multiple Servers)**

```bash
# Install HAProxy
sudo apt install -y haproxy

# Configure HAProxy
sudo tee /etc/haproxy/haproxy.cfg > /dev/null << EOF
global
    log /dev/log local0
    log /dev/log local1 notice
    chroot /var/lib/haproxy
    stats socket /run/haproxy/admin.sock mode 660 level admin
    stats timeout 30s
    user haproxy
    group haproxy
    daemon

defaults
    log global
    mode http
    option httplog
    option dontlognull
    timeout connect 5000
    timeout client 50000
    timeout server 50000

frontend http_front
    bind *:80
    stats uri /haproxy?stats
    default_backend http_back

backend http_back
    balance roundrobin
    server server1 192.168.1.10:80 check
    server server2 192.168.1.11:80 check
EOF

sudo systemctl restart haproxy
```

## **🔧 Troubleshooting**

### **Common Issues**

#### **Service Won't Start**
```bash
# Check logs
sudo journalctl -u firebase-manager -f

# Check permissions
sudo chown -R firebase:firebase /var/www/firebase-manager

# Check Python dependencies
sudo -u firebase /var/www/firebase-manager/venv/bin/pip list
```

#### **Database Connection Issues**
```bash
# Check PostgreSQL status
sudo systemctl status postgresql

# Check connection
sudo -u postgres psql -d firebase_manager -c "SELECT 1;"

# Check logs
sudo tail -f /var/log/postgresql/postgresql-*.log
```

#### **Nginx Issues**
```bash
# Test configuration
sudo nginx -t

# Check error logs
sudo tail -f /var/log/nginx/error.log

# Check access logs
sudo tail -f /var/log/nginx/access.log
```

### **Performance Issues**

```bash
# Check system resources
htop
iostat -x 1
iotop

# Check database performance
sudo -u postgres psql -d firebase_manager -c "
SELECT 
    schemaname,
    tablename,
    attname,
    n_distinct,
    correlation
FROM pg_stats 
WHERE schemaname = 'public'
ORDER BY n_distinct DESC;
"
```

## **📈 Performance Optimization**

### **Database Optimization**

```sql
-- Create indexes for better performance
CREATE INDEX CONCURRENTLY idx_campaigns_owner_status ON campaigns(owner_id, status);
CREATE INDEX CONCURRENTLY idx_projects_owner_active ON projects(owner_id, is_active);
CREATE INDEX CONCURRENTLY idx_users_project_email ON project_users(project_id, email);

-- Analyze tables
ANALYZE campaigns;
ANALYZE projects;
ANALYZE project_users;
```

### **Application Optimization**

```bash
# Increase worker processes
sudo nano /etc/supervisor/conf.d/firebase-manager.conf
# numprocs=4

# Restart supervisor
sudo supervisorctl reread
sudo supervisorctl update
```

### **System Optimization**

```bash
# Optimize kernel parameters
sudo tee -a /etc/sysctl.conf > /dev/null << EOF
# Network optimization
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
net.ipv4.tcp_rmem = 4096 87380 16777216
net.ipv4.tcp_wmem = 4096 65536 16777216

# File system optimization
vm.swappiness = 10
vm.dirty_ratio = 15
vm.dirty_background_ratio = 5
EOF

sudo sysctl -p
```

## **🔐 Security Best Practices**

### **Regular Updates**

```bash
# Update system packages
sudo apt update && sudo apt upgrade -y

# Update application
cd /var/www/firebase-manager
sudo -u firebase git pull
sudo -u firebase venv/bin/pip install -r requirements.txt
sudo systemctl restart firebase-manager
```

### **Access Control**

```bash
# Restrict SSH access
sudo nano /etc/ssh/sshd_config
# PermitRootLogin no
# PasswordAuthentication no
# AllowUsers yourusername

# Restart SSH
sudo systemctl restart ssh
```

### **Monitoring & Alerting**

```bash
# Install monitoring tools
sudo apt install -y htop iotop nethogs

# Set up log monitoring
sudo apt install -y fail2ban
sudo systemctl enable fail2ban
sudo systemctl start fail2ban
```

## **🎯 Production Checklist**

- [ ] SSL certificate installed
- [ ] Firewall configured
- [ ] Database optimized
- [ ] Monitoring set up
- [ ] Backup strategy implemented
- [ ] Security headers configured
- [ ] Rate limiting enabled
- [ ] Log rotation configured
- [ ] Performance monitoring active
- [ ] Regular updates scheduled

## **📞 Support**

For issues and questions:
- Check logs: `/var/www/firebase-manager/logs/`
- Service status: `sudo systemctl status firebase-manager`
- Database: `sudo -u postgres psql -d firebase_manager`
- Redis: `redis-cli ping`

## **🚀 Next Steps**

1. **Configure SMTP** for password reset emails
2. **Set up monitoring** with Prometheus/Grafana
3. **Implement backup** automation
4. **Configure SSL** certificates
5. **Set up load balancing** for high availability
6. **Monitor performance** and optimize
7. **Scale horizontally** as needed

---

**Your enterprise server is now ready to handle 1000+ campaigns with professional-grade performance! 🎉**
