// Test script to verify campaign sending endpoint
const API_BASE_URL = 'http://localhost:8000';

async function testCampaignSend() {
  console.log('Testing campaign send endpoint...');
  
  try {
    // First, get all campaigns to see what's available
    const campaignsResponse = await fetch(`${API_BASE_URL}/campaigns`);
    const campaignsData = await campaignsResponse.json();
    console.log('Available campaigns:', campaignsData);
    
    if (campaignsData.campaigns && campaignsData.campaigns.length > 0) {
      const firstCampaign = campaignsData.campaigns[0];
      console.log('Testing with campaign:', firstCampaign);
      
      // Test the send endpoint
      const sendResponse = await fetch(`${API_BASE_URL}/campaigns/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          projectId: firstCampaign.projectIds[0],
          userIds: firstCampaign.selectedUsers[firstCampaign.projectIds[0]] || [],
          lightning: true,
          campaignId: firstCampaign.id
        })
      });
      
      console.log('Send response status:', sendResponse.status);
      const sendData = await sendResponse.json();
      console.log('Send response data:', sendData);
    } else {
      console.log('No campaigns available for testing');
    }
  } catch (error) {
    console.error('Test failed:', error);
  }
}

// Run the test
testCampaignSend(); 