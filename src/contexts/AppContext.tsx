import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface FirebaseProject {
  id: string;
  name: string;
  adminEmail: string;
  serviceAccount: any;
  apiKey?: string;
  createdAt: string;
  status: 'active' | 'error' | 'loading';
}

interface User {
  uid: string;
  email: string;
  displayName?: string;
  disabled: boolean;
  emailVerified: boolean;
  createdAt?: string;
}

interface Campaign {
  id: string;
  projectIds: string[];
  selectedUsers: { [projectId: string]: string[] };
  workers: number; // Max 55
  batchSize: number; // Document batch size limit if any
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed';
  processed: number;
  successful: number;
  failed: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  currentBatch: number;
  totalBatches: number;
  currentProject: string;
  errors: string[];
}

interface CampaignStats {
  emailsSent: number;
  emailsFailed: number;
  currentProject: string;
  currentBatch: number;
  estimatedTimeRemaining: number;
}

interface AuthContextType {
  authenticated: boolean;
  login: () => void;
  logout: () => void;
}

interface AppContextType {
  projects: FirebaseProject[];
  users: { [projectId: string]: User[] };
  campaigns: Campaign[];
  currentCampaign: Campaign | null;
  campaignStats: CampaignStats | null;
  addProject: (project: Omit<FirebaseProject, 'id' | 'createdAt' | 'status'>) => Promise<void>;
  removeProject: (id: string) => void;
  loadUsers: (projectId: string) => Promise<void>;
  importUsers: (projectId: string, emails: string[]) => Promise<number>;
  deleteAllUsers: (projectId: string) => Promise<void>;
  createCampaign: (campaign: Omit<Campaign, 'id' | 'createdAt' | 'status' | 'processed' | 'successful' | 'failed' | 'currentBatch' | 'totalBatches' | 'currentProject' | 'errors'>) => void;
  startCampaign: (campaignId: string) => Promise<void>;
  pauseCampaign: (campaignId: string) => void;
  resumeCampaign: (campaignId: string) => void;
  templates: { [projectId: string]: string };
  updateTemplate: (projectId: string, template: string) => void;
  testEmailSend: (projectId: string, email: string) => Promise<boolean>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};

// Backend API base URL - supports both local and server deployment
// Flexible API URL that works with both localhost and server IP
const getApiBaseUrl = () => {
  // If environment variable is set, use it
  if (import.meta.env.VITE_API_BASE_URL) {
    return import.meta.env.VITE_API_BASE_URL;
  }
  
  // Check if we're running locally or on server
  const hostname = window.location.hostname;
  
  // If localhost or 127.0.0.1, use localhost
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return 'http://localhost:8000';
  }
  
  // Otherwise, use the current hostname with port 8000
  return `http://${hostname}:8000`;
};

const API_BASE_URL = getApiBaseUrl();

// Enhanced API helper functions
const apiCall = async (endpoint: string, options: RequestInit = {}) => {
  const url = `${API_BASE_URL}${endpoint}`;
  console.log(`🔄 API Call: ${options.method || 'GET'} ${url}`);
  
  try {
    // Get current username for user ownership
    const currentUsername = localStorage.getItem('app-username') || 'admin';
    
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        'X-App-Username': currentUsername, // Send current user for backend filtering
        ...options.headers,
      },
      ...options,
    });
    
    console.log(`✅ API Response: ${response.status} ${response.statusText}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ API Error Response: ${errorText}`);
      throw new Error(`API call failed: ${response.status} ${response.statusText} - ${errorText}`);
    }
    
    const data = await response.json();
    console.log('📦 Response Data:', data);
    return data;
  } catch (error) {
    console.error('💥 API Call Error:', error);
    
    // Provide more specific error messages
    if (error instanceof TypeError && error.message.includes('Failed to fetch')) {
      throw new Error(`Cannot connect to backend at ${API_BASE_URL}. Make sure the backend is running.`);
    }
    
    throw error;
  }
};

export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [projects, setProjects] = useState<FirebaseProject[]>([]);
  const [users, setUsers] = useState<{ [projectId: string]: User[] }>({});
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [currentCampaign, setCurrentCampaign] = useState<Campaign | null>(null);
  const [campaignStats, setCampaignStats] = useState<CampaignStats | null>(null);
  const [templates, setTemplates] = useState<{ [projectId: string]: string }>({});

  // Test backend connection on startup with better error handling
  useEffect(() => {
    const testConnection = async () => {
      try {
        console.log('🔍 Testing backend connection...');
        const response = await apiCall('/health');
        console.log('✅ Backend connection successful:', response);
      } catch (error) {
        console.error('❌ Backend connection failed:', error);
        if (error instanceof Error) {
          if (error.message.includes('Cannot connect to backend')) {
            console.error('🚨 Make sure the backend is running: python src/utils/firebaseBackend.py');
          }
        }
      }
    };
    
    testConnection();
  }, []);

  const addProject = async (projectData: Omit<FirebaseProject, 'id' | 'createdAt' | 'status'>) => {
    console.log('➕ Adding project with data:', projectData);
    
    // Validate service account
    if (!projectData.serviceAccount?.project_id || !projectData.serviceAccount?.client_email) {
      throw new Error('Invalid service account file - missing project_id or client_email');
    }

    const projectId = projectData.serviceAccount.project_id;
    
    const newProject: FirebaseProject = {
      ...projectData,
      id: projectId,
      createdAt: new Date().toISOString(),
      status: 'loading',
    };
    
    setProjects(prev => [...prev, newProject]);
    
    try {
      console.log(`🔥 Adding Firebase project: ${newProject.name} (ID: ${projectId})`);
      
      // Make API call to backend
      const response = await apiCall('/projects', {
        method: 'POST',
        body: JSON.stringify({
          name: projectData.name,
          adminEmail: projectData.adminEmail,
          serviceAccount: projectData.serviceAccount,
          apiKey: projectData.apiKey,
        }),
      });
      
      console.log('✅ Project added successfully:', response);
      
      setProjects(prev => prev.map(p => 
        p.id === projectId ? { ...p, status: 'active' as const } : p
      ));
      
      // Initialize template for new project
      setTemplates(prev => ({
        ...prev,
        [projectId]: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
            <div style="background-color: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
              <h2 style="color: #333; text-align: center; margin-bottom: 20px;">Reset Your Password</h2>
              <p style="color: #666; line-height: 1.6;">We received a request to reset your password. Click the button below to create a new password:</p>
              <div style="text-align: center; margin: 30px 0;">
                <a href="{{reset_link}}" style="background-color: #007cba; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">Reset Password</a>
              </div>
              <p style="color: #666; font-size: 14px; line-height: 1.6;">If you didn't request this reset, please ignore this email. This link will expire in 1 hour for security reasons.</p>
              <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
              <p style="color: #999; font-size: 12px; text-align: center;">This email was sent from ${projectData.name}</p>
            </div>
          </div>
        `
      }));
      
    } catch (error) {
      console.error('❌ Error adding project:', error);
      setProjects(prev => prev.map(p => 
        p.id === projectId ? { ...p, status: 'error' as const } : p
      ));
      throw error;
    }
  };

  const removeProject = async (id: string) => {
    try {
      console.log(`🗑️ Removing project: ${id}`);
      
      await apiCall(`/projects/${id}`, {
        method: 'DELETE',
      });
      
      console.log(`✅ Project ${id} removed successfully`);
      
      setProjects(prev => prev.filter(p => p.id !== id));
      setUsers(prev => {
        const newUsers = { ...prev };
        delete newUsers[id];
        return newUsers;
      });
      setTemplates(prev => {
        const newTemplates = { ...prev };
        delete newTemplates[id];
        return newTemplates;
      });
    } catch (error) {
      console.error('❌ Error removing project:', error);
      throw error;
    }
  };

  const loadUsers = async (projectId: string) => {
    try {
      console.log(`Loading users for project ${projectId}...`);
      
      const response = await apiCall(`/projects/${projectId}/users`);
      
      console.log(`Loaded ${response.users.length} users from Firebase`);
      
      setUsers(prev => ({
        ...prev,
        [projectId]: response.users,
      }));
    } catch (error) {
      console.error('Error loading users:', error);
      throw error;
    }
  };

  const importUsers = async (projectId: string, emails: string[]): Promise<number> => {
    try {
      console.log(`Importing ${emails.length} users to project ${projectId}...`);
      
      const response = await apiCall(`/projects/${projectId}/users/import`, {
        method: 'POST',
        body: JSON.stringify({ emails }),
      });
      
      console.log(`Import completed: ${response.imported} users imported successfully`);
      
      // Reload users after import
      await loadUsers(projectId);
      
      return response.imported;
    } catch (error) {
      console.error('Error importing users:', error);
      throw error;
    }
  };

  const deleteAllUsers = async (projectId: string) => {
    try {
      console.log(`Deleting all users from project ${projectId}...`);
      
      const response = await apiCall(`/projects/${projectId}/users`, {
        method: 'DELETE',
      });
      
      console.log(`Deleted ${response.deleted} users successfully`);
      
      setUsers(prev => ({
        ...prev,
        [projectId]: [],
      }));
      
    } catch (error) {
      console.error('Error deleting users:', error);
      throw error;
    }
  };

  const createCampaign = (campaignData: Omit<Campaign, 'id' | 'createdAt' | 'status' | 'processed' | 'successful' | 'failed' | 'currentBatch' | 'totalBatches' | 'currentProject' | 'errors'>) => {
    const totalUsers = Object.values(campaignData.selectedUsers).reduce((sum, users) => sum + users.length, 0);
    const totalBatches = Math.ceil(totalUsers / campaignData.batchSize);
    
    const newCampaign: Campaign = {
      ...campaignData,
      id: Date.now().toString(),
      createdAt: new Date().toISOString(),
      status: 'pending',
      processed: 0,
      successful: 0,
      failed: 0,
      currentBatch: 0,
      totalBatches,
      currentProject: campaignData.projectIds[0],
      errors: [],
    };
    
    setCampaigns(prev => [...prev, newCampaign]);
    setCurrentCampaign(newCampaign);
  };

  const startCampaign = async (campaignId: string) => {
    const campaign = campaigns.find(c => c.id === campaignId);
    if (!campaign) return;

    try {
      console.log(`Starting campaign ${campaignId}...`);
      
      const response = await apiCall(`/campaigns/${campaignId}/start`, {
        method: 'POST',
        body: JSON.stringify({
          projectIds: campaign.projectIds,
          selectedUsers: campaign.selectedUsers,
          batchSize: campaign.batchSize,
          workers: campaign.workers,
        }),
      });
      
      console.log('Campaign started successfully:', response);
      
      setCampaigns(prev => prev.map(c => 
        c.id === campaignId ? { ...c, status: 'running' as const, startedAt: new Date().toISOString() } : c
      ));
      setCurrentCampaign(prev => prev ? { ...prev, status: 'running', startedAt: new Date().toISOString() } : null);
      
      // Set up polling for campaign progress
      const pollProgress = setInterval(async () => {
        try {
          const progressResponse = await apiCall(`/campaigns/${campaignId}/progress`);
          
          setCampaigns(prev => prev.map(c => 
            c.id === campaignId ? { ...c, ...progressResponse } : c
          ));
          setCurrentCampaign(prev => prev ? { ...prev, ...progressResponse } : null);
          
          if (progressResponse.status === 'completed' || progressResponse.status === 'failed') {
            clearInterval(pollProgress);
            setCampaignStats(null);
          } else {
            setCampaignStats({
              emailsSent: progressResponse.successful,
              emailsFailed: progressResponse.failed,
              currentProject: progressResponse.currentProject,
              currentBatch: progressResponse.currentBatch,
              estimatedTimeRemaining: progressResponse.estimatedTimeRemaining || 0,
            });
          }
        } catch (error) {
          console.error('Error polling campaign progress:', error);
          clearInterval(pollProgress);
        }
      }, 2000);
      
    } catch (error) {
      console.error('Error starting campaign:', error);
      setCampaigns(prev => prev.map(c => 
        c.id === campaignId ? { ...c, status: 'failed' as const } : c
      ));
      setCurrentCampaign(prev => prev ? { ...prev, status: 'failed' } : null);
      throw error;
    }
  };

  const pauseCampaign = async (campaignId: string) => {
    try {
      await apiCall(`/campaigns/${campaignId}/pause`, {
        method: 'POST',
      });
      
      setCampaigns(prev => prev.map(c => 
        c.id === campaignId ? { ...c, status: 'paused' as const } : c
      ));
      setCurrentCampaign(prev => prev ? { ...prev, status: 'paused' } : null);
    } catch (error) {
      console.error('Error pausing campaign:', error);
      throw error;
    }
  };

  const resumeCampaign = async (campaignId: string) => {
    try {
      await apiCall(`/campaigns/${campaignId}/resume`, {
        method: 'POST',
      });
      
      setCampaigns(prev => prev.map(c => 
        c.id === campaignId ? { ...c, status: 'running' as const } : c
      ));
      setCurrentCampaign(prev => prev ? { ...prev, status: 'running' } : null);
    } catch (error) {
      console.error('Error resuming campaign:', error);
      throw error;
    }
  };

  const updateTemplate = (projectId: string, template: string) => {
    setTemplates(prev => ({
      ...prev,
      [projectId]: template,
    }));
  };

  const testEmailSend = async (projectId: string, email: string): Promise<boolean> => {
    try {
      const response = await apiCall(`/projects/${projectId}/test-email`, {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      
      return response.success;
    } catch (error) {
      console.error('Error testing email send:', error);
      return false;
    }
  };

  return (
    <AppContext.Provider value={{
      projects,
      users,
      campaigns,
      currentCampaign,
      campaignStats,
      addProject,
      removeProject,
      loadUsers,
      importUsers,
      deleteAllUsers,
      createCampaign,
      startCampaign,
      pauseCampaign,
      resumeCampaign,
      templates,
      updateTemplate,
      testEmailSend,
    }}>
      {children}
    </AppContext.Provider>
  );
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [authenticated, setAuthenticated] = React.useState<boolean>(() => {
    return localStorage.getItem('authenticated') === 'true';
  });

  const login = () => {
    localStorage.setItem('authenticated', 'true');
    setAuthenticated(true);
    console.log('[AuthProvider] login: set authenticated = true');
  };

  const logout = () => {
    localStorage.removeItem('authenticated');
    setAuthenticated(false);
    console.log('[AuthProvider] logout: set authenticated = false');
  };

  // Listen for storage changes (in case of multi-tab or programmatic changes)
  React.useEffect(() => {
    const handleStorage = () => {
      const newAuthState = localStorage.getItem('authenticated') === 'true';
      setAuthenticated(newAuthState);
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  React.useEffect(() => {
    console.log('[AuthProvider] render: authenticated =', authenticated);
  });

  return (
    <AuthContext.Provider value={{ authenticated, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};
