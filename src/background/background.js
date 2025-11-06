// Background service worker for Firefox WebExtension

import { 
  initializeStorage, 
  getActiveChain, 
  isExtensionEnabled,
  loadChains 
} from '../storage.js';

import { ProxyChainEngine } from '../chainEngine.js';

let currentProxyState = {
  enabled: false,
  activeChainId: null,
  activeChain: null
};

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

// Update proxy settings based on current state
function updateProxySettings() {
  if (currentProxyState.enabled && currentProxyState.activeChain) {
    console.log('Proxy enabled for chain:', currentProxyState.activeChain.name);
    console.log('Chain contains', currentProxyState.activeChain.proxies.length, 'proxy(ies)');
    
    // The actual proxy configuration is handled by chrome.proxy.onRequest listener
    // which will use the first proxy in the chain for Firefox proxy API integration
  } else {
    console.log('Proxy disabled or no active chain');
  }
}

// Proxy request listener
chrome.proxy.onRequest.addListener(async (requestInfo) => {
  console.log('Proxy request intercepted:', requestInfo);
  
  // Check if proxy is enabled and we have an active chain
  if (currentProxyState.enabled && currentProxyState.activeChain) {
    try {
      console.log('Using proxy chain:', currentProxyState.activeChain.name);
      
      // For Firefox proxy API, we can only configure the first hop
      // The chain engine handles the rest through socket connections
      const firstProxy = currentProxyState.activeChain.proxies[0];
      
      if (firstProxy) {
        console.log(`Configuring Firefox to use first proxy: ${firstProxy.address}:${firstProxy.port}`);
        
        // Configure Firefox to use the first proxy in the chain
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
        
        return proxyConfig;
      }
    } catch (error) {
      console.error('Error configuring proxy:', error);
    }
  }
  
  // No proxy configured, use direct connection
  return {
    type: "direct"
  };
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
  currentProxyState.enabled = enabled;
  
  if (!enabled) {
    // When disabling, keep chain selection but disable proxy
    updateProxySettings();
  } else {
    // When enabling, apply current chain selection
    updateProxySettings();
  }
}

// Handle active chain change
async function handleSetActiveChain(chainId) {
  console.log('Setting active chain to:', chainId);
  currentProxyState.activeChainId = chainId;
  
  if (chainId) {
    try {
      currentProxyState.activeChain = await getActiveChain();
    } catch (error) {
      console.error('Failed to load active chain:', error);
      currentProxyState.activeChain = null;
    }
  } else {
    currentProxyState.activeChain = null;
  }
  
  updateProxySettings();
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
