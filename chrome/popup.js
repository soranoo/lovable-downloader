// Popup script for Lovable Downloader
document.addEventListener('DOMContentLoaded', async () => {
  const statusElement = document.getElementById('status');
  const projectIdElement = document.getElementById('project-id');
  const tokenStatusElement = document.getElementById('token-status');
  const projectInfoElement = document.getElementById('project-info');
  const downloadButton = document.getElementById('download-project');
  const helpTextElement = document.getElementById('help-text');
  
  let currentTab = null;
  let projectId = null;
  let idToken = null;
  
  // Get the current tab info
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tabs[0];
  
  // Check if we're on a Lovable project page
  if (!currentTab.url.match(/^https:\/\/lovable\.dev\/projects\/[a-f0-9-]+/i)) {
    updateStatus('Not on a Lovable project page', 'error');
    helpTextElement.textContent = 'Please navigate to a project page on lovable.dev to use this extension.';
    return;
  }
  
  // Extract project ID from URL
  const urlMatch = currentTab.url.match(/\/projects\/([a-f0-9-]+)/i);
  if (urlMatch && urlMatch[1]) {
    projectId = urlMatch[1];
    projectIdElement.textContent = projectId;
    projectInfoElement.style.display = 'block';
  } else {
    updateStatus('Could not detect project ID', 'error');
    return;
  }
  
  // Get authentication token and status from the content script
  try {
    updateStatus('Checking authentication status...', 'warning');
    
    const response = await chrome.tabs.sendMessage(currentTab.id, { action: 'getAuthInfo' });
    
    if (response && response.idToken) {
      idToken = response.idToken;
      tokenStatusElement.textContent = 'Authenticated';
      updateStatus('Ready to download', 'success');
      downloadButton.disabled = false;
      helpTextElement.textContent = 'Click the button to download the entire project as a ZIP file.';
    } else {
      tokenStatusElement.textContent = 'Not authenticated / Using 3rd party auth';
      updateStatus('Authentication token not found', 'error');
      helpTextElement.textContent = 'Please make sure you are logged in and reload the page. If you are logged in using 3rd party providers, please check the in-page toolbar download button.';
      log.info("CredentialIdToken not found, checking 3rd-party auth...");
    }
  } catch (error) {
    updateStatus('Could not communicate with page. Please reload.', 'error');
    console.error('Communication error:', error);
  }
  
  // Set up download button
  downloadButton.addEventListener('click', async () => {
    if (!projectId || !idToken) {
      updateStatus('Missing project ID or authentication token', 'error');
      return;
    }
    
    try {
      updateStatus('Downloading project data...', 'warning');
      downloadButton.disabled = true;
      
      // Request the service worker to download and package the project
      const response = await chrome.runtime.sendMessage({
        action: 'downloadProject',
        projectId,
        idToken
      });
      
      if (response.success) {
        updateStatus('Download completed successfully', 'success');
      } else {
        updateStatus(`Download failed: ${response.error}`, 'error');
        downloadButton.disabled = false;
      }
    } catch (error) {
      updateStatus('Download failed. See console for details.', 'error');
      console.error('Download error:', error);
      downloadButton.disabled = false;
    }
  });
  
  // Helper function to update status message
  function updateStatus(message, type = '') {
    statusElement.textContent = message;
    statusElement.className = 'status';
    if (type) {
      statusElement.classList.add(`status-${type}`);
    }
  }
});