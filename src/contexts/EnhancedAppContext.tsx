import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { useToast } from '@/hooks/use-toast';

// Types
export interface User {
  uid: string;
  email: string;
  displayName?: string;
  disabled: boolean;
  emailVerified: boolean;
  createdAt?: string;
}

export interface Project {
  id: string;
  name: string;
  adminEmail: string;
  apiKey: string;
  serviceAccount: any;
  status: 'loading' | 'active' | 'error';
  createdAt: string;
  profileId?: string;
  ownerId: string; // Username of the owner
}

export interface Campaign {
  id: string;
  name: string;
  projectIds: string[];
  selectedUsers: { [projectId: string]: string[] };
  batchSize: number;
  workers: number;
  template?: string;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed';
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  processed: number;
  successful: number;
  failed: number;
  errors: string[];
  projectStats: { [projectId: string]: { processed: number; successful: number; failed: number } };
  // Enterprise features
  sending_mode?: 'turbo' | 'throttled' | 'scheduled';
  turbo_config?: any;
  throttle_config?: any;
  schedule_config?: any;
}

export interface DailyCount {
  project_id: string;
  date: string;
  sent: number;
}

export interface Profile {
  id: string;
  name: string;
  description: string;
  projectIds: string[];
  createdAt: string;
  ownerId: string; // Username of the owner
}

interface EnhancedAppContextType {
  // Projects
  projects: Project[];
  addProject: (projectData: any) => Promise<void>;
  removeProject: (id: string) => Promise<void>;
  setProjects: React.Dispatch<React.SetStateAction<Project[]>>;
  reloadProjectsAndProfiles: () => Promise<void>;

  // Users
  users: { [projectId: string]: User[] };
  loadUsers: (projectId: string) => Promise<void>;
  loadMoreUsers: (projectId: string) => Promise<void>;
  importUsers: (projectIds: string[], emails: string[]) => Promise<number>;
  bulkDeleteUsers: (projectIds: string[], userIds?: string[]) => Promise<void>;
  refreshAllUsers: () => Promise<void>;

  // Campaigns
  campaigns: Campaign[];
  currentCampaign: Campaign | null;
  createCampaign: (campaignData: any) => Promise<void>;
  updateCampaign: (campaignId: string, updates: any) => Promise<void>;
  deleteCampaign: (campaignId: string) => Promise<void>;
  startCampaign: (campaignId: string) => Promise<void>;
  pauseCampaign: (campaignId: string) => Promise<void>;
  resumeCampaign: (campaignId: string) => Promise<void>;

  // Daily counts
  dailyCounts: { [key: string]: DailyCount };
  getDailyCount: (projectId: string) => number;

  // Loading states
  loading: boolean;
  setLoading: (loading: boolean) => void;

  // Profiles
  profiles: Profile[];
  activeProfile?: string;
  setActiveProfile: (profileId: string) => void;
  addProfile: (profile: Omit<Profile, 'id' | 'createdAt'>) => void;
  removeProfile: (profileId: string) => void;
  updateProfile: (profileId: string, updates: Partial<Profile>) => void;
  loadCampaigns: () => Promise<void>;
  bulkRemoveProjects: (ids: string[]) => Promise<void>;
}

const EnhancedAppContext = createContext<EnhancedAppContextType | undefined>(undefined);

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
    return "/api";
  }

  // Otherwise, use the current hostname with port 8000
  return "/api";
};

const API_BASE_URL = getApiBaseUrl();

// Defensive filter for valid projects
function filterValidProjects(projects: any[]) {
  return (projects || []).filter(p => p && typeof p.id === 'string' && p.id.trim() !== '' && p.id !== 'undefined');
}

// Remove all localStorageService usage and legacy logic
// All state is loaded from and updated via the backend

export const EnhancedAppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { toast } = useToast();

  // State
  const [projects, setProjects] = useState<Project[]>([]);
  const [users, setUsers] = useState<{ [projectId: string]: User[] }>({});
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [currentCampaign, setCurrentCampaign] = useState<Campaign | null>(null);
  const [dailyCounts, setDailyCounts] = useState<{ [key: string]: DailyCount }>({});
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeProfile, setActiveProfileState] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);

  // API helpers
  const apiCall = async (endpoint: string, options: RequestInit = {}) => {
    try {
      const url = `${API_BASE_URL}${endpoint}`;
      console.log(`apiCall: Making request to ${url}`, { method: options.method || 'GET', body: options.body });

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

      console.log(`apiCall: Response status for ${endpoint}:`, response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`apiCall: HTTP error for ${endpoint}:`, response.status, errorText);
        throw new Error(`API call failed: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      console.log(`apiCall: Success response for ${endpoint}:`, data);
      return data;
    } catch (error) {
      console.error(`apiCall: Request failed for ${endpoint}:`, error);
      throw error;
    }
  };

  // Fetch all data from backend
  const fetchAllData = async () => {
    setLoading(true);
    try {
      console.log('fetchAllData: Starting data fetch...');

      // 1. Projects
      try {
        const backendProjects = await apiCall('/projects', { method: 'GET' });
        console.log('fetchAllData: Backend projects:', backendProjects);
        const filteredProjects = (backendProjects.projects || []).map(p => ({
          ...p,
          status: p.status === 'active' ? 'active' : (p.status === 'error' ? 'error' : 'loading'),
        })).filter(p => p && p.id);
        console.log('fetchAllData: Filtered projects:', filteredProjects);
        setProjects(filteredProjects);
      } catch (error) {
        console.error('fetchAllData: Failed to load projects:', error);
        setProjects([]);
      }

      // 2. Users (on-demand only)
      // Do not preload all users on startup to avoid massive payloads for 1K+ projects
      setUsers({});

      // 3. Profiles
      try {
        const backendProfiles = await apiCall('/profiles', { method: 'GET' });
        console.log('fetchAllData: Backend profiles:', backendProfiles);
        const profilesWithDefaults = (backendProfiles.profiles || []).map(profile => ({
          ...profile,
          description: profile.description || '',
        }));
        setProfiles(profilesWithDefaults);
      } catch (error) {
        console.error('fetchAllData: Failed to load profiles:', error);
        setProfiles([]);
      }

      // 4. Campaigns
      try {
        const responseCampaigns = await apiCall('/campaigns', { method: 'GET' });
        setCampaigns(responseCampaigns.campaigns || []);
      } catch (error) {
        console.error('fetchAllData: Failed to load campaigns:', error);
        setCampaigns([]);
      }

      // 5. Daily counts
      try {
        const responseDailyCounts = await apiCall('/daily-counts', { method: 'GET' });
        setDailyCounts(responseDailyCounts.daily_counts || {});
      } catch (error) {
        console.error('fetchAllData: Failed to load daily counts:', error);
        setDailyCounts({});
      }

      console.log('fetchAllData: Data fetch completed successfully');
    } catch (error) {
      console.error('fetchAllData: Error:', error);
      toast({ title: 'Error', description: `Failed to load data from backend: ${error instanceof Error ? error.message : 'Unknown error'}`, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  // On mount, fetch all data
  useEffect(() => {
    fetchAllData();
  }, []);

  // CRUD: Projects
  // Add project: always link to selected profile
  const addProject = async (projectData: any) => {
    setLoading(true);
    try {
      // Send project data and profileId separately to match backend expectation
      const requestBody = {
        ...projectData,
        profileId: activeProfile, // always link to selected profile
      };
      await apiCall('/projects', {
        method: 'POST',
        body: JSON.stringify(requestBody),
      });
      await fetchAllData();
      toast({ title: 'Project Added', description: `${projectData.name} added successfully.` });
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to add project.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  // Remove project: remove from profile's projectIds
  const removeProject = async (id: string) => {
    setLoading(true);
    try {
      // Remove project from backend
      await apiCall(`/projects/${id}`, { method: 'DELETE' });
      // Remove project from all profiles' projectIds in backend
      const affectedProfiles = profiles.filter(profile => profile.projectIds.includes(id));
      for (const profile of affectedProfiles) {
        const newProjectIds = profile.projectIds.filter(pid => pid !== id);
        await apiCall(`/profiles/${profile.id}`, {
          method: 'PUT',
          body: JSON.stringify({ projectIds: newProjectIds }),
        });
      }
      await fetchAllData();
      toast({ title: 'Project Removed', description: 'Project deleted successfully.' });
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to delete project.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  // Fix removeProject to only remove the selected project and update profiles correctly
  // This function is now redundant as removeProject handles both project and profile linking
  const bulkRemoveProjects = async (ids: string[]) => {
    setLoading(true);
    try {
      console.log('bulkRemoveProjects: Starting deletion of projects:', ids);
      const response = await apiCall(`/projects/bulk-delete`, {
        method: 'POST',
        body: JSON.stringify(ids), // Backend expects array directly, not wrapped in object
        headers: { 'Content-Type': 'application/json' },
      });
      console.log('bulkRemoveProjects: Backend response:', response);

      // Force a complete data refresh
      console.log('bulkRemoveProjects: Refreshing data...');
      await fetchAllData();
      console.log('bulkRemoveProjects: Data refresh completed');

      toast({ title: 'Projects Removed', description: `${ids.length} project(s) deleted successfully.` });
    } catch (error) {
      console.error('bulkRemoveProjects: Error:', error);
      toast({ title: 'Error', description: 'Failed to delete projects.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  // CRUD: Users
  // Paginated loader
  const projectToNextToken = useRef<{ [projectId: string]: string | null }>({});
  const loadUsers = async (projectId: string) => {
    try {
      const response = await apiCall(`/projects/${projectId}/users?limit=500`);
      setUsers(prev => ({ ...prev, [projectId]: response.users }));
      projectToNextToken.current[projectId] = response.nextPageToken || null;
    } catch (error) {
      console.error(`Failed to load users for project ${projectId}:`, error);
      throw error;
    }
  };

  const loadMoreUsers = async (projectId: string) => {
    try {
      const next = projectToNextToken.current[projectId];
      if (!next) return; // no more pages
      const response = await apiCall(`/projects/${projectId}/users?limit=500&page_token=${encodeURIComponent(next)}`);
      setUsers(prev => ({ ...prev, [projectId]: [...(prev[projectId] || []), ...response.users] }));
      projectToNextToken.current[projectId] = response.nextPageToken || null;
    } catch (error) {
      console.error(`Failed to load more users for project ${projectId}:`, error);
      throw error;
    }
  };

  const bulkDeleteUsers = async (projectIds: string[], userIds?: string[]) => {
    try {
      const response = await apiCall('/projects/users/bulk', {
        method: 'DELETE',
        body: JSON.stringify({
          projectIds,
          userIds: userIds || null  // null means delete all users
        }),
      });

      if (response.success) {
        // Reload users for affected projects
        await Promise.all(projectIds.map(id => loadUsers(id)));

        toast({
          title: "Users Deleted",
          description: response.message || `Successfully deleted ${response.total_deleted || 'users'}`,
        });

        return response;
      } else {
        throw new Error(response.error || 'Failed to delete users');
      }
    } catch (error) {
      console.error('Bulk delete users failed:', error);
      toast({
        title: "Delete Failed",
        description: error.message || "Failed to delete users. Please try again.",
        variant: "destructive",
      });
      throw error;
    }
  };

  // CRUD: Profiles
  const addProfile = async (profileData: Omit<Profile, 'id' | 'createdAt'>) => {
    setLoading(true);
    try {
      console.log('addProfile: Starting profile creation with data:', profileData);

      const profileWithDefaults = {
        ...profileData,
        description: profileData.description || '',
      };

      console.log('addProfile: Making API call to /profiles with data:', profileWithDefaults);

      const response = await apiCall('/profiles', {
        method: 'POST',
        body: JSON.stringify(profileWithDefaults),
      });

      console.log('addProfile: Backend response:', response);

      await fetchAllData();
      toast({ title: 'Profile Added', description: `${profileData.name} added successfully.` });
    } catch (error) {
      console.error('addProfile: Error creating profile:', error);
      toast({ title: 'Error', description: `Failed to add profile: ${error instanceof Error ? error.message : 'Unknown error'}`, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };
  // Remove profile: unlink all associated projects
  const removeProfile = async (profileId: string) => {
    setLoading(true);
    try {
      // Unlink all projects from this profile
      const projectsToUnlink = projects.filter(p => p.profileId === profileId);
      for (const project of projectsToUnlink) {
        await apiCall(`/projects/${project.id}`, {
          method: 'PUT',
          body: JSON.stringify({ profileId: undefined }),
        });
      }
      // Remove profile from backend
      await apiCall(`/profiles/${profileId}`, { method: 'DELETE' });
      await fetchAllData();
      toast({ title: 'Profile Removed', description: 'Profile deleted successfully.' });
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to delete profile.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };
  const updateProfile = async (profileId: string, updates: Partial<Profile>) => {
    setLoading(true);
    try {
      await apiCall(`/profiles/${profileId}`, {
        method: 'PUT',
        body: JSON.stringify(updates),
      });
      await fetchAllData();
      toast({ title: 'Profile Updated', description: 'Profile updated successfully.' });
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to update profile.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  // Campaign management with proper workers and batch size usage
  const loadCampaigns = async () => {
    try {
      const response = await apiCall('/campaigns');
      const merged = await mergeCampaignResults(response.campaigns);
      setCampaigns(merged);
      // Set current campaign if there's a running one
      const runningCampaign = merged.find((c: Campaign) => c.status === 'running');
      if (runningCampaign) {
        setCurrentCampaign(runningCampaign);
      }
    } catch (error) {
      console.error('Failed to load campaigns:', error);
    }
  };

  const createCampaign = async (campaignData: any) => {
    try {
      const response = await apiCall('/campaigns', {
        method: 'POST',
        body: JSON.stringify(campaignData),
      });

      if (response.success) {
        setCampaigns(prev => [response.campaign, ...prev]);

        toast({
          title: "Campaign Created",
          description: `Campaign "${campaignData.name}" has been created successfully.`,
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to create campaign.",
        variant: "destructive",
      });
      throw error;
    }
  };

  const updateCampaign = async (campaignId: string, updates: any) => {
    try {
      const response = await apiCall(`/campaigns/${campaignId}`, {
        method: 'PUT',
        body: JSON.stringify(updates),
      });

      if (response.success) {
        setCampaigns(prev => prev.map(c => c.id === campaignId ? response.campaign : c));

        toast({
          title: "Campaign Updated",
          description: "Campaign has been updated successfully.",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update campaign.",
        variant: "destructive",
      });
      throw error;
    }
  };

  const deleteCampaign = async (campaignId: string) => {
    try {
      await apiCall(`/campaigns/${campaignId}`, { method: 'DELETE' });
      setCampaigns(prev => prev.filter(c => c.id !== campaignId));

      if (currentCampaign?.id === campaignId) {
        setCurrentCampaign(null);
      }

      toast({
        title: "Campaign Deleted",
        description: "Campaign has been deleted successfully.",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to delete campaign.",
        variant: "destructive",
      });
      throw error;
    }
  };

  const startCampaign = async (campaignId: string) => {
    try {
      const campaign = campaigns.find(c => c.id === campaignId);
      if (!campaign) {
        throw new Error('Campaign not found');
      }

      console.log(`Starting campaign with ${campaign.workers} workers and batch size ${campaign.batchSize}`);

      const response = await apiCall(`/campaigns/${campaignId}/start`, {
        method: 'POST',
        body: JSON.stringify({
          workers: campaign.workers,
          batchSize: campaign.batchSize
        })
      });

      if (response.success) {
        // Update campaign status
        setCampaigns(prev => prev.map(c =>
          c.id === campaignId
            ? { ...c, status: 'running' as const, startedAt: new Date().toISOString() }
            : c
        ));

        setCurrentCampaign({ ...campaign, status: 'running', startedAt: new Date().toISOString() });

        // Monitor campaign progress
        const progressInterval = setInterval(async () => {
          try {
            const progressResponse = await apiCall(`/campaigns/${campaignId}`);
            setCampaigns(prev => prev.map(c => c.id === campaignId ? progressResponse : c));
            setCurrentCampaign(progressResponse);

            if (progressResponse.status === 'completed' || progressResponse.status === 'failed') {
              clearInterval(progressInterval);
              setCurrentCampaign(null);
            }
          } catch (error) {
            console.error('Failed to update campaign progress:', error);
            clearInterval(progressInterval);
          }
        }, 2000);

        toast({
          title: "Campaign Started",
          description: `Password reset campaign is running with ${campaign.workers} workers and batch size ${campaign.batchSize}.`,
        });
      }
    } catch (error) {
      console.error('Failed to start campaign:', error);
      toast({
        title: "Error",
        description: "Failed to start campaign. Please check your backend connection.",
        variant: "destructive",
      });
      throw error;
    }
  };

  const pauseCampaign = async (campaignId: string) => {
    // Implementation for pause functionality
    console.log('Pause campaign:', campaignId);
  };

  const resumeCampaign = async (campaignId: string) => {
    // Implementation for resume functionality
    console.log('Resume campaign:', campaignId);
  };

  const updateCampaignProgress = async (campaignId: string) => {
    try {
      const response = await apiCall(`/campaigns/${campaignId}`);
      setCampaigns(prev => prev.map(c => c.id === campaignId ? response : c));

      if (currentCampaign?.id === campaignId) {
        setCurrentCampaign(response);
      }
    } catch (error) {
      console.error('Failed to update campaign progress:', error);
    }
  };

  // Daily counts
  const loadDailyCounts = async () => {
    try {
      const response = await apiCall('/daily-counts');
      setDailyCounts(response.daily_counts);
    } catch (error) {
      console.error('Failed to load daily counts:', error);
    }
  };

  const getDailyCount = (projectId: string): number => {
    const today = new Date().toISOString().split('T')[0];
    const key = `${projectId}_${today}`;
    return dailyCounts[key]?.sent || 0;
  };

  // Helper to merge campaign results into campaigns
  const mergeCampaignResults = async (campaigns: Campaign[]) => {
    try {
      const resultsResponse = await apiCall('/campaigns/results/all');
      const results = resultsResponse.results || {};
      return campaigns.map(campaign => {
        // Merge all project results for this campaign
        const projectResults: any[] = Object.values(results).filter((r: any) => r.campaign_id === campaign.id);
        let processed = 0, successful = 0, failed = 0, status = campaign.status;
        let projectStats: any = {};
        if (projectResults.length > 0) {
          processed = projectResults.reduce((sum: number, r: any) => sum + (Number(r.successful) || 0) + (Number(r.failed) || 0), 0);
          successful = projectResults.reduce((sum: number, r: any) => sum + (Number(r.successful) || 0), 0);
          failed = projectResults.reduce((sum: number, r: any) => sum + (Number(r.failed) || 0), 0);
          // If any project is running, status is running; else completed/failed
          if (projectResults.some((r: any) => r.status === 'running')) status = 'running';
          else if (projectResults.every((r: any) => r.status === 'completed')) status = 'completed';
          else if (projectResults.some((r: any) => r.status === 'partial')) status = 'failed'; // fallback to allowed type
          projectStats = Object.fromEntries(projectResults.map((r: any) => [r.project_id, {
            processed: (Number(r.successful) || 0) + (Number(r.failed) || 0),
            successful: Number(r.successful) || 0,
            failed: Number(r.failed) || 0
          }]));
        }
        return {
          ...campaign,
          processed,
          successful,
          failed,
          status,
          projectStats,
        };
      });
    } catch (error) {
      return campaigns;
    }
  };

  // On app load, after loading projects, load all users in the background
  useEffect(() => {
    const validProjects = filterValidProjects(projects);
    if (validProjects.length > 0) {
      // loadAllUsers(); // This function is no longer needed as users are loaded directly
    }
  }, [projects.length]);

  // On app load, fetch profiles from backend
  useEffect(() => {
    (async () => {
      const backendProfiles = await apiCall('/profiles', { method: 'GET' });
      setProfiles(backendProfiles.profiles || []);
      // Optionally, sync to localStorage
      // const data = localStorageService.loadData();
      // data.profiles = backendProfiles;
      // localStorageService.saveData(data);
    })();
  }, []);

  // Expose a refreshAllUsers function for Users page
  const refreshAllUsers = async () => {
    // This function is no longer needed as users are loaded directly
  };

  useEffect(() => {
    let ws: WebSocket | null = null;
    let retryAttempts = 0;
    let heartbeat: number | null = null;

    const getWsUrl = () => {
      try {
        const api = new URL(API_BASE_URL);
        const wsProtocol = api.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${wsProtocol}//${api.host}/ws`;
      } catch {
        const isHttps = window.location.protocol === 'https:';
        const host = API_BASE_URL.replace('http://', '').replace('https://', '');
        return `${isHttps ? 'wss' : 'ws'}://${host}/ws`;
      }
    };

    const connect = () => {
      const url = getWsUrl();
      ws = new WebSocket(url);

      ws.onopen = () => {
        retryAttempts = 0;
        if (heartbeat) window.clearInterval(heartbeat);
        heartbeat = window.setInterval(() => {
          try { ws?.send('ping'); } catch { }
        }, 30000);
      };

      ws.onmessage = async (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (!msg.event) return;
          switch (msg.event) {
            case 'permissions_updated':
            case 'roles_updated': {
              const username = localStorage.getItem('app-username') || '';
              if (username) {
                try {
                  const res = await fetch(`${API_BASE_URL}/auth/effective?username=${encodeURIComponent(username)}`);
                  if (res.ok) {
                    const data = await res.json();
                    localStorage.setItem('app-role', data.role || 'member');
                    // Always set a complete permissions object with all known keys
                    const known = ['projects', 'users', 'campaigns', 'templates', 'ai', 'test', 'profiles', 'auditLogs', 'settings', 'smtp'];
                    const normalized: any = {};
                    known.forEach(k => { normalized[k] = !!(data.permissions && data.permissions[k]); });
                    localStorage.setItem('app-permissions', JSON.stringify(normalized));
                    window.dispatchEvent(new Event('storage'));
                  }
                } catch { }
              }
              break;
            }
            case 'import_users':
              toast({
                title: 'Users Imported (Real-Time)',
                description: `Imported ${msg.data.total_imported} users across ${msg.data.project_ids.length} projects.`
              });
              await Promise.all(msg.data.project_ids.map((id: string) => loadUsers(id)));
              break;
            case 'bulk_delete_users':
              toast({
                title: 'Users Deleted (Real-Time)',
                description: `Deleted ${msg.data.total_deleted} users across ${msg.data.project_ids.length} projects.`
              });
              await Promise.all(msg.data.project_ids.map((id: string) => loadUsers(id)));
              break;
            case 'move_users':
              toast({
                title: 'Users Moved (Real-Time)',
                description: `Moved users from ${msg.data.from_project} to ${msg.data.to_project}.`
              });
              await loadUsers(msg.data.from_project);
              await loadUsers(msg.data.to_project);
              break;
            case 'copy_users':
              toast({
                title: 'Users Copied (Real-Time)',
                description: `Copied users from ${msg.data.from_project} to ${msg.data.to_project}.`
              });
              await loadUsers(msg.data.from_project);
              await loadUsers(msg.data.to_project);
              break;
            case 'delete_project':
              toast({
                title: 'Project Deleted (Real-Time)',
                description: `Project ${msg.data.project_id} has been deleted.`
              });
              // Reload project list
              const response = await apiCall('/projects');
              setProjects(response.projects);
              break;
            default:
              break;
          }
        } catch (e) {
          // Ignore parse errors
        }
      };

      ws.onclose = () => {
        if (heartbeat) { window.clearInterval(heartbeat); heartbeat = null; }
        // Exponential backoff up to 30s
        const delay = Math.min(30000, 1000 * Math.pow(2, retryAttempts));
        retryAttempts += 1;
        setTimeout(connect, delay);
      };

      ws.onerror = () => {
        try { ws?.close(); } catch { }
      };
    };

    connect();

    return () => {
      if (heartbeat) { window.clearInterval(heartbeat); heartbeat = null; }
      try { ws?.close(); } catch { }
    };
  }, []);

  const setProjectsSafe = (projects: Project[]) => {
    const filtered = filterValidProjects(projects);
    console.log('setProjectsSafe:', filtered);
    setProjects(filtered);
  };

  const reloadProjectsAndProfiles = async () => {
    await fetchAllData();
  };

  const value: EnhancedAppContextType = {
    // Projects
    projects,
    addProject,
    removeProject,
    setProjects: setProjectsSafe,
    reloadProjectsAndProfiles,

    // Users
    users,
    loadUsers,
    loadMoreUsers,
    importUsers: async (projectIds: string[], emails: string[]) => {
      setLoading(true);
      try {
        const response = await apiCall('/projects/users/import', {
          method: 'POST',
          body: JSON.stringify({ emails, projectIds }),
        });

        if (response.success) {
          // Reload users for affected projects
          await Promise.all(projectIds.map(id => loadUsers(id)));

          toast({
            title: "Import Successful",
            description: `Successfully imported ${response.total_imported} users across ${projectIds.length} projects.`,
          });

          return response.total_imported;
        }
        return 0;
      } catch (error) {
        toast({
          title: "Import Failed",
          description: "Failed to import users. Please try again.",
          variant: "destructive",
        });
        throw error;
      } finally {
        setLoading(false);
      }
    },
    bulkDeleteUsers: bulkDeleteUsers,
    refreshAllUsers: async () => {
      // This function is no longer needed as users are loaded directly
    },

    // Campaigns
    campaigns,
    currentCampaign,
    createCampaign,
    updateCampaign,
    deleteCampaign,
    startCampaign,
    pauseCampaign,
    resumeCampaign,

    // Daily counts
    dailyCounts,
    getDailyCount,

    // Loading
    loading,
    setLoading,

    // Profiles
    profiles,
    activeProfile,
    setActiveProfile: (profileId: string) => {
      console.log('Setting active profile:', profileId);
      setActiveProfileState(profileId);
    },
    addProfile: addProfile,
    removeProfile: removeProfile,
    updateProfile: updateProfile,
    loadCampaigns,
    bulkRemoveProjects,
  };

  return (
    <EnhancedAppContext.Provider value={value}>
      {children}
    </EnhancedAppContext.Provider>
  );
};

export const useEnhancedApp = () => {
  const context = useContext(EnhancedAppContext);
  if (context === undefined) {
    throw new Error('useEnhancedApp must be used within an EnhancedAppProvider');
  }
  return context;
};
