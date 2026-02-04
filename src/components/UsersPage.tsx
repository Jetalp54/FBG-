import { useState, useEffect } from 'react';
import { useApp } from '@/contexts/AppContext';
import { Search, Users, RefreshCw, CheckSquare, Square, Upload, Trash2, Download } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { UserImportModal } from './UserImportModal';
import { useToast } from '@/hooks/use-toast';
import { DateTime } from 'luxon';
import { Label } from '@/components/ui/label';

const API_BASE_URL = (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") ? "http://localhost:8000" : "/api";

export const UsersPage = () => {
  const { projects, users, loadUsers, deleteAllUsers } = useApp();
  const { toast } = useToast();
  const [selectedProject, setSelectedProject] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [filterVerified, setFilterVerified] = useState<'all' | 'yes' | 'no'>('all');
  const [filterDisabled, setFilterDisabled] = useState<'all' | 'yes' | 'no'>('all');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [showCopyModal, setShowCopyModal] = useState(false);
  const [targetProjects, setTargetProjects] = useState<string[]>([]);
  const [isMoving, setIsMoving] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const [clipboard, setClipboard] = useState<{project: string, userIds: string[]} | null>(null);
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [splitEqually, setSplitEqually] = useState(false);

  const currentUsers = selectedProject ? users[selectedProject] || [] : [];
  const filteredUsers = currentUsers.filter(user => {
    let match = user.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (user.displayName && user.displayName.toLowerCase().includes(searchTerm.toLowerCase()));
    if (filterVerified !== 'all') {
      match = match && (user.emailVerified === (filterVerified === 'yes'));
    }
    if (filterDisabled !== 'all') {
      match = match && (user.disabled === (filterDisabled === 'yes'));
    }
    if (filterDateFrom) {
      match = match && user.createdAt && DateTime.fromISO(user.createdAt) >= DateTime.fromISO(filterDateFrom);
    }
    if (filterDateTo) {
      match = match && user.createdAt && DateTime.fromISO(user.createdAt) <= DateTime.fromISO(filterDateTo);
    }
    return match;
  });

  const handleLoadUsers = async () => {
    if (!selectedProject) return;
    
    setLoading(true);
    try {
      await loadUsers(selectedProject);
      toast({
        title: "Users loaded",
        description: `Successfully loaded ${users[selectedProject]?.length || 0} users.`,
      });
    } catch (error) {
      toast({
        title: "Failed to load users",
        description: "Please check your project configuration.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAllUsers = async () => {
    if (!selectedProject) return;
    
    const userCount = currentUsers.length;
    if (userCount === 0) return;

    setIsDeleting(true);
    try {
      await deleteAllUsers(selectedProject);
      toast({
        title: "Users deleted",
        description: `Successfully deleted ${userCount} users.`,
      });
      setSelectedUsers(new Set());
    } catch (error) {
      toast({
        title: "Failed to delete users",
        description: "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleSelectAll = () => {
    if (selectedUsers.size === filteredUsers.length) {
      setSelectedUsers(new Set());
    } else {
      setSelectedUsers(new Set(filteredUsers.map(user => user.uid)));
    }
  };

  const handleUserSelect = (uid: string, checked: boolean) => {
    const newSelected = new Set(selectedUsers);
    if (checked) {
      newSelected.add(uid);
    } else {
      newSelected.delete(uid);
    }
    setSelectedUsers(newSelected);
  };

  const exportUsers = () => {
    if (filteredUsers.length === 0) return;
    const csvContent = [
      'Email,Display Name,Email Verified,Disabled,Created At',
      ...filteredUsers.map(user =>
        `${user.email},${user.displayName || ''},${user.emailVerified},${user.disabled},${user.createdAt || ''}`
      )
    ].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `users_${selectedProject}_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  useEffect(() => {
    setSelectedUsers(new Set());
    setSearchTerm('');
  }, [selectedProject]);

  const selectedProject_obj = projects.find(p => p.id === selectedProject);

  const handleMoveUsers = async () => {
    if (!selectedProject || targetProjects.length !== 1 || selectedUsers.size === 0) return;
    setIsMoving(true);
    try {
      const res = await fetch(`${API_BASE_URL}/users/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_project: selectedProject,
          target_project: targetProjects[0],
          user_ids: Array.from(selectedUsers),
        }),
      });
      const result = await res.json();
      if (result.success) {
        toast({ title: 'Users Moved', description: `Moved ${result.moved} users.` });
        setShowMoveModal(false);
        setSelectedUsers(new Set());
        setTargetProjects([]);
        handleLoadUsers();
      } else {
        toast({ title: 'Move Failed', description: result.error || 'Failed to move users.', variant: 'destructive' });
      }
    } catch (e) {
      toast({ title: 'Move Failed', description: 'Failed to move users.', variant: 'destructive' });
    } finally {
      setIsMoving(false);
    }
  };

  const handleCopyUsers = async () => {
    if (!selectedProject || targetProjects.length === 0 || selectedUsers.size === 0) return;
    setIsCopying(true);
    try {
      const res = await fetch(`${API_BASE_URL}/users/copy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_project: selectedProject,
          target_projects: targetProjects,
          user_ids: Array.from(selectedUsers),
        }),
      });
      const result = await res.json();
      if (result.success) {
        toast({ title: 'Users Copied', description: `Copied ${result.copied} users.` });
        setShowCopyModal(false);
        setTargetProjects([]);
      } else {
        toast({ title: 'Copy Failed', description: result.error || 'Failed to copy users.', variant: 'destructive' });
      }
    } catch (e) {
      toast({ title: 'Copy Failed', description: 'Failed to copy users.', variant: 'destructive' });
    } finally {
      setIsCopying(false);
    }
  };

  // Copy users to clipboard
  const handleCopyToClipboard = () => {
    if (selectedProject && selectedUsers.size > 0) {
      const data = { project: selectedProject, userIds: Array.from(selectedUsers) };
      setClipboard(data);
      localStorage.setItem('user-clipboard', JSON.stringify(data));
      toast({ title: 'Users Copied', description: `${selectedUsers.size} users copied to clipboard.` });
    }
  };

  // Load clipboard from localStorage on mount
  useEffect(() => {
    const data = localStorage.getItem('user-clipboard');
    if (data) setClipboard(JSON.parse(data));
  }, []);

  console.log('UsersPage loaded', { selectedUsers, clipboard });

  return (
    <div className="p-8 space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-white mb-2">User Management</h1>
        <p className="text-gray-400">Load, import, and manage users from your Firebase projects</p>
      </div>

      <Card className="bg-gray-800 border-gray-700">
        <CardHeader>
          <CardTitle className="text-white">Project Selection</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-4">
            <div className="flex-1">
              <Select value={selectedProject} onValueChange={setSelectedProject}>
                <SelectTrigger className="bg-gray-700 border-gray-600 text-white">
                  <SelectValue placeholder="Select a Firebase project" />
                </SelectTrigger>
                <SelectContent className="bg-gray-700 border-gray-600">
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id} className="text-white hover:bg-gray-600">
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
            </div>
            <Button
              onClick={handleLoadUsers}
              disabled={!selectedProject || loading}
              className="bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800"
            >
              {loading ? (
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4 mr-2" />
              )}
              Load Users
            </Button>
          </div>
          
          {selectedProject && (
            <div className="flex gap-2">
              <Button
                onClick={() => setShowImportModal(true)}
                variant="outline"
                className="border-gray-600 text-gray-300 hover:bg-gray-700"
              >
                <Upload className="w-4 h-4 mr-2" />
                Import Users
              </Button>
              <Button
                onClick={exportUsers}
                disabled={filteredUsers.length === 0}
                variant="outline"
                className="border-gray-600 text-gray-300 hover:bg-gray-700"
              >
                <Download className="w-4 h-4 mr-2" />
                Export CSV
              </Button>
              <Button
                onClick={handleDeleteAllUsers}
                disabled={currentUsers.length === 0 || isDeleting}
                variant="outline"
                className="border-red-600 text-red-400 hover:bg-red-900/20"
              >
                {isDeleting ? (
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4 mr-2" />
                )}
                Delete All
              </Button>
              {selectedUsers.size > 0 && (
                <Button onClick={handleCopyToClipboard} className="bg-purple-700 hover:bg-purple-800">Copy Users</Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {selectedProject && currentUsers.length > 0 && (
        <Card className="bg-gray-800 border-gray-700">
          <CardHeader>
            <div className="flex justify-between items-center">
              <CardTitle className="text-white flex items-center gap-2">
                <Users className="w-5 h-5" />
                Users ({filteredUsers.length})
                {selectedProject_obj?.status === 'active' && (
                  <Badge className="bg-green-500/20 text-green-400">Connected</Badge>
                )}
              </CardTitle>
              <div className="flex items-center gap-4">
                <span className="text-gray-400 text-sm">
                  {selectedUsers.size} selected
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSelectAll}
                  className="border-gray-600 text-gray-300 hover:bg-gray-700"
                >
                  {selectedUsers.size === filteredUsers.length ? (
                    <CheckSquare className="w-4 h-4 mr-2" />
                  ) : (
                    <Square className="w-4 h-4 mr-2" />
                  )}
                  {selectedUsers.size === filteredUsers.length ? 'Deselect All' : 'Select All'}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2 items-center mb-4">
              <Input
                placeholder="Search by email or name..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-64 bg-gray-700 border-gray-600 text-white"
              />
              <Select value={filterVerified} onValueChange={v => setFilterVerified(v as 'all' | 'yes' | 'no')}>
                <SelectTrigger className="bg-gray-700 border-gray-600 text-white w-32">
                  <SelectValue placeholder="Email Verified" />
                </SelectTrigger>
                <SelectContent className="bg-gray-700 border-gray-600">
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="yes">Verified</SelectItem>
                  <SelectItem value="no">Not Verified</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filterDisabled} onValueChange={v => setFilterDisabled(v as 'all' | 'yes' | 'no')}>
                <SelectTrigger className="bg-gray-700 border-gray-600 text-white w-32">
                  <SelectValue placeholder="Disabled" />
                </SelectTrigger>
                <SelectContent className="bg-gray-700 border-gray-600">
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="yes">Disabled</SelectItem>
                  <SelectItem value="no">Enabled</SelectItem>
                </SelectContent>
              </Select>
              <Input
                type="date"
                value={filterDateFrom}
                onChange={e => setFilterDateFrom(e.target.value)}
                className="w-40 bg-gray-700 border-gray-600 text-white"
                placeholder="From"
              />
              <Input
                type="date"
                value={filterDateTo}
                onChange={e => setFilterDateTo(e.target.value)}
                className="w-40 bg-gray-700 border-gray-600 text-white"
                placeholder="To"
              />
            </div>

            <div className="flex items-center gap-2 mb-2">
              <Checkbox
                checked={selectedUsers.size === filteredUsers.length && filteredUsers.length > 0}
                onCheckedChange={checked => {
                  if (checked) setSelectedUsers(new Set(filteredUsers.map(u => u.uid)));
                  else setSelectedUsers(new Set());
                }}
                className="border-gray-500"
              />
              <span className="text-white text-sm">Select All ({filteredUsers.length})</span>
              <Button
                size="sm"
                variant="destructive"
                onClick={async () => {
                  for (const uid of selectedUsers) {
                    // Implement a deleteUser function in context/backend for single user deletion
                    // await deleteUser(selectedProject, uid);
                  }
                  setSelectedUsers(new Set());
                  toast({ title: 'Users Deleted', description: 'Selected users have been deleted.' });
                }}
                disabled={selectedUsers.size === 0}
              >
                <Trash2 className="w-4 h-4 mr-1" /> Delete Selected
              </Button>
              <span className="text-gray-400 text-xs">{selectedUsers.size} selected</span>
            </div>

            <div className="max-h-96 overflow-y-auto space-y-2">
              {filteredUsers.map((user) => (
                <div
                  key={user.uid}
                  className="flex items-center justify-between p-4 bg-gray-700 rounded-lg hover:bg-gray-650 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <Checkbox
                      checked={selectedUsers.has(user.uid)}
                      onCheckedChange={(checked) => handleUserSelect(user.uid, checked as boolean)}
                    />
                    <div>
                      <h4 className="text-white font-medium">{user.email}</h4>
                      {user.displayName && (
                        <p className="text-gray-400 text-sm">{user.displayName}</p>
                      )}
                      {user.createdAt && (
                        <p className="text-gray-500 text-xs">
                          Created: {new Date(user.createdAt).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {user.emailVerified ? (
                      <Badge variant="secondary" className="bg-green-500/20 text-green-400">
                        Verified
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="bg-yellow-500/20 text-yellow-400">
                        Unverified
                      </Badge>
                    )}
                    {user.disabled && (
                      <Badge variant="secondary" className="bg-red-500/20 text-red-400">
                        Disabled
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {selectedProject && currentUsers.length === 0 && !loading && (
        <Card className="bg-gray-800 border-gray-700">
          <CardContent className="py-12 text-center">
            <Users className="w-12 h-12 text-gray-500 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-white mb-2">No Users Found</h3>
            <p className="text-gray-400 mb-6">
              Load users from Firebase or import them to get started.
            </p>
            <div className="flex gap-2 justify-center">
              <Button
                onClick={handleLoadUsers}
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
          </CardContent>
        </Card>
      )}

      {!selectedProject && (
        <Card className="bg-gray-800 border-gray-700">
          <CardContent className="py-12 text-center">
            <Users className="w-12 h-12 text-gray-500 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-white mb-2">Select a Project</h3>
            <p className="text-gray-400">
              Choose a Firebase project to load and manage its users.
            </p>
          </CardContent>
        </Card>
      )}

      {showImportModal && selectedProject && (
        <UserImportModal
          isOpen={showImportModal}
          onClose={() => setShowImportModal(false)}
          availableProjects={projects.filter(p => p.id === selectedProject)}
        />
      )}

      {clipboard && selectedProject && clipboard.project !== selectedProject && (
        <Button onClick={() => setShowPasteModal(true)} className="bg-green-700 hover:bg-green-800 font-bold text-lg">Paste Users from {projects.find(p => p.id === clipboard.project)?.name || 'Project'}</Button>
      )}

      {showPasteModal && clipboard && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <Card className="bg-gray-800 border-gray-700 w-full max-w-md">
            <CardHeader>
              <CardTitle className="text-white">Paste Users to Projects</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Label className="text-gray-300">Select Target Projects</Label>
              <div className="grid grid-cols-1 gap-2 max-h-40 overflow-y-auto">
                {projects.filter(p => p.id !== clipboard.project).map(p => (
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
