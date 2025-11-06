/**
 * HTTP CONNECT Protocol Client Implementation
 * 
 * Implements HTTP CONNECT method for establishing TCP tunnels through HTTP proxies
 * Supports both HTTP and HTTPS proxies with Basic authentication
 */

/**
 * HTTP Status Codes for CONNECT method
 */
const HTTP_STATUS = {
  OK: 200,                    // Connection established
  BAD_REQUEST: 400,           // Bad request
  UNAUTHORIZED: 401,          // Proxy authentication required
  FORBIDDEN: 403,            // Request forbidden
  NOT_FOUND: 404,            // Host not found
  METHOD_NOT_ALLOWED: 405,   // Method not allowed
  PROXY_AUTH_REQUIRED: 407,  // Proxy authentication required
  REQUEST_TIMEOUT: 408,      // Request timeout
  INTERNAL_SERVER_ERROR: 500, // Internal server error
  BAD_GATEWAY: 502,          // Bad gateway
  SERVICE_UNAVAILABLE: 503,  // Service unavailable
  GATEWAY_TIMEOUT: 504       // Gateway timeout
};

/**
 * Maps HTTP status codes to error messages
 * @param {number} status - HTTP status code
 * @returns {string} Human-readable error message
 */
function getStatusError(status) {
  switch (status) {
    case HTTP_STATUS.OK:
      return 'Connection established';
    case HTTP_STATUS.BAD_REQUEST:
      return 'Bad request';
    case HTTP_STATUS.UNAUTHORIZED:
    case HTTP_STATUS.PROXY_AUTH_REQUIRED:
      return 'Proxy authentication required';
    case HTTP_STATUS.FORBIDDEN:
      return 'Request forbidden by proxy';
    case HTTP_STATUS.NOT_FOUND:
      return 'Target host not found';
    case HTTP_STATUS.METHOD_NOT_ALLOWED:
      return 'CONNECT method not allowed by proxy';
    case HTTP_STATUS.REQUEST_TIMEOUT:
      return 'Request timeout';
    case HTTP_STATUS.INTERNAL_SERVER_ERROR:
      return 'Proxy internal server error';
    case HTTP_STATUS.BAD_GATEWAY:
      return 'Bad gateway';
    case HTTP_STATUS.SERVICE_UNAVAILABLE:
      return 'Proxy service unavailable';
    case HTTP_STATUS.GATEWAY_TIMEOUT:
      return 'Gateway timeout';
    default:
      return `Unknown HTTP status: ${status}`;
  }
}

/**
 * Encode credentials for Basic authentication
 * @param {string} username - Username
 * @param {string} password - Password
 * @returns {string} Base64 encoded credentials
 */
function encodeBasicAuth(username, password) {
  const credentials = `${username}:${password}`;
  return btoa(credentials);
}

/**
 * Read a line from socket (until CRLF)
 * @param {Object} socket - Socket object
 * @returns {Promise<string>} Line without CRLF
 */
function readLine(socket) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    let foundCRLF = false;
    
    const onData = (data) => {
      const chunk = new TextDecoder().decode(data);
      buffer += chunk;
      
      // Check for CRLF
      const crlfIndex = buffer.indexOf('\r\n');
      if (crlfIndex !== -1) {
        foundCRLF = true;
        const line = buffer.substring(0, crlfIndex);
        socket.removeEventListener('data', onData);
        resolve(line);
      }
    };
    
    const onError = (error) => {
      socket.removeEventListener('data', onData);
      reject(new Error(`Socket read error: ${error}`));
    };
    
    socket.addEventListener('data', onData);
    socket.addEventListener('error', onError);
    
    // Timeout protection
    setTimeout(() => {
      if (!foundCRLF) {
        socket.removeEventListener('data', onData);
        socket.removeEventListener('error', onError);
        reject(new Error('Read line timeout'));
      }
    }, 30000);
  });
}

/**
 * Read all remaining data from socket until connection closes or timeout
 * @param {Object} socket - Socket object
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise<string>} Remaining data
 */
function readRemainingData(socket, timeout = 5000) {
  return new Promise((resolve, reject) => {
    let data = '';
    let timeoutId;
    
    const onData = (chunk) => {
      data += new TextDecoder().decode(chunk);
      // Reset timeout on data received
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      timeoutId = setTimeout(() => {
        socket.removeEventListener('data', onData);
        resolve(data);
      }, timeout);
    };
    
    const onClose = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      socket.removeEventListener('data', onData);
      resolve(data);
    };
    
    const onError = (error) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      socket.removeEventListener('data', onData);
      reject(new Error(`Socket read error: ${error}`));
    };
    
    socket.addEventListener('data', onData);
    socket.addEventListener('close', onClose);
    socket.addEventListener('error', onError);
    
    // Start initial timeout
    timeoutId = setTimeout(() => {
      socket.removeEventListener('data', onData);
      socket.removeEventListener('close', onClose);
      resolve(data);
    }, timeout);
  });
}

/**
 * Write data to socket
 * @param {Object} socket - Socket object
 * @param {string} data - Data to write
 * @returns {Promise<void>}
 */
function writeString(socket, data) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      socket.removeEventListener('error', onError);
      reject(new Error(`Socket write error: ${error}`));
    };
    
    socket.addEventListener('error', onError);
    
    try {
      const encoder = new TextEncoder();
      const bytes = encoder.encode(data);
      socket.write(bytes);
      socket.removeEventListener('error', onError);
      resolve();
    } catch (error) {
      socket.removeEventListener('error', onError);
      reject(error);
    }
  });
}

/**
 * HTTP CONNECT Protocol Client
 */
export class HttpConnectProtocol {
  constructor() {
    this.socket = null;
  }

  /**
   * Establish HTTP CONNECT tunnel to target
   * @param {string} address - Target address (hostname or IP)
   * @param {number} port - Target port (1-65535)
   * @param {Object} socket - Socket object for communication
   * @param {Object} [auth] - Authentication credentials
   * @param {string} [auth.username] - Username for Basic authentication
   * @param {string} [auth.password] - Password for Basic authentication
   * @returns {Promise<Object>} Connection information
   * @throws {Error} For any protocol violations or connection errors
   */
  async connect(address, port, socket, auth) {
    this.socket = socket;

    try {
      // Validate inputs
      if (!address || typeof address !== 'string') {
        throw new Error('Invalid target address');
      }
      
      if (!port || typeof port !== 'number' || port < 1 || port > 65535) {
        throw new Error('Invalid target port: must be 1-65535');
      }

      // Send HTTP CONNECT request
      const result = await this._sendConnectRequest(socket, address, port, auth);

      return result;
    } catch (error) {
      this.socket = null;
      throw error;
    }
  }

  /**
   * Send HTTP CONNECT request
   * @private
   */
  async _sendConnectRequest(socket, address, port, auth) {
    // Build CONNECT request
    const target = `${address}:${port}`;
    let request = `CONNECT ${target} HTTP/1.1\r\n`;
    request += `Host: ${target}\r\n`;
    
    // Add User-Agent header
    request += `User-Agent: ProxyChainClient/1.0\r\n`;
    
    // Add Basic authentication if provided
    if (auth && auth.username) {
      const authString = encodeBasicAuth(auth.username, auth.password || '');
      request += `Proxy-Authorization: Basic ${authString}\r\n`;
    }
    
    // Add other common headers
    request += `Proxy-Connection: Keep-Alive\r\n`;
    request += `Connection: Keep-Alive\r\n`;
    
    // End headers
    request += `\r\n`;

    // Send request
    await writeString(socket, request);

    // Read status line
    const statusLine = await readLine(socket);
    
    // Parse status line: "HTTP/1.x XXX status message"
    const statusMatch = statusLine.match(/^HTTP\/1\.[01] (\d{3}) (.*)$/);
    if (!statusMatch) {
      throw new Error(`Invalid HTTP response: ${statusLine}`);
    }

    const statusCode = parseInt(statusMatch[1], 10);
    const statusMessage = statusMatch[2];

    // Read headers until empty line
    const headers = {};
    while (true) {
      const line = await readLine(socket);
      if (line === '') {
        break; // Empty line indicates end of headers
      }
      
      const colonIndex = line.indexOf(':');
      if (colonIndex > 0) {
        const name = line.substring(0, colonIndex).trim().toLowerCase();
        const value = line.substring(colonIndex + 1).trim();
        headers[name] = value;
      }
    }

    // Check if connection was successful
    if (statusCode !== HTTP_STATUS.OK) {
      const errorMsg = getStatusError(statusCode);
      throw new Error(`HTTP CONNECT failed: ${errorMsg} (${statusCode} ${statusMessage})`);
    }

    // Read any remaining data (might be proxy greeting or error page)
    const remainingData = await readRemainingData(socket, 1000);
    
    return {
      address: address,
      port: port,
      statusCode,
      statusMessage,
      headers,
      remainingData
    };
  }
}

export default HttpConnectProtocol;