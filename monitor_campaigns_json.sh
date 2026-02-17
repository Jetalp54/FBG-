#!/bin/bash
# Monitor campaigns.json writes in real-time

cd /var/www/firebase-manager

echo "Monitoring campaigns.json for writes. Press Ctrl+C to stop."
echo ""

# Create a copy before the test
cp campaigns.json campaigns_before.json

# Watch for file modification
while true; do
    inotifywait -e modify campaigns.json 2>/dev/null
    timestamp=$(date "+%H:%M:%S.%N")
    echo "[$timestamp] campaigns.json was modified!"
    
    # Show what the tttt campaign looks like now
    cat campaigns.json | python3 -c "
import sys, json
data = json.load(sys.stdin)
for c in data:
    if 'bce27359' in c.get('id', ''):
        print(f\"  processed={c.get('processed')}, successful={c.get('successful')}, failed={c.get('failed')}\")
" 2>/dev/null || echo "  (could not read campaign data)"
done
