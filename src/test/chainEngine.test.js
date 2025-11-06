/**
 * Test script for Proxy Chain Engine
 * 
 * This script demonstrates how to use the ProxyChainEngine class
 * and can be used for manual testing during development
 */

import { ProxyChainEngine } from '../chainEngine.js';

/**
 * Test proxy chain configurations
 */
const testChains = {
  singleSocks5: {
    id: 'test-1',
    name: 'Single SOCKS5 Proxy',
    proxies: [
      {
        address: '127.0.0.1',
        port: 1080,
        type: 'socks5',
        username: 'testuser',
        password: 'testpass'
      }
    ]
  },
  
  multiProxy: {
    id: 'test-2', 
    name: 'Multi-Proxy Chain',
    proxies: [
      {
        address: '127.0.0.1',
        port: 1080,
        type: 'socks5',
        username: 'user1',
        password: 'pass1'
      },
      {
        address: '127.0.0.1',
        port: 1081,
        type: 'socks4'
      },
      {
        address: '127.0.0.1',
        port: 8080,
        type: 'http',
        username: 'httpuser',
        password: 'httppass'
      }
    ]
  }
};

/**
 * Test the proxy chain engine
 */
async function testChainEngine() {
  console.log('=== Testing Proxy Chain Engine ===');
  
  const engine = new ProxyChainEngine({
    connectionTimeout: 10000,
    totalTimeout: 30000,
    enableLogging: true,
    maxRetries: 1
  });

  for (const [chainName, chain] of Object.entries(testChains)) {
    console.log(`\n--- Testing ${chainName} ---`);
    
    try {
      console.log(`Building chain: ${chain.name}`);
      console.log(`Target: google.com:443`);
      
      const result = await engine.buildChain(chain, 'google.com', 443);
      
      console.log('✅ Chain built successfully!');
      console.log('Connection info:', result.connectionInfo);
      console.log('Bind address:', result.bindAddress);
      console.log('Bind port:', result.bindPort);
      
      // Clean up
      if (result.socket) {
        result.socket.close();
        console.log('Socket closed');
      }
      
    } catch (error) {
      console.error('❌ Chain test failed:', error.message);
      console.log('This is expected if no proxy servers are running');
    }
  }

  // Test engine statistics
  console.log('\n--- Engine Statistics ---');
  console.log(engine.getStats());
  
  // Clean up all connections
  engine.closeAllConnections();
  console.log('All connections closed');
}

/**
 * Test individual protocol handlers
 */
async function testProtocolHandlers() {
  console.log('\n=== Testing Protocol Handlers ===');
  
  // Import protocol handlers
  const { SOCKS5Protocol } = await import('../socks5.js');
  const { SOCKS4Protocol } = await import('../socks4.js');
  const { HttpConnectProtocol } = await import('../httpConnect.js');
  
  const protocols = {
    'SOCKS5': new SOCKS5Protocol(),
    'SOCKS4': new SOCKS4Protocol(),
    'HTTP CONNECT': new HttpConnectProtocol()
  };
  
  for (const [name, protocol] of Object.entries(protocols)) {
    console.log(`\n--- Testing ${name} Protocol ---`);
    
    // Create a mock socket for testing
    const mockSocket = {
      data: null,
      writtenData: [],
      
      addEventListener(event, handler) {
        if (event === 'data') {
          this.dataHandler = handler;
        } else if (event === 'error') {
          this.errorHandler = handler;
        }
      },
      
      write(data) {
        this.writtenData.push(data);
      },
      
      close() {
        // Mock close
      },
      
      // Helper for testing
      _receiveData(data) {
        if (this.dataHandler) {
          this.dataHandler(data);
        }
      },
      
      _error(error) {
        if (this.errorHandler) {
          this.errorHandler(error);
        }
      }
    };
    
    try {
      console.log(`${name} protocol handler created successfully`);
      console.log('Protocol instance:', protocol.constructor.name);
      
      // Note: We can't actually test connections without real proxy servers
      // But we can verify the protocol handlers are properly instantiated
      
    } catch (error) {
      console.error(`❌ ${name} protocol test failed:`, error.message);
    }
  }
}

/**
 * Run all tests
 */
async function runTests() {
  try {
    await testChainEngine();
    await testProtocolHandlers();
    console.log('\n=== Test completed ===');
  } catch (error) {
    console.error('Test suite failed:', error);
  }
}

// Export for use in other modules
export { testChainEngine, testProtocolHandlers, runTests };

// Run tests if this script is executed directly
if (typeof window === 'undefined' && typeof global !== 'undefined') {
  // Node.js environment
  runTests().catch(console.error);
}