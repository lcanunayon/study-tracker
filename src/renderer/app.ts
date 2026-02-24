interface Module {
  id: string;
  name: string;
  description: string;
  image?: string; // Base64 or image path
  createdAt: number;
  workspace?: WorkspaceData;
}

interface WorkspaceItem {
  id: string;
  type: 'note' | 'image' | 'drawing';
  x: number;
  y: number;
  width: number;
  height: number;
  content?: string; // For notes and images
  color?: string; // For notes
  strokes?: DrawingStroke[]; // For drawings
  zIndex: number;
}

interface DrawingStroke {
  points: { x: number; y: number }[];
  color: string;
  width: number;
}

interface WorkspaceData {
  items: WorkspaceItem[];
  offsetX: number;
  offsetY: number;
  zoom: number;
}

class StudyTrackerApp {
  private modules: Module[] = [];
  private currentModule: Module | null = null;
  private isDetailView = false;
  private isEditMode = false;
  private draggedModule: Module | null = null;
  private storageKey = 'study-tracker-modules';

  // Workspace properties
  private workspaceCanvas: HTMLCanvasElement | null = null;
  private workspaceCtx: CanvasRenderingContext2D | null = null;
  private isDrawing = false;
  private isPanning = false;
  private lastPanX = 0;
  private lastPanY = 0;
  private workspaceTool: 'pointer' | 'note' | 'draw' | 'erase' | 'image' = 'pointer';
  private drawColor = '#000000';
  private drawWidth = 2;

  constructor() {
    this.loadModules();
    this.initializeHTML();
    this.render();
    this.attachEventListeners();
  }

  private initializeHTML(): void {
    const root = document.getElementById('app');
    if (root) {
      root.innerHTML = `
        <div class="main-container" id="mainContainer"></div>
        <div class="modal-overlay" id="modalOverlay" style="display: none;">
          <div class="modal" id="addModuleModal">
            <h2>Create New Module</h2>
            <form id="addModuleForm">
              <div class="form-group">
                <label for="moduleName">Module Name *</label>
                <input type="text" id="moduleName" placeholder="e.g., React Hooks" required>
              </div>

              <div class="form-group">
                <label for="moduleDescription">Description *</label>
                <textarea id="moduleDescription" placeholder="What does this module teach?" required></textarea>
              </div>

              <div class="form-group">
                <label>Module Cover Image</label>
                <div class="image-upload-area" id="imageUploadArea">
                  <input type="file" id="imageInput" accept="image/*">
                  <div class="upload-text">Click to upload or drag & drop an image</div>
                </div>
                <img id="imagePreview" class="image-preview" style="display: none;" alt="Preview">
              </div>

              <div class="form-actions">
                <button type="button" class="btn btn-secondary" id="cancelBtn">Cancel</button>
                <button type="submit" class="btn btn-primary">Create Module</button>
              </div>
            </form>
          </div>
        </div>
      `;
    }
  }

  private loadModules(): void {
    const stored = localStorage.getItem(this.storageKey);
    if (stored) {
      this.modules = JSON.parse(stored);
    } else {
      // Demo modules
      this.modules = [
        {
          id: '1',
          name: 'TypeScript Fundamentals',
          description: 'Master the basics of TypeScript including types, interfaces, and generics.',
          image: this.generateGradient('#667eea', '#764ba2'),
          createdAt: Date.now(),
        },
        {
          id: '2',
          name: 'React Advanced',
          description: 'Deep dive into React hooks, context API, and performance optimization.',
          image: this.generateGradient('#f093fb', '#f5576c'),
          createdAt: Date.now(),
        },
        {
          id: '3',
          name: 'Web Security',
          description: 'Learn about CSRF, XSS, authentication, and secure coding practices.',
          image: this.generateGradient('#4facfe', '#00f2fe'),
          createdAt: Date.now(),
        },
      ];
      this.saveModules();
    }
  }

  private generateGradient(color1: string, color2: string): string {
    // Create a canvas with gradient
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 450;
    const ctx = canvas.getContext('2d')!;
    
    const gradient = ctx.createLinearGradient(0, 0, 800, 450);
    gradient.addColorStop(0, color1);
    gradient.addColorStop(1, color2);
    
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 800, 450);
    
    return canvas.toDataURL();
  }

  private saveModules(): void {
    localStorage.setItem(this.storageKey, JSON.stringify(this.modules));
  }

  private render(): void {
    const container = document.getElementById('mainContainer');
    if (!container) return;

    if (this.isDetailView && this.currentModule) {
      container.innerHTML = this.renderDetailView();
    } else {
      container.innerHTML = this.renderMainView();
    }

    this.attachEventListeners();
  }

  private renderMainView(): string {
    return `
      <div class="header">
        <h1>Study Modules</h1>
        <div class="header-buttons">
          <button class="edit-mode-btn ${this.isEditMode ? 'active' : ''}" id="editModeBtn" title="${this.isEditMode ? 'Done Editing' : 'Edit Modules'}">
            ${this.isEditMode ? '✓ Done' : '✎ Edit'}
          </button>
          <button class="add-module-btn" id="addModuleBtn">+ New Module</button>
        </div>
      </div>
      <div class="main-content">
        <div class="module-grid" id="moduleGrid" ${this.isEditMode ? 'data-edit-mode="true"' : ''}>
          ${
            this.modules.length === 0
              ? `
              <div class="empty-state">
                <div class="empty-state-icon">📚</div>
                <div class="empty-state-text">No modules yet. Create your first module to get started!</div>
              </div>
            `
              : this.modules.map((module) => this.renderModuleCard(module)).join('')
          }
        </div>
      </div>
    `;
  }

  private renderModuleCard(module: Module): string {
    const hasImage = module.image && module.image.startsWith('data:');
    
    if (hasImage) {
      // Card with image background
      return `
        <div class="module-card" data-module-id="${module.id}" ${this.isEditMode ? 'draggable="true"' : ''}>
          ${this.isEditMode ? '<div class="drag-handle">☰</div>' : ''}
          ${this.isEditMode ? `<button class="delete-btn" data-module-id="${module.id}">✕</button>` : ''}
          <img class="card-background" src="${module.image}" alt="${module.name}">
          <div class="card-overlay"></div>
          <div class="card-content">
            <div class="card-title">${this.escapeHtml(module.name)}</div>
            <div class="card-description">${this.escapeHtml(module.description)}</div>
          </div>
        </div>
      `;
    } else {
      // Card without image - gradient placeholder with centered title only
      return `
        <div class="module-card" data-module-id="${module.id}" ${this.isEditMode ? 'draggable="true"' : ''}>
          ${this.isEditMode ? '<div class="drag-handle">☰</div>' : ''}
          ${this.isEditMode ? `<button class="delete-btn" data-module-id="${module.id}">✕</button>` : ''}
          <div class="card-placeholder">
            <div class="card-title">${this.escapeHtml(module.name)}</div>
          </div>
        </div>
      `;
    }
  }

  private renderDetailView(): string {
    if (!this.currentModule) return '';

    const hasImage = this.currentModule.image && this.currentModule.image.startsWith('data:');

    return `
      <div class="detail-view">
        <div class="detail-left">
          <div class="detail-header">
            <button class="back-btn" id="backBtn">←</button>
            <h2>${this.escapeHtml(this.currentModule.name)}</h2>
          </div>
          <div class="detail-content">
            ${
              hasImage
                ? `<img class="detail-image" src="${this.currentModule.image}" alt="${this.currentModule.name}">`
                : ''
            }
            <div class="detail-description">${this.escapeHtml(this.currentModule.description)}</div>
          </div>
        </div>
        <div class="workspace-container">
          <div class="workspace-toolbar">
            <button class="tool-btn" id="toolPointer" title="Select">➡</button>
            <button class="tool-btn" id="toolNote" title="Add Note">📝</button>
            <button class="tool-btn" id="toolDraw" title="Draw">✏</button>
            <button class="tool-btn" id="toolErase" title="Erase">🧹</button>
            <button class="tool-btn" id="toolImage" title="Add Image">🖼</button>
            <input type="color" id="drawColor" value="#000000" title="Draw Color">
            <div style="flex: 1;"></div>
            <button class="tool-btn" id="zoomIn" title="Zoom In">🔍+</button>
            <button class="tool-btn" id="zoomOut" title="Zoom Out">🔍-</button>
            <span id="zoomLevel" style="color: #00d4ff; font-size: 12px; margin: 0 10px;">100%</span>
          </div>
          <canvas id="workspaceCanvas" class="workspace-canvas"></canvas>
        </div>
      </div>
    `;
  }

  private attachEventListeners(): void {
    // Edit mode button
    const editModeBtn = document.getElementById('editModeBtn');
    if (editModeBtn) {
      editModeBtn.addEventListener('click', () => this.toggleEditMode());
    }

    // Main view events
    const addModuleBtn = document.getElementById('addModuleBtn');
    if (addModuleBtn) {
      addModuleBtn.addEventListener('click', () => this.openAddModuleModal());
    }

    // Module card clicks (only when not in edit mode)
    if (!this.isEditMode) {
      const moduleCards = document.querySelectorAll('.module-card');
      moduleCards.forEach((card) => {
        card.addEventListener('click', (e) => {
          if ((e.target as HTMLElement).closest('.delete-btn')) return; // Don't open detail view if clicking delete
          const moduleId = (card as HTMLElement).dataset.moduleId;
          this.openDetailView(moduleId!);
        });
      });
    } else {
      // Delete button handlers (only in edit mode)
      const deleteButtons = document.querySelectorAll('.delete-btn');
      deleteButtons.forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const moduleId = (btn as HTMLElement).dataset.moduleId;
          this.deleteModule(moduleId!);
        });
      });

      // Drag and drop handlers
      const moduleCards = document.querySelectorAll('.module-card');
      moduleCards.forEach((card) => {
        card.addEventListener('dragstart', (e) => this.handleDragStart(e as DragEvent));
        card.addEventListener('dragover', (e) => this.handleDragOver(e as DragEvent));
        card.addEventListener('drop', (e) => this.handleDrop(e as DragEvent));
        card.addEventListener('dragend', (e) => this.handleDragEnd(e as DragEvent));
      });
    }

    // Detail view back button
    const backBtn = document.getElementById('backBtn');
    if (backBtn) {
      backBtn.addEventListener('click', () => this.closeDetailView());
    }

    // Initialize workspace if in detail view
    if (this.isDetailView && this.currentModule) {
      this.initializeWorkspace();
    }
  }

  private handleImageUpload(file: File): void {
    const preview = document.getElementById('imagePreview') as HTMLImageElement;
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      if (preview) {
        preview.src = result;
        preview.style.display = 'block';
        (preview.parentElement as HTMLElement).dataset.imageData = result;
      }
    };
    reader.readAsDataURL(file);
  }

  private handleAddModule(): void {
    const nameInput = document.getElementById('moduleName') as HTMLInputElement;
    const descriptionInput = document.getElementById('moduleDescription') as HTMLTextAreaElement;
    const imagePreview = document.getElementById('imagePreview') as HTMLImageElement;

    if (!nameInput || !descriptionInput) return;

    const module: Module = {
      id: Date.now().toString(),
      name: nameInput.value.trim(),
      description: descriptionInput.value.trim(),
      image: imagePreview && imagePreview.style.display !== 'none' ? imagePreview.src : undefined,
      createdAt: Date.now(),
      workspace: {
        items: [],
        offsetX: 0,
        offsetY: 0,
        zoom: 1,
      },
    };

    this.modules.push(module);
    this.saveModules();
    this.closeAddModuleModal();
    this.render();
  }

  private openAddModuleModal(): void {
    const modalOverlay = document.getElementById('modalOverlay');
    const imagePreview = document.getElementById('imagePreview') as HTMLImageElement;
    const imageInput = document.getElementById('imageInput') as HTMLInputElement;

    console.log('=== OPEN MODAL ===');
    console.log('Modal overlay found:', !!modalOverlay);

    if (modalOverlay) {
      // Clone modal to remove old listeners
      const newOverlay = modalOverlay.cloneNode(true) as HTMLElement;
      modalOverlay.parentNode?.replaceChild(newOverlay, modalOverlay);
      
      // Get fresh reference to cloned modal
      const freshModal = document.getElementById('modalOverlay') as HTMLElement;
      if (!freshModal) return;
      
      // Set up fresh event listeners on the cloned modal
      this.setupModalListeners(freshModal);
      
      // Reset form
      const freshImagePreview = freshModal.querySelector('#imagePreview') as HTMLImageElement;
      const freshImageInput = freshModal.querySelector('#imageInput') as HTMLInputElement;
      const freshForm = freshModal.querySelector('#addModuleForm') as HTMLFormElement;
      
      if (freshImagePreview) {
        freshImagePreview.style.display = 'none';
        freshImagePreview.src = '';
      }
      if (freshImageInput) freshImageInput.value = '';
      if (freshForm) freshForm.reset();
      
      // Show with opacity transition
      freshModal.style.opacity = '0';
      freshModal.style.pointerEvents = 'auto';
      freshModal.style.display = 'flex';
      
      // Trigger reflow to start transition
      void freshModal.offsetHeight;
      freshModal.style.opacity = '1';
      
      // Focus on the first input with proper timing
      setTimeout(() => {
        const moduleNameInput = freshModal.querySelector('#moduleName') as HTMLInputElement;
        if (moduleNameInput) {
          console.log('🎯 Focusing input field');
          moduleNameInput.focus();
        }
      }, 10);
    }
  }

  private setupModalListeners(modalOverlay: HTMLElement): void {
    console.log('=== SETUP MODAL LISTENERS ===');
    
    // Form submission
    modalOverlay.addEventListener('submit', (e) => {
      if ((e.target as HTMLElement).matches('#addModuleForm')) {
        e.preventDefault();
        console.log('Form submitted');
        this.handleAddModule();
      }
    }, true); // Capture phase
    
    // Cancel button
    modalOverlay.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.matches('#cancelBtn')) {
        console.log('Cancel clicked');
        this.closeAddModuleModal();
      }
    });
    
    // Background click to close
    modalOverlay.addEventListener('click', (e) => {
      if (e.target === modalOverlay) {
        this.closeAddModuleModal();
      }
    });
    
    // Image upload click
    modalOverlay.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.matches('#imageUploadArea') || target.closest('#imageUploadArea')) {
        const input = modalOverlay.querySelector('#imageInput') as HTMLInputElement;
        if (input) input.click();
      }
    });
    
    // Image upload drag/drop
    const uploadArea = modalOverlay.querySelector('#imageUploadArea');
    if (uploadArea) {
      uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        (uploadArea as HTMLElement).style.background = 'rgba(0, 212, 255, 0.1)';
      });
      
      uploadArea.addEventListener('dragleave', () => {
        (uploadArea as HTMLElement).style.background = 'rgba(0, 212, 255, 0.02)';
      });
      
      uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        (uploadArea as HTMLElement).style.background = 'rgba(0, 212, 255, 0.02)';
        const files = (e as DragEvent).dataTransfer?.files;
        if (files) this.handleImageUpload(files[0]);
      });
    }
    
    // Image input change
    const imageInput = modalOverlay.querySelector('#imageInput') as HTMLInputElement;
    if (imageInput) {
      imageInput.addEventListener('change', (e) => {
        const files = (e.target as HTMLInputElement).files;
        if (files) this.handleImageUpload(files[0]);
      });
    }
  }

  private closeAddModuleModal(): void {
    console.log('=== CLOSE MODAL ===');
    const modalOverlay = document.getElementById('modalOverlay');
    if (modalOverlay) {
      modalOverlay.style.opacity = '0';
      modalOverlay.style.pointerEvents = 'none';
      console.log('Modal pointerEvents set to: none');
      setTimeout(() => {
        if (modalOverlay) {
          modalOverlay.style.display = 'none';
          console.log('Modal display set to: none');
        }
      }, 300);
    }
  }

  private openDetailView(moduleId: string): void {
    const module = this.modules.find((m) => m.id === moduleId);
    if (module) {
      this.currentModule = module;
      this.isDetailView = true;
      if (!module.workspace) {
        module.workspace = {
          items: [],
          offsetX: 0,
          offsetY: 0,
          zoom: 1,
        };
      }
      this.render();
    }
  }

  private closeDetailView(): void {
    this.isDetailView = false;
    this.currentModule = null;
    this.render();
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  private toggleEditMode(): void {
    this.isEditMode = !this.isEditMode;
    this.render();
  }

  private deleteModule(moduleId: string): void {
    console.log('=== DELETE MODULE ===');
    console.log('Module ID:', moduleId);
    if (confirm('Are you sure you want to delete this module?')) {
      this.modules = this.modules.filter((m) => m.id !== moduleId);
      this.saveModules();
      console.log('Module deleted, remaining:', this.modules.length);
      this.render();
      console.log('Render complete after delete');
    }
  }

  private handleDragStart(e: DragEvent): void {
    const card = (e.target as HTMLElement).closest('.module-card') as HTMLElement;
    if (card) {
      const moduleId = card.dataset.moduleId;
      this.draggedModule = this.modules.find((m) => m.id === moduleId) || null;
      card.classList.add('dragging');
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
      }
    }
  }

  private handleDragOver(e: DragEvent): void {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'move';
    }
    const card = (e.target as HTMLElement).closest('.module-card') as HTMLElement;
    if (card) {
      card.classList.add('drag-over');
    }
  }

  private handleDrop(e: DragEvent): void {
    e.preventDefault();
    const card = (e.target as HTMLElement).closest('.module-card') as HTMLElement;
    if (card && this.draggedModule) {
      const targetModuleId = card.dataset.moduleId;
      if (targetModuleId && targetModuleId !== this.draggedModule.id) {
        const draggedIndex = this.modules.findIndex((m) => m.id === this.draggedModule!.id);
        const targetIndex = this.modules.findIndex((m) => m.id === targetModuleId);

        if (draggedIndex !== -1 && targetIndex !== -1) {
          // Swap modules
          [this.modules[draggedIndex], this.modules[targetIndex]] = [
            this.modules[targetIndex],
            this.modules[draggedIndex],
          ];
          this.saveModules();
          this.render();
        }
      }
      card.classList.remove('drag-over');
    }
  }

  private handleDragEnd(e: DragEvent): void {
    const card = (e.target as HTMLElement).closest('.module-card') as HTMLElement;
    if (card) {
      card.classList.remove('dragging');
    }
    const allCards = document.querySelectorAll('.module-card');
    allCards.forEach((c) => c.classList.remove('drag-over'));
    this.draggedModule = null;
  }

  // ===== WORKSPACE METHODS =====

  private initializeWorkspace(): void {
    const canvas = document.getElementById('workspaceCanvas') as HTMLCanvasElement;
    if (!canvas) return;

    this.workspaceCanvas = canvas;
    this.workspaceCtx = canvas.getContext('2d');

    // Set canvas size
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;

    // Draw initial state
    this.drawWorkspace();

    // Tool button handlers
    const toolButtons = canvas.parentElement?.querySelectorAll('.tool-btn');
    if (toolButtons) {
      toolButtons.forEach((btn) => {
        btn.addEventListener('click', () => {
          toolButtons.forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          const toolId = (btn as HTMLElement).id;
          this.selectTool(toolId);
        });
      });
    }

    // Color picker
    const drawColorInput = canvas.parentElement?.querySelector('#drawColor') as HTMLInputElement;
    if (drawColorInput) {
      drawColorInput.addEventListener('change', (e) => {
        this.drawColor = (e.target as HTMLInputElement).value;
      });
    }

    // Zoom buttons
    const zoomInBtn = canvas.parentElement?.querySelector('#zoomIn');
    const zoomOutBtn = canvas.parentElement?.querySelector('#zoomOut');
    if (zoomInBtn) zoomInBtn.addEventListener('click', () => this.zoom(0.2));
    if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => this.zoom(-0.2));

    // Canvas events
    canvas.addEventListener('mousedown', (e) => this.handleCanvasMouseDown(e));
    canvas.addEventListener('mousemove', (e) => this.handleCanvasMouseMove(e));
    canvas.addEventListener('mouseup', () => this.handleCanvasMouseUp());
    canvas.addEventListener('mousewheel', (e) => this.handleCanvasWheel(e as any), { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // Set default tool
    const pointerBtn = canvas.parentElement?.querySelector('#toolPointer');
    if (pointerBtn) {
      pointerBtn.classList.add('active');
      this.workspaceTool = 'pointer';
    }
  }

  private drawWorkspace(): void {
    if (!this.workspaceCanvas || !this.workspaceCtx || !this.currentModule?.workspace) return;

    const ctx = this.workspaceCtx;
    const ws = this.currentModule.workspace;
    const w = this.workspaceCanvas.width;
    const h = this.workspaceCanvas.height;

    // Clear with dark background
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, w, h);

    // Draw pegboard grid
    const gridSize = 30;
    ctx.strokeStyle = 'rgba(0, 212, 255, 0.15)';
    ctx.lineWidth = 1;

    for (let x = 0; x < w; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y < h; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Draw pegboard holes
    ctx.fillStyle = 'rgba(0, 212, 255, 0.1)';
    for (let x = gridSize / 2; x < w; x += gridSize) {
      for (let y = gridSize / 2; y < h; y += gridSize) {
        ctx.beginPath();
        ctx.arc(x, y, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Draw workspace items
    ws.items.forEach((item) => {
      this.drawWorkspaceItem(ctx, item, ws);
    });

    // Draw zoom level
    const zoomLevel = document.getElementById('zoomLevel');
    if (zoomLevel) {
      zoomLevel.textContent = `${Math.round(ws.zoom * 100)}%`;
    }
  }

  private drawWorkspaceItem(ctx: CanvasRenderingContext2D, item: WorkspaceItem, ws: WorkspaceData): void {
    const x = item.x + ws.offsetX;
    const y = item.y + ws.offsetY;
    const w = item.width;
    const h = item.height;
    const scale = ws.zoom;

    ctx.save();
    ctx.translate(x * scale, y * scale);
    ctx.scale(scale, scale);

    switch (item.type) {
      case 'note':
        // Draw sticky note
        ctx.fillStyle = item.color || '#ffeb3b';
        ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
        ctx.shadowBlur = 8;
        ctx.fillRect(0, 0, w, h);
        ctx.shadowColor = 'transparent';
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.font = '12px Arial';
        ctx.fillText(item.content || '', 10, 20);
        break;

      case 'drawing':
        // Draw strokes
        item.strokes?.forEach((stroke) => {
          ctx.strokeStyle = stroke.color;
          ctx.lineWidth = stroke.width;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.beginPath();
          stroke.points.forEach((point, idx) => {
            if (idx === 0) ctx.moveTo(point.x, point.y);
            else ctx.lineTo(point.x, point.y);
          });
          ctx.stroke();
        });
        break;

      case 'image':
        if (item.content) {
          const img = new Image();
          img.src = item.content;
          ctx.drawImage(img, 0, 0, w, h);
        }
        break;
    }

    ctx.restore();
  }

  private handleCanvasMouseDown(e: MouseEvent): void {
    const canvas = e.target as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / (this.currentModule?.workspace?.zoom || 1);
    const y = (e.clientY - rect.top) / (this.currentModule?.workspace?.zoom || 1);

    // Right-click for panning
    if (e.button === 2) {
      this.isPanning = true;
      this.lastPanX = x;
      this.lastPanY = y;
      return;
    }

    this.isDrawing = true;

    switch (this.workspaceTool) {
      case 'draw':
      case 'erase':
        this.startDrawing(x, y);
        break;
      case 'note':
        this.addNote(x, y);
        break;
      case 'image':
        this.triggerImageUpload();
        break;
    }
  }

  private handleCanvasMouseMove(e: MouseEvent): void {
    if (!this.isDrawing || !this.workspaceCanvas || this.workspaceTool !== 'draw' || !this.currentModule?.workspace)
      return;

    const canvas = this.workspaceCanvas;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / this.currentModule.workspace.zoom;
    const y = (e.clientY - rect.top) / this.currentModule.workspace.zoom;

    if (this.isPanning && this.currentModule.workspace) {
      const dx = x - this.lastPanX;
      const dy = y - this.lastPanY;
      this.currentModule.workspace.offsetX += dx;
      this.currentModule.workspace.offsetY += dy;
      this.lastPanX = x;
      this.lastPanY = y;
      this.drawWorkspace();
      return;
    }

    this.continueDrawing(x, y);
  }

  private handleCanvasMouseUp(): void {
    this.isDrawing = false;
    this.isPanning = false;
  }

  private handleCanvasWheel(e: WheelEvent): void {
    e.preventDefault();
    if (e.deltaY < 0) {
      this.zoom(0.1);
    } else {
      this.zoom(-0.1);
    }
  }

  private zoom(delta: number): void {
    if (!this.currentModule?.workspace) return;
    const ws = this.currentModule.workspace;
    ws.zoom = Math.max(0.1, Math.min(3, ws.zoom + delta));
    this.drawWorkspace();
  }

  private selectTool(toolId: string): void {
    const toolMap: { [key: string]: 'pointer' | 'note' | 'draw' | 'erase' | 'image' } = {
      toolPointer: 'pointer',
      toolNote: 'note',
      toolDraw: 'draw',
      toolErase: 'erase',
      toolImage: 'image',
    };
    this.workspaceTool = toolMap[toolId] || 'pointer';
    if (this.workspaceCanvas) {
      this.workspaceCanvas.classList.toggle('pan-cursor', this.workspaceTool === 'pointer');
      this.workspaceCanvas.classList.toggle('eraser-cursor', this.workspaceTool === 'erase');
    }
  }

  private startDrawing(x: number, y: number): void {
    if (!this.currentModule?.workspace) return;
    const ws = this.currentModule.workspace;
    const stroke: DrawingStroke = {
      points: [{ x, y }],
      color: this.workspaceTool === 'erase' ? '#0a0a0a' : this.drawColor,
      width: this.workspaceTool === 'erase' ? 20 : this.drawWidth,
    };

    let drawingItem = ws.items.find((item) => item.type === 'drawing' && item.zIndex === ws.items.length - 1);
    if (!drawingItem) {
      drawingItem = {
        id: Math.random().toString(36),
        type: 'drawing',
        x: 0,
        y: 0,
        width: this.workspaceCanvas?.width || 400,
        height: this.workspaceCanvas?.height || 300,
        strokes: [],
        zIndex: ws.items.length,
      };
      ws.items.push(drawingItem);
    }
    drawingItem.strokes?.push(stroke);
  }

  private continueDrawing(x: number, y: number): void {
    if (!this.currentModule?.workspace) return;
    const ws = this.currentModule.workspace;
    const drawingItem = ws.items[ws.items.length - 1];
    if (drawingItem?.strokes?.length) {
      drawingItem.strokes[drawingItem.strokes.length - 1].points.push({ x, y });
      this.drawWorkspace();
    }
  }

  private addNote(x: number, y: number): void {
    if (!this.currentModule?.workspace) return;
    const ws = this.currentModule.workspace;
    const note: WorkspaceItem = {
      id: Math.random().toString(36),
      type: 'note',
      x,
      y,
      width: 150,
      height: 150,
      content: 'New note',
      color: '#ffeb3b',
      zIndex: ws.items.length,
    };
    ws.items.push(note);
    this.drawWorkspace();
  }

  private triggerImageUpload(): void {
    // TODO: Implement image upload for workspace
    console.log('Image upload for workspace - to be implemented');
  }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new StudyTrackerApp();
});
