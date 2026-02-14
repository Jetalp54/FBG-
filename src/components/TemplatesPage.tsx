import { useState, useEffect } from 'react';
import { useEnhancedApp } from '@/contexts/EnhancedAppContext';
import { FileText, Save, CheckSquare, Square, Globe, Settings, Upload, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import JSON5 from 'json5'; // Add at the top for robust JSON parsing

const API_BASE_URL = (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") ? "http://localhost:8000" : "/api";

export const TemplatesPage = () => {
  const { projects, profiles, activeProfile, addProject, reloadProjectsAndProfiles } = useEnhancedApp();
  const { toast } = useToast();

  // Reset Email Template State
  const [resetSenderName, setResetSenderName] = useState('');
  const [resetFromAddress, setResetFromAddress] = useState('');
  const [resetReplyTo, setResetReplyTo] = useState('');
  const [resetSubject, setResetSubject] = useState('');
  const [resetBody, setResetBody] = useState('');
  const [resetAuthDomain, setResetAuthDomain] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  const [projectSearchTerm, setProjectSearchTerm] = useState('');

  // Domain Management State
  const [newAuthDomain, setNewAuthDomain] = useState('');
  const [domainLoading, setDomainLoading] = useState(false);
  const [projectDomains, setProjectDomains] = useState<any[]>([]);
  const [selectedDomainProjects, setSelectedDomainProjects] = useState<string[]>([]);

  // Bulk Import State
  const [privateKeysFile, setPrivateKeysFile] = useState<File | null>(null);
  const [apiKeysFile, setApiKeysFile] = useState<File | null>(null);
  const [bulkImportStatus, setBulkImportStatus] = useState<string>('');
  const [bulkImportLoading, setBulkImportLoading] = useState(false);
  const [bulkImportLog, setBulkImportLog] = useState<string[]>([]);



  // Filter projects by active profile
  const activeProjects = projects.filter(p =>
    (!activeProfile || p.profileId === activeProfile) && p.status === 'active'
  );

  // Filtered projects
  const filteredProjects = activeProjects.filter(p =>
    p.name.toLowerCase().includes(projectSearchTerm.toLowerCase())
  );

  const handleProjectToggle = (projectId: string) => {
    setSelectedProjects(prev =>
      prev.includes(projectId)
        ? prev.filter(id => id !== projectId)
        : [...prev, projectId]
    );
  };

  const handleSelectAllProjects = () => {
    if (selectedProjects.length === activeProjects.length) {
      setSelectedProjects([]);
    } else {
      setSelectedProjects(activeProjects.map(p => p.id));
    }
  };

  const handleSelectAllDomainProjects = () => {
    if (selectedDomainProjects.length === activeProjects.length) {
      setSelectedDomainProjects([]);
    } else {
      setSelectedDomainProjects(activeProjects.map(p => p.id));
    }
  };

  const handleDomainProjectToggle = (projectId: string) => {
    setSelectedDomainProjects(prev =>
      prev.includes(projectId)
        ? prev.filter(id => id !== projectId)
        : [...prev, projectId]
    );
  };

  // Load project domains on component mount
  useEffect(() => {
    loadProjectDomains();
  }, []);

  const loadProjectDomains = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/project-domains`);
      const data = await response.json();

      if (data.success) {
        setProjectDomains(data.domains);
      }
    } catch (error) {
      console.error('Failed to load project domains:', error);
    }
  };

  const handleResetTemplateSave = async () => {
    if (selectedProjects.length === 0) {
      toast({
        title: 'Select projects',
        description: 'Please select at least one project to update.',
        variant: 'destructive'
      });
      return;
    }

    setResetLoading(true);

    // Build payload with only non-empty fields
    const payload: any = {
      project_ids: selectedProjects,
      user: 'admin'
    };
    if (resetSenderName) payload.senderName = resetSenderName;
    if (resetFromAddress) payload.fromAddress = resetFromAddress;
    if (resetReplyTo) payload.replyTo = resetReplyTo;
    if (resetSubject) payload.subject = resetSubject;
    if (resetBody) payload.body = resetBody;
    if (resetAuthDomain) payload.authDomain = resetAuthDomain;

    try {
      console.log('TemplatesPage: Starting template update');
      console.log('TemplatesPage: Payload size:', JSON.stringify(payload).length, 'characters');
      console.log('TemplatesPage: Body length:', resetBody.length, 'characters');
      console.log('TemplatesPage: API_BASE_URL:', API_BASE_URL);

      // Use bulk endpoint for better performance
      const response = await fetch(`${API_BASE_URL}/update-reset-template-bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      console.log('TemplatesPage: Response status:', response.status);
      console.log('TemplatesPage: Response ok:', response.ok);

      const data = await response.json();

      if (response.ok && data.success) {
        toast({
          title: 'Success',
          description: `Updated ${data.summary.successful} project(s) successfully.`
        });

        // Clear form on success
        setResetSenderName('');
        setResetFromAddress('');
        setResetReplyTo('');
        setResetSubject('');
        setResetBody('');
        setResetAuthDomain('');
        setSelectedProjects([]);
      } else {
        // Handle partial success
        if (data.summary && data.summary.successful > 0) {
          toast({
            title: 'Partial Success',
            description: `Updated ${data.summary.successful} project(s) successfully. ${data.summary.failed} failed.`
          });

          // Clear form on partial success too
          setResetSenderName('');
          setResetFromAddress('');
          setResetReplyTo('');
          setResetSubject('');
          setResetBody('');
          setResetAuthDomain('');
          setSelectedProjects([]);
        } else {
          throw new Error('All updates failed');
        }
      }

      // Log detailed results for debugging
      if (data.results) {
        const failed = data.results.filter((r: any) => !r.success);
        if (failed.length > 0) {
          console.error('Failed updates:', failed);
        }
      }

    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to update templates. Please try again.',
        variant: 'destructive'
      });
      console.error('Template update error:', error);
    } finally {
      setResetLoading(false);
    }
  };

  const handleDomainUpdate = async () => {
    if (selectedDomainProjects.length === 0) {
      toast({
        title: 'Select projects',
        description: 'Please select at least one project to update.',
        variant: 'destructive'
      });
      return;
    }

    if (!newAuthDomain.trim()) {
      toast({
        title: 'Enter domain',
        description: 'Please enter a valid auth domain.',
        variant: 'destructive'
      });
      return;
    }

    setDomainLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/update-project-domain-bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_ids: selectedDomainProjects,
          new_auth_domain: newAuthDomain.trim(),
          user: 'admin'
        })
      });

      const data = await response.json();

      if (response.ok && data.success) {
        toast({
          title: 'Success',
          description: `Updated ${data.summary.successful} project(s) successfully.`
        });

        // Reload project domains
        await loadProjectDomains();

        // Clear form
        setNewAuthDomain('');
        setSelectedDomainProjects([]);

        // Also clear the reset form domain if it was set
        if (resetAuthDomain === newAuthDomain.trim()) {
          setResetAuthDomain('');
        }
      } else {
        // Handle partial success
        if (data.summary && data.summary.successful > 0) {
          toast({
            title: 'Partial Success',
            description: `Updated ${data.summary.successful} project(s) successfully. ${data.summary.failed} failed.`
          });
          await loadProjectDomains();
        } else {
          throw new Error('All updates failed');
        }
      }

      // Log detailed results for debugging
      if (data.results) {
        const failed = data.results.filter((r: any) => !r.success);
        if (failed.length > 0) {
          console.error('Failed domain updates:', failed);
        }
      }

    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to update domains. Please try again.',
        variant: 'destructive'
      });
      console.error('Domain update error:', error);
    } finally {
      setDomainLoading(false);
    }
  };

  const handleBulkImport = async () => {
    if (!privateKeysFile || !apiKeysFile) {
      toast({
        title: "Missing Files",
        description: "Please select both private_keys.json and apikeys.txt files.",
        variant: "destructive",
      });
      return;
    }

    setBulkImportLoading(true);
    setBulkImportStatus('Processing files...');
    setBulkImportLog([]);

    try {
      // Read private keys file
      const privateKeysText = await privateKeysFile.text();
      let privateKeysData;
      try {
        // Use JSON5 to allow trailing commas and comments
        privateKeysData = JSON5.parse(privateKeysText);
      } catch (e) {
        setBulkImportStatus('Import failed. Invalid JSON in private_keys.json.');
        setBulkImportLog(["Error: private_keys.json is not valid JSON. (" + e + ")"]);
        setBulkImportLoading(false);
        return;
      }
      // Read API keys file
      const apiKeysText = await apiKeysFile.text();
      const apiKeysLines = apiKeysText.split('\n').filter(line => line.trim());

      setBulkImportStatus('Matching projects...');

      // Parse API keys into a map
      const apiKeysMap = new Map<string, string>();
      apiKeysLines.forEach(line => {
        const [email, apiKey] = line.split(':');
        if (email && apiKey) {
          // Extract alias from email (part before @)
          const alias = email.split('@')[0];
          apiKeysMap.set(alias, apiKey.trim());
        }
      });

      // Match service accounts with API keys
      const matchedProjects = [];
      const skippedProjects: string[] = [];
      // Handle both single service account and array of service accounts
      const serviceAccounts = Array.isArray(privateKeysData) ? privateKeysData : [privateKeysData];
      for (const serviceAccount of serviceAccounts) {
        const projectId = serviceAccount.project_id;
        // Try to find the email from the API keys file (since some service accounts may not have email field)
        let matchedApiKey = null;
        let matchedEmail = null;
        for (const [alias, apiKey] of apiKeysMap) {
          const normalizedAlias = alias.replace(/\./g, '');
          const normalizedProjectId = projectId.replace(/\./g, '');
          if (normalizedProjectId.startsWith(normalizedAlias)) {
            matchedApiKey = apiKey;
            // Find the full email for this alias
            const emailLine = apiKeysLines.find(line => line.startsWith(alias + '@'));
            if (emailLine) {
              matchedEmail = emailLine.split(':')[0];
            }
            break;
          }
        }
        if (!projectId) {
          skippedProjects.push(`Skipped: Missing project_id in service account: ${JSON.stringify(serviceAccount)}`);
          continue;
        }
        if (!matchedApiKey || !matchedEmail) {
          skippedProjects.push(`Skipped: No matching API key/email for project_id ${projectId}`);
          continue;
        }
        // Store the full service account object as in manual add
        matchedProjects.push({
          projectId,
          serviceAccount,
          apiKey: matchedApiKey,
          email: matchedEmail,
          name: `${projectId} (${matchedEmail.split('@')[0]})`
        });
      }
      setBulkImportStatus(`Found ${matchedProjects.length} matching projects. Adding to system...`);
      let successCount = 0;
      let failCount = 0;
      const failedProjects: string[] = [];
      for (const project of matchedProjects) {
        try {
          // Use the context's addProject function to ensure proper frontend state management
          await addProject({
            id: project.projectId,
            name: project.name,
            adminEmail: project.email,
            apiKey: project.apiKey,
            serviceAccount: project.serviceAccount, // Full object
            profileId: activeProfile || '1752003686731'
          });
          successCount++;
        } catch (error) {
          failCount++;
          failedProjects.push(`Error adding project ${project.projectId}: ${error}`);
        }
      }
      setBulkImportStatus(`Import completed! Added ${successCount} projects successfully. ${failCount} failed. Skipped: ${skippedProjects.length}`);
      setBulkImportLog([
        ...skippedProjects,
        ...failedProjects,
        `Success: ${successCount} projects added.`
      ]);
      toast({
        title: "Bulk Import Complete",
        description: `Successfully added ${successCount} projects. ${failCount} failed. Skipped: ${skippedProjects.length}`,
        variant: successCount > 0 ? "default" : "destructive",
      });
      if (successCount > 0) {
        setPrivateKeysFile(null);
        setApiKeysFile(null);
        // Reload projects and profiles to ensure UI is updated
        await reloadProjectsAndProfiles();
      }
    } catch (error) {
      console.error('Bulk import error:', error);
      setBulkImportStatus('Import failed. Please check file formats.');
      setBulkImportLog([`Error: ${error}`]);
      toast({
        title: "Import Failed",
        description: "Please check that your files are in the correct format.",
        variant: "destructive",
      });
    } finally {
      setBulkImportLoading(false);
    }
  };

  // Auto-refresh projects/profiles on mount (only once)
  useEffect(() => {
    reloadProjectsAndProfiles();
  }, []); // Empty dependency array to run only once


  const activeProfileName = profiles.find(p => p.id === activeProfile)?.name || 'All Projects';

  return (
    <div className="p-8 space-y-8">
      {/* Refresh Button */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <Button variant="outline" onClick={reloadProjectsAndProfiles} title="Refresh Projects and Profiles">
          <RefreshCw className="w-4 h-4 mr-2" /> Refresh
        </Button>
      </div>
      <div>
        <h1 className="text-3xl font-bold text-white mb-2">Firebase Template Manager</h1>
        <p className="text-gray-400">
          Profile: <span className="text-blue-400 font-medium">{activeProfileName}</span> •
          Manage Firebase Identity Platform templates and domains
        </p>
      </div>

      <Tabs defaultValue="email-templates" className="w-full">
        <TabsList className="grid w-full grid-cols-3 bg-gray-800 border-gray-700">
          <TabsTrigger value="email-templates" className="data-[state=active]:bg-gray-700 data-[state=active]:text-white">
            <FileText className="w-4 h-4 mr-2" />
            Email Templates
          </TabsTrigger>
          <TabsTrigger value="domain-management" className="data-[state=active]:bg-gray-700 data-[state=active]:text-white">
            <Globe className="w-4 h-4 mr-2" />
            Domain Management
          </TabsTrigger>
          <TabsTrigger value="bulk-import" className="data-[state=active]:bg-gray-700 data-[state=active]:text-white">
            <Upload className="w-4 h-4 mr-2" />
            Bulk Import
          </TabsTrigger>
        </TabsList>

        <TabsContent value="email-templates" className="space-y-8 mt-6">
          <div className="mb-4">
            <Input
              placeholder="Search projects..."
              value={projectSearchTerm}
              onChange={e => setProjectSearchTerm(e.target.value)}
              className="bg-gray-700 border-gray-600 text-white w-full md:w-1/2"
            />
          </div>

          <Card className="bg-gray-800 border-gray-700">
            <CardHeader>
              <CardTitle className="text-white">Project Selection</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={selectedProjects.length === activeProjects.length && activeProjects.length > 0}
                  onCheckedChange={handleSelectAllProjects}
                />
                <Label className="text-gray-300">Select All Projects</Label>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredProjects.map((project) => (
                  <div key={project.id} className="flex items-center gap-2 p-3 bg-gray-700 rounded-lg">
                    <Checkbox
                      checked={selectedProjects.includes(project.id)}
                      onCheckedChange={() => handleProjectToggle(project.id)}
                    />
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-green-500" />
                      <span className="text-white text-sm">{project.name}</span>
                    </div>
                  </div>
                ))}
              </div>

              {activeProjects.length === 0 && (
                <div className="text-center py-8 text-gray-400">
                  No active projects found in the current profile.
                </div>
              )}
            </CardContent>
          </Card>

          {selectedProjects.length > 0 && (
            <Card className="bg-gray-800 border-gray-700">
              <CardHeader>
                <CardTitle className="text-white">Reset Password Email Template</CardTitle>
                <p className="text-gray-400 text-sm">
                  Selected {selectedProjects.length} project(s): {selectedProjects.map(id =>
                    activeProjects.find(p => p.id === id)?.name
                  ).join(', ')}
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-gray-300">Sender Name</Label>
                    <Input
                      value={resetSenderName}
                      onChange={e => setResetSenderName(e.target.value)}
                      placeholder="Your Company Name"
                      className="bg-gray-700 border-gray-600 text-white"
                    />
                  </div>
                  <div>
                    <Label className="text-gray-300">From (Local part)</Label>
                    <Input
                      value={resetFromAddress}
                      onChange={e => setResetFromAddress(e.target.value)}
                      placeholder="noreply"
                      className="bg-gray-700 border-gray-600 text-white"
                    />
                  </div>
                  <div>
                    <Label className="text-gray-300">Reply-To</Label>
                    <Input
                      value={resetReplyTo}
                      onChange={e => setResetReplyTo(e.target.value)}
                      placeholder="support@yourcompany.com"
                      className="bg-gray-700 border-gray-600 text-white"
                    />
                  </div>
                  <div>
                    <Label className="text-gray-300">Subject</Label>
                    <Input
                      value={resetSubject}
                      onChange={e => setResetSubject(e.target.value)}
                      placeholder="Reset Your Password"
                      className="bg-gray-700 border-gray-600 text-white"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <Label className="text-gray-300 flex items-center gap-2">
                      <Globe className="w-4 h-4" />
                      Auth Domain (Optional)
                    </Label>
                    <Input
                      value={resetAuthDomain}
                      onChange={e => setResetAuthDomain(e.target.value)}
                      placeholder="auth.yourdomain.com"
                      className="bg-gray-700 border-gray-600 text-white"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Enter a custom authentication domain for selected projects (e.g., auth.yourdomain.com).
                      <br />
                      <strong>Note:</strong> This sets the auth domain for login redirects and email templates. Once verified in Cloudflare, this domain will be used for your password reset links.
                    </p>
                  </div>
                </div>
                <div>
                  <Label className="text-gray-300">HTML Body</Label>
                  <Textarea
                    value={resetBody}
                    onChange={e => setResetBody(e.target.value)}
                    placeholder="<h1>Reset Your Password</h1><p>Click the link below to reset your password:</p><a href='{{reset_link}}'>Reset Password</a>"
                    className="min-h-[200px] bg-gray-700 border-gray-600 text-white font-mono text-sm"
                  />
                </div>
                <Button
                  onClick={handleResetTemplateSave}
                  disabled={resetLoading}
                  className="bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800"
                >
                  {resetLoading ? 'Updating Templates...' : `Update ${selectedProjects.length} Project(s)`}
                </Button>
              </CardContent>
            </Card>
          )}

          {selectedProjects.length === 0 && activeProjects.length > 0 && (
            <Card className="bg-gray-800 border-gray-700">
              <CardContent className="py-12 text-center">
                <FileText className="w-12 h-12 text-gray-500 mx-auto mb-4" />
                <h3 className="text-xl font-semibold text-white mb-2">Select Projects</h3>
                <p className="text-gray-400">
                  Choose one or more Firebase projects to update their reset password email templates.
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="domain-management" className="space-y-8 mt-6">
          <Card className="bg-gray-800 border-gray-700">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Settings className="w-5 h-5" />
                Email Domain Configuration Guide
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-blue-900/30 border border-blue-500/30 rounded-lg p-4">
                <h4 className="text-blue-400 font-medium mb-2">🔧 Custom Email Domain Setup</h4>
                <p className="text-gray-300 text-sm mb-3">
                  To use a custom domain (like yourcompany.com) for sending Firebase emails instead of the default @projectid.firebaseapp.com:
                </p>
                <ol className="text-gray-300 text-sm space-y-2 list-decimal list-inside">
                  <li>In the <strong>Domain Management</strong> section below, select your projects and enter your custom domain.</li>
                  <li>Click <strong>Update Auth Domains</strong> to configure Firebase Identity Platform.</li>
                  <li>Ensure your domain is verified in the <strong>Cloudflare</strong> tab.</li>
                  <li>The system will automatically set the custom email handler domain and SMTP settings for you.</li>
                </ol>
              </div>
              <div className="bg-yellow-900/30 border border-yellow-500/30 rounded-lg p-4">
                <h4 className="text-yellow-400 font-medium mb-2">⚠️ Important Notes</h4>
                <ul className="text-gray-300 text-sm space-y-1 list-disc list-inside">
                  <li>Updating the domain sets both the Auth Domain and the Custom Email Handler domain.</li>
                  <li>Email domains are configured to use <strong>CUSTOM_SMTP</strong> method by default.</li>
                  <li>You must own and verify the custom domain in Cloudflare first.</li>
                  <li>SMTP credentials should be configured in the <strong>Settings → SMTP Config</strong> tab if you want to use a specific provider.</li>
                </ul>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gray-800 border-gray-700">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Globe className="w-5 h-5" />
                Current Project Domains
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {projectDomains.map((domain) => (
                  <div key={domain.project_id} className="p-4 bg-gray-700 rounded-lg">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-2 h-2 rounded-full bg-blue-500" />
                      <span className="text-white font-medium text-sm">{domain.project_name}</span>
                    </div>
                    <div className="space-y-1">
                      <div className="text-xs text-gray-400">Auth Domain:</div>
                      <div className="text-sm text-white font-mono">{domain.current_auth_domain}</div>
                      {domain.current_auth_domain !== domain.default_domain && (
                        <div className="text-xs text-green-400">Custom auth domain configured</div>
                      )}
                      <div className="text-xs text-gray-400 mt-2">Email Domain:</div>
                      <div className="text-sm text-green-400 font-mono">noreply@{domain.current_auth_domain}</div>
                      <div className="text-xs text-gray-400">Custom email handler configured</div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gray-800 border-gray-700">
            <CardHeader>
              <CardTitle className="text-white">Update Auth Domains</CardTitle>
              <p className="text-gray-400 text-sm">
                Change the authentication domain for selected Firebase projects. This affects where users will be redirected for authentication.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={selectedDomainProjects.length === activeProjects.length && activeProjects.length > 0}
                  onCheckedChange={handleSelectAllDomainProjects}
                />
                <Label className="text-gray-300">Select All Projects</Label>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {activeProjects.map((project) => (
                  <div key={project.id} className="flex items-center gap-2 p-3 bg-gray-700 rounded-lg">
                    <Checkbox
                      checked={selectedDomainProjects.includes(project.id)}
                      onCheckedChange={() => handleDomainProjectToggle(project.id)}
                    />
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-green-500" />
                      <span className="text-white text-sm">{project.name}</span>
                    </div>
                  </div>
                ))}
              </div>

              {selectedDomainProjects.length > 0 && (
                <div className="space-y-4">
                  <div>
                    <Label className="text-gray-300">New Auth Domain</Label>
                    <Input
                      value={newAuthDomain}
                      onChange={e => setNewAuthDomain(e.target.value)}
                      placeholder="auth.yourdomain.com"
                      className="bg-gray-700 border-gray-600 text-white"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Enter the domain where users will be redirected for authentication (e.g., auth.yourdomain.com)
                    </p>
                  </div>
                  <Button
                    onClick={handleDomainUpdate}
                    disabled={domainLoading}
                    className="bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800"
                  >
                    {domainLoading ? 'Updating Domains...' : `Update ${selectedDomainProjects.length} Project(s)`}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {selectedDomainProjects.length === 0 && activeProjects.length > 0 && (
            <Card className="bg-gray-800 border-gray-700">
              <CardContent className="py-12 text-center">
                <Globe className="w-12 h-12 text-gray-500 mx-auto mb-4" />
                <h3 className="text-xl font-semibold text-white mb-2">Select Projects</h3>
                <p className="text-gray-400">
                  Choose one or more Firebase projects to update their authentication domains.
                </p>
              </CardContent>
            </Card>
          )}


        </TabsContent>

        <TabsContent value="bulk-import" className="space-y-8 mt-6">
          <Card className="bg-gray-800 border-gray-700">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Upload className="w-5 h-5" />
                Bulk Project Import
              </CardTitle>
              <p className="text-gray-400 text-sm">
                Import multiple Firebase projects by uploading private_keys.json and apikeys.txt files.
              </p>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="bg-blue-900/30 border border-blue-500/30 rounded-lg p-4">
                <h4 className="text-blue-400 font-medium mb-2">📁 File Format Requirements</h4>
                <div className="space-y-1 text-xs text-blue-200">
                  <div><b>private_keys.json:</b> JSON array of Firebase service account objects or single service account object</div>
                  <div className="bg-blue-950/50 p-2 rounded mt-1 font-mono text-blue-100">[&#123;"type": "service_account", "project_id": "johnlee99p450", ...&#125;, ...]</div>
                  <div className="mt-2"><b>apikeys.txt:</b> Text file with email:apikey pairs, one per line</div>
                  <div className="bg-blue-950/50 p-2 rounded mt-1 font-mono text-blue-100">john.lee99@yourdomain.com:AIzaSyCCN5QSS3uQlH6...  jenniferdap961@yourdomain.com:AIzaSyCKER...</div>
                </div>
              </div>
              <div className="bg-yellow-900/30 border border-yellow-500/30 rounded-lg p-4">
                <h4 className="text-yellow-400 font-medium mb-2">🧠 Matching Logic</h4>
                <div className="space-y-1 text-xs text-yellow-200">
                  <div>The system matches projects by finding the alias (part before @) in the email that matches the beginning of the project_id:</div>
                  <div className="ml-4">john.lee99@domain.com matches project_id johnlee99p450</div>
                  <div className="ml-4">jenniferdap961@domain.com matches project_id jenniferdap961</div>
                </div>
              </div>
              <div className="flex flex-col md:flex-row gap-4">
                <div className="flex-1">
                  <Label className="text-gray-300">Private Keys File (JSON)</Label>
                  <Input type="file" accept=".json" onChange={e => setPrivateKeysFile(e.target.files?.[0] || null)} />
                  {privateKeysFile && <div className="text-green-400 text-xs mt-1">✔ {privateKeysFile.name}</div>}
                </div>
                <div className="flex-1">
                  <Label className="text-gray-300">API Keys File (TXT)</Label>
                  <Input type="file" accept=".txt" onChange={e => setApiKeysFile(e.target.files?.[0] || null)} />
                  {apiKeysFile && <div className="text-green-400 text-xs mt-1">✔ {apiKeysFile.name}</div>}
                </div>
              </div>
              <div className="flex items-center gap-4">
                <Button onClick={handleBulkImport} disabled={bulkImportLoading} className="bg-fuchsia-700 hover:bg-fuchsia-800">
                  {bulkImportLoading ? 'Importing...' : 'Import Projects'}
                </Button>
                <span className="text-gray-400 text-xs">{bulkImportStatus}</span>
              </div>
              {bulkImportLog.length > 0 && (
                <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 mt-2 max-h-60 overflow-y-auto">
                  <h4 className="text-fuchsia-400 font-medium mb-2">Import Log</h4>
                  <ul className="text-xs text-gray-200 space-y-1">
                    {bulkImportLog.map((log, idx) => (
                      <li key={idx}>{log}</li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>

          {!privateKeysFile && !apiKeysFile && (
            <Card className="bg-gray-800 border-gray-700">
              <CardContent className="py-12 text-center">
                <Upload className="w-12 h-12 text-gray-500 mx-auto mb-4" />
                <h3 className="text-xl font-semibold text-white mb-2">Upload Files</h3>
                <p className="text-gray-400">
                  Select your private_keys.json and apikeys.txt files to begin bulk import.
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};
