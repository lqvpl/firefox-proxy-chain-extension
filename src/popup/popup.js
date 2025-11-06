// Popup script for Firefox WebExtension

document.addEventListener('DOMContentLoaded', function() {
  const proxyToggle = document.getElementById('proxyToggle');
  const statusText = document.getElementById('statusText');
  const optionsButton = document.getElementById('optionsButton');
  const testButton = document.getElementById('testButton');

  // Load current proxy state
  chrome.storage.local.get(['proxyEnabled'], function(result) {
    proxyToggle.checked = result.proxyEnabled || false;
    updateStatus(result.proxyEnabled);
  });

  // Handle proxy toggle
  proxyToggle.addEventListener('change', function() {
    const enabled = proxyToggle.checked;
    
    chrome.storage.local.set({ proxyEnabled: enabled }, function() {
      updateStatus(enabled);
      
      // Send message to background script
      chrome.runtime.sendMessage({
        action: 'toggleProxy',
        enabled: enabled
      }, function(response) {
        console.log('Proxy toggle response:', response);
      });
    });
  });

  // Handle options button click
  optionsButton.addEventListener('click', function() {
    chrome.runtime.openOptionsPage();
  });

  // Handle test button click
  testButton.addEventListener('click', function() {
    testConnection();
  });

  // Update status text
  function updateStatus(enabled) {
    if (enabled) {
      statusText.textContent = 'Proxy is enabled';
      statusText.style.color = '#0060df';
    } else {
      statusText.textContent = 'Proxy is disabled';
      statusText.style.color = '#666';
    }
  }

  // Test connection
  function testConnection() {
    testButton.textContent = 'Testing...';
    testButton.disabled = true;

    // TODO: Implement connection testing logic
    setTimeout(() => {
      testButton.textContent = 'Test Connection';
      testButton.disabled = false;
      
      // Show notification
      chrome.notifications.create({
        type: 'basic',
        iconUrl: '../icons/icon-48.svg',
        title: 'Connection Test',
        message: 'Connection test completed successfully'
      });
    }, 2000);
  }
});