# Proxy Chain Engine Implementation

This document describes the core proxy chain engine implementation for the Firefox WebExtension.

## Overview

The Proxy Chain Engine provides the ability to route traffic through multiple proxy servers in sequence, supporting different proxy protocols (SOCKS4, SOCKS5, HTTP CONNECT) at each hop.

## Architecture

### Core Components

1. **ProxyChainEngine** (`src/chainEngine.js`)
   - Main orchestration class
   - Manages sequential proxy connections
   - Handles timeouts, retries, and error recovery
   - Provides logging and statistics

2. **Protocol Handlers**
   - **SOCKS5Protocol** (`src/socks5.js`) - RFC 1928/1929 implementation
   - **SOCKS4Protocol** (`src/socks4.js`) - SOCKS4/SOCKS4a implementation  
   - **HttpConnectProtocol** (`src/httpConnect.js`) - HTTP CONNECT method

3. **Socket Abstraction** (`src/socket.js`)
   - Unified socket interface for WebExtensions
   - Supports Chrome and Firefox TCP socket APIs
   - WebSocket fallback for development

4. **Background Integration** (`src/background/background.js`)
   - Firefox proxy API integration
   - Connection testing functionality
   - Chain engine lifecycle management

## Usage

### Basic Chain Connection

```javascript
import { ProxyChainEngine } from './chainEngine.js';

const engine = new ProxyChainEngine({
  connectionTimeout: 30000,
  totalTimeout: 120000,
  enableLogging: true,
  maxRetries: 2
});

const chain = {
  id: 'chain-1',
  name: 'My Proxy Chain',
  proxies: [
    { address: 'proxy1.example.com', port: 1080, type: 'socks5' },
    { address: 'proxy2.example.com', port: 1081, type: 'socks4' },
    { address: 'proxy3.example.com', port: 8080, type: 'http' }
  ]
};

try {
  const result = await engine.buildChain(chain, 'target.example.com', 443);
  console.log('Connected successfully:', result);
  
  // Use the connected socket for data transfer
  const socket = result.socket;
  
  // Clean up when done
  socket.close();
} catch (error) {
  console.error('Chain connection failed:', error.message);
}
```

### Connection Testing

The background script provides connection testing through the runtime messaging API:

```javascript
chrome.runtime.sendMessage({
  action: 'testConnection',
  chainId: 'chain-1'
}, response => {
  if (response.success) {
    console.log('Connection test passed:', response.message);
    console.log('Connection info:', response.connectionInfo);
  } else {
    console.error('Connection test failed:', response.error);
  }
});
```

## Connection Flow

1. **Direct Connection**: Connect directly to the first proxy in the chain
2. **Protocol Handshake**: Perform the appropriate protocol handshake (SOCKS4/5, HTTP CONNECT)
3. **Chain Navigation**: Request each proxy to connect to the next proxy in the chain
4. **Final Connection**: Request the last proxy to connect to the target destination
5. **Data Transfer**: Establish bidirectional data flow through the complete chain

## Error Handling

The engine provides comprehensive error handling:

- **Per-step errors**: Detailed context about which proxy failed and why
- **Connection cleanup**: Automatic cleanup of partial connections on failure
- **Retry logic**: Configurable retry attempts with exponential backoff
- **Timeout protection**: Per-step and total operation timeouts
- **Detailed logging**: Timestamped connection steps for debugging

## Configuration Options

| Option | Default | Description |
|--------|---------|-------------|
| `connectionTimeout` | 30000ms | Timeout per connection step |
| `totalTimeout` | 120000ms | Total timeout for entire chain |
| `enableLogging` | true | Enable debug logging |
| `maxRetries` | 2 | Maximum retry attempts per connection |

## Protocol Support

### SOCKS5
- Full IPv4, IPv6, and domain name support
- Username/password authentication (RFC 1929)
- All RFC 1928 response codes with descriptive errors

### SOCKS4
- IPv4 address support
- SOCKS4a hostname resolution extension
- User ID authentication
- Complete response code validation

### HTTP CONNECT
- Basic authentication support
- HTTP/1.1 protocol compliance
- Header parsing and validation
- Keep-alive connection support

## Browser Compatibility

- **Firefox**: Full support with TCP socket API
- **Chrome**: Full support with TCP socket API
- **Development**: WebSocket fallback for testing

## Security Considerations

1. **Authentication**: Credentials are handled securely and only sent to the intended proxy
2. **Data Protection**: All data flows through the encrypted proxy chain as configured
3. **Error Information**: Sensitive connection details are not exposed in error messages
4. **Connection Cleanup**: Partial connections are always cleaned up on failure

## Performance Features

- **Connection Pooling**: Active connections are tracked and managed
- **Timeout Optimization**: Configurable timeouts prevent hanging connections
- **Retry Logic**: Intelligent retry with exponential backoff
- **Memory Management**: Proper cleanup of socket resources

## Testing

Run the test suite to verify functionality:

```bash
# Load the extension in Firefox/Chrome
# Open browser console and run:
import('./src/test/chainEngine.test.js').then(module => {
  module.runTests();
});
```

## Integration Notes

### Firefox Proxy API Limitations

Firefox's proxy API only allows configuring the first proxy hop. The chain engine handles the remaining hops through direct socket connections, creating a complete proxy tunnel.

### Extension Permissions

The extension requires:
- `proxy` - For Firefox proxy configuration
- `storage` - For chain configuration persistence
- `sockets.tcp` (optional) - For direct TCP connections

## Future Enhancements

1. **Connection Pooling**: Reuse established connections for better performance
2. **Load Balancing**: Multiple proxy servers per hop with automatic failover
3. **Protocol Detection**: Automatic proxy type detection and configuration
4. **Advanced Authentication**: Support for more authentication methods
5. **Performance Monitoring**: Detailed metrics and analytics

## Troubleshooting

### Common Issues

1. **"WebSocket not available"**: Expected in Node.js testing environments
2. **"Permission denied"**: Check that `sockets.tcp` permission is granted
3. **"Connection timeout"**: Verify proxy server availability and network connectivity
4. **"Authentication failed"**: Check proxy credentials and authentication method

### Debug Logging

Enable detailed logging by setting `enableLogging: true` in the engine configuration:

```javascript
const engine = new ProxyChainEngine({
  enableLogging: true  // Shows detailed connection steps
});
```