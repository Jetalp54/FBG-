// Server Configuration for Ubuntu Deployment
// Replace these values with your actual server details

const SERVER_CONFIG = {
  // Your Ubuntu server IP address or domain
  SERVER_IP: 'your-server-ip-here',
  SERVER_PORT: 8000,
  
  // Frontend configuration
  FRONTEND_PORT: 3000,
  
  // API base URL (update this in your .env file)
  API_BASE_URL: 'http://your-server-ip-here:8000',
  
  // Example configurations:
  // For local network: 'http://192.168.1.100:8000'
  // For public domain: 'http://yourdomain.com:8000'
  // For localhost: 'http://localhost:8000'
};

module.exports = SERVER_CONFIG; 