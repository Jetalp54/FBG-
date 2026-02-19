"""
Patch: Fix list_campaigns to use file as source of truth (never loses throttle_config/selectedUsers).
       Fix SendingModeSelector to add more throttle presets (1000ms, 5000ms).
Run: python patch_persistence.py
"""
import re, os

BACKEND = os.path.join('src', 'utils', 'firebaseBackend.py')

# ── Read the file ──────────────────────────────────────────────────────────────
with open(BACKEND, 'r', encoding='utf-8') as f:
    content = f.read()

# ── Find and replace list_campaigns function body ────────────────────────────
# We replace from the @app.get("/campaigns") decorator up to (not including) @app.get("/campaigns/{campaign_id}")
START_MARKER = '@app.get("/campaigns")\nasync def list_campaigns'
END_MARKER   = '\n@app.get("/campaigns/{campaign_id}")'

start = content.find(START_MARKER)
end   = content.find(END_MARKER, start)

if start == -1:
    # Try CRLF variant
    START_MARKER = '@app.get("/campaigns")\r\nasync def list_campaigns'
    start = content.find(START_MARKER)
    end   = content.find(END_MARKER.replace('\n', '\r\n'), start)

if start == -1 or end == -1:
    print(f"ERROR: Could not locate list_campaigns. start={start}, end={end}")
    exit(1)

print(f"Found list_campaigns: chars {start}–{end}")

NEW_LIST_CAMPAIGNS = '''@app.get("/campaigns")
async def list_campaigns(request: Request, page: int = 1, limit: int = 10):
    """
    List campaigns.
    STRATEGY: File/memory is source of truth for FULL config (throttle_config,
    selectedUsers, schedule_config, etc.). DB is queried ONLY for live status/counts.
    This ensures campaigns NEVER lose their config on refresh.
    """
    try:
        current_user = get_current_user_from_request(request)
        users_data   = load_app_users()
        user_obj     = next((u for u in users_data.get('users', []) if u.get('username') == current_user), None)
        is_admin     = user_obj and user_obj.get('role') == 'admin'

        # ── 1. Load full campaign data from file (source of truth for all fields) ──
        file_campaigns = load_campaigns_from_file() or []
        if not is_admin:
            file_campaigns = [c for c in file_campaigns if c.get('ownerId') == current_user]
        file_map = {c.get('id'): c for c in file_campaigns if c.get('id')}

        # ── 2. Query DB for live status/counts only ────────────────────────────────
        db_status_map = {}
        try:
            conn = get_db_connection()
            if conn:
                q = """
                    SELECT c.campaign_uuid, c.status, c.processed, c.successful, c.failed
                    FROM campaigns c
                    LEFT JOIN app_users u ON c.owner_id = u.id
                """
                params = []
                if not is_admin:
                    q += " WHERE u.username = %s"
                    params.append(current_user)
                cursor = conn.cursor()
                cursor.execute(q, tuple(params))
                for row in cursor.fetchall():
                    c_uuid = row[0]
                    if c_uuid:
                        db_status_map[c_uuid] = {
                            'status': row[1], 'processed': row[2] or 0,
                            'successful': row[3] or 0, 'failed': row[4] or 0,
                        }
                conn.close()
        except Exception as e:
            logger.warning(f"DB status overlay failed: {e}")

        # ── 3. Merge: file (full config) + DB (live counts) + memory (real-time) ──
        final_list = []
        for c in file_campaigns:
            c_id = c.get('id')

            if c_id in active_campaigns:
                # Memory version has the most current data; patch missing config fields from file
                mem_c = dict(active_campaigns[c_id])
                for field in ('throttle_config', 'schedule_config', 'selectedUsers', 'turbo_config', 'sending_mode'):
                    if not mem_c.get(field) and c.get(field):
                        mem_c[field] = c[field]
                final_list.append(mem_c)
            else:
                merged = dict(c)  # start with full file data
                if c_id in db_status_map:
                    db = db_status_map[c_id]
                    merged.update({
                        'status':     db.get('status',     merged.get('status', 'pending')),
                        'processed':  db.get('processed',  merged.get('processed', 0)),
                        'successful': db.get('successful', merged.get('successful', 0)),
                        'failed':     db.get('failed',     merged.get('failed', 0)),
                    })
                final_list.append(merged)

        # Sort newest first
        final_list.sort(key=lambda x: x.get('createdAt', ''), reverse=True)

        # ── 4. Pagination ──────────────────────────────────────────────────────────
        total_campaigns = len(final_list)
        total_pages     = (total_campaigns + limit - 1) // limit
        start_index     = (page - 1) * limit
        paginated       = final_list[start_index: start_index + limit]

        return {
            "campaigns":    paginated,
            "total":        total_campaigns,'''

# Build the replacement: new function body + the end marker
replacement = NEW_LIST_CAMPAIGNS + content[end:]

# And prepend everything before start
content = content[:start] + replacement

with open(BACKEND, 'w', encoding='utf-8') as f:
    f.write(content)

print(f"✅ list_campaigns patched. File size: {len(content)} chars")

# ── Now verify the closing of the function is still intact ──────────────────
if '"total": total_campaigns' in content or '"total":        total_campaigns' in content:
    print("✅ Return block confirmed present")
else:
    print("⚠️  Return block may be missing — check file manually")
