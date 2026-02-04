import { useState, useEffect } from 'react';
import { Plus, Edit, Trash2, Download, Upload, Users, FolderOpen, Link, Unlink } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { useEnhancedApp, Profile } from '@/contexts/EnhancedAppContext';
import { CampaignManager } from './CampaignManager';

export const ProfileManager = () => {
  const { toast } = useToast();
  const { 
    profiles, 
    projects, 
    activeProfile, 
    setActiveProfile, 
    addProfile, 
    removeProfile,
    updateProfile
  } = useEnhancedApp();
  
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingProfile, setEditingProfile] = useState<Profile | null>(null);
  const [showLinkDialog, setShowLinkDialog] = useState(false);
  const [selectedProfileForLinking, setSelectedProfileForLinking] = useState<Profile | null>(null);
  // Update formData state to only use 'name'
  const [formData, setFormData] = useState<{ name: string }>({ name: '' });

  // App Users (Admin) Management State
  const [appUsers, setAppUsers] = useState<{ username: string; role: string }[]>([]);
  const [appUsersLoading, setAppUsersLoading] = useState(false);
  const [newUser, setNewUser] = useState({ username: '', password: '', role: 'member' });
  const [adminUser, setAdminUser] = useState(localStorage.getItem('admin-basic-user') || 'admin');
  const [adminPass, setAdminPass] = useState(localStorage.getItem('admin-basic-pass') || 'admin');
  const [showPasswords, setShowPasswords] = useState(false);
  const appRole = typeof window !== 'undefined' ? localStorage.getItem('app-role') || 'member' : 'member';

  const API_BASE_URL = (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") ? "http://localhost:8000" : "/api";

  const getAdminHeaders = () => ({
    'Content-Type': 'application/json',
    'Authorization': 'Basic ' + btoa(`${adminUser}:${adminPass}`)
  });

  const loadAppUsers = async () => {
    setAppUsersLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/app-users`, { headers: getAdminHeaders() });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setAppUsers(data.users || []);
    } catch (e: any) {
      toast({ title: 'Failed to load app users', description: e?.message || 'Auth required (admin).', variant: 'destructive' });
    } finally {
      setAppUsersLoading(false);
    }
  };

  const saveAdminCreds = () => {
    localStorage.setItem('admin-basic-user', adminUser);
    localStorage.setItem('admin-basic-pass', adminPass);
    toast({ title: 'Admin credentials saved', description: 'Using Basic auth for admin endpoints.' });
    loadAppUsers();
  };

  const addAppUser = async () => {
    if (!newUser.username.trim() || !newUser.password.trim()) {
      toast({ title: 'Missing fields', description: 'Username and password are required.', variant: 'destructive' });
      return;
    }
    try {
      const res = await fetch(`${API_BASE_URL}/app-users`, {
        method: 'POST',
        headers: getAdminHeaders(),
        body: JSON.stringify(newUser)
      });
      if (!res.ok) throw new Error(await res.text());
      setNewUser({ username: '', password: '', role: 'member' });
      await loadAppUsers();
      toast({ title: 'User added', description: 'App user created successfully.' });
    } catch (e: any) {
      toast({ title: 'Add failed', description: e?.message || 'Could not add user.', variant: 'destructive' });
    }
  };

  const updateUserRole = async (username: string, role: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/app-users/${encodeURIComponent(username)}`, {
        method: 'PUT',
        headers: getAdminHeaders(),
        body: JSON.stringify({ role })
      });
      if (!res.ok) throw new Error(await res.text());
      await loadAppUsers();
      toast({ title: 'Role updated', description: `${username} is now ${role}.` });
    } catch (e: any) {
      toast({ title: 'Update failed', description: e?.message || 'Could not update role.', variant: 'destructive' });
    }
  };

  const resetUserPassword = async (username: string) => {
    const pwd = prompt(`Enter new password for ${username}`);
    if (!pwd) return;
    try {
      const res = await fetch(`${API_BASE_URL}/app-users/${encodeURIComponent(username)}`, {
        method: 'PUT',
        headers: getAdminHeaders(),
        body: JSON.stringify({ password: pwd })
      });
      if (!res.ok) throw new Error(await res.text());
      toast({ title: 'Password reset', description: `Password updated for ${username}.` });
    } catch (e: any) {
      toast({ title: 'Reset failed', description: e?.message || 'Could not reset password.', variant: 'destructive' });
    }
  };

  const deleteAppUser = async (username: string) => {
    if (!confirm(`Delete user ${username}?`)) return;
    try {
      const res = await fetch(`${API_BASE_URL}/app-users/${encodeURIComponent(username)}`, {
        method: 'DELETE',
        headers: getAdminHeaders(),
      });
      if (!res.ok) throw new Error(await res.text());
      await loadAppUsers();
      toast({ title: 'User deleted', description: `${username} removed.` });
    } catch (e: any) {
      toast({ title: 'Delete failed', description: e?.message || 'Could not delete user.', variant: 'destructive' });
    }
  };

  // Count projects per profile
  const getProjectCount = (profileId: string) => {
    return projects.filter(p => p.profileId === profileId).length;
  };

  const handleCreateProfile = async () => {
    if (!formData.name.trim()) {
      toast({
        title: "Error",
        description: "Profile name is required.",
        variant: "destructive",
      });
      return;
    }

    try {
      console.log('ProfileManager: Creating profile with name:', formData.name);
      
      await addProfile({
        name: formData.name,
        description: '', // Keep description empty for new profiles
        projectIds: [],
      });

      setFormData({ name: '' });
      setShowCreateDialog(false);
      
      toast({
        title: "Profile Created",
        description: `Profile "${formData.name}" has been created successfully.`,
      });
    } catch (error) {
      console.error('ProfileManager: Error creating profile:', error);
      toast({
        title: "Error",
        description: `Failed to create profile: ${error instanceof Error ? error.message : 'Unknown error'}`,
        variant: "destructive",
      });
    }
  };

  const handleEditProfile = (profile: Profile) => {
    setEditingProfile(profile);
    setFormData({ name: profile.name });
  };

  const handleUpdateProfile = () => {
    if (!editingProfile || !formData.name.trim()) {
      toast({
        title: "Error",
        description: "Profile name is required.",
        variant: "destructive",
      });
      return;
    }

    updateProfile(editingProfile.id, {
      name: formData.name,
      description: '', // Keep description empty for updated profiles
    });

    setEditingProfile(null);
    setFormData({ name: '' });
    
    toast({
      title: "Profile Updated",
      description: `Profile "${formData.name}" has been updated successfully.`,
    });
  };

  const handleDeleteProfile = (profileId: string) => {
    if (!confirm('Are you sure you want to delete this profile? All associated projects will be moved to "No Profile".')) {
      return;
    }

    removeProfile(profileId);
    
    toast({
      title: "Profile Deleted",
      description: "Profile has been deleted successfully.",
    });
  };

  const handleLinkProjects = (profile: Profile) => {
    setSelectedProfileForLinking(profile);
    setShowLinkDialog(true);
  };

  const handleLinkProjectsToProfile = async (projectIds: string[]) => {
    if (!selectedProfileForLinking) return;

    try {
      const API_BASE_URL = (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") ? "http://localhost:8000" : "/api";
      await fetch(`${API_BASE_URL}/profiles/${selectedProfileForLinking.id}/link-projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectIds }),
      });

      // Refresh data
      window.location.reload();

      toast({
        title: "Projects Linked",
        description: `${projectIds.length} project(s) linked to profile successfully.`,
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to link projects to profile.",
        variant: "destructive",
      });
    }
  };

  const handleUnlinkProjectsFromProfile = async (projectIds: string[]) => {
    if (!selectedProfileForLinking) return;

    try {
      const API_BASE_URL = (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") ? "http://localhost:8000" : "/api";
      await fetch(`${API_BASE_URL}/profiles/${selectedProfileForLinking.id}/unlink-projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectIds }),
      });
      
      // Refresh data
      window.location.reload();
      
      toast({
        title: "Projects Unlinked",
        description: `${projectIds.length} project(s) unlinked from profile successfully.`,
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to unlink projects from profile.",
        variant: "destructive",
      });
    }
  };

  const handleExportData = () => {
    // localStorageService.exportData(); // Removed as per edit hint
      toast({
      title: "Data Exported",
      description: "Your data has been downloaded as a JSON file.",
    });
  };

  const handleImportData = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      // const data = await localStorageService.importData(file); // Removed as per edit hint

      toast({
        title: "Data Imported",
        description: "Your data has been imported successfully. Please refresh the page.",
      });
    } catch (error) {
      toast({
        title: "Import Failed",
        description: "Failed to import data. Please check the file format.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="p-8 space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Profile Management</h1>
          <p className="text-gray-400">Organize your Firebase projects into profiles for better management</p>
        </div>
        <div className="flex gap-2">
          <input
            type="file"
            accept=".json"
            onChange={handleImportData}
            className="hidden"
            id="import-data"
          />
          <Button
            variant="outline"
            onClick={() => document.getElementById('import-data')?.click()}
            className="border-gray-600 text-gray-300 hover:bg-gray-700"
          >
            <Upload className="w-4 h-4 mr-2" />
            Import
          </Button>
          <Button
            variant="outline"
            onClick={handleExportData}
            className="border-gray-600 text-gray-300 hover:bg-gray-700"
          >
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
          <Button
            onClick={() => setShowCreateDialog(true)}
            className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
          >
            <Plus className="w-4 h-4 mr-2" />
            New Profile
          </Button>
        </div>
      </div>

      {/* App Users Admin (visible for admin role) */}
      {appRole === 'admin' && (
        <Card className="bg-gray-800 border-gray-700">
          <CardHeader>
            <CardTitle className="text-white">App Users (Admin)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <Label className="text-gray-300">Admin Username (Basic Auth)</Label>
                <Input value={adminUser} onChange={e => setAdminUser(e.target.value)} className="bg-gray-700 border-gray-600 text-white" />
              </div>
              <div>
                <Label className="text-gray-300">Admin Password (Basic Auth)</Label>
                <Input type={showPasswords ? 'text' : 'password'} value={adminPass} onChange={e => setAdminPass(e.target.value)} className="bg-gray-700 border-gray-600 text-white" />
              </div>
              <div className="flex items-end gap-2">
                <Button onClick={saveAdminCreds} className="bg-blue-600 hover:bg-blue-700">Save</Button>
                <Button variant="outline" onClick={loadAppUsers} className="border-gray-600 text-gray-300 hover:bg-gray-700">Load Users</Button>
                <div className="flex items-center gap-2 text-gray-300">
                  <Checkbox id="showPw" checked={showPasswords} onCheckedChange={v => setShowPasswords(v === true)} />
                  <Label htmlFor="showPw" className="cursor-pointer">Show</Label>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 border-t border-gray-700 pt-4">
              <div>
                <Label className="text-gray-300">New Username</Label>
                <Input value={newUser.username} onChange={e => setNewUser(prev => ({ ...prev, username: e.target.value }))} className="bg-gray-700 border-gray-600 text-white" />
              </div>
              <div>
                <Label className="text-gray-300">New Password</Label>
                <Input type={showPasswords ? 'text' : 'password'} value={newUser.password} onChange={e => setNewUser(prev => ({ ...prev, password: e.target.value }))} className="bg-gray-700 border-gray-600 text-white" />
              </div>
              <div>
                <Label className="text-gray-300">Role</Label>
                <Select value={newUser.role} onValueChange={v => setNewUser(prev => ({ ...prev, role: v }))}>
                  <SelectTrigger className="bg-gray-700 border-gray-600 text-white">
                    <SelectValue placeholder="Select role" />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-700 border-gray-600">
                    <SelectItem value="member" className="text-white">member</SelectItem>
                    <SelectItem value="admin" className="text-white">admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end">
                <Button onClick={addAppUser} className="bg-green-600 hover:bg-green-700 w-full">Add User</Button>
              </div>
            </div>

            <div className="border-t border-gray-700 pt-4">
              {appUsersLoading ? (
                <div className="text-gray-400">Loading app users...</div>
              ) : appUsers.length === 0 ? (
                <div className="text-gray-400">No app users loaded. Click Load Users.</div>
              ) : (
                <div className="space-y-2">
                  {appUsers.map(u => (
                    <div key={u.username} className="flex items-center justify-between p-3 bg-gray-700 rounded">
                      <div className="text-white">{u.username}</div>
                      <div className="flex items-center gap-2">
                        <Select value={u.role} onValueChange={v => updateUserRole(u.username, v)}>
                          <SelectTrigger className="bg-gray-800 border-gray-600 text-white">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="bg-gray-800 border-gray-600">
                            <SelectItem value="member" className="text-white">member</SelectItem>
                            <SelectItem value="admin" className="text-white">admin</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button variant="outline" onClick={() => resetUserPassword(u.username)} className="border-gray-600 text-gray-300 hover:bg-gray-700">Reset Password</Button>
                        <Button variant="destructive" onClick={() => deleteAppUser(u.username)} className="bg-red-600 hover:bg-red-700">Delete</Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {profiles.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {profiles.map((profile) => (
            <Card 
              key={profile.id} 
              className={`cursor-pointer transition-all duration-200 hover:scale-105 hover:shadow-xl ${
                activeProfile === profile.id 
                  ? 'bg-gradient-to-r from-purple-900/50 to-blue-900/50 border-purple-500/50 shadow-lg' 
                  : 'bg-gray-800 border-gray-700 hover:bg-gray-750'
              }`}
              onClick={() => setActiveProfile(profile.id)}
            >
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-lg font-semibold text-white flex items-center gap-2">
                  <FolderOpen className="w-5 h-5 text-blue-500" />
                  {profile.name}
                </CardTitle>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleLinkProjects(profile);
                    }}
                    className="text-green-400 hover:text-green-300 hover:bg-green-900/20"
                    title="Link/Unlink Projects"
                  >
                    <Link className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleEditProfile(profile);
                    }}
                    className="text-blue-400 hover:text-blue-300 hover:bg-blue-900/20"
                  >
                    <Edit className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteProfile(profile.id);
                    }}
                    className="text-red-400 hover:text-red-300 hover:bg-red-900/20"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-gray-400 text-sm">{profile.name}</p>
                
                <div className="flex items-center justify-between">
                  <Badge className={`flex items-center gap-1 ${getProjectCount(profile.id) === 0 ? 'bg-gray-500/20 text-gray-400' : 'bg-blue-500/20 text-blue-400'}`}>
                    <FolderOpen className="w-3 h-3" />
                    {getProjectCount(profile.id)} projects
                    {getProjectCount(profile.id) === 0 && <span className="ml-1">(No projects)</span>}
                  </Badge>
                  {activeProfile === profile.id && (
                    <Badge className="bg-green-500/20 text-green-400">
                      Active
                    </Badge>
                  )}
                </div>
                
                {/* Show "View Projects" button for profiles with no projects */}
                {getProjectCount(profile.id) === 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleLinkProjects(profile);
                    }}
                    className="w-full text-xs border-gray-600 text-gray-300 hover:bg-gray-700"
                  >
                    Link Projects
                  </Button>
                )}
                
                {/* Show linked projects */}
                {getProjectCount(profile.id) > 0 && (
                  <div className="space-y-2">
                    <p className="text-gray-400 text-xs font-medium">Linked Projects:</p>
                    <div className="space-y-1 max-h-20 overflow-y-auto">
                      {projects
                        .filter(p => p.profileId === profile.id)
                        .slice(0, 3) // Show first 3 projects
                        .map(project => (
                          <div key={project.id} className="flex items-center gap-2 text-xs">
                            <div className="w-2 h-2 rounded-full bg-blue-400"></div>
                            <span className="text-gray-300 truncate">{project.name}</span>
                          </div>
                        ))}
                      {getProjectCount(profile.id) > 3 && (
                        <div className="text-xs text-gray-500">
                          +{getProjectCount(profile.id) - 3} more projects
                        </div>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleLinkProjects(profile);
                      }}
                      className="w-full text-xs border-gray-600 text-gray-300 hover:bg-gray-700"
                    >
                      View All Projects
                    </Button>
                  </div>
                )}
                
                <p className="text-gray-500 text-xs">
                  Created: {new Date(profile.createdAt).toLocaleDateString()}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="bg-gray-800 border-gray-700">
          <CardContent className="py-12 text-center">
            <FolderOpen className="w-12 h-12 text-gray-500 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-white mb-2">No Profiles Found</h3>
            <p className="text-gray-400 mb-6">
              Create your first profile to organize your Firebase projects.
            </p>
            <Button
              onClick={() => setShowCreateDialog(true)}
              className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
            >
              <Plus className="w-4 h-4 mr-2" />
              Create First Profile
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Campaign Management Section */}
      <CampaignManager />

      {/* Create Profile Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="bg-gray-800 border-gray-700">
          <DialogHeader>
            <DialogTitle className="text-white">Create New Profile</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="profileName" className="text-gray-300">Profile Name</Label>
              <Input
                id="profileName"
                value={formData.name}
                onChange={(e) => setFormData({ name: e.target.value })}
                placeholder="Production Environment"
                className="bg-gray-700 border-gray-600 text-white"
              />
            </div>
            <div className="flex gap-2">
              <Button
                onClick={handleCreateProfile}
                className="bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800"
              >
                Create Profile
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowCreateDialog(false)}
                className="border-gray-600 text-gray-300 hover:bg-gray-700"
              >
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Profile Dialog */}
      <Dialog open={!!editingProfile} onOpenChange={() => setEditingProfile(null)}>
        <DialogContent className="bg-gray-800 border-gray-700">
          <DialogHeader>
            <DialogTitle className="text-white">Edit Profile</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="editProfileName" className="text-gray-300">Profile Name</Label>
              <Input
                id="editProfileName"
                value={formData.name}
                onChange={(e) => setFormData({ name: e.target.value })}
                placeholder="Production Environment"
                className="bg-gray-700 border-gray-600 text-white"
              />
            </div>
            <div className="flex gap-2">
              <Button
                onClick={handleUpdateProfile}
                className="bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800"
              >
                Update Profile
              </Button>
              <Button
                variant="outline"
                onClick={() => setEditingProfile(null)}
                className="border-gray-600 text-gray-300 hover:bg-gray-700"
              >
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Link Projects Dialog */}
      <Dialog open={showLinkDialog} onOpenChange={setShowLinkDialog}>
        <DialogContent className="bg-gray-800 border-gray-700 max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-white">
              Link/Unlink Projects - {selectedProfileForLinking?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4">
              <div>
                <Label className="text-gray-300 mb-2 block">Available Projects</Label>
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {projects.map((project) => {
                    const isLinked = selectedProfileForLinking?.projectIds.includes(project.id);
                    return (
                      <div key={project.id} className="flex items-center space-x-2 p-2 bg-gray-700 rounded">
                        <Checkbox
                          id={`project-${project.id}`}
                          checked={isLinked}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              handleLinkProjectsToProfile([project.id]);
                            } else {
                              handleUnlinkProjectsFromProfile([project.id]);
                            }
                          }}
                        />
                        <Label htmlFor={`project-${project.id}`} className="text-white flex-1">
                          {project.name} ({project.id})
                        </Label>
                        <Badge variant={isLinked ? "default" : "secondary"}>
                          {isLinked ? "Linked" : "Unlinked"}
                        </Badge>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setShowLinkDialog(false)}
                className="border-gray-600 text-gray-300 hover:bg-gray-700"
              >
                Close
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
