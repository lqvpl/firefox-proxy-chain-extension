// Background service worker for Firefox WebExtension

import { 
  initializeStorage, 
  getActiveChain, 
  isExtensionEnabled,
  loadChains 
} from '../storage.js';

let currentProxyState = {
  enabled: false,
  activeChainId: null,
  activeChain: null
};

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
    console.log('Setting up proxy for chain:', currentProxyState.activeChain.name);
    // TODO: Implement actual proxy configuration
    // For now, we'll just log the intent
  } else {
    console.log('Proxy disabled or no active chain');
  }
}

// Proxy request listener
chrome.proxy.onRequest.addListener((requestInfo) => {
  console.log('Proxy request intercepted:', requestInfo);
  
  // Check if proxy is enabled and we have an active chain
  if (currentProxyState.enabled && currentProxyState.activeChain) {
    // TODO: Implement actual proxy logic using activeChain.proxies
    // For now, return direct connection
    console.log('Proxy would be used for:', requestInfo);
    return {
      type: "direct"
    };
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
    
    // TODO: Implement actual connection testing
    // For now, simulate a successful test
    console.log('Connection test for chain:', chain.name);
    
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    return { success: true };
    
  } catch (error) {
    console.error('Connection test failed:', error);
    return { success: false, error: error.message };
  }
}
