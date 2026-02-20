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
    const [domainsInput, setDomainsInput] = useState('');
    const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
    const [setupEmailDNS, setSetupEmailDNS] = useState(true);
    const [emailProvider, setEmailProvider] = useState('google');
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Verification state mapping: domain -> status object
    const [activeVerifications, setActiveVerifications] = useState<Record<string, any>>({});
    const [isPolling, setIsPolling] = useState(false);

    // Verified domains
    const [verifiedDomains, setVerifiedDomains] = useState<any[]>([]);

    // Results state (historical logs of recent bulk operations)
    const [bulkResults, setBulkResults] = useState<any[]>([]);

    // Filter projects by active profile
    const activeProjects = projects.filter(p =>
        (!activeProfile || p.profileId === activeProfile) && p.status === 'active'
    );

    const activeProfileName = profiles.find(p => p.id === activeProfile)?.name || 'All Projects';

    // Load verified domains on mount
    useEffect(() => {
        loadVerifiedDomains();
    }, []);

    // Poll for verification statuses
    useEffect(() => {
        let intervalId: NodeJS.Timeout;

        if (isPolling) {
            intervalId = setInterval(async () => {
                const pendingIds = Object.values(activeVerifications)
                    .filter(v => v.status === 'pending')
                    .map(v => v.verification_id);

                if (pendingIds.length === 0) {
                    setIsPolling(false);
                    return;
                }

                await Promise.all(pendingIds.map(id => checkVerificationStatus(id)));
            }, 10000); // Check every 10 seconds
        }

        return () => {
            if (intervalId) clearInterval(intervalId);
        };
    }, [activeVerifications, isPolling]);

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
        const domains = domainsInput.split('\n').map(d => d.trim().toLowerCase()).filter(d => d);

        if (domains.length === 0) {
            toast({
                title: 'Domains Required',
                description: 'Please enter at least one custom domain.',
                variant: 'destructive',
            });
            return;
        }

        if (selectedProjects.length === 0) {
            toast({
                title: 'Projects Required',
                description: 'Please select at least one project.',
                variant: 'destructive',
            });
            return;
        }

        // Validate domain format
        const domainRegex = /^[a-z0-9]+([\-\.]{1}[a-z0-9]+)*\.[a-z]{2,}$/i;
        const invalidDomains = domains.filter(d => !domainRegex.test(d));
        if (invalidDomains.length > 0) {
            toast({
                title: 'Invalid Domains',
                description: `Invalid formats found: ${invalidDomains.join(', ')}`,
                variant: 'destructive',
            });
            return;
        }

        setIsSubmitting(true);
        // Do not clear bulkResults completely, just start a new session
        const newVerifications: Record<string, any> = { ...activeVerifications };

        try {
            toast({
                title: `Starting Bulk Verification 🚀`,
                description: `Initiating for ${domains.length} domain(s).`,
            });

            // Process sequentially or fast parallel to avoid backend rate limits
            for (const d of domains) {
                try {
                    const response = await fetch(`${API_BASE_URL}/cloudflare/initiate-verification`, {
                        method: 'POST',
                        headers,
                        body: JSON.stringify({
                            domain: d,
                            project_ids: selectedProjects,
                            setup_email_dns: setupEmailDNS,
                            email_provider: emailProvider,
                        }),
                    });

                    const data = await response.json();

                    if (response.ok && data.success) {
                        newVerifications[d] = {
                            ...data,
                            attempts: 0,
                            domain: d,
                            status: 'pending'
                        };

                        // Kick off immediate first check
                        setTimeout(() => checkVerificationStatus(data.verification_id, d), 5000);
                    } else {
                        throw new Error(data.detail || 'Verification failed');
                    }
                } catch (err: any) {
                    newVerifications[d] = {
                        domain: d,
                        status: 'error',
                        message: err.message || 'Failed to initiate',
                        verification_id: `err-${Date.now()}-${d}`
                    };

                    // Log failed initiations to bulk results
                    setBulkResults(prev => [{
                        domain: d,
                        status: 'error',
                        message: err.message,
                        project_ids: selectedProjects
                    }, ...prev].slice(0, 50));
                }
            }

            setActiveVerifications(newVerifications);
            setIsPolling(true);
            setDomainsInput(''); // Clear input after successful submission

        } catch (error) {
            console.error('Verification error:', error);
            toast({
                title: 'Bulk Processing Failed',
                description: error instanceof Error ? error.message : 'Fatal error during initiation.',
                variant: 'destructive',
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    const checkVerificationStatus = async (vid: string, knownDomain?: string) => {
        try {
            const response = await fetch(`${API_BASE_URL}/cloudflare/verification-status/${vid}`, { headers });
            const data = await response.json();
            const dName = knownDomain || data.domain;

            setActiveVerifications(prev => ({
                ...prev,
                [dName]: data
            }));

            if (data.status === 'verified') {
                setBulkResults(prev => [data, ...prev].slice(0, 50)); // Keep last 50 historical logs

                toast({
                    title: `Verified: ${dName} ✅`,
                    description: `Configured for ${data.project_ids?.length || 0} project(s).`,
                });

                await loadVerifiedDomains();
            } else if (data.status === 'error' || data.status === 'timeout') {
                setBulkResults(prev => [data, ...prev].slice(0, 50));

                toast({
                    title: `Failed: ${dName}`,
                    description: data.message || 'Verification timed out.',
                    variant: 'destructive',
                });
            }
        } catch (error) {
            console.error(`Failed to check verification status for ${vid}:`, error);
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
            {bulkResults.length > 0 && (
                <Card className="bg-gray-800 border-blue-500/30 overflow-hidden animate-in fade-in duration-500">
                    <CardHeader className="bg-blue-500/10 border-b border-blue-500/20 py-3">
                        <CardTitle className="text-blue-400 text-sm flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Clock className={`w-4 h-4`} />
                                Recent Bulk Results ({bulkResults.length})
                            </div>
                            <Button variant="ghost" size="sm" onClick={() => setBulkResults([])} className="h-6 w-6 p-0 text-gray-400 hover:text-white">
                                ✕
                            </Button>
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                        <div className="max-h-60 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-700">
                            <table className="w-full text-sm text-left">
                                <thead className="bg-gray-900/50 text-gray-400 sticky top-0">
                                    <tr>
                                        <th className="px-4 py-2 font-medium">Domain</th>
                                        <th className="px-4 py-2 font-medium">Projects</th>
                                        <th className="px-4 py-2 font-medium">Status</th>
                                        <th className="px-4 py-2 font-medium">Message</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-700">
                                    {bulkResults.map((result: any, idx) => (
                                        <tr key={idx} className="hover:bg-gray-700/50 transition">
                                            <td className="px-4 py-2 text-white font-mono text-xs">{result.domain}</td>
                                            <td className="px-4 py-2 text-gray-400 text-xs">{result.project_ids?.length || 0}</td>
                                            <td className="px-4 py-2">
                                                {result.status === 'verified' ? (
                                                    <span className="text-green-400 flex items-center gap-1">
                                                        <CheckCircle className="w-3 h-3" /> Success
                                                    </span>
                                                ) : (
                                                    <span className="text-yellow-400 flex items-center gap-1">
                                                        <XCircle className="w-3 h-3" /> Failed
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-4 py-2 text-gray-400 text-xs">
                                                {result.message || 'Completed'}
                                            </td>
                                        </tr>
                                    ))}
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
                            <Label htmlFor="domains" className="text-gray-300">Custom Domains (One per line)</Label>
                            <textarea
                                id="domains"
                                rows={6}
                                value={domainsInput}
                                onChange={(e) => setDomainsInput(e.target.value)}
                                placeholder="app1.example.com&#10;app2.example.com&#10;app3.example.com"
                                className="w-full mt-1 bg-gray-700 border border-gray-600 rounded-md p-2 text-white text-sm font-mono focus:ring-1 focus:ring-purple-500 outline-none"
                                disabled={isPolling && domainsInput.length === 0}
                            />
                            <p className="text-xs text-gray-400 mt-1">
                                Enter up to 50 domains (newline separated). Will be applied to all selected projects.
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
                        disabled={isSubmitting || !domainsInput.trim() || selectedProjects.length === 0}
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

                    {/* Verification Statuses */}
                    {Object.values(activeVerifications).length > 0 && (
                        <div className="space-y-3 mt-4">
                            <h3 className="text-sm font-semibold text-gray-300">Active Verifications</h3>
                            {Object.values(activeVerifications).map((status: any, idx: number) => (
                                <div key={idx} className="bg-gray-700 p-3 rounded-lg animate-in slide-in-from-top-2 duration-300 border border-gray-600">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-white font-medium text-sm flex items-center gap-2">
                                            <Globe className="w-4 h-4 text-purple-400" />
                                            {status.domain}
                                        </span>
                                        {status.status === 'pending' && (
                                            <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/50">
                                                <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
                                                Pending Propogation
                                            </Badge>
                                        )}
                                        {status.status === 'verified' && (
                                            <Badge className="bg-green-500/20 text-green-400 border-green-500/50">
                                                <CheckCircle className="w-3 h-3 mr-1" />
                                                Complete
                                            </Badge>
                                        )}
                                        {(status.status === 'error' || status.status === 'timeout') && (
                                            <Badge className="bg-red-500/20 text-red-400 border-red-500/50">
                                                <XCircle className="w-3 h-3 mr-1" />
                                                Ended
                                            </Badge>
                                        )}
                                    </div>
                                    <div className="text-gray-300 text-xs space-y-1 bg-black/20 p-2 rounded">
                                        <p><strong>Status:</strong> {status.message || 'Processing'}</p>
                                        {status.attempts !== undefined && status.status === 'pending' && (
                                            <div className="mt-2">
                                                <div className="flex justify-between text-[10px] text-gray-400 mb-1">
                                                    <span>API Polling</span>
                                                    <span>{status.attempts} / 100</span>
                                                </div>
                                                <div className="w-full bg-gray-600 h-1.5 rounded-full overflow-hidden">
                                                    <div
                                                        className="bg-purple-500 h-full transition-all duration-500"
                                                        style={{ width: `${(status.attempts / 100) * 100}%` }}
                                                    />
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
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
                                                checkVerificationStatus(domain.verification_id, domain.domain);
                                                toast({ description: `Refreshing status for ${domain.domain}...` });
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
