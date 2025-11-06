/**
 * Options page script for Proxy Chain Manager
 * Handles CRUD operations for proxy chains with validation
 */

import { 
  loadChains, 
  saveChain, 
  deleteChain, 
  validateChain, 
  validateProxy 
} from '../storage.js';

class ChainManager {
  constructor() {
    this.chains = [];
    this.currentEditingChain = null;
    this.proxyIdCounter = 0;
    this.draggedElement = null;
    
    this.initializeElements();
    this.bindEvents();
    this.loadChains();
  }

  initializeElements() {
    // Main elements
    this.chainsList = document.getElementById('chainsList');
    this.emptyState = document.getElementById('emptyState');
    this.statusMessage = document.getElementById('statusMessage');
    
    // Chain editor modal
    this.chainEditorModal = document.getElementById('chainEditorModal');
    this.modalTitle = document.getElementById('modalTitle');
    this.chainEditorForm = document.getElementById('chainEditorForm');
    this.chainNameInput = document.getElementById('chainName');
    this.proxiesList = document.getElementById('proxiesList');
    this.addProxyBtn = document.getElementById('addProxyBtn');
    
    // Delete modal
    this.deleteModal = document.getElementById('deleteModal');
    this.deleteChainName = document.getElementById('deleteChainName');
    
    // Buttons
    this.addNewChainBtn = document.getElementById('addNewChainBtn');
    this.closeModalBtn = document.getElementById('closeModalBtn');
    this.cancelBtn = document.getElementById('cancelBtn');
    this.confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
    this.cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
    
    // Error messages
    this.chainNameError = document.getElementById('chainNameError');
    this.proxiesError = document.getElementById('proxiesError');
  }

  bindEvents() {
    // Main buttons
    this.addNewChainBtn.addEventListener('click', () => this.openChainEditor());
    this.closeModalBtn.addEventListener('click', () => this.closeChainEditor());
    this.cancelBtn.addEventListener('click', () => this.closeChainEditor());
    this.addProxyBtn.addEventListener('click', () => this.addProxy());
    
    // Form submission
    this.chainEditorForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.saveChain();
    });
    
    // Delete modal
    this.confirmDeleteBtn.addEventListener('click', () => this.confirmDelete());
    this.cancelDeleteBtn.addEventListener('click', () => this.closeDeleteModal());
    
    // Modal backdrop clicks
    this.chainEditorModal.addEventListener('click', (e) => {
      if (e.target === this.chainEditorModal) {
        this.closeChainEditor();
      }
    });
    
    this.deleteModal.addEventListener('click', (e) => {
      if (e.target === this.deleteModal) {
        this.closeDeleteModal();
      }
    });
    
    // Clear errors on input
    this.chainNameInput.addEventListener('input', () => {
      this.clearError(this.chainNameError);
      this.chainNameInput.classList.remove('error');
    });
  }

  async loadChains() {
    try {
      this.chains = await loadChains();
      this.renderChains();
    } catch (error) {
      this.showMessage('Failed to load proxy chains', 'error');
      console.error('Error loading chains:', error);
    }
  }

  renderChains() {
    if (this.chains.length === 0) {
      this.chainsList.style.display = 'none';
      this.emptyState.style.display = 'block';
    } else {
      this.chainsList.style.display = 'grid';
      this.emptyState.style.display = 'none';
      
      this.chainsList.innerHTML = this.chains.map(chain => `
        <div class="chain-item" data-chain-id="${chain.id}">
          <div class="chain-info">
            <div class="chain-name">${this.escapeHtml(chain.name)}</div>
            <div class="chain-details">
              ${chain.proxies.length} proxy server${chain.proxies.length !== 1 ? 's' : ''}
            </div>
          </div>
          <div class="chain-actions">
            <button class="btn btn-small btn-secondary" onclick="chainManager.editChain('${chain.id}')">
              Edit
            </button>
            <button class="btn btn-small btn-danger" onclick="chainManager.deleteChain('${chain.id}')">
              Delete
            </button>
          </div>
        </div>
      `).join('');
    }
  }

  openChainEditor(chainId = null) {
    this.currentEditingChain = chainId ? this.chains.find(c => c.id === chainId) : null;
    this.proxyIdCounter = 0;
    
    // Set modal title
    this.modalTitle.textContent = this.currentEditingChain ? 'Edit Chain' : 'Add New Chain';
    
    // Reset form
    this.chainEditorForm.reset();
    this.clearAllErrors();
    
    // Load chain data if editing
    if (this.currentEditingChain) {
      this.chainNameInput.value = this.currentEditingChain.name;
      this.currentEditingChain.proxies.forEach(proxy => {
        this.addProxy(proxy);
      });
    } else {
      // Add two empty proxies for new chains
      this.addProxy();
      this.addProxy();
    }
    
    // Show modal
    this.chainEditorModal.classList.add('active');
  }

  closeChainEditor() {
    this.chainEditorModal.classList.remove('active');
    this.currentEditingChain = null;
    this.proxiesList.innerHTML = '';
  }

  addProxy(proxyData = null) {
    const proxyId = `proxy-${this.proxyIdCounter++}`;
    const proxyItem = document.createElement('div');
    proxyItem.className = 'proxy-item';
    proxyItem.dataset.proxyId = proxyId;
    proxyItem.draggable = true;
    
    proxyItem.innerHTML = `
      <div class="proxy-header">
        <div class="proxy-title">Proxy ${this.proxyIdCounter}</div>
        <div class="proxy-actions">
          <button type="button" class="btn btn-small btn-secondary" onclick="chainManager.removeProxy('${proxyId}')">
            Remove
          </button>
        </div>
      </div>
      <div class="proxy-form">
        <div class="form-group">
          <input type="text" placeholder="Address (IP or hostname)" data-field="address" 
                 value="${proxyData ? this.escapeHtml(proxyData.address) : ''}" required>
        </div>
        <div class="form-group">
          <input type="number" placeholder="Port" min="1" max="65535" data-field="port" 
                 value="${proxyData ? proxyData.port : ''}" required>
        </div>
        <div class="form-group">
          <select data-field="type" required>
            <option value="">Select Type</option>
            <option value="socks5" ${proxyData && proxyData.type === 'socks5' ? 'selected' : ''}>SOCKS5</option>
            <option value="socks4" ${proxyData && proxyData.type === 'socks4' ? 'selected' : ''}>SOCKS4</option>
            <option value="https" ${proxyData && proxyData.type === 'https' ? 'selected' : ''}>HTTPS</option>
          </select>
        </div>
        <div class="form-group">
          <input type="text" placeholder="Username (optional)" data-field="username" 
                 value="${proxyData && proxyData.username ? this.escapeHtml(proxyData.username) : ''}">
        </div>
        <div class="form-group">
          <input type="password" placeholder="Password (optional)" data-field="password" 
                 value="${proxyData && proxyData.password ? proxyData.password : ''}">
        </div>
        <div class="proxy-reorder">
          <button type="button" class="reorder-btn" onclick="chainManager.moveProxyUp('${proxyId}')" title="Move Up">
            ↑
          </button>
          <button type="button" class="reorder-btn" onclick="chainManager.moveProxyDown('${proxyId}')" title="Move Down">
            ↓
          </button>
        </div>
      </div>
    `;
    
    this.proxiesList.appendChild(proxyItem);
    this.updateProxyNumbers();
    this.setupDragAndDrop(proxyItem);
    this.updateReorderButtons();
  }

  removeProxy(proxyId) {
    const proxyItem = document.querySelector(`[data-proxy-id="${proxyId}"]`);
    if (proxyItem) {
      proxyItem.remove();
      this.updateProxyNumbers();
      this.updateReorderButtons();
    }
  }

  moveProxyUp(proxyId) {
    const proxyItem = document.querySelector(`[data-proxy-id="${proxyId}"]`);
    const previousSibling = proxyItem.previousElementSibling;
    
    if (previousSibling) {
      this.proxiesList.insertBefore(proxyItem, previousSibling);
      this.updateProxyNumbers();
      this.updateReorderButtons();
    }
  }

  moveProxyDown(proxyId) {
    const proxyItem = document.querySelector(`[data-proxy-id="${proxyId}"]`);
    const nextSibling = proxyItem.nextElementSibling;
    
    if (nextSibling) {
      this.proxiesList.insertBefore(nextSibling, proxyItem);
      this.updateProxyNumbers();
      this.updateReorderButtons();
    }
  }

  updateProxyNumbers() {
    const proxyItems = this.proxiesList.querySelectorAll('.proxy-item');
    proxyItems.forEach((item, index) => {
      const titleElement = item.querySelector('.proxy-title');
      titleElement.textContent = `Proxy ${index + 1}`;
    });
  }

  updateReorderButtons() {
    const proxyItems = this.proxiesList.querySelectorAll('.proxy-item');
    
    proxyItems.forEach((item, index) => {
      const upBtn = item.querySelector('.reorder-btn:first-child');
      const downBtn = item.querySelector('.reorder-btn:last-child');
      
      upBtn.disabled = index === 0;
      downBtn.disabled = index === proxyItems.length - 1;
    });
  }

  setupDragAndDrop(proxyItem) {
    proxyItem.addEventListener('dragstart', (e) => {
      this.draggedElement = proxyItem;
      proxyItem.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });

    proxyItem.addEventListener('dragend', (e) => {
      proxyItem.classList.remove('dragging');
      this.draggedElement = null;
    });

    proxyItem.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      
      if (this.draggedElement && this.draggedElement !== proxyItem) {
        const rect = proxyItem.getBoundingClientRect();
        const midpoint = rect.top + rect.height / 2;
        
        if (e.clientY < midpoint) {
          this.proxiesList.insertBefore(this.draggedElement, proxyItem);
        } else {
          this.proxiesList.insertBefore(this.draggedElement, proxyItem.nextSibling);
        }
        
        this.updateProxyNumbers();
        this.updateReorderButtons();
      }
    });
  }

  async saveChain() {
    if (!this.validateForm()) {
      return;
    }

    try {
      const chainData = this.getFormData();
      
      if (this.currentEditingChain) {
        // Update existing chain
        chainData.id = this.currentEditingChain.id;
        await saveChain(chainData);
        this.showMessage('Chain updated successfully!', 'success');
      } else {
        // Create new chain
        chainData.id = this.generateId();
        await saveChain(chainData);
        this.showMessage('Chain created successfully!', 'success');
      }
      
      this.closeChainEditor();
      await this.loadChains();
    } catch (error) {
      this.showMessage('Failed to save chain', 'error');
      console.error('Error saving chain:', error);
    }
  }

  validateForm() {
    let isValid = true;
    this.clearAllErrors();

    // Validate chain name
    const chainName = this.chainNameInput.value.trim();
    if (!chainName) {
      this.showError(this.chainNameError, 'Chain name is required');
      this.chainNameInput.classList.add('error');
      isValid = false;
    }

    // Get proxy data
    const proxies = this.getProxyData();
    
    // Validate minimum proxy count
    if (proxies.length < 2) {
      this.showError(this.proxiesError, 'At least 2 proxy servers are required');
      isValid = false;
    }

    // Validate each proxy
    proxies.forEach((proxy, index) => {
      const proxyValidation = validateProxy(proxy);
      if (!proxyValidation.isValid) {
        this.showError(this.proxiesError, `Proxy ${index + 1}: ${proxyValidation.error}`);
        isValid = false;
      }
    });

    return isValid;
  }

  getFormData() {
    return {
      name: this.chainNameInput.value.trim(),
      proxies: this.getProxyData()
    };
  }

  getProxyData() {
    const proxyItems = this.proxiesList.querySelectorAll('.proxy-item');
    const proxies = [];

    proxyItems.forEach(item => {
      const address = item.querySelector('[data-field="address"]').value.trim();
      const port = parseInt(item.querySelector('[data-field="port"]').value);
      const type = item.querySelector('[data-field="type"]').value;
      const username = item.querySelector('[data-field="username"]').value.trim();
      const password = item.querySelector('[data-field="password"]').value;

      if (address && port && type) {
        proxies.push({
          address,
          port,
          type,
          username: username || undefined,
          password: password || undefined
        });
      }
    });

    return proxies;
  }

  editChain(chainId) {
    this.openChainEditor(chainId);
  }

  deleteChain(chainId) {
    const chain = this.chains.find(c => c.id === chainId);
    if (chain) {
      this.deleteChainName.textContent = chain.name;
      this.deleteModal.classList.add('active');
      this.chainToDelete = chainId;
    }
  }

  async confirmDelete() {
    if (this.chainToDelete) {
      try {
        await deleteChain(this.chainToDelete);
        this.showMessage('Chain deleted successfully!', 'success');
        this.closeDeleteModal();
        await this.loadChains();
      } catch (error) {
        this.showMessage('Failed to delete chain', 'error');
        console.error('Error deleting chain:', error);
      }
    }
  }

  closeDeleteModal() {
    this.deleteModal.classList.remove('active');
    this.chainToDelete = null;
  }

  showError(element, message) {
    element.textContent = message;
    element.classList.add('visible');
  }

  clearError(element) {
    element.textContent = '';
    element.classList.remove('visible');
  }

  clearAllErrors() {
    this.clearError(this.chainNameError);
    this.clearError(this.proxiesError);
    this.chainNameInput.classList.remove('error');
    
    // Clear all input field errors
    const inputs = this.chainEditorForm.querySelectorAll('input.error, select.error');
    inputs.forEach(input => input.classList.remove('error'));
  }

  showMessage(text, type) {
    this.statusMessage.textContent = text;
    this.statusMessage.className = `status-message ${type} visible`;
    
    // Auto-hide after 3 seconds
    setTimeout(() => {
      this.statusMessage.classList.remove('visible');
    }, 3000);
  }

  generateId() {
    return 'chain-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Initialize the chain manager when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.chainManager = new ChainManager();
});