// API Configuration for Firebase Manager
// Completely flexible for any server with any IPv4 address
// Automatically detects server environment and configures endpoints

interface APIConfig {
  baseURL: string;
  wsURL: string;
  timeout: number;
}

// Detect server environment
const isProduction = import.meta.env.PROD;
const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

// Get server IP from environment or detect automatically
const getServerIP = (): string => {
  // Priority 1: Use specific server IP from environment (most reliable)
  if (import.meta.env.VITE_SERVER_IP) {
    console.log('🌐 Using VITE_SERVER_IP from environment:', import.meta.env.VITE_SERVER_IP);
    return import.meta.env.VITE_SERVER_IP;
  }
  
  // Priority 2: Use API base URL from environment
  if (import.meta.env.VITE_API_BASE_URL) {
    try {
      const url = new URL(import.meta.env.VITE_API_BASE_URL);
      console.log('🌐 Using VITE_API_BASE_URL from environment:', url.hostname);
      return url.hostname;
    } catch (e) {
      console.warn('⚠️ Invalid VITE_API_BASE_URL, falling back to auto-detection');
    }
  }
  
  // Priority 3: Auto-detect current server IP (fallback)
  if (!isLocalhost) {
    const currentHostname = window.location.hostname;
    console.log('🌐 Auto-detected server IP:', currentHostname);
    return currentHostname;
  }
  
  // Priority 4: Default to localhost for development
  console.log('🌐 Using localhost for development');
  return 'localhost';
};

// Get backend port
const getBackendPort = (): number => {
  // Try to extract port from API base URL first
  if (import.meta.env.VITE_API_BASE_URL) {
    try {
      const url = new URL(import.meta.env.VITE_API_BASE_URL);
      if (url.port) {
        return parseInt(url.port);
      }
    } catch (e) {
      // Ignore parsing errors
    }
  }
  
  // Fallback to environment variable or default
  return parseInt(import.meta.env.VITE_BACKEND_PORT || '8000');
};

// Create API configuration
const createAPIConfig = (): APIConfig => {
  const serverIP = getServerIP();
  const backendPort = getBackendPort();
  
  // Ensure we're using IPv4 (no IPv6 addresses)
  const cleanServerIP = serverIP.includes(':') ? serverIP.split(':')[0] : serverIP;
  
  return {
    baseURL: `http://${cleanServerIP}:${backendPort}`,
    wsURL: `ws://${cleanServerIP}:${backendPort}/ws`,
    timeout: 30000
  };
};

// Export the configuration
export const apiConfig = createAPIConfig();

// Log configuration for debugging
console.log('🌐 API Configuration:', {
  environment: import.meta.env.MODE,
  serverIP: getServerIP(),
  backendPort: getBackendPort(),
  baseURL: apiConfig.baseURL,
  wsURL: apiConfig.wsURL,
  isProduction,
  isLocalhost,
  envVars: {
    VITE_SERVER_IP: import.meta.env.VITE_SERVER_IP,
    VITE_API_BASE_URL: import.meta.env.VITE_API_BASE_URL,
    VITE_BACKEND_PORT: import.meta.env.VITE_BACKEND_PORT
  }
});

// Helper function to get full API URL
export const getAPIUrl = (endpoint: string): string => {
  // Remove leading slash if present
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint.slice(1) : endpoint;
  return `${apiConfig.baseURL}/${cleanEndpoint}`;
};

// Helper function to get WebSocket URL
export const getWebSocketUrl = (): string => {
  return apiConfig.wsURL;
};

// Helper function to validate server IP (ensure it's IPv4)
export const validateServerIP = (ip: string): boolean => {
  // Simple IPv4 validation (x.x.x.x format)
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  return ipv4Regex.test(ip);
};

export default apiConfig;
