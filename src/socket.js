/**
 * Socket abstraction layer for WebExtensions
 * 
 * Provides a unified socket interface that works with different browser APIs
 * Currently implements a Chrome-compatible socket API that can be adapted for Firefox
 */

/**
 * Unified socket interface compatible with the protocol handlers
 */
export class TCPSocket {
  constructor(address, port) {
    this.address = address;
    this.port = port;
    this.connected = false;
    this.eventListeners = new Map();
    this._socketId = null;
  }

  /**
   * Open connection to the server
   * @returns {Promise<void>}
   */
  async connect() {
    try {
      // For WebExtensions, we need to use the appropriate socket API
      // This is a placeholder implementation that would need to be adapted
      // based on the actual browser API available
      
      if (typeof chrome !== 'undefined' && chrome.sockets && chrome.sockets.tcp) {
        // Chrome socket API
        await this._connectChrome();
      } else if (typeof browser !== 'undefined' && browser.sockets && browser.sockets.tcp) {
        // Firefox socket API  
        await this._connectFirefox();
      } else {
        // Fallback to WebSocket if TCP sockets not available
        await this._connectWebSocket();
      }
      
      this.connected = true;
      this._emit('opened');
      
    } catch (error) {
      this._emit('error', error);
      throw error;
    }
  }

  /**
   * Connect using Chrome TCP socket API
   * @private
   */
  async _connectChrome() {
    return new Promise((resolve, reject) => {
      const createInfo = {
        persistent: false,
        name: `proxy-${Date.now()}`
      };

      chrome.sockets.tcp.create(createInfo, (createResult) => {
        if (chrome.runtime.lastError) {
          reject(new Error(`Failed to create socket: ${chrome.runtime.lastError.message}`));
          return;
        }

        this._socketId = createResult.socketId;

        chrome.sockets.tcp.connect(
          this._socketId,
          this.address,
          this.port,
          (connectResult) => {
            if (chrome.runtime.lastError) {
              chrome.sockets.tcp.close(this._socketId);
              reject(new Error(`Failed to connect: ${chrome.runtime.lastError.message}`));
              return;
            }

            // Set up data receive handler
            chrome.sockets.tcp.onReceive.addListener((info) => {
              if (info.socketId === this._socketId) {
                this._emit('data', info.data);
              }
            });

            // Set up error handler
            chrome.sockets.tcp.onReceiveError.addListener((info) => {
              if (info.socketId === this._socketId) {
                this._emit('error', new Error(`Socket error: ${info.resultCode}`));
              }
            });

            resolve();
          }
        );
      });
    });
  }

  /**
   * Connect using Firefox TCP socket API
   * @private
   */
  async _connectFirefox() {
    return new Promise((resolve, reject) => {
      const createInfo = {
        persistent: false,
        name: `proxy-${Date.now()}`
      };

      browser.sockets.tcp.create(createInfo).then(createResult => {
        this._socketId = createResult.socketId;

        return browser.sockets.tcp.connect(
          this._socketId,
          this.address,
          this.port
        );
      }).then(() => {
        // Set up data receive handler
        browser.sockets.tcp.onReceive.addListener((info) => {
          if (info.socketId === this._socketId) {
            this._emit('data', info.data);
          }
        });

        // Set up error handler
        browser.sockets.tcp.onReceiveError.addListener((info) => {
          if (info.socketId === this._socketId) {
            this._emit('error', new Error(`Socket error: ${info.resultCode}`));
          }
        });

        resolve();
      }).catch(error => {
        reject(new Error(`Failed to connect: ${error.message}`));
      });
    });
  }

  /**
   * Connect using WebSocket as fallback
   * @private
   */
  async _connectWebSocket() {
    return new Promise((resolve, reject) => {
      // Check if WebSocket is available
      if (typeof WebSocket === 'undefined') {
        reject(new Error('WebSocket not available in this environment'));
        return;
      }
      
      // Note: This is a very basic WebSocket fallback
      // In practice, WebSocket connections to arbitrary TCP servers won't work
      // This is just for development/testing purposes
      
      const wsUrl = `ws://${this.address}:${this.port}`;
      this._webSocket = new WebSocket(wsUrl);

      this._webSocket.binaryType = 'arraybuffer';

      this._webSocket.onopen = () => {
        this.connected = true;
        this._emit('opened');
        resolve();
      };

      this._webSocket.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          this._emit('data', new Uint8Array(event.data));
        } else {
          // Convert string to bytes
          const encoder = new TextEncoder();
          this._emit('data', encoder.encode(event.data));
        }
      };

      this._webSocket.onerror = (error) => {
        this._emit('error', new Error(`WebSocket error: ${error}`));
        reject(error);
      };

      this._webSocket.onclose = () => {
        this.connected = false;
        this._emit('closed');
      };
    });
  }

  /**
   * Write data to the socket
   * @param {Uint8Array|string} data - Data to write
   * @returns {Promise<void>}
   */
  async write(data) {
    if (!this.connected) {
      throw new Error('Socket not connected');
    }

    try {
      if (this._webSocket) {
        // WebSocket fallback
        if (typeof data === 'string') {
          this._webSocket.send(data);
        } else {
          this._webSocket.send(data.buffer);
        }
      } else if (this._socketId !== null) {
        // TCP socket
        const socketAPI = chrome?.sockets?.tcp || browser?.sockets?.tcp;
        
        if (socketAPI) {
          return new Promise((resolve, reject) => {
            socketAPI.send(this._socketId, data, (sendResult) => {
              const lastError = chrome?.runtime?.lastError;
              if (lastError) {
                reject(new Error(`Send failed: ${lastError.message}`));
              } else if (sendResult.resultCode < 0) {
                reject(new Error(`Send failed: ${sendResult.resultCode}`));
              } else {
                resolve();
              }
            });
          });
        }
      }
    } catch (error) {
      this._emit('error', error);
      throw error;
    }
  }

  /**
   * Close the socket connection
   */
  close() {
    if (this.connected) {
      this.connected = false;
      
      if (this._webSocket) {
        this._webSocket.close();
        this._webSocket = null;
      } else if (this._socketId !== null) {
        const socketAPI = chrome?.sockets?.tcp || browser?.sockets?.tcp;
        if (socketAPI) {
          socketAPI.close(this._socketId);
        }
        this._socketId = null;
      }
      
      this._emit('closed');
    }
  }

  /**
   * Add event listener
   * @param {string} event - Event name ('data', 'error', 'opened', 'closed')
   * @param {Function} handler - Event handler function
   */
  addEventListener(event, handler) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event).push(handler);
  }

  /**
   * Remove event listener
   * @param {string} event - Event name
   * @param {Function} handler - Event handler function
   */
  removeEventListener(event, handler) {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      const index = listeners.indexOf(handler);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
  }

  /**
   * Emit event to all listeners
   * @private
   */
  _emit(event, ...args) {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.forEach(handler => {
        try {
          handler(...args);
        } catch (error) {
          console.error(`Error in ${event} event handler:`, error);
        }
      });
    }
  }

  /**
   * Check if socket is connected
   * @returns {boolean}
   */
  isConnected() {
    return this.connected;
  }

  /**
   * Get socket information
   * @returns {Object} Socket info
   */
  getInfo() {
    return {
      address: this.address,
      port: this.port,
      connected: this.connected,
      socketId: this._socketId,
      type: this._webSocket ? 'websocket' : 'tcp'
    };
  }
}

/**
 * Create a new TCP socket connection
 * @param {string} address - Remote address
 * @param {number} port - Remote port
 * @returns {Promise<TCPSocket>} Connected socket
 */
export async function createTCPSocket(address, port) {
  const socket = new TCPSocket(address, port);
  await socket.connect();
  return socket;
}

export default TCPSocket;