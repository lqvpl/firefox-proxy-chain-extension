/**
 * Core Proxy Chain Engine
 * 
 * Handles sequential connections through multiple proxies using different protocols.
 * Supports SOCKS4, SOCKS5, and HTTP CONNECT proxy chaining.
 */

import { SOCKS5Protocol } from './socks5.js';
import { SOCKS4Protocol } from './socks4.js';
import { HttpConnectProtocol } from './httpConnect.js';
import { TCPSocket } from './socket.js';

/**
 * Default configuration values
 */
const DEFAULT_CONFIG = {
  connectionTimeout: 30000, // 30 seconds per connection step
  totalTimeout: 120000,     // 2 minutes total for entire chain
  enableLogging: true,
  maxRetries: 2
};

/**
 * Proxy Chain Engine Class
 * Orchestrates connections through multiple proxy servers
 */
export class ProxyChainEngine {
  /**
   * Create a new proxy chain engine
   * @param {Object} config - Configuration options
   * @param {number} config.connectionTimeout - Timeout per connection step (ms)
   * @param {number} config.totalTimeout - Total timeout for entire chain (ms)
   * @param {boolean} config.enableLogging - Enable debug logging
   * @param {number} config.maxRetries - Maximum retry attempts per connection
   */
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.activeConnections = new Set();
  }

  /**
   * Build a proxy chain connection to target destination
   * @param {Object} chain - Proxy chain object with proxies array
   * @param {string} targetAddress - Target destination address
   * @param {number} targetPort - Target destination port
   * @returns {Promise<Object>} Connected socket and connection info
   * @throws {Error} If any step in the chain fails
   */
  async buildChain(chain, targetAddress, targetPort) {
    const startTime = Date.now();
    this.log(`Starting chain build: ${chain.name} -> ${targetAddress}:${targetPort}`);
    
    if (!chain || !chain.proxies || chain.proxies.length === 0) {
      throw new Error('Invalid chain: no proxies defined');
    }

    if (!targetAddress || !targetPort) {
      throw new Error('Invalid target: address and port required');
    }

    let currentSocket = null;
    let connectionInfo = {
      startTime,
      chainId: chain.id,
      chainName: chain.name,
      targetAddress,
      targetPort,
      steps: [],
      totalDuration: null
    };

    try {
      // Set total timeout for entire operation
      const totalTimeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Chain connection timeout after ${this.config.totalTimeout}ms`));
        }, this.config.totalTimeout);
      });

      const connectionPromise = this._buildChainInternal(chain, targetAddress, targetPort, connectionInfo);
      
      const result = await Promise.race([connectionPromise, totalTimeoutPromise]);
      
      connectionInfo.totalDuration = Date.now() - startTime;
      this.log(`Chain build completed successfully in ${connectionInfo.totalDuration}ms`);
      
      return {
        socket: result.socket,
        connectionInfo,
        bindAddress: result.bindAddress,
        bindPort: result.bindPort
      };

    } catch (error) {
      connectionInfo.totalDuration = Date.now() - startTime;
      connectionInfo.error = error.message;
      
      this.log(`Chain build failed after ${connectionInfo.totalDuration}ms: ${error.message}`);
      
      // Clean up any partial connections
      if (currentSocket) {
        this._cleanupSocket(currentSocket);
      }
      
      throw new Error(`Chain connection failed at step ${connectionInfo.steps.length}: ${error.message}`);
    }
  }

  /**
   * Internal chain building logic
   * @private
   */
  async _buildChainInternal(chain, targetAddress, targetPort, connectionInfo) {
    let currentSocket = null;
    
    try {
      // Connect to first proxy directly
      const firstProxy = chain.proxies[0];
      this.log(`Step 1: Connecting to first proxy ${firstProxy.address}:${firstProxy.port}`);
      
      currentSocket = await this._createDirectConnection(firstProxy);
      this.activeConnections.add(currentSocket);
      
      connectionInfo.steps.push({
        step: 1,
        type: 'direct',
        proxy: firstProxy,
        success: true,
        timestamp: Date.now()
      });

      // If only one proxy, connect directly to target
      if (chain.proxies.length === 1) {
        this.log(`Single proxy chain: connecting to target ${targetAddress}:${targetPort}`);
        const result = await this._connectThroughProxy(
          currentSocket, 
          firstProxy, 
          targetAddress, 
          targetPort
        );
        
        return {
          socket: currentSocket,
          bindAddress: result.address,
          bindPort: result.port
        };
      }

      // For multiple proxies, chain through them sequentially
      for (let i = 0; i < chain.proxies.length; i++) {
        const currentProxy = chain.proxies[i];
        
        if (i === chain.proxies.length - 1) {
          // Last proxy: connect to final target
          this.log(`Step ${i + 1}: Connecting through last proxy to target ${targetAddress}:${targetPort}`);
          
          const result = await this._connectThroughProxy(
            currentSocket,
            currentProxy,
            targetAddress,
            targetPort
          );
          
          connectionInfo.steps.push({
            step: i + 1,
            type: 'proxy_to_target',
            proxy: currentProxy,
            target: `${targetAddress}:${targetPort}`,
            success: true,
            timestamp: Date.now()
          });
          
          return {
            socket: currentSocket,
            bindAddress: result.address,
            bindPort: result.port
          };
          
        } else {
          // Intermediate proxy: connect to next proxy
          const nextProxy = chain.proxies[i + 1];
          this.log(`Step ${i + 1}: Connecting through proxy ${currentProxy.address}:${currentProxy.port} to next proxy ${nextProxy.address}:${nextProxy.port}`);
          
          await this._connectThroughProxy(
            currentSocket,
            currentProxy,
            nextProxy.address,
            nextProxy.port
          );
          
          connectionInfo.steps.push({
            step: i + 1,
            type: 'proxy_to_proxy',
            proxy: currentProxy,
            nextProxy: nextProxy.address + ':' + nextProxy.port,
            success: true,
            timestamp: Date.now()
          });
        }
      }

    } catch (error) {
      if (currentSocket) {
        this._cleanupSocket(currentSocket);
        this.activeConnections.delete(currentSocket);
      }
      throw error;
    }
  }

  /**
   * Create direct TCP connection to a proxy
   * @private
   */
  async _createDirectConnection(proxy) {
    const timeoutId = setTimeout(() => {
      // This will be handled by the socket's own timeout
    }, this.config.connectionTimeout);

    try {
      const socket = new TCPSocket(proxy.address, proxy.port);
      
      // Set up event listeners
      socket.addEventListener('opened', () => {
        clearTimeout(timeoutId);
        this.log(`Direct connection established to ${proxy.address}:${proxy.port}`);
      });

      socket.addEventListener('error', (error) => {
        clearTimeout(timeoutId);
        throw new Error(`Failed to connect to ${proxy.address}:${proxy.port}: ${error.message || error}`);
      });

      // Connect to the proxy
      await socket.connect();
      
      clearTimeout(timeoutId);
      return socket;
      
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  /**
   * Connect through a proxy to a target
   * @private
   */
  async _connectThroughProxy(socket, proxy, targetAddress, targetPort) {
    const protocolHandler = this._getProtocolHandler(proxy.type);
    
    let retryCount = 0;
    while (retryCount <= this.config.maxRetries) {
      try {
        const auth = (proxy.username && proxy.password) ? {
          username: proxy.username,
          password: proxy.password
        } : undefined;

        this.log(`Using ${proxy.type.toUpperCase()} protocol to connect to ${targetAddress}:${targetPort}`);
        
        const result = await protocolHandler.connect(targetAddress, targetPort, socket, auth);
        
        this.log(`${proxy.type.toUpperCase()} connection successful`);
        return result;
        
      } catch (error) {
        retryCount++;
        
        if (retryCount <= this.config.maxRetries) {
          this.log(`${proxy.type.toUpperCase()} connection failed, retrying (${retryCount}/${this.config.maxRetries}): ${error.message}`);
          await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
        } else {
          throw new Error(`${proxy.type.toUpperCase()} connection failed after ${this.config.maxRetries} retries: ${error.message}`);
        }
      }
    }
  }

  /**
   * Get appropriate protocol handler for proxy type
   * @private
   */
  _getProtocolHandler(proxyType) {
    switch (proxyType.toLowerCase()) {
      case 'socks5':
        return new SOCKS5Protocol();
      
      case 'socks4':
        return new SOCKS4Protocol();
      
      case 'http':
      case 'https':
        return new HttpConnectProtocol();
      
      default:
        throw new Error(`Unsupported proxy type: ${proxyType}`);
    }
  }

  /**
   * Clean up socket connection
   * @private
   */
  _cleanupSocket(socket) {
    try {
      if (socket && typeof socket.close === 'function') {
        socket.close();
        this.log('Socket closed during cleanup');
      }
    } catch (error) {
      this.log(`Error during socket cleanup: ${error.message}`);
    }
  }

  /**
   * Close all active connections
   */
  closeAllConnections() {
    this.log(`Closing ${this.activeConnections.size} active connections`);
    
    for (const socket of this.activeConnections) {
      this._cleanupSocket(socket);
    }
    
    this.activeConnections.clear();
  }

  /**
   * Logging helper
   * @private
   */
  log(message) {
    if (this.config.enableLogging) {
      console.log(`[ProxyChainEngine] ${new Date().toISOString()} - ${message}`);
    }
  }

  /**
   * Get connection statistics
   * @returns {Object} Current connection statistics
   */
  getStats() {
    return {
      activeConnections: this.activeConnections.size,
      config: this.config
    };
  }
}

export default ProxyChainEngine;