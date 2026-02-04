import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Zap, Key, Sparkles, Mail, Type } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

const API_BASE_URL = (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") ? "http://localhost:8000" : "/api";

export const AIManagement = () => {
  const { toast } = useToast();
  const [provider, setProvider] = useState<'openai' | 'gemini' | 'mistral' | 'githubai'>(localStorage.getItem('ai-provider') as any || 'openai');
  const [openaiKey, setOpenaiKey] = useState(localStorage.getItem('ai-api-key') || '');
  const [geminiKey, setGeminiKey] = useState(localStorage.getItem('gemini-api-key') || '');
  const [mistralKey, setMistralKey] = useState('');
  const [githubKey, setGithubKey] = useState('');
  const apiKey = provider === 'openai' ? openaiKey : provider === 'gemini' ? geminiKey : provider === 'mistral' ? mistralKey : githubKey;
  const [generationType, setGenerationType] = useState<'from' | 'subject' | 'template'>('from');
  const [prompt, setPrompt] = useState('');
  const [generatedContent, setGeneratedContent] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [aiStatus, setAiStatus] = useState<{[key: string]: {configured: boolean, key_length: number}}>({});
  const [negativePrompt, setNegativePrompt] = useState('');
  const [useNegativePrompt, setUseNegativePrompt] = useState(true);
  const [isSavingNegative, setIsSavingNegative] = useState(false);

  // Load AI status on component mount
  useEffect(() => {
    const loadAiStatus = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/ai/status`);
        if (response.ok) {
          const status = await response.json();
          setAiStatus(status);
        }
      } catch (error) {
        console.error('Failed to load AI status:', error);
      }
    };
    loadAiStatus();
  }, []);

  // Fetch negative prompt from backend on mount
  useEffect(() => {
    const fetchNegativePrompt = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/ai/negative-prompt`);
        if (res.ok) {
          const data = await res.json();
          setNegativePrompt(data.negative_prompt || '');
        }
      } catch (e) {
        console.error('Failed to fetch negative prompt:', e);
      }
    };
    fetchNegativePrompt();
  }, []);

  const saveApiKey = async () => {
    if (!apiKey.trim()) {
      toast({
        title: 'Error',
        description: 'Please enter a valid API key.',
        variant: 'destructive',
      });
      return;
    }

    try {
      if (provider === 'openai') {
        localStorage.setItem('ai-api-key', apiKey);
        setOpenaiKey(apiKey);
        localStorage.setItem('ai-provider', provider);
        toast({
          title: 'API Key Saved',
          description: 'Your OpenAI API key has been saved successfully.',
        });
      } else if (provider === 'gemini') {
        localStorage.setItem('gemini-api-key', apiKey);
        setGeminiKey(apiKey);
        localStorage.setItem('ai-provider', provider);
        toast({
          title: 'API Key Saved',
          description: 'Your Gemini API key has been saved successfully.',
        });
      } else if (provider === 'mistral' || provider === 'githubai') {
        // Prompt for admin credentials
        const username = window.prompt('Enter admin username:', 'admin');
        const password = window.prompt('Enter admin password:', 'admin');
        if (!username || !password) {
          toast({ title: 'Auth Required', description: 'Admin credentials are required.', variant: 'destructive' });
          return;
        }

        const response = await fetch(`${API_BASE_URL}/ai/set-key?service=${provider}&key=${encodeURIComponent(apiKey)}`, {
          method: 'POST',
          headers: {
            'Authorization': 'Basic ' + btoa(`${username}:${password}`),
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.detail || `HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        if (data.success) {
          toast({ 
            title: 'API Key Saved', 
            description: `Your ${provider === 'mistral' ? 'Mistral' : 'GitHub AI'} API key has been saved to the backend.` 
          });
          if (provider === 'mistral') setMistralKey('');
          if (provider === 'githubai') setGithubKey('');
          // Refresh AI status
          const statusResponse = await fetch(`${API_BASE_URL}/ai/status`);
          if (statusResponse.ok) {
            const status = await statusResponse.json();
            setAiStatus(status);
          }
        } else {
          throw new Error(data.detail || 'Failed to save key');
        }
      }
    } catch (error) {
      console.error('Error saving API key:', error);
      toast({ 
        title: 'Error', 
        description: `Failed to save key: ${error instanceof Error ? error.message : 'Unknown error'}`, 
        variant: 'destructive' 
      });
    }
  };

  const saveNegativePrompt = async () => {
    setIsSavingNegative(true);
    try {
      const username = window.prompt('Enter admin username:', 'admin');
      const password = window.prompt('Enter admin password:', 'admin');
      if (!username || !password) {
        toast({ title: 'Auth Required', description: 'Admin credentials are required.', variant: 'destructive' });
        setIsSavingNegative(false);
        return;
      }
      const res = await fetch(`${API_BASE_URL}/ai/negative-prompt`, {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + btoa(`${username}:${password}`),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ negative_prompt: negativePrompt }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast({ title: 'Negative Prompt Saved', description: 'Global negative prompt updated.' });
      } else {
        toast({ title: 'Error', description: data.detail || 'Failed to save negative prompt.', variant: 'destructive' });
      }
    } catch (e) {
      toast({ title: 'Error', description: 'Failed to save negative prompt.', variant: 'destructive' });
    } finally {
      setIsSavingNegative(false);
    }
  };

  const generateContent = async () => {
    if ((provider === 'openai' || provider === 'gemini') && !apiKey) {
      toast({
        title: 'API Key Required',
        description: 'Please add your AI API key first.',
        variant: 'destructive',
      });
      return;
    }
    if (!prompt.trim()) {
      toast({
        title: 'Prompt Required',
        description: 'Please enter a prompt for content generation.',
        variant: 'destructive',
      });
      return;
    }
    setIsGenerating(true);
    try {
      const systemPrompts = {
        from: "Generate a professional 'From' name for an email. Return only the name, no quotes or extra text.",
        subject: "Generate a compelling email subject line. Return only the subject line, no quotes or extra text.",
        template: "Generate a professional HTML email template. Include proper HTML structure with inline CSS for styling."
      };
      let content = '';
      const fullPrompt = `${systemPrompts[generationType]}\n${prompt}`;
      
      if (provider === 'openai') {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-4',
            messages: [
              { role: 'system', content: systemPrompts[generationType] },
              { role: 'user', content: fullPrompt }
            ],
            max_tokens: generationType === 'template' ? 2000 : 100,
            temperature: 0.7
          })
        });
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error?.message || `HTTP ${response.status}: ${response.statusText}`);
        }
        const data = await response.json();
        content = data.choices[0].message.content;
      } else if (provider === 'gemini') {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `${systemPrompts[generationType]}\n${fullPrompt}` }] }],
            generationConfig: {
              temperature: 0.7,
              topK: 40,
              topP: 0.95,
              maxOutputTokens: generationType === 'template' ? 2048 : 256,
            }
          })
        });
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error?.message || `HTTP ${response.status}: ${response.statusText}`);
        }
        const data = await response.json();
        if (data.candidates && data.candidates[0]) {
          content = data.candidates[0].content.parts[0].text.trim();
        } else {
          throw new Error('No content generated');
        }
      } else if (provider === 'mistral') {
        const response = await fetch(`${API_BASE_URL}/ai/mistral-generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: `${systemPrompts[generationType]}\n${fullPrompt}`,
            max_tokens: generationType === 'template' ? 2000 : 100,
            temperature: 0.7
          })
        });
        
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.detail || `HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        if (data.success && data.result && data.result.choices && data.result.choices[0]) {
          content = data.result.choices[0].message.content;
        } else {
          throw new Error(data.error || 'Failed to generate content');
        }
      } else if (provider === 'githubai') {
        const response = await fetch(`${API_BASE_URL}/ai/githubai-generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: `${systemPrompts[generationType]}\n${fullPrompt}`,
            max_tokens: generationType === 'template' ? 2000 : 100,
            temperature: 0.7
          })
        });
        
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.detail || `HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        if (data.success && data.result && data.result.choices && data.result.choices[0]) {
          content = data.result.choices[0].message.content;
        } else {
          throw new Error(data.error || 'Failed to generate content');
        }
      }
      
      setGeneratedContent(content);
      toast({
        title: 'Content Generated',
        description: `${generationType.charAt(0).toUpperCase() + generationType.slice(1)} content generated successfully.`,
      });
    } catch (error) {
      console.error('Error generating content:', error);
      toast({
        title: 'Generation Failed',
        description: `Failed to generate content: ${error instanceof Error ? error.message : 'Unknown error'}`,
        variant: 'destructive',
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(generatedContent);
    toast({
      title: "Copied",
      description: "Content copied to clipboard.",
    });
  };

  return (
    <div className="p-8 space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-white mb-2">AI Content Generation</h1>
        <p className="text-gray-400">Generate custom email content using AI</p>
      </div>

      {/* API Key Management */}
      <Card className="bg-gray-800 border-gray-700">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Key className="w-5 h-5" />
            AI API Key Configuration
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="text-gray-300">AI Provider</Label>
            <Select value={provider} onValueChange={v => setProvider(v as any)}>
              <SelectTrigger className="bg-gray-700 border-gray-600 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-gray-700 border-gray-600">
                <SelectItem value="openai" className="text-white hover:bg-gray-600">OpenAI GPT-4</SelectItem>
                <SelectItem value="gemini" className="text-white hover:bg-gray-600">Google Gemini Pro</SelectItem>
                <SelectItem value="mistral" className="text-white hover:bg-gray-600">Mistral AI</SelectItem>
                <SelectItem value="githubai" className="text-white hover:bg-gray-600">GitHub AI</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="apiKey" className="text-gray-300">
              {provider === 'openai' ? 'OpenAI API Key' : provider === 'gemini' ? 'Gemini API Key' : provider === 'mistral' ? 'Mistral API Key (set by admin)' : 'GitHub AI Key (set by admin)'}
            </Label>
            <div className="flex gap-2 mt-2">
              <Input
                id="apiKey"
                type="password"
                value={apiKey}
                onChange={e => {
                  if (provider === 'openai') setOpenaiKey(e.target.value);
                  else if (provider === 'gemini') setGeminiKey(e.target.value);
                  else if (provider === 'mistral') setMistralKey(e.target.value);
                  else setGithubKey(e.target.value);
                }}
                placeholder={provider === 'openai' ? 'sk-...' : provider === 'gemini' ? 'AIza...' : provider === 'mistral' ? 'Paste Mistral API Key' : 'Paste GitHub AI Key'}
                className="bg-gray-700 border-gray-600 text-white"
              />
              <Button
                onClick={saveApiKey}
                className="bg-blue-600 hover:bg-blue-700"
                disabled={!apiKey.trim()}
              >
                Save
              </Button>
            </div>
            <p className="text-sm text-gray-500 mt-1">
              {provider === 'mistral' || provider === 'githubai'
                ? 'Key is managed by admin and never exposed to the frontend.'
                : 'Your API key is stored locally and never sent to our servers.'}
            </p>
            <p className="text-xs text-gray-400 mt-1">
              Saving a new key will replace the existing {provider === 'openai' ? 'OpenAI' : provider === 'gemini' ? 'Gemini' : 'backend'} key.
            </p>
            {((provider === 'openai' && openaiKey) || (provider === 'gemini' && geminiKey)) && (
              <Badge className="bg-green-500/20 text-green-400 mt-2">
                Key Configured ({(provider === 'openai' ? openaiKey.length : geminiKey.length)} chars)
              </Badge>
            )}
            {(provider === 'mistral' || provider === 'githubai') && aiStatus[provider] && (
              <div className="mt-2">
                {aiStatus[provider].configured ? (
                  <Badge className="bg-green-500/20 text-green-400">
                    Backend Key Configured ({aiStatus[provider].key_length} chars)
                  </Badge>
                ) : (
                  <Badge className="bg-yellow-500/20 text-yellow-400">
                    Backend Key Not Set
                  </Badge>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Negative Prompt Field */}
      <div className="mb-8">
        <Label htmlFor="negativePrompt" className="text-gray-300 font-semibold mb-1 block">
          Global Negative Prompt
        </Label>
        <Textarea
          id="negativePrompt"
          value={negativePrompt}
          onChange={e => setNegativePrompt(e.target.value)}
          placeholder="Enter a negative prompt (e.g. avoid spammy language, avoid certain topics, etc.)"
          className="bg-gray-700 border-gray-600 text-white"
          rows={2}
        />
        <div className="flex gap-2 mt-2">
          <Button onClick={saveNegativePrompt} className="bg-blue-600 hover:bg-blue-700" disabled={isSavingNegative}>
            {isSavingNegative ? 'Saving...' : 'Save Negative Prompt'}
          </Button>
          <div className="flex items-center ml-4">
            <input
              type="checkbox"
              id="useNegativePrompt"
              checked={useNegativePrompt}
              onChange={e => setUseNegativePrompt(e.target.checked)}
              className="mr-2"
            />
            <Label htmlFor="useNegativePrompt" className="text-gray-300">Apply negative prompt to this generation</Label>
          </div>
        </div>
        <p className="text-xs text-gray-400 mt-1">
          This prompt is stored in the backend and can be updated by an admin. It will only be used if the checkbox is selected.
        </p>
      </div>

      {/* Content Generation */}
      <Card className="bg-gray-800 border-gray-700">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Sparkles className="w-5 h-5" />
            Generate Content
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="text-gray-300">Content Type</Label>
            <Select value={generationType} onValueChange={(value: 'from' | 'subject' | 'template') => setGenerationType(value)}>
              <SelectTrigger className="bg-gray-700 border-gray-600 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-gray-700 border-gray-600">
                <SelectItem value="from" className="text-white hover:bg-gray-600">
                  <div className="flex items-center gap-2">
                    <Type className="w-4 h-4" />
                    From Name
                  </div>
                </SelectItem>
                <SelectItem value="subject" className="text-white hover:bg-gray-600">
                  <div className="flex items-center gap-2">
                    <Mail className="w-4 h-4" />
                    Subject Line
                  </div>
                </SelectItem>
                <SelectItem value="template" className="text-white hover:bg-gray-600">
                  <div className="flex items-center gap-2">
                    <Zap className="w-4 h-4" />
                    HTML Template
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="prompt" className="text-gray-300">Prompt</Label>
            <Textarea
              id="prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={`Describe what you want for your ${generationType}...`}
              rows={3}
              className="bg-gray-700 border-gray-600 text-white"
            />
          </div>

          <Button
            onClick={generateContent}
            className="bg-purple-700 hover:bg-purple-800"
            disabled={
              isGenerating ||
              !prompt.trim() ||
              ((provider === 'openai' && !openaiKey) ||
                (provider === 'gemini' && !geminiKey) ||
                ((provider === 'mistral' || provider === 'githubai') && !aiStatus[provider]?.configured))
            }
          >
            Generate {generationType.charAt(0).toUpperCase() + generationType.slice(1)}
          </Button>

          {generatedContent && (
            <div className="mt-4 space-y-2">
              <div className="flex justify-between items-center">
                <Label className="text-gray-300">Generated Content</Label>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={copyToClipboard}
                  className="border-gray-600 text-gray-300 hover:bg-gray-700"
                >
                  Copy
                </Button>
              </div>
              <div className="bg-gray-700 p-4 rounded-lg">
                {generationType === 'template' ? (
                  <pre className="text-white text-sm whitespace-pre-wrap overflow-x-auto">
                    {generatedContent}
                  </pre>
                ) : (
                  <p className="text-white">{generatedContent}</p>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
