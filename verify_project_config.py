
import sys
import os
import json
import requests
from google.oauth2 import service_account
from google.auth.transport.requests import AuthorizedSession

def verify_config(project_id):
    print(f"Checking config for project: {project_id}")
    
    # Try to load app_users.json to find the service account path
    try:
        with open('app_users.json', 'r') as f:
            app_users = json.load(f)
            
        project_config = next((p for p in app_users if p.get('id') == project_id), None)
        
        if project_config and project_config.get('serviceAccount'):
            sa_file = project_config.get('serviceAccount')
            if not os.path.exists(sa_file):
                # Try relative to current dir if absolute fails
                if os.path.exists(os.path.join(os.getcwd(), sa_file)):
                    sa_file = os.path.join(os.getcwd(), sa_file)
                else:
                    print(f"Service account path {sa_file} from app_users.json not found.")
                    sa_file = None
        else:
             print(f"Project {project_id} not found in app_users.json or has no serviceAccount set.")
             
    except Exception as e:
        print(f"Failed to read app_users.json: {e}")
        # Fallback to searching


    print(f"Using service account candidate: {sa_file}")
    
    try:
        cred = service_account.Credentials.from_service_account_file(
            sa_file,
            scopes=['https://www.googleapis.com/auth/cloud-platform']
        )
        authed_session = AuthorizedSession(cred)
        
        # URL to GET config
        url = f"https://identitytoolkit.googleapis.com/v2/projects/{project_id}/config"
        
        print(f"Fetching config from {url}...")
        response = authed_session.get(url)
        
        if response.status_code == 200:
            config = response.json()
            print("\n=== FULL CONFIG DUMP ===")
            print(json.dumps(config, indent=2))
            print("=== END CONFIG DUMP ===\n")
            
            # Check Authorized Domains
            print("Authorized Domains:", config.get('authorizedDomains', []))
            
            # Check SMTP
            notification = config.get('notification', {})
            # Identity Platform v2 structure might differ slightly
            send_email = notification.get('sendEmail', {})
            print("Email Method:", send_email.get('method'))
            print("SMTP Config:", json.dumps(send_email.get('smtp', {}), indent=2))
            
            # Check Reset Password
            reset_pwd = notification.get('resetPassword', {})
            print("Reset Password Config:", json.dumps(reset_pwd, indent=2))
            
        else:
            print(f"Failed to get config: {response.status_code} - {response.text}")
            
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python verify_project_config.py <project_id>")
    else:
        verify_config(sys.argv[1])
