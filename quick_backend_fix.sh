#!/bin/bash

echo "🔧 QUICK BACKEND FIX"
echo "==================="

APP_DIR="/var/www/firebase-manager"
cd $APP_DIR

echo "📋 Checking backend logs..."
journalctl -u firebase-manager --no-pager -l | tail -20

echo ""
echo "🔍 Checking Python path and modules..."
ls -la src/
ls -la src/utils/

echo ""
echo "🧪 Testing Python import..."
source venv/bin/activate
python3 -c "
import sys
sys.path.append('/var/www/firebase-manager')
try:
    import src.utils.firebaseBackend
    print('✅ Module import successful')
except Exception as e:
    print(f'❌ Module import failed: {e}')
    import traceback
    traceback.print_exc()
"

echo ""
echo "🔧 Creating __init__.py files..."
touch src/__init__.py
touch src/utils/__init__.py

echo ""
echo "🔧 Fixing systemd service..."
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

echo ""
echo "🔧 Testing direct execution..."
source venv/bin/activate
python3 src/utils/firebaseBackend.py &
BACKEND_PID=$!
sleep 5

if kill -0 $BACKEND_PID 2>/dev/null; then
    echo "✅ Backend runs directly"
    kill $BACKEND_PID
else
    echo "❌ Backend fails to run directly"
fi

echo ""
echo "🔄 Restarting service..."
systemctl daemon-reload
systemctl restart firebase-manager
sleep 10

echo ""
echo "📊 Service status:"
systemctl status firebase-manager --no-pager -l

echo ""
echo "🧪 Testing backend response..."
curl -s --max-time 10 http://localhost:8000/health || echo "Backend not responding"
