/**
 * SOCKS4 Protocol Client Implementation
 * 
 * Implements SOCKS4 protocol (RFC 1928 predecessor) for proxy connections
 * Supports basic SOCKS4 and SOCKS4a (with hostname resolution)
 */

/**
 * SOCKS4 Protocol Constants
 */
const SOCKS4_VERSION = 0x04;
const SOCKS4_COMMAND_CONNECT = 0x01;

// Response codes
const SOCKS4_RESPONSE = {
  GRANTED: 0x5A,           // Request granted
  REJECTED: 0x5B,          // Request rejected or failed
  FAILED_IDENTD: 0x5C,     // Request failed because client is not running identd
  FAILED_USERID: 0x5D      // Request failed because client's identd could not confirm the user ID
};

/**
 * Maps response codes to error messages
 * @param {number} code - Response code from SOCKS4 server
 * @returns {string} Human-readable error message
 */
function getResponseError(code) {
  switch (code) {
    case SOCKS4_RESPONSE.GRANTED:
      return 'Success';
    case SOCKS4_RESPONSE.REJECTED:
      return 'Request rejected or failed';
    case SOCKS4_RESPONSE.FAILED_IDENTD:
      return 'Request failed - client not running identd';
    case SOCKS4_RESPONSE.FAILED_USERID:
      return 'Request failed - identd could not confirm user ID';
    default:
      return `Unknown response code: 0x${code.toString(16)}`;
  }
}

/**
 * Check if address is IPv4
 * @param {string} address - Address to check
 * @returns {boolean} True if address is IPv4
 */
function isIPv4(address) {
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (!ipv4Regex.test(address)) return false;
  
  const parts = address.split('.');
  return parts.every(part => {
    const num = parseInt(part, 10);
    return num >= 0 && num <= 255;
  });
}

/**
 * Convert IPv4 address to 4-byte array
 * @param {string} ipv4 - IPv4 address string
 * @returns {Uint8Array} 4-byte representation
 */
function ipv4ToBytes(ipv4) {
  const parts = ipv4.split('.');
  return new Uint8Array(parts.map(part => parseInt(part, 10)));
}

/**
 * Read exact number of bytes from socket
 * @param {Object} socket - Socket object
 * @param {number} length - Number of bytes to read
 * @returns {Promise<Uint8Array>} Read bytes
 */
function readBytes(socket, length) {
  return new Promise((resolve, reject) => {
    let buffer = new Uint8Array(length);
    let received = 0;
    
    const onData = (data) => {
      const chunk = new Uint8Array(data);
      const remaining = length - received;
      const toCopy = Math.min(chunk.length, remaining);
      
      buffer.set(chunk.subarray(0, toCopy), received);
      received += toCopy;
      
      if (received >= length) {
        socket.removeEventListener('data', onData);
        resolve(buffer);
      }
    };
    
    const onError = (error) => {
      socket.removeEventListener('data', onData);
      reject(new Error(`Socket read error: ${error}`));
    };
    
    socket.addEventListener('data', onData);
    socket.addEventListener('error', onError);
  });
}

/**
 * Write bytes to socket
 * @param {Object} socket - Socket object
 * @param {Uint8Array} data - Data to write
 * @returns {Promise<void>}
 */
function writeBytes(socket, data) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      socket.removeEventListener('error', onError);
      reject(new Error(`Socket write error: ${error}`));
    };
    
    socket.addEventListener('error', onError);
    
    try {
      socket.write(data);
      socket.removeEventListener('error', onError);
      resolve();
    } catch (error) {
      socket.removeEventListener('error', onError);
      reject(error);
    }
  });
}

/**
 * SOCKS4 Protocol Client
 */
export class SOCKS4Protocol {
  constructor() {
    this.socket = null;
  }

  /**
   * Establish SOCKS4 connection to target
   * @param {string} address - Target address (IPv4 or hostname for SOCKS4a)
   * @param {number} port - Target port (1-65535)
   * @param {Object} socket - Socket object for communication
   * @param {Object} [auth] - SOCKS4 auth (userid only)
   * @param {string} [auth.userid] - User ID for SOCKS4 identification
   * @returns {Promise<Object>} Bind address and port information
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

      // SOCKS4a support: if address is not IPv4, use SOCKS4a extension
      const isIPv4Addr = isIPv4(address);
      const isSOCKS4a = !isIPv4Addr;

      if (isSOCKS4a) {
        console.log(`Using SOCKS4a for hostname resolution: ${address}`);
      }

      // Send SOCKS4 connect request
      const result = await this._sendConnectRequest(socket, address, port, auth?.userid, isSOCKS4a);

      return result;
    } catch (error) {
      this.socket = null;
      throw error;
    }
  }

  /**
   * Send SOCKS4 CONNECT request
   * @private
   */
  async _sendConnectRequest(socket, address, port, userid = '', isSOCKS4a = false) {
    // Build SOCKS4 request packet
    const request = new Uint8Array(9); // Minimum size
    
    request[0] = SOCKS4_VERSION;           // SOCKS version
    request[1] = SOCKS4_COMMAND_CONNECT;   // Command: CONNECT
    request[2] = (port >> 8) & 0xFF;      // Port high byte
    request[3] = port & 0xFF;             // Port low byte

    if (isSOCKS4a) {
      // SOCKS4a: use special IP 0.0.0.x with x != 0
      request[4] = 0;
      request[5] = 0;
      request[6] = 0;
      request[7] = 1; // Indicates SOCKS4a
    } else {
      // SOCKS4: use actual IPv4 address
      const ipBytes = ipv4ToBytes(address);
      request.set(ipBytes, 4);
    }

    // Convert to array for concatenation
    let requestArray = Array.from(request);
    
    // Add userid (null-terminated)
    if (userid) {
      const useridBytes = new TextEncoder().encode(userid);
      requestArray = requestArray.concat(Array.from(useridBytes));
    }
    requestArray.push(0); // Null terminator

    if (isSOCKS4a) {
      // SOCKS4a: add hostname (null-terminated)
      const hostnameBytes = new TextEncoder().encode(address);
      requestArray = requestArray.concat(Array.from(hostnameBytes));
      requestArray.push(0); // Null terminator
    }

    const requestPacket = new Uint8Array(requestArray);

    // Send request
    await writeBytes(socket, requestPacket);

    // Read response (8 bytes for SOCKS4)
    const response = await readBytes(socket, 8);

    // Parse response
    const responseVersion = response[0];
    const responseCode = response[1];
    const bindPort = (response[2] << 8) | response[3];
    const bindAddress = `${response[4]}.${response[5]}.${response[6]}.${response[7]}`;

    // Validate response
    if (responseVersion !== 0x00) {
      throw new Error(`Invalid SOCKS4 response version: 0x${responseVersion.toString(16)}`);
    }

    if (responseCode !== SOCKS4_RESPONSE.GRANTED) {
      const errorMsg = getResponseError(responseCode);
      throw new Error(`SOCKS4 connection failed: ${errorMsg} (code: 0x${responseCode.toString(16)})`);
    }

    return {
      address: bindAddress,
      port: bindPort,
      version: 4,
      isSOCKS4a
    };
  }
}

export default SOCKS4Protocol;