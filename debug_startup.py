import sys
import os

print("--- DEBUG STARTUP ---")
# Mimic the environment of running from root
base_dir = os.path.abspath(os.getcwd())
print(f"CWD: {base_dir}")

# Add CWD to path (as python -m would, or as my patch should)
sys.path.insert(0, base_dir)

try:
    print("Attempting to import 'src.utils.firebaseBackend'...")
    # We use runpy to execute it as a script if possible, or just import it
    # Import is safer to check for syntax/import errors without running the app
    import src.utils.firebaseBackend
    print("✅ Import successful! The code structure is valid.")
except Exception as e:
    print(f"❌ CRITICAL FAILURE: {e}")
    import traceback
    traceback.print_exc()
