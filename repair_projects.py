import json
import os
import shutil

# Use absolute path to ensure we find the file regardless of execution dir
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECTS_FILE = os.path.join(BASE_DIR, 'projects.json')

def repair_projects():
    print(f"Targeting file: {PROJECTS_FILE}")
    if not os.path.exists(PROJECTS_FILE):
        print("projects.json not found.")
        return

    # Backup
    shutil.copy2(PROJECTS_FILE, PROJECTS_FILE + ".bak_repair")
    
    with open(PROJECTS_FILE, 'r') as f:
        projects = json.load(f)
        
    fixed = 0
    new_list = []
    
    # Check if it is a list or dict
    if isinstance(projects, dict):
        print("Detected dict format (unexpected for file, but possible). Converting to list...")
        for p_id, p_data in projects.items():
            if 'id' not in p_data:
                p_data['id'] = p_id
                fixed += 1
            new_list.append(p_data)
        projects = new_list
        
    elif isinstance(projects, list):
        print(f"Scanning {len(projects)} projects...")
        for p in projects:
            if 'id' not in p:
                # Try to derive ID
                p_id = None
                if 'serviceAccount' in p and 'project_id' in p['serviceAccount']:
                    p_id = p['serviceAccount']['project_id']
                elif 'service_account' in p and 'project_id' in p['service_account']:
                    p_id = p['service_account']['project_id']
                
                if p_id:
                    p['id'] = p_id
                    print(f"Fixed project: {p_id}")
                    fixed += 1
                else:
                    print(f"Could not derive ID for project: {p.get('name')}")
            else:
                # ID exists
                pass

    if fixed > 0:
        with open(PROJECTS_FILE, 'w') as f:
            json.dump(projects, f, indent=2)
        print(f"✅ Successfully repaired {fixed} projects in {PROJECTS_FILE}")
    else:
        print("No repairs needed.")

if __name__ == "__main__":
    repair_projects()
