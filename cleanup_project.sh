#!/bin/bash

echo "🧹 Starting project cleanup..."

# Remove old versions directory (contains large zip files)
echo "📦 Removing old versions directory..."
rm -rf "old versions/"

# Remove duplicate/old directories
echo "🗂️ Removing duplicate directories..."
rm -rf FBZ_WEB/
rm -rf FBZ_Link/
rm -rf Auto_Link/
rm -rf postcss.config/

# Remove old/duplicate scripts
echo "📜 Removing old scripts..."
rm -f setup-server-fixed.sh
rm -f comprehensive-server-fix.sh
rm -f comprehensive-fix.sh
rm -f fix-api-issues.sh
rm -f build-for-server.sh
rm -f server-config.js
rm -f fbz_script.py

# Remove test files
echo "🧪 Removing test files..."
rm -f test_backend.py
rm -f test_backend.html
rm -f test_bulk_delete.py
rm -f debug-campaign-issues.js

# Remove documentation files (keeping only README.md)
echo "📚 Removing old documentation..."
rm -f critical-fixes-applied.md
rm -f SERVER-DEPLOYMENT-COMPLETE.md
rm -f UBUNTU-DEPLOYMENT.md
rm -f BACKEND-SETUP.md
rm -f instalation.txt

# Remove example files
echo "📋 Removing example files..."
rm -f apikeys_example.txt
rm -f private_keys_example.json

# Remove node_modules (will be reinstalled)
echo "📦 Removing node_modules..."
rm -rf node_modules/

# Remove build artifacts
echo "🏗️ Removing build artifacts..."
rm -rf dist/

# Remove database and log files (will be recreated)
echo "🗄️ Removing data files..."
rm -f app.db
rm -f audit.log
rm -f daily_counts.json
rm -f campaign_results.json
rm -f campaigns.json
rm -f profiles.json
rm -f projects.json

# Remove lock files (will be regenerated)
echo "🔒 Removing lock files..."
rm -f package-lock.json
rm -f bun.lockb

# Remove service account file (should be uploaded by user)
echo "🔑 Removing service account file..."
rm -f admin_service_account.json

# Remove API keys file (should be uploaded by user)
echo "🔑 Removing API keys file..."
rm -f apikeys.txt
rm -f private_keys.json
rm -f ai_keys.json

echo "✅ Project cleanup completed!"
echo "📁 Remaining essential files:"
echo "   - src/ (React/TypeScript source code)"
echo "   - public/ (Static assets)"
echo "   - package.json (Node.js dependencies)"
echo "   - requirements.txt (Python dependencies)"
echo "   - setup-server.sh (Server setup script)"
echo "   - complete_installation.sh (Complete installation script)"
echo "   - nginx-config.conf (Nginx configuration)"
echo "   - firebase-backend.service (Systemd service)"
echo "   - README.md (Documentation)"
echo "   - Configuration files (.env, tsconfig, etc.)" 