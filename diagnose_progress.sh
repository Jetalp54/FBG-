#!/bin/bash
# Diagnostic script to check why progress tracking isn't working

echo "=== 1. Check if backend was restarted after latest pull ==="
cd /opt/FBG-
git log --oneline -5

echo ""
echo "=== 2. Check backend service status ==="
sudo systemctl status firebase-manager | head -20

echo ""
echo "=== 3. Check for errors in logs (last 100 lines) ==="
sudo journalctl -u firebase-manager -n 100 | grep -i "error\|campaign\|progress\|create_campaign_result\|update_campaign_result"

echo ""
echo "=== 4. Check if campaign_results.json exists NOW ==="
if [ -f campaign_results.json ]; then
    echo "Found campaign_results.json:"
    cat campaign_results.json | python3 -m json.tool
else
    echo "❌ campaign_results.json STILL does not exist!"
fi

echo ""
echo "=== 5. Check current campaigns.json ==="
if [ -f campaigns.json ]; then
    cat campaigns.json | python3 -m json.tool | head -50
fi

echo ""
echo "=== 6. Test if create_campaign_result function exists ==="
grep -n "def create_campaign_result" src/utils/firebaseBackend.py

echo ""
echo "=== 7. Check if fire_all_emails calls create_campaign_result ==="
grep -A5 "def fire_all_emails" src/utils/firebaseBackend.py | head -20
grep -n "create_campaign_result" src/utils/firebaseBackend.py
