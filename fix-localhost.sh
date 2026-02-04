#!/bin/bash

echo "🔧 Fixing API URLs for local development..."

# Replace all server IP references with localhost
find src -name "*.tsx" -type f -exec sed -i 's/http:\/\/139\.59\.213\.238:8000/http:\/\/localhost:8000/g' {} \;

echo "✅ All API URLs updated to use localhost:8000"
echo "📝 Files updated:"
find src -name "*.tsx" -type f -exec grep -l "localhost:8000" {} \; 