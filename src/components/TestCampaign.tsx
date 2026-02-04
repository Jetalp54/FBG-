import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { TestTube, Mail, Zap, CheckCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useEnhancedApp } from '@/contexts/EnhancedAppContext';
import { Checkbox } from '@/components/ui/checkbox';

export const TestCampaign = () => {
  const { projects, profiles, activeProfile } = useEnhancedApp();
  const { toast } = useToast();
  const [testEmail, setTestEmail] = useState('');
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  const [isTesting, setIsTesting] = useState(false);

  // Filter projects by active profile
  const activeProjects = projects.filter(p =>
    (!activeProfile || p.profileId === activeProfile) && p.status === 'active'
  );

  const activeProfileName = profiles.find(p => p.id === activeProfile)?.name || 'All Projects';

  const API_BASE_URL = (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") ? "http://localhost:8000" : "/api";

  const handleProjectToggle = (projectId: string) => {
    setSelectedProjects(prev =>
      prev.includes(projectId)
        ? prev.filter(id => id !== projectId)
        : [...prev, projectId]
    );
  };
  const handleSelectAll = () => {
    setSelectedProjects(activeProjects.map(p => p.id));
  };
  const handleDeselectAll = () => {
    setSelectedProjects([]);
  };

  const sendTestEmail = async () => {
    console.log('TestCampaign: Starting sendTestEmail function');
    console.log('TestCampaign: API_BASE_URL =', API_BASE_URL);
    console.log('TestCampaign: testEmail =', testEmail);
    console.log('TestCampaign: selectedProjects =', selectedProjects);

    if (!testEmail.trim()) {
      toast({
        title: "Email Required",
        description: "Please enter a test email address.",
        variant: "destructive",
      });
      return;
    }
    if (selectedProjects.length === 0) {
      toast({
        title: "Project Required",
        description: "Please select at least one project for testing.",
        variant: "destructive",
      });
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(testEmail)) {
      toast({
        title: "Invalid Email",
        description: "Please enter a valid email address.",
        variant: "destructive",
      });
      return;
    }
    setIsTesting(true);
    try {
      // ensure selected projects are reconnected before testing
      await Promise.all(selectedProjects.map(async (projectId) => {
        try {
          await fetch(`${API_BASE_URL}/projects/${projectId}/reconnect`, { method: 'POST' });
        } catch { }
      }));
      let allSuccess = true;
      for (const projectId of selectedProjects) {
        console.log('TestCampaign: Sending test email for project:', projectId);
        const requestBody = {
          email: testEmail,
          project_id: projectId,
        };
        console.log('TestCampaign: Request body:', requestBody);

        const response = await fetch(`${API_BASE_URL}/test-reset-email`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        });

        console.log('TestCampaign: Response status:', response.status);
        console.log('TestCampaign: Response ok:', response.ok);

        if (!response.ok) {
          allSuccess = false;
          const result = await response.json();
          console.log('TestCampaign: Error response:', result);
          toast({
            title: "Test Failed",
            description: result.error || `Failed to send test email for project ${projectId}`,
            variant: "destructive",
          });
        } else {
          const result = await response.json();
          console.log('TestCampaign: Success response:', result);
        }
      }
      if (allSuccess) {
        toast({
          title: "Test Email Sent! ✨",
          description: `Password reset email sent to ${testEmail} for all selected projects. User was temporarily added and removed from each project.`,
        });
        setTestEmail('');
        setSelectedProjects([]);
      }
    } catch (error) {
      toast({
        title: "Test Failed",
        description: error instanceof Error ? error.message : "Failed to send test email. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="p-8 space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-white mb-2">Test Campaign</h1>
        <p className="text-gray-400">
          Profile: <span className="text-blue-400 font-medium">{activeProfileName}</span> •
          Test password reset functionality with a single email
        </p>
      </div>

      <Card className="bg-gradient-to-r from-green-900/50 to-blue-900/50 border-green-500/50">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <TestTube className="w-5 h-5 text-green-500" />
            Quick Test Setup
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="bg-blue-900/20 border border-blue-500/30 p-4 rounded-lg">
            <div className="flex items-start gap-2">
              <Zap className="w-4 h-4 text-blue-400 mt-0.5" />
              <div className="text-blue-300 text-sm">
                <p className="font-medium mb-1">How Test Mode Works:</p>
                <ul className="text-xs space-y-1">
                  <li>• Temporarily adds the test email to the selected project</li>
                  <li>• Sends a password reset email to that address</li>
                  <li>• Immediately removes the user from the project</li>
                  <li>• All happens in one quick operation</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="testEmail" className="text-gray-300">Test Email Address</Label>
              <Input
                id="testEmail"
                type="email"
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                placeholder="test@example.com"
                className="bg-gray-700 border-gray-600 text-white"
              />
            </div>

            <div>
              <Label className="text-gray-300">Select Projects</Label>
              <div className="flex gap-2 mb-2">
                <Button size="sm" onClick={handleSelectAll} disabled={selectedProjects.length === activeProjects.length}>Select All</Button>
                <Button size="sm" onClick={handleDeselectAll} disabled={selectedProjects.length === 0}>Deselect All</Button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-40 overflow-y-auto border border-gray-600 rounded-lg p-2">
                {activeProjects.map((project) => (
                  <div key={project.id} className="flex items-center gap-2">
                    <Checkbox
                      checked={selectedProjects.includes(project.id)}
                      onCheckedChange={() => handleProjectToggle(project.id)}
                      className="border-gray-500"
                    />
                    <Label className="text-white text-sm cursor-pointer">
                      {project.name}
                    </Label>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <Button
              onClick={sendTestEmail}
              disabled={isTesting || !testEmail || selectedProjects.length === 0}
              className="bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800"
            >
              {isTesting ? (
                <>
                  <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full mr-2" />
                  Sending Test...
                </>
              ) : (
                <>
                  <Mail className="w-4 h-4 mr-2" />
                  Send Test Email
                </>
              )}
            </Button>

            {activeProjects.length === 0 && (
              <Badge className="bg-yellow-500/20 text-yellow-400">
                No active projects in current profile
              </Badge>
            )}
          </div>

          {testEmail && selectedProjects.length > 0 && (
            <div className="bg-gray-700 p-4 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle className="w-4 h-4 text-green-500" />
                <span className="text-white font-medium">Test Configuration</span>
              </div>
              <div className="text-gray-400 text-sm space-y-1">
                <p>Email: <span className="text-white">{testEmail}</span></p>
                <p>Projects: <span className="text-white">{selectedProjects.map(p => activeProjects.find(proj => proj.id === p)?.name).join(', ')}</span></p>
                <p>Action: Temporary user creation → Send reset email → User deletion</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
