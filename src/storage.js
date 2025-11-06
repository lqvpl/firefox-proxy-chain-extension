/**
 * Storage module for managing proxy chains and extension settings
 * Handles all CRUD operations with browser storage and data validation
 */

// Storage keys
const STORAGE_KEYS = {
  CHAINS: 'proxyChains',
  SETTINGS: 'extensionSettings',
  SCHEMA_VERSION: 'storageSchemaVersion'
};

const CURRENT_SCHEMA_VERSION = 1;

/**
 * Data structure definitions for JSDoc type hints
 * 
 * @typedef {Object} Proxy
 * @property {string} address - Proxy server address (IP or hostname)
 * @property {number} port - Proxy server port
 * @property {string} type - Proxy type ('http', 'https', 'socks4', 'socks5')
 * @property {string} [username] - Optional username for authentication
 * @property {string} [password] - Optional password for authentication
 * 
 * @typedef {Object} ProxyChain
 * @property {string} id - Unique identifier for the chain
 * @property {string} name - Human-readable name for the chain
 * @property {Proxy[]} proxies - Array of proxy configurations
 * 
 * @typedef {Object} Settings
 * @property {boolean} enabled - Whether the extension is enabled globally
 * @property {string|null} activeChainId - ID of the currently active chain
 */

/**
 * Initialize storage with default values if needed
 * Handles schema migrations
 * @returns {Promise<void>}
 */
async function initializeStorage() {
  try {
    const { storageSchemaVersion } = await chrome.storage.local.get(STORAGE_KEYS.SCHEMA_VERSION);
    const currentVersion = storageSchemaVersion || 0;

    if (currentVersion < CURRENT_SCHEMA_VERSION) {
      await migrateStorage(currentVersion, CURRENT_SCHEMA_VERSION);
    }

    const { extensionSettings } = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
    if (!extensionSettings) {
      const defaultSettings = {
        enabled: false,
        activeChainId: null
      };
      await chrome.storage.local.set({
        [STORAGE_KEYS.SETTINGS]: defaultSettings
      });
    }

    const { proxyChains } = await chrome.storage.local.get(STORAGE_KEYS.CHAINS);
    if (!proxyChains) {
      await chrome.storage.local.set({
        [STORAGE_KEYS.CHAINS]: []
      });
    }

    await chrome.storage.local.set({
      [STORAGE_KEYS.SCHEMA_VERSION]: CURRENT_SCHEMA_VERSION
    });
  } catch (error) {
    console.error('Failed to initialize storage:', error);
    throw new Error(`Storage initialization failed: ${error.message}`);
  }
}

/**
 * Handle schema migrations for storage updates
 * @param {number} fromVersion - Current schema version
 * @param {number} toVersion - Target schema version
 * @returns {Promise<void>}
 */
async function migrateStorage(fromVersion, toVersion) {
  try {
    if (fromVersion < 1) {
      // Migration to version 1: Initialize default structure
      const data = await chrome.storage.local.get(null);
      
      // Migrate old proxyEnabled and proxySettings to new structure
      if (data.proxyEnabled !== undefined || data.proxySettings !== undefined) {
        const chains = data.proxyChains || [];
        const settings = {
          enabled: data.proxyEnabled || false,
          activeChainId: null
        };

        await chrome.storage.local.remove(['proxyEnabled', 'proxySettings']);
        await chrome.storage.local.set({
          [STORAGE_KEYS.CHAINS]: chains,
          [STORAGE_KEYS.SETTINGS]: settings
        });
      }
    }
  } catch (error) {
    console.error('Migration failed:', error);
    throw new Error(`Storage migration failed: ${error.message}`);
  }
}

/**
 * Validate proxy object structure
 * @param {Proxy} proxy - Proxy object to validate
 * @returns {boolean} True if valid
 * @throws {Error} If proxy is invalid
 */
function validateProxy(proxy) {
  if (!proxy || typeof proxy !== 'object') {
    throw new Error('Proxy must be an object');
  }

  if (typeof proxy.address !== 'string' || !proxy.address.trim()) {
    throw new Error('Proxy address must be a non-empty string');
  }

  if (!Number.isInteger(proxy.port) || proxy.port < 1 || proxy.port > 65535) {
    throw new Error('Proxy port must be an integer between 1 and 65535');
  }

  const validTypes = ['http', 'https', 'socks4', 'socks5'];
  if (typeof proxy.type !== 'string' || !validTypes.includes(proxy.type)) {
    throw new Error(`Proxy type must be one of: ${validTypes.join(', ')}`);
  }

  if (proxy.username !== undefined && typeof proxy.username !== 'string') {
    throw new Error('Proxy username must be a string');
  }

  if (proxy.password !== undefined && typeof proxy.password !== 'string') {
    throw new Error('Proxy password must be a string');
  }

  return true;
}

/**
 * Validate proxy chain structure
 * @param {ProxyChain} chain - Chain object to validate
 * @returns {boolean} True if valid
 * @throws {Error} If chain is invalid
 */
function validateChain(chain) {
  if (!chain || typeof chain !== 'object') {
    throw new Error('Chain must be an object');
  }

  if (typeof chain.id !== 'string' || !chain.id.trim()) {
    throw new Error('Chain id must be a non-empty string');
  }

  if (typeof chain.name !== 'string' || !chain.name.trim()) {
    throw new Error('Chain name must be a non-empty string');
  }

  if (!Array.isArray(chain.proxies)) {
    throw new Error('Chain proxies must be an array');
  }

  if (chain.proxies.length === 0) {
    throw new Error('Chain must contain at least one proxy');
  }

  for (const proxy of chain.proxies) {
    validateProxy(proxy);
  }

  return true;
}

/**
 * Load all proxy chains from storage
 * @returns {Promise<ProxyChain[]>} Array of proxy chains
 * @throws {Error} If storage read fails
 */
async function loadChains() {
  try {
    const { proxyChains } = await chrome.storage.local.get(STORAGE_KEYS.CHAINS);
    return proxyChains || [];
  } catch (error) {
    console.error('Failed to load chains:', error);
    throw new Error(`Failed to load proxy chains: ${error.message}`);
  }
}

/**
 * Save a new or updated proxy chain
 * @param {ProxyChain} chain - Chain to save
 * @returns {Promise<ProxyChain>} The saved chain
 * @throws {Error} If chain is invalid or storage write fails
 */
async function saveChain(chain) {
  try {
    validateChain(chain);

    const chains = await loadChains();
    const existingIndex = chains.findIndex(c => c.id === chain.id);

    if (existingIndex >= 0) {
      chains[existingIndex] = chain;
    } else {
      chains.push(chain);
    }

    await chrome.storage.local.set({
      [STORAGE_KEYS.CHAINS]: chains
    });

    return chain;
  } catch (error) {
    console.error('Failed to save chain:', error);
    throw new Error(`Failed to save chain: ${error.message}`);
  }
}

/**
 * Delete a proxy chain by ID
 * @param {string} chainId - ID of the chain to delete
 * @returns {Promise<boolean>} True if deleted, false if not found
 * @throws {Error} If storage operation fails
 */
async function deleteChain(chainId) {
  try {
    if (typeof chainId !== 'string' || !chainId.trim()) {
      throw new Error('Chain ID must be a non-empty string');
    }

    const chains = await loadChains();
    const filteredChains = chains.filter(c => c.id !== chainId);

    if (filteredChains.length === chains.length) {
      return false;
    }

    await chrome.storage.local.set({
      [STORAGE_KEYS.CHAINS]: filteredChains
    });

    // If deleted chain was active, clear active chain
    const settings = await getSettings();
    if (settings.activeChainId === chainId) {
      settings.activeChainId = null;
      await setSettings(settings);
    }

    return true;
  } catch (error) {
    console.error('Failed to delete chain:', error);
    throw new Error(`Failed to delete chain: ${error.message}`);
  }
}

/**
 * Find a chain by ID
 * @param {string} chainId - ID of the chain to find
 * @returns {Promise<ProxyChain|null>} The chain or null if not found
 * @throws {Error} If storage read fails
 */
async function findChainById(chainId) {
  try {
    if (typeof chainId !== 'string' || !chainId.trim()) {
      return null;
    }

    const chains = await loadChains();
    return chains.find(c => c.id === chainId) || null;
  } catch (error) {
    console.error('Failed to find chain:', error);
    throw new Error(`Failed to find chain: ${error.message}`);
  }
}

/**
 * Get extension settings
 * @returns {Promise<Settings>} Current settings
 * @throws {Error} If storage read fails
 */
async function getSettings() {
  try {
    const { extensionSettings } = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
    return extensionSettings || { enabled: false, activeChainId: null };
  } catch (error) {
    console.error('Failed to get settings:', error);
    throw new Error(`Failed to get settings: ${error.message}`);
  }
}

/**
 * Set extension settings
 * @param {Settings} settings - Settings to save
 * @returns {Promise<Settings>} The saved settings
 * @throws {Error} If settings are invalid or storage write fails
 */
async function setSettings(settings) {
  try {
    if (!settings || typeof settings !== 'object') {
      throw new Error('Settings must be an object');
    }

    if (typeof settings.enabled !== 'boolean') {
      throw new Error('Settings enabled must be a boolean');
    }

    if (settings.activeChainId !== null && (typeof settings.activeChainId !== 'string' || !settings.activeChainId.trim())) {
      throw new Error('Settings activeChainId must be a non-empty string or null');
    }

    // Validate that activeChainId exists if set
    if (settings.activeChainId) {
      const chain = await findChainById(settings.activeChainId);
      if (!chain) {
        throw new Error(`Chain with ID '${settings.activeChainId}' not found`);
      }
    }

    await chrome.storage.local.set({
      [STORAGE_KEYS.SETTINGS]: settings
    });

    return settings;
  } catch (error) {
    console.error('Failed to set settings:', error);
    throw new Error(`Failed to set settings: ${error.message}`);
  }
}

/**
 * Get the currently active proxy chain
 * @returns {Promise<ProxyChain|null>} The active chain or null if none set
 * @throws {Error} If storage read fails
 */
async function getActiveChain() {
  try {
    const settings = await getSettings();
    if (!settings.activeChainId) {
      return null;
    }

    return await findChainById(settings.activeChainId);
  } catch (error) {
    console.error('Failed to get active chain:', error);
    throw new Error(`Failed to get active chain: ${error.message}`);
  }
}

/**
 * Set the currently active proxy chain
 * @param {string|null} chainId - ID of the chain to activate, or null to deactivate
 * @returns {Promise<ProxyChain|null>} The activated chain or null
 * @throws {Error} If chain not found or storage write fails
 */
async function setActiveChain(chainId) {
  try {
    if (chainId === null) {
      const settings = await getSettings();
      settings.activeChainId = null;
      await setSettings(settings);
      return null;
    }

    if (typeof chainId !== 'string' || !chainId.trim()) {
      throw new Error('Chain ID must be a non-empty string or null');
    }

    const chain = await findChainById(chainId);
    if (!chain) {
      throw new Error(`Chain with ID '${chainId}' not found`);
    }

    const settings = await getSettings();
    settings.activeChainId = chainId;
    await setSettings(settings);

    return chain;
  } catch (error) {
    console.error('Failed to set active chain:', error);
    throw new Error(`Failed to set active chain: ${error.message}`);
  }
}

/**
 * Check if the extension is globally enabled
 * @returns {Promise<boolean>} True if enabled
 * @throws {Error} If storage read fails
 */
async function isExtensionEnabled() {
  try {
    const settings = await getSettings();
    return settings.enabled;
  } catch (error) {
    console.error('Failed to check if extension is enabled:', error);
    throw new Error(`Failed to check extension status: ${error.message}`);
  }
}

/**
 * Set the global on/off state of the extension
 * @param {boolean} enabled - Whether to enable or disable the extension
 * @returns {Promise<boolean>} The new enabled state
 * @throws {Error} If settings are invalid or storage write fails
 */
async function setExtensionEnabled(enabled) {
  try {
    if (typeof enabled !== 'boolean') {
      throw new Error('Enabled state must be a boolean');
    }

    const settings = await getSettings();
    settings.enabled = enabled;
    const updated = await setSettings(settings);

    return updated.enabled;
  } catch (error) {
    console.error('Failed to set extension enabled state:', error);
    throw new Error(`Failed to set extension state: ${error.message}`);
  }
}

// Export storage module API
export {
  // Initialization
  initializeStorage,
  // Chain operations
  loadChains,
  saveChain,
  deleteChain,
  findChainById,
  // Settings operations
  getSettings,
  setSettings,
  // Active chain operations
  getActiveChain,
  setActiveChain,
  // Extension state operations
  isExtensionEnabled,
  setExtensionEnabled,
  // Validation helpers
  validateProxy,
  validateChain
};
