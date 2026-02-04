import React, { useEffect, useState } from 'react';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Clock, CheckCircle, XCircle, Users } from 'lucide-react';

interface Campaign {
  id: string;
  name: string;
  status: string;
  processed: number;
  successful: number;
  failed: number;
  selectedUsers: { [projectId: string]: string[] };
  batchSize: number;
  workers: number;
  createdAt: string;
  projectIds: string[];
}

interface EnhancedCampaignMonitorProps {
  campaignId: string;
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://139.59.213.238:8000';

export const EnhancedCampaignMonitor: React.FC<EnhancedCampaignMonitorProps> = ({ campaignId }) => {
  const [campaign, setCampaign] = useState<Campaign | null>(null);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    const fetchCampaign = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/campaigns/${campaignId}`);
        if (response.ok) {
          const data = await response.json();
          setCampaign(data);
        }
      } catch (e) {
        // Optionally handle error
      }
    };
    fetchCampaign();
    interval = setInterval(fetchCampaign, 3000);
    return () => clearInterval(interval);
  }, [campaignId]);

  if (!campaign) return <div className="text-gray-400">Loading campaign data...</div>;

  const totalUsers = Object.values(campaign.selectedUsers).reduce((sum, users) => sum + users.length, 0);
  const progressPercentage = totalUsers > 0 ? (campaign.processed / totalUsers) * 100 : 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-gray-700 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-1">
            <Users className="w-4 h-4 text-blue-400" />
            <span className="text-gray-400 text-sm">Total Users</span>
          </div>
          <span className="text-xl font-bold text-white">{totalUsers}</span>
        </div>
        <div className="bg-gray-700 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-1">
            <Clock className="w-4 h-4 text-yellow-400" />
            <span className="text-gray-400 text-sm">Processed</span>
          </div>
          <span className="text-xl font-bold text-white">{campaign.processed}</span>
        </div>
        <div className="bg-gray-700 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle className="w-4 h-4 text-green-400" />
            <span className="text-gray-400 text-sm">Successful</span>
          </div>
          <span className="text-xl font-bold text-white">{campaign.successful}</span>
        </div>
        <div className="bg-gray-700 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-1">
            <XCircle className="w-4 h-4 text-red-400" />
            <span className="text-gray-400 text-sm">Failed</span>
          </div>
          <span className="text-xl font-bold text-white">{campaign.failed}</span>
        </div>
      </div>
      <div className="space-y-2">
        <div className="flex justify-between text-sm text-gray-400">
          <span>Progress</span>
          <span>{Math.round(progressPercentage)}%</span>
        </div>
        <Progress value={progressPercentage} className="h-3" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Badge className="bg-blue-500/20 text-blue-400">
          Batch Size: {campaign.batchSize}
        </Badge>
        <Badge className="bg-purple-500/20 text-purple-400">
          Workers: {campaign.workers}
        </Badge>
        <Badge className="bg-gray-500/20 text-gray-400">
          Projects: {campaign.projectIds.length}
        </Badge>
      </div>
    </div>
  );
};
