import React, { useEffect, useState } from 'react';
import {
  Home,
  Users,
  FolderOpen,
  Mail,
  FileText,
  Settings,
  Plus,
  Trash2,
  Brain,
  TestTube,
  Globe
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Profile } from '@/services/LocalStorageService';
import { useAuth } from '@/contexts/AppContext';

interface SidebarProps {
  currentPage: string;
  setCurrentPage: (page: string) => void;
  profiles: Profile[];
  activeProfile?: string;
  onProfileChange: (profileId: string) => void;
  onAddProfile: (profile: Omit<Profile, 'id' | 'createdAt'>) => void;
  onRemoveProfile: (profileId: string) => void;
  projectCounts: { [profileId: string]: number };
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentPage,
  setCurrentPage,
  profiles,
  activeProfile,
  onProfileChange,
  onAddProfile,
  onRemoveProfile,
  projectCounts
}) => {
  const [showAddProfile, setShowAddProfile] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');
  const [newProfileDescription, setNewProfileDescription] = useState('');
  const { logout } = useAuth();

  const [, setStorageTick] = useState(0);
  useEffect(() => {
    const onStorage = () => setStorageTick(t => t + 1);
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  const role = typeof window !== 'undefined' ? localStorage.getItem('app-role') || 'user' : 'user';
  const permsRaw = typeof window !== 'undefined' ? localStorage.getItem('app-permissions') : '{}';
  const perms = typeof window !== 'undefined' ? (() => {
    try {
      const parsed = JSON.parse(permsRaw || '{}');
      console.log('Raw permissions from localStorage:', permsRaw);
      console.log('Parsed permissions:', parsed);
      return parsed;
    } catch (e) {
      console.error('Failed to parse permissions:', e, permsRaw);
      return {};
    }
  })() : {} as any;

  const can = (key: string, fallback = false) => {
    const result = (role === 'admin') || (!!perms && perms[key] === true) || (fallback === true);
    console.log(`Permission check for ${key}: role=${role}, perms[${key}]=${perms[key]}, result=${result}`);
    return result;
  };

  // Debug logging
  console.log('Sidebar Debug:', { role, perms, username: localStorage.getItem('app-username') });

  const allItems = [
    { id: 'dashboard', label: 'Dashboard', icon: Home, key: 'dashboard', show: true },
    { id: 'projects', label: 'Projects', icon: FolderOpen, key: 'projects', show: can('projects') },
    { id: 'users', label: 'Users', icon: Users, key: 'users', show: can('users', false) },
    { id: 'campaigns', label: 'Campaigns', icon: Mail, key: 'campaigns', show: can('campaigns') },
    { id: 'templates', label: 'Templates', icon: FileText, key: 'templates', show: can('templates', false) },
    { id: 'cloudflare', label: 'Domain Verification', icon: Globe, key: 'cloudflare', show: can('cloudflare', false) },
    { id: 'ai', label: 'AI Management', icon: Brain, key: 'ai', show: can('ai', false) },
    { id: 'test', label: 'Test Campaign', icon: TestTube, key: 'test', show: can('test', false) },
    { id: 'profiles', label: 'Profiles', icon: Settings, key: 'profiles', show: can('profiles', false) },
    { id: 'audit-logs', label: 'Audit Logs', icon: FileText, key: 'auditLogs', show: can('auditLogs', false) },
    { id: 'settings', label: 'Settings', icon: Settings, key: 'settings', show: can('settings') },
  ];
  const menuItems = allItems.filter(i => i.show && (i.id !== 'settings' ? true : role === 'admin'));

  const handleAddProfile = () => {
    if (newProfileName.trim()) {
      onAddProfile({
        name: newProfileName.trim(),
        description: newProfileDescription.trim(),
        projectIds: [],
      });
      setNewProfileName('');
      setNewProfileDescription('');
      setShowAddProfile(false);
    }
  };



  const activeProfileData = profiles.find(p => p.id === activeProfile);

  return (
    <div className="w-64 bg-gray-800 border-r border-gray-700 flex flex-col">
      <div className="p-6 border-b border-gray-700">
        <h1 className="text-xl font-bold text-white mb-1">Firebase Manager</h1>
        <div className="flex items-center justify-between">
          <div className="text-xs text-gray-400">Signed in as <span className="text-gray-200 font-semibold">{(typeof window !== 'undefined' ? localStorage.getItem('app-username') : '') || 'user'}</span></div>
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              const username = localStorage.getItem('app-username');
              if (username) {
                try {
                  const res = await fetch(`http://localhost:8000/auth/effective?username=${encodeURIComponent(username)}`);
                  if (res.ok) {
                    const data = await res.json();
                    localStorage.setItem('app-role', data.role || 'user');
                    const normalized: any = {};
                    ['projects', 'users', 'campaigns', 'templates', 'ai', 'test', 'profiles', 'auditLogs', 'settings', 'smtp'].forEach(k => {
                      normalized[k] = !!(data.permissions && data.permissions[k]);
                    });
                    localStorage.setItem('app-permissions', JSON.stringify(normalized));
                    window.dispatchEvent(new Event('storage'));
                    console.log('Refreshed permissions for', username, ':', normalized);
                  }
                } catch (e) {
                  console.error('Failed to refresh permissions:', e);
                }
              }
            }}
            className="text-gray-400 hover:text-white p-1 text-xs"
            title="Refresh Permissions"
          >
            🔄
          </Button>
        </div>

        {/* Profile Selection */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-gray-300 text-sm">Active Profile</Label>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowAddProfile(true)}
              className="text-gray-400 hover:text-white p-1"
            >
              <Plus className="w-4 h-4" />
            </Button>
          </div>

          {profiles.length > 0 ? (
            <Select value={activeProfile} onValueChange={onProfileChange}>
              <SelectTrigger className="bg-gray-700 border-gray-600 text-white">
                <SelectValue placeholder="Select profile" />
              </SelectTrigger>
              <SelectContent className="bg-gray-700 border-gray-600">
                {profiles.map((profile) => (
                  <SelectItem key={profile.id} value={profile.id} className="text-white hover:bg-gray-600">
                    <div className="flex items-center justify-between w-full">
                      <span>{profile.name}</span>
                      <Badge variant="secondary" className="ml-2">
                        {projectCounts[profile.id] || 0}
                      </Badge>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <div className="text-gray-400 text-sm text-center py-2">
              No profiles yet
            </div>
          )}

          {activeProfileData && (
            <div className="text-xs text-gray-500">
              {activeProfileData.description || 'No description'}
            </div>
          )}
        </div>
      </div>

      <nav className="flex-1 p-4">
        <ul className="space-y-2">
          {menuItems.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.id}>
                <button
                  onClick={() => setCurrentPage(item.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${currentPage === item.id
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-300 hover:bg-gray-700 hover:text-white'
                    }`}
                >
                  <Icon className="w-5 h-5" />
                  {item.label}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Add Profile Dialog */}
      <Dialog open={showAddProfile} onOpenChange={setShowAddProfile}>
        <DialogContent className="bg-gray-800 border-gray-700">
          <DialogHeader>
            <DialogTitle className="text-white">Add New Profile</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="profileName" className="text-gray-300">Profile Name</Label>
              <Input
                id="profileName"
                value={newProfileName}
                onChange={(e) => setNewProfileName(e.target.value)}
                placeholder="Production, Development, etc."
                className="bg-gray-700 border-gray-600 text-white"
              />
            </div>
            <div>
              <Label htmlFor="profileDescription" className="text-gray-300">Description (Optional)</Label>
              <Input
                id="profileDescription"
                value={newProfileDescription}
                onChange={(e) => setNewProfileDescription(e.target.value)}
                placeholder="Brief description of this profile"
                className="bg-gray-700 border-gray-600 text-white"
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={handleAddProfile} className="bg-green-600 hover:bg-green-700">
                Add Profile
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowAddProfile(false)}
                className="border-gray-600 text-gray-300 hover:bg-gray-700"
              >
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <button
        onClick={() => { logout(); window.location.href = '/login'; }}
        className="w-full bg-red-600 hover:bg-red-700 mt-4 text-white font-bold py-2 px-4 rounded"
      >
        Logout
      </button>

    </div>
  );
};
