import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Globe, CheckCircle, Clock, XCircle, Mail, Trash2, RefreshCw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useEnhancedApp } from '@/contexts/EnhancedAppContext';

const API_BASE_URL = (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") ? "http://localhost:8000" : "/api";

export const CloudflareDomainManager = () => {
    const { projects, profiles, activeProfile } = useEnhancedApp();
    const { toast } = useToast();

    // Authentication
    const [adminUser] = useState(localStorage.getItem('admin-basic-user') || 'admin');
    const [adminPass] = useState(localStorage.getItem('admin-basic-pass') || 'admin');
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': 'Basic ' + btoa(`${adminUser}:${adminPass}`),
    };

    // Form state
    const [domain, setDomain] = useState('');
    const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
    const [setupEmailDNS, setSetupEmailDNS] = useState(true);
    const [emailProvider, setEmailProvider] = useState('google');
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Verification state
    const [verificationId, setVerificationId] = useState<string | null>(null);
    const [verificationStatus, setVerificationStatus] = useState<any>(null);
    const [isPolling, setIsPolling] = useState(false);

    // Verified domains
    const [verifiedDomains, setVerifiedDomains] = useState<any[]>([]);

    // Results state
    const [bulkResults, setBulkResults] = useState<any>(null);

    // Filter projects by active profile
    const activeProjects = projects.filter(p =>
        (!activeProfile || p.profileId === activeProfile) && p.status === 'active'
    );

    const activeProfileName = profiles.find(p => p.id === activeProfile)?.name || 'All Projects';

    // Load verified domains on mount
    useEffect(() => {
        loadVerifiedDomains();
    }, []);

    // Poll for verification status
    useEffect(() => {
        let intervalId: NodeJS.Timeout;

        if (verificationId && isPolling) {
            intervalId = setInterval(async () => {
                await checkVerificationStatus(verificationId);
            }, 10000); // Check every 10 seconds
        }

        return () => {
            if (intervalId) clearInterval(intervalId);
        };
    }, [verificationId, isPolling]);

    const loadVerifiedDomains = async () => {
        try {
            const response = await fetch(`${API_BASE_URL}/cloudflare/verified-domains`, { headers });
            const data = await response.json();

            if (data.success) {
                setVerifiedDomains(data.verified_domains || []);
            }
        } catch (error) {
            console.error('Failed to load verified domains:', error);
        }
    };

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

    const initiateDomainVerification = async () => {
        if (!domain.trim()) {
            toast({
                title: 'Domain Required',
                description: 'Please enter a custom domain to verify.',
                variant: 'destructive',
            });
            return;
        }

        if (selectedProjects.length === 0) {
            toast({
                title: 'Projects Required',
                description: 'Please select at least one project for this domain.',
                variant: 'destructive',
            });
            return;
        }

        // Validate domain format
        const domainRegex = /^[a-z0-9]+([\-\.]{1}[a-z0-9]+)*\.[a-z]{2,}$/i;
        if (!domainRegex.test(domain)) {
            toast({
                title: 'Invalid Domain',
                description: 'Please enter a valid domain name (e.g., app.example.com).',
                variant: 'destructive',
            });
            return;
        }

        setIsSubmitting(true);
        setBulkResults(null); // Clear previous results

        try {
            const response = await fetch(`${API_BASE_URL}/cloudflare/initiate-verification`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    domain: domain.trim(),
                    project_ids: selectedProjects,
                    setup_email_dns: setupEmailDNS,
                    email_provider: emailProvider,
                }),
            });

            const data = await response.json();

            if (response.ok && data.success) {
                setVerificationId(data.verification_id);
                setVerificationStatus(data);
                setIsPolling(true);

                toast({
                    title: 'Verification Started! 🚀',
                    description: data.message || 'DNS record created. Verifying...',
                });

                // Start checking status immediately
                setTimeout(() => checkVerificationStatus(data.verification_id), 5000);
            } else {
                throw new Error(data.detail || 'Verification failed');
            }
        } catch (error) {
            console.error('Verification error:', error);
            toast({
                title: 'Verification Failed',
                description: error instanceof Error ? error.message : 'Failed to initiate verification',
                variant: 'destructive',
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    const checkVerificationStatus = async (vid: string) => {
        try {
            const response = await fetch(`${API_BASE_URL}/cloudflare/verification-status/${vid}`, { headers });
            const data = await response.json();

            setVerificationStatus(data);

            if (data.status === 'verified') {
                setIsPolling(false);
                setBulkResults(data); // Store final detailed results

                toast({
                    title: 'Domain Verified! ✅',
                    description: `${data.domain} is now configured for ${data.project_ids.length} project(s).`,
                });

                // Reload verified domains
                await loadVerifiedDomains();

                // Clear form but keep domain in status display
                setDomain('');
                setSelectedProjects([]);
                // setVerificationId(null); // Keep ID to show status
            } else if (data.status === 'error' || data.status === 'timeout') {
                setIsPolling(false);
                setBulkResults(data);

                toast({
                    title: 'Verification Ended',
                    description: data.message || 'Verification encountered an error or timed out',
                    variant: 'destructive',
                });
            }
        } catch (error) {
            console.error('Failed to check verification status:', error);
        }
    };

    const deleteDomain = async (verificationId: string) => {
        try {
            const response = await fetch(`${API_BASE_URL}/cloudflare/verification/${verificationId}`, {
                method: 'DELETE',
                headers,
            });

            if (response.ok) {
                toast({
                    title: 'Domain Removed',
                    description: 'Verification record deleted.',
                });
                await loadVerifiedDomains();
            }
        } catch (error) {
            toast({
                title: 'Failed to Delete',
                description: 'Could not remove domain verification.',
                variant: 'destructive',
            });
        }
    };

    return (
        <div className="p-8 space-y-8">
            <div>
                <h1 className="text-3xl font-bold text-white mb-2">Cloudflare Domain Manager</h1>
                <p className="text-gray-400">
                    Profile: <span className="text-blue-400 font-medium">{activeProfileName}</span> •
                    Manage domain verification and DNS records
                </p>
            </div>

            {/* Verification Results Log (Notification Feature) */}
            {bulkResults && (
                <Card className="bg-gray-800 border-blue-500/30 overflow-hidden animate-in fade-in duration-500">
                    <CardHeader className="bg-blue-500/10 border-b border-blue-500/20 py-3">
                        <CardTitle className="text-blue-400 text-sm flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <RefreshCw className={`w-4 h-4 ${isPolling ? 'animate-spin' : ''}`} />
                                Bulk Process Results: {bulkResults.domain}
                            </div>
                            <Button variant="ghost" size="sm" onClick={() => setBulkResults(null)} className="h-6 w-6 p-0 text-gray-400 hover:text-white">
                                ✕
                            </Button>
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                        <div className="max-h-60 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-700">
                            <table className="w-full text-sm text-left">
                                <thead className="bg-gray-900/50 text-gray-400 sticky top-0">
                                    <tr>
                                        <th className="px-4 py-2 font-medium">Project ID</th>
                                        <th className="px-4 py-2 font-medium">Status</th>
                                        <th className="px-4 py-2 font-medium">Message</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-700">
                                    {bulkResults.project_ids?.map((pid: string) => {
                                        const update = bulkResults.firebase_update?.[pid];
                                        return (
                                            <tr key={pid} className="hover:bg-gray-700/50 transition">
                                                <td className="px-4 py-2 text-white font-mono text-xs">{pid}</td>
                                                <td className="px-4 py-2">
                                                    {bulkResults.status === 'verified' && (!update || update.success) ? (
                                                        <span className="text-green-400 flex items-center gap-1">
                                                            <CheckCircle className="w-3 h-3" /> Success
                                                        </span>
                                                    ) : (
                                                        <span className="text-yellow-400 flex items-center gap-1">
                                                            <Clock className="w-3 h-3" /> {bulkResults.status}
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-2 text-gray-400 text-xs">
                                                    {update?.error || update?.message || bulkResults.message || 'Processing...'}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Add New Domain */}
            <Card className="bg-gradient-to-r from-purple-900/50 to-blue-900/50 border-purple-500/50">
                <CardHeader>
                    <CardTitle className="text-white flex items-center gap-2">
                        <Globe className="w-5 h-5 text-purple-500" />
                        Add Custom Domain
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <Label htmlFor="domain" className="text-gray-300">Custom Domain</Label>
                            <Input
                                id="domain"
                                type="text"
                                value={domain}
                                onChange={(e) => setDomain(e.target.value)}
                                placeholder="app.example.com"
                                className="bg-gray-700 border-gray-600 text-white"
                                disabled={isPolling}
                            />
                            <p className="text-xs text-gray-400 mt-1">
                                Your full custom domain (e.g., auth.yourdomain.com)
                            </p>
                        </div>

                        <div>
                            <Label className="text-gray-300">Select Projects</Label>
                            <div className="flex gap-2 mb-2">
                                <Button
                                    size="sm"
                                    onClick={handleSelectAll}
                                    disabled={selectedProjects.length === activeProjects.length || isPolling}
                                >
                                    Select All
                                </Button>
                                <Button
                                    size="sm"
                                    onClick={handleDeselectAll}
                                    disabled={selectedProjects.length === 0 || isPolling}
                                >
                                    Deselect All
                                </Button>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-40 overflow-y-auto border border-gray-600 rounded-lg p-2">
                                {activeProjects.map((project) => (
                                    <div key={project.id} className="flex items-center gap-2">
                                        <Checkbox
                                            id={`p-${project.id}`}
                                            checked={selectedProjects.includes(project.id)}
                                            onCheckedChange={() => handleProjectToggle(project.id)}
                                            className="border-gray-500"
                                            disabled={isPolling}
                                        />
                                        <Label htmlFor={`p-${project.id}`} className="text-white text-sm cursor-pointer truncate">
                                            {project.name}
                                        </Label>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center space-x-4">
                        <div className="flex items-center space-x-2">
                            <Checkbox
                                id="setupEmailDNS"
                                checked={setupEmailDNS}
                                onCheckedChange={(checked) => setSetupEmailDNS(!!checked)}
                                disabled={isPolling}
                            />
                            <Label htmlFor="setupEmailDNS" className="text-gray-300 flex items-center gap-2">
                                <Mail className="w-4 h-4" />
                                Setup Email DNS (SPF, DKIM, DMARC)
                            </Label>
                        </div>

                        {setupEmailDNS && (
                            <div className="flex items-center gap-2">
                                <Label className="text-gray-300">Provider:</Label>
                                <Select value={emailProvider} onValueChange={setEmailProvider} disabled={isPolling}>
                                    <SelectTrigger className="bg-gray-700 border-gray-600 text-white w-32">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent className="bg-gray-700 border-gray-600">
                                        <SelectItem value="google" className="text-white hover:bg-gray-600">Google</SelectItem>
                                        <SelectItem value="outlook" className="text-white hover:bg-gray-600">Outlook</SelectItem>
                                        <SelectItem value="zoho" className="text-white hover:bg-gray-600">Zoho Mail</SelectItem>
                                        <SelectItem value="custom" className="text-white hover:bg-gray-600">Custom</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        )}
                    </div>

                    <Button
                        onClick={initiateDomainVerification}
                        disabled={isSubmitting || isPolling || !domain || selectedProjects.length === 0}
                        className="bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800"
                    >
                        {isSubmitting || isPolling ? (
                            <>
                                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                                {isPolling ? 'Verifying Records...' : 'Starting...'}
                            </>
                        ) : (
                            <>
                                <CheckCircle className="w-4 h-4 mr-2" />
                                Verify Domain Across {selectedProjects.length} Projects
                            </>
                        )}
                    </Button>

                    {/* Verification Status */}
                    {verificationStatus && (
                        <div className="bg-gray-700 p-4 rounded-lg mt-4 animate-in slide-in-from-top-2 duration-300">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-white font-medium text-sm">Action Status</span>
                                {verificationStatus.status === 'pending' && (
                                    <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/50">
                                        <Clock className="w-3 h-3 mr-1" />
                                        Pending Propogation
                                    </Badge>
                                )}
                                {verificationStatus.status === 'verified' && (
                                    <Badge className="bg-green-500/20 text-green-400 border-green-500/50">
                                        <CheckCircle className="w-3 h-3 mr-1" />
                                        Complete
                                    </Badge>
                                )}
                                {(verificationStatus.status === 'error' || verificationStatus.status === 'timeout') && (
                                    <Badge className="bg-red-500/20 text-red-400 border-red-500/50">
                                        <XCircle className="w-3 h-3 mr-1" />
                                        Ended
                                    </Badge>
                                )}
                            </div>
                            <div className="text-gray-300 text-xs space-y-1 bg-black/20 p-2 rounded">
                                <p><strong>App Domain:</strong> {verificationStatus.domain}</p>
                                <p><strong>Status Message:</strong> {verificationStatus.message}</p>
                                {verificationStatus.attempts !== undefined && (
                                    <div className="mt-2">
                                        <div className="flex justify-between text-[10px] text-gray-400 mb-1">
                                            <span>Propagation Check</span>
                                            <span>{verificationStatus.attempts} / 100</span>
                                        </div>
                                        <div className="w-full bg-gray-600 h-1.5 rounded-full overflow-hidden">
                                            <div
                                                className="bg-purple-500 h-full transition-all duration-500"
                                                style={{ width: `${(verificationStatus.attempts / 100) * 100}%` }}
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Verified Domains List */}
            <Card className="bg-gray-800 border-gray-700">
                <CardHeader>
                    <CardTitle className="text-white flex items-center gap-2">
                        <CheckCircle className="w-5 h-5 text-green-500" />
                        Active Managed Domains ({verifiedDomains.length})
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {verifiedDomains.length === 0 ? (
                        <div className="text-center py-12 border-2 border-dashed border-gray-700 rounded-xl">
                            < Globe className="w-12 h-12 text-gray-600 mx-auto mb-3" />
                            <p className="text-gray-400">No active managed domains found.</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {verifiedDomains.map((domain) => (
                                <div
                                    key={domain.verification_id}
                                    className="flex items-center justify-between p-4 bg-gray-700/50 rounded-lg border border-gray-700 hover:border-gray-600 transition group"
                                >
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2">
                                            <Globe className="w-4 h-4 text-blue-400" />
                                            <span className="text-white font-medium">{domain.domain}</span>
                                            <Badge className="bg-blue-500/10 text-blue-400 text-[10px] border-blue-500/20">
                                                {domain.project_ids.length} Projects
                                            </Badge>
                                        </div>
                                        <div className="text-[10px] text-gray-500 mt-1 flex gap-2">
                                            <span>ID: {domain.verification_id}</span>
                                            <span>•</span>
                                            <span>Added: {new Date(domain.verified_at).toLocaleDateString()}</span>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            onClick={() => {
                                                setVerificationId(domain.verification_id);
                                                checkVerificationStatus(domain.verification_id);
                                            }}
                                            className="text-gray-400 hover:text-white"
                                        >
                                            <RefreshCw className="w-4 h-4" />
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            onClick={() => deleteDomain(domain.verification_id)}
                                            className="text-gray-500 hover:text-red-400 hover:bg-red-500/10"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
};
