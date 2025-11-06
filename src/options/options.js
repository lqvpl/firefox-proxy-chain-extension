// Options page script for Firefox WebExtension

document.addEventListener('DOMContentLoaded', function() {
  const proxyType = document.getElementById('proxyType');
  const proxyHost = document.getElementById('proxyHost');
  const proxyPort = document.getElementById('proxyPort');
  const proxyUsername = document.getElementById('proxyUsername');
  const proxyPassword = document.getElementById('proxyPassword');
  const autoStart = document.getElementById('autoStart');
  const showNotifications = document.getElementById('showNotifications');
  const saveButton = document.getElementById('saveButton');
  const resetButton = document.getElementById('resetButton');
  const statusMessage = document.getElementById('statusMessage');

  // Load saved settings
  loadSettings();

  // Event listeners
  saveButton.addEventListener('click', saveSettings);
  resetButton.addEventListener('click', resetSettings);

  function loadSettings() {
    chrome.storage.local.get([
      'proxyType',
      'proxyHost',
      'proxyPort',
      'proxyUsername',
      'proxyPassword',
      'autoStart',
      'showNotifications'
    ], function(result) {
      proxyType.value = result.proxyType || 'http';
      proxyHost.value = result.proxyHost || '';
      proxyPort.value = result.proxyPort || '';
      proxyUsername.value = result.proxyUsername || '';
      proxyPassword.value = result.proxyPassword || '';
      autoStart.checked = result.autoStart || false;
      showNotifications.checked = result.showNotifications !== false; // Default to true
    });
  }

  function saveSettings() {
    const settings = {
      proxyType: proxyType.value,
      proxyHost: proxyHost.value.trim(),
      proxyPort: proxyPort.value,
      proxyUsername: proxyUsername.value.trim(),
      proxyPassword: proxyPassword.value,
      autoStart: autoStart.checked,
      showNotifications: showNotifications.checked
    };

    // Basic validation
    if (settings.proxyHost && !settings.proxyPort) {
      showMessage('Please specify a proxy port', 'error');
      return;
    }

    if (settings.proxyPort && !settings.proxyHost) {
      showMessage('Please specify a proxy host', 'error');
      return;
    }

    chrome.storage.local.set(settings, function() {
      showMessage('Settings saved successfully!', 'success');
      
      // Notify background script of settings change
      chrome.runtime.sendMessage({
        action: 'settingsUpdated',
        settings: settings
      });
    });
  }

  function resetSettings() {
    if (confirm('Are you sure you want to reset all settings to default values?')) {
      chrome.storage.local.remove([
        'proxyType',
        'proxyHost',
        'proxyPort',
        'proxyUsername',
        'proxyPassword',
        'autoStart',
        'showNotifications'
      ], function() {
        loadSettings();
        showMessage('Settings reset to default', 'success');
      });
    }
  }

  function showMessage(text, type) {
    statusMessage.textContent = text;
    statusMessage.className = `status-message ${type}`;
    statusMessage.style.display = 'block';

    // Hide message after 3 seconds
    setTimeout(() => {
      statusMessage.style.display = 'none';
    }, 3000);
  }

  // Validate port number input
  proxyPort.addEventListener('input', function() {
    const value = parseInt(this.value);
    if (value < 1 || value > 65535) {
      this.setCustomValidity('Port must be between 1 and 65535');
    } else {
      this.setCustomValidity('');
    }
  });
});