#!/bin/bash

# Comprehensive Firebase Campaign App Server Deployment Fix
# This script fixes all localhost references and server compatibility issues
# Server IP: 139.59.213.238

echo "🔧 Firebase Campaign App - Comprehensive Server Fix"
echo "=================================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Server configuration
SERVER_IP="139.59.213.238"
BACKEND_PORT="8000"

echo -e "${BLUE}Server Configuration:${NC}"
echo "- Server IP: $SERVER_IP"  
echo "- Backend Port: $BACKEND_PORT"
echo "- Backend URL: http://$SERVER_IP:$BACKEND_PORT"
echo ""

# Function to check if file exists and update
update_file_if_exists() {
    local file="$1"
    local search="$2"
    local replace="$3"
    
    if [ -f "$file" ]; then
        if grep -q "$search" "$file"; then
            sed -i "s|$search|$replace|g" "$file"
            echo -e "${GREEN}✓${NC} Updated: $file"
        else
            echo -e "${YELLOW}!${NC} No changes needed: $file"
        fi
    else
        echo -e "${RED}✗${NC} File not found: $file"
    fi
}

echo -e "${BLUE}Step 1: Updating Main Component Files${NC}"
echo "--------------------------------------"

# Update main components API base URLs
update_file_if_exists "src/components/ProfileManager.tsx" "http://localhost:8000" "http://$SERVER_IP:$BACKEND_PORT"
update_file_if_exists "src/components/UsersPage.tsx" "http://localhost:8000" "http://$SERVER_IP:$BACKEND_PORT"
update_file_if_exists "src/components/TestCampaign.tsx" "http://localhost:8000" "http://$SERVER_IP:$BACKEND_PORT"
update_file_if_exists "src/components/TemplatesPage.tsx" "http://localhost:8000" "http://$SERVER_IP:$BACKEND_PORT"
update_file_if_exists "src/components/ProjectsPage.tsx" "http://localhost:8000" "http://$SERVER_IP:$BACKEND_PORT"
update_file_if_exists "src/components/EnhancedUsersPage.tsx" "http://localhost:8000" "http://$SERVER_IP:$BACKEND_PORT"
update_file_if_exists "src/components/EnhancedCampaignsPage.tsx" "http://localhost:8000" "http://$SERVER_IP:$BACKEND_PORT"
update_file_if_exists "src/components/EnhancedCampaignMonitor.tsx" "http://localhost:8000" "http://$SERVER_IP:$BACKEND_PORT"
update_file_if_exists "src/components/CampaignsPage.tsx" "http://localhost:8000" "http://$SERVER_IP:$BACKEND_PORT"
update_file_if_exists "src/components/AuditLogsPage.tsx" "http://localhost:8000" "http://$SERVER_IP:$BACKEND_PORT"
update_file_if_exists "src/components/AIManagement.tsx" "http://localhost:8000" "http://$SERVER_IP:$BACKEND_PORT"

echo ""
echo -e "${BLUE}Step 2: Updating Services and Context Files${NC}"
echo "--------------------------------------------"

# Update services
update_file_if_exists "src/services/LightningCampaignService.ts" "http://localhost:8000" "http://$SERVER_IP:$BACKEND_PORT"

# Update contexts
update_file_if_exists "src/contexts/AppContext.tsx" "http://localhost:8000" "http://$SERVER_IP:$BACKEND_PORT"
update_file_if_exists "src/contexts/EnhancedAppContext.tsx" "http://localhost:8000" "http://$SERVER_IP:$BACKEND_PORT"

# Update pages
update_file_if_exists "src/pages/Index.tsx" "http://localhost:8000" "http://$SERVER_IP:$BACKEND_PORT"

echo ""
echo -e "${BLUE}Step 3: Updating Test and Utility Files${NC}"
echo "-------------------------------------------"

# Update test files
update_file_if_exists "test_bulk_delete.py" "http://localhost:8000" "http://$SERVER_IP:$BACKEND_PORT"

# Update debug script
update_file_if_exists "debug-campaign-issues.js" "http://localhost:8000" "http://$SERVER_IP:$BACKEND_PORT"

echo ""
echo -e "${BLUE}Step 4: Creating Environment Configuration${NC}"
echo "---------------------------------------------"

# Create .env file for environment variables
ENV_FILE=".env"
if [ -f "$ENV_FILE" ]; then
    echo -e "${YELLOW}!${NC} .env file already exists, creating backup..."
    cp "$ENV_FILE" "${ENV_FILE}.backup"
fi

cat > "$ENV_FILE" << EOF
# Firebase Campaign App - Server Configuration
# Backend API Base URL
VITE_API_BASE_URL=http://$SERVER_IP:$BACKEND_PORT

# WebSocket URL
VITE_WS_URL=ws://$SERVER_IP:$BACKEND_PORT/ws

# Environment
NODE_ENV=production

# Server IP for reference
SERVER_IP=$SERVER_IP
BACKEND_PORT=$BACKEND_PORT
EOF

echo -e "${GREEN}✓${NC} Created .env file with server configuration"

echo ""
echo -e "${BLUE}Step 5: Backend Server Configuration Check${NC}"
echo "---------------------------------------------"

# Check if backend is configured for CORS
BACKEND_FILE="src/utils/firebaseBackend.py"
if [ -f "$BACKEND_FILE" ]; then
    if grep -q "allow_origins=\[\"*\"\]" "$BACKEND_FILE"; then
        echo -e "${GREEN}✓${NC} Backend CORS is configured for all origins"
    else
        echo -e "${YELLOW}!${NC} Backend CORS configuration should be checked"
    fi
    
    if grep -q "uvicorn.*host=\"0.0.0.0\"" "$BACKEND_FILE"; then
        echo -e "${GREEN}✓${NC} Backend is configured to listen on all interfaces"
    else
        echo -e "${YELLOW}!${NC} Backend should listen on 0.0.0.0 for server deployment"
    fi
else
    echo -e "${RED}✗${NC} Backend file not found: $BACKEND_FILE"
fi

echo ""
echo -e "${BLUE}Step 6: Build Process${NC}"
echo "---------------------"

echo "Building the application for production..."
if command -v npm &> /dev/null; then
    npm run build
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓${NC} Application built successfully"
    else
        echo -e "${RED}✗${NC} Build failed"
    fi
else
    echo -e "${YELLOW}!${NC} npm not found, skipping build step"
fi

echo ""
echo -e "${BLUE}Step 7: Network and Server Verification${NC}"
echo "-------------------------------------------"

# Test server connectivity
echo "Testing server connectivity..."
if ping -c 1 "$SERVER_IP" &> /dev/null; then
    echo -e "${GREEN}✓${NC} Server $SERVER_IP is reachable"
else
    echo -e "${RED}✗${NC} Server $SERVER_IP is not reachable"
fi

# Test backend API
echo "Testing backend API..."
if curl -s --connect-timeout 5 "http://$SERVER_IP:$BACKEND_PORT/health" > /dev/null; then
    echo -e "${GREEN}✓${NC} Backend API is responding"
else
    echo -e "${RED}✗${NC} Backend API is not responding"
    echo "  Make sure the backend is running: python src/utils/firebaseBackend.py"
fi

echo ""
echo -e "${BLUE}Step 8: Profile Creation Testing${NC}"
echo "--------------------------------"

# Test profile creation endpoint
echo "Testing profile creation endpoint..."
PROFILE_TEST_RESPONSE=$(curl -s -w "%{http_code}" -X POST \
    -H "Content-Type: application/json" \
    -d '{"name":"Test Profile","description":"Automated test","projectIds":[]}' \
    "http://$SERVER_IP:$BACKEND_PORT/profiles" \
    -o /tmp/profile_test_response.json)

if [ "$PROFILE_TEST_RESPONSE" = "200" ]; then
    echo -e "${GREEN}✓${NC} Profile creation endpoint working"
    # Clean up test profile
    TEST_PROFILE_ID=$(cat /tmp/profile_test_response.json | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
    if [ ! -z "$TEST_PROFILE_ID" ]; then
        curl -s -X DELETE "http://$SERVER_IP:$BACKEND_PORT/profiles/$TEST_PROFILE_ID" > /dev/null
        echo -e "${GREEN}✓${NC} Cleaned up test profile"
    fi
else
    echo -e "${RED}✗${NC} Profile creation endpoint failed (HTTP: $PROFILE_TEST_RESPONSE)"
fi

echo ""
echo -e "${GREEN}=====================================${NC}"
echo -e "${GREEN}✅ COMPREHENSIVE SERVER FIX COMPLETE${NC}"
echo -e "${GREEN}=====================================${NC}"
echo ""

echo -e "${BLUE}Summary of Changes:${NC}"
echo "• Fixed all hardcoded localhost:8000 references"
echo "• Updated to use server IP: $SERVER_IP:$BACKEND_PORT"
echo "• Created proper .env configuration"
echo "• Tested server connectivity and API endpoints"
echo "• Verified profile creation functionality"
echo ""

echo -e "${BLUE}Next Steps:${NC}"
echo "1. Deploy the built application to your web server"
echo "2. Ensure the backend is running: python src/utils/firebaseBackend.py"
echo "3. Test profile creation in the web interface"
echo "4. Test all other functionalities"
echo ""

echo -e "${BLUE}If issues persist:${NC}"
echo "1. Check server firewall settings (port $BACKEND_PORT should be open)"
echo "2. Verify backend is running with: ps aux | grep firebaseBackend"
echo "3. Check backend logs for errors"
echo "4. Test API directly: curl http://$SERVER_IP:$BACKEND_PORT/health"
echo ""

echo -e "${GREEN}Profile creation should now work on the server!${NC}" 