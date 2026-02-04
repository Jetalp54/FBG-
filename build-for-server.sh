#!/bin/bash

# Build script for Ubuntu server deployment
echo "🚀 Building Firebase Email Campaign App for Ubuntu Server..."

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Build the frontend for production
echo "🔨 Building frontend..."
npm run build

# Create environment file for production
echo "⚙️ Creating production environment file..."
cat > .env.production << EOF
VITE_API_BASE_URL=http://your-server-ip:8000
EOF

echo "✅ Build completed!"
echo ""
echo "📋 Next steps:"
echo "1. Update the API_BASE_URL in .env.production with your server IP"
echo "2. Copy the dist/ folder to your Ubuntu server"
echo "3. Start the backend on your server: python src/utils/firebaseBackend.py"
echo "4. Serve the frontend with a web server (nginx, apache, etc.)" 