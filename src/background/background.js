// Background service worker for Firefox WebExtension

import { 
  initializeStorage, 
  getActiveChain, 
  isExtensionEnabled,
  loadChains,
  getSettings,
  setExtensionEnabled,
  setActiveChain
} from '../storage.js';

import { ProxyChainEngine } from '../chainEngine.js';

let currentProxyState = {
  enabled: false,
  activeChainId: null,
  activeChain: null
};

// Connection cache to avoid rebuilding chains too frequently
const connectionCache = new Map();
const CACHE_TTL = 30000; // 30 seconds

// Initialize proxy chain engine
let proxyChainEngine = new ProxyChainEngine({
  connectionTimeout: 30000,
  totalTimeout: 120000,
  enableLogging: true,
  maxRetries: 2
});

// Handle extension installation
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('Extension installed:', details);
  
  try {
    await initializeStorage();
    await loadCurrentState();
    setupStorageListener();
    updateProxySettings();
    console.log('Storage initialized successfully');
  } catch (error) {
    console.error('Failed to initialize storage:', error);
  }
});

// Load current state from storage
async function loadCurrentState() {
  try {
    currentProxyState.enabled = await isExtensionEnabled();
    currentProxyState.activeChain = await getActiveChain();
    currentProxyState.activeChainId = currentProxyState.activeChain ? currentProxyState.activeChain.id : null;
  } catch (error) {
    console.error('Failed to load current state:', error);
  }
}

// Listen for real-time storage changes
function setupStorageListener() {
  chrome.storage.onChanged.addListener(async (changes, areaName) => {
    if (areaName === 'local') {
      console.log('Storage changed, reloading state');
      
      // Check for settings changes (enabled state, active chain)
      if (changes.extensionSettings) {
        const newSettings = changes.extensionSettings.newValue;
        currentProxyState.enabled = newSettings.enabled;
        currentProxyState.activeChainId = newSettings.activeChainId;
        
        // Reload the active chain
        try {
          currentProxyState.activeChain = await getActiveChain();
        } catch (error) {
          console.error('Failed to reload active chain:', error);
          currentProxyState.activeChain = null;
        }
        
        updateProxySettings();
        clearConnectionCache();
      }
      
      // Check for chain changes
      if (changes.proxyChains) {
        console.log('Proxy chains updated');
        try {
          currentProxyState.activeChain = await getActiveChain();
        } catch (error) {
          console.error('Failed to reload active chain after chain update:', error);
        }
        clearConnectionCache();
      }
    }
  });
}

// Update proxy settings based on current state
function updateProxySettings() {
  if (currentProxyState.enabled && currentProxyState.activeChain) {
    console.log('Proxy enabled for chain:', currentProxyState.activeChain.name);
    console.log('Chain contains', currentProxyState.activeChain.proxies.length, 'proxy(ies)');
  } else {
    console.log('Proxy disabled or no active chain');
  }
}

// Clear connection cache
function clearConnectionCache() {
  connectionCache.clear();
  console.log('Connection cache cleared');
}

// Extract host and port from URL
function extractHostPort(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    const protocol = parsed.protocol;
    
    // Determine port from protocol or explicit port
    let port = parseInt(parsed.port, 10);
    if (!port) {
      port = protocol === 'https:' ? 443 : (protocol === 'http:' ? 80 : 443);
    }
    
    return { host, port, protocol };
  } catch (error) {
    console.error('Failed to parse URL:', url, error);
    return null;
  }
}

// Check if request should go through proxy based on protocol
function shouldProxyRequest(url) {
  try {
    const parsed = new URL(url);
    const protocol = parsed.protocol;
    
    // Proxy HTTP, HTTPS, and WebSocket requests
    const supportedProtocols = ['http:', 'https:', 'ws:', 'wss:'];
    return supportedProtocols.includes(protocol);
  } catch (error) {
    console.error('Failed to check protocol for URL:', url);
    return false;
  }
}

// Validate chain connection before using it
async function validateChainConnection(chain, targetHost, targetPort) {
  // Check cache
  const cacheKey = `${chain.id}:${targetHost}:${targetPort}`;
  const cached = connectionCache.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log('Using cached chain validation for', cacheKey);
    return cached.valid;
  }
  
  try {
    console.log(`Validating chain connection to ${targetHost}:${targetPort}`);
    
    // Build chain to validate it works
    const result = await proxyChainEngine.buildChain(chain, targetHost, targetPort);
    
    // Successfully built, cache the result
    connectionCache.set(cacheKey, {
      valid: true,
      timestamp: Date.now(),
      result
    });
    
    // Clean up the socket
    if (result.socket) {
      result.socket.close();
    }
    
    console.log('Chain validation successful');
    return true;
  } catch (error) {
    console.error('Chain validation failed:', error.message);
    
    // Cache the failure
    connectionCache.set(cacheKey, {
      valid: false,
      timestamp: Date.now(),
      error: error.message
    });
    
    // Notify user of connection error
    notifyConnectionError(chain.name, error.message);
    
    return false;
  }
}

// Notify user of connection errors via notification
async function notifyConnectionError(chainName, errorMessage) {
  try {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('src/icons/icon-48.svg'),
      title: 'Proxy Chain Error',
      message: `Failed to connect using chain "${chainName}": ${errorMessage}`,
      contextMessage: 'Requests will use direct connection',
      priority: 2
    });
    console.log('Error notification sent');
  } catch (error) {
    console.error('Failed to create notification:', error);
  }
}

// Proxy request listener
chrome.proxy.onRequest.addListener(async (requestInfo) => {
  console.log('Proxy request intercepted:', requestInfo);
  
  // Check if request should be proxied based on protocol
  if (!shouldProxyRequest(requestInfo.url)) {
    console.log('Request protocol not supported for proxying');
    return { type: 'direct' };
  }
  
  // Check if proxy is enabled and we have an active chain
  if (!currentProxyState.enabled || !currentProxyState.activeChain) {
    console.log('Proxy disabled or no active chain, using direct connection');
    return { type: 'direct' };
  }
  
  try {
    const chain = currentProxyState.activeChain;
    console.log('Using proxy chain:', chain.name);
    
    // Extract target host and port from request URL
    const hostPortInfo = extractHostPort(requestInfo.url);
    if (!hostPortInfo) {
      console.error('Failed to extract host and port from URL');
      return { type: 'direct' };
    }
    
    const { host, port } = hostPortInfo;
    
    // Validate chain connection (with caching to avoid excessive validation)
    const isValid = await validateChainConnection(chain, host, port);
    
    if (!isValid) {
      console.error('Chain validation failed, blocking request to prevent IP leak');
      // Return a non-functional proxy config to block the request
      // Firefox will fail to connect and won't leak the real IP
      return {
        type: 'socks5',
        host: 'localhost',
        port: 1
      };
    }
    
    // Chain validation passed, configure Firefox to use the first proxy
    const firstProxy = chain.proxies[0];
    
    if (!firstProxy) {
      console.error('No first proxy found in chain');
      return { type: 'direct' };
    }
    
    console.log(`Configuring Firefox to use first proxy: ${firstProxy.address}:${firstProxy.port}`);
    
    // Build proxy config for Firefox
    const proxyConfig = {
      type: firstProxy.type.toLowerCase(),
      host: firstProxy.address,
      port: firstProxy.port
    };
    
    // Add authentication if provided
    if (firstProxy.username && firstProxy.password) {
      proxyConfig.username = firstProxy.username;
      proxyConfig.password = firstProxy.password;
    }
    
    console.log('Proxy configuration returned:', proxyConfig);
    return proxyConfig;
    
  } catch (error) {
    console.error('Error in proxy request handler:', error);
    notifyConnectionError(currentProxyState.activeChain.name, error.message);
    
    // On error, block request to prevent IP leak
    return {
      type: 'socks5',
      host: 'localhost',
      port: 1
    };
  }
});

// Handle messages from popup and options
chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  console.log('Message received:', message);
  
  try {
    switch (message.action) {
      case 'toggleProxy':
        await handleToggleProxy(message.enabled);
        sendResponse({ success: true });
        break;
        
      case 'setActiveChain':
        await handleSetActiveChain(message.chainId);
        sendResponse({ success: true });
        break;
        
      case 'testConnection':
        const result = await handleTestConnection(message.chainId);
        sendResponse(result);
        break;
        
      default:
        console.warn('Unknown message action:', message.action);
        sendResponse({ success: false, error: 'Unknown action' });
    }
  } catch (error) {
    console.error('Error handling message:', error);
    sendResponse({ success: false, error: error.message });
  }
  
  // Return true to indicate async response
  return true;
});

// Handle proxy toggle
async function handleToggleProxy(enabled) {
  console.log('Toggling proxy to:', enabled);
  
  try {
    await setExtensionEnabled(enabled);
    // State will be updated via storage listener
    console.log('Proxy toggled successfully');
  } catch (error) {
    console.error('Failed to toggle proxy:', error);
    throw error;
  }
}

// Handle active chain change
async function handleSetActiveChain(chainId) {
  console.log('Setting active chain to:', chainId);
  
  try {
    if (chainId === null) {
      await setActiveChain(null);
    } else {
      await setActiveChain(chainId);
    }
    // State will be updated via storage listener
    console.log('Active chain set successfully');
  } catch (error) {
    console.error('Failed to set active chain:', error);
    throw error;
  }
}

// Handle connection test
async function handleTestConnection(chainId) {
  console.log('Testing connection for chain:', chainId);
  
  try {
    if (!chainId) {
      return { success: false, error: 'No chain selected' };
    }
    
    const chains = await loadChains();
    const chain = chains.find(c => c.id === chainId);
    
    if (!chain) {
      return { success: false, error: 'Chain not found' };
    }
    
    // Test connection using chain engine
    console.log('Testing connection through chain:', chain.name);
    
    // Use a common test target (like Google DNS)
    const testTarget = '8.8.8.8';
    const testPort = 53;
    
    const connectionResult = await proxyChainEngine.buildChain(chain, testTarget, testPort);
    
    // Test successful, clean up connection
    if (connectionResult.socket) {
      connectionResult.socket.close();
    }
    
    return { 
      success: true, 
      connectionInfo: connectionResult.connectionInfo,
      message: `Successfully connected to ${testTarget}:${testPort} through ${chain.proxies.length} proxy(ies)`
    };
    
  } catch (error) {
    console.error('Connection test failed:', error);
    return { success: false, error: error.message };
  }
}
