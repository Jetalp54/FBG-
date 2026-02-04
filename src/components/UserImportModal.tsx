
import { useState } from 'react';
import { useEnhancedApp } from '@/contexts/EnhancedAppContext';
import { Upload, Download, FileText, Users, AlertCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { Progress } from '@/components/ui/progress';

interface UserImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  availableProjects: any[];
}

export const UserImportModal: React.FC<UserImportModalProps> = ({ isOpen, onClose, availableProjects }) => {
  const { importUsers } = useEnhancedApp();
  const { toast } = useToast();
  const [emails, setEmails] = useState('');
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  const [distributeEvenly, setDistributeEvenly] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [allowDuplicateAcrossProjects, setAllowDuplicateAcrossProjects] = useState(false);
  const [allowDuplicateInProject, setAllowDuplicateInProject] = useState(false);

  if (!isOpen) return null;

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      setEmails(content);
    };
    reader.readAsText(file);
  };

  const parseEmails = (text: string): string[] => {
    let emails = text
      .split(/[\n,;]/)
      .map(email => email.trim())
      .filter(email => email && email.includes('@'));
    if (!allowDuplicateInProject) {
      emails = emails.filter((email, index, arr) => arr.indexOf(email) === index);
    }
    return emails;
  };

  const handleProjectToggle = (projectId: string) => {
    setSelectedProjects(prev => {
      if (prev.includes(projectId)) {
        return prev.filter(id => id !== projectId);
      } else {
        return [...prev, projectId];
      }
    });
  };

  const distributeEmailsEvenly = (emails: string[], projectIds: string[]) => {
    const distribution: { [projectId: string]: string[] } = {};
    projectIds.forEach(id => distribution[id] = []);

    emails.forEach((email, index) => {
      const projectIndex = index % projectIds.length;
      distribution[projectIds[projectIndex]].push(email);
    });

    return distribution;
  };

  const handleImport = async () => {
    if (selectedProjects.length === 0) {
      toast({
        title: "No projects selected",
        description: "Please select at least one project to import users to.",
        variant: "destructive",
      });
      return;
    }
    let emailList = parseEmails(emails);
    if (!allowDuplicateAcrossProjects) {
      // Remove emails already assigned to a project from being assigned to another
      emailList = emailList.filter((email, index, arr) => arr.indexOf(email) === index);
    }
    if (emailList.length === 0) {
      toast({
        title: "No valid emails found",
        description: "Please enter valid email addresses.",
        variant: "destructive",
      });
      return;
    }
    setIsImporting(true);
    setImportProgress(0);
    try {
      const progressInterval = setInterval(() => {
        setImportProgress(prev => Math.min(prev + 10, 90));
      }, 200);
      let totalImported = 0;
      if (distributeEvenly && selectedProjects.length > 1) {
        // Distribute emails evenly across selected projects
        const distribution: { [projectId: string]: string[] } = {};
        selectedProjects.forEach(id => distribution[id] = []);
        emailList.forEach((email, index) => {
          const projectIndex = index % selectedProjects.length;
          if (allowDuplicateAcrossProjects || !distribution[selectedProjects[projectIndex]].includes(email)) {
            distribution[selectedProjects[projectIndex]].push(email);
          }
        });
        for (const [projectId, projectEmails] of Object.entries(distribution)) {
          if (projectEmails.length > 0) {
            const imported = await importUsers([projectId], projectEmails);
            totalImported += imported;
          }
        }
      } else {
        // Import all emails to all selected projects
        for (const projectId of selectedProjects) {
          let projectEmails = emailList;
          if (!allowDuplicateAcrossProjects) {
            projectEmails = projectEmails.filter((email, idx, arr) => arr.indexOf(email) === idx);
          }
          if (!allowDuplicateInProject) {
            projectEmails = projectEmails.filter((email, idx, arr) => arr.indexOf(email) === idx);
          }
          const imported = await importUsers([projectId], projectEmails);
          totalImported += imported;
        }
      }
      clearInterval(progressInterval);
      setImportProgress(100);
      toast({
        title: "Import completed",
        description: `Successfully imported ${totalImported} users${distributeEvenly ? ' (distributed evenly)' : ''}.`,
      });
      setTimeout(() => {
        onClose();
        setEmails('');
        setSelectedProjects([]);
        setDistributeEvenly(false);
        setAllowDuplicateAcrossProjects(false);
        setAllowDuplicateInProject(false);
      }, 1000);
    } catch (error) {
      toast({
        title: "Import failed",
        description: "Failed to import users. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsImporting(false);
      setImportProgress(0);
    }
  };

  const emailList = parseEmails(emails);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <Card className="bg-gray-800 border-gray-700 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Upload className="w-5 h-5" />
            Import Users
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <Label className="text-gray-300">Select Projects ({selectedProjects.length} selected)</Label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2 max-h-40 overflow-y-auto border border-gray-600 rounded-lg p-3">
              {availableProjects.map((project) => (
                <div key={project.id} className="flex items-center space-x-2">
                  <Checkbox
                    id={`project-${project.id}`}
                    checked={selectedProjects.includes(project.id)}
                    onCheckedChange={(checked) => {
                      if (checked === true) {
                        handleProjectToggle(project.id);
                      } else if (checked === false) {
                        setSelectedProjects(prev => prev.filter(id => id !== project.id));
                      }
                    }}
                    className="border-gray-500"
                  />
                  <Label htmlFor={`project-${project.id}`} className="text-white text-sm cursor-pointer">
                    {project.name}
                  </Label>
                </div>
              ))}
            </div>
          </div>

          {selectedProjects.length > 1 && (
            <div className="flex items-center space-x-2">
              <Checkbox
                id="distribute-evenly"
                checked={distributeEvenly}
                onCheckedChange={(checked) => {
                  if (checked === true) {
                    setDistributeEvenly(true);
                  } else if (checked === false) {
                    setDistributeEvenly(false);
                  }
                }}
                className="border-gray-500"
              />
              <Label htmlFor="distribute-evenly" className="text-white text-sm cursor-pointer">
                Distribute emails evenly across selected projects
              </Label>
            </div>
          )}

          <div className="flex items-center space-x-2 mb-2">
            <Checkbox
              id="allow-duplicate-across-projects"
              checked={allowDuplicateAcrossProjects}
              onCheckedChange={setAllowDuplicateAcrossProjects}
              className="border-gray-500"
            />
            <Label htmlFor="allow-duplicate-across-projects" className="text-white text-sm cursor-pointer">
              Allow duplicate emails across projects
            </Label>
          </div>
          <div className="flex items-center space-x-2 mb-4">
            <Checkbox
              id="allow-duplicate-in-project"
              checked={allowDuplicateInProject}
              onCheckedChange={setAllowDuplicateInProject}
              className="border-gray-500"
            />
            <Label htmlFor="allow-duplicate-in-project" className="text-white text-sm cursor-pointer">
              Allow duplicate emails in the same project
            </Label>
          </div>

          <div>
            <Label className="text-gray-300">Upload CSV/TXT File</Label>
            <div className="mt-2">
              <input
                type="file"
                accept=".csv,.txt"
                onChange={handleFileUpload}
                className="hidden"
                id="file-upload"
              />
              <Button
                variant="outline"
                onClick={() => document.getElementById('file-upload')?.click()}
                className="border-gray-600 text-gray-300 hover:bg-gray-700"
              >
                <FileText className="w-4 h-4 mr-2" />
                Choose File
              </Button>
            </div>
          </div>

          <div>
            <Label className="text-gray-300">Or paste email addresses</Label>
            <p className="text-gray-500 text-sm mb-2">
              One email per line, or separated by commas/semicolons
            </p>
            <Textarea
              value={emails}
              onChange={(e) => setEmails(e.target.value)}
              placeholder="user1@example.com&#10;user2@example.com&#10;user3@example.com"
              rows={8}
              className="bg-gray-700 border-gray-600 text-white"
            />
          </div>

          {emailList.length > 0 && (
            <div className="bg-gray-700 p-4 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <Users className="w-4 h-4 text-green-500" />
                <span className="text-white font-medium">
                  {emailList.length} valid emails found
                </span>
              </div>
              {distributeEvenly && selectedProjects.length > 1 && (
                <div className="text-sm text-blue-400 mb-2">
                  Will be distributed evenly: ~{Math.ceil(emailList.length / selectedProjects.length)} emails per project
                </div>
              )}
              <div className="text-gray-400 text-sm max-h-32 overflow-y-auto">
                {emailList.slice(0, 10).map((email, index) => (
                  <div key={index}>{email}</div>
                ))}
                {emailList.length > 10 && (
                  <div className="text-gray-500">... and {emailList.length - 10} more</div>
                )}
              </div>
            </div>
          )}

          {isImporting && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Importing users...</span>
                <span className="text-white">{importProgress}%</span>
              </div>
              <Progress value={importProgress} className="h-2" />
            </div>
          )}

          <div className="bg-blue-900/20 border border-blue-500/30 p-4 rounded-lg">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-blue-400 mt-0.5" />
              <div className="text-blue-300 text-sm">
                <p className="font-medium mb-1">Import Options:</p>
                <ul className="text-xs space-y-1">
                  <li>• Select multiple projects to import to all of them</li>
                  <li>• Enable "Distribute evenly" to split emails across projects</li>
                  <li>• Duplicate emails will be automatically removed</li>
                  <li>• Users will be imported in batches for better performance</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              onClick={handleImport}
              disabled={emailList.length === 0 || isImporting || selectedProjects.length === 0}
              className="bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800"
            >
              {isImporting ? (
                <>
                  <Upload className="w-4 h-4 mr-2 animate-spin" />
                  Importing...
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4 mr-2" />
                  Import {emailList.length} Users
                </>
              )}
            </Button>
            <Button
              variant="outline"
              onClick={onClose}
              disabled={isImporting}
              className="border-gray-600 text-gray-300 hover:bg-gray-700"
            >
              Cancel
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
