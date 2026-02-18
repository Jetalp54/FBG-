#!/bin/bash
echo "📋 DUMPING LOGS (Run this to see why it crashed)..."
echo "==================================================="
echo "--- BACKEND LOG (Last 100 Lines) ---"
tail -n 100 backend.log
echo "\n--- CELERY WORKER LOG (Last 50 Lines) ---"
tail -n 50 celery_worker.log
echo "==================================================="
