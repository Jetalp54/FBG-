import os
import json
import logging
from google.oauth2 import service_account
from google.cloud import resourcemanager_v3

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Directory containing your service account JSON files
CREDENTIALS_DIR = 'credentials' 

def delete_project(json_path):
    try:
        with open(json_path, 'r') as f:
            sa_info = json.load(f)
        
        project_id = sa_info.get('project_id')
        if not project_id:
            logger.warning(f"Skipping {json_path}: No project_id found")
            return

        logger.info(f"Attempting to delete {project_id}...")

        # Create credentials
        creds = service_account.Credentials.from_service_account_info(sa_info)
        
        # Create client
        client = resourcemanager_v3.ProjectsClient(credentials=creds)
        
        # Delete project
        request = resourcemanager_v3.DeleteProjectRequest(name=f"projects/{project_id}")
        operation = client.delete_project(request=request)
        result = operation.result()
        
        logger.info(f"✅ Successfully deleted {project_id}")
        
        # Optional: Delete the JSON file after successful project deletion
        # os.remove(json_path) 
        
    except Exception as e:
        logger.error(f"❌ Failed to delete {os.path.basename(json_path)}: {e}")

def main():
    if not os.path.exists(CREDENTIALS_DIR):
        print(f"Directory '{CREDENTIALS_DIR}' not found. Please create it and put your JSON keys inside.")
        return

    files = [f for f in os.listdir(CREDENTIALS_DIR) if f.endswith('.json')]
    print(f"Found {len(files)} JSON files in '{CREDENTIALS_DIR}'")
    
    if not files:
        print("No JSON files found.")
        return

    confirm = input(f"⚠️  WARNING: This will PERMANENTLY DELETE {len(files)} Google Cloud Projects found in keys.\nAre you sure? (type 'yes'): ")
    if confirm.lower() != 'yes':
        print("Aborted.")
        return

    for filename in files:
        json_path = os.path.join(CREDENTIALS_DIR, filename)
        delete_project(json_path)

if __name__ == "__main__":
    main()
