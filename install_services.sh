#!/bin/bash
# ==============================================================
# Install Firebase Manager as systemd auto-start services
# Run this ONCE on the server: bash install_services.sh
# ==============================================================
set -e
echo "🔧 Installing Firebase Manager auto-start services..."

# 1. Kill existing manual processes
echo "🛑 Stopping old processes..."
pkill -f "firebaseBackend.py" || true
pkill -f "celery worker" || true
sleep 2

# 2. Install service files
echo "📋 Installing systemd service files..."
sudo cp firebase-backend.service /etc/systemd/system/firebase-backend.service
sudo cp firebase-celery.service /etc/systemd/system/firebase-celery.service

# 3. Reload systemd and enable services
sudo systemctl daemon-reload
sudo systemctl enable firebase-backend
sudo systemctl enable firebase-celery

# 4. Start services
echo "🚀 Starting services..."
sudo systemctl start firebase-celery
sleep 3
sudo systemctl start firebase-backend
sleep 3

# 5. Status report
echo ""
echo "✅ Services installed! Status:"
sudo systemctl status firebase-celery --no-pager | tail -5
sudo systemctl status firebase-backend --no-pager | tail -5

echo ""
echo "📌 Useful commands:"
echo "  View backend logs:  journalctl -u firebase-backend -f"
echo "  View celery logs:   journalctl -u firebase-celery -f"
echo "  Restart backend:    sudo systemctl restart firebase-backend"
echo "  Restart celery:     sudo systemctl restart firebase-celery"
echo "  After git pull:     sudo systemctl restart firebase-backend firebase-celery"
