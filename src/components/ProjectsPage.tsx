import { useMemo, useState, useEffect } from 'react';
import { useEnhancedApp } from '@/contexts/EnhancedAppContext';
import { Plus, Server, Trash2, Upload, AlertCircle, CheckCircle, Clock, RefreshCw, Cloud, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';

const API_BASE_URL = (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") ? "http://localhost:8000" : "/api";

export const ProjectsPage = () => {
  const { projects, addProject, removeProject, bulkRemoveProjects, profiles, setProjects, reloadProjectsAndProfiles } = useEnhancedApp();
  const { toast } = useToast();
  const [showAddForm, setShowAddForm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [pageSize, setPageSize] = useState(100);
  const [page, setPage] = useState(1);
  const [formData, setFormData] = useState({
    name: '',
    adminEmail: '',
    apiKey: '',
    serviceAccount: null as File | null,
  });
  const [selectedProfile, setSelectedProfile] = useState<string>(profiles[0]?.id || '');
  const [editingProject, setEditingProject] = useState<any>(null);
  const [editForm, setEditForm] = useState({ name: '', adminEmail: '', apiKey: '', serviceAccount: null });
  const [isEditing, setIsEditing] = useState(false);
  const [analytics, setAnalytics] = useState<{ [projectId: string]: { total_sent: number, sent_today: number, campaigns: number } } | null>(null);
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  const [showGoogleCloudDeleteModal, setShowGoogleCloudDeleteModal] = useState(false);
  const [googleCloudDeleteLoading, setGoogleCloudDeleteLoading] = useState(false);
  const [showAdminServiceAccountModal, setShowAdminServiceAccountModal] = useState(false);
  const [adminServiceAccountFile, setAdminServiceAccountFile] = useState<File | null>(null);
  const [adminServiceAccountLoading, setAdminServiceAccountLoading] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(false);

  // Derived data for scalable rendering
  const [serverTotal, setServerTotal] = useState<number>(projects.length);
  const [visibleProjects, setVisibleProjects] = useState(projects);

  // Server-side pagination & search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    params.set('limit', String(pageSize));
    params.set('offset', String((page - 1) * pageSize));
    if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim());
    // Use the apiCall function from context to ensure proper headers
    const currentUsername = localStorage.getItem('app-username') || 'admin';
    fetch(`${API_BASE_URL}/projects?${params.toString()}`, {
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-App-Username': currentUsername,
      }
    })
      .then(res => res.json())
      .then(data => {
        if (data && Array.isArray(data.projects)) {
          setVisibleProjects(data.projects);
          if (typeof data.total === 'number') setServerTotal(data.total);
        } else {
          setVisibleProjects(projects);
          setServerTotal(projects.length);
        }
      })
      .catch(() => {
        // fallback to client state if backend search not available
        const term = debouncedSearch.trim().toLowerCase();
        const filtered = term
          ? projects.filter(p =>
            p.name?.toLowerCase().includes(term) ||
            p.adminEmail?.toLowerCase().includes(term) ||
            p.id?.toLowerCase().includes(term)
          )
          : projects;
        setVisibleProjects(filtered.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize));
        setServerTotal(filtered.length);
      });
    return () => controller.abort();
  }, [debouncedSearch, page, pageSize, projects]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(serverTotal / pageSize)), [serverTotal, pageSize]);

  useEffect(() => {
    if (!showAnalytics) {
      setAnalytics(null);
      return;
    }
    let cancelled = false;
    // Use proper headers for analytics request
    const currentUsername = localStorage.getItem('app-username') || 'admin';
    fetch(`${API_BASE_URL}/projects/analytics`, {
      headers: {
        'Content-Type': 'application/json',
        'X-App-Username': currentUsername,
      }
    })
      .then(res => res.json())
      .then(data => { if (!cancelled) setAnalytics(data); })
      .catch(() => { if (!cancelled) setAnalytics(null); });
    return () => { cancelled = true; };
  }, [showAnalytics, page, pageSize, serverTotal]);

  // Keep selection valid when paging/filtering changes
  useEffect(() => {
    const visibleIds = new Set(visibleProjects.map(p => p.id));
    setSelectedProjects(prev => prev.filter(id => visibleIds.has(id)));
  }, [page, pageSize, search]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setFormData({ ...formData, serviceAccount: file });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const missingFields = [];
    if (!formData.name) missingFields.push('Project Name');
    if (!formData.adminEmail) missingFields.push('Admin Email');
    if (!formData.apiKey) missingFields.push('API Key');
    if (!formData.serviceAccount) missingFields.push('Service Account File');
    if (!selectedProfile) missingFields.push('Profile');
    if (missingFields.length > 0) {
      console.error('Add Project validation failed:', { ...formData, selectedProfile });
      toast({
        title: "Error",
        description: `Please fill in all fields: ${missingFields.join(', ')}.`,
        variant: "destructive",
      });
      return;
    }
    setIsSubmitting(true);
    try {
      const serviceAccountText = await formData.serviceAccount.text();
      const serviceAccount = JSON.parse(serviceAccountText);
      const projectId = serviceAccount.project_id;
      if (!projectId) {
        throw new Error("Invalid service account file - missing project_id");
      }
      await addProject({
        id: projectId,
        name: formData.name,
        adminEmail: formData.adminEmail,
        apiKey: formData.apiKey,
        serviceAccount,
        profileId: selectedProfile,
      });
      setFormData({ name: '', adminEmail: '', apiKey: '', serviceAccount: null });
      setShowAddForm(false);
      setSelectedProfile(profiles[0]?.id || '');
      toast({
        title: "Success",
        description: "Firebase project added successfully!",
      });
    } catch (error) {
      console.error('❌ Error adding project:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to add project. Check console for details.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRemoveProject = async (id: string, name: string) => {
    if (!id || typeof id !== 'string' || id.trim() === '' || id === 'undefined') {
      console.error('handleRemoveProject: invalid ID', id);
      toast({ title: 'Error', description: 'Invalid project ID.', variant: 'destructive' });
      return;
    }
    try {
      console.log('handleRemoveProject: Deleting project', id);
      await removeProject(id);
      setSelectedProjects(prev => prev.filter(pid => pid !== id));
      reloadProjectsAndProfiles();
      toast({ title: 'Project Removed', description: `Project "${name}" deleted successfully.` });
    } catch (error) {
      console.error('handleRemoveProject: Failed to delete project', id, error);
      toast({ title: 'Error', description: 'Failed to delete project.', variant: 'destructive' });
    }
  };

  const handleReconnectProject = async (projectId: string) => {
    try {
      const currentUsername = localStorage.getItem('app-username') || 'admin';
      const response = await fetch(`${API_BASE_URL}/projects/${projectId}/reconnect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-App-Username': currentUsername,
        }
      });
      const result = await response.json();
      if (result.success) {
        toast({
          title: 'Project Reconnected',
          description: 'Project reconnected successfully.',
        });
        // Update only the reconnected project's status
        // Optionally, refetch projects or update status in place
        // For now, just set status to 'active' for the project
        // (Assumes projects is from context and can be updated)
        // If not, trigger a refetch or reload projects from backend
      } else {
        toast({
          title: 'Reconnect Failed',
          description: result.error || 'Failed to reconnect project.',
          variant: 'destructive',
        });
      }
    } catch (error) {
      toast({
        title: 'Reconnect Failed',
        description: error instanceof Error ? error.message : 'Failed to reconnect project.',
        variant: 'destructive',
      });
    }
  };

  const openEditModal = (project: any) => {
    setEditingProject(project);
    setEditForm({
      name: project.name,
      adminEmail: project.adminEmail,
      apiKey: project.apiKey,
      serviceAccount: null,
    });
  };

  const handleEditFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setEditForm({ ...editForm, serviceAccount: file });
    }
  };

  const handleEditSave = async () => {
    if (!editingProject) return;
    setIsEditing(true);
    try {
      let serviceAccount = editingProject.serviceAccount;
      if (editForm.serviceAccount) {
        const text = await editForm.serviceAccount.text();
        serviceAccount = JSON.parse(text);
      }
      const updated = {
        ...editingProject,
        name: editForm.name,
        adminEmail: editForm.adminEmail,
        apiKey: editForm.apiKey,
        serviceAccount,
      };
      // Send to backend (assume PUT /projects/{project_id})
      const currentUsername = localStorage.getItem('app-username') || 'admin';
      const response = await fetch(`${API_BASE_URL}/projects/${editingProject.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-App-Username': currentUsername,
        },
        body: JSON.stringify(updated),
      });
      const result = await response.json();
      if (result.success) {
        toast({ title: 'Project Updated', description: 'Project updated successfully.' });
        setEditingProject(null);
        // Optionally, update project in state or refetch
      } else {
        toast({ title: 'Update Failed', description: result.error || 'Failed to update project.', variant: 'destructive' });
      }
    } catch (error) {
      toast({ title: 'Update Failed', description: error instanceof Error ? error.message : 'Failed to update project.', variant: 'destructive' });
    } finally {
      setIsEditing(false);
    }
  };

  const handleSelectProject = (projectId: string, checked: boolean) => {
    setSelectedProjects(prev =>
      checked ? [...prev, projectId] : prev.filter(id => id !== projectId)
    );
  };

  const handleSelectAllProjects = (checked: boolean) => {
    if (checked) {
      setSelectedProjects(visibleProjects.map(p => p.id));
    } else {
      setSelectedProjects([]);
    }
  };

  const handleBulkDeleteProjects = async () => {
    const validSelectedProjects = selectedProjects.filter(id => id && typeof id === 'string' && id.trim() !== '' && id !== 'undefined');
    if (validSelectedProjects.length === 0) {
      toast({ title: 'No Projects Selected', description: 'Please select valid projects to delete.', variant: 'destructive' });
      return;
    }
    if (!confirm(`Are you sure you want to delete ${validSelectedProjects.length} selected projects?`)) return;
    try {
      console.log('handleBulkDeleteProjects: Deleting projects', validSelectedProjects);
      await bulkRemoveProjects(validSelectedProjects);
      setSelectedProjects([]);
      // Force a complete data refresh
      await reloadProjectsAndProfiles();
      toast({ title: 'Projects Deleted', description: `${validSelectedProjects.length} project(s) deleted successfully.` });
    } catch (error) {
      console.error('handleBulkDeleteProjects: Failed to delete projects', validSelectedProjects, error);
      toast({ title: 'Error', description: 'Failed to delete projects.', variant: 'destructive' });
    }
  };

  const handleDeleteFromGoogleCloud = async (projectId: string, projectName: string) => {
    if (!confirm(`⚠️ WARNING: This will PERMANENTLY delete the Firebase project "${projectName}" from Google Cloud Console.\n\nThis action cannot be undone and will remove all data, users, and configurations.\n\nAre you absolutely sure you want to proceed?`)) {
      return;
    }

    try {
      const currentUsername = localStorage.getItem('app-username') || 'admin';
      const response = await fetch(`${API_BASE_URL}/projects/${projectId}/google-cloud`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'X-App-Username': currentUsername,
        }
      });

      const result = await response.json();

      if (response.ok && result.success) {
        toast({
          title: "Project Deleted from Google Cloud",
          description: `Project "${projectName}" has been permanently deleted from Google Cloud Console.`,
        });
        await reloadProjectsAndProfiles();
      } else {
        throw new Error(result.detail || result.error || 'Failed to delete project from Google Cloud');
      }
    } catch (error) {
      console.error('Google Cloud delete error:', error);
      toast({
        title: "Delete Failed",
        description: error instanceof Error ? error.message : "Failed to delete project from Google Cloud.",
        variant: "destructive",
      });
    }
  };

  const handleBulkDeleteFromGoogleCloud = async () => {
    if (selectedProjects.length === 0) {
      toast({
        title: "No Projects Selected",
        description: "Please select at least one project to delete from Google Cloud.",
        variant: "destructive",
      });
      return;
    }

    const projectNames = selectedProjects.map(id => {
      const project = projects.find(p => p.id === id);
      return project?.name || id;
    });

    const warningMessage = `⚠️ WARNING: This will PERMANENTLY delete ${selectedProjects.length} Firebase project(s) from Google Cloud Console:\n\n${projectNames.join('\n')}\n\nThis action cannot be undone and will remove all data, users, and configurations.\n\nAre you absolutely sure you want to proceed?`;

    if (!confirm(warningMessage)) {
      return;
    }

    setGoogleCloudDeleteLoading(true);
    try {
      const currentUsername = localStorage.getItem('app-username') || 'admin';
      const response = await fetch(`${API_BASE_URL}/projects/bulk-delete-google-cloud`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-App-Username': currentUsername,
        },
        body: JSON.stringify({
          projectIds: selectedProjects,
        }),
      });

      const result = await response.json();

      if (response.ok && result.success) {
        toast({
          title: "Projects Deleted from Google Cloud",
          description: `Successfully deleted ${result.summary.successful} project(s) from Google Cloud Console.`,
        });
        setSelectedProjects([]);
        await reloadProjectsAndProfiles();
      } else {
        // Handle partial success
        if (result.summary && result.summary.successful > 0) {
          toast({
            title: "Partial Success",
            description: `Deleted ${result.summary.successful} project(s) from Google Cloud. ${result.summary.failed} failed.`,
          });
          setSelectedProjects([]);
          await reloadProjectsAndProfiles();
        } else {
          throw new Error(result.detail || result.error || 'Failed to delete projects from Google Cloud');
        }
      }
    } catch (error) {
      console.error('Bulk Google Cloud delete error:', error);
      toast({
        title: "Delete Failed",
        description: error instanceof Error ? error.message : "Failed to delete projects from Google Cloud.",
        variant: "destructive",
      });
    } finally {
      setGoogleCloudDeleteLoading(false);
    }
  };

  const handleAdminServiceAccountUpload = async () => {
    if (!adminServiceAccountFile) {
      toast({
        title: "No File Selected",
        description: "Please select an admin service account JSON file.",
        variant: "destructive",
      });
      return;
    }

    setAdminServiceAccountLoading(true);
    try {
      const serviceAccountText = await adminServiceAccountFile.text();
      const serviceAccount = JSON.parse(serviceAccountText);

      const currentUsername = localStorage.getItem('app-username') || 'admin';
      const response = await fetch(`${API_BASE_URL}/admin/service-account`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-App-Username': currentUsername,
          'Authorization': 'Basic ' + btoa('admin:admin')
        },
        body: JSON.stringify({
          serviceAccount
        }),
      });

      const result = await response.json();

      if (response.ok && result.success) {
        toast({
          title: "Admin Service Account Uploaded",
          description: "Admin service account has been uploaded successfully. You can now delete projects from Google Cloud.",
        });
        setShowAdminServiceAccountModal(false);
        setAdminServiceAccountFile(null);
      } else {
        throw new Error(result.detail || result.error || 'Failed to upload admin service account');
      }
    } catch (error) {
      console.error('Admin service account upload error:', error);
      toast({
        title: "Upload Failed",
        description: error instanceof Error ? error.message : "Failed to upload admin service account.",
        variant: "destructive",
      });
    } finally {
      setAdminServiceAccountLoading(false);
    }
  };

  const [showBulkImportModal, setShowBulkImportModal] = useState(false);
  const [bulkImportLoading, setBulkImportLoading] = useState(false);
  const [bulkImportResults, setBulkImportResults] = useState<any>(null);
  const [bulkCredentialsFile, setBulkCredentialsFile] = useState<File | null>(null);
  const [bulkServiceAccountFiles, setBulkServiceAccountFiles] = useState<FileList | null>(null);

  const handleBulkImportV2 = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bulkCredentialsFile || !bulkServiceAccountFiles || bulkServiceAccountFiles.length === 0) {
      toast({
        title: "Missing Files",
        description: "Please upload both credentials file and service account JSONs.",
        variant: "destructive",
      });
      return;
    }

    if (!selectedProfile) {
      toast({
        title: "Missing Profile",
        description: "Please select a profile to assign projects to.",
        variant: "destructive"
      });
      return;
    }

    setBulkImportLoading(true);
    const formData = new FormData();
    formData.append('profile_id', selectedProfile);
    formData.append('credentials_file', bulkCredentialsFile);

    for (let i = 0; i < bulkServiceAccountFiles.length; i++) {
      formData.append('service_accounts', bulkServiceAccountFiles[i]);
    }

    try {
      const currentUsername = localStorage.getItem('app-username') || 'admin';
      const res = await fetch(`${API_BASE_URL}/projects/bulk-import-v2`, {
        method: 'POST',
        headers: {
          'X-App-Username': currentUsername,
        },
        body: formData
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Server error: ${errorText}`);
      }

      const result = await res.json();

      toast({
        title: "Bulk Import Complete",
        description: `Successful: ${result.successful}, Failed: ${result.failed}`,
        variant: result.failed > 0 ? "destructive" : "default"
      });

      if (result.failed > 0) {
        console.error("Bulk import failures:", result.details);
      }

      setShowBulkImportModal(false);
      setBulkCredentialsFile(null);
      setBulkServiceAccountFiles(null);
      await reloadProjectsAndProfiles();

    } catch (error) {
      console.error('Bulk import error:', error);
      toast({
        title: "Import Failed",
        description: error instanceof Error ? error.message : "Failed to process bulk import",
        variant: "destructive"
      });
    } finally {
      setBulkImportLoading(false);
    }
  };

  const handleAutomatedBulkImport = async () => {
    if (!selectedProfile) {
      toast({
        title: "Missing Profile",
        description: "Please select a profile to assign projects to.",
        variant: "destructive"
      });
      return;
    }

    setBulkImportLoading(true);
    try {
      const currentUsername = localStorage.getItem('app-username') || 'admin';
      const res = await fetch(`${API_BASE_URL}/projects/bulk-import-automated`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-App-Username': currentUsername,
        },
        body: JSON.stringify({ profileId: selectedProfile })
      });

      if (!res.ok) {
        const result = await res.json();
        throw new Error(result.detail || result.error || 'Failed to process automated bulk import');
      }

      const result = await res.json();
      setBulkImportResults(result);

      if (result.failed > 0) {
        toast({
          title: "Import Complete with Errors",
          description: `Successful: ${result.successful}, Failed: ${result.failed}. Check details below.`,
          variant: "destructive"
        });
      } else {
        toast({
          title: "Automated Import Successful",
          description: `Successfully imported ${result.successful} projects.`,
        });
        setShowBulkImportModal(false);
      }

      await reloadProjectsAndProfiles();

    } catch (error) {
      console.error('Automated import error:', error);
      toast({
        title: "Import Failed",
        description: error instanceof Error ? error.message : "Failed to process automated bulk import",
        variant: "destructive"
      });
    } finally {
      setBulkImportLoading(false);
    }
  };


  return (
    <div className="p-8 space-y-8">
      <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Firebase Projects</h1>
          <p className="text-gray-400">Manage your Firebase projects for email campaigns</p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <Input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search by name, email or ID..."
            className="bg-gray-800/60 border-gray-700 text-white w-64"
          />
          <select
            value={pageSize}
            onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}
            className="bg-gray-800/60 border border-gray-700 text-white px-2 py-2 rounded"
            title="Items per page"
          >
            <option value={15}>15</option>
            <option value={30}>30</option>
            <option value={60}>60</option>
            <option value={120}>120</option>
          </select>
          <label className="flex items-center gap-2 text-gray-300 ml-2">
            <Checkbox checked={showAnalytics} onCheckedChange={(v) => setShowAnalytics(v === true)} />
            <span className="text-sm">Show analytics</span>
          </label>
          <Checkbox
            checked={visibleProjects.length > 0 && selectedProjects.length === visibleProjects.length}
            onCheckedChange={handleSelectAllProjects}
            className="border-gray-500"
          />
          <span className="text-gray-300">Select All</span>
          {selectedProjects.length > 0 && (
            <>
              <Button
                onClick={handleBulkDeleteProjects}
                variant="destructive"
                className="bg-red-600 hover:bg-red-700"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete Selected ({selectedProjects.length})
              </Button>
              <Button
                onClick={handleBulkDeleteFromGoogleCloud}
                variant="destructive"
                className="bg-orange-600 hover:bg-orange-700"
                disabled={googleCloudDeleteLoading}
              >
                <Cloud className="w-4 h-4 mr-2" />
                {googleCloudDeleteLoading ? 'Deleting...' : `Delete from Google Cloud (${selectedProjects.length})`}
              </Button>
            </>
          )}
          <Button
            onClick={() => setShowAddForm(true)}
            className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Project
          </Button>
          <Button
            onClick={() => setShowBulkImportModal(true)}
            className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700"
          >
            <Upload className="w-4 h-4 mr-2" />
            Bulk Import
          </Button>
          <Button
            onClick={handleAutomatedBulkImport}
            className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700"
            disabled={bulkImportLoading}
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            {bulkImportLoading ? 'Auto-Loading...' : 'Auto-Load Credentials'}
          </Button>
          <Button
            onClick={() => setShowAdminServiceAccountModal(true)}
            variant="outline"
            className="border-orange-500 text-orange-400 hover:bg-orange-900/20"
          >
            <Cloud className="w-4 h-4 mr-2" />
            Admin Service Account
          </Button>
          <Button
            variant="outline"
            onClick={async () => {
              try {
                const currentUsername = localStorage.getItem('app-username') || 'admin';
                await Promise.all(visibleProjects.map(p => fetch(`${API_BASE_URL}/projects/${p.id}/reconnect`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'X-App-Username': currentUsername,
                  }
                })));
                toast({ title: 'Reconnect Triggered', description: 'Reconnect initiated for visible projects.' });
                await reloadProjectsAndProfiles();
              } catch {
                toast({ title: 'Reconnect Failed', description: 'Some projects failed to reconnect.', variant: 'destructive' });
              }
            }}
            className="border-blue-600 text-blue-400 hover:bg-blue-900/20"
          >
            <RefreshCw className="w-4 h-4 mr-2" /> Reconnect Visible
          </Button>
        </div>
      </div>

      <Alert className="bg-blue-900/20 border-blue-500/50">
        <AlertCircle className="h-4 w-4 text-blue-400" />
        <AlertDescription className="text-blue-300">
          Make sure your backend is running on port 8000. Check the console for connection status.
        </AlertDescription>
      </Alert>

      <Alert className="bg-orange-900/20 border-orange-500/50">
        <AlertTriangle className="h-4 w-4 text-orange-400" />
        <AlertDescription className="text-orange-300">
          <strong>⚠️ Google Cloud Deletion:</strong> The "Delete from Google Cloud" feature will permanently delete Firebase projects from Google Cloud Console. This action cannot be undone and will remove all data, users, and configurations. Use with extreme caution.
        </AlertDescription>
      </Alert>

      {showAddForm && (
        <Card className="bg-gray-800 border-gray-700">
          <CardHeader>
            <CardTitle className="text-white">Add New Firebase Project</CardTitle>
          </CardHeader>
          <CardContent>
            {profiles.length === 0 ? (
              <div className="text-center text-red-400 py-8">
                <p className="mb-4">You must create a profile before adding a project.</p>
                <Button onClick={() => window.location.hash = '#/profiles'} className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700">Go to Profile Manager</Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <Label htmlFor="profile" className="text-gray-300">Assign to Profile</Label>
                  <select
                    id="profile"
                    value={selectedProfile}
                    onChange={e => setSelectedProfile(e.target.value)}
                    className="bg-gray-700 border-gray-600 text-white w-full p-2 rounded"
                    disabled={isSubmitting}
                  >
                    {profiles.map(profile => (
                      <option key={profile.id} value={profile.id}>{profile.name}</option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="name" className="text-gray-300">Project Name</Label>
                    <Input
                      id="name"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="My Firebase Project"
                      className="bg-gray-700 border-gray-600 text-white"
                      disabled={isSubmitting}
                    />
                  </div>
                  <div>
                    <Label htmlFor="adminEmail" className="text-gray-300">Admin Email</Label>
                    <Input
                      id="adminEmail"
                      type="email"
                      value={formData.adminEmail}
                      onChange={(e) => setFormData({ ...formData, adminEmail: e.target.value })}
                      placeholder="admin@example.com"
                      className="bg-gray-700 border-gray-600 text-white"
                      disabled={isSubmitting}
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="apiKey" className="text-gray-300">Firebase Web API Key</Label>
                  <Input
                    id="apiKey"
                    value={formData.apiKey}
                    onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
                    placeholder="AIzaSyA2NT9UVavk0yiWOPJIz76NX7vnfzq6_s8"
                    className="bg-gray-700 border-gray-600 text-white"
                    disabled={isSubmitting}
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    Find this in Firebase Console → Project Settings → General → Web API Key
                  </p>
                </div>

                <div>
                  <Label htmlFor="serviceAccount" className="text-gray-300">Service Account JSON</Label>
                  <div className="mt-2">
                    <input
                      id="serviceAccount"
                      type="file"
                      accept=".json"
                      onChange={handleFileChange}
                      className="hidden"
                      disabled={isSubmitting}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => document.getElementById('serviceAccount')?.click()}
                      className="border-gray-600 text-gray-300 hover:bg-gray-700"
                      disabled={isSubmitting}
                    >
                      <Upload className="w-4 h-4 mr-2" />
                      {formData.serviceAccount ? formData.serviceAccount.name : 'Upload JSON File'}
                    </Button>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">
                    Download from Firebase Console → Project Settings → Service Accounts → Generate New Private Key
                  </p>
                </div>

                <div className="flex gap-2">
                  <Button
                    type="submit"
                    className="bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800"
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? 'Adding...' : 'Add Project'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowAddForm(false)}
                    className="border-gray-600 text-gray-300 hover:bg-gray-700"
                    disabled={isSubmitting}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {visibleProjects.filter(p => p && typeof p.id === 'string' && p.id.trim() !== '' && p.id !== 'undefined').map((project) => (
          <Card key={project.id} className="bg-gray-800 border-gray-700 hover:bg-gray-750 transition-colors">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={selectedProjects.includes(project.id)}
                  onCheckedChange={checked => handleSelectProject(project.id, checked === true)}
                  className="border-gray-500"
                />
                <CardTitle className="text-lg font-semibold text-white flex items-center gap-2">
                  <Server className="w-5 h-5 text-blue-500" />
                  {project.name}
                </CardTitle>
              </div>
              <div className="flex items-center gap-2">
                {project.status === 'active' && <CheckCircle className="w-4 h-4 text-green-500" />}
                {project.status === 'error' && <AlertCircle className="w-4 h-4 text-red-500" />}
                {project.status === 'loading' && <Clock className="w-4 h-4 text-yellow-500" />}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (project.id) {
                      console.log('Delete button clicked for project ID:', project.id);
                      handleRemoveProject(project.id, project.name);
                    } else {
                      console.error('Delete button clicked for project with undefined ID!');
                    }
                  }}
                  className="text-red-400 hover:text-red-300 hover:bg-red-900/20"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleReconnectProject(project.id)}
                  className="text-blue-400 hover:text-blue-300 hover:bg-blue-900/20"
                  title="Reconnect"
                >
                  <RefreshCw className="w-4 h-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => openEditModal(project)}
                  className="text-yellow-400 hover:text-yellow-300 hover:bg-yellow-900/20"
                  title="Edit"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536M9 13l6.536-6.536a2 2 0 112.828 2.828L11.828 15.828a4 4 0 01-1.414.828l-4.243 1.414 1.414-4.243a4 4 0 01.828-1.414z" /></svg>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDeleteFromGoogleCloud(project.id, project.name)}
                  className="text-orange-400 hover:text-orange-300 hover:bg-orange-900/20"
                  title="Delete from Google Cloud"
                >
                  <Cloud className="w-4 h-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div>
                  <p className="text-gray-400 text-sm">Admin Email</p>
                  <p className="text-white">{project.adminEmail}</p>
                </div>
                <div>
                  <p className="text-gray-400 text-sm">Project ID</p>
                  <p className="text-white font-mono text-sm">
                    {project.serviceAccount?.project_id || project.id}
                  </p>
                </div>
                <div>
                  <p className="text-gray-400 text-sm">Status</p>
                  <p className={`text-sm font-medium ${project.status === 'active' ? 'text-green-400' :
                    project.status === 'error' ? 'text-red-400' : 'text-yellow-400'
                    }`}>
                    {project.status === 'active' ? 'Connected' :
                      project.status === 'error' ? 'Connection Failed' : 'Connecting...'}
                  </p>
                </div>
                <div>
                  <p className="text-gray-400 text-sm">Created</p>
                  <p className="text-white text-sm">
                    {new Date(project.createdAt).toLocaleDateString()}
                  </p>
                </div>
                {showAnalytics && analytics && analytics[project.id] && (
                  <div className="bg-gray-900/40 rounded p-2 mt-2">
                    <div className="text-xs text-blue-300 font-semibold mb-1">Analytics</div>
                    <div className="flex flex-wrap gap-4 text-xs text-gray-300">
                      <span>Total Sent: <span className="text-white font-bold">{analytics[project.id].total_sent}</span></span>
                      <span>Sent Today: <span className="text-white font-bold">{analytics[project.id].sent_today}</span></span>
                      <span>Campaigns: <span className="text-white font-bold">{analytics[project.id].campaigns}</span></span>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-center gap-4 mt-6">
        <Button
          variant="outline"
          onClick={() => setPage(p => Math.max(1, p - 1))}
          className="border-gray-600 text-gray-300 hover:bg-gray-700"
          disabled={page <= 1}
        >
          Prev
        </Button>
        <span className="text-gray-300 text-sm">Page {page} / {totalPages} • {serverTotal} item(s)</span>
        <Button
          variant="outline"
          onClick={() => setPage(p => Math.min(totalPages, p + 1))}
          className="border-gray-600 text-gray-300 hover:bg-gray-700"
          disabled={page >= totalPages}
        >
          Next
        </Button>
      </div>

      {projects.length === 0 && !showAddForm && (
        <Card className="bg-gray-800 border-gray-700">
          <CardContent className="py-12 text-center">
            <Server className="w-12 h-12 text-gray-500 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-white mb-2">No Firebase Projects</h3>
            <p className="text-gray-400 mb-6">
              Add your first Firebase project to start sending password reset emails.
            </p>
            <Button
              onClick={() => setShowAddForm(true)}
              className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Your First Project
            </Button>
          </CardContent>
        </Card>
      )}

      {editingProject && (
        <Dialog open={!!editingProject} onOpenChange={() => setEditingProject(null)}>
          <DialogContent className="bg-gray-800 border-gray-700 max-w-lg">
            <DialogHeader>
              <DialogTitle className="text-white">Edit Project</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label className="text-gray-300">Project Name</Label>
                <Input
                  value={editForm.name}
                  onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                  className="bg-gray-700 border-gray-600 text-white"
                />
              </div>
              <div>
                <Label className="text-gray-300">Admin Email</Label>
                <Input
                  value={editForm.adminEmail}
                  onChange={e => setEditForm({ ...editForm, adminEmail: e.target.value })}
                  className="bg-gray-700 border-gray-600 text-white"
                />
              </div>
              <div>
                <Label className="text-gray-300">API Key</Label>
                <Input
                  value={editForm.apiKey}
                  onChange={e => setEditForm({ ...editForm, apiKey: e.target.value })}
                  className="bg-gray-700 border-gray-600 text-white"
                />
              </div>
              <div>
                <Label className="text-gray-300">Service Account JSON</Label>
                <input
                  type="file"
                  accept=".json"
                  onChange={handleEditFileChange}
                  className="text-white"
                />
              </div>
              <div className="flex gap-2">
                <Button onClick={handleEditSave} disabled={isEditing} className="bg-green-600 hover:bg-green-700">
                  {isEditing ? 'Saving...' : 'Save Changes'}
                </Button>
                <Button variant="outline" onClick={() => setEditingProject(null)} className="border-gray-600 text-gray-300 hover:bg-gray-700">
                  Cancel
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {showAdminServiceAccountModal && (
        <Dialog open={showAdminServiceAccountModal} onOpenChange={setShowAdminServiceAccountModal}>
          <DialogContent className="bg-gray-800 border-gray-700 max-w-lg">
            <DialogHeader>
              <DialogTitle className="text-white">Upload Admin Service Account</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="text-sm text-gray-300">
                <p className="mb-2">
                  Upload an admin service account JSON file to enable Google Cloud project deletion.
                </p>
                <p className="text-orange-400 font-medium">
                  ⚠️ This service account must have permission to delete projects in your Google Cloud organization.
                </p>
              </div>

              <div>
                <Label className="text-gray-300">Admin Service Account JSON</Label>
                <div className="mt-2">
                  <input
                    type="file"
                    accept=".json"
                    onChange={(e) => setAdminServiceAccountFile(e.target.files?.[0] || null)}
                    className="text-white"
                  />
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  Download from Google Cloud Console → IAM & Admin → Service Accounts → Create/Select → Keys → Add Key → JSON
                </p>
              </div>

              <div className="flex gap-2">
                <Button
                  onClick={handleAdminServiceAccountUpload}
                  disabled={adminServiceAccountLoading || !adminServiceAccountFile}
                  className="bg-orange-600 hover:bg-orange-700"
                >
                  {adminServiceAccountLoading ? 'Uploading...' : 'Upload Admin Service Account'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setShowAdminServiceAccountModal(false)}
                  className="border-gray-600 text-gray-300 hover:bg-gray-700"
                >
                  Cancel
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {showBulkImportModal && (
        <Dialog open={showBulkImportModal} onOpenChange={setShowBulkImportModal}>
          <DialogContent className="bg-gray-800 border-gray-700 text-white max-w-2xl">
            <DialogHeader>
              <DialogTitle>Bulk Import Projects</DialogTitle>
              <div className="text-sm text-gray-400">
                Upload a text file with credentials and the corresponding JSON service account files.
                <br />
                Text file format per line: email project_id api_key json_filename
              </div>
            </DialogHeader>
            <form onSubmit={handleBulkImportV2} className="space-y-4">
              <div>
                <Label className="text-gray-300">Assign to Profile</Label>
                <select
                  value={selectedProfile}
                  onChange={e => setSelectedProfile(e.target.value)}
                  className="bg-gray-700 border-gray-600 text-white w-full p-2 rounded mt-1"
                  disabled={bulkImportLoading}
                >
                  {profiles.map(profile => (
                    <option key={profile.id} value={profile.id}>{profile.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <Label className="text-gray-300">Credentials File (.txt)</Label>
                <Input
                  type="file"
                  accept=".txt"
                  onChange={(e) => setBulkCredentialsFile(e.target.files?.[0] || null)}
                  className="bg-gray-700 border-gray-600 text-white mt-1"
                  disabled={bulkImportLoading}
                />
              </div>

              <div>
                <Label className="text-gray-300">Service Account JSONs (Multiple)</Label>
                <Input
                  type="file"
                  accept=".json"
                  multiple
                  onChange={(e) => setBulkServiceAccountFiles(e.target.files)}
                  className="bg-gray-700 border-gray-600 text-white mt-1"
                  disabled={bulkImportLoading}
                />
                <p className="text-xs text-gray-400 mt-1">
                  Select all relevant JSON files. Filenames must match the entries in your text file.
                </p>
              </div>

              {bulkImportResults && (
                <div className="mt-4 p-3 bg-gray-900 rounded border border-gray-700 max-h-40 overflow-y-auto">
                  <h4 className="text-sm font-semibold text-gray-300 mb-2 flex justify-between">
                    <span>Import Results</span>
                    <span className="text-xs">
                      {bulkImportResults.successful} OK, {bulkImportResults.failed} Failed
                    </span>
                  </h4>
                  <div className="space-y-1">
                    {bulkImportResults.details?.map((detail: any, idx: number) => (
                      <div key={idx} className={`text-xs p-1 rounded ${detail.status === 'Success' ? 'text-emerald-400 bg-emerald-400/10' : 'text-red-400 bg-red-400/10'}`}>
                        Line {detail.line}: {detail.project_id || 'Unknown'} - {detail.status || 'Failed'}
                        {detail.error && <span className="block opacity-80 mt-1">{detail.error}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex flex-col sm:flex-row justify-between items-center gap-4 mt-4 pt-4 border-t border-gray-700">
                <div className="text-xs text-gray-400 max-w-[200px]">
                  <p>Skip uploads? Ensure files are in the <code className="text-purple-400">credentials/</code> folder on the server.</p>
                </div>

                <div className="flex gap-2 w-full sm:w-auto">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowBulkImportModal(false)}
                    className="flex-1 sm:flex-none border-gray-600 text-gray-300 hover:bg-gray-700"
                    disabled={bulkImportLoading}
                  >
                    Cancel
                  </Button>

                  <Button
                    type="button"
                    onClick={handleAutomatedBulkImport}
                    className="flex-1 sm:flex-none bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700"
                    disabled={bulkImportLoading}
                  >
                    <RefreshCw className="w-4 h-4 mr-2" />
                    {bulkImportLoading ? 'Auto-Loading...' : 'Auto-Load Credentials'}
                  </Button>

                  <Button
                    type="submit"
                    className="flex-1 sm:flex-none bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700"
                    disabled={bulkImportLoading || !bulkCredentialsFile || !bulkServiceAccountFiles}
                  >
                    {bulkImportLoading ? 'Importing...' : 'Start Manual Import'}
                  </Button>
                </div>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};
