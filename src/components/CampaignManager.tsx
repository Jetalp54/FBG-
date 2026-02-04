
import { useState } from 'react';
import { useEnhancedApp } from '@/contexts/EnhancedAppContext';
import { Mail, Edit2, Trash2, Play, Pause, RotateCcw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';

export const CampaignManager = () => {
  const { campaigns, deleteCampaign, updateCampaign } = useEnhancedApp();
  const { toast } = useToast();
  const [editingCampaign, setEditingCampaign] = useState<any>(null);
  const [newName, setNewName] = useState('');

  const handleEditCampaign = (campaign: any) => {
    setEditingCampaign(campaign);
    setNewName(campaign.name);
  };

  const handleUpdateCampaign = async () => {
    if (!editingCampaign || !newName.trim()) return;

    try {
      await updateCampaign(editingCampaign.id, { name: newName.trim() });
      setEditingCampaign(null);
      setNewName('');
      toast({
        title: "Campaign Updated",
        description: "Campaign name has been updated successfully.",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update campaign.",
        variant: "destructive",
      });
    }
  };

  const handleDeleteCampaign = async (campaignId: string, campaignName: string) => {
    if (!confirm(`Are you sure you want to delete campaign "${campaignName}"?`)) {
      return;
    }

    try {
      await deleteCampaign(campaignId);
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
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-green-500/20 text-green-400';
      case 'running':
        return 'bg-blue-500/20 text-blue-400';
      case 'failed':
        return 'bg-red-500/20 text-red-400';
      case 'paused':
        return 'bg-yellow-500/20 text-yellow-400';
      default:
        return 'bg-gray-500/20 text-gray-400';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-white">Campaign Management</h2>
        <Badge className="bg-blue-500/20 text-blue-400">
          {campaigns.length} campaigns
        </Badge>
      </div>

      {campaigns.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {campaigns.map((campaign) => (
            <Card key={campaign.id} className="bg-gray-800 border-gray-700">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-white text-lg truncate">{campaign.name}</CardTitle>
                  <Badge className={getStatusColor(campaign.status)}>
                    {campaign.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="text-sm text-gray-400">
                  <div>Projects: {campaign.projectIds.length}</div>
                  <div>Users: {Object.values(campaign.selectedUsers).reduce((sum: number, users: any) => sum + users.length, 0)}</div>
                  <div>Progress: {campaign.processed} / {Object.values(campaign.selectedUsers).reduce((sum: number, users: any) => sum + users.length, 0)}</div>
                  <div>Success: {campaign.successful} | Failed: {campaign.failed}</div>
                </div>
                
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleEditCampaign(campaign)}
                    className="border-gray-600 text-gray-300 hover:bg-gray-700"
                  >
                    <Edit2 className="w-3 h-3" />
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => handleDeleteCampaign(campaign.id, campaign.name)}
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="bg-gray-800 border-gray-700">
          <CardContent className="py-12 text-center">
            <Mail className="w-12 h-12 text-gray-500 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-white mb-2">No Campaigns Yet</h3>
            <p className="text-gray-400">Create your first campaign to get started.</p>
          </CardContent>
        </Card>
      )}

      {/* Edit Campaign Dialog */}
      <Dialog open={!!editingCampaign} onOpenChange={() => setEditingCampaign(null)}>
        <DialogContent className="bg-gray-800 border-gray-700">
          <DialogHeader>
            <DialogTitle className="text-white">Edit Campaign</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="campaignName" className="text-gray-300">Campaign Name</Label>
              <Input
                id="campaignName"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="bg-gray-700 border-gray-600 text-white"
              />
            </div>
            <div className="flex gap-2">
              <Button
                onClick={handleUpdateCampaign}
                className="bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800"
              >
                Update Campaign
              </Button>
              <Button
                variant="outline"
                onClick={() => setEditingCampaign(null)}
                className="border-gray-600 text-gray-300 hover:bg-gray-700"
              >
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
