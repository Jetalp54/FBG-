import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AppContext';

const LoginPage: React.FC = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotUsername, setForgotUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { login } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      if (!res.ok) {
        throw new Error('Invalid credentials');
      }
      const data = await res.json();
      localStorage.setItem('app-role', data.role || 'member');
      localStorage.setItem('app-username', data.username || '');
      // Normalize to full set of keys to avoid missing values in UI
      const known = ['projects','users','campaigns','templates','ai','test','profiles','auditLogs','settings','smtp'];
      const normalized: any = {};
      known.forEach(k => { normalized[k] = !!(data.permissions && data.permissions[k]); });
      localStorage.setItem('app-permissions', JSON.stringify(normalized));
      // notify other tabs/components
      window.dispatchEvent(new Event('storage'));
      login();
      setError('');
      navigate('/');
    } catch (err: any) {
      setError(err?.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const res = await fetch(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: forgotUsername })
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.detail || 'Failed to send reset email');
      }
      const data = await res.json();
      setSuccess(data.message);
      setShowForgotPassword(false);
      setForgotUsername('');
    } catch (err: any) {
      setError(err?.message || 'Failed to send reset email');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center h-screen bg-gray-900">
      <div className="bg-gray-800 p-8 rounded shadow-md w-80">
        {!showForgotPassword ? (
          <form onSubmit={handleSubmit}>
            <h2 className="text-2xl font-bold mb-6 text-white text-center">Login</h2>
            {error && <div className="mb-4 text-red-500 text-center">{error}</div>}
            {success && <div className="mb-4 text-green-500 text-center">{success}</div>}
            <div className="mb-4">
              <label className="block text-gray-300 mb-2">Username</label>
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                className="w-full px-3 py-2 rounded bg-gray-700 text-white focus:outline-none"
                autoFocus
                disabled={loading}
              />
            </div>
            <div className="mb-6">
              <label className="block text-gray-300 mb-2">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full px-3 py-2 rounded bg-gray-700 text-white focus:outline-none"
                disabled={loading}
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white font-bold py-2 px-4 rounded mb-4"
            >
              {loading ? 'Loading...' : 'Login'}
            </button>
            <div className="text-center">
              <button
                type="button"
                onClick={() => setShowForgotPassword(true)}
                className="text-blue-400 hover:text-blue-300 text-sm"
              >
                Forgot Password?
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleForgotPassword}>
            <h2 className="text-2xl font-bold mb-6 text-white text-center">Reset Password</h2>
            {error && <div className="mb-4 text-red-500 text-center">{error}</div>}
            {success && <div className="mb-4 text-green-500 text-center">{success}</div>}
            <div className="mb-6">
              <label className="block text-gray-300 mb-2">Username</label>
              <input
                type="text"
                value={forgotUsername}
                onChange={e => setForgotUsername(e.target.value)}
                className="w-full px-3 py-2 rounded bg-gray-700 text-white focus:outline-none"
                autoFocus
                disabled={loading}
                placeholder="Enter your username"
              />
            </div>
            <button
              type="submit"
              disabled={loading || !forgotUsername.trim()}
              className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-white font-bold py-2 px-4 rounded mb-4"
            >
              {loading ? 'Sending...' : 'Send Reset Email'}
            </button>
            <div className="text-center">
              <button
                type="button"
                onClick={() => {
                  setShowForgotPassword(false);
                  setError('');
                  setSuccess('');
                  setForgotUsername('');
                }}
                className="text-blue-400 hover:text-blue-300 text-sm"
              >
                Back to Login
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

export default LoginPage; 