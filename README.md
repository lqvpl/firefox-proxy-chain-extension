# Firefox WebExtension

A Firefox WebExtension with proxy capabilities built using Manifest V3.

## Project Structure

```
├── manifest.json              # Extension manifest (Manifest V3)
├── package.json               # Node.js package configuration
├── .gitignore                 # Git ignore file
├── README.md                  # This file
└── src/
    ├── background/
    │   └── background.js      # Service worker background script
    ├── popup/
    │   ├── popup.html         # Popup interface
    │   ├── popup.css          # Popup styles
    │   └── popup.js           # Popup functionality
    ├── options/
    │   ├── options.html       # Options page
    │   ├── options.css        # Options styles
    │   └── options.js         # Options functionality
    └── icons/
        ├── icon-16.svg        # 16x16 icon
        ├── icon-32.svg        # 32x32 icon
        ├── icon-48.svg        # 48x48 icon
        └── icon-128.svg       # 128x128 icon
```

## Features

- **Proxy Support**: Configure and manage proxy settings
- **Persistent Background**: Service worker for background tasks
- **Popup Interface**: Quick access to proxy controls
- **Options Page**: Detailed configuration settings
- **Notifications**: System notifications for connection status
- **Storage**: Persistent settings storage

## Permissions

The extension requests the following permissions:

- `proxy`: Required for proxy configuration
- `storage`: Required for saving settings
- `notifications`: Required for system notifications
- `<all_urls>`: Required for proxy functionality

## Installation

### Development

1. Clone this repository
2. Open Firefox and navigate to `about:debugging`
3. Click "This Firefox"
4. Click "Load Temporary Add-on"
5. Select the `manifest.json` file from this project

### Production

Build the extension and package it as an `.xpi` file for distribution through the Firefox Add-ons store.

## Development

### Testing

To test the extension:

1. Load the extension in Firefox using the development installation steps
2. Click the extension icon to open the popup
3. Configure proxy settings in the options page
4. Test proxy functionality

### Building

Currently, no build process is configured. The extension can be loaded directly from the source files.

## Manifest V3

This extension uses Manifest V3, which includes:

- Service worker background scripts
- Updated permission model
- Modern API usage
- Improved security and performance

## Browser Compatibility

- **Firefox**: Full support (primary target)
- **Chrome**: Partial support (may need adaptation for Chrome-specific APIs)
- **Edge**: Partial support (Chromium-based)

## License

MIT License - see LICENSE file for details.