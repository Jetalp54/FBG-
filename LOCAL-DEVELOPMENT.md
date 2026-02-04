# 🖥️ Local Development Guide (Windows)

## **Prerequisites**
- Python 3.8+ installed
- Node.js 16+ installed
- Firebase project with service account

## **🚀 Quick Start**

### **1. Start the Backend (Python/FastAPI)**
```bash
# Navigate to your project directory
cd C:\Users\PC\Desktop\V1_Original

# Install Python dependencies (if not already installed)
pip install fastapi uvicorn firebase-admin pyrebase4 google-cloud-resourcemanager websockets

# Start the backend server
python src/utils/firebaseBackend.py
```

The backend will start on `http://localhost:8000`

### **2. Start the Frontend (React/TypeScript)**
```bash
# In a new terminal window
cd C:\Users\PC\Desktop\V1_Original

# Install dependencies (if not already installed)
npm install

# Start the development server
npm run dev
```

The frontend will start on `http://localhost:5173` (or similar port)

## **🔧 Configuration**

### **Environment Variables**
Create a `.env` file in the root directory:
```env
VITE_API_BASE_URL=http://localhost:8000
VITE_WS_URL=ws://localhost:8000/ws
```

### **Firebase Setup**
1. Place your Firebase service account JSON file in the project root
2. Update the file path in the backend code if needed

## **📝 Troubleshooting**

### **Backend Issues**
- **Port 8000 already in use**: Change the port in `firebaseBackend.py`
- **Firebase connection errors**: Check your service account file
- **Import errors**: Install missing Python packages

### **Frontend Issues**
- **API connection errors**: Ensure backend is running on localhost:8000
- **Build errors**: Run `npm install` to install dependencies
- **Port conflicts**: Vite will automatically find an available port

### **Common Commands**
```bash
# Check if backend is running
curl http://localhost:8000/health

# Check backend logs
# (Look at the terminal where you started the backend)

# Restart backend
# Ctrl+C to stop, then run python src/utils/firebaseBackend.py again

# Restart frontend
# Ctrl+C to stop, then run npm run dev again
```

## **✅ Verification**

1. **Backend Health Check**: Visit `http://localhost:8000/health`
2. **Frontend**: Visit `http://localhost:5173` (or the port shown in terminal)
3. **Profile Creation**: Try creating a profile in the app
4. **Console Logs**: Open browser dev tools (F12) to see API calls

## **🔍 Debugging**

- **Browser Console**: Check for JavaScript errors
- **Network Tab**: Monitor API calls to localhost:8000
- **Backend Terminal**: Watch for Python errors
- **API Logs**: The backend now has detailed logging

## **📁 File Structure**
```
V1_Original/
├── src/
│   ├── utils/firebaseBackend.py  # Backend server
│   ├── components/               # React components
│   └── contexts/                 # React contexts
├── dist/                         # Built frontend
└── .env                          # Environment variables
```

## **🚀 Next Steps**

1. Start the backend: `python src/utils/firebaseBackend.py`
2. Start the frontend: `npm run dev`
3. Open browser to the frontend URL
4. Try creating profiles and projects
5. Check console logs for any errors

**All API calls now point to `localhost:8000` for local development!** 