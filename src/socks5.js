/**
 * SOCKS5 Protocol Client Implementation
 * 
 * Implements RFC 1928 (SOCKS Protocol Version 5) and RFC 1929 (Username/Password Authentication)
 * 
 * Protocol Flow:
 * 1. Client sends greeting with supported authentication methods
 * 2. Server selects authentication method
 * 3. If auth required, perform authentication handshake
 * 4. Client sends CONNECT request with target address and port
 * 5. Server responds with success/failure
 */

/**
 * SOCKS5 Protocol Constants
 */
const SOCKS5_VERSION = 0x05;
const SOCKS5_COMMAND_CONNECT = 0x01;
const SOCKS5_ADDRESS_TYPE_IPV4 = 0x01;
const SOCKS5_ADDRESS_TYPE_DOMAIN = 0x03;
const SOCKS5_ADDRESS_TYPE_IPV6 = 0x04;

// Authentication methods (RFC 1928)
const AUTH_METHOD = {
  NO_AUTH: 0x00,
  USERNAME_PASSWORD: 0x02,
  NO_ACCEPTABLE: 0xFF
};

// Response codes (RFC 1928)
const RESPONSE_CODE = {
  SUCCESS: 0x00,
  GENERAL_FAILURE: 0x01,
  CONN_NOT_ALLOWED: 0x02,
  NETWORK_UNREACHABLE: 0x03,
  HOST_UNREACHABLE: 0x04,
  CONNECTION_REFUSED: 0x05,
  TTL_EXPIRED: 0x06,
  COMMAND_NOT_SUPPORTED: 0x07,
  ADDRESS_TYPE_NOT_SUPPORTED: 0x08
};

// Username/Password Authentication (RFC 1929)
const AUTH_VERSION = 0x01;
const AUTH_MAX_USERNAME_LENGTH = 255;
const AUTH_MAX_PASSWORD_LENGTH = 255;

/**
 * Maps response codes to error messages
 * @param {number} code - Response code from SOCKS5 server
 * @returns {string} Error message
 */
function getResponseError(code) {
  const errorMap = {
    [RESPONSE_CODE.SUCCESS]: 'Connection succeeded',
    [RESPONSE_CODE.GENERAL_FAILURE]: 'General SOCKS server failure',
    [RESPONSE_CODE.CONN_NOT_ALLOWED]: 'Connection not allowed by ruleset',
    [RESPONSE_CODE.NETWORK_UNREACHABLE]: 'Network unreachable',
    [RESPONSE_CODE.HOST_UNREACHABLE]: 'Host unreachable',
    [RESPONSE_CODE.CONNECTION_REFUSED]: 'Connection refused',
    [RESPONSE_CODE.TTL_EXPIRED]: 'TTL expired',
    [RESPONSE_CODE.COMMAND_NOT_SUPPORTED]: 'Command not supported',
    [RESPONSE_CODE.ADDRESS_TYPE_NOT_SUPPORTED]: 'Address type not supported'
  };
  return errorMap[code] || `Unknown error code: ${code}`;
}

/**
 * Checks if the given address is an IPv6 address
 * @param {string} address - Address to check
 * @returns {boolean} True if address is IPv6
 */
function isIPv6(address) {
  return /^[0-9a-fA-F:]+$/.test(address) && address.includes(':');
}

/**
 * Checks if the given address is an IPv4 address
 * @param {string} address - Address to check
 * @returns {boolean} True if address is IPv4
 */
function isIPv4(address) {
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  return ipv4Regex.test(address);
}

/**
 * Determines the address type for SOCKS5 protocol
 * @param {string} address - Address to check
 * @returns {number} Address type constant (IPV4, IPV6, or DOMAIN)
 */
function getAddressType(address) {
  if (isIPv6(address)) {
    return SOCKS5_ADDRESS_TYPE_IPV6;
  } else if (isIPv4(address)) {
    return SOCKS5_ADDRESS_TYPE_IPV4;
  } else {
    return SOCKS5_ADDRESS_TYPE_DOMAIN;
  }
}

/**
 * Converts IPv4 string to 4 bytes
 * @param {string} ipv4 - IPv4 address string
 * @returns {Uint8Array} 4-byte array
 */
function ipv4ToBytes(ipv4) {
  const parts = ipv4.split('.');
  return new Uint8Array([
    parseInt(parts[0], 10),
    parseInt(parts[1], 10),
    parseInt(parts[2], 10),
    parseInt(parts[3], 10)
  ]);
}

/**
 * Converts IPv6 string to 16 bytes
 * @param {string} ipv6 - IPv6 address string
 * @returns {Uint8Array} 16-byte array
 * @throws {Error} If IPv6 address is invalid
 */
function ipv6ToBytes(ipv6) {
  // Simple IPv6 parser - handles basic cases
  const parts = ipv6.split(':').filter(part => part.length > 0);
  
  if (parts.length > 8) {
    throw new Error('Invalid IPv6 address');
  }

  const bytes = new Uint8Array(16);
  let byteIndex = 0;

  for (const part of parts) {
    const value = parseInt(part, 16);
    if (isNaN(value) || value > 0xFFFF) {
      throw new Error('Invalid IPv6 address part');
    }
    bytes[byteIndex++] = (value >> 8) & 0xFF;
    bytes[byteIndex++] = value & 0xFF;
  }

  return bytes;
}

/**
 * Reads a specific number of bytes from socket
 * @param {Object} socket - Socket object with data event handling
 * @param {number} length - Number of bytes to read
 * @returns {Promise<Uint8Array>} The bytes read
 */
function readBytes(socket, length) {
  return new Promise((resolve, reject) => {
    let data = new Uint8Array();

    const handleData = (chunk) => {
      const newData = new Uint8Array(data.length + chunk.length);
      newData.set(data);
      newData.set(new Uint8Array(chunk), data.length);
      data = newData;

      if (data.length >= length) {
        socket.removeEventListener('data', handleData);
        socket.removeEventListener('error', handleError);
        resolve(data.slice(0, length));
      }
    };

    const handleError = (error) => {
      socket.removeEventListener('data', handleData);
      socket.removeEventListener('error', handleError);
      reject(new Error(`Socket error while reading bytes: ${error.message}`));
    };

    socket.addEventListener('data', handleData);
    socket.addEventListener('error', handleError);

    // Timeout handling should be provided by outer wrapper
  });
}

/**
 * Writes bytes to socket
 * @param {Object} socket - Socket object with write method
 * @param {Uint8Array} data - Data to write
 * @returns {Promise<void>}
 */
function writeBytes(socket, data) {
  return new Promise((resolve, reject) => {
    try {
      socket.write(data);
      resolve();
    } catch (error) {
      reject(new Error(`Socket write error: ${error.message}`));
    }
  });
}

/**
 * SOCKS5Protocol class - Handles SOCKS5 protocol negotiation and connection
 */
class SOCKS5Protocol {
  constructor() {
    this.socket = null;
    this.authenticated = false;
  }

  /**
   * Sends the initial greeting to the SOCKS5 server
   * Advertises supported authentication methods
   * 
   * RFC 1928 Section 6 (Client Initialization):
   * +----+------+----------+
   * |VER | NMETHODS | METHODS |
   * +----+----------+----------+
   * | 1  |    1     | 1 to 255 |
   * +----+----------+----------+
   * 
   * @param {Object} socket - Socket to send greeting through
   * @param {boolean} requiresAuth - Whether authentication is required
   * @returns {Promise<number>} Selected authentication method
   * @throws {Error} If server rejects all methods or sends invalid response
   */
  async sendGreeting(socket, requiresAuth) {
    const methods = [AUTH_METHOD.NO_AUTH];
    if (requiresAuth) {
      methods.push(AUTH_METHOD.USERNAME_PASSWORD);
    }

    const greeting = new Uint8Array([
      SOCKS5_VERSION,
      methods.length,
      ...methods
    ]);

    await writeBytes(socket, greeting);

    // Read server response (2 bytes: version + selected method)
    const response = await readBytes(socket, 2);

    if (response[0] !== SOCKS5_VERSION) {
      throw new Error(`Invalid SOCKS version in greeting response: ${response[0]}`);
    }

    const selectedMethod = response[1];

    if (selectedMethod === AUTH_METHOD.NO_ACCEPTABLE) {
      throw new Error('Server rejected all authentication methods');
    }

    if (selectedMethod !== AUTH_METHOD.NO_AUTH && selectedMethod !== AUTH_METHOD.USERNAME_PASSWORD) {
      throw new Error(`Unsupported authentication method selected: ${selectedMethod}`);
    }

    return selectedMethod;
  }

  /**
   * Performs username/password authentication (RFC 1929)
   * 
   * RFC 1929 Section 1 (Username/Password Authentication):
   * +----+------+----------+------+----------+
   * |VER | ULEN |  UNAME   | PLEN |  PASSWD  |
   * +----+------+----------+------+----------+
   * | 1  |  1   | 1 to 255 |  1   | 1 to 255 |
   * +----+------+----------+------+----------+
   * 
   * Server Response:
   * +----+--------+
   * |VER | STATUS |
   * +----+--------+
   * | 1  |   1    |
   * +----+--------+
   * 
   * @param {Object} socket - Socket for authentication
   * @param {string} username - Username for authentication
   * @param {string} password - Password for authentication
   * @returns {Promise<void>}
   * @throws {Error} If authentication fails or credentials are invalid
   */
  async authenticateWithPassword(socket, username, password) {
    if (!username || typeof username !== 'string') {
      throw new Error('Invalid username: must be a non-empty string');
    }

    if (!password || typeof password !== 'string') {
      throw new Error('Invalid password: must be a non-empty string');
    }

    if (username.length > AUTH_MAX_USERNAME_LENGTH) {
      throw new Error(`Username exceeds maximum length of ${AUTH_MAX_USERNAME_LENGTH}`);
    }

    if (password.length > AUTH_MAX_PASSWORD_LENGTH) {
      throw new Error(`Password exceeds maximum length of ${AUTH_MAX_PASSWORD_LENGTH}`);
    }

    // Build authentication request
    const usernameBytes = new TextEncoder().encode(username);
    const passwordBytes = new TextEncoder().encode(password);

    const authRequest = new Uint8Array([
      AUTH_VERSION,
      usernameBytes.length,
      ...usernameBytes,
      passwordBytes.length,
      ...passwordBytes
    ]);

    await writeBytes(socket, authRequest);

    // Read authentication response (2 bytes: version + status)
    const response = await readBytes(socket, 2);

    if (response[0] !== AUTH_VERSION) {
      throw new Error(`Invalid authentication response version: ${response[0]}`);
    }

    if (response[1] !== 0x00) {
      throw new Error('Authentication failed: invalid username or password');
    }

    this.authenticated = true;
  }

  /**
   * Sends CONNECT request to establish tunnel to target
   * 
   * RFC 1928 Section 6 (Requests):
   * +----+-----+-------+------+----------+----------+
   * |VER | CMD |  RSV  | ATYP | DST.ADDR | DST.PORT |
   * +----+-----+-------+------+----------+----------+
   * | 1  |  1  | X'00' |  1   | Variable |    2     |
   * +----+-----+-------+------+----------+----------+
   * 
   * @param {Object} socket - Socket for sending request
   * @param {string} address - Target address (hostname, IPv4, or IPv6)
   * @param {number} port - Target port
   * @returns {Promise<Object>} Response with address and port information
   * @throws {Error} If connection fails or server responds with error
   */
  async sendConnectRequest(socket, address, port) {
    if (!address || typeof address !== 'string') {
      throw new Error('Invalid address: must be a non-empty string');
    }

    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('Invalid port: must be an integer between 1 and 65535');
    }

    const addressType = getAddressType(address);
    let addressBytes;

    if (addressType === SOCKS5_ADDRESS_TYPE_IPV4) {
      try {
        addressBytes = ipv4ToBytes(address);
      } catch (error) {
        throw new Error(`Invalid IPv4 address: ${error.message}`);
      }
    } else if (addressType === SOCKS5_ADDRESS_TYPE_IPV6) {
      try {
        addressBytes = ipv6ToBytes(address);
      } catch (error) {
        throw new Error(`Invalid IPv6 address: ${error.message}`);
      }
    } else {
      // Domain name
      const domainBytes = new TextEncoder().encode(address);
      if (domainBytes.length > 255) {
        throw new Error('Domain name exceeds maximum length of 255');
      }
      addressBytes = new Uint8Array([domainBytes.length, ...domainBytes]);
    }

    // Build CONNECT request
    const connectRequest = new Uint8Array([
      SOCKS5_VERSION,
      SOCKS5_COMMAND_CONNECT,
      0x00, // Reserved
      addressType
    ]);

    // Combine request parts
    const request = new Uint8Array(connectRequest.length + addressBytes.length + 2);
    request.set(connectRequest);
    request.set(addressBytes, connectRequest.length);

    // Add port (network byte order - big endian)
    request[connectRequest.length + addressBytes.length] = (port >> 8) & 0xFF;
    request[connectRequest.length + addressBytes.length + 1] = port & 0xFF;

    await writeBytes(socket, request);

    // Read response header (at least 4 bytes: version + response + reserved + address type)
    const headerResponse = await readBytes(socket, 4);

    if (headerResponse[0] !== SOCKS5_VERSION) {
      throw new Error(`Invalid response version: ${headerResponse[0]}`);
    }

    const responseCode = headerResponse[1];
    if (responseCode !== RESPONSE_CODE.SUCCESS) {
      throw new Error(`CONNECT request failed: ${getResponseError(responseCode)} (code: ${responseCode})`);
    }

    if (headerResponse[2] !== 0x00) {
      throw new Error('Invalid reserved field in response');
    }

    const responseAddressType = headerResponse[3];

    // Read address and port based on address type
    let addressLength = 0;
    switch (responseAddressType) {
      case SOCKS5_ADDRESS_TYPE_IPV4:
        addressLength = 4;
        break;
      case SOCKS5_ADDRESS_TYPE_IPV6:
        addressLength = 16;
        break;
      case SOCKS5_ADDRESS_TYPE_DOMAIN:
        const domainLengthByte = await readBytes(socket, 1);
        addressLength = domainLengthByte[0];
        break;
      default:
        throw new Error(`Unsupported address type in response: ${responseAddressType}`);
    }

    // Read address and port (2 bytes for port)
    const addressAndPort = await readBytes(socket, addressLength + 2);

    const bindPort = (addressAndPort[addressLength] << 8) | addressAndPort[addressLength + 1];

    return {
      addressType: responseAddressType,
      address: address,
      port: bindPort
    };
  }

  /**
   * Establishes a SOCKS5 connection through the given socket
   * 
   * Complete handshake flow:
   * 1. Send greeting with supported authentication methods
   * 2. Receive server's selected authentication method
   * 3. If authentication required, perform auth handshake
   * 4. Send CONNECT request for target
   * 5. Receive confirmation and bind address/port
   * 
   * @param {string} address - Target address to connect to
   * @param {number} port - Target port to connect to
   * @param {Object} socket - Socket object for communication
   * @param {Object} [auth] - Optional authentication credentials
   * @param {string} [auth.username] - Username for authentication
   * @param {string} [auth.password] - Password for authentication
   * @returns {Promise<Object>} Bind address and port information
   * @throws {Error} For any protocol violations, auth failures, or connection errors
   * 
   * @example
   * const protocol = new SOCKS5Protocol();
   * try {
   *   const result = await protocol.connect('example.com', 443, socket, {
   *     username: 'user',
   *     password: 'pass'
   *   });
   *   console.log('Connected, bind address:', result.address, ':', result.port);
   * } catch (error) {
   *   console.error('Connection failed:', error.message);
   * }
   */
  async connect(address, port, socket, auth) {
    this.socket = socket;

    try {
      // Step 1: Send greeting and get authentication method
      const requiresAuth = !!(auth && (auth.username || auth.password));
      const selectedMethod = await this.sendGreeting(socket, requiresAuth);

      // Step 2: Perform authentication if needed
      if (selectedMethod === AUTH_METHOD.USERNAME_PASSWORD) {
        if (!auth || !auth.username || !auth.password) {
          throw new Error('Server requires authentication but no credentials provided');
        }
        await this.authenticateWithPassword(socket, auth.username, auth.password);
      }

      // Step 3: Send CONNECT request
      const result = await this.sendConnectRequest(socket, address, port);

      return result;
    } catch (error) {
      this.socket = null;
      throw error;
    }
  }
}

export { SOCKS5Protocol };
