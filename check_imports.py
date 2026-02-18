import sys
import os

print("--- DEBUG IMPORTS ---")
base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if base_dir not in sys.path:
    sys.path.append(base_dir)

print(f"Base Dir: {base_dir}")

try:
    print("1. Importing psycopg2...")
    import psycopg2
    print("   OK")
except ImportError as e:
    print(f"   FAIL: {e}")

try:
    print("2. Importing redis...")
    import redis
    print("   OK")
except ImportError as e:
    print(f"   FAIL: {e}")

try:
    print("3. Importing celery_tasks...")
    from src.utils import celery_tasks
    print("   OK")
except Exception as e:
    print(f"   FAIL: {e}")
    import traceback
    traceback.print_exc()

print("--- END DEBUG ---")
