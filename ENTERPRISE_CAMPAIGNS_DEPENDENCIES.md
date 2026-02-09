# Enterprise Campaign Management - Dependencies

## New Python Dependencies

### APScheduler
- **Version**: Latest (automatically installed via requirements.txt)
- **Purpose**: Powers the Scheduled Campaign mode
- **Features Used**:
  - `AsyncIOScheduler`: Async/await compatible scheduler
  - `DateTrigger`: Schedule campaigns for specific datetime execution
  - Automatic job execution at scheduled times

### Installation

**During deployment (via update_server.sh):**
```bash
./update_server.sh
```

**Manual installation:**
```bash
pip install apscheduler
```

**Verify installation:**
```bash
python -c "import apscheduler; print(apscheduler.__version__)"
```

## Existing Dependencies (No changes needed)

All other dependencies remain the same:
- FastAPI + Uvicorn (web framework)
- Firebase Admin + Pyrebase4 (Firebase integration)
- PostgreSQL drivers (database)
- Python-dotenv (environment variables)

## Frontend (No new dependencies)

The new `SendingModeSelector` component uses existing React dependencies:
- Lucide React (icons - already installed)
- shadcn/ui components (already installed)
- TypeScript (already configured)

## Update Process

1. **Pull latest code:**
   ```bash
   git pull origin main
   ```

2. **Run update script:**
   ```bash
   sudo ./update_server.sh
   ```

3. **Verify service:**
   ```bash
   systemctl status firebase-manager
   ```

The update script automatically:
- Installs APScheduler from requirements.txt
- Rebuilds the frontend
- Restarts the backend service

## Production Checklist

- [x] APScheduler added to requirements.txt
- [x] update_server.sh documented
- [x] Backend imports APScheduler conditionally (graceful fallback if not installed)
- [x] Frontend has no additional dependencies
- [ ] Test scheduled campaign on production server
