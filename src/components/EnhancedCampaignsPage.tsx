import { useState, useEffect, useRef } from 'react';
import { useEnhancedApp } from '@/contexts/EnhancedAppContext';
import {
  Zap,
  Plus,
  Play,
  Pause,
  Trash2,
  Users,
  Settings,
  Mail,
  FolderOpen,
  Rocket,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  Edit2,
  Copy
} from 'lucide-react';
import { SendingModeSelector, SendingModeConfig } from './SendingModeSelector';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { EnhancedCampaignMonitor } from './EnhancedCampaignMonitor';
import { Dialog as ConfirmDialog, DialogContent as ConfirmDialogContent, DialogHeader as ConfirmDialogHeader, DialogTitle as ConfirmDialogTitle } from '@/components/ui/dialog';

const API_BASE_URL = (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") ? "http://localhost:8000" : "/api";

export const EnhancedCampaignsPage = () => {
  const {
    campaigns,
    projects,
    profiles,
    users,
    activeProfile,
    currentCampaign,
    createCampaign,
    deleteCampaign,
    loadUsers,
    updateCampaign,
    loadCampaigns,
    startCampaign,
  } = useEnhancedApp();
  const { toast } = useToast();

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<any | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<string>('');
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<{ [projectId: string]: string[] }>({});
  const [campaignName, setCampaignName] = useState('');
  const [batchSize, setBatchSize] = useState(50);
  const [workers, setWorkers] = useState(5);
  const [loadingUsers, setLoadingUsers] = useState<{ [key: string]: boolean }>({});

  // NEW: Sending mode configuration
  const [sendingMode, setSendingMode] = useState<SendingModeConfig>({
    mode: 'turbo',
    turbo_config: { auto: true }
  });
  const [selectedCampaigns, setSelectedCampaigns] = useState<string[]>([]);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCampaigns, setTotalCampaigns] = useState(0);
  const [campaignsPerPage] = useState(10);

  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [campaignsToDelete, setCampaignsToDelete] = useState<string[]>([]);

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  // Initialize with active profile
  useEffect(() => {
    if (activeProfile && !selectedProfile) {
      setSelectedProfile(activeProfile);
    }
  }, [activeProfile, selectedProfile]);

  // Load campaigns with pagination
  useEffect(() => {
    const loadCampaignsWithPagination = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/campaigns?page=${currentPage}&limit=${campaignsPerPage}`);
        const data = await response.json();

        if (response.ok) {
          // Update campaigns in context
          if (data.campaigns) {
            // This assumes your context has a method to update campaigns
            // You might need to adjust this based on your context structure
            data.campaigns.forEach((campaign: any) => {
              // Update campaign in context if needed
            });
          }

          // Update pagination info
          if (data.pagination) {
            setTotalPages(data.pagination.total_pages);
            setTotalCampaigns(data.pagination.total);
          }
        }
      } catch (error) {
        console.error('Failed to load campaigns:', error);
      }
    };

    loadCampaignsWithPagination();
  }, [currentPage, campaignsPerPage]);

  // Filter projects by selected profile
  const profileProjects = selectedProfile
    ? projects.filter(p => p.profileId === selectedProfile && p.status === 'active')
    : [];

  // Load users when projects are selected
  useEffect(() => {
    const loadProjectUsers = async () => {
      console.log('Loading users for selected projects:', selectedProjects);
      for (const projectId of selectedProjects) {
        if (!users[projectId] && !loadingUsers[projectId]) {
          console.log(`Loading users for project ID: ${projectId}`);
          setLoadingUsers(prev => ({ ...prev, [projectId]: true }));
          try {
            await loadUsers(projectId);
            console.log(`Successfully loaded users for project ID: ${projectId}`);
          } catch (error) {
            console.error(`Failed to load users for project ${projectId}:`, error);
            toast({
              title: "Failed to load users",
              description: `Could not load users for project. Please check your backend connection.`,
              variant: "destructive",
            });
          } finally {
            setLoadingUsers(prev => ({ ...prev, [projectId]: false }));
          }
        }
      }
    };

    if (selectedProjects.length > 0) {
      loadProjectUsers();
    }
  }, [selectedProjects, loadUsers, toast]);

  const handleProfileChange = (profileId: string) => {
    setSelectedProfile(profileId);
    setSelectedProjects([]);
    setSelectedUsers({});
  };

  const handleProjectToggle = (projectId: string) => {
    setSelectedProjects(prev => {
      const newSelected = prev.includes(projectId)
        ? prev.filter(id => id !== projectId)
        : [...prev, projectId];

      // Clear selected users for removed projects
      if (!newSelected.includes(projectId)) {
        setSelectedUsers(prev => {
          const newUsers = { ...prev };
          delete newUsers[projectId];
          return newUsers;
        });
      }

      return newSelected;
    });
  };

  const handleUserToggle = (projectId: string, userId: string) => {
    setSelectedUsers(prev => ({
      ...prev,
      [projectId]: prev[projectId]?.includes(userId)
        ? prev[projectId].filter(id => id !== userId)
        : [...(prev[projectId] || []), userId]
    }));
  };

  const handleSelectAllUsers = (projectId: string) => {
    const projectUsers = users[projectId] || [];
    const currentSelected = selectedUsers[projectId] || [];

    if (currentSelected.length === projectUsers.length) {
      // Deselect all
      setSelectedUsers(prev => ({ ...prev, [projectId]: [] }));
    } else {
      // Select all
      setSelectedUsers(prev => ({
        ...prev,
        [projectId]: projectUsers.map(u => u.uid)
      }));
    }
  };



  const getTotalSelectedUsers = () => {
    return Object.values(selectedUsers).reduce((sum, userIds) => sum + userIds.length, 0);
  };

  const getCampaignStatusIcon = (status: string) => {
    switch (status) {
      case 'pending':
        return <Clock className="w-4 h-4 text-yellow-500" />;
      case 'running':
        return <Play className="w-4 h-4 text-blue-500" />;
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-500" />;
      case 'paused':
        return <Pause className="w-4 h-4 text-orange-500" />;
      default:
        return <AlertCircle className="w-4 h-4 text-gray-500" />;
    }
  };

  const handleSelectCampaign = (campaignId: string, checked: boolean) => {
    setSelectedCampaigns(prev =>
      checked ? [...prev, campaignId] : prev.filter(id => id !== campaignId)
    );
  };

  const handleSelectAllCampaigns = (checked: boolean) => {
    if (checked) {
      setSelectedCampaigns(campaigns.map(c => c.id));
    } else {
      setSelectedCampaigns([]);
    }
  };

  const handleDeleteSelectedCampaigns = async () => {
    const running = campaigns.filter(c => selectedCampaigns.includes(c.id) && c.status === 'running');
    if (running.length > 0) {
      setCampaignsToDelete(selectedCampaigns);
      setShowDeleteConfirm(true);
      return;
    }
    await actuallyDeleteCampaigns(selectedCampaigns);
  };

  const actuallyDeleteCampaigns = async (ids: string[]) => {
    if (ids.length === 0) return;
    try {
      const response = await fetch(`${API_BASE_URL}/campaigns/bulk-delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ids),
      });
      const data = await response.json();
      setSelectedCampaigns([]);
      await loadCampaigns();
      toast({
        title: 'Campaigns Deleted',
        description: `${data.deleted.length} campaign(s) have been deleted.`,
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to delete campaigns.',
        variant: 'destructive',
      });
    }
  };

  const handleEditCampaign = (campaign: any) => {
    setEditingCampaign(campaign);
    setCampaignName(campaign.name);
    setSelectedProjects([...campaign.projectIds]);
    setSelectedUsers({ ...campaign.selectedUsers });
    setBatchSize(campaign.batchSize);
    setWorkers(campaign.workers);
    // Load sending mode configuration
    setSendingMode({
      mode: campaign.sending_mode || 'turbo',
      turbo_config: campaign.turbo_config,
      throttle_config: campaign.throttle_config,
      schedule_config: campaign.schedule_config
    });
    setShowCreateDialog(true);
  };

  // Poll for campaign status after sending
  const startPollingCampaigns = () => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingRef.current = setInterval(async () => {
      await loadCampaigns();
      // Stop polling if no campaigns are pending or running
      const stillRunning = campaigns.some(c => c.status === 'pending' || c.status === 'running');
      if (!stillRunning && pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    }, 2000);
  };

  const handleSendCampaign = async (campaign: any) => {
    try {
      console.log('EnhancedCampaignsPage: Starting campaign via context:', campaign.id);

      // Use the context function which handles state updates and polling
      await startCampaign(campaign.id);

      // Note: startCampaign in context handles the toast and polling setup
    } catch (error: any) {
      console.error('EnhancedCampaignsPage: Error starting campaign:', error);
      toast({
        title: 'Error Starting Campaign',
        description: error.message || 'Failed to start campaign.',
        variant: 'destructive',
      });
    }
  };

  const handleSaveCampaign = async () => {
    // Validation
    if (!campaignName.trim()) {
      toast({ title: "Error", description: "Campaign name is required.", variant: "destructive" });
      return;
    }
    if (selectedProjects.length === 0) {
      toast({ title: "Error", description: "Please select at least one project.", variant: "destructive" });
      return;
    }
    const totalUsers = Object.values(selectedUsers).reduce((sum, userIds) => sum + userIds.length, 0);
    if (totalUsers === 0) {
      toast({ title: "Error", description: "Please select at least one user.", variant: "destructive" });
      return;
    }

    const campaignData: any = {
      name: campaignName,
      projectIds: selectedProjects,
      selectedUsers,
      batchSize,
      workers,
      // Sending mode configuration
      sending_mode: sendingMode.mode,
      turbo_config: sendingMode.turbo_config,
      throttle_config: sendingMode.throttle_config,
      schedule_config: sendingMode.schedule_config
    };

    try {
      if (editingCampaign) {
        await updateCampaign(editingCampaign.id, campaignData);
        toast({ title: 'Success', description: 'Campaign updated successfully.' });
      } else {
        campaignData.status = 'pending';
        await createCampaign(campaignData);
        toast({ title: 'Success', description: 'Campaign created successfully.' });
      }

      // Cleanup
      setShowCreateDialog(false);
      setEditingCampaign(null);
      setCampaignName('');
      setSelectedProjects([]);
      setSelectedUsers({});
      setSelectedProfile('');
      setBatchSize(50);
      setWorkers(5);
      setSendingMode({ mode: 'turbo', turbo_config: { auto: true } });
    } catch (error) {
      console.error('Failed to save campaign:', error);
      toast({ title: 'Error', description: 'Failed to save campaign.', variant: 'destructive' });
    }
  };

  const handleDuplicateCampaign = (campaign: any) => {
    // Create a new campaign object with a new name and id
    const newCampaign = {
      ...campaign,
      id: undefined, // Let createCampaign assign a new id
      name: campaign.name + ' (Copy)',
      createdAt: new Date().toISOString(),
      status: 'pending',
      processed: 0,
      successful: 0,
      failed: 0,
      errors: [],
      projectStats: Object.fromEntries(Object.keys(campaign.selectedUsers).map(pid => [pid, { processed: 0, successful: 0, failed: 0 }]))
    };
    createCampaign(newCampaign);
    toast({ title: 'Campaign Duplicated', description: `Campaign "${campaign.name}" duplicated.` });
  };

  // Filtered campaigns
  const filteredCampaigns = campaigns.filter(c => {
    const matchesSearch = c.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' || c.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  // Example: After campaign completion (in polling or after status update)
  useEffect(() => {
    if (currentCampaign && currentCampaign.status === 'completed') {
      toast({
        title: 'Campaign Completed',
        description: `Campaign "${currentCampaign.name}" completed successfully!`,
      });
    }
    if (currentCampaign && currentCampaign.status === 'failed') {
      toast({
        title: 'Campaign Failed',
        description: `Campaign "${currentCampaign.name}" failed.`,
        variant: 'destructive',
      });
    }
  }, [currentCampaign?.status]);

  return (
    <div className="p-8 space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Campaign Management</h1>
          <p className="text-gray-400">Create and manage password reset campaigns across multiple projects</p>
        </div>
        <Button
          onClick={() => setShowCreateDialog(true)}
          className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
        >
          <Plus className="w-4 h-4 mr-2" />
          New Campaign
        </Button>
      </div>

      {/* Current Campaign Monitor */}
      {currentCampaign && (
        <Card className="bg-gradient-to-r from-blue-900/50 to-purple-900/50 border-blue-500/50">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <Zap className="w-5 h-5 text-yellow-500" />
              Active Campaign: {currentCampaign.name}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <EnhancedCampaignMonitor campaignId={currentCampaign?.id} />
          </CardContent>
        </Card>
      )}

      {/* Search and Status Filter */}
      <div className="flex flex-col md:flex-row gap-4 mb-4">
        <Input
          placeholder="Search campaigns..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          className="bg-gray-700 border-gray-600 text-white w-full md:w-1/2"
        />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="bg-gray-700 border-gray-600 text-white w-full md:w-1/4">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent className="bg-gray-700 border-gray-600">
            <SelectItem value="all" className="text-white">All Statuses</SelectItem>
            <SelectItem value="pending" className="text-white">Pending</SelectItem>
            <SelectItem value="running" className="text-white">Running</SelectItem>
            <SelectItem value="completed" className="text-white">Completed</SelectItem>
            <SelectItem value="failed" className="text-white">Failed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Campaign List */}
      <Card className="bg-gray-800 border-gray-700">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Mail className="w-5 h-5" />
            Campaigns ({filteredCampaigns.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {filteredCampaigns.length > 0 ? (
            <>
              <div className="flex items-center gap-4 mb-2">
                <input
                  type="checkbox"
                  checked={selectedCampaigns.length === filteredCampaigns.length}
                  onChange={e => handleSelectAllCampaigns(e.target.checked)}
                />
                <span className="text-white">Select All</span>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={handleDeleteSelectedCampaigns}
                  disabled={selectedCampaigns.length === 0}
                >
                  <Trash2 className="w-4 h-4 mr-1" /> Delete Selected
                </Button>
              </div>
              <div className="space-y-4">
                {filteredCampaigns.map((campaign) => (
                  <div key={campaign.id} className="bg-gray-700 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={selectedCampaigns.includes(campaign.id)}
                          onChange={e => handleSelectCampaign(campaign.id, e.target.checked)}
                        />
                        {getCampaignStatusIcon(campaign.status)}
                        <div>
                          <h3 className="text-white font-semibold">{campaign.name}</h3>
                          <p className="text-gray-400 text-sm">
                            {campaign.projectIds.length} projects •
                            {Object.values(campaign.selectedUsers).reduce((sum, users) => sum + users.length, 0)} users
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge className={`${campaign.status === 'completed' ? 'bg-green-500/20 text-green-400' :
                          campaign.status === 'running' ? 'bg-blue-500/20 text-blue-400' :
                            campaign.status === 'failed' ? 'bg-red-500/20 text-red-400' :
                              'bg-gray-500/20 text-gray-400'
                          }`}>
                          {campaign.status}
                        </Badge>
                        {campaign.status === 'pending' && (
                          <Button
                            size="sm"
                            onClick={() => handleSendCampaign(campaign)}
                            className={`${campaign.sending_mode === 'throttled' ? 'bg-blue-600 hover:bg-blue-700' :
                              campaign.sending_mode === 'scheduled' ? 'bg-purple-600 hover:bg-purple-700' :
                                'bg-gradient-to-r from-yellow-600 to-orange-600 hover:from-yellow-700 hover:to-orange-700'
                              }`}
                          >
                            {campaign.sending_mode === 'throttled' ? <Play className="w-4 h-4 mr-1" /> :
                              campaign.sending_mode === 'scheduled' ? <Clock className="w-4 h-4 mr-1" /> :
                                <Rocket className="w-4 h-4 mr-1" />}
                            {campaign.sending_mode === 'throttled' ? 'Start Throttled' :
                              campaign.sending_mode === 'scheduled' ? 'Enable Schedule' :
                                'Start Turbo'}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => deleteCampaign(campaign.id)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => handleEditCampaign(campaign)}>
                          <Edit2 className="w-4 h-4 mr-1" /> Edit
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => handleDuplicateCampaign(campaign)}>
                          <Copy className="w-4 h-4 mr-1" /> Duplicate
                        </Button>
                      </div>
                    </div>

                    {/* Progress Bar */}
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm text-gray-400">
                        <span>Progress: {campaign.processed} / {Object.values(campaign.selectedUsers).reduce((sum, users) => sum + users.length, 0)}</span>
                        <span>{campaign.successful} successful • {campaign.failed} failed</span>
                      </div>
                      <Progress
                        value={(campaign.processed / Object.values(campaign.selectedUsers).reduce((sum, users) => sum + users.length, 0)) * 100}
                        className="h-2"
                      />
                    </div>

                    {/* Campaign Settings */}
                    <div className="flex items-center gap-4 mt-3 text-sm text-gray-400">
                      <span>Batch Size: {campaign.batchSize}</span>
                      <span>Workers: {campaign.workers}</span>
                      <span>Created: {new Date(campaign.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Pagination Controls */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-6 pt-4 border-t border-gray-700">
                  <div className="text-sm text-gray-400">
                    Showing {((currentPage - 1) * campaignsPerPage) + 1} to {Math.min(currentPage * campaignsPerPage, totalCampaigns)} of {totalCampaigns} campaigns
                  </div>
                  <div className="space-y-4 pt-4 border-t border-gray-700">
                    <h3 className="text-lg font-semibold text-white">Sending Configuration</h3>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-300">Sending Mode</label>
                        <Select
                          value={sendingMode.mode}
                          onValueChange={(value: any) => setSendingMode(prev => ({ ...prev, mode: value }))}
                        >
                          <SelectTrigger className="bg-gray-700 border-gray-600 text-white">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="bg-gray-800 border-gray-700 text-white">
                            <SelectItem value="turbo">Turbo (Max Speed)</SelectItem>
                            <SelectItem value="throttled">Throttled (Safe)</SelectItem>
                            <SelectItem value="scheduled">Scheduled</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {sendingMode.mode === 'throttled' && (
                        <div className="space-y-2">
                          <label className="text-sm font-medium text-gray-300">Emails per Second</label>
                          <Input
                            type="number"
                            min="1"
                            value={sendingMode.throttle_config?.emails_per_ms ? Math.round(sendingMode.throttle_config.emails_per_ms * 1000) : 10}
                            onChange={(e) => setSendingMode(prev => ({
                              ...prev,
                              throttle_config: { ...prev.throttle_config, emails_per_ms: parseInt(e.target.value) / 1000 }
                            }))}
                            className="bg-gray-700 border-gray-600 text-white"
                          />
                        </div>
                      )}
                    </div>

                    {/* NEW: Per-Project Sending Limits */}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-300">Send Limit (Per Project)</label>
                        <Input
                          type="number"
                          placeholder="Unlimited"
                          min="1"
                          value={sendingMode.sending_limit || ''}
                          onChange={(e) => setSendingMode(prev => ({
                            ...prev,
                            sending_limit: e.target.value ? parseInt(e.target.value) : undefined
                          }))}
                          className="bg-gray-700 border-gray-600 text-white"
                        />
                        <p className="text-xs text-gray-500">Max emails to send per project (leave empty for all)</p>
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-300">Start Offset</label>
                        <Input
                          type="number"
                          placeholder="0"
                          min="0"
                          value={sendingMode.sending_offset || 0}
                          onChange={(e) => setSendingMode(prev => ({
                            ...prev,
                            sending_offset: parseInt(e.target.value) || 0
                          }))}
                          className="bg-gray-700 border-gray-600 text-white"
                        />
                        <p className="text-xs text-gray-500">Skip the first X users (useful for resuming)</p>
                      </div>
                    </div>

                    {sendingMode.mode === 'scheduled' && (
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-300">Schedule Time (ISO)</label>
                        <Input
                          type="datetime-local"
                          onChange={(e) => setSendingMode(prev => ({
                            ...prev,
                            schedule_config: { ...prev.schedule_config, scheduled_time: e.target.value }
                          }))}
                          className="bg-gray-700 border-gray-600 text-white"
                        />
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                      disabled={currentPage === 1}
                      className="border-gray-600 text-gray-300 hover:bg-gray-700"
                    >
                      Previous
                    </Button>

                    <div className="flex items-center gap-1">
                      {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                        let pageNum;
                        if (totalPages <= 5) {
                          pageNum = i + 1;
                        } else if (currentPage <= 3) {
                          pageNum = i + 1;
                        } else if (currentPage >= totalPages - 2) {
                          pageNum = totalPages - 4 + i;
                        } else {
                          pageNum = currentPage - 2 + i;
                        }

                        return (
                          <Button
                            key={pageNum}
                            size="sm"
                            variant={currentPage === pageNum ? "default" : "outline"}
                            onClick={() => setCurrentPage(pageNum)}
                            className={currentPage === pageNum
                              ? "bg-blue-600 hover:bg-blue-700"
                              : "border-gray-600 text-gray-300 hover:bg-gray-700"
                            }
                          >
                            {pageNum}
                          </Button>
                        );
                      })}
                    </div>

                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                      disabled={currentPage === totalPages}
                      className="border-gray-600 text-gray-300 hover:bg-gray-700"
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-8">
              <Mail className="w-12 h-12 text-gray-500 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-white mb-2">No Campaigns Yet</h3>
              <p className="text-gray-400">Create your first campaign to start sending password reset emails.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Campaign Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="bg-gray-800 border-gray-700 max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-white">Create New Campaign</DialogTitle>
          </DialogHeader>
          <div className="space-y-6">
            {/* Campaign Name */}
            <div>
              <Label htmlFor="campaignName" className="text-gray-300">Campaign Name</Label>
              <Input
                id="campaignName"
                value={campaignName}
                onChange={(e) => setCampaignName(e.target.value)}
                placeholder="Password Reset Campaign"
                className="bg-gray-700 border-gray-600 text-white"
              />
            </div>

            {/* Profile Selection */}
            <div>
              <Label className="text-gray-300">Select Profile</Label>
              <Select value={selectedProfile} onValueChange={handleProfileChange}>
                <SelectTrigger className="bg-gray-700 border-gray-600 text-white">
                  <SelectValue placeholder="Choose a profile first" />
                </SelectTrigger>
                <SelectContent className="bg-gray-700 border-gray-600">
                  {profiles.map((profile) => (
                    <SelectItem key={profile.id} value={profile.id} className="text-white hover:bg-gray-600">
                      <div className="flex items-center gap-2">
                        <FolderOpen className="w-4 h-4 text-blue-400" />
                        {profile.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Project Selection */}
            {selectedProfile && (
              <div>
                <Label className="text-gray-300">Select Projects ({selectedProjects.length} selected)</Label>
                <div className="flex items-center gap-2 mb-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      if (selectedProjects.length === profileProjects.length) {
                        // Deselect all
                        setSelectedProjects([]);
                      } else {
                        // Select all
                        setSelectedProjects(profileProjects.map(p => p.id));
                      }
                    }}
                    className="border-gray-600 text-gray-300 hover:bg-gray-700"
                  >
                    {selectedProjects.length === profileProjects.length ? 'Deselect All' : 'Select All'} Projects
                  </Button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2 max-h-40 overflow-y-auto border border-gray-600 rounded-lg p-3">
                  {profileProjects.map((project) => (
                    <div key={project.id} className="flex items-center space-x-2">
                      <Checkbox
                        id={project.id}
                        checked={selectedProjects.includes(project.id)}
                        onCheckedChange={() => handleProjectToggle(project.id)}
                        className="border-gray-500"
                      />
                      <Label htmlFor={project.id} className="text-white text-sm cursor-pointer">
                        {project.name}
                      </Label>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* User Selection */}
            {selectedProjects.length > 0 && (
              <div>
                <Label className="text-gray-300">Select Users ({getTotalSelectedUsers()} selected)</Label>
                <div className="space-y-4 mt-2 max-h-60 overflow-y-auto border border-gray-600 rounded-lg p-3">
                  {/* Select All Users Logic - Default to All */}
                  {selectedProjects.map((projectId) => {
                    const project = projects.find(p => p.id === projectId);
                    const projectUsers = users[projectId] || [];
                    const selectedCount = selectedUsers[projectId]?.length || 0;
                    const isLoading = loadingUsers[projectId];

                    // Auto-select all users when loaded if none selected yet
                    // This effect is handled in the parent component logic or we can trigger it here
                    // For now, we provide a button to "Select All" if not all are selected
                    const isAllSelected = projectUsers.length > 0 && selectedCount === projectUsers.length;

                    return (
                      <div key={projectId} className="bg-gray-700 rounded-lg p-3">
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="text-white font-medium">{project?.name}</h4>
                          {!isLoading && projectUsers.length > 0 && (
                            <Button
                              size="sm"
                              variant={isAllSelected ? "secondary" : "default"}
                              onClick={() => {
                                if (isAllSelected) {
                                  setSelectedUsers(prev => ({ ...prev, [projectId]: [] }));
                                } else {
                                  setSelectedUsers(prev => ({ ...prev, [projectId]: projectUsers.map(u => u.uid) }));
                                }
                              }}
                            >
                              {isAllSelected ? "Deselect All" : "Select All Users"}
                            </Button>
                          )}
                        </div>
                        <div className="text-sm text-gray-400 mb-2">
                          {isLoading ? (
                            <div className="flex items-center">
                              <div className="animate-spin w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full mr-2" />
                              Loading users...
                            </div>
                          ) : (
                            <span className="font-mono bg-gray-800 px-2 py-1 rounded">
                              {projectUsers.length} users available • {selectedCount} selected
                            </span>
                          )}
                        </div>

                        {/* 
                           CRITICAL PERFORMANCE FIX: 
                           Do NOT render the list of users here. 
                           It causes crashes with 50k+ users.
                           Users are selected by default via "Select All".
                        */}
                        <p className="text-xs text-gray-500 italic">
                          User list hidden for performance. Total count shown above.
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}


            {/* Sending Limits (New Feature) */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="sendLimit" className="text-gray-300">Send Limit (Per Project)</Label>
                <Input
                  id="sendLimit"
                  type="number"
                  placeholder="Unlimited"
                  min="1"
                  value={sendingMode?.sending_limit || ''}
                  onChange={(e) => setSendingMode(prev => ({
                    ...prev,
                    sending_limit: e.target.value ? parseInt(e.target.value) : undefined
                  }))}
                  className="bg-gray-700 border-gray-600 text-white"
                />
                <p className="text-xs text-gray-500">Max emails to send per project (leave empty for all)</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="startOffset" className="text-gray-300">Start Offset</Label>
                <Input
                  id="startOffset"
                  type="number"
                  placeholder="0"
                  min="0"
                  value={sendingMode?.sending_offset || 0}
                  onChange={(e) => setSendingMode(prev => ({
                    ...prev,
                    sending_offset: parseInt(e.target.value) || 0
                  }))}
                  className="bg-gray-700 border-gray-600 text-white"
                />
                <p className="text-xs text-gray-500">Skip the first X users (useful for resuming)</p>
              </div>
            </div>

            {/* Sending Mode Selector - Enterprise Feature */}
            <SendingModeSelector value={sendingMode} onChange={setSendingMode} />

            {/* Actions */}
            <div className="flex gap-2">
              <Button
                onClick={handleSaveCampaign}
                className="bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800"
              >
                Save Changes
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

      <ConfirmDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <ConfirmDialogContent className="bg-gray-800 border-gray-700">
          <ConfirmDialogHeader>
            <ConfirmDialogTitle className="text-white">Delete Running Campaigns?</ConfirmDialogTitle>
          </ConfirmDialogHeader>
          <div className="text-gray-300 mb-4">
            You are about to delete one or more running campaigns. This action cannot be undone. Are you sure?
          </div>
          <div className="flex gap-2">
            <Button onClick={async () => { await actuallyDeleteCampaigns(campaignsToDelete); setShowDeleteConfirm(false); }} className="bg-red-600 hover:bg-red-700">Delete</Button>
            <Button variant="outline" onClick={() => setShowDeleteConfirm(false)} className="border-gray-600 text-gray-300 hover:bg-gray-700">Cancel</Button>
          </div>
        </ConfirmDialogContent>
      </ConfirmDialog>
    </div>
  );
};
