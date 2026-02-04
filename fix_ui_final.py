import os

app_path = r"c:/Users/PC/Desktop/Firebase/FBG--main/src/components/AppManagement.tsx"
cf_path = r"c:/Users/PC/Desktop/Firebase/FBG--main/src/components/CloudflareDomainManager.tsx"

# 1. Clean AppManagement.tsx by removing duplicate CloudflareSettings
try:
    with open(app_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    
    # Find the first occurrence of CloudflareSettings definition
    cut_index = -1
    for i, line in enumerate(lines):
        if "const CloudflareSettings =" in line:
            cut_index = i
            print(f"Found CloudflareSettings at line {i + 1}")
            break
            
    if cut_index != -1:
        print(f"Truncating AppManagement.tsx at line {cut_index + 1}")
        cleaned_content = "".join(lines[:cut_index])
    else:
        print("Could not find CloudflareSettings, keeping original content")
        cleaned_content = "".join(lines)

    # Define the clean CloudflareSettings component
    new_component = r'''
const CloudflareSettings = () => {
  const { toast } = useToast();
  const [adminUser] = useState(localStorage.getItem('admin-basic-user') || 'admin');
  const [adminPass] = useState(localStorage.getItem('admin-basic-pass') || 'admin');
  const headers = useMemo(() => ({
    'Content-Type': 'application/json',
    'Authorization': 'Basic ' + btoa(`${adminUser}:${adminPass}`),
  }), [adminUser, adminPass]);

  const [apiToken, setApiToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  
  // Debug State
  const [debugInfo, setDebugInfo] = useState<any>(null);
  const [showDebug, setShowDebug] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/cloudflare/config`, { headers });
      if (res.ok) {
        const data = await res.json();
        setApiToken(data.api_token || '');
        setSaved(!!data.api_token);
      }
    } catch (e) {
      console.log('Failed to load Cloudflare config:', e);
    } finally {
      setLoading(false);
    }
  };

  const loadDebug = async () => {
    try {
        const res = await fetch(`${API_BASE_URL}/cloudflare/debug`, { headers });
        const data = await res.json();
        setDebugInfo(data.debug_info);
    } catch(e) { console.error("Debug load failed:", e); }
  };

  useEffect(() => { load(); }, []);
  useEffect(() => { if (showDebug) loadDebug(); }, [showDebug]);

  const save = async () => {
    if (!apiToken.trim()) {
      toast({ title: 'API Token Required', description: 'Please enter a Cloudflare API token.', variant: 'destructive' });
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/cloudflare/config`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ api_token: apiToken.trim() })
      });

      if (!res.ok) throw new Error(await res.text());

      const data = await res.json();
      setSaved(true);
      toast({ title: 'Saved!', description: data.message || 'Cloudflare API token saved successfully.' });
      if(showDebug) loadDebug();
    } catch (e: any) {
      toast({ title: 'Save failed', description: e?.message || 'Could not save Cloudflare config.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const testConnection = async () => {
    if (!apiToken.trim()) {
      toast({ title: 'API Token Required', description: 'Please save an API token first.', variant: 'destructive' });
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/cloudflare/test-connection`, { headers });
      if (!res.ok) throw new Error(await res.text());

      const data = await res.json();
      toast({
        title: 'Connection Test',
        description: data.success ? '✅ Successfully connected to Cloudflare API!' : '❌ Connection failed: ' + data.message,
        variant: data.success ? 'default' : 'destructive'
      });
    } catch (e: any) {
      toast({ title: 'Connection Failed', description: e?.message || 'Network error testing connection.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="bg-gray-800 border-gray-700">
      <CardHeader>
        <CardTitle className="text-white flex justify-between items-center">
            <span>Cloudflare API Configuration</span>
            <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => setShowDebug(!showDebug)} 
                className="text-xs text-gray-500 hover:text-gray-300"
            >
                {showDebug ? 'Hide Debug Info' : 'Show Debug Info'}
            </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="bg-blue-900/20 border border-blue-600/30 text-blue-300 text-sm p-4 rounded">
          <p className="font-semibold mb-2">🌐 Setup Instructions:</p>
          <ol className="list-decimal list-inside space-y-1 ml-1">
            <li>Log in to your <a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noopener noreferrer" className="underline hover:text-blue-200">Cloudflare Dashboard</a></li>
            <li>Go to <strong>My Profile → API Tokens</strong></li>
            <li>Click <strong>Create Token</strong></li>
            <li>Use the "<strong>Edit zone DNS</strong>" template or custom permissions:
              <ul className="list-disc list-inside ml-4 mt-1 text-xs opacity-80">
                <li>Zone → DNS → Edit</li>
                <li>Zone → Zone → Read</li>
              </ul>
            </li>
            <li>Select the zones (domains) you want to manage</li>
            <li>Copy the generated API token and paste it below</li>
          </ol>
        </div>

        {showDebug && debugInfo && (
            <div className="bg-black/50 border border-yellow-600/30 text-yellow-500 text-xs p-4 rounded font-mono overflow-x-auto">
                <p className="font-bold text-yellow-400 mb-2">🔍 Server Debug Diagnostics:</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1">
                    <div><span className="text-gray-500">Config Path:</span> {debugInfo.config_file_path}</div>
                    <div><span className="text-gray-500">Exists:</span> <span className={debugInfo.config_file_exists ? "text-green-400" : "text-red-400"}>{String(debugInfo.config_file_exists)}</span></div>
                    <div><span className="text-gray-500">Root Dir:</span> {debugInfo.calculated_root}</div>
                    <div><span className="text-gray-500">Script:</span> {debugInfo.script_path}</div>
                    <div className="col-span-2 border-t border-gray-700 my-1 pt-1"></div>
                    <div><span className="text-gray-500">File Token:</span> {debugInfo.token_sources?.file_token}</div>
                    <div><span className="text-gray-500">Env Token:</span> {debugInfo.token_sources?.env_token}</div>
                    <div><span className="text-gray-500">Tokens Match:</span> <span className={debugInfo.token_sources?.match ? "text-green-400" : "text-red-400"}>{String(debugInfo.token_sources?.match)}</span></div>
                </div>
            </div>
        )}

        <div className="grid grid-cols-1 gap-4">
          <div>
            <Label className="text-gray-300">Cloudflare API Token</Label>
            <Input 
              type="password" 
              value={apiToken} 
              onChange={e => {
                setApiToken(e.target.value);
                setSaved(false);
              }}
              placeholder="Enter your Cloudflare API token"
              className="bg-gray-700 border-gray-600 text-white" 
              disabled={loading}
            />
            <p className="text-xs text-gray-500 mt-1">
              This token will be stored securely on the server and used for domain verification.
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          <Button onClick={save} className="bg-blue-600 hover:bg-blue-700" disabled={loading}>
            {saved ? '✅ Saved' : 'Save'}
          </Button>
          <Button 
            variant="outline" 
            onClick={testConnection} 
            className="border-green-600 text-green-300 hover:bg-green-900/20" 
            disabled={loading || !saved}
          >
            Test Connection
          </Button>
          <Button variant="outline" onClick={load} className="border-gray-600 text-gray-300 hover:bg-gray-700" disabled={loading}>Reload</Button>
        </div>

        {saved && (
          <div className="bg-green-900/20 border border-green-600/30 text-green-300 text-sm p-3 rounded">
            ✅ Cloudflare is configured! You can now use the <strong>Domain Verification</strong> feature.
          </div>
        )}
      </CardContent>
    </Card>
  );
};
'''

    # Write the cleaned file
    with open(app_path, 'w', encoding='utf-8') as f:
        f.write(cleaned_content)
        f.write(new_component)
    print("✅ Successfully updated AppManagement.tsx")

except Exception as e:
    print(f"❌ Error updating AppManagement.tsx: {e}")

# 2. Add Providers to CloudflareDomainManager.tsx
try:
    with open(cf_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Search for the Google SelectItem
    old_item = '<SelectItem value="google" className="text-white hover:bg-gray-600">Google</SelectItem>'
    
    # Check if already added to avoid duplication
    if "Outlook (Microsoft 365)" in content:
        print("⚠️  Providers already added to CloudflareDomainManager.tsx")
    elif old_item in content:
        # Add new providers after Google
        new_items = old_item + '\n                                        <SelectItem value="outlook" className="text-white hover:bg-gray-600">Outlook (Microsoft 365)</SelectItem>\n                                        <SelectItem value="zoho" className="text-white hover:bg-gray-600">Zoho Mail</SelectItem>\n                                        <SelectItem value="custom" className="text-white hover:bg-gray-600">Custom / Other</SelectItem>'
        
        content = content.replace(old_item, new_items)
        with open(cf_path, 'w', encoding='utf-8') as f:
            f.write(content)
        print("✅ Successfully updated CloudflareDomainManager.tsx with new providers")
    else:
        print("⚠️  Could not find SelectItem for google to replace")

except Exception as e:
    print(f"❌ Error updating CloudflareDomainManager.tsx: {e}")

print("\n🎉 Script execution completed!")
