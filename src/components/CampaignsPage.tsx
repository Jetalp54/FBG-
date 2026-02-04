import { useState, useMemo, useEffect, useRef } from 'react';
import { useEnhancedApp } from '@/contexts/EnhancedAppContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { toast } from '@/hooks/use-toast';
import { Zap, Send, Users, AlertTriangle, Edit2, Copy, Trash2, Plus } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Pagination } from '@/components/ui/pagination';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

export const CampaignsPage = () => {
  const {
    projects,
    users,
    loadUsers,
    campaigns,
    createCampaign,
    updateCampaign,
    deleteCampaign,
  } = useEnhancedApp();
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<{ [projectId: string]: number }>({});
  const [completed, setCompleted] = useState<{ [projectId: string]: boolean }>({});
  const [results, setResults] = useState<{ [projectId: string]: string }>({});
  const [projectSearch, setProjectSearch] = useState('');
  const [loadingUsers, setLoadingUsers] = useState<{ [projectId: string]: boolean }>({});
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [campaignName, setCampaignName] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const campaignsPerPage = 8;
  const [editingCampaign, setEditingCampaign] = useState<any | null>(null);
  const [duplicatingCampaign, setDuplicatingCampaign] = useState<any | null>(null);
  const [sendingCampaignId, setSendingCampaignId] = useState<string | null>(null);
  const [campaignProgress, setCampaignProgress] = useState<{ [campaignId: string]: { [projectId: string]: string } }>({});
  const isSendingRef = useRef<{ [campaignId: string]: boolean }>({});

  // Only active projects
  const activeProjects = projects.filter(p => p.status === 'active');

  // Filtered projects by search
  const filteredProjects = useMemo(() => {
    if (!projectSearch.trim()) return activeProjects;
    return activeProjects.filter(p =>
      p.name.toLowerCase().includes(projectSearch.toLowerCase()) ||
      p.id.toLowerCase().includes(projectSearch.toLowerCase())
    );
  }, [activeProjects, projectSearch]);

  // Always load users for selected projects
  useEffect(() => {
    const fetchUsers = async () => {
      for (const projectId of selectedProjects) {
        if (!users[projectId] || users[projectId].length === 0) {
          setLoadingUsers(prev => ({ ...prev, [projectId]: true }));
          try {
            await loadUsers(projectId);
          } finally {
            setLoadingUsers(prev => ({ ...prev, [projectId]: false }));
          }
        }
      }
    };
    if (selectedProjects.length > 0) fetchUsers();
  }, [selectedProjects, loadUsers, users]);

  // Select/deselect projects
  const toggleProject = (projectId: string) => {
    setSelectedProjects(prev =>
      prev.includes(projectId)
        ? prev.filter(id => id !== projectId)
        : [...prev, projectId]
    );
  };

  // Select all/deselect all
  const selectAllProjects = () => {
    if (selectedProjects.length === filteredProjects.length) {
      setSelectedProjects([]);
    } else {
      setSelectedProjects(filteredProjects.map(p => p.id));
    }
  };

  // Campaign summary
  const totalUsers = useMemo(() =>
    selectedProjects.reduce((sum, pid) => sum + (users[pid]?.length || 0), 0),
    [selectedProjects, users]
  );
  const emptyProjects = useMemo(() =>
    selectedProjects.filter(pid => (users[pid]?.length || 0) === 0),
    [selectedProjects, users]
  );

  // Start campaign: send all in parallel
  const startCampaign = async () => {
    if (selectedProjects.length === 0) {
      toast({ title: 'No Projects Selected', description: 'Please select at least one project.', variant: 'destructive' });
      return;
    }
    setIsRunning(true);
    setProgress({});
    setCompleted({});
    setResults({});
    
    // Generate campaign ID
    const campaignId = `campaign_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Load users for all selected projects (if not already loaded)
    for (const projectId of selectedProjects) {
      if (!users[projectId] || users[projectId].length === 0) {
        await loadUsers(projectId);
      }
    }
    
    // Fire all projects in parallel
    await Promise.allSettled(
      selectedProjects.map(async (projectId) => {
        const userIds = (users[projectId] || []).map(u => u.uid);
        setProgress(prev => ({ ...prev, [projectId]: 0 }));
        setCompleted(prev => ({ ...prev, [projectId]: false }));
        setResults(prev => ({ ...prev, [projectId]: 'Sending...' }));
        
        try {
          const res = await fetch(`${API_BASE_URL}/campaigns/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              projectId,
              userIds,
              lightning: true,
              campaignId
            })
          });
          
          const data = await res.json();
          
          if (data.success) {
            setProgress(prev => ({ ...prev, [projectId]: 100 }));
            setCompleted(prev => ({ ...prev, [projectId]: true }));
            
            // Enhanced result display with detailed info
            const summary = data.summary;
            const resultText = `✅ ${summary.successful} sent, ❌ ${summary.failed} failed`;
            setResults(prev => ({ ...prev, [projectId]: resultText }));
            
            // Show detailed toast for each project
            if (summary.failed > 0) {
              toast({ 
                title: `Project ${projects.find(p => p.id === projectId)?.name}`, 
                description: `${summary.successful} sent, ${summary.failed} failed`, 
                variant: 'destructive' 
              });
            } else {
              toast({ 
                title: `Project ${projects.find(p => p.id === projectId)?.name}`, 
                description: `Successfully sent ${summary.successful} emails`, 
                variant: 'default' 
              });
            }
          } else {
            setCompleted(prev => ({ ...prev, [projectId]: false }));
            setResults(prev => ({ ...prev, [projectId]: `Error: ${data.error}` }));
            toast({ 
              title: `Project ${projects.find(p => p.id === projectId)?.name} Failed`, 
              description: data.error, 
              variant: 'destructive' 
            });
          }
        } catch (e) {
          setCompleted(prev => ({ ...prev, [projectId]: false }));
          setResults(prev => ({ ...prev, [projectId]: 'Network Error' }));
          toast({ 
            title: `Project ${projects.find(p => p.id === projectId)?.name} Failed`, 
            description: 'Network error occurred', 
            variant: 'destructive' 
          });
        }
      })
    );
    
    setIsRunning(false);
    toast({ 
      title: 'Lightning Campaign Complete', 
      description: `Campaign ID: ${campaignId}`, 
      variant: 'default' 
    });
  };

  // Pagination logic
  const sortedCampaigns = [...campaigns].sort((a, b) => {
    const aTime = Number(typeof a.createdAt === 'string' ? new Date(a.createdAt).getTime() : a.createdAt || 0);
    const bTime = Number(typeof b.createdAt === 'string' ? new Date(b.createdAt).getTime() : b.createdAt || 0);
    return bTime - aTime;
  });
  const totalPages = Math.ceil(sortedCampaigns.length / campaignsPerPage);
  const paginatedCampaigns = sortedCampaigns.slice((currentPage - 1) * campaignsPerPage, currentPage * campaignsPerPage);
  
  // Debug campaigns data
  console.log('CampaignsPage: All campaigns:', campaigns);
  console.log('CampaignsPage: Sorted campaigns:', sortedCampaigns);
  console.log('CampaignsPage: Paginated campaigns:', paginatedCampaigns);

  // Send campaign (parallel, all projects at once) - FIXED VERSION
  const handleSendCampaign = async (campaign: any) => {
    console.log('CampaignsPage: Starting handleSendCampaign');
    console.log('CampaignsPage: campaign =', campaign);
    console.log('CampaignsPage: API_BASE_URL =', API_BASE_URL);
    
    // Prevent multiple simultaneous sends
    if (sendingCampaignId || isSendingRef.current[campaign.id]) {
      console.log('CampaignsPage: Campaign already sending, returning');
      return;
    }
    
    setSendingCampaignId(campaign.id);
    isSendingRef.current[campaign.id] = true;
    setCampaignProgress(prev => ({ ...prev, [campaign.id]: {} }));
    
    const { projectIds, selectedUsers } = campaign;
    console.log('CampaignsPage: projectIds =', projectIds);
    console.log('CampaignsPage: selectedUsers =', selectedUsers);
    
    try {
      await Promise.allSettled(
        projectIds.map(async (projectId: string) => {
          console.log('CampaignsPage: Processing project:', projectId);
          setCampaignProgress(prev => ({
            ...prev,
            [campaign.id]: { ...prev[campaign.id], [projectId]: 'Sending...' }
          }));
          
          try {
            const requestBody = {
              projectId,
              userIds: selectedUsers[projectId] || [],
              lightning: true,
              campaignId: campaign.id
            };
            console.log('CampaignsPage: Request body for project', projectId, ':', requestBody);
            
            const res = await fetch(`${API_BASE_URL}/campaigns/send`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(requestBody)
            });
            
            console.log('CampaignsPage: Response status for project', projectId, ':', res.status);
            console.log('CampaignsPage: Response ok for project', projectId, ':', res.ok);
            
            const data = await res.json();
            console.log('CampaignsPage: Response data for project', projectId, ':', data);
            
            setCampaignProgress(prev => ({
              ...prev,
              [campaign.id]: { 
                ...prev[campaign.id], 
                [projectId]: data.success ? '✅ Sent' : `❌ ${data.error || 'Failed'}` 
              }
            }));
          } catch (e) {
            console.log('CampaignsPage: Error for project', projectId, ':', e);
            setCampaignProgress(prev => ({
              ...prev,
              [campaign.id]: { 
                ...prev[campaign.id], 
                [projectId]: '❌ Network Error' 
              }
            }));
          }
        })
      );
    } finally {
      isSendingRef.current[campaign.id] = false;
      setSendingCampaignId(null);
    }
    
    toast({ 
      title: 'Campaign Sent', 
      description: `Campaign "${campaign.name}" has been sent to all selected projects.` 
    });
  };

  // Pagination controls
  const handlePrevPage = () => setCurrentPage(p => Math.max(1, p - 1));
  const handleNextPage = () => setCurrentPage(p => Math.min(totalPages, p + 1));

  // Campaign creation logic (use backend)
  const handleCreateCampaign = async () => {
    if (!campaignName.trim() || selectedProjects.length === 0) {
      toast({ title: 'Error', description: 'Campaign name and at least one project are required.', variant: 'destructive' });
      return;
    }
    // Build selectedUsers: all users in each selected project
    const selectedUsers: Record<string, string[]> = {};
    selectedProjects.forEach(pid => {
      selectedUsers[pid] = (users[pid] || []).map(u => u.uid);
    });

    await createCampaign({
      name: campaignName,
      projectIds: [...selectedProjects],
      selectedUsers,
      batchSize: 50,
      workers: 5,
      template: null
    });
    setShowCreateDialog(false);
    setCampaignName('');
    setSelectedProjects([]);
  };

  // Edit campaign logic (use backend)
  const handleEditCampaign = (campaign: any) => {
    setEditingCampaign(campaign);
    setCampaignName(campaign.name);
    setSelectedProjects([...campaign.projectIds]);
    setShowCreateDialog(true);
  };
  const handleSaveEditCampaign = async () => {
    if (!editingCampaign) return;
    await updateCampaign(editingCampaign.id, {
      name: campaignName,
      projectIds: [...selectedProjects],
    });
    setShowCreateDialog(false);
    setEditingCampaign(null);
    setCampaignName('');
    setSelectedProjects([]);
  };

  // Duplicate campaign logic (use backend)
  const handleDuplicateCampaign = (campaign: any) => {
    setDuplicatingCampaign(campaign);
    setCampaignName(campaign.name + ' (Copy)');
    setSelectedProjects([...campaign.projectIds]);
    setShowCreateDialog(true);
  };
  const handleSaveDuplicateCampaign = async () => {
    await handleCreateCampaign();
    setDuplicatingCampaign(null);
  };

  // Delete campaign logic (use backend)
  const handleDeleteCampaign = async (id: string) => {
    await deleteCampaign(id);
  };

  return (
    <div className="p-8 space-y-8 bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 min-h-screen">
      <Card className="bg-gradient-to-r from-blue-900/80 to-purple-900/80 border-blue-700 shadow-xl">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-3 text-2xl font-bold">
            <Zap className="w-7 h-7 text-yellow-400 animate-pulse" />
            PowerMTA Lightning Campaign
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex-1">
              <Input
                placeholder="Search projects..."
                value={projectSearch}
                onChange={e => setProjectSearch(e.target.value)}
                className="bg-gray-800 border-gray-700 text-white mb-2 md:mb-0"
              />
            </div>
            <Button
              variant="outline"
              onClick={selectAllProjects}
              className="border-yellow-400 text-yellow-400 hover:bg-yellow-900/20 font-semibold"
            >
              {selectedProjects.length === filteredProjects.length ? 'Deselect All' : 'Select All Projects'}
            </Button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredProjects.map(project => (
              <div key={project.id} className={`flex items-center gap-2 bg-gray-700 rounded p-3 border-2 ${selectedProjects.includes(project.id) ? 'border-yellow-400' : 'border-transparent'}`}>
                <Checkbox
                  checked={selectedProjects.includes(project.id)}
                  onCheckedChange={() => toggleProject(project.id)}
                  className="border-gray-500"
                />
                <span className="text-white text-base font-medium">{project.name}</span>
                {loadingUsers[project.id] ? (
                  <span className="text-xs text-blue-400 ml-2 animate-pulse">Loading users...</span>
                ) : (
                  <span className="text-xs text-gray-400 ml-2">{users[project.id]?.length || 0} users</span>
                )}
              </div>
            ))}
          </div>
          <Card className="bg-gray-900 border-blue-800 mt-6">
            <CardContent className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 py-4">
              <div className="flex items-center gap-4">
                <span className="text-lg text-white font-semibold">Summary:</span>
                <span className="text-blue-300 font-bold">{selectedProjects.length} projects</span>
                <span className="text-green-300 font-bold">{totalUsers} users</span>
                {emptyProjects.length > 0 && (
                  <span className="flex items-center gap-1 text-yellow-400 font-semibold"><AlertTriangle className="w-4 h-4" /> {emptyProjects.length} empty</span>
                )}
              </div>
              {emptyProjects.length > 0 && (
                <div className="text-xs text-yellow-300">Warning: Some selected projects have no users and will be skipped.</div>
              )}
            </CardContent>
          </Card>
          <Button
            onClick={startCampaign}
            disabled={isRunning || selectedProjects.length === 0}
            className="bg-gradient-to-r from-yellow-400 to-yellow-600 hover:from-yellow-500 hover:to-yellow-700 w-full text-lg font-bold py-3 shadow-lg"
          >
            {isRunning ? <span className="flex items-center gap-2"><Send className="w-5 h-5 animate-spin" /> Sending...</span> : 'Start Lightning Campaign'}
          </Button>
        </CardContent>
      </Card>
      {selectedProjects.length > 0 && (
        <Card className="bg-gradient-to-r from-gray-800 to-gray-900 border-blue-700 shadow-lg">
          <CardHeader>
            <CardTitle className="text-white text-xl font-semibold flex items-center gap-2">
              <Users className="w-6 h-6 text-blue-400" /> Progress Dashboard
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {selectedProjects.map(projectId => (
              <div key={projectId} className="mb-2">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-gray-300 font-medium">{projects.find(p => p.id === projectId)?.name}</span>
                  <span className={`text-xs font-bold ${results[projectId] === 'Done' ? 'text-green-400' : results[projectId] === 'Error' ? 'text-red-400' : 'text-yellow-300'}`}>{results[projectId] || (completed[projectId] ? 'Done' : (progress[projectId] || 0) + '%')}</span>
                </div>
                <Progress value={progress[projectId] || 0} className="h-2" />
              </div>
            ))}
          </CardContent>
        </Card>
      )}
      <Button onClick={() => { setShowCreateDialog(true); setEditingCampaign(null); setDuplicatingCampaign(null); }} className="mt-8 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700">
        <Plus className="w-4 h-4 mr-2" /> New Campaign
      </Button>
      {/* Campaign List */}
      <Card className="bg-gray-900 border-blue-800 mt-8">
        <CardHeader>
          <CardTitle className="text-white text-xl font-semibold flex items-center gap-2">
            <Users className="w-6 h-6 text-blue-400" /> Campaigns
          </CardTitle>
        </CardHeader>
        <CardContent>
          {paginatedCampaigns.length === 0 ? (
            <div className="text-gray-400 text-center py-8">No campaigns created yet.</div>
          ) : (
            <div className="space-y-4">
              {paginatedCampaigns.map(campaign => {
                let userCount = 0;
                const selectedUsersObj = campaign.selectedUsers || {};
                for (const key in selectedUsersObj) {
                  if (Array.isArray(selectedUsersObj[key])) {
                    userCount += selectedUsersObj[key].length;
                  }
                }
                return (
                  <div key={campaign.id} className="flex items-center justify-between bg-gray-800 rounded-lg p-4">
                    <div>
                      <div className="text-white font-semibold">{campaign.name}</div>
                      <div className="text-gray-400 text-sm">{campaign.projectIds.length} projects • {userCount} users</div>
                      {/* Progress for this campaign */}
                      {campaignProgress[campaign.id] && (
                        <div className="mt-2 space-y-1">
                          {campaign.projectIds.map((pid: string) => (
                            <div key={pid} className="flex items-center gap-2 text-xs">
                              <span className="text-gray-300">{projects.find(p => p.id === pid)?.name || pid}:</span>
                              <span>{campaignProgress[campaign.id][pid]}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => handleEditCampaign(campaign)}><Edit2 className="w-4 h-4" /></Button>
                      <Button size="sm" variant="outline" onClick={() => handleDuplicateCampaign(campaign)}><Copy className="w-4 h-4" /></Button>
                      <Button size="sm" variant="destructive" onClick={() => handleDeleteCampaign(campaign.id)}><Trash2 className="w-4 h-4" /></Button>
                      <Button 
                        size="sm" 
                        className="bg-gradient-to-r from-yellow-400 to-yellow-600 text-black font-bold" 
                        onClick={() => {
                          console.log('CampaignsPage: Send button clicked for campaign:', campaign);
                          console.log('CampaignsPage: Campaign data:', campaign);
                          console.log('CampaignsPage: sendingCampaignId:', sendingCampaignId);
                          console.log('CampaignsPage: isSendingRef.current:', isSendingRef.current);
                          handleSendCampaign(campaign);
                        }} 
                        disabled={sendingCampaignId === campaign.id || isSendingRef.current[campaign.id]}
                      >
                        {sendingCampaignId === campaign.id ? 'Sending...' : 'Send'}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {/* Pagination controls */}
          {totalPages > 1 && (
            <div className="mt-4 flex justify-center gap-4">
              <Button size="sm" variant="outline" onClick={handlePrevPage} disabled={currentPage === 1}>Previous</Button>
              <span className="text-white font-semibold">Page {currentPage} of {totalPages}</span>
              <Button size="sm" variant="outline" onClick={handleNextPage} disabled={currentPage === totalPages}>Next</Button>
            </div>
          )}
        </CardContent>
      </Card>
      {/* Campaign Creation/Edit Modal */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="bg-gray-800 border-gray-700 max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-white">{editingCampaign ? 'Edit Campaign' : duplicatingCampaign ? 'Duplicate Campaign' : 'Create New Campaign'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="campaignName" className="text-gray-300">Campaign Name</Label>
              <Input
                id="campaignName"
                value={campaignName}
                onChange={e => setCampaignName(e.target.value)}
                placeholder="Password Reset Campaign"
                className="bg-gray-700 border-gray-600 text-white"
              />
            </div>
            <div>
              <Label className="text-gray-300">Select Projects</Label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2 max-h-40 overflow-y-auto border border-gray-600 rounded-lg p-2">
                {activeProjects.map(project => (
                  <div key={project.id} className="flex items-center gap-2">
                    <Checkbox
                      checked={selectedProjects.includes(project.id)}
                      onCheckedChange={() => toggleProject(project.id)}
                      className="border-gray-500"
                    />
                    <span className="text-white text-sm">{project.name}</span>
                  </div>
                ))}
              </div>
            </div>
            <Button
              onClick={editingCampaign ? handleSaveEditCampaign : duplicatingCampaign ? handleSaveDuplicateCampaign : handleCreateCampaign}
              className="w-full bg-gradient-to-r from-yellow-400 to-yellow-600 hover:from-yellow-500 hover:to-yellow-700 text-lg font-bold py-2 mt-4"
            >
              {editingCampaign ? 'Save Changes' : duplicatingCampaign ? 'Duplicate Campaign' : 'Create Campaign'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
