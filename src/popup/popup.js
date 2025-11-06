// Popup script for Firefox WebExtension
import { 
  loadChains, 
  getActiveChain, 
  setActiveChain,
  isExtensionEnabled, 
  setExtensionEnabled 
} from '../storage.js';

document.addEventListener('DOMContentLoaded', async function() {
  const proxyToggle = document.getElementById('proxyToggle');
  const chainSelect = document.getElementById('chainSelect');
  const statusText = document.getElementById('statusText');
  const optionsButton = document.getElementById('optionsButton');
  const testButton = document.getElementById('testButton');

  let chains = [];
  let currentSettings = { enabled: false, activeChainId: null };

  try {
    // Load initial state
    await loadInitialState();
    
    // Setup event listeners
    setupEventListeners();
    
  } catch (error) {
    console.error('Failed to initialize popup:', error);
    showError('Failed to load extension state');
  }

  /**
   * Load initial state from storage
   */
  async function loadInitialState() {
    try {
      // Load chains
      chains = await loadChains();
      
      // Load current settings
      currentSettings.enabled = await isExtensionEnabled();
      const activeChain = await getActiveChain();
      currentSettings.activeChainId = activeChain ? activeChain.id : null;

      // Update UI
      updateChainDropdown();
      updateToggleState();
      updateStatus();
      
    } catch (error) {
      console.error('Failed to load initial state:', error);
      throw error;
    }
  }

  /**
   * Setup all event listeners
   */
  function setupEventListeners() {
    // Proxy toggle handler
    proxyToggle.addEventListener('change', async function() {
      const enabled = proxyToggle.checked;
      
      try {
        await setExtensionEnabled(enabled);
        currentSettings.enabled = enabled;
        
        // Notify background script
        await sendMessage({ action: 'toggleProxy', enabled });
        
        updateStatus();
        
        // Enable/disable chain select based on toggle state
        chainSelect.disabled = !enabled || chains.length === 0;
        
      } catch (error) {
        console.error('Failed to toggle proxy:', error);
        proxyToggle.checked = !enabled; // Revert toggle
        showError('Failed to toggle proxy');
      }
    });

    // Chain selection handler
    chainSelect.addEventListener('change', async function() {
      const selectedChainId = chainSelect.value || null;
      
      try {
        await setActiveChain(selectedChainId);
        currentSettings.activeChainId = selectedChainId;
        
        // Notify background script
        await sendMessage({ 
          action: 'setActiveChain', 
          chainId: selectedChainId 
        });
        
        updateStatus();
        
      } catch (error) {
        console.error('Failed to set active chain:', error);
        // Revert selection
        chainSelect.value = currentSettings.activeChainId || '';
        showError('Failed to set active chain');
      }
    });

    // Options button handler
    optionsButton.addEventListener('click', function() {
      chrome.runtime.openOptionsPage();
    });

    // Test connection handler
    testButton.addEventListener('click', function() {
      testConnection();
    });
  }

  /**
   * Update chain dropdown with available chains
   */
  function updateChainDropdown() {
    // Clear existing options
    chainSelect.innerHTML = '';
    
    if (chains.length === 0) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No chains available';
      chainSelect.appendChild(option);
      chainSelect.disabled = true;
      return;
    }

    // Add default option
    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = 'Select a chain...';
    chainSelect.appendChild(defaultOption);

    // Add chain options
    chains.forEach(chain => {
      const option = document.createElement('option');
      option.value = chain.id;
      option.textContent = chain.name;
      chainSelect.appendChild(option);
    });

    // Set current selection
    chainSelect.value = currentSettings.activeChainId || '';
    
    // Enable/disable based on extension state
    chainSelect.disabled = !currentSettings.enabled;
  }

  /**
   * Update toggle state to match current settings
   */
  function updateToggleState() {
    proxyToggle.checked = currentSettings.enabled;
  }

  /**
   * Update status display
   */
  function updateStatus() {
    if (!currentSettings.enabled) {
      statusText.textContent = 'Inactive';
      statusText.className = 'status-inactive';
    } else if (!currentSettings.activeChainId) {
      statusText.textContent = 'Active: No chain selected';
      statusText.className = 'status-warning';
    } else {
      const activeChain = chains.find(c => c.id === currentSettings.activeChainId);
      if (activeChain) {
        statusText.textContent = `Active: ${activeChain.name}`;
        statusText.className = 'status-active';
      } else {
        statusText.textContent = 'Error: Selected chain not found';
        statusText.className = 'status-error';
      }
    }
  }

  /**
   * Send message to background script
   */
  async function sendMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    });
  }

  /**
   * Test proxy connection
   */
  async function testConnection() {
    if (!currentSettings.enabled || !currentSettings.activeChainId) {
      showError('Proxy is not active');
      return;
    }

    testButton.textContent = 'Testing...';
    testButton.disabled = true;

    try {
      // Send test request to background script
      const response = await sendMessage({ 
        action: 'testConnection',
        chainId: currentSettings.activeChainId 
      });

      if (response.success) {
        showNotification('Connection Test', 'Connection test completed successfully');
      } else {
        showNotification('Connection Test Failed', response.error || 'Unknown error');
      }
    } catch (error) {
      console.error('Connection test failed:', error);
      showNotification('Connection Test Failed', error.message);
    } finally {
      testButton.textContent = 'Test Connection';
      testButton.disabled = false;
    }
  }

  /**
   * Show error message in status
   */
  function showError(message) {
    statusText.textContent = `Error: ${message}`;
    statusText.className = 'status-error';
  }

  /**
   * Show notification
   */
  function showNotification(title, message) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: '../icons/icon-48.svg',
      title: title,
      message: message
    });
  }
});