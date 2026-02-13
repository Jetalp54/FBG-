# ============================================================================
# DATA LIST MANAGEMENT ENDPOINTS
# ============================================================================

@app.post("/data-lists")
async def create_data_list(data_list: DataListCreate, request: Request):
    """Create a new data list with metadata"""
    try:
        current_user = get_current_user_from_request(request)
        list_id = str(uuid.uuid4())
        
        # Validate emails
        valid_emails = [email.strip() for email in data_list.emails if email.strip() and '@' in email]
        
        list_data = {
            "id": list_id,
            "name": data_list.name,
            "isp": data_list.isp,
            "geo": data_list.geo,
            "status": data_list.status,
            "email_count": len(valid_emails),
            "emails": valid_emails,
            "created_at": datetime.now().isoformat(),
            "uploaded_by": current_user
        }
        
        data_lists[list_id] = list_data
        save_data_lists_to_file()
        
        logger.info(f"Created data list {list_id} with {len(valid_emails)} emails by {current_user}")
        
        return {
            "success": True,
            "list_id": list_id,
            "email_count": len(valid_emails)
        }
        
    except Exception as e:
        logger.error(f"Failed to create data list: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to create data list: {str(e)}")

@app.get("/data-lists")
async def list_data_lists(
    request: Request,
    isp: Optional[str] = None,
    geo: Optional[str] = None,
    status: Optional[str] = None
):
    """List all data lists with optional filtering"""
    try:
        current_user = get_current_user_from_request(request)
        
        # Get all lists
        lists = list(data_lists.values())
        
        # Apply filters
        if isp:
            lists = [l for l in lists if l.get('isp') == isp]
        if geo:
            lists = [l for l in lists if l.get('geo') == geo]
        if status:
            lists = [l for l in lists if l.get('status') == status]
        
        # Remove email arrays from response for performance (only metadata)
        lists_meta = []
        for l in lists:
            meta = {k: v for k, v in l.items() if k != 'emails'}
            lists_meta.append(meta)
        
        return {
            "success": True,
            "data_lists": lists_meta,
            "total": len(lists_meta)
        }
        
    except Exception as e:
        logger.error(f"Failed to list data lists: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to list data lists: {str(e)}")

@app.get("/data-lists/{list_id}")
async def get_data_list(list_id: str):
    """Get a specific data list by ID"""
    if list_id not in data_lists:
        raise HTTPException(status_code=404, detail="Data list not found")
    
    return {
        "success": True,
        "data_list": data_lists[list_id]
    }

@app.delete("/data-lists/{list_id}")
async def delete_data_list(list_id: str):
    """Delete a data list"""
    if list_id not in data_lists:
        raise HTTPException(status_code=404, detail="Data list not found")
    
    del data_lists[list_id]
    save_data_lists_to_file()
    
    return {
        "success": True,
        "message": "Data list deleted successfully"
    }

@app.post("/data-lists/{list_id}/distribute")
async def distribute_data_list(list_id: str, distribute: DataListDistribute):
    """Distribute email list across selected projects"""
    try:
        # Validate list exists
        if list_id not in data_lists:
            raise HTTPException(status_code=404, detail="Data list not found")
        
        data_list = data_lists[list_id]
        emails = data_list.get('emails', [])
        project_ids = distribute.projectIds
        
        if not project_ids:
            raise HTTPException(status_code=400, detail="No projects selected")
        
        if not emails:
            raise HTTPException(status_code=400, detail="Data list is empty")
        
        # Split emails equally across projects
        emails_per_project = len(emails) // len(project_ids)
        remainder = len(emails) % len(project_ids)
        
        distribution_results = []
        start_idx = 0
        
        for i, project_id in enumerate(project_ids):
            # Calculate chunk size (distribute remainder)
            chunk_size = emails_per_project + (1 if i < remainder else 0)
            email_chunk = emails[start_idx:start_idx + chunk_size]
            start_idx += chunk_size
            
            # Import to Firebase Auth
            if project_id not in firebase_apps:
                distribution_results.append({
                    "project_id": project_id,
                    "success": False,
                    "error": "Project not initialized",
                    "imported": 0
                })
                continue
            
            try:
                app = firebase_apps[project_id]
                imported = 0
                failed = 0
                
                # Import in batches of 1000 (Firebase limit)
                batch_size = 1000
                for j in range(0, len(email_chunk), batch_size):
                    batch_emails = email_chunk[j:j + batch_size]
                    batch_users = []
                    
                    for email in batch_emails:
                        uid = hashlib.md5(email.encode()).hexdigest()[:28]  # Valid UID
                        user_record = auth.ImportUserRecord(email=email, uid=uid)
                        batch_users.append(user_record)
                    
                    try:
                        result = auth.import_users(batch_users, app=app)
                        imported += result.success_count
                        failed += result.failure_count
                    except Exception as batch_error:
                        logger.error(f"Batch import failed for {project_id}: {batch_error}")
                        failed += len(batch_users)
                
                distribution_results.append({
                    "project_id": project_id,
                    "success": True,
                    "imported": imported,
                    "failed": failed,
                    "total": len(email_chunk)
                })
                
                logger.info(f"Distributed {imported} emails to {project_id}")
                
            except Exception as project_error:
                logger.error(f"Failed to distribute to {project_id}: {project_error}")
                distribution_results.append({
                    "project_id": project_id,
                    "success": False,
                    "error": str(project_error),
                    "imported": 0
                })
        
        total_imported = sum(r.get('imported', 0) for r in distribution_results)
        
        return {
            "success": True,
            "total_emails": len(emails),
            "total_imported": total_imported,
            "projects_count": len(project_ids),
            "results": distribution_results
        }
        
    except HTTPException as he:
        raise he
    except Exception as e:
        logger.error(f"Failed to distribute data list: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to distribute data list: {str(e)}")

