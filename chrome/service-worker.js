// Service worker for Lovable Downloader extension
const API_BASE_URL = "https://lovable-api.com";

// Log messages to console
const log = (level, ...args) => {
  console[level]('[Lovable Downloader Service Worker]', ...args);
};

// Listen for messages from popup or content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  log('info', 'Received message:', message.action);

  if (message.action === 'downloadProject') {
    const { projectId, idToken } = message;
    
    if (!projectId || !idToken) {
      log('error', 'Missing project ID or idToken');
      sendResponse({ 
        success: false, 
        error: 'Missing project ID or authentication token' 
      });
      return true;
    }
    
    // Initiate the download process
    downloadProject(projectId, idToken)
      .then(result => {
        sendResponse(result);
      })
      .catch(error => {
        log('error', 'Download error:', error);
        sendResponse({ 
          success: false, 
          error: error.message || 'Unknown error occurred'
        });
      });
    
    return true; // Keep the message channel open for async response
  }
  
  // Return false for unhandled messages
  return false;
});

// Download project function
async function downloadProject(projectId, idToken) {
  log('info', `Starting download for project: ${projectId}`);
  
  try {
    // Forward the download request to the content script
    // This is necessary because JSZip and DOM APIs are only available in the content script
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab) {
      throw new Error('No active tab found');
    }
    
    const response = await chrome.tabs.sendMessage(tab.id, {
      action: 'downloadProject',
      projectId,
      idToken
    });
    
    log('info', 'Content script download response:', response);
    
    if (response.needsJsZip) {
      // If JSZip is missing, we need to inject it
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['plugins/jszip.min.js']
      });
      
      // Try again after injecting JSZip
      const retryResponse = await chrome.tabs.sendMessage(tab.id, {
        action: 'downloadProject',
        projectId,
        idToken
      });
      
      return retryResponse;
    }
    
    return response;
  } catch (error) {
    log('error', 'Project download error:', error);
    return { 
      success: false, 
      error: error.message || 'Failed to communicate with the page' 
    };
  }
}

// When the extension is installed or updated
chrome.runtime.onInstalled.addListener(() => {
  log('info', 'Extension installed/updated', chrome.runtime.getManifest().version);
});
