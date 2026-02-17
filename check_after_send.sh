#!/bin/bash
# Deep diagnostic - run this AFTER creating and sending a new campaign

cd /opt/FBG-

echo "=== 1. Check campaigns.json for the 'www' campaign ==="
cat campaigns.json | python3 -c "
import sys, json
data = json.load(sys.stdin)
for c in data:
    if 'www' in c.get('name', '').lower():
        print(json.dumps(c, indent=2))
"

echo ""
echo "=== 2. Check if campaign_results.json was created ==="
if [ -f campaign_results.json ]; then
    echo "✅ File exists! Contents:"
    cat campaign_results.json | python3 -m json.tool
else
    echo "❌ campaign_results.json still doesn't exist"
fi

echo ""
echo "=== 3. Check backend logs for campaign result tracking ==="
sudo journalctl -u firebase-manager --since "5 minutes ago" | grep -i "campaign result\|save.*campaign\|processed\|successful"

echo ""
echo "=== 4. Check for errors writing to files ==="
sudo journalctl -u firebase-manager --since "5 minutes ago" | grep -i "error\|failed.*save\|failed.*update"
