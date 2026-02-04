
import { useEnhancedApp } from '@/contexts/EnhancedAppContext';
import { Activity, Users, Send, AlertTriangle, BarChart3, Zap, Clock, Target } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';

export const EnhancedDashboard = () => {
  const { projects, users, campaigns, currentCampaign, dailyCounts } = useEnhancedApp();

  const totalUsers = Object.values(users).reduce((sum, projectUsers) => sum + projectUsers.length, 0);
  const activeUsers = Object.values(users).reduce((sum, projectUsers) => 
    sum + projectUsers.filter(user => !user.disabled).length, 0
  );
  
  const todaysSentCount = Object.values(dailyCounts).reduce((sum, count) => {
    const today = new Date().toISOString().split('T')[0];
    return count.date === today ? sum + count.sent : sum;
  }, 0);

  const activeCampaigns = campaigns.filter(c => c.status === 'running' || c.status === 'paused');
  const completedCampaigns = campaigns.filter(c => c.status === 'completed');

  return (
    <div className="p-8 space-y-8">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Enhanced Dashboard</h1>
          <p className="text-gray-400">Multi-project Firebase password reset campaign manager</p>
        </div>
        <div className="flex items-center gap-2">
          {currentCampaign && (
            <Badge className={`${
              currentCampaign.status === 'running' ? 'bg-orange-500/20 text-orange-500 animate-pulse' :
              currentCampaign.status === 'paused' ? 'bg-yellow-500/20 text-yellow-500' :
              'bg-gray-500/20 text-gray-500'
            }`}>
              Campaign {currentCampaign.status}
            </Badge>
          )}
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card className="bg-gradient-to-r from-blue-900/30 to-blue-800/30 border-blue-500/30">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-blue-300 text-sm font-medium">Active Projects</p>
                <p className="text-3xl font-bold text-white">{projects.filter(p => p.status === 'active').length}</p>
                <p className="text-blue-300 text-xs">of {projects.length} total</p>
              </div>
              <div className="p-3 bg-blue-500/20 rounded-full">
                <Target className="w-6 h-6 text-blue-400" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-r from-green-900/30 to-green-800/30 border-green-500/30">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-green-300 text-sm font-medium">Total Users</p>
                <p className="text-3xl font-bold text-white">{totalUsers.toLocaleString()}</p>
                <p className="text-green-300 text-xs">{activeUsers.toLocaleString()} active</p>
              </div>
              <div className="p-3 bg-green-500/20 rounded-full">
                <Users className="w-6 h-6 text-green-400" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-r from-purple-900/30 to-purple-800/30 border-purple-500/30">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-purple-300 text-sm font-medium">Today's Sent</p>
                <p className="text-3xl font-bold text-white">{todaysSentCount.toLocaleString()}</p>
                <p className="text-purple-300 text-xs">across all projects</p>
              </div>
              <div className="p-3 bg-purple-500/20 rounded-full">
                <Send className="w-6 h-6 text-purple-400" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-r from-orange-900/30 to-orange-800/30 border-orange-500/30">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-orange-300 text-sm font-medium">Active Campaigns</p>
                <p className="text-3xl font-bold text-white">{activeCampaigns.length}</p>
                <p className="text-orange-300 text-xs">{completedCampaigns.length} completed</p>
              </div>
              <div className="p-3 bg-orange-500/20 rounded-full">
                <Activity className="w-6 h-6 text-orange-400" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Current Campaign Status */}
      {currentCampaign && (
        <Card className="bg-gradient-to-r from-gray-800 to-gray-900 border-orange-500/50">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <Activity className="w-5 h-5 text-orange-500" />
              Current Campaign: {currentCampaign.name}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <div className="text-center">
                <p className="text-gray-400 text-sm">Progress</p>
                <p className="text-2xl font-bold text-white">
                  {((currentCampaign.processed / Object.values(currentCampaign.selectedUsers).reduce((sum, users) => sum + users.length, 0)) * 100).toFixed(1)}%
                </p>
              </div>
              <div className="text-center">
                <p className="text-gray-400 text-sm">Processed</p>
                <p className="text-2xl font-bold text-blue-400">{currentCampaign.processed}</p>
              </div>
              <div className="text-center">
                <p className="text-gray-400 text-sm">Successful</p>
                <p className="text-2xl font-bold text-green-400">{currentCampaign.successful}</p>
              </div>
              <div className="text-center">
                <p className="text-gray-400 text-sm">Failed</p>
                <p className="text-2xl font-bold text-red-400">{currentCampaign.failed}</p>
              </div>
            </div>
            
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Overall Progress</span>
                <span className="text-white">
                  {currentCampaign.processed} / {Object.values(currentCampaign.selectedUsers).reduce((sum, users) => sum + users.length, 0)}
                </span>
              </div>
              <Progress 
                value={(currentCampaign.processed / Object.values(currentCampaign.selectedUsers).reduce((sum, users) => sum + users.length, 0)) * 100} 
                className="h-3"
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Project Overview */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="bg-gray-800 border-gray-700">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <BarChart3 className="w-5 h-5" />
              Project Status Overview
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {projects.slice(0, 5).map((project) => {
              const projectUsers = users[project.id] || [];
              const dailyCount = Object.values(dailyCounts).find(d => 
                d.project_id === project.id && d.date === new Date().toISOString().split('T')[0]
              )?.sent || 0;
              
              return (
                <div key={project.id} className="flex items-center justify-between py-3 border-b border-gray-700 last:border-b-0">
                  <div className="flex-1">
                    <h4 className="text-white font-medium">{project.name}</h4>
                    <p className="text-gray-400 text-sm">{project.adminEmail}</p>
                  </div>
                  <div className="flex items-center gap-4 text-right">
                    <div>
                      <p className="text-white text-sm font-medium">{projectUsers.length}</p>
                      <p className="text-gray-400 text-xs">users</p>
                    </div>
                    <div>
                      <p className="text-purple-400 text-sm font-medium">{dailyCount}</p>
                      <p className="text-gray-400 text-xs">sent today</p>
                    </div>
                    <Badge className={`${
                      project.status === 'active' ? 'bg-green-500/20 text-green-500' :
                      project.status === 'loading' ? 'bg-yellow-500/20 text-yellow-500' :
                      'bg-red-500/20 text-red-500'
                    }`}>
                      {project.status}
                    </Badge>
                  </div>
                </div>
              );
            })}
            {projects.length > 5 && (
              <p className="text-gray-500 text-center text-sm">
                ... and {projects.length - 5} more projects
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="bg-gray-800 border-gray-700">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <Clock className="w-5 h-5" />
              Recent Campaign Activity
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {campaigns.slice(-5).reverse().map((campaign) => {
              const totalUsers = Object.values(campaign.selectedUsers).reduce((sum, users) => sum + users.length, 0);
              const progress = totalUsers > 0 ? (campaign.processed / totalUsers) * 100 : 0;
              
              return (
                <div key={campaign.id} className="py-3 border-b border-gray-700 last:border-b-0">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-white font-medium">{campaign.name}</h4>
                    <Badge className={`${
                      campaign.status === 'completed' ? 'bg-green-500/20 text-green-500' :
                      campaign.status === 'running' ? 'bg-orange-500/20 text-orange-500' :
                      campaign.status === 'paused' ? 'bg-yellow-500/20 text-yellow-500' :
                      campaign.status === 'failed' ? 'bg-red-500/20 text-red-500' :
                      'bg-gray-500/20 text-gray-500'
                    }`}>
                      {campaign.status}
                    </Badge>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">{campaign.projectIds.length} projects • {totalUsers} users</span>
                      <span className="text-gray-400">{campaign.processed} processed</span>
                    </div>
                    {campaign.status !== 'pending' && (
                      <Progress value={progress} className="h-2" />
                    )}
                  </div>
                </div>
              );
            })}
            {campaigns.length === 0 && (
              <div className="text-center py-8 text-gray-500">
                No campaigns created yet
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Performance Metrics */}
      <Card className="bg-gray-800 border-gray-700">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Zap className="w-5 h-5" />
            System Performance
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="text-center">
              <div className="flex items-center justify-center gap-2 mb-2">
                <Users className="w-5 h-5 text-blue-400" />
                <span className="text-gray-300">User Distribution</span>
              </div>
              <p className="text-2xl font-bold text-white">
                {projects.length > 0 ? Math.round(totalUsers / projects.length) : 0}
              </p>
              <p className="text-gray-400 text-sm">avg users per project</p>
            </div>
            
            <div className="text-center">
              <div className="flex items-center justify-center gap-2 mb-2">
                <Send className="w-5 h-5 text-green-400" />
                <span className="text-gray-300">Daily Average</span>
              </div>
              <p className="text-2xl font-bold text-white">
                {projects.length > 0 ? Math.round(todaysSentCount / projects.length) : 0}
              </p>
              <p className="text-gray-400 text-sm">emails per project today</p>
            </div>
            
            <div className="text-center">
              <div className="flex items-center justify-center gap-2 mb-2">
                <Activity className="w-5 h-5 text-purple-400" />
                <span className="text-gray-300">Success Rate</span>
              </div>
              <p className="text-2xl font-bold text-white">
                {campaigns.length > 0 ? 
                  Math.round((campaigns.reduce((sum, c) => sum + c.successful, 0) / 
                             Math.max(1, campaigns.reduce((sum, c) => sum + c.processed, 0))) * 100) : 0}%
              </p>
              <p className="text-gray-400 text-sm">overall campaign success</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
