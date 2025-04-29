// Lovable Downloader - Content Script
'use strict';

// --- Configuration Constants ---
const API_BASE_URL = "https://lovable-api.com";
const LOG_PREFIX = '[Lovable Downloader]';

// --- Utility Functions ---
const log = {
  info: (msg, ...args) => console.log(`${LOG_PREFIX} ${msg}`, ...args),
  warn: (msg, ...args) => console.warn(`${LOG_PREFIX} ${msg}`, ...args),
  error: (msg, ...args) => console.error(`${LOG_PREFIX} ${msg}`, ...args),
  debug: (msg, ...args) => { /* console.log(`${LOG_PREFIX} [DEBUG] ${msg}`, ...args); */ }
};

// --- Script Injection Functions ---
// Inject all scripts from the injections folder
async function injectAllScriptsFromInjectionsFolder() {
  log.info("Injecting scripts from the injections folder");
  
  try {
    // List of scripts to inject
    const injectionScripts = [
      'injections/tampermonkey.js',
      //! Add more scripts here if needed in the future
    ];
    
    for (const scriptPath of injectionScripts) {
      await injectScript(scriptPath);
    }
    
    log.info("All injection scripts loaded successfully");
  } catch (error) {
    log.error("Failed to inject scripts:", error);
  }
}

// Function to inject a script into the page
function injectScript(scriptPath) {
  return new Promise((resolve, reject) => {
    log.debug(`Injecting script: ${scriptPath}`);
    
    // Create a script element
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL(scriptPath);
    script.onload = () => {
      log.debug(`Script loaded successfully: ${scriptPath}`);
      resolve();
    };
    script.onerror = (error) => {
      log.error(`Failed to load script ${scriptPath}:`, error);
      reject(error);
    };
    
    // Append to document
    (document.head || document.documentElement).appendChild(script);
  });
}

// Extract token from the DOM
function getCredentialIdToken () {
  // Look through all script tags in the document
  const scripts = document.querySelectorAll('script');
  // Regex pattern to match idToken in serialized JSON
  const regex = /\\"idToken\\":\\"([A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+)\\"/;
  
  for (const script of scripts) {
      const content = script.textContent;
      if (content) {
          const match = content.match(regex);
          if (match?.[1]) {
              log.info("idToken found.");
              log.debug(`Token: ${match[1].substring(0, 20)}...`);
              return match[1];
          }
      }
  }
  
  return null;
}

function get3rdAuthIdToken () {
  const jwtPart1 =  __next_f[13][1].match(/(eyJ[\w|.]+)/)?.[0] || null;
  if (!jwtPart1) {
      return null;
  }
  const jwtPart2 = __next_f[14][1];
  const jwt = jwtPart1 + jwtPart2;
  return jwt;
}

function getIdTokenFromDom() {
    log.debug("Searching for idToken...");
    
    const credentialIdToken = getCredentialIdToken();
    if (credentialIdToken) {
        log.info("idToken found in credentialIdToken.");
        return credentialIdToken;
    }
    log.info("CredentialIdToken not found, checking 3rd-party auth...");

    const thirdPartyIdToken = get3rdAuthIdToken();
    if (thirdPartyIdToken) {
        log.info("idToken found in third-party auth.");
        return thirdPartyIdToken;
    }
    
    // If we reach here, token wasn't found
    log.error("idToken not found.");
    return null;
}

// Extract project ID from URL
function getProjectIdFromUrl() {
  const match = window.location.pathname.match(/\/projects\/([a-f0-9-]+)/i);
  if (match?.[1]) {
    log.debug(`Project ID: ${match[1]}`);
    return match[1];
  } else {
    log.warn("Project ID not found.");
    return null;
  }
}

// Convert base64 to Blob
function base64ToBlob(base64, contentType = '') {
  try {
    const byteCharacters = atob(base64);
    const byteArrays = [];
    
    for (let offset = 0; offset < byteCharacters.length; offset += 512) {
      const slice = byteCharacters.slice(offset, offset + 512);
      const byteNumbers = new Array(slice.length);
      for (let i = 0; i < slice.length; i++) {
        byteNumbers[i] = slice.charCodeAt(i);
      }
      byteArrays.push(new Uint8Array(byteNumbers));
    }
    
    return new Blob(byteArrays, { type: contentType });
  } catch (e) {
    log.error("B64->Blob Error:", e);
    return new Blob(["Error converting base64"], { type: "text/plain" });
  }
}

// Download a blob as a file
function triggerDownload(blob, filename) {
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    log.info(`Download triggered: ${filename}`);
  } catch (e) {
    log.error("Trigger DL Error:", e);
    alert("Download Error: " + e.message);
  }
}

// --- Project Download Functions ---
async function downloadProject(projectId, idToken) {
  if (!projectId || !idToken) {
    log.error("Cannot download: Missing project ID or auth token");
    return { success: false, error: "Missing project ID or authentication token" };
  }
  
  log.info(`Starting download for project: ${projectId}`);
  
  try {
    // Fetch the source code data
    const apiUrl = `${API_BASE_URL}/projects/${projectId}/source-code`;
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${idToken}` },
      credentials: 'include'
    });
    
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        log.error(`Authentication error (${response.status})`);
        return { success: false, error: "Authentication failed. Try refreshing or logging in again." };
      } else {
        log.error(`HTTP error ${response.status}`);
        return { success: false, error: `API error: ${response.status}` };
      }
    }
    
    const sourceCodeData = await response.json();
    log.info("Source code data fetched successfully");
    
    // Create ZIP file from the source code data
    if (!sourceCodeData?.files || sourceCodeData.files.length === 0) {
      log.error("No files found in the source code data");
      return { success: false, error: "No files found in project data" };
    }
    
    // Create a ZIP file
    log.info("Creating ZIP file...");
    const projectName = sourceCodeData.name || projectId;
    
    try {
      if (typeof JSZip === 'undefined') {
        // If not found in window or globalThis, try to inject it
        log.warn("JSZip not found. Trying to inject it from extension...");
        return { 
          success: false, 
          error: "JSZip library not available. Please refresh the page and try again.",
          needsJsZip: true 
        };
      }
      
      // JSZip is available, proceed with creating the ZIP
      const zip = new JSZip();
      const rootFolder = zip.folder(projectName);
      
      // Add files to ZIP
      for (const file of sourceCodeData.files) {
        if (file.contents !== undefined) {
          const content = file.binary ? base64ToBlob(file.contents) : file.contents;
          rootFolder.file(file.name, content, { binary: !!file.binary });
          log.debug(`Added to ZIP: ${file.name}`);
        }
      }
      
      // Generate and download the ZIP
      const blob = await zip.generateAsync({
        type: "blob",
        compression: "DEFLATE",
        compressionOptions: { level: 6 }
      });
      
      triggerDownload(blob, `${projectName}.zip`);
      log.info(`ZIP download triggered for project ${projectName}`);
      
      return { success: true };
    } catch (error) {
      log.error("JSZip error:", error);
      return { success: false, error: `ZIP creation error: ${error.message}` };
    }
  } catch (error) {
    log.error("Project download error:", error);
    return { success: false, error: error.message };
  }
}

// Ensure JSZip is initialized
function ensureJSZipLoaded() {
  log.debug("Ensuring JSZip is loaded");
  if (!window.JSZip) {
    // Create a script element to load JSZip
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('plugins/jszip.min.js');
    script.onload = () => {
      log.debug("JSZip loaded successfully");
    };
    script.onerror = (e) => {
      log.error("Failed to load JSZip", e);
    };
    
    document.head.appendChild(script);
  }
}

// --- Message Handling ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  log.debug("Content script received message:", message);
  
  if (message.action === 'checkToken') {
    const idToken = getIdTokenFromDom();
    sendResponse({ token: idToken });
  } 
  else if (message.action === 'refreshToken') {
    log.info("Token refresh requested");
    // Force reload of token by triggering a page navigation
    window.location.reload();
    // Return true to indicate we'll respond asynchronously
    return true;
  }
  else if (message.action === 'ensureJSZip') {
    ensureJSZipLoaded();
    sendResponse({ success: true });
  }
  else if (message.action === 'downloadProject') {
    const idToken = getIdTokenFromDom();
    const projectId = message.projectId || getProjectIdFromUrl();
    
    if (idToken && projectId) {
      // Ensure JSZip is loaded before starting download
      ensureJSZipLoaded();
      
      // Start async download process
      downloadProject(projectId, idToken)
        .then(result => {
          try {
            sendResponse(result);
          } catch (e) {
            log.debug("Could not send response after download:", e);
          }
        })
        .catch(error => {
          try {
            sendResponse({ success: false, error: error.message });
          } catch (e) {
            log.debug("Could not send error response:", e);
          }
        });
      
      // Indicate we'll send a response asynchronously
      return true;
    } else {
      sendResponse({ 
        success: false, 
        error: !idToken ? "Authentication token not found" : "Project ID not found",
        noToken: !idToken
      });
    }
  }
  else if (message.action === 'getAuthInfo') {
    const idToken = getIdTokenFromDom();
    const projectId = getProjectIdFromUrl();
    
    sendResponse({
      idToken,
      projectId
    });
  }
  return true; // Keep the message channel open for async responses
});

// Initialize when the content script loads
log.info("Content script loaded on Lovable project page");

// Ensure JSZip is available by injecting it into the page
ensureJSZipLoaded();

// Inject all scripts from the injections folder
injectAllScriptsFromInjectionsFolder();
