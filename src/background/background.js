// Background service worker for Firefox WebExtension

import { initializeStorage } from '../storage.js';

// Proxy request listener
chrome.proxy.onRequest.addListener((requestInfo) => {
  console.log('Proxy request intercepted:', requestInfo);
  
  // TODO: Implement proxy logic here
  // Return proxy configuration object
  return {
    type: "direct"
  };
});

// Handle extension installation
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('Extension installed:', details);
  
  try {
    await initializeStorage();
    console.log('Storage initialized successfully');
  } catch (error) {
    console.error('Failed to initialize storage:', error);
  }
});

// Handle messages from popup and options
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Message received:', message);
  
  // TODO: Handle different message types
  sendResponse({ success: true });
});
