import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { apiClient } from '../utils/apiClient'; // Use working API client

const Login: React.FC = () => {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { login } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      console.log('🔐 Attempting login with:', { username, password });
      
      // Use the working API client instead of broken fetch
      const response = await apiClient.login(username, password);
      
      console.log('✅ Login response:', response);
      
      if (response.success) {
        // Store user data
        const userData = {
          username: response.username,
          role: response.role,
          permissions: response.permissions || []
        };
        
        // Update auth context
        login(userData);
        
        // Navigate to dashboard
        navigate('/dashboard');
      } else {
        setError(response.message || 'Login failed');
      }
    } catch (error: any) {
      console.error('❌ Login error:', error);
      
      if (error.name === 'AbortError') {
        setError('Request timeout - server may be unreachable');
      } else if (error.message.includes('Failed to fetch')) {
        setError('Cannot connect to server - please check if backend is running');
      } else {
        setError(error.message || 'Login failed - please try again');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-white">
            Login
          </h2>
        </div>
        
        {error && (
          <div className="bg-red-900 border border-red-400 text-red-100 px-4 py-3 rounded relative">
            <strong className="font-bold">Error: </strong>
            <span className="block sm:inline">{error}</span>
          </div>
        )}
        
        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <div className="rounded-md shadow-sm -space-y-px">
            <div>
              <label htmlFor="username" className="sr-only">
                Username
              </label>
              <input
                id="username"
                name="username"
                type="text"
                required
                className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-t-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm"
                placeholder="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="password" className="sr-only">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-b-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          <div>
            <button
              type="submit"
              disabled={loading}
              className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
            >
              {loading ? 'Logging in...' : 'Login'}
            </button>
          </div>

          <div className="text-center">
            <a
              href="/forgot-password"
              className="font-medium text-indigo-400 hover:text-indigo-300"
            >
              Forgot Password?
            </a>
          </div>
        </form>
        
        {/* Debug information */}
        <div className="mt-4 p-3 bg-gray-800 rounded text-xs text-gray-400">
          <div>Debug Info:</div>
          <div>Current Host: {window.location.hostname}</div>
          <div>API Base: {window.location.hostname === 'localhost' ? 'localhost:8000' : `${window.location.hostname}:8000`}</div>
          <div>User Agent: {navigator.userAgent.substring(0, 50)}...</div>
        </div>
      </div>
    </div>
  );
};

export default Login;
