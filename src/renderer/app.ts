interface Module {
  id: string;
  name: string;
  description: string;
  image?: string; // Base64 or image path
  createdAt: number;
}

class StudyTrackerApp {
  private modules: Module[] = [];
  private currentModule: Module | null = null;
  private isDetailView = false;
  private storageKey = 'study-tracker-modules';

  constructor() {
    this.loadModules();
    this.render();
    this.attachEventListeners();
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
    const root = document.getElementById('app');
    if (!root) return;

    if (this.isDetailView && this.currentModule) {
      root.innerHTML = this.renderDetailView();
    } else {
      root.innerHTML = this.renderMainView();
    }

    this.attachEventListeners();
  }

  private renderMainView(): string {
    return `
      <div class="header">
        <h1>Study Modules</h1>
        <button class="add-module-btn" id="addModuleBtn">+ New Module</button>
      </div>
      <div class="main-content">
        <div class="module-grid" id="moduleGrid">
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
      ${this.renderModalMarkup()}
    `;
  }

  private renderModuleCard(module: Module): string {
    const hasImage = module.image && module.image.startsWith('data:');
    
    return `
      <div class="module-card" data-module-id="${module.id}">
        ${
          hasImage
            ? `<img class="card-background" src="${module.image}" alt="${module.name}">`
            : `<div class="card-placeholder"><div class="card-title">${this.escapeHtml(module.name)}</div></div>`
        }
        <div class="card-overlay"></div>
        <div class="card-content">
          <div class="card-title">${this.escapeHtml(module.name)}</div>
          <div class="card-description">${this.escapeHtml(module.description)}</div>
        </div>
      </div>
    `;
  }

  private renderDetailView(): string {
    if (!this.currentModule) return '';

    const hasImage = this.currentModule.image && this.currentModule.image.startsWith('data:');

    return `
      <div class="detail-view">
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
    `;
  }

  private renderModalMarkup(): string {
    return `
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

  private attachEventListeners(): void {
    // Main view events
    const addModuleBtn = document.getElementById('addModuleBtn');
    if (addModuleBtn) {
      addModuleBtn.addEventListener('click', () => this.openAddModuleModal());
    }

    // Module card clicks
    const moduleCards = document.querySelectorAll('.module-card');
    moduleCards.forEach((card) => {
      card.addEventListener('click', () => {
        const moduleId = (card as HTMLElement).dataset.moduleId;
        this.openDetailView(moduleId!);
      });
    });

    // Detail view back button
    const backBtn = document.getElementById('backBtn');
    if (backBtn) {
      backBtn.addEventListener('click', () => this.closeDetailView());
    }

    // Modal events
    const modalOverlay = document.getElementById('modalOverlay');
    const cancelBtn = document.getElementById('cancelBtn');
    const addModuleForm = document.getElementById('addModuleForm') as HTMLFormElement;
    const imageUploadArea = document.getElementById('imageUploadArea');
    const imageInput = document.getElementById('imageInput') as HTMLInputElement;
    const imagePreview = document.getElementById('imagePreview') as HTMLImageElement;

    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => this.closeAddModuleModal());
    }

    if (modalOverlay) {
      modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay) {
          this.closeAddModuleModal();
        }
      });
    }

    if (imageUploadArea) {
      imageUploadArea.addEventListener('click', () => imageInput?.click());
      imageUploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        imageUploadArea.style.background = 'rgba(0, 212, 255, 0.1)';
      });
      imageUploadArea.addEventListener('dragleave', () => {
        imageUploadArea.style.background = 'rgba(0, 212, 255, 0.02)';
      });
      imageUploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        imageUploadArea.style.background = 'rgba(0, 212, 255, 0.02)';
        const files = e.dataTransfer?.files;
        if (files) this.handleImageUpload(files[0], imagePreview);
      });
    }

    if (imageInput) {
      imageInput.addEventListener('change', (e) => {
        const files = (e.target as HTMLInputElement).files;
        if (files) this.handleImageUpload(files[0], imagePreview);
      });
    }

    if (addModuleForm) {
      addModuleForm.addEventListener('submit', (e) => this.handleAddModule(e, imagePreview));
    }
  }

  private handleImageUpload(file: File, previewElement: HTMLImageElement): void {
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      previewElement.src = result;
      previewElement.style.display = 'block';
      // Store the base64 in a data attribute
      (previewElement.parentElement as HTMLElement).dataset.imageData = result;
    };
    reader.readAsDataURL(file);
  }

  private handleAddModule(e: Event, imagePreview: HTMLImageElement): void {
    e.preventDefault();

    const nameInput = document.getElementById('moduleName') as HTMLInputElement;
    const descriptionInput = document.getElementById('moduleDescription') as HTMLTextAreaElement;

    const module: Module = {
      id: Date.now().toString(),
      name: nameInput.value.trim(),
      description: descriptionInput.value.trim(),
      image: imagePreview.style.display !== 'none' ? imagePreview.src : undefined,
      createdAt: Date.now(),
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

    if (modalOverlay) {
      modalOverlay.style.display = 'flex';
      // Reset form
      if (imagePreview) {
        imagePreview.style.display = 'none';
        imagePreview.src = '';
      }
      if (imageInput) imageInput.value = '';
      const form = document.getElementById('addModuleForm') as HTMLFormElement;
      if (form) form.reset();
    }
  }

  private closeAddModuleModal(): void {
    const modalOverlay = document.getElementById('modalOverlay');
    if (modalOverlay) {
      modalOverlay.style.display = 'none';
    }
  }

  private openDetailView(moduleId: string): void {
    const module = this.modules.find((m) => m.id === moduleId);
    if (module) {
      this.currentModule = module;
      this.isDetailView = true;
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
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new StudyTrackerApp();
});
