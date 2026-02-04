import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface AuditLog {
  timestamp: string;
  user: string;
  action: string;
  details: any;
}

const API_BASE_URL = (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") ? "http://localhost:8000" : "/api";

export const AuditLogsPage = () => {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('all');

  useEffect(() => {
    const fetchLogs = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/audit-logs`);
        if (response.ok) {
          const data = await response.json();
          setLogs(data.logs || []);
        } else {
          console.error('Failed to fetch audit logs:', response.statusText);
        }
      } catch (error) {
        console.error('Error fetching audit logs:', error);
      }
    };
    fetchLogs();
  }, []);

  const filteredLogs = logs.filter(log => {
    const matchesSearch =
      log.user.toLowerCase().includes(search.toLowerCase()) ||
      log.action.toLowerCase().includes(search.toLowerCase()) ||
      JSON.stringify(log.details).toLowerCase().includes(search.toLowerCase());
    const matchesAction = actionFilter === 'all' || log.action === actionFilter;
    return matchesSearch && matchesAction;
  });

  return (
    <div className="p-8 space-y-8">
      <Card className="bg-gray-800 border-gray-700">
        <CardHeader>
          <CardTitle className="text-white">Audit Logs</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col md:flex-row gap-4 mb-4">
            <Input
              placeholder="Search logs..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="bg-gray-700 border-gray-600 text-white w-full md:w-1/2"
            />
            <select
              value={actionFilter}
              onChange={e => setActionFilter(e.target.value)}
              className="bg-gray-700 border-gray-600 text-white w-full md:w-1/4 rounded px-2 py-1"
            >
              <option value="all">All Actions</option>
              <option value="update_template">Update Template</option>
              <option value="send_campaign">Send Campaign</option>
              <option value="delete_campaign">Delete Campaign</option>
              <option value="delete_project">Delete Project</option>
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm text-left text-gray-400">
              <thead>
                <tr>
                  <th className="px-4 py-2">Timestamp</th>
                  <th className="px-4 py-2">User</th>
                  <th className="px-4 py-2">Action</th>
                  <th className="px-4 py-2">Details</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.map((log, idx) => (
                  <tr key={idx} className="border-b border-gray-700">
                    <td className="px-4 py-2 whitespace-nowrap">{new Date(log.timestamp).toLocaleString()}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{log.user}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{log.action}</td>
                    <td className="px-4 py-2">
                      <pre className="whitespace-pre-wrap break-all text-xs">{JSON.stringify(log.details, null, 2)}</pre>
                    </td>
                  </tr>
                ))}
                {filteredLogs.length === 0 && (
                  <tr>
                    <td colSpan={4} className="text-center py-8 text-gray-500">No logs found.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}; 