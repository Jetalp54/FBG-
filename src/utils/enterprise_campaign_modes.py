# ============================================================================
# ENTERPRISE CAMPAIGN SENDING - THREE MODES
# ============================================================================

async def fire_all_emails_turbo(project_id, user_ids, campaign_id, app_name=None):
    """
    TURBO MODE - Maximum speed using all available resources
    - Uses CPU count * 6 workers for maximum parallelism
    - No delays between operations
    - Aggressive batch sizes (100-200 emails per batch)
    - No rate limiting
    """
    import concurrent.futures
    
    # Ensure all IDs are strings
    project_id = str(project_id) if project_id is not None else ''
    campaign_id = str(campaign_id) if campaign_id is not None else ''
    user_ids = [str(uid) for uid in user_ids if uid is not None]
    
    logger.info(f"🚀 [TURBO] [{project_id}] Starting Turbo mode: {len(user_ids)} users")
    
    # Get Firebase apps
    if project_id not in firebase_apps or project_id not in pyrebase_apps:
        logger.error(f"[{project_id}] Project not found in firebase_apps")
        return 0
    
    firebase_app = firebase_apps[project_id]
    pyrebase_app = pyrebase_apps[project_id]
    pyrebase_auth = pyrebase_app.auth()
    
    # Get user emails
    user_emails = {}
    try:
        for uid in user_ids:
            try:
                user = auth.get_user(uid, app=firebase_app)
                if uid and user.email:
                    user_emails[str(uid)] = str(user.email)
            except Exception as e:
                logger.error(f"[{project_id}] Failed to get user {uid}: {e}")
                continue
    except Exception as e:
        logger.error(f"[{project_id}] Failed to get user emails: {e}")
    
    email_list = list(user_emails.values())
    logger.info(f"[{project_id}] Found {len(email_list)} valid emails")
    
    # TURBO: Maximum workers (CPU * 6)
    cpu_count = os.cpu_count() or 1
    max_workers = min(cpu_count * 6, 100)  # Cap at 100 for safety
    
    logger.info(f"🔥 [TURBO] Using {max_workers} workers for maximum speed")
    
    # Create campaign tracking
    create_campaign_result(campaign_id, project_id, len(user_emails))
    
    def fire_email(email):
        user_id = None
        for uid, em in user_emails.items():
            if em == email:
                user_id = uid
                break
        
        try:
            pyrebase_auth.send_password_reset_email(str(email))
            logger.debug(f"[{project_id}] Sent to {email}")
            update_campaign_result(campaign_id, project_id, True, user_id=user_id, email=email)
            return True
        except Exception as e:
            logger.error(f"[{project_id}] Failed to send to {email}: {str(e)}")
            update_campaign_result(campaign_id, project_id, False, user_id=user_id, email=email, error=str(e))
            return False
    
    # Process all emails with maximum parallelism
    successful_sends = 0
    email_list = [e for e in email_list if e]
    
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_to_email = {executor.submit(fire_email, email): email for email in email_list}
        
        for future in concurrent.futures.as_completed(future_to_email):
            try:
                result = future.result()
                if result:
                    successful_sends += 1
            except Exception as e:
                logger.error(f"[{project_id}] Exception: {e}")
    
    logger.info(f"✅ [TURBO] [{project_id}] Completed: {successful_sends}/{len(email_list)} sent")
    
    increment_daily_count(project_id)
    write_audit_log('system', 'send_campaign_turbo', {
        'campaign_id': campaign_id,
        'project_id': project_id,
        'workers': max_workers,
        'emails_sent': successful_sends,
        'total_emails': len(email_list)
    })
    
    return successful_sends


async def fire_all_emails_throttled(project_id, user_ids, campaign_id, throttle_config, app_name=None):
    """
    THROTTLED MODE - Rate-limited sending for ISP compliance
    - Millisecond-based rate limiting using token bucket algorithm
    - Controlled worker count
    - Gradual processing to respect rate limits
    
    throttle_config example:
    {
        "emails_per_ms": 0.01,  # 10 emails per second
        "burst_capacity": 50,    # Max burst
        "workers": 5             # Parallel workers
    }
    """
    import concurrent.futures
    
    # Ensure all IDs are strings
    project_id = str(project_id) if project_id is not None else ''
    campaign_id = str(campaign_id) if campaign_id is not None else ''
    user_ids = [str(uid) for uid in user_ids if uid is not None]
    
    # Extract throttle configuration
    emails_per_ms = throttle_config.get('emails_per_ms', 0.01)  # Default: 10/second
    burst_capacity = throttle_config.get('burst_capacity', 50)
    workers = throttle_config.get('workers', 5)
    
    logger.info(f"⚙️ [THROTTLED] [{project_id}] Starting Throttled mode: {len(user_ids)} users, rate={emails_per_ms} emails/ms")
    
    # Get Firebase apps
    if project_id not in firebase_apps or project_id not in pyrebase_apps:
        logger.error(f"[{project_id}] Project not found in firebase_apps")
        return 0
    
    firebase_app = firebase_apps[project_id]
    pyrebase_app = pyrebase_apps[project_id]
    pyrebase_auth = pyrebase_app.auth()
    
    # Initialize rate limiter
    rate_limiter = TokenBucketRateLimiter(
        rate_per_ms=emails_per_ms,
        burst_capacity=burst_capacity
    )
    
    # Get user emails
    user_emails = {}
    try:
        for uid in user_ids:
            try:
                user = auth.get_user(uid, app=firebase_app)
                if uid and user.email:
                    user_emails[str(uid)] = str(user.email)
            except Exception as e:
                logger.error(f"[{project_id}] Failed to get user {uid}: {e}")
                continue
    except Exception as e:
        logger.error(f"[{project_id}] Failed to get user emails: {e}")
    
    email_list = list(user_emails.values())
    logger.info(f"[{project_id}] Found {len(email_list)} valid emails")
    
    # Create campaign tracking
    create_campaign_result(campaign_id, project_id, len(user_emails))
    
    async def fire_email_with_limit(email):
        user_id = None
        for uid, em in user_emails.items():
            if em == email:
                user_id = uid
                break
        
        # Acquire token from rate limiter
        wait_time = await rate_limiter.acquire(1)
        if wait_time > 0:
            logger.debug(f"[THROTTLED] Waited {wait_time:.3f}s for rate limit")
        
        try:
            # Execute in thread pool to avoid blocking
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, pyrebase_auth.send_password_reset_email, str(email))
            logger.debug(f"[{project_id}] Sent to {email}")
            update_campaign_result(campaign_id, project_id, True, user_id=user_id, email=email)
            return True
        except Exception as e:
            logger.error(f"[{project_id}] Failed to send to {email}: {str(e)}")
            update_campaign_result(campaign_id, project_id, False, user_id=user_id, email=email, error=str(e))
            return False
    
    # Process emails with rate limiting
    successful_sends = 0
    email_list = [e for e in email_list if e]
    
    # Use controlled parallelism with rate limiting
    tasks = [fire_email_with_limit(email) for email in email_list]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    
    successful_sends = sum(1 for r in results if r is True)
    
    logger.info(f"✅ [THROTTLED] [{project_id}] Completed: {successful_sends}/{len(email_list)} sent")
    
    increment_daily_count(project_id)
    write_audit_log('system', 'send_campaign_throttled', {
        'campaign_id': campaign_id,
        'project_id': project_id,
        'rate_limit': emails_per_ms,
        'emails_sent': successful_sends,
        'total_emails': len(email_list)
    })
    
    return successful_sends


async def execute_scheduled_campaign(campaign_id: str):
    """
    Execute a scheduled campaign at the configured time
    """
    try:
        if campaign_id not in scheduled_campaigns:
            logger.error(f"Scheduled campaign {campaign_id} not found")
            return
        
        campaign_data = scheduled_campaigns[campaign_id]
        logger.info(f"📅 [SCHEDULED] Executing campaign {campaign_id} at scheduled time")
        
        # Update campaign status
        if campaign_id in active_campaigns:
            active_campaigns[campaign_id]['status'] = 'running'
            active_campaigns[campaign_id]['executedAt'] = datetime.now().isoformat()
        
        # Get execution mode from schedule config
        execution_mode = campaign_data.get('execution_mode', 'turbo')
        
        # Execute based on mode
        if execution_mode == 'throttled':
            throttle_config = campaign_data.get('throttle_config', {})
            # Execute throttled mode
            for proj_id, user_ids in campaign_data.get('selectedUsers', {}).items():
                await fire_all_emails_throttled(proj_id, user_ids, campaign_id, throttle_config)
        else:
            # Execute turbo mode
            for proj_id, user_ids in campaign_data.get('selectedUsers', {}).items():
                await fire_all_emails_turbo(proj_id, user_ids, campaign_id)
        
        # Update campaign status
        if campaign_id in active_campaigns:
            active_campaigns[campaign_id]['status'] = 'completed'
            save_campaigns_to_file()
        
        # Remove from scheduled campaigns
        if campaign_id in scheduled_campaigns:
            del scheduled_campaigns[campaign_id]
        
        logger.info(f"✅ [SCHEDULED] Campaign {campaign_id} completed successfully")
        
    except Exception as e:
        logger.error(f"Failed to execute scheduled campaign {campaign_id}: {e}")
        if campaign_id in active_campaigns:
            active_campaigns[campaign_id]['status'] = 'failed'
            save_campaigns_to_file()

