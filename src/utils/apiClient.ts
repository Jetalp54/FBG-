// Working API Client for Firebase Manager - IPv4 Consistent
// This replaces all the broken fetch calls with a working solution

class APIClient {
  private baseURL: string;
  private timeout: number;

  constructor() {
    // Get the current server IP from the browser
    const currentHost = window.location.hostname;
    const currentPort = window.location.port || '80';

    // ALWAYS use IPv4 - no IPv6 addresses
    let serverIP = currentHost;

    // If we have an IPv6 address, extract the IPv4 part
    if (currentHost.includes(':')) {
      // This is an IPv6 address, we need to get the IPv4
      // For now, use localhost:8000 as fallback
      serverIP = 'localhost';
      console.warn('⚠️ IPv6 address detected, using localhost:8000 as fallback');
    }

    // If we're on the server itself, use localhost:8000 for backend
    // If we're accessing remotely, use the same hostname (port 80 for Nginx proxy)
    if (serverIP === 'localhost' || serverIP === '127.0.0.1') {
      this.baseURL = 'http://localhost:8000';
    } else {
      // Remote server - use same hostname on port 80 (Nginx will proxy to backend)
      this.baseURL = `http://${serverIP}`;
    }

    this.timeout = 30000;

    console.log('🌐 API Client initialized with:', {
      currentHost,
      currentPort,
      serverIP,
      baseURL: this.baseURL,
      userAgent: navigator.userAgent,
      isIPv6: currentHost.includes(':')
    });
  }

  private async makeRequest(endpoint: string, options: RequestInit = {}): Promise<any> {
    const url = `${this.baseURL}${endpoint}`;

    console.log(`🌐 Making API request to: ${url}`);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      console.log(`✅ API response from ${url}:`, data);
      return data;

    } catch (error) {
      console.error(`❌ API request failed to ${url}:`, error);
      throw error;
    }
  }

  // Authentication endpoints
  async login(username: string, password: string) {
    return this.makeRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
  }

  async getEffectivePermissions(username: string) {
    return this.makeRequest(`/auth/effective?username=${encodeURIComponent(username)}`);
  }

  async forgotPassword(username: string, email: string) {
    return this.makeRequest('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ username, email }),
    });
  }

  // App users management
  async getAppUsers() {
    return this.makeRequest('/app-users');
  }

  async createAppUser(userData: any) {
    return this.makeRequest('/app-users', {
      method: 'POST',
      body: JSON.stringify(userData),
    });
  }

  async updateAppUser(username: string, updates: any) {
    return this.makeRequest(`/app-users/${encodeURIComponent(username)}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  }

  async deleteAppUser(username: string) {
    return this.makeRequest(`/app-users/${encodeURIComponent(username)}`, {
      method: 'DELETE',
    });
  }

  // Projects
  async getProjects(limit = 30, offset = 0) {
    return this.makeRequest(`/projects?limit=${limit}&offset=${offset}`);
  }

  async createProject(projectData: any) {
    return this.makeRequest('/projects', {
      method: 'POST',
      body: JSON.stringify(projectData),
    });
  }

  // Campaigns
  async getCampaigns() {
    return this.makeRequest('/campaigns');
  }

  async sendCampaign(campaignData: any) {
    return this.makeRequest('/campaigns/send', {
      method: 'POST',
      body: JSON.stringify(campaignData),
    });
  }

  // Profiles
  async getProfiles() {
    return this.makeRequest('/profiles');
  }

  // Health check
  async healthCheck() {
    return this.makeRequest('/health');
  }

  // Test database connection
  async testDatabase() {
    return this.makeRequest('/auth/test-db');
  }

  // Get current configuration
  getCurrentConfig() {
    return {
      baseURL: this.baseURL,
      currentHost: window.location.hostname,
      isIPv6: window.location.hostname.includes(':'),
      userAgent: navigator.userAgent
    };
  }
}

// Create and export a single instance
export const apiClient = new APIClient();

// Also export the class for testing
export default APIClient;
