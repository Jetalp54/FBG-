#!/bin/bash

# Navigate to the project directory
cd /var/www/firebase-manager || { echo "Directory not found"; exit 1; }

# Pull the latest changes from git
echo "Pulling latest changes..."
git pull origin main

# Install dependencies (just in case)
echo "Installing dependencies..."
npm install

# Build the frontend
echo "Building frontend..."
npm run build

# Restart the backend service
echo "Restarting backend..."
# Kill any existing python processes for firebaseBackend.py
pkill -f "python src/utils/firebaseBackend.py" || true
# Wait a moment to ensure port is released
sleep 2
# Start backend in background
nohup python src/utils/firebaseBackend.py > backend.log 2>&1 &
echo " Backend started with PID $!"

echo "Deployment complete! Please refresh your browser."
