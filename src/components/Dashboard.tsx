
import { useApp } from '@/contexts/AppContext';
import { Server, Users, Send, Activity, TrendingUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';

export const Dashboard = () => {
  const { projects, users, campaigns, currentCampaign } = useApp();

  const totalUsers = Object.values(users).reduce((sum, userList) => sum + userList.length, 0);
  const activeCampaigns = campaigns.filter(c => c.status === 'running').length;
  const completedCampaigns = campaigns.filter(c => c.status === 'completed').length;

  const stats = [
    {
      title: 'Firebase Projects',
      value: projects.length,
      icon: Server,
      color: 'text-blue-500',
      bgColor: 'bg-blue-500/10',
    },
    {
      title: 'Total Users',
      value: totalUsers,
      icon: Users,
      color: 'text-green-500',
      bgColor: 'bg-green-500/10',
    },
    {
      title: 'Active Campaigns',
      value: activeCampaigns,
      icon: Activity,
      color: 'text-orange-500',
      bgColor: 'bg-orange-500/10',
    },
    {
      title: 'Completed Campaigns',
      value: completedCampaigns,
      icon: TrendingUp,
      color: 'text-purple-500',
      bgColor: 'bg-purple-500/10',
    },
  ];

  return (
    <div className="p-8 space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-white mb-2">Dashboard</h1>
        <p className="text-gray-400">Monitor your Firebase email campaigns and projects</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.title} className="bg-gray-800 border-gray-700">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-gray-400 text-sm font-medium">{stat.title}</p>
                    <p className="text-2xl font-bold text-white mt-1">{stat.value}</p>
                  </div>
                  <div className={`p-3 rounded-xl ${stat.bgColor}`}>
                    <Icon className={`w-6 h-6 ${stat.color}`} />
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {currentCampaign && currentCampaign.status === 'running' && (
        <Card className="bg-gray-800 border-gray-700">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <Activity className="w-5 h-5 text-orange-500" />
              Active Campaign
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Progress</span>
              <span className="text-white">
                {currentCampaign.processed} / {Object.values(currentCampaign.selectedUsers).reduce((sum, users) => sum + users.length, 0)}
              </span>
            </div>
            <Progress 
              value={(currentCampaign.processed / Object.values(currentCampaign.selectedUsers).reduce((sum, users) => sum + users.length, 0)) * 100} 
              className="h-2"
            />
            <div className="grid grid-cols-3 gap-4 pt-4">
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
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="bg-gray-800 border-gray-700">
          <CardHeader>
            <CardTitle className="text-white">Recent Projects</CardTitle>
          </CardHeader>
          <CardContent>
            {projects.length === 0 ? (
              <p className="text-gray-400 text-center py-8">No projects added yet</p>
            ) : (
              <div className="space-y-3">
                {projects.slice(0, 5).map((project) => (
                  <div key={project.id} className="flex items-center justify-between p-3 bg-gray-700 rounded-lg">
                    <div>
                      <h4 className="text-white font-medium">{project.name}</h4>
                      <p className="text-gray-400 text-sm">{project.adminEmail}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-gray-400 text-sm">
                        {users[project.id]?.length || 0} users
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-gray-800 border-gray-700">
          <CardHeader>
            <CardTitle className="text-white">Recent Campaigns</CardTitle>
          </CardHeader>
          <CardContent>
            {campaigns.length === 0 ? (
              <p className="text-gray-400 text-center py-8">No campaigns created yet</p>
            ) : (
              <div className="space-y-3">
                {campaigns.slice(-5).reverse().map((campaign) => (
                  <div key={campaign.id} className="flex items-center justify-between p-3 bg-gray-700 rounded-lg">
                    <div>
                      <h4 className="text-white font-medium">Campaign #{campaign.id.slice(-4)}</h4>
                      <p className="text-gray-400 text-sm">
                        {Object.values(campaign.selectedUsers).reduce((sum, users) => sum + users.length, 0)} users
                      </p>
                    </div>
                    <div className="text-right">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                        campaign.status === 'completed' ? 'bg-green-500/20 text-green-500' :
                        campaign.status === 'running' ? 'bg-orange-500/20 text-orange-500' :
                        campaign.status === 'failed' ? 'bg-red-500/20 text-red-500' :
                        'bg-gray-500/20 text-gray-500'
                      }`}>
                        {campaign.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
