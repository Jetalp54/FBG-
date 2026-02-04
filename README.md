
# FireReset Pro - Firebase Password Reset Campaign Manager

A professional, CRM-grade SaaS application for managing password reset email campaigns across multiple Firebase projects.

## 🚀 Features

- **Multi-Project Management**: Manage multiple Firebase projects as email sending servers
- **Parallel Email Sending**: Send password reset emails to users across projects simultaneously
- **HTML Template Editor**: Built-in rich text editor for customizing reset email templates
- **Advanced Campaign Control**: Full control over workers, batch sizes, and user selection
- **Real-time Monitoring**: Live campaign execution monitoring with detailed statistics
- **Professional UI**: Modern, responsive dashboard with dark theme and smooth animations
- **Local File Storage**: Everything stored locally - no external database required
- **Firebase Native**: Uses only Firebase Admin SDK for authentication and email sending

## 🛠️ Tech Stack

- **Frontend**: React + Vite + TypeScript + Tailwind CSS
- **Backend**: FastAPI (Python) - Ready for integration
- **Storage**: Local JSON files only
- **Email**: Firebase Admin SDK (firebase-admin)
- **UI Components**: shadcn/ui
- **State Management**: React Context API

## 📦 Installation & Setup

### Prerequisites
- Node.js & npm installed
- Python 3.8+ (for backend integration)

### Frontend Setup
```bash
# Clone the repository
git clone <repository-url>
cd fireset-pro

# Install dependencies
npm install

# Start the development server
npm run dev
```

The application will be available at `http://localhost:8080`

### Backend Setup (Coming Soon)
The FastAPI backend integration is ready for implementation. The frontend includes all necessary API integration points.

## 🎯 Usage Guide

### 1. Add Firebase Projects
- Navigate to "Firebase Projects" in the sidebar
- Click "Add Project"
- Enter project name and admin email
- Upload your Firebase service account JSON file

### 2. Load Users
- Go to "User Management"
- Select a Firebase project
- Click "Load Users" to fetch users from the project
- Search and select users for campaigns

### 3. Customize Email Templates
- Visit "Email Templates"
- Select a project
- Edit the HTML template using the built-in editor
- Use `{{reset_link}}` placeholder for the reset link
- Preview your changes in real-time

### 4. Create & Run Campaigns
- Navigate to "Campaigns"
- Click "New Campaign"
- Select projects and users
- Configure workers and batch size
- Create and start the campaign
- Monitor progress in real-time

## 📁 File Structure

```
src/
├── components/           # React components
│   ├── Dashboard.tsx    # Main dashboard
│   ├── ProjectsPage.tsx # Firebase project management
│   ├── UsersPage.tsx    # User selection and management
│   ├── TemplatesPage.tsx# HTML email template editor
│   ├── CampaignsPage.tsx# Campaign creation and monitoring
│   └── Sidebar.tsx      # Navigation sidebar
├── contexts/            # React context providers
│   └── AppContext.tsx   # Main application state
├── hooks/               # Custom React hooks
├── lib/                 # Utility functions
└── pages/               # Page components
```

## 🔧 Configuration

### Firebase Service Account
Upload your Firebase service account JSON file when adding a project. The file should include:
- `project_id`: Your Firebase project ID
- `private_key`: Service account private key
- `client_email`: Service account email
- Other Firebase configuration fields

### Email Templates
Default template includes:
- Responsive HTML structure
- `{{reset_link}}` placeholder
- Professional styling

Customize templates per project in the Templates section.

## 🎨 Design System

- **Color Scheme**: Dark theme with purple/blue accents
- **Typography**: System fonts with proper hierarchy
- **Components**: Consistent shadcn/ui components
- **Animations**: Smooth transitions and hover effects
- **Responsive**: Mobile-first design approach

## 📊 Campaign Monitoring

Real-time statistics include:
- Users processed
- Success/failure counts
- Progress percentage
- Worker utilization
- Campaign status

## 🔒 Security Notes

- Service account files are handled securely
- All data stored locally
- No external API dependencies (except Firebase)
- Firebase Admin SDK handles authentication

## 🚧 Roadmap

- [ ] FastAPI backend integration
- [ ] Advanced user filtering
- [ ] Campaign scheduling
- [ ] Email analytics
- [ ] Template library
- [ ] Bulk user import
- [ ] Campaign templates

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License.

## 🆘 Support

For support and questions:
- Check the documentation
- Open an issue on GitHub
- Contact the development team

---

**FireReset Pro** - Professional Firebase password reset campaign management made simple.
