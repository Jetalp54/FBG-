import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';

const API_BASE_URL = (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") ? "http://localhost:8000" : "/api";

type AppUser = {
  username: string;
  role: 'admin' | 'it' | 'user';
  overrides?: Record<string, boolean>;
  email?: string;
};

// Static permissions matrix (can be extended later)
const DEFAULT_PERMISSIONS: Record<string, string[]> = {
  admin: [
    'Manage app users and roles',
    'Delete any campaign',
    'Manage all projects/profiles',
    'Delete projects from Google Cloud',
  ],
  it: [
    'Reconnect projects',
    'Import users',
    'Start campaigns',
  ],
  user: [
    'View dashboards',
    'Create non-destructive campaigns',
  ],
};

export const AppManagement = () => {
  const { toast } = useToast();
  const [tab, setTab] = useState<'overview' | 'users' | 'security' | 'smtp' | 'cloudflare'>('users');
  const [appUsers, setAppUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [adminUser, setAdminUser] = useState(localStorage.getItem('admin-basic-user') || 'admin');
  const [adminPass, setAdminPass] = useState(localStorage.getItem('admin-basic-pass') || 'admin');
  const [showPasswords, setShowPasswords] = useState(false);
  const [newUser, setNewUser] = useState({ username: '', password: '', role: 'user', email: '', overrides: {} as Record<string, boolean> });
  const role = typeof window !== 'undefined' ? (localStorage.getItem('app-role') || 'user') : 'user';

  const isAdmin = role === 'admin';
  const [canManage, setCanManage] = useState<boolean>(isAdmin);
  const [effectivePerms, setEffectivePerms] = useState<Record<string, Record<string, boolean>>>({});
  const [search, setSearch] = useState('');
  const [selectedUser, setSelectedUser] = useState<AppUser | null>(null);
  const [selectedRole, setSelectedRole] = useState<'admin' | 'it' | 'user'>('user');
  const [selectedOverrides, setSelectedOverrides] = useState<Record<string, boolean>>({});
  const [editorDirty, setEditorDirty] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editingUser, setEditingUser] = useState<AppUser | null>(null);

  const headers = useMemo(() => ({
    'Content-Type': 'application/json',
    'Authorization': 'Basic ' + btoa(`${adminUser}:${adminPass}`),
  }), [adminUser, adminPass]);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/app-users`, { headers });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const users = (data.users || []).map((u: any) => ({
        username: u.username,
        role: (u.role || 'user') as AppUser['role'],
        overrides: u.overrides || {},
        email: u.email || ''
      }));
      setAppUsers(users);

      // Compute effective permissions for each user
      const effective: Record<string, Record<string, boolean>> = {};
      for (const user of users) {
        try {
          const effectiveRes = await fetch(`${API_BASE_URL}/auth/effective?username=${encodeURIComponent(user.username)}`, { headers });
          if (effectiveRes.ok) {
            const effectiveData = await effectiveRes.json();
            effective[user.username] = effectiveData.permissions || {};
          } else {
            // Fallback: compute locally
            const features = ['projects', 'users', 'campaigns', 'templates', 'ai', 'test', 'profiles', 'auditLogs', 'settings', 'smtp'];
            if (user.role === 'admin') {
              effective[user.username] = Object.fromEntries(features.map(f => [f, true]));
            } else {
              effective[user.username] = Object.fromEntries(features.map(f => [f, !!(user.overrides || {})[f]]));
            }
          }
        } catch {
          // Fallback computation
          const features = ['projects', 'users', 'campaigns', 'templates', 'ai', 'test', 'profiles', 'auditLogs', 'settings', 'smtp'];
          if (user.role === 'admin') {
            effective[user.username] = Object.fromEntries(features.map(f => [f, true]));
          } else {
            effective[user.username] = Object.fromEntries(features.map(f => [f, !!(user.overrides || {})[f]]));
          }
        }
      }
      setEffectivePerms(effective);
      setCanManage(true);
    } catch (e: any) {
      toast({ title: 'Failed to load users', description: e?.message || 'Check admin credentials.', variant: 'destructive' });
      setCanManage(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // auto load once on mount if admin creds are defaults
    loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveAdminCreds = () => {
    localStorage.setItem('admin-basic-user', adminUser);
    localStorage.setItem('admin-basic-pass', adminPass);
    toast({ title: 'Saved', description: 'Admin credentials saved locally for admin endpoints.' });
  };

  const addUser = async () => {
    if (!newUser.username.trim() || !newUser.password.trim()) {
      toast({ title: 'Missing fields', description: 'Username and password are required.', variant: 'destructive' });
      return;
    }
    if (newUser.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newUser.email)) {
      toast({ title: 'Invalid email', description: 'Please enter a valid email address.', variant: 'destructive' });
      return;
    }
    // Validate overrides: only accept known features to prevent accidental grants
    const cleanOverrides: Record<string, boolean> = {};
    Object.entries(newUser.overrides).forEach(([k, v]) => {
      if (['projects', 'users', 'campaigns', 'templates', 'ai', 'test', 'profiles', 'auditLogs', 'settings', 'smtp'].includes(k)) {
        cleanOverrides[k] = !!v;
      }
    });
    try {
      const res = await fetch(`${API_BASE_URL}/app-users`, { method: 'POST', headers, body: JSON.stringify({ ...newUser, overrides: cleanOverrides }) });
      if (!res.ok) throw new Error(await res.text());
      setNewUser({ username: '', password: '', role: 'user', email: '', overrides: {} });
      await loadUsers();
      toast({ title: 'User added', description: 'App user created.' });
      // advise admin to share creds and log out/in to apply new permissions
      try { localStorage.setItem('app-permissions', ''); } catch { }
    } catch (e: any) {
      toast({ title: 'Add failed', description: e?.message || 'Could not add user.', variant: 'destructive' });
    }
  };

  const changeRole = async (username: string, role: AppUser['role']) => {
    try {
      const res = await fetch(`${API_BASE_URL}/app-users/${encodeURIComponent(username)}`, { method: 'PUT', headers, body: JSON.stringify({ role }) });
      if (!res.ok) throw new Error(await res.text());
      await loadUsers();
      toast({ title: 'Role updated', description: `${username} is now ${role}.` });
    } catch (e: any) {
      toast({ title: 'Update failed', description: e?.message || 'Could not update role.', variant: 'destructive' });
    }
  };

  const updateOverrides = async (username: string, key: string, value: boolean) => {
    try {
      const res = await fetch(`${API_BASE_URL}/app-users/${encodeURIComponent(username)}`, { method: 'PUT', headers, body: JSON.stringify({ overrides: { [key]: value } }) });
      if (!res.ok) throw new Error(await res.text());
      await loadUsers();
      toast({ title: 'Overrides updated', description: `${username} override for ${key} set to ${value ? 'on' : 'off'}.` });
    } catch (e: any) {
      toast({ title: 'Update failed', description: e?.message || 'Could not update overrides.', variant: 'destructive' });
    }
  };

  const resetPassword = async (username: string) => {
    const pwd = prompt(`Enter new password for ${username}:`);
    if (!pwd || pwd.length < 4) {
      toast({ title: 'Invalid password', description: 'Password must be at least 4 characters long.', variant: 'destructive' });
      return;
    }
    try {
      const res = await fetch(`${API_BASE_URL}/app-users/${encodeURIComponent(username)}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ password: pwd })
      });
      if (!res.ok) throw new Error(await res.text());
      toast({ title: 'Password reset', description: `Password updated for ${username}.` });
    } catch (e: any) {
      toast({ title: 'Reset failed', description: e?.message || 'Could not reset password.', variant: 'destructive' });
    }
  };

  const sendPasswordResetEmail = async (username: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username })
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.detail || 'Failed to send reset email');
      }
      const data = await res.json();
      toast({ title: 'Reset email sent', description: data.message });
    } catch (e: any) {
      toast({ title: 'Send failed', description: e?.message || 'Could not send reset email.', variant: 'destructive' });
    }
  };

  const deleteUser = async (username: string) => {
    if (!confirm(`Delete user ${username}?`)) return;
    try {
      const res = await fetch(`${API_BASE_URL}/app-users/${encodeURIComponent(username)}`, { method: 'DELETE', headers });
      if (!res.ok) throw new Error(await res.text());
      await loadUsers();
      toast({ title: 'User deleted', description: `${username} removed.` });
    } catch (e: any) {
      toast({ title: 'Delete failed', description: e?.message || 'Could not delete user.', variant: 'destructive' });
    }
  };

  const startEditUser = (user: AppUser) => {
    setEditingUser({ ...user });
    setEditMode(true);
    setEditorDirty(false);
  };

  const cancelEditUser = () => {
    setEditingUser(null);
    setEditMode(false);
    setEditorDirty(false);
  };

  const saveEditUser = async () => {
    if (!editingUser) return;

    try {
      const updates: any = {};
      if (editingUser.role !== selectedUser?.role) updates.role = editingUser.role;
      if (editingUser.email !== selectedUser?.email) updates.email = editingUser.email;

      // Check if overrides changed
      const currentOverrides = selectedUser?.overrides || {};
      const newOverrides = editingUser.overrides || {};
      const overridesChanged = Object.keys(currentOverrides).some(key =>
        currentOverrides[key] !== newOverrides[key]
      ) || Object.keys(newOverrides).some(key =>
        currentOverrides[key] !== newOverrides[key]
      );

      if (overridesChanged) {
        updates.overrides = newOverrides;
      }

      if (Object.keys(updates).length > 0) {
        const res = await fetch(`${API_BASE_URL}/app-users/${encodeURIComponent(editingUser.username)}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify(updates)
        });
        if (!res.ok) throw new Error(await res.text());

        await loadUsers();
        setSelectedUser(editingUser);
        toast({ title: 'User updated', description: `${editingUser.username} updated successfully.` });
      }

      setEditMode(false);
      setEditingUser(null);
      setEditorDirty(false);
    } catch (e: any) {
      toast({ title: 'Update failed', description: e?.message || 'Could not update user.', variant: 'destructive' });
    }
  };

  const pickUser = (u: AppUser) => {
    setSelectedUser(u);
    setSelectedRole(u.role);
    // Ensure all known features are present in the overrides display
    const allFeatures = ['projects', 'users', 'campaigns', 'templates', 'ai', 'test', 'profiles', 'auditLogs', 'settings', 'smtp'];
    const normalizedOverrides: Record<string, boolean> = {};
    allFeatures.forEach(feature => {
      normalizedOverrides[feature] = !!(u.overrides || {})[feature];
    });
    setSelectedOverrides(normalizedOverrides);
    setEditorDirty(false);
    setEditMode(false);
    setEditingUser(null);
    console.log('Selected user:', u.username, 'overrides:', normalizedOverrides);
  };

  const saveSelected = async () => {
    if (!selectedUser) return;
    // Clean overrides
    const clean: Record<string, boolean> = {};
    Object.entries(selectedOverrides).forEach(([k, v]) => {
      if (['projects', 'users', 'campaigns', 'templates', 'ai', 'test', 'profiles', 'auditLogs', 'settings', 'smtp'].includes(k)) {
        clean[k] = !!v;
      }
    });
    try {
      console.log('Saving user permissions:', { username: selectedUser.username, role: selectedRole, overrides: clean });
      const res = await fetch(`${API_BASE_URL}/app-users/${encodeURIComponent(selectedUser.username)}`, {
        method: 'PUT', headers,
        body: JSON.stringify({ role: selectedRole, overrides: clean })
      });
      if (!res.ok) {
        const errorText = await res.text();
        console.error('Save failed:', errorText);
        throw new Error(errorText);
      }
      console.log('Save successful, reloading users...');
      await loadUsers();
      // refresh editor with updated user
      const refreshed = (appUsers.find(u => u.username === selectedUser.username) || selectedUser);
      pickUser(refreshed);
      setEditorDirty(false);
      toast({ title: 'User updated', description: `${selectedUser.username} permissions saved. User should refresh their page or click refresh button.` });
    } catch (e: any) {
      console.error('Update error:', e);
      toast({ title: 'Update failed', description: e?.message || 'Could not update user.', variant: 'destructive' });
    }
  };

  return (
    <div className="p-8 space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Settings</h1>
          <p className="text-gray-400">Manage application users, roles and security.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant={tab === 'overview' ? 'default' : 'outline'} onClick={() => setTab('overview')} className={tab === 'overview' ? 'bg-blue-600 hover:bg-blue-700' : 'border-gray-600 text-gray-300 hover:bg-gray-700'}>Overview</Button>
          <Button variant={tab === 'users' ? 'default' : 'outline'} onClick={() => setTab('users')} className={tab === 'users' ? 'bg-blue-600 hover:bg-blue-700' : 'border-gray-600 text-gray-300 hover:bg-gray-700'}>Users</Button>
          {/* Roles & Permissions tab removed */}
          <Button variant={tab === 'security' ? 'default' : 'outline'} onClick={() => setTab('security')} className={tab === 'security' ? 'bg-blue-600 hover:bg-blue-700' : 'border-gray-600 text-gray-300 hover:bg-gray-700'}>Security</Button>
          <Button variant={tab === 'smtp' ? 'default' : 'outline'} onClick={() => setTab('smtp')} className={tab === 'smtp' ? 'bg-blue-600 hover:bg-blue-700' : 'border-gray-600 text-gray-300 hover:bg-gray-700'}>SMTP Config</Button>
          <Button variant={tab === 'cloudflare' ? 'default' : 'outline'} onClick={() => setTab('cloudflare')} className={tab === 'cloudflare' ? 'bg-blue-600 hover:bg-blue-700' : 'border-gray-600 text-gray-300 hover:bg-gray-700'}>Cloudflare</Button>
        </div>
      </div>

      {tab === 'overview' && (
        <Card className="bg-gray-800 border-gray-700">
          <CardHeader>
            <CardTitle className="text-white">Users Permissions Matrix</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <Input placeholder="Search users..." value={search} onChange={e => setSearch(e.target.value)} className="bg-gray-700 border-gray-600 text-white w-64" />
              <Button variant="outline" onClick={loadUsers} className="border-gray-600 text-gray-300 hover:bg-gray-700">Reload</Button>
              <Button
                variant="outline"
                onClick={async () => {
                  try {
                    const res = await fetch(`${API_BASE_URL}/app-users/migrate`, { method: 'POST', headers });
                    if (res.ok) {
                      const data = await res.json();
                      toast({ title: 'Migration completed', description: `Fixed ${data.migrated} users without overrides field.` });
                      await loadUsers();
                    } else {
                      throw new Error(await res.text());
                    }
                  } catch (e: any) {
                    toast({ title: 'Migration failed', description: e?.message || 'Could not migrate users.', variant: 'destructive' });
                  }
                }}
                className="border-yellow-600 text-yellow-300 hover:bg-yellow-900/20"
              >
                Fix Users
              </Button>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs text-gray-200">
                <thead>
                  <tr>
                    <th className="text-left p-2">User</th>
                    <th className="text-left p-2">Role</th>
                    {['projects', 'users', 'campaigns', 'templates', 'ai', 'test', 'profiles', 'auditLogs', 'settings', 'smtp'].map(f => (
                      <th key={f} className="text-left p-2 capitalize">{f}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {appUsers
                    .filter(u => !search.trim() || u.username.toLowerCase().includes(search.toLowerCase()))
                    .map(u => {
                      const eff = effectivePerms[u.username] || {};
                      return (
                        <tr key={u.username} className="border-t border-gray-700">
                          <td className="p-2">{u.username}</td>
                          <td className="p-2 capitalize">{u.role}</td>
                          {['projects', 'users', 'campaigns', 'templates', 'ai', 'test', 'profiles', 'auditLogs', 'settings', 'smtp'].map(f => (
                            <td key={f} className="p-2">{eff[f] ? '✅' : '—'}</td>
                          ))}
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {tab === 'users' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left column: Admin API auth + Add user + Users list */}
          <Card className="bg-gray-800 border-gray-700 lg:col-span-1">
            <CardHeader>
              <CardTitle className="text-white">Admin API Auth</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {!canManage && (
                <div className="bg-yellow-900/20 border border-yellow-600/30 text-yellow-300 text-sm p-3 rounded">
                  Enter Basic Auth credentials and click Load to enable editing.
                </div>
              )}
              <div className="grid grid-cols-1 gap-3">
                <div>
                  <Label className="text-gray-300">Admin Username</Label>
                  <Input value={adminUser} onChange={e => setAdminUser(e.target.value)} className="bg-gray-700 border-gray-600 text-white" />
                </div>
                <div>
                  <Label className="text-gray-300">Admin Password</Label>
                  <Input type={showPasswords ? 'text' : 'password'} value={adminPass} onChange={e => setAdminPass(e.target.value)} className="bg-gray-700 border-gray-600 text-white" />
                </div>
                <div className="flex items-center gap-2">
                  <Button onClick={saveAdminCreds} className="bg-blue-600 hover:bg-blue-700">Save</Button>
                  <Button variant="outline" onClick={loadUsers} className="border-gray-600 text-gray-300 hover:bg-gray-700">Load</Button>
                  <div className="flex items-center gap-2 text-gray-300">
                    <Checkbox id="showpw" checked={showPasswords} onCheckedChange={v => setShowPasswords(v === true)} />
                    <Label htmlFor="showpw" className="cursor-pointer">Show</Label>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gray-800 border-gray-700 lg:col-span-1">
            <CardHeader>
              <CardTitle className="text-white">Add User</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <Label className="text-gray-300">Username</Label>
                  <Input value={newUser.username} onChange={e => setNewUser(prev => ({ ...prev, username: e.target.value }))} className="bg-gray-700 border-gray-600 text-white" placeholder="Enter username" />
                </div>
                <div>
                  <Label className="text-gray-300">Password</Label>
                  <Input type={showPasswords ? 'text' : 'password'} value={newUser.password} onChange={e => setNewUser(prev => ({ ...prev, password: e.target.value }))} className="bg-gray-700 border-gray-600 text-white" placeholder="Enter password" />
                </div>
                <div>
                  <Label className="text-gray-300">Email</Label>
                  <Input type="email" value={newUser.email} onChange={e => setNewUser(prev => ({ ...prev, email: e.target.value }))} className="bg-gray-700 border-gray-600 text-white" placeholder="user@example.com (optional)" />
                </div>
                <div>
                  <Label className="text-gray-300">Role</Label>
                  <Select value={newUser.role} onValueChange={v => setNewUser(prev => ({ ...prev, role: v }))}>
                    <SelectTrigger className="bg-gray-700 border-gray-600 text-white">
                      <SelectValue placeholder="Select role" />
                    </SelectTrigger>
                    <SelectContent className="bg-gray-700 border-gray-600">
                      <SelectItem value="user" className="text-white">user</SelectItem>
                      <SelectItem value="it" className="text-white">it</SelectItem>
                      <SelectItem value="admin" className="text-white">admin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="border rounded border-gray-700 p-3">
                <div className="text-gray-300 mb-2">Overrides (optional)</div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {['projects', 'users', 'campaigns', 'templates', 'ai', 'test', 'profiles', 'auditLogs', 'settings', 'smtp'].map((f) => (
                    <label key={f} className="flex items-center gap-2 text-sm text-gray-300">
                      <Checkbox checked={!!newUser.overrides[f as keyof typeof newUser.overrides]} onCheckedChange={(v) => setNewUser(prev => ({ ...prev, overrides: { ...prev.overrides, [f]: v === true } }))} />
                      <span>{f}</span>
                    </label>
                  ))}
                </div>
              </div>
              <Button onClick={addUser} className="bg-green-600 hover:bg-green-700 w-full">Add</Button>
            </CardContent>
          </Card>

          <Card className="bg-gray-800 border-gray-700 lg:col-span-1">
            <CardHeader>
              <CardTitle className="text-white">Users</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input placeholder="Search users..." value={search} onChange={e => setSearch(e.target.value)} className="bg-gray-700 border-gray-600 text-white" />
              <div className="max-h-96 overflow-auto space-y-2">
                {loading ? <div className="text-gray-400">Loading...</div> : appUsers
                  .filter(u => !search.trim() || u.username.toLowerCase().includes(search.toLowerCase()))
                  .map(u => (
                    <div key={u.username} className={`p-3 rounded cursor-pointer ${selectedUser?.username === u.username ? 'bg-blue-900/30 border border-blue-600/40' : 'bg-gray-700'}`} onClick={() => pickUser(u)}>
                      <div className="flex items-center justify-between">
                        <div className="text-white">{u.username}</div>
                        <div className="text-xs text-gray-400 capitalize">{u.role}</div>
                      </div>
                      <div className="text-xs text-gray-400 mt-1">Overrides: {Object.values(u.overrides || {}).filter(Boolean).length}</div>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>

          {/* Right pane full width under on small screens */}
          <Card className="bg-gray-800 border-gray-700 lg:col-span-3">
            <CardHeader>
              <CardTitle className="text-white">User Editor</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {!selectedUser ? (
                <div className="text-gray-400">Select a user from the list to edit role and permissions.</div>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <Label className="text-gray-300">Username</Label>
                      <Input value={selectedUser.username} disabled className="bg-gray-700 border-gray-600 text-white" />
                    </div>
                    <div>
                      <Label className="text-gray-300">Email</Label>
                      {editMode && editingUser ? (
                        <Input
                          value={editingUser.email || ''}
                          onChange={(e) => {
                            setEditingUser(prev => prev ? { ...prev, email: e.target.value } : null);
                            setEditorDirty(true);
                          }}
                          className="bg-gray-700 border-gray-600 text-white"
                          placeholder="user@example.com"
                        />
                      ) : (
                        <Input
                          value={selectedUser.email || ''}
                          disabled
                          className="bg-gray-700 border-gray-600 text-white"
                        />
                      )}
                    </div>
                    <div>
                      <Label className="text-gray-300">Role</Label>
                      {editMode && editingUser ? (
                        <Select
                          value={editingUser.role}
                          onValueChange={(v) => {
                            setEditingUser(prev => prev ? { ...prev, role: v as any } : null);
                            setEditorDirty(true);
                          }}
                        >
                          <SelectTrigger className="bg-gray-700 border-gray-600 text-white">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="bg-gray-700 border-gray-600">
                            <SelectItem value="user" className="text-white">user</SelectItem>
                            <SelectItem value="it" className="text-white">it</SelectItem>
                            <SelectItem value="admin" className="text-white">admin</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <Select
                          value={selectedRole}
                          onValueChange={(v) => {
                            setSelectedRole(v as any);
                            setEditorDirty(true);
                          }}
                        >
                          <SelectTrigger className="bg-gray-700 border-gray-600 text-white">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="bg-gray-700 border-gray-600">
                            <SelectItem value="user" className="text-white">user</SelectItem>
                            <SelectItem value="it" className="text-white">it</SelectItem>
                            <SelectItem value="admin" className="text-white">admin</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                    <div className="flex items-end gap-2">
                      {editMode ? (
                        <>
                          <Button onClick={saveEditUser} disabled={!editorDirty} className="bg-green-600 hover:bg-green-700">
                            Save Changes
                          </Button>
                          <Button onClick={cancelEditUser} variant="outline" className="border-gray-600 text-gray-300 hover:bg-gray-700">
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button onClick={() => startEditUser(selectedUser)} className="bg-blue-600 hover:bg-blue-700">
                            Edit User
                          </Button>
                          <Button onClick={saveSelected} disabled={!editorDirty} className="bg-green-600 hover:bg-green-700">
                            Save Permissions
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      onClick={() => resetPassword(selectedUser.username)}
                      className="border-yellow-600 text-yellow-300 hover:bg-yellow-900/20"
                    >
                      Reset Password
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => sendPasswordResetEmail(selectedUser.username)}
                      className="border-blue-600 text-blue-300 hover:bg-blue-900/20"
                    >
                      Send Reset Email
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => deleteUser(selectedUser.username)}
                      className="border-red-600 text-red-300 hover:bg-red-900/20"
                    >
                      Delete
                    </Button>
                  </div>
                  <div>
                    <div className="text-gray-300 mb-2">Overrides</div>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                      {['projects', 'users', 'campaigns', 'templates', 'ai', 'test', 'profiles', 'auditLogs', 'settings', 'smtp'].map(f => (
                        <label key={f} className="flex items-center gap-2 text-sm text-gray-300">
                          <Checkbox
                            checked={editMode && editingUser ? !!(editingUser.overrides || {})[f] : !!selectedOverrides[f]}
                            onCheckedChange={(v) => {
                              if (editMode && editingUser) {
                                setEditingUser(prev => prev ? {
                                  ...prev,
                                  overrides: { ...(prev.overrides || {}), [f]: v === true }
                                } : null);
                              } else {
                                setSelectedOverrides(prev => ({ ...prev, [f]: v === true }));
                              }
                              setEditorDirty(true);
                            }}
                          />
                          <span>{f}</span>
                        </label>
                      ))}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {editMode ?
                        'These override the default role permissions for this user.' :
                        'Click "Edit User" to modify these permissions.'
                      }
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Roles tab removed */}

      {tab === 'security' && (
        <Card className="bg-gray-800 border-gray-700">
          <CardHeader>
            <CardTitle className="text-white">Security Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 bg-gray-700 rounded">
                <h3 className="text-white font-semibold mb-2">Session</h3>
                <ul className="text-gray-300 text-sm space-y-1 list-disc list-inside">
                  <li>Local-only authentication</li>
                  <li>Role stored in localStorage</li>
                </ul>
              </div>
              <div className="p-4 bg-gray-700 rounded">
                <h3 className="text-white font-semibold mb-2">Admin Endpoints</h3>
                <ul className="text-gray-300 text-sm space-y-1 list-disc list-inside">
                  <li>Basic Auth required for app-user CRUD</li>
                  <li>Use secure creds when hosted on Ubuntu (HTTPS → wss://)</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {tab === 'smtp' && (
        <SmtpSettings />
      )}

      {tab === 'cloudflare' && (
        <CloudflareSettings />
      )}
    </div>
  );
};

const FEATURES = ['projects', 'users', 'campaigns', 'templates', 'ai', 'test', 'profiles', 'auditLogs', 'settings', 'smtp'] as const;
type FeatureKey = typeof FEATURES[number];

const RoleMatrixEditor = ({ isAdmin, headers }: { isAdmin: boolean; headers: any }) => {
  const { toast } = useToast();
  const [matrix, setMatrix] = useState<Record<string, Record<FeatureKey, boolean>>>({} as any);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/role-permissions`, { headers });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setMatrix(data);
    } catch (e: any) {
      toast({ title: 'Load failed', description: e?.message || 'Could not load role permissions.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/role-permissions`, { method: 'PUT', headers, body: JSON.stringify(matrix) });
      if (!res.ok) throw new Error(await res.text());
      toast({ title: 'Saved', description: 'Role permissions updated.' });
    } catch (e: any) {
      toast({ title: 'Save failed', description: e?.message || 'Could not save role permissions.', variant: 'destructive' });
    }
  };

  const toggle = (role: string, key: FeatureKey) => {
    setMatrix(prev => ({
      ...prev,
      [role]: { ...(prev[role] || {}), [key]: !(prev[role]?.[key]) },
    }));
  };

  if (loading) return <div className="text-gray-400">Loading role permissions...</div>;

  const roles = Object.keys(matrix);

  return (
    <Card className="bg-gray-800 border-gray-700">
      <CardHeader>
        <CardTitle className="text-white">Roles & Permissions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm text-gray-200">
            <thead>
              <tr>
                <th className="text-left p-2">Feature</th>
                {roles.map(r => (
                  <th key={r} className="text-left p-2 capitalize">{r}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FEATURES.map(f => (
                <tr key={f} className="border-t border-gray-700">
                  <td className="p-2 font-medium">{f}</td>
                  {roles.map(r => (
                    <td key={r + f} className="p-2">
                      <Checkbox disabled={!isAdmin} checked={!!matrix[r]?.[f]} onCheckedChange={() => toggle(r, f)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex gap-2">
          <Button disabled={!isAdmin} onClick={save} className="bg-blue-600 hover:bg-blue-700">Save</Button>
          <Button variant="outline" onClick={load} className="border-gray-600 text-gray-300 hover:bg-gray-700">Reload</Button>
        </div>
        <div className="text-xs text-gray-400">Changes apply to UI on next login. Admin always has full access regardless of matrix.</div>
      </CardContent>
    </Card>
  );
};

const SmtpSettings = () => {
  const { toast } = useToast();
  const [adminUser] = useState(localStorage.getItem('admin-basic-user') || 'admin');
  const [adminPass] = useState(localStorage.getItem('admin-basic-pass') || 'admin');
  const headers = useMemo(() => ({
    'Content-Type': 'application/json',
    'Authorization': 'Basic ' + btoa(`${adminUser}:${adminPass}`),
  }), [adminUser, adminPass]);

  const [form, setForm] = useState({ host: '', port: 587, username: '', password: '', from: '', use_tls: true });
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/settings/smtp`, { headers });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setForm({
        host: data.host || '',
        port: data.port || 587,
        username: data.username || '',
        password: data.password || '',
        from: data.from || '',
        use_tls: data.use_tls !== false,
      });
    } catch (e: any) {
      toast({ title: 'Load failed', description: e?.message || 'Could not load SMTP settings.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/settings/smtp`, { method: 'PUT', headers, body: JSON.stringify(form) });
      if (!res.ok) throw new Error(await res.text());
      toast({ title: 'Saved', description: 'SMTP settings updated.' });
    } catch (e: any) {
      toast({ title: 'Save failed', description: e?.message || 'Could not save SMTP settings.', variant: 'destructive' });
    }
  };

  return (
    <Card className="bg-gray-800 border-gray-700">
      <CardHeader>
        <CardTitle className="text-white">SMTP Configuration</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <Label className="text-gray-300">Host</Label>
            <Input value={form.host} onChange={e => setForm(prev => ({ ...prev, host: e.target.value }))} className="bg-gray-700 border-gray-600 text-white" />
          </div>
          <div>
            <Label className="text-gray-300">Port</Label>
            <Input type="number" value={form.port} onChange={e => setForm(prev => ({ ...prev, port: Number(e.target.value) }))} className="bg-gray-700 border-gray-600 text-white" />
          </div>
          <div>
            <Label className="text-gray-300">From</Label>
            <Input value={form.from} onChange={e => setForm(prev => ({ ...prev, from: e.target.value }))} className="bg-gray-700 border-gray-600 text-white" />
          </div>
          <div>
            <Label className="text-gray-300">Username</Label>
            <Input value={form.username} onChange={e => setForm(prev => ({ ...prev, username: e.target.value }))} className="bg-gray-700 border-gray-600 text-white" />
          </div>
          <div>
            <Label className="text-gray-300">Password</Label>
            <Input type="password" value={form.password} onChange={e => setForm(prev => ({ ...prev, password: e.target.value }))} className="bg-gray-700 border-gray-600 text-white" />
          </div>
          <div className="flex items-end gap-2">
            <Checkbox id="usetls" checked={form.use_tls} onCheckedChange={v => setForm(prev => ({ ...prev, use_tls: v === true }))} />
            <Label htmlFor="usetls" className="text-gray-300">Use TLS</Label>
          </div>
        </div>
        <div className="flex gap-2">
          <Button onClick={save} className="bg-blue-600 hover:bg-blue-700" disabled={loading}>Save</Button>
          <Button variant="outline" onClick={load} className="border-gray-600 text-gray-300 hover:bg-gray-700" disabled={loading}>Reload</Button>
        </div>
      </CardContent>
    </Card>
  );
};


const CloudflareSettings = () => {
  const { toast } = useToast();
  const [adminUser] = useState(localStorage.getItem('admin-basic-user') || 'admin');
  const [adminPass] = useState(localStorage.getItem('admin-basic-pass') || 'admin');
  const headers = useMemo(() => ({
    'Content-Type': 'application/json',
    'Authorization': 'Basic ' + btoa(`${adminUser}:${adminPass}`),
  }), [adminUser, adminPass]);

  const [apiToken, setApiToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  
  // Debug State
  const [debugInfo, setDebugInfo] = useState<any>(null);
  const [showDebug, setShowDebug] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/cloudflare/config`, { headers });
      if (res.ok) {
        const data = await res.json();
        setApiToken(data.api_token || '');
        setSaved(!!data.api_token);
      }
    } catch (e) {
      console.log('Failed to load Cloudflare config:', e);
    } finally {
      setLoading(false);
    }
  };

  const loadDebug = async () => {
    try {
        const res = await fetch(`${API_BASE_URL}/cloudflare/debug`, { headers });
        const data = await res.json();
        setDebugInfo(data.debug_info);
    } catch(e) { console.error("Debug load failed:", e); }
  };

  useEffect(() => { load(); }, []);
  useEffect(() => { if (showDebug) loadDebug(); }, [showDebug]);

  const save = async () => {
    if (!apiToken.trim()) {
      toast({ title: 'API Token Required', description: 'Please enter a Cloudflare API token.', variant: 'destructive' });
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/cloudflare/config`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ api_token: apiToken.trim() })
      });

      if (!res.ok) throw new Error(await res.text());

      const data = await res.json();
      setSaved(true);
      toast({ title: 'Saved!', description: data.message || 'Cloudflare API token saved successfully.' });
      if(showDebug) loadDebug();
    } catch (e: any) {
      toast({ title: 'Save failed', description: e?.message || 'Could not save Cloudflare config.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const testConnection = async () => {
    if (!apiToken.trim()) {
      toast({ title: 'API Token Required', description: 'Please save an API token first.', variant: 'destructive' });
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/cloudflare/test-connection`, { headers });
      if (!res.ok) throw new Error(await res.text());

      const data = await res.json();
      toast({
        title: 'Connection Test',
        description: data.success ? '✅ Successfully connected to Cloudflare API!' : '❌ Connection failed: ' + data.message,
        variant: data.success ? 'default' : 'destructive'
      });
    } catch (e: any) {
      toast({ title: 'Connection Failed', description: e?.message || 'Network error testing connection.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="bg-gray-800 border-gray-700">
      <CardHeader>
        <CardTitle className="text-white flex justify-between items-center">
            <span>Cloudflare API Configuration</span>
            <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => setShowDebug(!showDebug)} 
                className="text-xs text-gray-500 hover:text-gray-300"
            >
                {showDebug ? 'Hide Debug Info' : 'Show Debug Info'}
            </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="bg-blue-900/20 border border-blue-600/30 text-blue-300 text-sm p-4 rounded">
          <p className="font-semibold mb-2">🌐 Setup Instructions:</p>
          <ol className="list-decimal list-inside space-y-1 ml-1">
            <li>Log in to your <a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noopener noreferrer" className="underline hover:text-blue-200">Cloudflare Dashboard</a></li>
            <li>Go to <strong>My Profile → API Tokens</strong></li>
            <li>Click <strong>Create Token</strong></li>
            <li>Use the "<strong>Edit zone DNS</strong>" template or custom permissions:
              <ul className="list-disc list-inside ml-4 mt-1 text-xs opacity-80">
                <li>Zone → DNS → Edit</li>
                <li>Zone → Zone → Read</li>
              </ul>
            </li>
            <li>Select the zones (domains) you want to manage</li>
            <li>Copy the generated API token and paste it below</li>
          </ol>
        </div>

        {showDebug && debugInfo && (
            <div className="bg-black/50 border border-yellow-600/30 text-yellow-500 text-xs p-4 rounded font-mono overflow-x-auto">
                <p className="font-bold text-yellow-400 mb-2">🔍 Server Debug Diagnostics:</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1">
                    <div><span className="text-gray-500">Config Path:</span> {debugInfo.config_file_path}</div>
                    <div><span className="text-gray-500">Exists:</span> <span className={debugInfo.config_file_exists ? "text-green-400" : "text-red-400"}>{String(debugInfo.config_file_exists)}</span></div>
                    <div><span className="text-gray-500">Root Dir:</span> {debugInfo.calculated_root}</div>
                    <div><span className="text-gray-500">Script:</span> {debugInfo.script_path}</div>
                    <div className="col-span-2 border-t border-gray-700 my-1 pt-1"></div>
                    <div><span className="text-gray-500">File Token:</span> {debugInfo.token_sources?.file_token}</div>
                    <div><span className="text-gray-500">Env Token:</span> {debugInfo.token_sources?.env_token}</div>
                    <div><span className="text-gray-500">Tokens Match:</span> <span className={debugInfo.token_sources?.match ? "text-green-400" : "text-red-400"}>{String(debugInfo.token_sources?.match)}</span></div>
                </div>
            </div>
        )}

        <div className="grid grid-cols-1 gap-4">
          <div>
            <Label className="text-gray-300">Cloudflare API Token</Label>
            <Input 
              type="password" 
              value={apiToken} 
              onChange={e => {
                setApiToken(e.target.value);
                setSaved(false);
              }}
              placeholder="Enter your Cloudflare API token"
              className="bg-gray-700 border-gray-600 text-white" 
              disabled={loading}
            />
            <p className="text-xs text-gray-500 mt-1">
              This token will be stored securely on the server and used for domain verification.
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          <Button onClick={save} className="bg-blue-600 hover:bg-blue-700" disabled={loading}>
            {saved ? '✅ Saved' : 'Save'}
          </Button>
          <Button 
            variant="outline" 
            onClick={testConnection} 
            className="border-green-600 text-green-300 hover:bg-green-900/20" 
            disabled={loading || !saved}
          >
            Test Connection
          </Button>
          <Button variant="outline" onClick={load} className="border-gray-600 text-gray-300 hover:bg-gray-700" disabled={loading}>Reload</Button>
        </div>

        {saved && (
          <div className="bg-green-900/20 border border-green-600/30 text-green-300 text-sm p-3 rounded">
            ✅ Cloudflare is configured! You can now use the <strong>Domain Verification</strong> feature.
          </div>
        )}
      </CardContent>
    </Card>
  );
};
