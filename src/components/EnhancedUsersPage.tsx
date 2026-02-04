import { useState, useEffect } from 'react';
import { useEnhancedApp } from '@/contexts/EnhancedAppContext';
import { Users, Upload, Trash2, Search, RefreshCw, UserX, Download } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { UserImportModal } from './UserImportModal';
import { Label } from '@/components/ui/label';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

export const EnhancedUsersPage = () => {
  const { 
    projects, 
    users, 
    profiles, 
    activeProfile, 
    loadUsers, 
    loadMoreUsers,
    bulkDeleteUsers, 
    loading,
    refreshAllUsers
  } = useEnhancedApp();
  const { toast } = useToast();
  
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedProject, setSelectedProject] = useState<string>('all');
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());
  const [showImportModal, setShowImportModal] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [userLoadError, setUserLoadError] = useState<string>('');
  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchTerm), 300);
    return () => clearTimeout(t);
  }, [searchTerm]);
  const [clipboard, setClipboard] = useState<{project: string, userIds: string[]} | null>(null);
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [targetProjects, setTargetProjects] = useState<string[]>([]);
  const [splitEqually, setSplitEqually] = useState(false);

  // Filter projects by active profile
  const activeProjects = projects.filter(p => 
    (!activeProfile || p.profileId === activeProfile) && p.status === 'active'
  );

  const activeProfileName = profiles.find(p => p.id === activeProfile)?.name || 'All Projects';

  console.log('EnhancedUsersPage state:', {
    projects,
    users,
    profiles,
    activeProfile,
    activeProjects,
    selectedProject,
    loadingUsers,
    userLoadError,
  });
  if (!Array.isArray(projects) || !Array.isArray(profiles)) {
    return <div style={{ color: 'red', padding: 32 }}>Error: Projects or profiles are not loaded.</div>;
  }

  const handleRefreshUsers = async (projectId?: string) => {
    setLoadingUsers(true);
    setUserLoadError('');
    
    try {
      const targets = projectId ? [projectId] : activeProjects.map(p => p.id);
      // Load only first page per project to avoid massive loads; users page can fetch more on demand later
      await Promise.all(targets.map(async (pid) => {
        try {
          await loadUsers(pid);
        } catch (error) {
          setUserLoadError(`Failed to load users for project ${pid}`);
        }
      }));
      
      toast({
        title: "Users Refreshed",
        description: "User list has been updated successfully.",
      });
    } catch (error) {
      console.error('Failed to refresh users:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setUserLoadError(`Failed to refresh users: ${errorMessage}`);
      toast({
        title: "Error",
        description: `Failed to refresh users: ${errorMessage}`,
        variant: "destructive",
      });
    } finally {
      setLoadingUsers(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedUsers.size === 0) {
      toast({
        title: "No Users Selected",
        description: "Please select users to delete.",
        variant: "destructive",
      });
      return;
    }

    if (!confirm(`Are you sure you want to delete ${selectedUsers.size} selected users?`)) {
      return;
    }

    try {
      const projectIds = selectedProject === 'all' ? activeProjects.map(p => p.id) : [selectedProject];
      await bulkDeleteUsers(projectIds, Array.from(selectedUsers));
      setSelectedUsers(new Set());
      toast({
        title: "Users Deleted",
        description: `Successfully deleted ${selectedUsers.size} users.`,
      });
    } catch (error) {
      console.error('Failed to bulk delete users:', error);
      toast({
        title: "Error",
        description: "Failed to delete users.",
        variant: "destructive",
      });
    }
  };

  const handleDeleteAllUsers = async () => {
    const projectIds = selectedProject === 'all' ? activeProjects.map(p => p.id) : [selectedProject];
    const totalUsers = projectIds.reduce((sum, pid) => sum + (users[pid]?.length || 0), 0);
    
    if (totalUsers === 0) {
      toast({
        title: "No Users Found",
        description: "No users to delete.",
        variant: "destructive",
      });
      return;
    }

    if (!confirm(`Are you sure you want to delete ALL ${totalUsers} users from ${selectedProject === 'all' ? 'all projects' : `1 project`}?`)) {
      return;
    }

    try {
      const allUserIds = projectIds.flatMap(pid => (users[pid] || []).map(u => u.uid));
      await bulkDeleteUsers(projectIds, allUserIds);
      setSelectedUsers(new Set());
      toast({
        title: "All Users Deleted",
        description: `Successfully deleted ${totalUsers} users.`,
      });
    } catch (error) {
      console.error('Failed to delete all users:', error);
      toast({
        title: "Error",
        description: "Failed to delete all users.",
        variant: "destructive",
      });
    }
  };

  const toggleUserSelection = (userId: string) => {
    const newSelected = new Set(selectedUsers);
    if (newSelected.has(userId)) {
      newSelected.delete(userId);
    } else {
      newSelected.add(userId);
    }
    setSelectedUsers(newSelected);
  };

  const handleSelectAll = () => {
    const filteredUsers = getFilteredUsers();
    if (selectedUsers.size === filteredUsers.length) {
      setSelectedUsers(new Set());
    } else {
      setSelectedUsers(new Set(filteredUsers.map(user => user.uid)));
    }
  };

  const getFilteredUsers = () => {
    const projectsToShow = selectedProject && selectedProject !== 'all' ? [selectedProject] : activeProjects.map(p => p.id);
    const allUsers = [];

    for (const projectId of projectsToShow) {
      const projectUsers = users[projectId] || [];
      const project = projects.find(p => p.id === projectId);
      
      const filteredUsers = projectUsers.filter(user => {
        const q = debouncedSearch.toLowerCase();
        return !q || user.email.toLowerCase().includes(q) || user.displayName?.toLowerCase().includes(q);
      });

      allUsers.push(...filteredUsers.map(user => ({ ...user, projectId, projectName: project?.name })));
    }

    return allUsers;
  };

  const exportUsers = () => {
    const filteredUsers = getFilteredUsers();
    if (filteredUsers.length === 0) {
      toast({
        title: "No Users to Export",
        description: "No users found to export.",
        variant: "destructive",
      });
      return;
    }
    
    const csvContent = [
      'Email,Display Name,Email Verified,Disabled,Created At,Project',
      ...filteredUsers.map(user => 
        `${user.email},${user.displayName || ''},${user.emailVerified},${user.disabled},${user.createdAt || ''},${user.projectName || ''}`
      )
    ].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `users_${selectedProject === 'all' ? 'all_projects' : selectedProject}_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const filteredUsers = getFilteredUsers();

  // Do not auto-load all users for all projects to avoid heavy loads

  useEffect(() => {
    if (activeProjects.length === 1) {
      setSelectedProject(activeProjects[0].id);
    } else if (activeProjects.length === 0) {
      setSelectedProject('all');
    }
  }, [activeProfile, projects]);

  // Load clipboard from localStorage on mount
  useEffect(() => {
    const data = localStorage.getItem('user-clipboard');
    if (data) setClipboard(JSON.parse(data));
  }, []);

  // Copy users to clipboard
  const handleCopyToClipboard = () => {
    if (selectedProject && selectedUsers.size > 0 && selectedProject !== 'all') {
      const data = { project: selectedProject, userIds: Array.from(selectedUsers) };
      setClipboard(data);
      localStorage.setItem('user-clipboard', JSON.stringify(data));
      toast({ title: 'Users Copied', description: `${selectedUsers.size} users copied to clipboard.` });
    }
  };

  useEffect(() => {
    refreshAllUsers();
  }, []);

  if (profiles.length === 0) {
    return (
      <div className="p-8">
        <Card className="bg-gray-800 border-gray-700">
          <CardContent className="py-12 text-center">
            <Users className="w-12 h-12 text-gray-500 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-white mb-2">No Profiles Found</h3>
            <p className="text-gray-400 mb-6">
              Create your first profile to organize your Firebase projects and manage users.
            </p>
            <Button
              onClick={() => window.location.hash = '#/profiles'}
              className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
            >
              Go to Profile Manager
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">User Management</h1>
          <p className="text-gray-400">
            Profile: <span className="text-blue-400 font-medium">{activeProfileName}</span> • 
            Manage Firebase Authentication users across your projects
          </p>
          {userLoadError && (
            <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-4 my-4">
              <p className="text-red-400 font-bold">Failed to load users for this project.</p>
              <p className="text-gray-300">{userLoadError}</p>
              <Button
                onClick={() => handleRefreshUsers(selectedProject === 'all' ? undefined : selectedProject)}
                className="mt-2 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800"
              >
                Retry
              </Button>
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => setShowImportModal(true)}
            className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
          >
            <Upload className="w-4 h-4 mr-2" />
            Import Users
          </Button>
          <Button
            onClick={exportUsers}
            variant="outline"
            className="border-gray-600 text-gray-300 hover:bg-gray-700"
          >
            <Download className="w-4 h-4 mr-2" />
            Export CSV
          </Button>
          {selectedUsers.size > 0 && (
            <Button
              onClick={handleBulkDelete}
              variant="destructive"
              className="bg-red-600 hover:bg-red-700"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete Selected ({selectedUsers.size})
            </Button>
          )}
          {selectedUsers.size > 0 && selectedProject !== 'all' && (
            <Button onClick={handleCopyToClipboard} className="bg-purple-700 hover:bg-purple-800">Copy Users</Button>
          )}
          {clipboard && selectedProject !== clipboard.project && selectedProject !== 'all' && (
            <Button onClick={() => setShowPasteModal(true)} className="bg-green-700 hover:bg-green-800 font-bold text-lg">Paste Users from {projects.find(p => p.id === clipboard.project)?.name || 'Project'}</Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
          <Input
            placeholder="Search users by email or name..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 bg-gray-800 border-gray-700 text-white"
          />
        </div>
        <Select value={selectedProject} onValueChange={setSelectedProject}>
          <SelectTrigger className="bg-gray-800 border-gray-700 text-white">
            <SelectValue placeholder="All projects in profile" />
          </SelectTrigger>
          <SelectContent className="bg-gray-800 border-gray-700">
            <SelectItem value="all" className="text-white hover:bg-gray-700">All Projects</SelectItem>
            {activeProjects.map((project) => (
              <SelectItem key={project.id} value={project.id} className="text-white hover:bg-gray-700">
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${
                    project.status === 'active' ? 'bg-green-500' :
                    project.status === 'error' ? 'bg-red-500' : 'bg-yellow-500'
                  }`} />
                  {project.name}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          onClick={() => handleRefreshUsers(selectedProject === 'all' ? undefined : selectedProject)}
          disabled={loadingUsers}
          className="border-gray-600 text-gray-300 hover:bg-gray-700"
        >
          {loadingUsers ? (
            <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4 mr-2" />
          )}
          Refresh Users
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            const targets = selectedProject === 'all' ? activeProjects.map(p => p.id) : [selectedProject];
            targets.forEach(pid => loadMoreUsers(pid));
          }}
          className="border-gray-600 text-gray-300 hover:bg-gray-700"
        >
          Load More
        </Button>
        <Button
          variant="destructive"
          onClick={handleDeleteAllUsers}
          disabled={filteredUsers.length === 0}
          className="bg-red-600 hover:bg-red-700"
        >
          <Trash2 className="w-4 h-4 mr-2" />
          Delete All
        </Button>
      </div>

      {activeProjects.length === 0 ? (
        <Card className="bg-gray-800 border-gray-700">
          <CardContent className="py-12 text-center">
            <Users className="w-12 h-12 text-gray-500 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-white mb-2">No Projects in Profile</h3>
            <p className="text-gray-400 mb-6">
              This app is waiting for you to add a Firebase project to the current profile.<br />
              <span className="text-yellow-400 font-bold">The app is not offline.</span> Please add a project to continue.
            </p>
            <Button
              onClick={() => window.location.hash = '#/projects'}
              className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
            >
              Go to Projects
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="bg-gray-800 border-gray-700">
          <CardHeader>
            <CardTitle className="text-white flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Users className="w-5 h-5" />
                Users ({filteredUsers.length})
              </span>
              <div className="flex items-center gap-4">
                <span className="text-gray-400 text-sm">
                  {selectedUsers.size} selected
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSelectAll}
                  disabled={filteredUsers.length === 0}
                  className="border-gray-600 text-gray-300 hover:bg-gray-700"
                >
                  {selectedUsers.size === filteredUsers.length ? 'Deselect All' : 'Select All'}
                </Button>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loadingUsers && (
              <div className="flex items-center justify-center py-4 mb-4">
                <div className="animate-spin w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full mr-2" />
                <span className="text-gray-400">Loading users...</span>
              </div>
            )}

            {/* Debug information */}
            <div className="mb-4 p-3 bg-gray-700 rounded-lg text-xs text-gray-400">
              <div>Debug Info:</div>
              <div>Active Profile: {activeProfile || 'None'}</div>
              <div>Active Projects: {activeProjects.length}</div>
              <div>Selected Project: {selectedProject || 'None'}</div>
              <div>All Project IDs: {projects.map(p => p.id).join(', ')}</div>
              <div>Projects with users: {Object.keys(users).length}</div>
              <div>Total users across all projects: {Object.values(users).reduce((sum, userList) => sum + userList.length, 0)}</div>
              {activeProjects.map(project => (
                <div key={project.id}>
                  Project {project.name} ({project.id}): {users[project.id]?.length || 0} users
                </div>
              ))}
              {selectedProject && !activeProjects.find(p => p.id === selectedProject) && (
                <div className="text-red-400 font-bold mt-2">Warning: Selected project is not found in activeProjects. This may indicate a backend or state mismatch.</div>
              )}
            </div>
            
            {filteredUsers.length === 0 && !loadingUsers ? (
              <div className="text-center py-8">
                <Users className="w-12 h-12 text-gray-500 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-white mb-2">No Users Found</h3>
                <p className="text-gray-400 mb-6">
                  Load users from Firebase or import them to get started.
                </p>
                <div className="flex gap-2 justify-center">
                  <Button
                    onClick={() => handleRefreshUsers(selectedProject === 'all' ? undefined : selectedProject)}
                    className="bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800"
                  >
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Load from Firebase
                  </Button>
                  <Button
                    onClick={() => setShowImportModal(true)}
                    variant="outline"
                    className="border-gray-600 text-gray-300 hover:bg-gray-700"
                  >
                    <Upload className="w-4 h-4 mr-2" />
                    Import Users
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="max-h-96 overflow-y-auto">
                  {filteredUsers.map((user) => (
                    <div
                      key={`${user.projectId}-${user.uid}`}
                      className="flex items-center gap-4 p-4 rounded-lg bg-gray-700 hover:bg-gray-600 transition-colors"
                    >
                      <Checkbox
                        checked={selectedUsers.has(user.uid)}
                        onCheckedChange={() => toggleUserSelection(user.uid)}
                        className="border-gray-500"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="font-medium text-white truncate">{user.email}</p>
                          <Badge className="bg-gray-600 text-gray-300 text-xs">
                            {user.projectName}
                          </Badge>
                        </div>
                        {user.displayName && (
                          <p className="text-sm text-gray-400">{user.displayName}</p>
                        )}
                        <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                          <span>UID: {user.uid}</span>
                          <span className={`px-2 py-1 rounded ${
                            user.emailVerified 
                              ? 'bg-green-500/20 text-green-400' 
                              : 'bg-red-500/20 text-red-400'
                          }`}>
                            {user.emailVerified ? 'Verified' : 'Unverified'}
                          </span>
                          <span className={`px-2 py-1 rounded ${
                            user.disabled 
                              ? 'bg-red-500/20 text-red-400' 
                              : 'bg-green-500/20 text-green-400'
                          }`}>
                            {user.disabled ? 'Disabled' : 'Active'}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <UserImportModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        availableProjects={activeProjects}
      />

      {showPasteModal && clipboard && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <Card className="bg-gray-800 border-gray-700 w-full max-w-md">
            <CardHeader>
              <CardTitle className="text-white">Paste Users to Projects</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Label className="text-gray-300">Select Target Projects</Label>
              <div className="grid grid-cols-1 gap-2 max-h-40 overflow-y-auto">
                {projects.filter(p => p.id !== clipboard.project && p.status === 'active').map(p => (
                  <div key={p.id} className="flex items-center gap-2">
                    <Checkbox
                      checked={targetProjects.includes(p.id)}
                      onCheckedChange={checked => {
                        setTargetProjects(prev => checked ? [...prev, p.id] : prev.filter(id => id !== p.id));
                      }}
                      className="border-gray-500"
                    />
                    <span className="text-white text-sm">{p.name}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2 mt-2">
                <Checkbox id="splitEqually" checked={splitEqually} onCheckedChange={checked => setSplitEqually(checked === true)} />
                <Label htmlFor="splitEqually" className="text-gray-300 cursor-pointer">Split users equally among selected projects</Label>
              </div>
              <div className="flex gap-2 mt-4">
                <Button
                  onClick={async () => {
                    if (!clipboard || targetProjects.length === 0) return;
                    if (splitEqually) {
                      // Split users equally
                      const chunkSize = Math.ceil(clipboard.userIds.length / targetProjects.length);
                      let total = 0;
                      for (let i = 0; i < targetProjects.length; i++) {
                        const chunk = clipboard.userIds.slice(i * chunkSize, (i + 1) * chunkSize);
                        if (chunk.length === 0) continue;
                        const res = await fetch(`${API_BASE_URL}/users/copy`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            source_project: clipboard.project,
                            target_projects: [targetProjects[i]],
                            user_ids: chunk,
                          }),
                        });
                        const result = await res.json();
                        if (result.success) total += result.copied;
                      }
                      toast({ title: 'Users Pasted', description: `Pasted ${total} users (split equally).` });
                    } else {
                      // Copy all to all
                      const res = await fetch(`${API_BASE_URL}/users/copy`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          source_project: clipboard.project,
                          target_projects: targetProjects,
                          user_ids: clipboard.userIds,
                        }),
                      });
                      const result = await res.json();
                      if (result.success) {
                        toast({ title: 'Users Pasted', description: `Pasted ${result.copied} users.` });
                      } else {
                        toast({ title: 'Paste Failed', description: result.error || 'Failed to paste users.', variant: 'destructive' });
                      }
                    }
                    setShowPasteModal(false);
                    setTargetProjects([]);
                    setSplitEqually(false);
                  }}
                  disabled={targetProjects.length === 0}
                  className="bg-green-700 hover:bg-green-800"
                >Paste</Button>
                <Button variant="outline" onClick={() => setShowPasteModal(false)} className="border-gray-600 text-gray-300 hover:bg-gray-700">Cancel</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};
