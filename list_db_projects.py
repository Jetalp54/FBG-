import os
import psycopg2
from psycopg2.extras import RealDictCursor
from urllib.parse import urlparse
from dotenv import load_dotenv

load_dotenv()

def get_db_connection():
    db_url = os.getenv('DB_URL')
    if not db_url:
        print("Error: DB_URL not found in .env")
        return None
    
    parsed = urlparse(db_url)
    try:
        conn = psycopg2.connect(
            host=parsed.hostname,
            port=parsed.port or 5432,
            database=parsed.path[1:],
            user=parsed.username,
            password=parsed.password,
            cursor_factory=RealDictCursor
        )
        return conn
    except Exception as e:
        print(f"Error connecting to DB: {e}")
        return None

def list_projects():
    conn = get_db_connection()
    if not conn:
        return
    
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT id, name, admin_email, service_account->>'project_id' as project_id FROM projects")
        projects = cursor.fetchall()
        print(f"Found {len(projects)} projects:")
        for p in projects:
            print(f"ID: {p['id']}, Name: {p['name']}, Email: {p['admin_email']}, Project ID: {p['project_id']}")
        cursor.close()
        conn.close()
    except Exception as e:
        print(f"Error listing projects: {e}")

if __name__ == "__main__":
    list_projects()
