#!/bin/bash
# Quick verification script

cd /opt/FBG-

echo "=== Pulling latest code ==="
git pull

echo ""
echo "=== Checking for save_campaign_results_to_file function ==="
grep -n "def save_campaign_results_to_file" src/utils/firebaseBackend.py

echo ""
echo "=== Restarting backend ==="
sudo systemctl restart firebase-manager

echo ""
echo "Waiting 3 seconds for backend to start..."
sleep 3

echo ""
echo "=== Backend status ==="
sudo systemctl status firebase-manager --no-pager | head -15

echo ""
echo "✅ Backend updated! Now create a NEW campaign and test."
