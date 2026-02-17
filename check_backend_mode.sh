#!/bin/bash
# Check what mode the backend is using and verify campaigns.json

echo "=== Checking Backend Mode ==="
cd /opt/FBG-

# Check if .env exists
if [ -f .env ]; then
    echo "Found .env file:"
    grep USE_DATABASE .env || echo "USE_DATABASE not set (defaults to file mode)"
else
    echo "No .env file found - using file mode by default"
fi

echo ""
echo "=== Checking campaigns.json ==="
if [ -f campaigns.json ]; then
    echo "Found campaigns.json:"
    cat campaigns.json | python3 -m json.tool
else
    echo "No campaigns.json file found"
fi

echo ""
echo "=== Checking campaign_results.json ==="
if [ -f campaign_results.json ]; then
    echo "Found campaign_results.json:"
    cat campaign_results.json | python3 -m json.tool
else
    echo "No campaign_results.json file found"
fi
