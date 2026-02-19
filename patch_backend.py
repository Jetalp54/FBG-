"""
Surgical patch script: rewrites send_campaign + persistence-safe update/delete/pause/stop.
Run once from project root: python patch_backend.py
"""

import re, os, sys

FILE = os.path.join(os.path.dirname(__file__), 'src', 'utils', 'firebaseBackend.py')

with open(FILE, 'r', encoding='utf-8') as f:
    lines = f.readlines()

total = len(lines)
print(f"File has {total} lines")

# ── Find line ranges ──────────────────────────────────────────────────────────
def find_decorator(lines, route):
    for i, ln in enumerate(lines):
        if route in ln and ('@app.post' in ln or '@app.put' in ln or '@app.get' in ln or '@app.delete' in ln):
            return i
    return -1

def find_next_decorator_or_eof(lines, start):
    for i in range(start + 1, len(lines)):
        ln = lines[i].strip()
        if ln.startswith('@app.') or (ln.startswith('@') and '.route' in ln):
            return i
    return len(lines)

# ─── 1. REPLACE send_campaign (lines with @app.post("/campaigns/send")) ──────
sc_start = find_decorator(lines, '"/campaigns/send"')
sc_end   = find_next_decorator_or_eof(lines, sc_start)
print(f"send_campaign: lines {sc_start+1}–{sc_end}")

NEW_SEND_CAMPAIGN = r'''@app.post("/campaigns/send")
async def send_campaign(request: Request):
    """
    ⚡ Enterprise Campaign Send Engine v5.0 — DIRECT ASYNC
    =======================================================
    TURBO    : asyncio.gather() all emails CONCURRENTLY via Firebase REST API.
               300 simultaneous connections. No Celery. No workers.
    THROTTLED: Each project runs concurrently; emails within project are
               rate-limited with asyncio.sleep(delay_ms/1000). ms-precision.
    Both modes check Redis pause/stop signal before every send.
    """
    import asyncio
    import aiohttp

    try:
        try:
            request_data = await request.json()
        except Exception:
            return {"success": False, "error": "Invalid JSON request"}

        sending_mode = request_data.get("sending_mode", "turbo")
        campaign_id  = request_data.get("campaignId", f"campaign_{int(time.time())}")

        projects_raw = request_data.get("projects")
        project_id   = request_data.get("projectId")
        user_ids_raw = request_data.get("userIds")
        if project_id and user_ids_raw:
            projects_raw = [{"projectId": project_id, "userIds": user_ids_raw}]
        if not projects_raw or not isinstance(projects_raw, list):
            return {"success": False, "error": "No projects provided"}

        logger.info(f"⚡ Campaign {campaign_id} | mode={sending_mode.upper()} | {len(projects_raw)} project(s)")

        # ── Throttle config ───────────────────────────────────────────────
        throttle_config = request_data.get("throttle_config") or {}
        delay_ms = float(throttle_config.get("delay_ms") or throttle_config.get("delayMs") or 0)
        if delay_ms <= 0 and sending_mode == "throttled":
            eps = float(throttle_config.get("emails_per_ms") or throttle_config.get("emailsPerMs") or 0)
            delay_ms = (1.0 / eps) if eps > 0 else 10.0

        # ── Redis helpers ─────────────────────────────────────────────────
        redis_url = os.getenv("REDIS_URL", "redis://localhost:6379/0")
        _r = redis.Redis.from_url(redis_url, decode_responses=True)

        def _ctrl():
            return _r.get(f"campaign:{campaign_id}:control")

        def _flush(proj_id, ok, fail):
            if ok == 0 and fail == 0:
                return
            key = f"campaign:{campaign_id}:{proj_id}:stats"
            pipe = _r.pipeline()
            pipe.hincrby(key, "processed", ok + fail)
            if ok:   pipe.hincrby(key, "successful", ok)
            if fail: pipe.hincrby(key, "failed",     fail)
            pipe.expire(key, 86400)
            pipe.execute()

        # ── UID → email resolution (sync, in thread executor) ────────────
        def _resolve(proj_id, uid_list):
            app_obj = firebase_apps.get(proj_id)
            if not app_obj:
                logger.warning(f"[{proj_id}] No firebase app initialised")
                return {}
            result = {}
            for i in range(0, len(uid_list), 100):
                chunk = uid_list[i:i+100]
                try:
                    ids = [auth.UidIdentifier(u) for u in chunk]
                    res = auth.get_users(ids, app=app_obj)
                    for u in res.users:
                        if u.email:
                            result[u.uid] = u.email
                except Exception as ex:
                    logger.warning(f"[{proj_id}] batch lookup err: {ex}")
                    for uid in chunk:
                        try:
                            u = auth.get_user(uid, app=app_obj)
                            if u.email:
                                result[u.uid] = u.email
                        except Exception:
                            pass
            return result

        # ── Async REST sender (no pyrebase, fully async) ─────────────────
        async def _send_one(session, api_key, email, proj_id):
            url = (
                "https://identitytoolkit.googleapis.com/v1/"
                f"accounts:sendOobCode?key={api_key}"
            )
            try:
                async with session.post(
                    url, json={"requestType": "PASSWORD_RESET", "email": email},
                    timeout=aiohttp.ClientTimeout(total=15)
                ) as resp:
                    return resp.status == 200
            except Exception as ex:
                logger.debug(f"[{proj_id}] send err {email}: {ex}")
                return False

        # ── Build project metadata + resolve emails in parallel ──────────
        loop = asyncio.get_event_loop()
        proj_meta = {}
        for proj in projects_raw:
            p_id = str(proj.get("projectId", ""))
            u_ids = proj.get("userIds", [])
            if not u_ids or not p_id:
                continue
            info = projects.get(p_id) or {}
            api_key = (info.get("apiKey") or info.get("api_key") or
                       proj.get("apiKey") or proj.get("api_key") or "")
            proj_meta[p_id] = {"api_key": api_key, "uid_list": u_ids}

        if not proj_meta:
            return {"success": False, "error": "No valid projects found"}

        # Resolve UIDs for all projects concurrently
        resolve_coros = {
            p_id: loop.run_in_executor(None, _resolve, p_id, meta["uid_list"])
            for p_id, meta in proj_meta.items()
        }
        resolved = {}
        for p_id, coro in resolve_coros.items():
            uid_email = await coro
            resolved[p_id] = [(uid, email) for uid, email in uid_email.items()]
            unresolved = len(proj_meta[p_id]["uid_list"]) - len(resolved[p_id])
            if unresolved:
                _flush(p_id, 0, unresolved)
            logger.info(f"[{p_id}] Resolved {len(resolved[p_id])}/{len(proj_meta[p_id]['uid_list'])} emails")

        total_users = sum(len(v) for v in resolved.values())
        if total_users == 0:
            return {"success": False, "error": "No emails resolved from UIDs"}

        # ==================================================================
        # TURBO: all emails for all projects fired simultaneously
        # ==================================================================
        if sending_mode == "turbo":
            logger.info(f"🚀 [TURBO] {total_users} emails → all concurrent")
            sem = asyncio.Semaphore(300)
            stats = {p: [0, 0] for p in resolved}  # [ok, fail]

            async def _do_turbo(proj_id, uid, email, api_key, session):
                sig = _ctrl()
                if sig == "stop":
                    return
                while sig == "pause":
                    await asyncio.sleep(0.5)
                    sig = _ctrl()
                if sig == "stop":
                    return
                async with sem:
                    ok = await _send_one(session, api_key, email, proj_id)
                s = stats[proj_id]
                if ok:
                    s[0] += 1
                else:
                    s[1] += 1
                if (s[0]+s[1]) % 25 == 0:
                    _flush(proj_id, s[0], s[1])
                    stats[proj_id] = [0, 0]

            connector = aiohttp.TCPConnector(limit=300, limit_per_host=100)
            async with aiohttp.ClientSession(connector=connector) as session:
                coros = []
                for p_id, pairs in resolved.items():
                    api_key = proj_meta[p_id]["api_key"]
                    for uid, email in pairs:
                        coros.append(_do_turbo(p_id, uid, email, api_key, session))
                await asyncio.gather(*coros, return_exceptions=True)

            for p_id in stats:
                _flush(p_id, stats[p_id][0], stats[p_id][1])

            grand_ok   = sum(int(_r.hget(f"campaign:{campaign_id}:{p}:stats", "successful") or 0) for p in resolved)
            grand_fail = sum(int(_r.hget(f"campaign:{campaign_id}:{p}:stats", "failed")     or 0) for p in resolved)

            if campaign_id in active_campaigns:
                active_campaigns[campaign_id].update({
                    "status": "completed", "processed": total_users,
                    "successful": grand_ok, "failed": grand_fail,
                    "completedAt": datetime.now().isoformat()
                })
                save_campaigns_to_file()

            return {
                "success": True, "mode": "turbo", "campaignId": campaign_id,
                "total": total_users, "successful": grand_ok, "failed": grand_fail,
                "message": f"Turbo done: {grand_ok} sent, {grand_fail} failed out of {total_users}"
            }

        # ==================================================================
        # THROTTLED: each project runs concurrently, ms delay between emails
        # ==================================================================
        elif sending_mode == "throttled":
            delay_s = delay_ms / 1000.0 if delay_ms > 0 else 0.01
            logger.info(f"⚙️ [THROTTLE] {1.0/delay_s:.1f} emails/sec (delay={delay_ms}ms) | {len(resolved)} project(s) in parallel")

            async def _throttle_project(proj_id, pairs, api_key, session):
                ok = fail = 0
                for uid, email in pairs:
                    sig = _ctrl()
                    if sig == "stop":
                        break
                    while sig == "pause":
                        await asyncio.sleep(0.5)
                        sig = _ctrl()
                    if sig == "stop":
                        break
                    sent = await _send_one(session, api_key, email, proj_id)
                    if sent:
                        ok += 1
                    else:
                        fail += 1
                    if (ok + fail) % 10 == 0:
                        _flush(proj_id, ok, fail)
                        ok = fail = 0
                    await asyncio.sleep(delay_s)
                if ok or fail:
                    _flush(proj_id, ok, fail)

            connector = aiohttp.TCPConnector(limit=50)
            async with aiohttp.ClientSession(connector=connector) as session:
                await asyncio.gather(*[
                    _throttle_project(p_id, pairs, proj_meta[p_id]["api_key"], session)
                    for p_id, pairs in resolved.items()
                ], return_exceptions=True)

            if campaign_id in active_campaigns:
                active_campaigns[campaign_id]["status"] = "completed"
                active_campaigns[campaign_id]["completedAt"] = datetime.now().isoformat()
                save_campaigns_to_file()

            return {
                "success": True, "mode": "throttled", "campaignId": campaign_id,
                "rate": f"{1.0/delay_s:.1f} emails/sec", "total": total_users,
                "message": f"Throttled send complete at {1.0/delay_s:.1f}/sec"
            }

        # ==================================================================
        # SCHEDULED — store in Redis, fire via APScheduler
        # ==================================================================
        elif sending_mode == "scheduled":
            schedule_config = request_data.get("schedule_config", {})
            scheduled_datetime_str = schedule_config.get("scheduled_datetime")
            execution_mode = schedule_config.get("execution_mode", "turbo")
            if not scheduled_datetime_str:
                return {"success": False, "error": "No scheduled_datetime provided"}
            try:
                scheduled_dt = datetime.fromisoformat(scheduled_datetime_str.replace("Z", "+00:00"))
            except Exception as e:
                return {"success": False, "error": f"Invalid datetime: {e}"}
            if scheduled_dt <= datetime.now(timezone.utc):
                return {"success": False, "error": "Scheduled time must be in the future"}

            _r.set(
                f"scheduled_campaign:{campaign_id}",
                json.dumps({
                    "campaign_id": campaign_id, "projects": projects_raw,
                    "execution_mode": execution_mode, "throttle_config": throttle_config,
                    "batch_size": request_data.get("batchSize", 100),
                    "scheduled_datetime": scheduled_datetime_str,
                    "created_at": datetime.now().isoformat()
                }),
                ex=int((scheduled_dt - datetime.now(timezone.utc)).total_seconds()) + 3600
            )
            if SCHEDULER_AVAILABLE:
                scheduler = get_scheduler()
                try:
                    from src.utils.celery_tasks import execute_scheduled_campaign
                except ImportError:
                    from celery_tasks import execute_scheduled_campaign
                scheduler.add_job(
                    execute_scheduled_campaign.delay,
                    DateTrigger(run_date=scheduled_dt),
                    args=[campaign_id], id=f"campaign_{campaign_id}", replace_existing=True
                )
            if campaign_id in active_campaigns:
                active_campaigns[campaign_id]["status"] = "scheduled"
                active_campaigns[campaign_id]["scheduledAt"] = scheduled_datetime_str
                save_campaigns_to_file()
            return {
                "success": True, "mode": "scheduled", "campaign_id": campaign_id,
                "scheduled_datetime": scheduled_datetime_str,
                "message": f"Scheduled for {scheduled_dt}"
            }

        else:
            return {"success": False, "error": f"Invalid sending_mode: {sending_mode}"}

    except Exception as e:
        logger.error(f"send_campaign failed: {e}")
        return {"success": False, "error": str(e)}

'''

# ─── 2. HELPER: load campaign from active_campaigns or file ──────────────────
LOAD_CAMPAIGN_HELPER = '''
def _get_campaign(campaign_id: str):
    """Load campaign from active_campaigns memory OR file (persistence-safe)."""
    if campaign_id in active_campaigns:
        return active_campaigns[campaign_id]
    # Fallback: search in campaigns file
    all_campaigns = load_campaigns_from_file() or []
    for c in all_campaigns:
        if c.get("id") == campaign_id:
            active_campaigns[campaign_id] = c  # re-hydrate memory
            return c
    return None

'''

# ─── Apply patches ────────────────────────────────────────────────────────────

# Patch 1: replace send_campaign function
new_lines = lines[:sc_start] + [NEW_SEND_CAMPAIGN + "\n"] + lines[sc_end:]
print(f"Replaced send_campaign ({sc_end-sc_start} lines → new block)")

# Patch 2: inject _get_campaign helper just before @app.post("/campaigns/send")
sc_start2 = None
for i, ln in enumerate(new_lines):
    if '"/campaigns/send"' in ln and '@app.post' in ln:
        sc_start2 = i
        break
if sc_start2:
    new_lines = new_lines[:sc_start2] + [LOAD_CAMPAIGN_HELPER + "\n"] + new_lines[sc_start2:]
    print(f"Injected _get_campaign helper at line {sc_start2}")

# Patch 3: Fix update_campaign to use _get_campaign instead of active_campaigns lookup
content = "".join(new_lines)

# Replace `if campaign_id not in active_campaigns:\n        raise HTTPException(status_code=404, detail="Campaign not found")\n    \n    campaign = active_campaigns[campaign_id]`
# inside update_campaign function
def fix_update(content):
    # Target the update_campaign function body
    old = (
        '    """Update campaign settings"""\n'
        '    if campaign_id not in active_campaigns:\n'
        '        raise HTTPException(status_code=404, detail="Campaign not found")\n'
        '    \n'
        '    campaign = active_campaigns[campaign_id]\n'
        '    \n'
        '    if campaign["status"] == "running":'
    )
    new = (
        '    """Update campaign settings"""\n'
        '    campaign = _get_campaign(campaign_id)\n'
        '    if not campaign:\n'
        '        raise HTTPException(status_code=404, detail="Campaign not found")\n'
        '    if campaign["status"] == "running":'
    )
    return content.replace(old, new, 1)

def fix_delete(content):
    old = (
        '    """Delete a campaign"""\n'
        '    if campaign_id not in active_campaigns:\n'
        '        raise HTTPException(status_code=404, detail="Campaign not found")\n'
        '    \n'
        '    campaign = active_campaigns[campaign_id]\n'
        '    \n'
        '    if campaign["status"] == "running":\n'
        '        raise HTTPException(status_code=400, detail="Cannot delete running campaign")'
    )
    new = (
        '    """Delete a campaign"""\n'
        '    campaign = _get_campaign(campaign_id)\n'
        '    if not campaign:\n'
        '        raise HTTPException(status_code=404, detail="Campaign not found")\n'
        '    if campaign["status"] == "running":\n'
        '        raise HTTPException(status_code=400, detail="Cannot delete running campaign")'
    )
    return content.replace(old, new, 1)

def fix_pause_stop(content):
    # Fix pause
    old_pause = (
        '    try:\n'
        '        r = _get_ctrl_redis()\n'
        '        r.set(f"campaign:{campaign_id}:control", "pause", ex=86400)\n'
        '        # Update in-memory status\n'
        '        if campaign_id in active_campaigns:\n'
        '            active_campaigns[campaign_id][\'status\'] = \'paused\'\n'
        "        logger.info(f\"⏸️ Campaign {campaign_id} paused\")\n"
        '        return {"success": True, "status": "paused", "campaign_id": campaign_id}\n'
    )
    new_pause = (
        '    try:\n'
        '        campaign = _get_campaign(campaign_id)\n'
        '        if not campaign:\n'
        '            raise HTTPException(status_code=404, detail="Campaign not found")\n'
        '        r = _get_ctrl_redis()\n'
        '        r.set(f"campaign:{campaign_id}:control", "pause", ex=86400)\n'
        '        campaign["status"] = "paused"\n'
        '        active_campaigns[campaign_id] = campaign\n'
        '        save_campaigns_to_file()\n'
        "        logger.info(f\"⏸️ Campaign {campaign_id} paused\")\n"
        '        return {"success": True, "status": "paused", "campaign_id": campaign_id}\n'
    )
    content = content.replace(old_pause, new_pause, 1)

    # Fix resume
    old_resume = (
        '    try:\n'
        '        r = _get_ctrl_redis()\n'
        '        r.delete(f"campaign:{campaign_id}:control")\n'
        '        if campaign_id in active_campaigns:\n'
        "            active_campaigns[campaign_id]['status'] = 'running'\n"
        "        logger.info(f\"▶️ Campaign {campaign_id} resumed\")\n"
        '        return {"success": True, "status": "running", "campaign_id": campaign_id}\n'
    )
    new_resume = (
        '    try:\n'
        '        campaign = _get_campaign(campaign_id)\n'
        '        if not campaign:\n'
        '            raise HTTPException(status_code=404, detail="Campaign not found")\n'
        '        r = _get_ctrl_redis()\n'
        '        r.delete(f"campaign:{campaign_id}:control")\n'
        '        campaign["status"] = "running"\n'
        '        active_campaigns[campaign_id] = campaign\n'
        '        save_campaigns_to_file()\n'
        "        logger.info(f\"▶️ Campaign {campaign_id} resumed\")\n"
        '        return {"success": True, "status": "running", "campaign_id": campaign_id}\n'
    )
    content = content.replace(old_resume, new_resume, 1)

    # Fix stop
    old_stop = (
        '    try:\n'
        '        r = _get_ctrl_redis()\n'
        '        r.set(f"campaign:{campaign_id}:control", "stop", ex=86400)\n'
        '        if campaign_id in active_campaigns:\n'
        "            active_campaigns[campaign_id]['status'] = 'stopped'\n"
        '        # Also update in campaigns store\n'
        '        if campaign_id in campaigns:\n'
        "            campaigns[campaign_id]['status'] = 'stopped'\n"
        "        logger.info(f\"⏹️ Campaign {campaign_id} stopped\")\n"
        '        return {"success": True, "status": "stopped", "campaign_id": campaign_id}\n'
    )
    new_stop = (
        '    try:\n'
        '        campaign = _get_campaign(campaign_id)\n'
        '        if not campaign:\n'
        '            raise HTTPException(status_code=404, detail="Campaign not found")\n'
        '        r = _get_ctrl_redis()\n'
        '        r.set(f"campaign:{campaign_id}:control", "stop", ex=86400)\n'
        '        campaign["status"] = "stopped"\n'
        '        active_campaigns[campaign_id] = campaign\n'
        '        save_campaigns_to_file()\n'
        "        logger.info(f\"⏹️ Campaign {campaign_id} stopped\")\n"
        '        return {"success": True, "status": "stopped", "campaign_id": campaign_id}\n'
    )
    content = content.replace(old_stop, new_stop, 1)
    return content

content = fix_update(content)
content = fix_delete(content)
content = fix_pause_stop(content)

with open(FILE, 'w', encoding='utf-8') as f:
    f.write(content)

print(f"✅ Patch applied. Total lines: {content.count(chr(10))}")
