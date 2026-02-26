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
  type: 'note' | 'image' | 'drawing' | 'video' | 'pdf';
  x: number;
  y: number;
  width: number;
  height: number;
  content?: string; // For notes, images, video, pdf (data URL)
  color?: string; // For notes
  rotation?: number; // For images
  strokes?: DrawingStroke[]; // For drawings
  zIndex: number;
  name?: string; // Display label shown on the tile (editable via right-click)
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
  // Undo / Redo stacks (store serialized snapshots of `modules`)
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private isDrawing = false;
  private isPanning = false;
  private lastPanX = 0;
  private lastPanY = 0;
  private workspaceTool: 'pointer' | 'note' | 'draw' | 'erase' | 'image' = 'pointer';
  private drawColor = '#000000';
  private drawWidth = 2;
  private selectedItem: WorkspaceItem | null = null;
  private selectedItemOffsetX = 0;
  private selectedItemOffsetY = 0;
  private resizingItem: WorkspaceItem | null = null;
  private fullScreenImage: WorkspaceItem | null = null;
  private editingNoteId: string | null = null;
  private imageCache: Map<string, HTMLImageElement> = new Map();
  private currentStroke: DrawingStroke | null = null;

  constructor() {
    this.loadModules();
    // Initialize history with current state
    this.pushHistory();
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
        <div class="lightbox" id="imageLightbox" style="display: none;">
          <div class="lightbox-content">
            <button class="lightbox-close" id="closeLightbox">✕</button>
            <img class="lightbox-image" id="lightboxImage">
            <div class="lightbox-controls">
              <button id="lightboxZoomIn">🔍+</button>
              <button id="lightboxZoomOut">🔍-</button>
              <span id="lightboxZoomLevel">100%</span>
              <button id="lightboxRotateLeft">↺</button>
              <button id="lightboxRotateRight">↻</button>
            </div>
          </div>
        </div>
      `;

      // Append the media-viewer directly to document.body so it escapes #app's
      // stacking context and is guaranteed to render above the canvas.
      const mv = document.createElement('div');
      mv.id = 'mediaViewer';
      mv.className = 'media-viewer';
      // Inline all critical styles so this works even if the CSS file is stale
      mv.style.cssText = [
        'display: none',
        'position: fixed',
        'top: 0', 'right: 0', 'bottom: 0', 'left: 0',
        'background: rgba(0,0,0,0.92)',
        'align-items: center',
        'justify-content: center',
        'z-index: 2147483647',
      ].join(';');
      mv.innerHTML = `
        <div class="media-viewer-content" style="
          position: relative;
          background: #1a1a2e;
          border: 1px solid rgba(0,212,255,0.35);
          border-radius: 10px;
          padding: 52px 24px 24px;
          width: min(90vw, 960px);
          max-height: 90vh;
          overflow: hidden;
          box-shadow: 0 0 60px rgba(0,212,255,0.2), 0 20px 60px rgba(0,0,0,0.8);
        ">
          <button id="closeMediaViewer" style="
            position: absolute;
            top: 12px; right: 16px;
            background: rgba(0,212,255,0.08);
            border: 1px solid rgba(0,212,255,0.3);
            color: #00d4ff;
            width: 32px; height: 32px;
            border-radius: 50%;
            cursor: pointer;
            font-size: 16px;
            display: flex; align-items: center; justify-content: center;
            z-index: 1;
          ">✕</button>
          <div id="mediaViewerBody" style="width:100%;"></div>
        </div>
      `;
      document.body.appendChild(mv);
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

  private pushHistory(): void {
    try {
      const snapshot = JSON.stringify(this.modules);
      const last = this.undoStack[this.undoStack.length - 1];
      if (last === snapshot) return; // avoid duplicates
      this.undoStack.push(snapshot);
      // limit stack size
      if (this.undoStack.length > 100) this.undoStack.shift();
      // clear redo on new action
      this.redoStack = [];
    } catch (err) {
      console.error('Failed to push history', err);
    }
  }

  private undo(): void {
    if (this.undoStack.length < 2) return; // nothing to undo
    // Move current state to redo
    const current = this.undoStack.pop()!;
    this.redoStack.push(current);
    const prev = this.undoStack[this.undoStack.length - 1];
    if (!prev) return;
    try {
      this.modules = JSON.parse(prev);
      // restore currentModule reference if possible
      if (this.currentModule) {
        const found = this.modules.find((m) => m.id === this.currentModule!.id);
        this.currentModule = found || null;
        this.isDetailView = !!found;
      }
      this.saveModules();
      this.render();
    } catch (err) {
      console.error('Undo failed', err);
    }
  }

  private redo(): void {
    if (this.redoStack.length === 0) return;
    const next = this.redoStack.pop()!;
    try {
      this.modules = JSON.parse(next);
      // push restored state into undo stack as current
      this.undoStack.push(next);
      if (this.currentModule) {
        const found = this.modules.find((m) => m.id === this.currentModule!.id);
        this.currentModule = found || null;
        this.isDetailView = !!found;
      }
      this.saveModules();
      this.render();
    } catch (err) {
      console.error('Redo failed', err);
    }
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
          <button class="tool-btn" id="undoBtn" title="Undo">↶ Undo</button>
          <button class="tool-btn" id="redoBtn" title="Redo">↷ Redo</button>
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
            <button class="tool-btn" id="undoWorkspaceBtn" title="Undo">↶</button>
            <button class="tool-btn" id="redoWorkspaceBtn" title="Redo">↷</button>
            <button class="tool-btn" id="toolPointer" title="Select">➡</button>
            <button class="tool-btn" id="toolNote" title="Add Note">📝</button>
            <button class="tool-btn" id="toolDraw" title="Draw">✏</button>
            <button class="tool-btn" id="toolErase" title="Erase">🧹</button>
            <button class="tool-btn" id="toolMedia" title="Add Media (image, video, PDF)">📎</button>
            <input type="color" id="drawColor" value="#000000" title="Draw Color">
            <button class="tool-btn" id="clearWorkspaceBtn" title="Clear Workspace">🗑 Clear</button>
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
      // Wire undo/redo buttons and keyboard shortcuts
      const undoBtn = document.getElementById('undoBtn');
      const redoBtn = document.getElementById('redoBtn');
      const undoWsBtn = document.getElementById('undoWorkspaceBtn');
      const redoWsBtn = document.getElementById('redoWorkspaceBtn');
      if (undoBtn) undoBtn.addEventListener('click', () => this.undo());
      if (redoBtn) redoBtn.addEventListener('click', () => this.redo());
      if (undoWsBtn) undoWsBtn.addEventListener('click', () => this.undo());
      if (redoWsBtn) redoWsBtn.addEventListener('click', () => this.redo());

      // Keyboard shortcuts
      document.addEventListener('keydown', this.globalKeyHandler);
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
    this.pushHistory();
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
      this.pushHistory();
      console.log('Module deleted, remaining:', this.modules.length);
      this.render();
      console.log('Render complete after delete');
    }
  }

  // Keyboard handler bound to document; stored as property so we can remove if needed
  private globalKeyHandler = (e: KeyboardEvent) => {
    // Ctrl+Z / Cmd+Z
    const isUndo = (e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z');
    const isRedo = (e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y');
    if (isUndo) {
      e.preventDefault();
      this.undo();
    } else if (isRedo) {
      e.preventDefault();
      this.redo();
    }
  };

  private clearWorkspace(): void {
    if (!this.currentModule?.workspace) return;
    if (!confirm('This will permanently remove all items from the workspace. Continue?')) return;
    const ws = this.currentModule.workspace;
    ws.items = [];
    ws.offsetX = 0;
    ws.offsetY = 0;
    ws.zoom = 1;
    this.saveModules();
    this.pushHistory();
    this.drawWorkspace();
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

    // Clear workspace button
    const clearBtn = canvas.parentElement?.querySelector('#clearWorkspaceBtn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => this.clearWorkspace());
    }

    // Canvas events
    canvas.addEventListener('mousedown', (e) => this.handleCanvasMouseDown(e));
    canvas.addEventListener('mousemove', (e) => this.handleCanvasMouseMove(e));
    canvas.addEventListener('mouseup', () => this.handleCanvasMouseUp());
    canvas.addEventListener('mousewheel', (e) => this.handleCanvasWheel(e as any), { passive: false });
    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (this.workspaceTool !== 'pointer') return;
      const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
      const ws = this.currentModule?.workspace;
      if (!ws) return;
      const cx = (e.clientX - rect.left) / ws.zoom;
      const cy = (e.clientY - rect.top) / ws.zoom;
      const item = this.getItemAtPosition(cx, cy, ws);
      if (item && item.type !== 'drawing') {
        this.showContextMenu(e.clientX, e.clientY, item);
      }
    });

    // Resize canvas pixel buffer when container changes size (prevents stretching)
    const resizeObserver = new ResizeObserver(() => {
      if (!this.workspaceCanvas) return;
      const newW = this.workspaceCanvas.offsetWidth;
      const newH = this.workspaceCanvas.offsetHeight;
      if (newW > 0 && newH > 0 &&
          (this.workspaceCanvas.width !== newW || this.workspaceCanvas.height !== newH)) {
        this.workspaceCanvas.width = newW;
        this.workspaceCanvas.height = newH;
        this.drawWorkspace();
      }
    });
    resizeObserver.observe(canvas);

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

    // Draw workspace items (drawing layers rendered separately to isolate the eraser)
    ws.items.forEach((item) => {
      if (item.type === 'drawing') {
        this.renderDrawingLayer(ctx, item, ws);
      } else {
        this.drawWorkspaceItem(ctx, item, ws);
      }
    });

    // Draw zoom level
    const zoomLevel = document.getElementById('zoomLevel');
    if (zoomLevel) {
      zoomLevel.textContent = `${Math.round(ws.zoom * 100)}%`;
    }
  }

  // Render all drawing strokes onto an offscreen canvas so the eraser (destination-out)
  // only removes pixels from the drawing layer — never from the background.
  private renderDrawingLayer(ctx: CanvasRenderingContext2D, item: WorkspaceItem, ws: WorkspaceData): void {
    if (!this.workspaceCanvas || !item.strokes?.length) return;

    const offCanvas = document.createElement('canvas');
    offCanvas.width = this.workspaceCanvas.width;
    offCanvas.height = this.workspaceCanvas.height;
    const offCtx = offCanvas.getContext('2d')!;

    item.strokes.forEach((stroke) => {
      if ((stroke as any).isEraser) {
        offCtx.globalCompositeOperation = 'destination-out';
        offCtx.strokeStyle = 'rgba(0,0,0,1)';
      } else {
        offCtx.globalCompositeOperation = 'source-over';
        offCtx.strokeStyle = stroke.color;
      }
      offCtx.lineWidth = stroke.width * ws.zoom;
      offCtx.lineCap = 'round';
      offCtx.lineJoin = 'round';
      offCtx.beginPath();
      stroke.points.forEach((point, idx) => {
        // Convert from item-local space to canvas pixels: (local + offset) * zoom
        const px = (point.x + ws.offsetX) * ws.zoom;
        const py = (point.y + ws.offsetY) * ws.zoom;
        if (idx === 0) offCtx.moveTo(px, py);
        else offCtx.lineTo(px, py);
      });
      offCtx.stroke();
    });

    ctx.drawImage(offCanvas, 0, 0);
  }

  private handleCanvasMouseDown(e: MouseEvent): void {
    const canvas = e.target as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / (this.currentModule?.workspace?.zoom || 1);
    const y = (e.clientY - rect.top) / (this.currentModule?.workspace?.zoom || 1);
    const ws = this.currentModule?.workspace;

    // Right-click: context menu on items, pan on empty space
    if (e.button === 2) {
      if (this.workspaceTool === 'pointer') {
        const itemAtPos = this.getItemAtPosition(x, y, ws);
        if (itemAtPos && itemAtPos.type !== 'drawing') {
          // contextmenu event fires after mousedown and will show the menu
          return;
        }
      }
      this.isPanning = true;
      this.lastPanX = x;
      this.lastPanY = y;
      return;
    }

    // Pointer tool: select/move items
    if (this.workspaceTool === 'pointer') {
      const itemAtPos = this.getItemAtPosition(x, y, ws);
      if (itemAtPos) {
        this.selectedItem = itemAtPos;
        // Double-click: open viewer or edit note
        if (itemAtPos.type === 'image' && e.detail === 2) {
          this.openImageLightbox(itemAtPos);
          return;
        }
        if ((itemAtPos.type === 'video' || itemAtPos.type === 'pdf') && e.detail === 2) {
          this.openMediaViewer(itemAtPos);
          return;
        }
        if (itemAtPos.type === 'note' && e.detail === 2) {
          e.preventDefault(); // prevent Electron from reverting textarea focus
          this.isDrawing = false;  // cancel any drag that started on first click
          this.startEditingNote(itemAtPos);
          return;
        }
        // Single click: select and prepare for drag (offset accounts for workspace pan)
        this.selectedItemOffsetX = x - (itemAtPos.x + (ws?.offsetX || 0));
        this.selectedItemOffsetY = y - (itemAtPos.y + (ws?.offsetY || 0));
        this.isDrawing = true;
      } else {
        this.selectedItem = null;
      }
      this.drawWorkspace();
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
        this.triggerMediaUpload();
        break;
    }
  }

  private handleCanvasMouseMove(e: MouseEvent): void {
    if (!this.workspaceCanvas || !this.currentModule?.workspace) return;

    const canvas = this.workspaceCanvas;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / this.currentModule.workspace.zoom;
    const y = (e.clientY - rect.top) / this.currentModule.workspace.zoom;
    const ws = this.currentModule.workspace;

    // Panning
    if (this.isPanning) {
      const dx = x - this.lastPanX;
      const dy = y - this.lastPanY;
      ws.offsetX += dx;
      ws.offsetY += dy;
      this.lastPanX = x;
      this.lastPanY = y;
      this.drawWorkspace();
      return;
    }

    // Move selected item with pointer tool
    if (this.isDrawing && this.workspaceTool === 'pointer' && this.selectedItem) {
      this.selectedItem.x = x - this.selectedItemOffsetX - (ws?.offsetX || 0);
      this.selectedItem.y = y - this.selectedItemOffsetY - (ws?.offsetY || 0);
      this.drawWorkspace();
      return;
    }

    // Drawing
    if (this.isDrawing && (this.workspaceTool === 'draw' || this.workspaceTool === 'erase')) {
      this.continueDrawing(x, y);
    }
  }

  private handleCanvasMouseUp(): void {
    this.isDrawing = false;
    this.isPanning = false;
    this.currentStroke = null;
    // Save state after drawing/moving/resizing operations
    if (this.currentModule) {
      this.saveModules();
      this.pushHistory();
    }
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
      toolMedia: 'image', // 'image' is the internal tool type for all media
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
    // Store in item-local space (subtract offset) so strokes render correctly after panning
    const stroke: DrawingStroke = {
      points: [{ x: x - ws.offsetX, y: y - ws.offsetY }],
      color: this.drawColor,
      width: this.workspaceTool === 'erase' ? 15 : this.drawWidth,
    };

    // Mark as eraser stroke if using erase tool
    if (this.workspaceTool === 'erase') {
      (stroke as any).isEraser = true;
    }

    let drawingItem = ws.items.find((item) => item.type === 'drawing');
    if (!drawingItem) {
      drawingItem = {
        id: Math.random().toString(36),
        type: 'drawing',
        x: 0,
        y: 0,
        width: this.workspaceCanvas?.width || 400,
        height: this.workspaceCanvas?.height || 300,
        strokes: [],
        zIndex: 0,
      };
      // Insert at beginning so drawing layer stays behind notes and images
      ws.items.unshift(drawingItem);
    }
    drawingItem.strokes?.push(stroke);
    this.currentStroke = stroke;
  }

  private continueDrawing(x: number, y: number): void {
    if (!this.currentStroke || !this.currentModule?.workspace) return;
    const ws = this.currentModule.workspace;
    // Store in item-local space (subtract offset)
    this.currentStroke.points.push({ x: x - ws.offsetX, y: y - ws.offsetY });
    this.drawWorkspace();
  }

  private addNote(x: number, y: number): void {
    if (!this.currentModule?.workspace) return;
    const ws = this.currentModule.workspace;
    const note: WorkspaceItem = {
      id: Math.random().toString(36),
      type: 'note',
      // Store in item-local space (subtract offset) so notes appear where clicked
      x: x - ws.offsetX,
      y: y - ws.offsetY,
      width: 150,
      height: 150,
      content: 'Double-click to edit',
      color: '#ffeb3b',
      zIndex: ws.items.length,
    };
    ws.items.push(note);
    this.saveModules();
    this.pushHistory();
    this.drawWorkspace();
  }

  private triggerMediaUpload(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,video/*,.pdf,application/pdf';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (evt) => {
          const dataURL = evt.target?.result as string;
          this.addMediaToWorkspace(dataURL, file.type, file.name);
        };
        reader.readAsDataURL(file);
      }
    };
    input.click();
  }

  private addMediaToWorkspace(dataURL: string, mimeType: string, fileName?: string): void {
    if (!this.currentModule?.workspace) return;
    const ws = this.currentModule.workspace;

    let type: 'image' | 'video' | 'pdf' = 'image';
    if (mimeType.startsWith('video/')) type = 'video';
    else if (mimeType === 'application/pdf' || mimeType === 'pdf') type = 'pdf';

    // Use filename (without extension) as the default display name
    const name = fileName ? fileName.replace(/\.[^.]+$/, '') : undefined;

    const item: WorkspaceItem = {
      id: Math.random().toString(36),
      type,
      x: 100,
      y: 100,
      width: 200,
      height: type === 'video' ? 140 : 200,
      content: dataURL,
      rotation: 0,
      zIndex: ws.items.length,
      name,
    };
    ws.items.push(item);
    this.saveModules();
    this.pushHistory();
    this.drawWorkspace();
  }

  private drawWorkspaceItem(ctx: CanvasRenderingContext2D, item: WorkspaceItem, ws: WorkspaceData): void {
    const x = item.x + ws.offsetX;
    const y = item.y + ws.offsetY;
    const w = item.width;
    const h = item.height;
    const scale = ws.zoom;

    ctx.save();
    ctx.translate((x + w / 2) * scale, (y + h / 2) * scale);
    
    if (item.rotation) {
      ctx.rotate((item.rotation * Math.PI) / 180);
    }
    
    ctx.translate((-w / 2) * scale, (-h / 2) * scale);
    ctx.scale(scale, scale);

    // Draw selection highlight
    if (this.selectedItem?.id === item.id) {
      ctx.strokeStyle = '#00d4ff';
      ctx.lineWidth = 2;
      ctx.strokeRect(0, 0, w, h);
      // Draw resize handles
      ctx.fillStyle = '#00d4ff';
      const handleSize = 8;
      ctx.fillRect(w - handleSize, h - handleSize, handleSize, handleSize);
    }

    switch (item.type) {
      case 'note': {
        ctx.fillStyle = item.color || '#ffeb3b';
        ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
        ctx.shadowBlur = 8;
        ctx.fillRect(0, 0, w, h);
        ctx.shadowColor = 'transparent';

        let yOff = 8;
        // Optional title (name) rendered above the body text
        if (item.name) {
          ctx.fillStyle = 'rgba(0,0,0,0.7)';
          ctx.font = 'bold 11px Arial';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
          const titleLines = this.wrapText(ctx, item.name, w - 16);
          titleLines.forEach((l, i) => { if (yOff + i * 14 < h - 8) ctx.fillText(l, 8, yOff + i * 14); });
          yOff += titleLines.length * 14 + 4;
          ctx.strokeStyle = 'rgba(0,0,0,0.18)';
          ctx.lineWidth = 0.5;
          ctx.beginPath(); ctx.moveTo(8, yOff); ctx.lineTo(w - 8, yOff); ctx.stroke();
          yOff += 5;
        }
        ctx.fillStyle = 'rgba(0,0,0,0.8)';
        ctx.font = '12px Arial';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        const noteLines = this.wrapText(ctx, item.content || '', w - 16);
        noteLines.forEach((line, i) => { if (yOff + i * 16 < h - 8) ctx.fillText(line, 8, yOff + i * 16); });
        break;
      }

      case 'drawing':
        // Handled by renderDrawingLayer
        break;

      case 'video': {
        ctx.fillStyle = '#111827';
        ctx.fillRect(0, 0, w, h);
        const emojiSize = Math.round(Math.min(w, h) * 0.45);
        ctx.font = `${emojiSize}px serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🎬', w / 2, h / 2);
        // Name label bar at bottom
        const vLabel = item.name || 'Video';
        const vLabelH = 22;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(0, h - vLabelH, w, vLabelH);
        ctx.fillStyle = 'rgba(255,255,255,0.88)';
        ctx.font = `${Math.max(9, Math.min(11, w * 0.07))}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const vDN = vLabel.length > 24 ? vLabel.slice(0, 22) + '…' : vLabel;
        ctx.fillText(vDN, w / 2, h - vLabelH / 2);
        break;
      }

      case 'pdf': {
        ctx.fillStyle = '#1a0808';
        ctx.fillRect(0, 0, w, h);
        const pEmojiSize = Math.round(Math.min(w, h) * 0.45);
        ctx.font = `${pEmojiSize}px serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('📄', w / 2, h / 2);
        // Name label bar at bottom
        const pLabel = item.name || 'PDF Document';
        const pLabelH = 22;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(0, h - pLabelH, w, pLabelH);
        ctx.fillStyle = 'rgba(255,255,255,0.88)';
        ctx.font = `${Math.max(9, Math.min(11, w * 0.07))}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const pDN = pLabel.length > 24 ? pLabel.slice(0, 22) + '…' : pLabel;
        ctx.fillText(pDN, w / 2, h - pLabelH / 2);
        break;
      }

      case 'image':
        if (item.content) {
          const cached = this.imageCache.get(item.content);
          if (cached && cached.complete && cached.naturalWidth > 0) {
            ctx.drawImage(cached, 0, 0, w, h);
            // Name overlay at bottom when set
            if (item.name) {
              const iLabelH = 20;
              ctx.fillStyle = 'rgba(0,0,0,0.5)';
              ctx.fillRect(0, h - iLabelH, w, iLabelH);
              ctx.fillStyle = 'rgba(255,255,255,0.9)';
              ctx.font = `${Math.max(9, Math.min(11, w * 0.07))}px Arial`;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              const iDN = item.name.length > 24 ? item.name.slice(0, 22) + '…' : item.name;
              ctx.fillText(iDN, w / 2, h - iLabelH / 2);
            }
          } else {
            if (!cached) {
              const img = new Image();
              this.imageCache.set(item.content, img);
              img.onload = () => this.drawWorkspace();
              img.src = item.content;
            }
            // Emoji placeholder while loading
            ctx.fillStyle = '#1a1a2e';
            ctx.fillRect(0, 0, w, h);
            ctx.font = `${Math.round(Math.min(w, h) * 0.35)}px serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('🖼️', w / 2, h / 2);
          }
        }
        break;
    }

    ctx.restore();
  }
  private wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
    const lines: string[] = [];
    for (const paragraph of text.split('\n')) {
      if (!paragraph) { lines.push(''); continue; }
      const words = paragraph.split(' ');
      let current = '';
      for (const word of words) {
        const test = current ? current + ' ' + word : word;
        if (ctx.measureText(test).width > maxWidth && current) {
          lines.push(current);
          current = word;
        } else {
          current = test;
        }
      }
      if (current) lines.push(current);
    }
    return lines;
  }

  private getItemAtPosition(x: number, y: number, ws?: WorkspaceData): WorkspaceItem | null {
    if (!ws) return null;
    // Check items in reverse order (top to bottom), skip drawing layers
    for (let i = ws.items.length - 1; i >= 0; i--) {
      const item = ws.items[i];
      if (item.type === 'drawing') continue; // drawing layers are not individually selectable
      // Items are rendered at (item.x + offsetX) * zoom, so hit-test in world space using offset
      const itemX = item.x + ws.offsetX;
      const itemY = item.y + ws.offsetY;
      if (x >= itemX && x <= itemX + item.width && y >= itemY && y <= itemY + item.height) {
        return item;
      }
    }
    return null;
  }

  private openImageLightbox(item: WorkspaceItem): void {
    if (item.type !== 'image' || !item.content) return;
    this.fullScreenImage = item;
    const lightbox = document.getElementById('imageLightbox');
    const img = document.getElementById('lightboxImage') as HTMLImageElement;
    if (lightbox && img) {
      img.src = item.content;
      lightbox.classList.add('show');
      this.setupLightboxControls();
    }
  }

  private closeLightbox(): void {
    const lightbox = document.getElementById('imageLightbox');
    if (lightbox) {
      lightbox.classList.remove('show');
    }
    this.fullScreenImage = null;
  }

  private setupLightboxControls(): void {
    const closeBtn = document.getElementById('closeLightbox');
    const zoomInBtn = document.getElementById('lightboxZoomIn');
    const zoomOutBtn = document.getElementById('lightboxZoomOut');
    const rotateLeftBtn = document.getElementById('lightboxRotateLeft');
    const rotateRightBtn = document.getElementById('lightboxRotateRight');

    if (closeBtn) closeBtn.onclick = () => this.closeLightbox();
    if (zoomInBtn) zoomInBtn.onclick = () => this.lightboxZoom(0.1);
    if (zoomOutBtn) zoomOutBtn.onclick = () => this.lightboxZoom(-0.1);
    if (rotateLeftBtn) rotateLeftBtn.onclick = () => this.lightboxRotate(-15);
    if (rotateRightBtn) rotateRightBtn.onclick = () => this.lightboxRotate(15);
  }

  private lightboxZoom(delta: number): void {
    if (!this.fullScreenImage) return;
    const img = document.getElementById('lightboxImage') as HTMLImageElement;
    const zoomLevel = document.getElementById('lightboxZoomLevel');
    if (!img.style.scale) img.style.scale = '1';
    const currentScale = parseFloat(img.style.scale) || 1;
    const newScale = Math.max(0.1, Math.min(3, currentScale + delta));
    img.style.scale = newScale.toString();
    if (zoomLevel) zoomLevel.textContent = `${Math.round(newScale * 100)}%`;
  }

  private lightboxRotate(delta: number): void {
    const img = document.getElementById('lightboxImage') as HTMLImageElement;
    if (!img.style.rotate) img.style.rotate = '0deg';
    const currentRotation = parseFloat(img.style.rotate) || 0;
    const newRotation = (currentRotation + delta) % 360;
    img.style.rotate = newRotation + 'deg';
    if (this.fullScreenImage) {
      this.fullScreenImage.rotation = newRotation;
    }
  }

  private startEditingNote(item: WorkspaceItem): void {
    if (item.type !== 'note' || !this.workspaceCanvas) return;
    const ws = this.currentModule?.workspace;
    if (!ws) return;

    this.editingNoteId = item.id;

    // Position the textarea exactly over the note on screen
    const canvasRect = this.workspaceCanvas.getBoundingClientRect();
    const noteScreenX = (item.x + ws.offsetX) * ws.zoom;
    const noteScreenY = (item.y + ws.offsetY) * ws.zoom;
    const noteScreenW = item.width * ws.zoom;
    const noteScreenH = item.height * ws.zoom;

    const textarea = document.createElement('textarea');
    textarea.value = item.content || '';
    textarea.style.cssText = `
      position: fixed;
      left: ${canvasRect.left + noteScreenX}px;
      top: ${canvasRect.top + noteScreenY}px;
      width: ${noteScreenW}px;
      height: ${noteScreenH}px;
      background: ${item.color || '#ffeb3b'};
      border: 2px solid #00d4ff;
      padding: 6px 8px;
      font: 12px Arial, sans-serif;
      color: rgba(0,0,0,0.85);
      resize: none;
      z-index: 10000;
      box-sizing: border-box;
      outline: none;
      border-radius: 2px;
      overflow: auto;
    `;
    document.body.appendChild(textarea);
    // Defer focus so Electron doesn't revert it during the mousedown event
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.select();
    });

    const finish = () => {
      if (!document.body.contains(textarea)) return;
      item.content = textarea.value;
      document.body.removeChild(textarea);
      this.editingNoteId = null;
      this.saveModules();
      this.pushHistory();
      this.drawWorkspace();
    };

    // Defer blur listener attachment to avoid it firing on the initial focus
    requestAnimationFrame(() => textarea.addEventListener('blur', finish));
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (document.body.contains(textarea)) {
          document.body.removeChild(textarea);
          this.editingNoteId = null;
          this.drawWorkspace();
        }
      } else if (e.key === 'Enter' && e.ctrlKey) {
        finish();
      }
      e.stopPropagation(); // prevent workspace keyboard shortcuts while editing
    });
  }

  private openMediaViewer(item: WorkspaceItem): void {
    if ((item.type !== 'video' && item.type !== 'pdf') || !item.content) return;
    const viewer = document.getElementById('mediaViewer');
    const body = document.getElementById('mediaViewerBody');
    if (!viewer || !body) return;

    body.innerHTML = '';
    if (item.type === 'video') {
      const video = document.createElement('video');
      video.src = item.content;
      video.controls = true;
      video.autoplay = true;
      video.style.cssText = 'max-width:100%;max-height:70vh;display:block;margin:0 auto;border-radius:6px;background:#000;';
      body.appendChild(video);
    } else {
      // iframe works better than embed for PDFs in Electron
      const iframe = document.createElement('iframe');
      iframe.src = item.content;
      iframe.style.cssText = 'width:100%;height:70vh;border:none;border-radius:6px;background:#fff;';
      body.appendChild(iframe);
    }

    viewer.style.display = 'flex';

    const closeBtn = document.getElementById('closeMediaViewer');
    if (closeBtn) closeBtn.onclick = () => this.closeMediaViewer();

    // Backdrop click closes viewer (use named handler so it can be removed)
    const backdropHandler = (e: MouseEvent) => {
      if (e.target === viewer) {
        this.closeMediaViewer();
        viewer.removeEventListener('click', backdropHandler);
      }
    };
    viewer.addEventListener('click', backdropHandler);
  }

  private closeMediaViewer(): void {
    const viewer = document.getElementById('mediaViewer');
    if (!viewer) return;
    viewer.style.display = 'none';
    const body = document.getElementById('mediaViewerBody');
    if (body) body.innerHTML = ''; // stop video/pdf playback
  }

  // ===== CONTEXT MENU =====

  private showContextMenu(screenX: number, screenY: number, item: WorkspaceItem): void {
    this.hideContextMenu();

    const menu = document.createElement('div');
    menu.id = 'wsContextMenu';
    menu.style.cssText = `
      position: fixed;
      left: ${screenX}px; top: ${screenY}px;
      background: #1a1a2e;
      border: 1px solid rgba(0,212,255,0.3);
      border-radius: 6px;
      padding: 4px 0;
      z-index: 2147483646;
      min-width: 150px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.7);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    `;

    const makeBtn = (label: string, onClick: () => void) => {
      const btn = document.createElement('button');
      btn.textContent = label;
      btn.style.cssText = `
        display: block; width: 100%; padding: 8px 16px;
        background: none; border: none; color: #fff;
        text-align: left; cursor: pointer; font-size: 13px;
        white-space: nowrap;
      `;
      btn.onmouseover = () => { btn.style.background = 'rgba(0,212,255,0.12)'; };
      btn.onmouseout  = () => { btn.style.background = 'none'; };
      btn.onclick = () => { this.hideContextMenu(); onClick(); };
      return btn;
    };

    menu.appendChild(makeBtn('✏  Rename', () => this.startRenamingItem(item)));
    menu.appendChild(makeBtn('🗑  Delete', () => this.deleteWorkspaceItem(item)));
    document.body.appendChild(menu);

    // Nudge menu back on-screen if it overflows
    requestAnimationFrame(() => {
      const r = menu.getBoundingClientRect();
      if (r.right  > window.innerWidth)  menu.style.left = `${screenX - r.width}px`;
      if (r.bottom > window.innerHeight) menu.style.top  = `${screenY - r.height}px`;
    });

    // Click outside closes the menu
    const closeHandler = (e: MouseEvent) => {
      if (!menu.contains(e.target as Node)) {
        this.hideContextMenu();
        document.removeEventListener('mousedown', closeHandler, true);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', closeHandler, true), 0);
  }

  private hideContextMenu(): void {
    const el = document.getElementById('wsContextMenu');
    if (el?.parentNode) el.parentNode.removeChild(el);
  }

  private deleteWorkspaceItem(item: WorkspaceItem): void {
    if (!this.currentModule?.workspace) return;
    this.currentModule.workspace.items = this.currentModule.workspace.items.filter(i => i.id !== item.id);
    if (this.selectedItem?.id === item.id) this.selectedItem = null;
    this.saveModules();
    this.pushHistory();
    this.drawWorkspace();
  }

  private startRenamingItem(item: WorkspaceItem): void {
    if (!this.workspaceCanvas) return;
    const ws = this.currentModule?.workspace;
    if (!ws) return;

    const canvasRect = this.workspaceCanvas.getBoundingClientRect();
    const itemScreenX = (item.x + ws.offsetX) * ws.zoom + canvasRect.left;
    const itemScreenW = item.width * ws.zoom;
    // Position the input over the name label bar at the bottom of the tile
    const labelBarTop = (item.y + ws.offsetY + item.height) * ws.zoom + canvasRect.top - 26;

    const input = document.createElement('input');
    input.type = 'text';
    input.value = item.name || '';
    input.placeholder = this.getDefaultItemName(item.type);
    input.style.cssText = `
      position: fixed;
      left: ${itemScreenX}px; top: ${labelBarTop}px;
      width: ${itemScreenW}px; height: 26px;
      background: rgba(10,10,30,0.97);
      border: 1px solid #00d4ff; border-radius: 3px;
      color: #fff; font: 12px Arial, sans-serif;
      padding: 2px 8px; z-index: 2147483645;
      outline: none; box-sizing: border-box;
    `;
    document.body.appendChild(input);
    requestAnimationFrame(() => { input.focus(); input.select(); });

    const finish = () => {
      if (!document.body.contains(input)) return;
      item.name = input.value.trim() || undefined;
      document.body.removeChild(input);
      this.saveModules();
      this.drawWorkspace();
    };
    requestAnimationFrame(() => input.addEventListener('blur', finish));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish();
      else if (e.key === 'Escape') { if (document.body.contains(input)) document.body.removeChild(input); }
      e.stopPropagation();
    });
  }

  private getDefaultItemName(type: WorkspaceItem['type']): string {
    const map: Partial<Record<WorkspaceItem['type'], string>> = {
      image: 'Image', video: 'Video', pdf: 'PDF Document', note: 'Note',
    };
    return map[type] ?? 'Item';
  }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new StudyTrackerApp();
});
