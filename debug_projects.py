import os
import json
import uuid
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def inspect_projects():
    # Try multiple paths
    paths = [
        'projects.json',
        'src/utils/projects.json',
        '/var/www/firebase-manager/projects.json'
    ]
    
    found_path = None
    for p in paths:
        if os.path.exists(p):
            found_path = p
            break
            
    if not found_path:
        print("❌ projects.json NOT FOUND in common locations.")
        print(f"Propable CWD: {os.getcwd()}")
        return

    print(f"✅ Found projects.json at: {found_path}")
    
    try:
        with open(found_path, 'r') as f:
            data = json.load(f)
            
        print(f"Entries count: {len(data)}")
        
        fixed_count = 0
        valid_count = 0
        
        fixed_data = []
        
        for i, entry in enumerate(data):
            # Check for ID
            if 'id' not in entry:
                print(f"⚠️ Entry {i} missing ID: {str(entry)[:100]}...")
                # Generate ID from service account project_id if possible
                if 'service_account' in entry and 'project_id' in entry['service_account']:
                    entry['id'] = entry['service_account']['project_id']
                    print(f"   -> Recovered ID from service_account: {entry['id']}")
                    fixed_count += 1
                elif 'name' in entry:
                     # Fallback hash or cleaning
                     print(f"   -> Entry has name but no ID. Marking as bad.")
            else:
                valid_count += 1
                print(f"   -> Valid Entry: {entry['id']}")
            
            fixed_data.append(entry)

        if fixed_count > 0:
            print(f"💾 Saving {fixed_count} fixed entries back to file...")
            # Backup first
            os.rename(found_path, found_path + ".bak")
            with open(found_path, 'w') as f:
                json.dump(fixed_data, f, indent=2)
            print("✅ File patched.")
        else:
            print("No fixes applicable automatically.")

    except Exception as e:
        print(f"Error reading/parsing: {e}")

if __name__ == "__main__":
    inspect_projects()
