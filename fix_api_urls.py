"""
Comprehensive API URL Patcher for Firebase Manager Frontend
This script fixes all API_BASE_URL definitions and fetch calls across the frontend.
"""
import os
import re

# Smart replacement for API_BASE_URL
NEW_LOGIC = '(window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") ? "http://localhost:8000" : "/api"'

def patch_file(file_path):
    """Patch a single file with the correct API_BASE_URL logic."""
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            content = f.read()
            
        original_content = content
        
        # 1. Fix standard API_BASE_URL assignments (with any amount of indentation)
        pattern = r'(\s*)(const\s+API_BASE_URL\s*=\s*)import\.meta\.env\.VITE_API_BASE_URL \|\| [\'"]http://localhost:8000[\'"];?'
        replacement = f'\\1\\2{NEW_LOGIC};'
        content = re.sub(pattern, replacement, content)
        
        # 2. Fix inline API_BASE_URL usage in fetch calls (LoginPage.tsx pattern)
        inline_pattern = r'\$\{import\.meta\.env\.VITE_API_BASE_URL \|\| [\'"]http://localhost:8000[\'"]}'
        inline_replacement = '${(window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") ? "http://localhost:8000" : "/api"}'
        content = re.sub(inline_pattern, inline_replacement, content)
        
        # 3. Remove hardcoded /api from fetch calls that use API_BASE_URL
        # This prevents double /api/api/ URLs
        content = content.replace('fetch(`${API_BASE_URL}/api/', 'fetch(`${API_BASE_URL}/')
        content = content.replace('fetch(`${API_BASE_URL}/api/', 'fetch(`${API_BASE_URL}/')  # Check again with different quotes
        
        # 4. Patch getApiBaseUrl functions (in contexts)
        if "getApiBaseUrl" in content:
            content = re.sub(r'return [`\'"]http://\$\{hostname\}:8000[`\'"];', 'return "/api";', content)
            content = re.sub(r'return [\'"]http://localhost:8000[\'"];', 'return "/api";', content)
        
        if content != original_content:
            with open(file_path, "w", encoding="utf-8") as f:
                f.write(content)
            print(f"✓ Patched: {file_path}")
            return True
        else:
            print(f"  No changes: {file_path}")
            return False
            
    except Exception as e:
        print(f"✗ Failed to patch {file_path}: {e}")
        return False

def patch_directory(directory):
    """Recursively patch all .ts and .tsx files in a directory."""
    patched_count = 0
    for root, dirs, files in os.walk(directory):
        for file in files:
            if file.endswith((".ts", ".tsx")):
                file_path = os.path.join(root, file)
                if patch_file(file_path):
                    patched_count += 1
    return patched_count

if __name__ == "__main__":
    print("=" * 60)
    print("Firebase Manager Frontend API URL Patcher")
    print("=" * 60)
    print()
    
    src_dir = "src"
    if not os.path.exists(src_dir):
        print(f"ERROR: {src_dir} directory not found!")
        print("Please run this script from the project root directory.")
        exit(1)
    
    print(f"Scanning and patching files in: {os.path.abspath(src_dir)}")
    print()
    
    patched = patch_directory(src_dir)
    
    print()
    print("=" * 60)
    print(f"Patching complete! Modified {patched} file(s).")
    print("=" * 60)
    print()
    print("Next steps:")
    print("1. Review the changes (git diff)")
    print("2. Run: npm run build")
    print("3. Upload the updated files to your server")
    print()
