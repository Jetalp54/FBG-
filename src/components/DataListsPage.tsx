import { useState, useEffect } from 'react';
import { useEnhancedApp } from '@/contexts/EnhancedAppContext';
import { Database, Upload, Filter, Trash2, Send } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

const API_BASE_URL = (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") ? "http://localhost:8000" : "/api";

interface DataList {
    id: string;
    name: string;
    isp: string;
    geo: string;
    status: string;
    email_count: number;
    created_at: string;
    uploaded_by: string;
}

export const DataListsPage = () => {
    const { projects, activeProfile } = useEnhancedApp();
    const { toast } = useToast();

    // State
    const [dataLists, setDataLists] = useState<DataList[]>([]);
    const [loading, setLoading] = useState(false);
    const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
    const [distributeDialogOpen, setDistributeDialogOpen] = useState(false);
    const [selectedList, setSelectedList] = useState<DataList | null>(null);

    // Upload form state
    const [uploadFile, setUploadFile] = useState<File | null>(null);
    const [listName, setListName] = useState('');
    const [listISP, setListISP] = useState('gmail');
    const [listGeo, setListGeo] = useState('US');
    const [listStatus, setListStatus] = useState('fresh');

    // Filters
    const [filterISP, setFilterISP] = useState('');
    const [filterGeo, setFilterGeo] = useState('');
    const [filterStatus, setFilterStatus] = useState('');

    // Distribution state
    const [selectedProjects, setSelectedProjects] = useState<string[]>([]);

    // Filter projects by active profile
    const activeProjects = projects.filter(p =>
        (!activeProfile || p.profileId === activeProfile) && p.status === 'active'
    );

    useEffect(() => {
        fetchDataLists();
    }, [filterISP, filterGeo, filterStatus]);

    const fetchDataLists = async () => {
        try {
            const params = new URLSearchParams();
            if (filterISP) params.append('isp', filterISP);
            if (filterGeo) params.append('geo', filterGeo);
            if (filterStatus) params.append('status', filterStatus);

            const response = await fetch(`${API_BASE_URL}/data-lists?${params}`);
            const data = await response.json();

            if (data.success) {
                setDataLists(data.data_lists);
            }
        } catch (error) {
            console.error('Failed to fetch data lists:', error);
        }
    };

    const handleUpload = async () => {
        if (!uploadFile || !listName) {
            toast({
                title: 'Missing Information',
                description: 'Please provide a file and list name',
                variant: 'destructive'
            });
            return;
        }

        setLoading(true);

        try {
            const text = await uploadFile.text();
            const emails = text.split(/[\n,]/).map(e => e.trim()).filter(e => e && e.includes('@'));

            const response = await fetch(`${API_BASE_URL}/data-lists`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: listName,
                    isp: listISP,
                    geo: listGeo,
                    status: listStatus,
                    emails
                })
            });

            const data = await response.json();

            if (data.success) {
                toast({
                    title: 'Success',
                    description: `Uploaded ${data.email_count} emails successfully`
                });

                // Reset form
                setUploadFile(null);
                setListName('');
                setListISP('gmail');
                setListGeo('US');
                setListStatus('fresh');
                setUploadDialogOpen(false);

                fetchDataLists();
            } else {
                throw new Error(data.error || 'Upload failed');
            }
        } catch (error: any) {
            toast({
                title: 'Upload Failed',
                description: error.message,
                variant: 'destructive'
            });
        } finally {
            setLoading(false);
        }
    };

    const handleDistribute = async () => {
        if (!selectedList || selectedProjects.length === 0) {
            toast({
                title: 'Missing Selection',
                description: 'Please select projects to distribute to',
                variant: 'destructive'
            });
            return;
        }

        setLoading(true);

        try {
            const response = await fetch(`${API_BASE_URL}/data-lists/${selectedList.id}/distribute`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    projectIds: selectedProjects
                })
            });

            const data = await response.json();

            if (data.success) {
                toast({
                    title: 'Distribution Complete',
                    description: `Imported ${data.total_imported} emails across ${data.projects_count} projects`
                });

                setDistributeDialogOpen(false);
                setSelectedProjects([]);
                setSelectedList(null);
            } else {
                throw new Error(data.error || 'Distribution failed');
            }
        } catch (error: any) {
            toast({
                title: 'Distribution Failed',
                description: error.message,
                variant: 'destructive'
            });
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (listId: string) => {
        if (!confirm('Are you sure you want to delete this list?')) return;

        try {
            const response = await fetch(`${API_BASE_URL}/data-lists/${listId}`, {
                method: 'DELETE'
            });

            const data = await response.json();

            if (data.success) {
                toast({
                    title: 'List Deleted',
                    description: 'Data list removed successfully'
                });
                fetchDataLists();
            }
        } catch (error) {
            toast({
                title: 'Delete Failed',
                description: 'Failed to delete list',
                variant: 'destructive'
            });
        }
    };

    const openDistributeDialog = (list: DataList) => {
        setSelectedList(list);
        setDistributeDialogOpen(true);
    };

    const handleProjectToggle = (projectId: string) => {
        setSelectedProjects(prev =>
            prev.includes(projectId)
                ? prev.filter(id => id !== projectId)
                : [...prev, projectId]
        );
    };

    return (
        <div className="p-8 space-y-8">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold text-white mb-2">Data Lists Manager</h1>
                    <p className="text-gray-400">
                        Upload, tag, and distribute email lists across Firebase projects
                    </p>
                </div>
                <Button onClick={() => setUploadDialogOpen(true)} className="bg-gradient-to-r from-blue-600 to-blue-700">
                    <Upload className="w-4 h-4 mr-2" />
                    Upload List
                </Button>
            </div>

            {/* Filters */}
            <Card className="bg-gray-800 border-gray-700">
                <CardHeader>
                    <CardTitle className="text-white flex items-center gap-2">
                        <Filter className="w-5 h-5" />
                        Filters
                    </CardTitle>
                </CardHeader>
                <CardContent className="flex gap-4">
                    <Select value={filterISP} onValueChange={setFilterISP}>
                        <SelectTrigger className="w-[180px] bg-gray-700 border-gray-600 text-white">
                            <SelectValue placeholder="All ISPs" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="">All ISPs</SelectItem>
                            <SelectItem value="gmail">Gmail</SelectItem>
                            <SelectItem value="outlook">Outlook</SelectItem>
                            <SelectItem value="yahoo">Yahoo</SelectItem>
                            <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                    </Select>

                    <Select value={filterGeo} onValueChange={setFilterGeo}>
                        <SelectTrigger className="w-[180px] bg-gray-700 border-gray-600 text-white">
                            <SelectValue placeholder="All Locations" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="">All Locations</SelectItem>
                            <SelectItem value="US">United States</SelectItem>
                            <SelectItem value="UK">United Kingdom</SelectItem>
                            <SelectItem value="CA">Canada</SelectItem>
                            <SelectItem value="AU">Australia</SelectItem>
                        </SelectContent>
                    </Select>

                    <Select value={filterStatus} onValueChange={setFilterStatus}>
                        <SelectTrigger className="w-[180px] bg-gray-700 border-gray-600 text-white">
                            <SelectValue placeholder="All Statuses" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="">All Statuses</SelectItem>
                            <SelectItem value="fresh">Fresh</SelectItem>
                            <SelectItem value="open">Open</SelectItem>
                            <SelectItem value="click">Click</SelectItem>
                            <SelectItem value="unsub">Unsubscribed</SelectItem>
                        </SelectContent>
                    </Select>
                </CardContent>
            </Card>

            {/* Data Lists Table */}
            <Card className="bg-gray-800 border-gray-700">
                <CardContent className="p-0">
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-gray-700">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase">Name</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase">ISP</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase">Geo</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase">Status</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase">Emails</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase">Date</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-700">
                                {dataLists.map((list) => (
                                    <tr key={list.id} className="hover:bg-gray-700/50">
                                        <td className="px-6 py-4 text-white font-medium">{list.name}</td>
                                        <td className="px-6 py-4">
                                            <span className="px-2 py-1 text-xs font-medium bg-blue-900/50 text-blue-300 rounded">
                                                {list.isp.toUpperCase()}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-gray-300">{list.geo}</td>
                                        <td className="px-6 py-4">
                                            <span className={`px-2 py-1 text-xs font-medium rounded ${list.status === 'fresh' ? 'bg-green-900/50 text-green-300' :
                                                    list.status === 'open' ? 'bg-yellow-900/50 text-yellow-300' :
                                                        list.status === 'click' ? 'bg-purple-900/50 text-purple-300' :
                                                            'bg-red-900/50 text-red-300'
                                                }`}>
                                                {list.status.toUpperCase()}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-gray-300">{list.email_count.toLocaleString()}</td>
                                        <td className="px-6 py-4 text-gray-400 text-sm">
                                            {new Date(list.created_at).toLocaleDateString()}
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex gap-2">
                                                <Button
                                                    size="sm"
                                                    onClick={() => openDistributeDialog(list)}
                                                    className="bg-green-700 hover:bg-green-800"
                                                >
                                                    <Send className="w-3 h-3 mr-1" />
                                                    Distribute
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    variant="destructive"
                                                    onClick={() => handleDelete(list.id)}
                                                >
                                                    <Trash2 className="w-3 h-3" />
                                                </Button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {dataLists.length === 0 && (
                        <div className="text-center py-12">
                            <Database className="w-12 h-12 text-gray-500 mx-auto mb-4" />
                            <h3 className="text-xl font-semibold text-white mb-2">No Data Lists</h3>
                            <p className="text-gray-400">Upload your first email list to get started</p>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Upload Dialog */}
            <Dialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen}>
                <DialogContent className="bg-gray-800 border-gray-700 text-white">
                    <DialogHeader>
                        <DialogTitle>Upload Data List</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div>
                            <Label>List Name</Label>
                            <Input
                                value={listName}
                                onChange={(e) => setListName(e.target.value)}
                                placeholder="US Gmail Fresh - Jan 2026"
                                className="bg-gray-700 border-gray-600"
                            />
                        </div>
                        <div>
                            <Label>Email File (CSV or TXT)</Label>
                            <Input
                                type="file"
                                accept=".csv,.txt"
                                onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                                className="bg-gray-700 border-gray-600"
                            />
                            {uploadFile && (
                                <p className="text-sm text-green-400 mt-1">✓ {uploadFile.name}</p>
                            )}
                        </div>
                        <div className="grid grid-cols-3 gap-4">
                            <div>
                                <Label>ISP</Label>
                                <Select value={listISP} onValueChange={setListISP}>
                                    <SelectTrigger className="bg-gray-700 border-gray-600">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="gmail">Gmail</SelectItem>
                                        <SelectItem value="outlook">Outlook</SelectItem>
                                        <SelectItem value="yahoo">Yahoo</SelectItem>
                                        <SelectItem value="other">Other</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div>
                                <Label>Geo</Label>
                                <Input
                                    value={listGeo}
                                    onChange={(e) => setListGeo(e.target.value)}
                                    placeholder="US"
                                    className="bg-gray-700 border-gray-600"
                                />
                            </div>
                            <div>
                                <Label>Status</Label>
                                <Select value={listStatus} onValueChange={setListStatus}>
                                    <SelectTrigger className="bg-gray-700 border-gray-600">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="fresh">Fresh</SelectItem>
                                        <SelectItem value="open">Open</SelectItem>
                                        <SelectItem value="click">Click</SelectItem>
                                        <SelectItem value="unsub">Unsubscribed</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setUploadDialogOpen(false)}>
                            Cancel
                        </Button>
                        <Button onClick={handleUpload} disabled={loading}>
                            {loading ? 'Uploading...' : 'Upload'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Distribute Dialog */}
            <Dialog open={distributeDialogOpen} onOpenChange={setDistributeDialogOpen}>
                <DialogContent className="bg-gray-800 border-gray-700 text-white max-w-3xl">
                    <DialogHeader>
                        <DialogTitle>Distribute: {selectedList?.name}</DialogTitle>
                        <p className="text-gray-400 text-sm">
                            {selectedList?.email_count.toLocaleString()} emails will be split equally across selected projects
                        </p>
                    </DialogHeader>
                    <div className="space-y-4 max-h-96 overflow-y-auto">
                        <div className="grid grid-cols-2 gap-3">
                            {activeProjects.map((project) => (
                                <div
                                    key={project.id}
                                    className="flex items-center gap-2 p-3 bg-gray-700 rounded-lg cursor-pointer hover:bg-gray-600"
                                    onClick={() => handleProjectToggle(project.id)}
                                >
                                    <Checkbox
                                        checked={selectedProjects.includes(project.id)}
                                        onCheckedChange={() => handleProjectToggle(project.id)}
                                    />
                                    <div>
                                        <span className="text-white text-sm font-medium">{project.name}</span>
                                        {selectedList && selectedProjects.includes(project.id) && (
                                            <p className="text-xs text-gray-400">
                                                ~{Math.floor(selectedList.email_count / selectedProjects.length).toLocaleString()} emails
                                            </p>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDistributeDialogOpen(false)}>
                            Cancel
                        </Button>
                        <Button onClick={handleDistribute} disabled={loading || selectedProjects.length === 0}>
                            {loading ? 'Distributing...' : `Distribute to ${selectedProjects.length} Project(s)`}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
};
