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

                toast({
                    title: 'Domain Verified! ✅',
                    description: `${data.domain} is now configured for ${data.project_ids.length} project(s).`,
                });

                // Reload verified domains
                await loadVerifiedDomains();

                // Clear form
                setDomain('');
                setSelectedProjects([]);
                setVerificationId(null);
            } else if (data.status === 'error' || data.status === 'timeout') {
                setIsPolling(false);

                toast({
                    title: 'Verification Failed',
                    description: data.message || 'Verification encountered an error',
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
                <h1 className="text-3xl font-bold text-white mb-2">Cloudflare Domain Verification</h1>
                <p className="text-gray-400">
                    Profile: <span className="text-blue-400 font-medium">{activeProfileName}</span> •
                    Automatically verify and configure custom domains via Cloudflare
                </p>
            </div>

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
                                            checked={selectedProjects.includes(project.id)}
                                            onCheckedChange={() => handleProjectToggle(project.id)}
                                            className="border-gray-500"
                                            disabled={isPolling}
                                        />
                                        <Label className="text-white text-sm cursor-pointer">
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
                                        <SelectItem value="outlook" className="text-white hover:bg-gray-600">Outlook (Microsoft 365)</SelectItem>
                                        <SelectItem value="zoho" className="text-white hover:bg-gray-600">Zoho Mail</SelectItem>
                                        <SelectItem value="custom" className="text-white hover:bg-gray-600">Custom / Other</SelectItem>
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
                        {isSubmitting ? (
                            <>
                                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                                Starting Verification...
                            </>
                        ) : (
                            <>
                                <CheckCircle className="w-4 h-4 mr-2" />
                                Verify Domain
                            </>
                        )}
                    </Button>

                    {/* Verification Status */}
                    {verificationStatus && (
                        <div className="bg-gray-700 p-4 rounded-lg mt-4">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-white font-medium">Verification Status</span>
                                {verificationStatus.status === 'pending' && (
                                    <Badge className="bg-yellow-500/20 text-yellow-400">
                                        <Clock className="w-3 h-3 mr-1" />
                                        Pending
                                    </Badge>
                                )}
                                {verificationStatus.status === 'verified' && (
                                    <Badge className="bg-green-500/20 text-green-400">
                                        <CheckCircle className="w-3 h-3 mr-1" />
                                        Verified
                                    </Badge>
                                )}
                                {(verificationStatus.status === 'error' || verificationStatus.status === 'timeout') && (
                                    <Badge className="bg-red-500/20 text-red-400">
                                        <XCircle className="w-3 h-3 mr-1" />
                                        Failed
                                    </Badge>
                                )}
                            </div>
                            <div className="text-gray-300 text-sm space-y-1">
                                <p><strong>Domain:</strong> {verificationStatus.domain}</p>
                                <p><strong>Message:</strong> {verificationStatus.message}</p>
                                {verificationStatus.verification_domain && (
                                    <p><strong>Verification Record:</strong> {verificationStatus.verification_domain}</p>
                                )}
                                {verificationStatus.attempts !== undefined && (
                                    <p><strong>Attempts:</strong> {verificationStatus.attempts}/{verificationStatus.max_attempts}</p>
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
                        Verified Domains ({verifiedDomains.length})
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {verifiedDomains.length === 0 ? (
                        <p className="text-gray-400 text-center py-8">No verified domains yet. Add one above!</p>
                    ) : (
                        <div className="space-y-2">
                            {verifiedDomains.map((domain) => (
                                <div
                                    key={domain.verification_id}
                                    className="flex items-center justify-between p-4 bg-gray-700 rounded-lg hover:bg-gray-650 transition"
                                >
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2">
                                            <Globe className="w-4 h-4 text-blue-400" />
                                            <span className="text-white font-medium">{domain.domain}</span>
                                            {domain.email_dns_configured && (
                                                <Badge className="bg-blue-500/20 text-blue-400 text-xs">
                                                    <Mail className="w-3 h-3 mr-1" />
                                                    Email DNS
                                                </Badge>
                                            )}
                                        </div>
                                        <div className="text-sm text-gray-400 mt-1">
                                            {domain.project_ids.length} project(s) • Verified: {new Date(domain.verified_at).toLocaleString()}
                                        </div>
                                    </div>
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => deleteDomain(domain.verification_id)}
                                        className="text-red-400 hover:text-red-300 hover:bg-red-500/20"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </Button>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
};
