
import { useApp } from '@/contexts/AppContext';
import { Activity, Clock, Mail, AlertTriangle, Pause, Play, BarChart3 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';

export const CampaignMonitor = () => {
  const { currentCampaign, campaignStats, pauseCampaign, resumeCampaign, projects } = useApp();

  if (!currentCampaign || !campaignStats) return null;

  const totalUsers = Object.values(currentCampaign.selectedUsers).reduce((sum, users) => sum + users.length, 0);
  const progressPercentage = (currentCampaign.processed / totalUsers) * 100;
  const successRate = currentCampaign.processed > 0 ? (currentCampaign.successful / currentCampaign.processed) * 100 : 0;
  
  const currentProject = projects.find(p => p.id === currentCampaign.currentProject);
  const estimatedTimeFormatted = Math.floor(campaignStats.estimatedTimeRemaining / 1000 / 60);

  const handlePauseResume = () => {
    if (currentCampaign.status === 'running') {
      pauseCampaign(currentCampaign.id);
    } else if (currentCampaign.status === 'paused') {
      resumeCampaign(currentCampaign.id);
    }
  };

  return (
    <Card className="bg-gray-800 border-gray-700 border-orange-500/50">
      <CardHeader>
        <div className="flex justify-between items-center">
          <CardTitle className="text-white flex items-center gap-2">
            <Activity className={`w-5 h-5 ${
              currentCampaign.status === 'running' ? 'text-orange-500 animate-pulse' : 'text-yellow-500'
            }`} />
            Campaign #{currentCampaign.id.slice(-4)} - {currentCampaign.status.toUpperCase()}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="bg-blue-500/20 text-blue-400">
              {currentProject?.name}
            </Badge>
            {(currentCampaign.status === 'running' || currentCampaign.status === 'paused') && (
              <Button
                size="sm"
                onClick={handlePauseResume}
                variant="outline"
                className="border-gray-600 text-gray-300 hover:bg-gray-700"
              >
                {currentCampaign.status === 'running' ? (
                  <>
                    <Pause className="w-3 h-3 mr-1" />
                    Pause
                  </>
                ) : (
                  <>
                    <Play className="w-3 h-3 mr-1" />
                    Resume
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Real-time Stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="text-center">
            <p className="text-2xl font-bold text-white">{currentCampaign.processed}</p>
            <p className="text-gray-400 text-sm">Processed</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-green-500">{currentCampaign.successful}</p>
            <p className="text-gray-400 text-sm">Successful</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-red-500">{currentCampaign.failed}</p>
            <p className="text-gray-400 text-sm">Failed</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-blue-500">{currentCampaign.currentBatch}/{currentCampaign.totalBatches}</p>
            <p className="text-gray-400 text-sm">Batch</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-purple-500">{successRate.toFixed(1)}%</p>
            <p className="text-gray-400 text-sm">Success Rate</p>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Overall Progress</span>
            <span className="text-white">
              {currentCampaign.processed} / {totalUsers} users ({progressPercentage.toFixed(1)}%)
            </span>
          </div>
          <Progress value={progressPercentage} className="h-3" />
        </div>

        {/* Campaign Details */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-gray-700/50 p-3 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <Mail className="w-4 h-4 text-blue-400" />
              <span className="text-gray-300 font-medium">Current Status</span>
            </div>
            <p className="text-white text-sm">
              Processing batch {currentCampaign.currentBatch} of {currentCampaign.totalBatches}
            </p>
            <p className="text-gray-400 text-xs">
              Batch size: {currentCampaign.batchSize} users
            </p>
          </div>
          
          <div className="bg-gray-700/50 p-3 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="w-4 h-4 text-green-400" />
              <span className="text-gray-300 font-medium">Time Remaining</span>
            </div>
            <p className="text-white text-sm">
              ~{estimatedTimeFormatted} minutes
            </p>
            <p className="text-gray-400 text-xs">
              Based on current rate
            </p>
          </div>
          
          <div className="bg-gray-700/50 p-3 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <BarChart3 className="w-4 h-4 text-purple-400" />
              <span className="text-gray-300 font-medium">Performance</span>
            </div>
            <p className="text-white text-sm">
              {currentCampaign.workers} workers active
            </p>
            <p className="text-gray-400 text-xs">
              ~{Math.round(60000 / 150)} emails/min
            </p>
          </div>
        </div>

        {/* Error Log */}
        {currentCampaign.errors.length > 0 && (
          <div className="bg-red-900/20 border border-red-500/30 p-4 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="w-4 h-4 text-red-400" />
              <span className="text-red-300 font-medium">Recent Errors ({currentCampaign.errors.length})</span>
            </div>
            <div className="max-h-32 overflow-y-auto space-y-1">
              {currentCampaign.errors.slice(-5).map((error, index) => (
                <p key={index} className="text-red-300 text-xs font-mono">
                  {error}
                </p>
              ))}
            </div>
          </div>
        )}

        {/* Campaign Info */}
        <div className="text-xs text-gray-500 space-y-1">
          <p>Started: {currentCampaign.startedAt ? new Date(currentCampaign.startedAt).toLocaleString() : 'Not started'}</p>
          <p>Projects: {currentCampaign.projectIds.length} selected</p>
          <p>Campaign ID: {currentCampaign.id}</p>
        </div>
      </CardContent>
    </Card>
  );
};
