import os

def find_file(filename, search_path):
    result = []
    print(f"Searching for {filename} in {search_path}...")
    for root, dirs, files in os.walk(search_path):
        if filename in files:
            full_path = os.path.join(root, filename)
            size = os.path.getsize(full_path)
            print(f"FOUND: {full_path} ({size} bytes)")
            result.append(full_path)
    return result

if __name__ == "__main__":
    base_dir = os.path.dirname(os.path.abspath(__file__))
    find_file("projects.json", base_dir)
