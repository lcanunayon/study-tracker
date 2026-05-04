import { auth, fbSignIn, fbSignUp, fbSignOut, onAuthStateChanged, saveUserModules, loadUserModules, saveUserBackup, loadUserBackup } from './firebase';
import type { User } from './firebase';

interface ArchiveGroup {
  id: string;
  name: string;
  createdAt: number;
}

interface Module {
  id: string;
  name: string;
  description: string;
  image?: string; // Base64 or image path
  createdAt: number;
  workspace?: WorkspaceData;
  studyTime?: number; // total seconds studied, persisted across sessions
  archived?: boolean;
  archiveGroupId?: string;
}

interface FolderFile {
  id: string;
  name: string;
  mimeType: string;
  content: string; // data URL
}

interface WorkspaceItem {
  id: string;
  type: 'note' | 'image' | 'drawing' | 'video' | 'pdf' | 'text' | 'folder';
  x: number;
  y: number;
  width: number;
  height: number;
  content?: string; // For notes, images, video, pdf (data URL), text
  color?: string; // For notes and text
  rotation?: number; // For images
  strokes?: DrawingStroke[]; // For drawings
  zIndex: number;
  name?: string; // Display label shown on the tile (editable via right-click)
  fontSize?: number; // For text items
  fontFamily?: string; // For text items
  files?: FolderFile[]; // For folder items
}

interface DrawingStroke {
  points: { x: number; y: number }[];
  color: string;
  width: number;
}

interface Connection {
  id: string;
  fromId: string;
  toId: string;
}

interface WorkspaceData {
  items: WorkspaceItem[];
  offsetX: number;
  offsetY: number;
  zoom: number;
  connections?: Connection[];
}

interface RoadmapNode {
  id: string;
  itemId: string;
  label: string;
  level: number;
  reason: string;
  x: number;
  y: number;
}

interface RoadmapEdge {
  from: string;
  to: string;
}

class StudyTrackerApp {
  private modules: Module[] = [];
  private archiveGroups: ArchiveGroup[] = [];
  private currentModule: Module | null = null;
  private isDetailView = false;
  private isEditMode = false;
  private isArchiveView = false;
  private isSelectMode = false;
  private selectedModuleIds: Set<string> = new Set();
  private pendingBulkArchiveIds: string[] = [];
  private editingModuleId: string | null = null;
  private draggedModule: Module | null = null;
  private storageKey = 'study-tracker-modules';
  private archiveStorageKey = 'study-tracker-archive-groups';
  private storageUidKey = 'study-tracker-uid';
  private detailViewAnimDone = false;
  // Archive modal state
  private currentRenamingGroupId: string | null = null;
  private currentMovingModuleId: string | null = null;

  // Settings & theme
  private isSettingsView = false;
  private theme: 'dark' | 'light' = 'dark';
  private backupStatus = '';
  private lastCloudBackupTime: number | null = null;

  // Auth
  private currentUser: User | null = null;
  private authReady = false;
  private authMode: 'login' | 'signup' = 'login';
  private fbSyncTimer: ReturnType<typeof setTimeout> | null = null;

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
  private workspaceTool: 'pointer' | 'note' | 'draw' | 'erase' | 'image' | 'text' | 'connect' | 'folder' = 'pointer';
  private drawColor = '#000000';
  private drawWidth = 2;
  private eraseWidth = 20;
  private defaultFontSize = 16;
  private defaultFontFamily = 'Arial';
  private selectedItem: WorkspaceItem | null = null;
  private selectedItemOffsetX = 0;
  private selectedItemOffsetY = 0;
  private resizingItem: WorkspaceItem | null = null;
  private resizeStartX = 0;
  private resizeStartY = 0;
  private resizeStartW = 0;
  private resizeStartH = 0;
  private fullScreenImage: WorkspaceItem | null = null;
  private editingNoteId: string | null = null;
  private imageCache: Map<string, HTMLImageElement> = new Map();
  private currentStroke: DrawingStroke | null = null;
  private connectFirstItem: WorkspaceItem | null = null;
  private mouseCanvasX = 0;
  private mouseCanvasY = 0;
  private folderPopupItemId: string | null = null;
  private dragOverFolderId: string | null = null;

  // Multi-select & AI Roadmap
  private selectedWorkspaceItems: Set<string> = new Set();
  private roadmapNodes: RoadmapNode[] = [];
  private roadmapEdges: RoadmapEdge[] = [];
  private roadmapTitle = '';
  private roadmapExplanation = '';
  private roadmapDragNodeId: string | null = null;
  private roadmapDragStartX = 0;
  private roadmapDragStartY = 0;
  private roadmapNodeStartX = 0;
  private roadmapNodeStartY = 0;
  private aiApiKey = '';

  // Timer properties
  private timerMode: 'stopwatch' | 'pomodoro' = 'stopwatch';
  private timerRunning = false;
  private timerInterval: ReturnType<typeof setInterval> | null = null;
  private resetConfirmPending = false;
  // Stopwatch — base holds accumulated seconds before the last Start press
  private stopwatchSeconds = 0;
  private swBaseSeconds = 0;
  private swStartTs = 0; // Date.now() when last started
  // Pomodoro
  private pomodoroPhase: 'work' | 'break' = 'work';
  private pomodoroSecondsLeft = 25 * 60;
  private pomodoroPhaseStartTs = 0; // Date.now() when the current phase began
  private pomodoroLastWorkSec = 0;  // work-seconds already credited this phase (for delta)
  // Session — non-persisted, resets when opening a module or clicking Reset
  private sessionSeconds = 0;

  constructor() {
    this.theme = (localStorage.getItem('study-tracker-theme') as 'dark' | 'light') || 'dark';
    this.aiApiKey = localStorage.getItem('study-tracker-ai-key') || '';
    this.applyTheme();
    this.loadModules();
    this.pushHistory();
    this.initializeHTML();
    this.render();
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.timerRunning) this.timerTick();
    });

    // Firebase auth: re-render on login/logout, load cloud data on sign-in
    onAuthStateChanged(auth, async (user) => {
      this.currentUser = user;
      if (user) {
        const storedUid = localStorage.getItem(this.storageUidKey);
        const isSameUser = storedUid === user.uid;
        try {
          const cloud = await loadUserModules(user.uid);
          const cloudModules = cloud?.modules as Module[] | null;
          const cloudArchiveGroups = (cloud?.archiveGroups as ArchiveGroup[]) ?? [];
          if (!isSameUser) {
            // Switching accounts — cloud data is authoritative
            if (cloudModules && cloudModules.length > 0) {
              this.modules = cloudModules;
              this.archiveGroups = cloudArchiveGroups;
            } else {
              this.modules = [];
              this.archiveGroups = [];
              localStorage.removeItem(this.storageKey);
              localStorage.removeItem(this.archiveStorageKey);
            }
            localStorage.setItem(this.storageUidKey, user.uid);
            localStorage.setItem(this.storageKey, JSON.stringify(this.modules));
            localStorage.setItem(this.archiveStorageKey, JSON.stringify(this.archiveGroups));
            this.undoStack = [];
            this.pushHistory();
          } else if (cloudModules && cloudModules.length > 0) {
            // Same user — only use cloud data if local is empty or cloud has more data
            const localIsEmpty = this.modules.length === 0;
            const cloudHasMore = cloudModules.length > this.modules.length;
            // Pick whichever has the most recently modified module
            const localLatest = this.modules.reduce((max, m) => Math.max(max, m.createdAt), 0);
            const cloudLatest = cloudModules.reduce((max, m) => Math.max(max, m.createdAt), 0);
            if (localIsEmpty || cloudHasMore || cloudLatest > localLatest) {
              this.modules = cloudModules;
              this.archiveGroups = cloudArchiveGroups;
              localStorage.setItem(this.storageKey, JSON.stringify(this.modules));
              localStorage.setItem(this.archiveStorageKey, JSON.stringify(this.archiveGroups));
              this.undoStack = [];
              this.pushHistory();
            } else {
              // Local is at least as fresh — push local to cloud to keep in sync
              if (this.fbSyncTimer) clearTimeout(this.fbSyncTimer);
              this.fbSyncTimer = setTimeout(() => this.syncToFirestore(), 2000);
            }
          }
          // Same user + no cloud data: keep localStorage as-is
        } catch (e) {
          console.error('Firestore load failed:', e);
          if (!isSameUser) { this.modules = []; this.archiveGroups = []; } // don't leak another user's data
        }
      } else {
        // Logged out — preserve localStorage so same user can restore on next login
        this.currentModule = null;
        this.isDetailView = false;
        this.isArchiveView = false;
      }
      this.authReady = true;
      this.render();
    });
  }

  private initializeHTML(): void {
    const root = document.getElementById('app');
    if (root) {
      root.innerHTML = `
        <div class="main-container" id="mainContainer"></div>
        <div class="modal-overlay" id="editModuleOverlay" style="display: none;">
          <div class="modal" id="editModuleModal">
            <h2>Edit Module</h2>
            <form id="editModuleForm">
              <input type="hidden" id="editModuleId">
              <div class="form-group">
                <label for="editModuleName">Module Name *</label>
                <input type="text" id="editModuleName" placeholder="e.g., React Hooks" required>
              </div>
              <div class="form-group">
                <label for="editModuleDescription">Description *</label>
                <textarea id="editModuleDescription" placeholder="What does this module teach?" required></textarea>
              </div>
              <div class="form-group">
                <label>Module Cover Image</label>
                <div class="image-upload-area" id="editImageUploadArea">
                  <input type="file" id="editImageInput" accept="image/*">
                  <div class="upload-text">Click to upload or drag & drop an image</div>
                </div>
                <img id="editImagePreview" class="image-preview" style="display: none;" alt="Preview">
                <button type="button" class="btn btn-secondary" id="editRemoveImageBtn" style="margin-top:8px;display:none;">Remove Image</button>
              </div>
              <div class="form-actions">
                <button type="button" class="btn btn-secondary" id="editCancelBtn">Cancel</button>
                <button type="submit" class="btn btn-primary">Save Changes</button>
              </div>
            </form>
          </div>
        </div>
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

        <!-- Archive module modal -->
        <div class="modal-overlay" id="archiveModuleOverlay" style="display: none;">
          <div class="modal" id="archiveModuleModal">
            <h2>Archive Module</h2>
            <p class="archive-modal-subtitle">Archiving: <strong id="archivingModuleName"></strong></p>
            <div class="form-group">
              <label for="archiveGroupSelect">Archive Group</label>
              <select id="archiveGroupSelect" class="archive-select"></select>
            </div>
            <div class="form-group" id="archiveNewGroupRow" style="display:none;">
              <label for="archiveNewGroupInput">New Group Name</label>
              <input type="text" id="archiveNewGroupInput" placeholder="e.g., Semester 1">
            </div>
            <div class="form-actions">
              <button type="button" class="btn btn-secondary" id="archiveCancelBtn">Cancel</button>
              <button type="button" class="btn btn-primary" id="archiveConfirmBtn">Archive</button>
            </div>
          </div>
        </div>

        <!-- Archive group create/rename modal -->
        <div class="modal-overlay" id="archiveGroupOverlay" style="display: none;">
          <div class="modal" id="archiveGroupModal">
            <h2 id="archiveGroupModalTitle">New Archive Group</h2>
            <div class="form-group">
              <label for="archiveGroupNameInput">Group Name</label>
              <input type="text" id="archiveGroupNameInput" placeholder="e.g., Semester 1">
            </div>
            <div class="form-actions">
              <button type="button" class="btn btn-secondary" id="archiveGroupCancelBtn">Cancel</button>
              <button type="button" class="btn btn-primary" id="archiveGroupConfirmBtn">Save</button>
            </div>
          </div>
        </div>

        <!-- Move-to-group modal -->
        <div class="modal-overlay" id="moveGroupOverlay" style="display: none;">
          <div class="modal" id="moveGroupModal">
            <h2>Move to Archive Group</h2>
            <div class="form-group">
              <label for="moveGroupSelect">Select Group</label>
              <select id="moveGroupSelect" class="archive-select"></select>
            </div>
            <div class="form-actions">
              <button type="button" class="btn btn-secondary" id="moveGroupCancelBtn">Cancel</button>
              <button type="button" class="btn btn-primary" id="moveGroupConfirmBtn">Move</button>
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

      this.buildWelcomeScreen();
    }
  }

  private buildWelcomeScreen(): void {
    const overlay = document.createElement('div');
    overlay.id = 'welcomeScreen';
    overlay.style.cssText = [
      'display:none',
      'position:fixed',
      'top:0','left:0','right:0','bottom:0',
      'background:rgba(0,0,0,0.88)',
      'z-index:999998',
      'align-items:center',
      'justify-content:center',
      'padding:20px',
    ].join(';');

    overlay.innerHTML = `
      <div style='background:#0f0f1a;border:1px solid rgba(0,212,255,0.3);border-radius:12px;width:min(820px,100%);max-height:88vh;overflow-y:auto;position:relative;box-shadow:0 0 80px rgba(0,212,255,0.12),0 20px 60px rgba(0,0,0,0.9);scrollbar-width:thin;scrollbar-color:rgba(0,212,255,0.25) transparent;'>

        <!-- Close -->
        <button id='welcomeClose' style='position:absolute;top:14px;right:14px;background:rgba(0,212,255,0.08);border:1px solid rgba(0,212,255,0.25);color:#00d4ff;width:30px;height:30px;border-radius:50%;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center;z-index:1;'>✕</button>

        <!-- Header -->
        <div style='padding:40px 40px 0;text-align:center;'>
          <div style='font-size:52px;margin-bottom:14px;'>📚</div>
          <h1 style='color:#00d4ff;font-size:26px;font-weight:700;margin:0 0 10px;letter-spacing:-0.3px;'>Welcome to Study Tracker</h1>
          <p style='color:rgba(255,255,255,0.55);font-size:14px;max-width:540px;margin:0 auto;line-height:1.7;'>Your all-in-one visual study workspace. Organize modules, take notes, draw diagrams, connect ideas, and manage files — all on an infinite canvas.</p>
        </div>

        <!-- Overview image slot -->
        <div style='padding:24px 40px 0;'>
          <img src='./assets/welcome-overview.jpg' alt='Workspace overview' style='width:100%;border-radius:8px;display:block;' onerror='this.style.display="none";this.nextElementSibling.style.display="flex";'>
          <div style='display:none;background:#111827;border:2px dashed rgba(0,212,255,0.18);border-radius:8px;height:170px;flex-direction:column;align-items:center;justify-content:center;gap:8px;'>
            <span style='font-size:32px;'>🖼</span>
            <span style='color:rgba(255,255,255,0.35);font-size:13px;'>Workspace overview screenshot</span>
            <span style='color:rgba(0,212,255,0.45);font-size:11px;font-family:monospace;'>dist/renderer/assets/welcome-overview.jpg</span>
          </div>
        </div>

        <!-- Getting Started -->
        <div style='padding:28px 40px 0;'>
          <h2 style='color:#00d4ff;font-size:16px;font-weight:600;margin:0 0 12px;'>🚀 Getting Started</h2>
          <ol style='color:rgba(255,255,255,0.72);font-size:13px;line-height:2;padding-left:20px;margin:0;'>
            <li>Click <strong style='color:#fff;'>+ New Module</strong> on the home screen to create a study module.</li>
            <li>Give it a name, description, and an optional cover image, then click <strong style='color:#fff;'>Create Module</strong>.</li>
            <li>Click a module card to open its infinite canvas workspace.</li>
            <li>Use the toolbar at the top to add notes, drawings, media, text, and more.</li>
            <li><strong style='color:#fff;'>Right-click drag</strong> to pan · <strong style='color:#fff;'>Scroll</strong> to zoom · <strong style='color:#fff;'>Right-click</strong> an item to rename or delete.</li>
          </ol>
        </div>

        <!-- Tools grid -->
        <div style='padding:28px 40px 0;'>
          <h2 style='color:#00d4ff;font-size:16px;font-weight:600;margin:0 0 14px;'>🛠 Toolbar Tools</h2>
          <div style='display:grid;grid-template-columns:repeat(4,1fr);gap:10px;'>

            <div style='background:#111827;border:1px solid rgba(0,212,255,0.14);border-radius:8px;padding:14px 12px;'>
              <div style='font-size:20px;margin-bottom:7px;'>🖱</div>
              <div style='color:#fff;font-size:13px;font-weight:600;margin-bottom:4px;'>Pointer</div>
              <div style='color:rgba(255,255,255,0.52);font-size:12px;line-height:1.55;'>Select, move, and resize items. Drag the blue corner handle to resize. Double-click to edit.</div>
            </div>

            <div style='background:#111827;border:1px solid rgba(0,212,255,0.14);border-radius:8px;padding:14px 12px;'>
              <div style='font-size:20px;margin-bottom:7px;'>📝</div>
              <div style='color:#fff;font-size:13px;font-weight:600;margin-bottom:4px;'>Note</div>
              <div style='color:rgba(255,255,255,0.52);font-size:12px;line-height:1.55;'>Click the canvas to drop a sticky note. Double-click the note to edit its content.</div>
            </div>

            <div style='background:#111827;border:1px solid rgba(0,212,255,0.14);border-radius:8px;padding:14px 12px;'>
              <div style='font-size:20px;margin-bottom:7px;'>✏️</div>
              <div style='color:#fff;font-size:13px;font-weight:600;margin-bottom:4px;'>Draw</div>
              <div style='color:rgba(255,255,255,0.52);font-size:12px;line-height:1.55;'>Freehand draw on the canvas. Adjust brush color and size from the toolbar sliders.</div>
            </div>

            <div style='background:#111827;border:1px solid rgba(0,212,255,0.14);border-radius:8px;padding:14px 12px;'>
              <div style='font-size:20px;margin-bottom:7px;'>⬜</div>
              <div style='color:#fff;font-size:13px;font-weight:600;margin-bottom:4px;'>Erase</div>
              <div style='color:rgba(255,255,255,0.52);font-size:12px;line-height:1.55;'>Erase drawn strokes. Adjust eraser size with the slider that appears in the toolbar.</div>
            </div>

            <div style='background:#111827;border:1px solid rgba(0,212,255,0.14);border-radius:8px;padding:14px 12px;'>
              <div style='font-size:20px;margin-bottom:7px;'>📎</div>
              <div style='color:#fff;font-size:13px;font-weight:600;margin-bottom:4px;'>Media</div>
              <div style='color:rgba(255,255,255,0.52);font-size:12px;line-height:1.55;'>Insert images, videos, or PDFs. Double-click to open a viewer. Resize images with Pointer.</div>
            </div>

            <div style='background:#111827;border:1px solid rgba(0,212,255,0.14);border-radius:8px;padding:14px 12px;'>
              <div style='font-size:20px;margin-bottom:7px;'>🔤</div>
              <div style='color:#fff;font-size:13px;font-weight:600;margin-bottom:4px;'>Text</div>
              <div style='color:rgba(255,255,255,0.52);font-size:12px;line-height:1.55;'>Place a text label. Choose font and size from the toolbar. Double-click to edit the text.</div>
            </div>

            <div style='background:#111827;border:1px solid rgba(0,212,255,0.14);border-radius:8px;padding:14px 12px;'>
              <div style='font-size:20px;margin-bottom:7px;'>🔗</div>
              <div style='color:#fff;font-size:13px;font-weight:600;margin-bottom:4px;'>Connect</div>
              <div style='color:rgba(255,255,255,0.52);font-size:12px;line-height:1.55;'>Click one item then another to draw an arrow. Right-click arrows to remove connections.</div>
            </div>

            <div style='background:#111827;border:1px solid rgba(0,212,255,0.14);border-radius:8px;padding:14px 12px;'>
              <div style='font-size:20px;margin-bottom:7px;'>📁</div>
              <div style='color:#fff;font-size:13px;font-weight:600;margin-bottom:4px;'>Folder</div>
              <div style='color:rgba(255,255,255,0.52);font-size:12px;line-height:1.55;'>Drop a folder on the canvas. Double-click to open and manage files. Supports drag-and-drop.</div>
            </div>

          </div>
        </div>

        <!-- Toolbar image slot -->
        <div style='padding:18px 40px 0;'>
          <img src='./assets/welcome-toolbar.jpg' alt='Toolbar' style='width:100%;border-radius:6px;display:block;' onerror='this.style.display="none";this.nextElementSibling.style.display="flex";'>
          <div style='display:none;background:#111827;border:2px dashed rgba(0,212,255,0.18);border-radius:6px;height:70px;flex-direction:column;align-items:center;justify-content:center;gap:5px;'>
            <span style='color:rgba(255,255,255,0.35);font-size:12px;'>Toolbar screenshot</span>
            <span style='color:rgba(0,212,255,0.45);font-size:11px;font-family:monospace;'>dist/renderer/assets/welcome-toolbar.jpg</span>
          </div>
        </div>

        <!-- Navigation + Shortcuts -->
        <div style='padding:28px 40px 0;display:grid;grid-template-columns:1fr 1fr;gap:28px;'>
          <div>
            <h2 style='color:#00d4ff;font-size:16px;font-weight:600;margin:0 0 12px;'>🗺 Canvas Navigation</h2>
            <ul style='color:rgba(255,255,255,0.68);font-size:13px;line-height:2;padding-left:16px;margin:0;'>
              <li><strong style='color:#fff;'>Right-click drag</strong> — pan the canvas</li>
              <li><strong style='color:#fff;'>Scroll wheel</strong> — zoom in and out</li>
              <li><strong style='color:#fff;'>Click item</strong> — select (blue border + resize handle)</li>
              <li><strong style='color:#fff;'>Double-click</strong> — edit note/text or open media</li>
              <li><strong style='color:#fff;'>Right-click item</strong> — Rename or Delete</li>
              <li><strong style='color:#fff;'>Right-click connection</strong> — Remove or clear structure</li>
            </ul>
          </div>
          <div>
            <h2 style='color:#00d4ff;font-size:16px;font-weight:600;margin:0 0 12px;'>⌨ Keyboard Shortcuts</h2>
            <table style='width:100%;border-collapse:collapse;font-size:13px;'>
              <tr><td style='color:rgba(0,212,255,0.9);font-family:monospace;padding:4px 14px 4px 0;white-space:nowrap;'>Ctrl + Z</td><td style='color:rgba(255,255,255,0.68);'>Undo last action</td></tr>
              <tr><td style='color:rgba(0,212,255,0.9);font-family:monospace;padding:4px 14px 4px 0;'>Ctrl + Y</td><td style='color:rgba(255,255,255,0.68);'>Redo</td></tr>
              <tr><td style='color:rgba(0,212,255,0.9);font-family:monospace;padding:4px 14px 4px 0;white-space:nowrap;'>Ctrl + Enter</td><td style='color:rgba(255,255,255,0.68);'>Finish editing text / note</td></tr>
              <tr><td style='color:rgba(0,212,255,0.9);font-family:monospace;padding:4px 14px 4px 0;'>Escape</td><td style='color:rgba(255,255,255,0.68);'>Cancel editing or close</td></tr>
            </table>
          </div>
        </div>

        <!-- Tips -->
        <div style='padding:28px 40px 0;'>
          <h2 style='color:#00d4ff;font-size:16px;font-weight:600;margin:0 0 12px;'>💡 Tips</h2>
          <div style='display:grid;grid-template-columns:1fr 1fr;gap:10px;'>
            <div style='background:#111827;border-left:3px solid #00d4ff;border-radius:0 6px 6px 0;padding:10px 14px;'>
              <div style='color:#fff;font-size:13px;font-weight:600;margin-bottom:4px;'>Naming items</div>
              <div style='color:rgba(255,255,255,0.55);font-size:12px;line-height:1.55;'>Right-click any item and choose Rename to give it a display label shown on the tile.</div>
            </div>
            <div style='background:#111827;border-left:3px solid #00d4ff;border-radius:0 6px 6px 0;padding:10px 14px;'>
              <div style='color:#fff;font-size:13px;font-weight:600;margin-bottom:4px;'>Live text styling</div>
              <div style='color:rgba(255,255,255,0.55);font-size:12px;line-height:1.55;'>Select a text item with the Pointer tool — the font family and size dropdowns in the toolbar update it live.</div>
            </div>
            <div style='background:#111827;border-left:3px solid #00d4ff;border-radius:0 6px 6px 0;padding:10px 14px;'>
              <div style='color:#fff;font-size:13px;font-weight:600;margin-bottom:4px;'>Folder drag-drop</div>
              <div style='color:rgba(255,255,255,0.55);font-size:12px;line-height:1.55;'>Drag files from your file explorer directly onto a Folder tile on the canvas to add them instantly.</div>
            </div>
            <div style='background:#111827;border-left:3px solid #00d4ff;border-radius:0 6px 6px 0;padding:10px 14px;'>
              <div style='color:#fff;font-size:13px;font-weight:600;margin-bottom:4px;'>Multiple connections</div>
              <div style='color:rgba(255,255,255,0.55);font-size:12px;line-height:1.55;'>An item can have many connections. Use "Remove entire structure" to remove a whole connected group at once.</div>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div style='padding:24px 40px;display:flex;align-items:center;justify-content:space-between;border-top:1px solid rgba(0,212,255,0.1);margin-top:28px;gap:12px;flex-wrap:wrap;'>
          <label style='display:flex;align-items:center;gap:10px;cursor:pointer;color:rgba(255,255,255,0.5);font-size:13px;user-select:none;'>
            <input type='checkbox' id='welcomeNeverShow' style='width:15px;height:15px;accent-color:#00d4ff;cursor:pointer;'>
            Don't show this again
          </label>
          <button id='welcomeGetStarted' style='background:#00d4ff;color:#000;border:none;border-radius:8px;padding:10px 28px;font-size:14px;font-weight:700;cursor:pointer;letter-spacing:0.3px;'>Get Started →</button>
        </div>

      </div>
    `;

    document.body.appendChild(overlay);

    overlay.querySelector('#welcomeClose')?.addEventListener('click', () => this.dismissWelcomeScreen());
    overlay.querySelector('#welcomeGetStarted')?.addEventListener('click', () => this.dismissWelcomeScreen());

    // Show unless the user previously dismissed it permanently
    if (localStorage.getItem('study-tracker-welcome-dismissed') !== 'true') {
      overlay.style.display = 'flex';
    }
  }

  private dismissWelcomeScreen(): void {
    const overlay = document.getElementById('welcomeScreen');
    if (!overlay) return;
    const cb = overlay.querySelector('#welcomeNeverShow') as HTMLInputElement;
    if (cb?.checked) {
      localStorage.setItem('study-tracker-welcome-dismissed', 'true');
    }
    overlay.style.display = 'none';
  }

  /** Any archived module whose group no longer exists gets restored to main Workspaces. */
  private cleanupOrphanedArchivedModules(): void {
    const groupIds = new Set(this.archiveGroups.map((g) => g.id));
    let changed = false;
    this.modules.forEach((m) => {
      if (m.archived && (!m.archiveGroupId || !groupIds.has(m.archiveGroupId))) {
        m.archived = false;
        m.archiveGroupId = undefined;
        changed = true;
      }
    });
    if (changed) this.saveModules();
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
    // Load archive groups
    const storedGroups = localStorage.getItem(this.archiveStorageKey);
    if (storedGroups) {
      this.archiveGroups = JSON.parse(storedGroups);
    }
    // Restore any archived modules whose group no longer exists
    this.cleanupOrphanedArchivedModules();
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
    localStorage.setItem(this.archiveStorageKey, JSON.stringify(this.archiveGroups));
    if (this.currentUser) {
      localStorage.setItem(this.storageUidKey, this.currentUser.uid);
      if (this.fbSyncTimer) clearTimeout(this.fbSyncTimer);
      this.fbSyncTimer = setTimeout(() => this.syncToFirestore(), 2000);
    }
  }

  private async syncToFirestore(): Promise<void> {
    if (!this.currentUser) return;
    try {
      await saveUserModules(this.currentUser.uid, this.modules, this.archiveGroups);
    } catch (err) {
      console.error('Firestore sync failed:', err);
    }
  }

  private pushHistory(): void {
    try {
      const snapshot = JSON.stringify({ modules: this.modules, archiveGroups: this.archiveGroups });
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

  private restoreSnapshot(snapshot: string): void {
    try {
      const parsed = JSON.parse(snapshot);
      // Support both new format { modules, archiveGroups } and old format (plain array)
      if (Array.isArray(parsed)) {
        this.modules = parsed;
      } else {
        this.modules = parsed.modules ?? [];
        this.archiveGroups = parsed.archiveGroups ?? [];
      }
    } catch (err) {
      console.error('Failed to restore snapshot', err);
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
      this.restoreSnapshot(prev);
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
      this.restoreSnapshot(next);
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

    if (!this.authReady) {
      container.innerHTML = this.renderAuthLoading();
    } else if (!this.currentUser) {
      container.innerHTML = this.renderAuthView();
    } else if (this.isSettingsView) {
      container.innerHTML = this.renderSettingsView();
    } else if (this.isDetailView && this.currentModule) {
      container.innerHTML = this.renderDetailView();
      // Suppress the slideIn animation on re-renders (undo/redo) — only play it on fresh opens
      const dv = container.querySelector<HTMLElement>('.detail-view');
      if (dv && this.detailViewAnimDone) dv.style.animation = 'none';
      this.detailViewAnimDone = true;
    } else if (this.isArchiveView) {
      container.innerHTML = this.renderArchiveView();
    } else {
      container.innerHTML = this.renderMainView();
    }

    this.attachEventListeners();
  }

  private renderAuthLoading(): string {
    return `
      <div class="auth-container">
        <div class="auth-card">
          <div class="auth-logo">📚</div>
          <h1 class="auth-title">Study Tracker</h1>
          <div class="auth-loading"><span class="auth-spinner"></span>Loading…</div>
        </div>
      </div>`;
  }

  private renderAuthView(): string {
    const isSignup = this.authMode === 'signup';
    return `
      <div class="auth-container">
        <div class="auth-card">
          <div class="auth-logo">📚</div>
          <h1 class="auth-title">Study Tracker</h1>
          <p class="auth-subtitle">Sync your progress across devices</p>

          <div class="auth-tabs">
            <button class="auth-tab ${!isSignup ? 'active' : ''}" id="authTabLogin">Sign In</button>
            <button class="auth-tab ${isSignup ? 'active' : ''}" id="authTabSignup">Sign Up</button>
          </div>

          <form class="auth-form" id="authForm" autocomplete="on">
            <input type="email" id="authEmail" placeholder="Email address" class="auth-input"
              autocomplete="email" />
            <input type="password" id="authPassword" placeholder="Password" class="auth-input"
              autocomplete="${isSignup ? 'new-password' : 'current-password'}" />
            ${isSignup ? `<input type="password" id="authPasswordConfirm" placeholder="Confirm password"
              class="auth-input" autocomplete="new-password" />` : ''}
            <div class="auth-error" id="authError"></div>
            <button type="submit" class="auth-submit" id="authSubmit">
              ${isSignup ? 'Create Account' : 'Sign In'}
            </button>
          </form>
        </div>
      </div>`;
  }

  private renderMainView(): string {
    const visibleModules = this.modules.filter((m) => !m.archived);
    const archivedCount = this.modules.filter((m) => m.archived).length;
    const selectedCount = this.selectedModuleIds.size;

    const normalHeaderBtns = `
      <button class="tool-btn header-tool-btn" id="undoBtn" title="Undo">↶ Undo</button>
      <button class="tool-btn header-tool-btn" id="redoBtn" title="Redo">↷ Redo</button>
      <button class="edit-mode-btn ${this.isEditMode ? 'active' : ''}" id="editModeBtn">
        ${this.isEditMode ? '✓ Done' : '✎ Edit'}
      </button>
      <button class="select-mode-btn" id="selectModeBtn">◻ Select</button>
      <button class="add-module-btn" id="addModuleBtn">+ New Module</button>
      <button class="archive-nav-btn" id="openArchiveBtn" title="View Archive">
        📦 Archive${archivedCount > 0 ? ` <span class="archive-badge">${archivedCount}</span>` : ''}
      </button>
    `;

    const selectHeaderBtns = `
      <button class="select-mode-btn active" id="selectModeBtn">✕ Cancel</button>
      <span class="select-header-hint">
        ${selectedCount > 0 ? `${selectedCount} selected` : 'Tap modules to select'}
      </span>
    `;

    const actionPanel = (this.isSelectMode && selectedCount > 0) ? `
      <div class="select-action-panel">
        <button class="select-panel-btn archive-panel-btn" id="bulkArchiveBtn">Archive 📦</button>
        <button class="select-panel-btn delete-panel-btn" id="bulkDeleteBtn">Delete 🗑️</button>
      </div>
    ` : '';

    return `
      <div class="header">
        <h1>Workspaces</h1>
        <div class="header-buttons">
          ${this.isSelectMode ? selectHeaderBtns : normalHeaderBtns}
          <div class="header-divider"></div>
          <span class="user-email-display" title="${this.escapeHtml(this.currentUser?.email || '')}">${this.escapeHtml(this.currentUser?.email || '')}</span>
          <button class="logout-btn" id="logoutBtn">Sign Out</button>
        </div>
      </div>
      <div class="main-content">
        <div class="module-grid" id="moduleGrid" ${this.isEditMode ? 'data-edit-mode="true"' : ''}>
          ${
            visibleModules.length === 0
              ? `<div class="empty-state">
                  <div class="empty-state-icon">📚</div>
                  <div class="empty-state-text">No modules yet. Create your first module to get started!</div>
                </div>`
              : visibleModules.map((module) => this.renderModuleCard(module)).join('')
          }
        </div>
      </div>
      ${actionPanel}
      <button class="settings-fab" id="settingsFabBtn" title="Settings">⚙</button>
    `;
  }

  private renderModuleCard(module: Module): string {
    const hasImage = module.image && module.image.startsWith('data:');
    const isSelected = this.isSelectMode && this.selectedModuleIds.has(module.id);
    const cardClasses = [
      'module-card',
      this.isSelectMode ? 'select-mode' : '',
      isSelected ? 'selected' : '',
    ].filter(Boolean).join(' ');

    const editOverlay = this.isEditMode ? `
      <div class="drag-handle">☰</div>
      <button class="delete-btn" data-module-id="${module.id}">✕</button>
      <button class="edit-module-btn" data-module-id="${module.id}" title="Edit module">✎</button>
    ` : '';

    const selectionDot = this.isSelectMode
      ? `<div class="selection-indicator${isSelected ? ' selected' : ''}"></div>`
      : '';

    if (hasImage) {
      return `
        <div class="${cardClasses}" data-module-id="${module.id}" ${this.isEditMode ? 'draggable="true"' : ''}>
          ${editOverlay}${selectionDot}
          <img class="card-background" src="${module.image}" alt="${module.name}">
          <div class="card-overlay"></div>
          <div class="card-content">
            <div class="card-title">${this.escapeHtml(module.name)}</div>
            <div class="card-description">${this.escapeHtml(module.description)}</div>
          </div>
        </div>
      `;
    } else {
      const gradient = this.getPlaceholderGradient(module.id);
      return `
        <div class="${cardClasses}" data-module-id="${module.id}" ${this.isEditMode ? 'draggable="true"' : ''}>
          ${editOverlay}${selectionDot}
          <div class="card-placeholder" style="background-image: ${gradient};">
            <div class="card-placeholder-icon">📚</div>
            <div class="card-title">${this.escapeHtml(module.name)}</div>
            <div class="card-placeholder-desc">${this.escapeHtml(module.description)}</div>
          </div>
        </div>
      `;
    }
  }

  // ─── Select Mode ──────────────────────────────────────────────────────────────

  private toggleSelectMode(): void {
    this.isSelectMode = !this.isSelectMode;
    if (this.isSelectMode) {
      this.isEditMode = false; // select and edit are mutually exclusive
    } else {
      this.selectedModuleIds.clear();
    }
    this.render();
  }

  private toggleModuleSelection(moduleId: string): void {
    if (this.selectedModuleIds.has(moduleId)) {
      this.selectedModuleIds.delete(moduleId);
    } else {
      this.selectedModuleIds.add(moduleId);
    }
    this.render();
  }

  private deleteSelectedModules(): void {
    const count = this.selectedModuleIds.size;
    if (count === 0) return;
    if (!confirm(`Delete ${count} module${count !== 1 ? 's' : ''}? This cannot be undone.`)) return;
    this.modules = this.modules.filter((m) => !this.selectedModuleIds.has(m.id));
    this.selectedModuleIds.clear();
    this.isSelectMode = false;
    this.pushHistory();
    this.saveModules();
    this.render();
  }

  private openBulkArchiveModal(): void {
    const ids = [...this.selectedModuleIds];
    if (ids.length === 0) return;
    this.pendingBulkArchiveIds = ids;

    const overlay = document.getElementById('archiveModuleOverlay') as HTMLElement;
    const nameEl = document.getElementById('archivingModuleName') as HTMLElement;
    const select = document.getElementById('archiveGroupSelect') as HTMLSelectElement;
    const newGroupRow = document.getElementById('archiveNewGroupRow') as HTMLElement;
    const newGroupInput = document.getElementById('archiveNewGroupInput') as HTMLInputElement;

    nameEl.textContent = `${ids.length} module${ids.length !== 1 ? 's' : ''}`;
    newGroupInput.value = '';

    const hasGroups = this.archiveGroups.length > 0;
    select.innerHTML = this.archiveGroups
      .map((g) => `<option value="${g.id}">${this.escapeHtml(g.name)}</option>`)
      .join('');
    select.innerHTML += `<option value="__new__">+ Create new group…</option>`;
    if (!hasGroups) select.value = '__new__';

    const syncVisibility = () => {
      const isNew = select.value === '__new__';
      newGroupRow.style.display = isNew ? '' : 'none';
      if (isNew) setTimeout(() => newGroupInput.focus(), 30);
    };
    syncVisibility();
    select.onchange = syncVisibility;

    overlay.style.display = 'flex';

    document.getElementById('archiveCancelBtn')!.onclick = () => {
      overlay.style.display = 'none';
      this.pendingBulkArchiveIds = [];
    };
    document.getElementById('archiveConfirmBtn')!.onclick = () => this.confirmArchiveModule();
  }

  // ─── Archive View ─────────────────────────────────────────────────────────────

  private renderArchiveView(): string {
    const archivedModules = this.modules.filter((m) => m.archived);

    const renderArchivedCard = (module: Module): string => {
      const hasImage = module.image && module.image.startsWith('data:');
      const bg = hasImage
        ? `<img class="card-background" src="${module.image}" alt="${module.name}"><div class="card-overlay"></div>`
        : `<div class="card-placeholder" style="background-image:${this.getPlaceholderGradient(module.id)};"></div>`;
      return `
        <div class="module-card archive-module-card" data-module-id="${module.id}">
          ${bg}
          <div class="card-content">
            <div class="card-title">${this.escapeHtml(module.name)}</div>
            <div class="card-description">${this.escapeHtml(module.description)}</div>
          </div>
          <div class="archive-card-actions">
            <button class="archive-card-btn restore-btn" data-module-id="${module.id}" title="Restore to Workspaces">↩ Restore</button>
            <button class="archive-card-btn move-group-btn" data-module-id="${module.id}" title="Move to another group">⇄ Move</button>
          </div>
        </div>
      `;
    };

    const renderGroup = (group: ArchiveGroup): string => {
      const groupModules = archivedModules.filter((m) => m.archiveGroupId === group.id);
      return `
        <div class="archive-section" data-group-id="${group.id}">
          <div class="archive-section-header">
            <span class="archive-group-name">${this.escapeHtml(group.name)}</span>
            <span class="archive-group-count">${groupModules.length} module${groupModules.length !== 1 ? 's' : ''}</span>
            <div class="archive-group-actions">
              <button class="archive-group-action-btn rename-group-btn" data-group-id="${group.id}" title="Rename group">✎ Rename</button>
              <button class="archive-group-action-btn delete-group-btn" data-group-id="${group.id}" title="Delete group">✕ Delete</button>
            </div>
          </div>
          <div class="archive-modules-grid">
            ${groupModules.length > 0
              ? groupModules.map(renderArchivedCard).join('')
              : `<div class="archive-empty-group">No modules in this group</div>`
            }
          </div>
        </div>
      `;
    };

    return `
      <div class="archive-view">
        <div class="header">
          <div class="archive-header-left">
            <button class="back-btn" id="archiveBackBtn">←</button>
            <h1>Archive</h1>
          </div>
          <div class="header-buttons">
            <button class="add-module-btn" id="newArchiveGroupBtn">+ New Group</button>
            <div class="header-divider"></div>
            <span class="user-email-display" title="${this.escapeHtml(this.currentUser?.email || '')}">${this.escapeHtml(this.currentUser?.email || '')}</span>
          </div>
        </div>

        <div class="archive-content">
          ${this.archiveGroups.length === 0
            ? `<div class="empty-state">
                <div class="empty-state-icon">📦</div>
                <div class="empty-state-text">No archive groups yet.<br>Create a group, then archive modules from Workspaces using Edit mode.</div>
              </div>`
            : ''
          }

          ${this.archiveGroups.map(renderGroup).join('')}
        </div>
      </div>
    `;
  }

  private openArchiveView(): void {
    this.isArchiveView = true;
    this.isEditMode = false;
    this.render();
  }

  private closeArchiveView(): void {
    this.isArchiveView = false;
    this.render();
  }

  private confirmArchiveModule(): void {
    if (this.pendingBulkArchiveIds.length === 0) return;

    const select = document.getElementById('archiveGroupSelect') as HTMLSelectElement;
    const newGroupInput = document.getElementById('archiveNewGroupInput') as HTMLInputElement;
    const overlay = document.getElementById('archiveModuleOverlay') as HTMLElement;

    let groupId = select.value;

    if (groupId === '__new__') {
      const name = newGroupInput.value.trim();
      if (!name) {
        newGroupInput.focus();
        newGroupInput.style.borderColor = '#ff3b30';
        newGroupInput.placeholder = 'Group name is required';
        setTimeout(() => { newGroupInput.style.borderColor = ''; }, 1500);
        return;
      }
      const newGroup: ArchiveGroup = { id: `ag-${Date.now()}`, name, createdAt: Date.now() };
      this.archiveGroups.push(newGroup);
      groupId = newGroup.id;
    }

    this.pendingBulkArchiveIds.forEach((id) => {
      const m = this.modules.find((m) => m.id === id);
      if (m) { m.archived = true; m.archiveGroupId = groupId; }
    });
    this.pendingBulkArchiveIds = [];
    this.selectedModuleIds.clear();
    this.isSelectMode = false;

    overlay.style.display = 'none';
    this.pushHistory();
    this.saveModules();
    this.render();
  }

  private unarchiveModule(moduleId: string): void {
    const module = this.modules.find((m) => m.id === moduleId);
    if (!module) return;
    module.archived = false;
    module.archiveGroupId = undefined;
    this.pushHistory();
    this.saveModules();
    this.render();
  }

  // Open the move-to-group modal for an archived module
  private openMoveGroupModal(moduleId: string): void {
    if (this.archiveGroups.length === 0) {
      alert('Create an archive group first before moving modules.');
      return;
    }
    this.currentMovingModuleId = moduleId;

    const module = this.modules.find((m) => m.id === moduleId);
    const overlay = document.getElementById('moveGroupOverlay') as HTMLElement;
    const select = document.getElementById('moveGroupSelect') as HTMLSelectElement;

    select.innerHTML = this.archiveGroups
      .map((g) => `<option value="${g.id}" ${module?.archiveGroupId === g.id ? 'selected' : ''}>${this.escapeHtml(g.name)}</option>`)
      .join('');

    overlay.style.display = 'flex';

    document.getElementById('moveGroupCancelBtn')!.onclick = () => {
      overlay.style.display = 'none';
      this.currentMovingModuleId = null;
    };

    document.getElementById('moveGroupConfirmBtn')!.onclick = () => {
      const mod = this.modules.find((m) => m.id === this.currentMovingModuleId);
      if (mod) {
        mod.archiveGroupId = select.value;
        this.saveModules();
        this.render();
      }
      overlay.style.display = 'none';
      this.currentMovingModuleId = null;
    };
  }

  // Open create/rename archive group modal
  private openArchiveGroupModal(groupId?: string): void {
    this.currentRenamingGroupId = groupId ?? null;
    const overlay = document.getElementById('archiveGroupOverlay') as HTMLElement;
    const title = document.getElementById('archiveGroupModalTitle') as HTMLElement;
    const input = document.getElementById('archiveGroupNameInput') as HTMLInputElement;

    if (groupId) {
      const group = this.archiveGroups.find((g) => g.id === groupId);
      title.textContent = 'Rename Group';
      input.value = group?.name ?? '';
    } else {
      title.textContent = 'New Archive Group';
      input.value = '';
    }

    overlay.style.display = 'flex';
    setTimeout(() => input.focus(), 50);

    document.getElementById('archiveGroupCancelBtn')!.onclick = () => {
      overlay.style.display = 'none';
      this.currentRenamingGroupId = null;
    };

    document.getElementById('archiveGroupConfirmBtn')!.onclick = () => {
      const name = input.value.trim();
      if (!name) { input.focus(); return; }

      if (this.currentRenamingGroupId) {
        const group = this.archiveGroups.find((g) => g.id === this.currentRenamingGroupId);
        if (group) group.name = name;
      } else {
        this.archiveGroups.push({ id: `ag-${Date.now()}`, name, createdAt: Date.now() });
      }

      overlay.style.display = 'none';
      this.currentRenamingGroupId = null;
      this.saveModules();
      this.render();
    };
  }

  private deleteArchiveGroup(groupId: string): void {
    const group = this.archiveGroups.find((g) => g.id === groupId);
    if (!group) return;
    const modulesInGroup = this.modules.filter((m) => m.archiveGroupId === groupId);
    const msg = modulesInGroup.length > 0
      ? `Delete group "${group.name}"? The ${modulesInGroup.length} module(s) inside will be restored to your Workspaces.`
      : `Delete group "${group.name}"?`;

    if (!confirm(msg)) return;

    // Restore modules back to main Workspaces
    modulesInGroup.forEach((m) => { m.archived = false; m.archiveGroupId = undefined; });
    this.archiveGroups = this.archiveGroups.filter((g) => g.id !== groupId);
    this.pushHistory();
    this.saveModules();
    this.render();
  }

  // ─── End Archive View ─────────────────────────────────────────────────────────

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
                : `<div class="detail-image-placeholder" id="detailImagePlaceholder" title="Add an image to your module">
                    <span class="detail-image-placeholder-icon">[+]</span>
                    <span class="detail-image-placeholder-text">Add an image to your module.</span>
                  </div>`
            }
            <div class="detail-description">${this.escapeHtml(this.currentModule.description)}</div>
            <div class="timer-section">
              <div class="timer-mode-tabs">
                <button class="timer-tab${this.timerMode === 'stopwatch' ? ' active' : ''}" id="timerTabStopwatch">Stopwatch</button>
                <button class="timer-tab${this.timerMode === 'pomodoro' ? ' active' : ''}" id="timerTabPomodoro">Pomodoro</button>
              </div>
              <div class="timer-body">
                ${this.timerMode === 'pomodoro' ? `<div class="timer-phase-label ${this.pomodoroPhase === 'work' ? 'phase-work' : 'phase-break'}" id="timerPhaseLabel">${this.pomodoroPhase === 'work' ? '🍅 Work' : '☕ Break'}</div>` : ''}
                <div class="timer-display" id="timerDisplay">${this.timerMode === 'stopwatch' ? this.formatStopwatch(this.stopwatchSeconds) : this.formatPomodoro(this.pomodoroSecondsLeft)}</div>
                <div class="timer-session-row">
                  <span class="timer-session-label">Session</span>
                  <span class="timer-session-value" id="timerSessionDisplay">${this.formatStopwatch(this.sessionSeconds)}</span>
                  <button class="timer-session-reset" id="timerSessionReset" title="Reset session">↺</button>
                </div>
                <div class="timer-total-row">
                  <span class="timer-total-label">Total studied</span>
                  <span class="timer-total-value" id="timerTotalDisplay" title="Double-click to edit" style="cursor:pointer">${this.formatTotalTime(this.currentModule.studyTime ?? 0)}</span>
                </div>
                <div class="timer-controls">
                  <button class="timer-btn timer-start-pause" id="timerStartPause">${this.timerRunning ? '⏸ Pause' : '▶ Start'}</button>
                  <button class="timer-btn timer-reset-btn" id="timerReset">↺ Reset</button>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="workspace-container">
          <div class="workspace-toolbar">
            <button class="tool-btn" id="undoWorkspaceBtn" title="Undo">↶</button>
            <button class="tool-btn" id="redoWorkspaceBtn" title="Redo">↷</button>
            <button class="tool-btn" id="toolPointer" title="Select">➡</button>
            <button class="tool-btn" id="toolNote" title="Add Note">📝</button>
            <button class="tool-btn" id="toolText" title="Add Text">🔤</button>
            <button class="tool-btn" id="toolDraw" title="Draw">✏</button>
            <button class="tool-btn" id="toolErase" title="Erase">🧹</button>
            <button class="tool-btn" id="toolMedia" title="Add Media (image, video, PDF)">📎</button>
            <button class="tool-btn" id="toolConnect" title="Connect Items">🔗</button>
            <button class="tool-btn" id="toolFolder" title="Create Folder">📁</button>
            <input type="color" id="drawColor" value="#000000" title="Draw Color">
            <div id="toolOptions" style="display:none;align-items:center;gap:6px;flex-shrink:0;border-left:1px solid rgba(0,212,255,0.2);padding-left:8px;margin-left:2px;">
              <div id="optBrushSize" style="display:none;align-items:center;gap:5px;">
                <span style="color:rgba(255,255,255,0.5);font-size:11px;">Brush</span>
                <input type="range" id="brushSizeSlider" min="1" max="50" value="2" style="width:72px;accent-color:#00d4ff;cursor:pointer;vertical-align:middle;">
                <span id="brushSizeVal" style="color:#00d4ff;font-size:11px;min-width:20px;">2</span>
              </div>
              <div id="optEraseSize" style="display:none;align-items:center;gap:5px;">
                <span style="color:rgba(255,255,255,0.5);font-size:11px;">Eraser</span>
                <input type="range" id="eraseSizeSlider" min="5" max="100" value="20" style="width:72px;accent-color:#00d4ff;cursor:pointer;vertical-align:middle;">
                <span id="eraseSizeVal" style="color:#00d4ff;font-size:11px;min-width:26px;">20</span>
              </div>
              <div id="optTextStyle" style="display:none;align-items:center;gap:5px;">
                <span style="color:rgba(255,255,255,0.5);font-size:11px;">Size</span>
                <select id="textSizeSelect" style="background:#1a1a2e;border:1px solid rgba(0,212,255,0.3);color:#fff;border-radius:4px;padding:2px 5px;font-size:12px;cursor:pointer;outline:none;">
                  <option value="10" style="background:#1a1a2e;color:#fff;">10</option><option value="12" style="background:#1a1a2e;color:#fff;">12</option><option value="14" style="background:#1a1a2e;color:#fff;">14</option>
                  <option value="16" selected style="background:#1a1a2e;color:#fff;">16</option><option value="18" style="background:#1a1a2e;color:#fff;">18</option><option value="20" style="background:#1a1a2e;color:#fff;">20</option>
                  <option value="24" style="background:#1a1a2e;color:#fff;">24</option><option value="28" style="background:#1a1a2e;color:#fff;">28</option><option value="32" style="background:#1a1a2e;color:#fff;">32</option>
                  <option value="40" style="background:#1a1a2e;color:#fff;">40</option><option value="48" style="background:#1a1a2e;color:#fff;">48</option><option value="64" style="background:#1a1a2e;color:#fff;">64</option>
                </select>
                <span style="color:rgba(255,255,255,0.5);font-size:11px;margin-left:4px;">Font</span>
                <select id="textFontSelect" style="background:#1a1a2e;border:1px solid rgba(0,212,255,0.3);color:#fff;border-radius:4px;padding:2px 5px;font-size:12px;cursor:pointer;outline:none;max-width:130px;">
                  <option value="Arial" style="background:#1a1a2e;color:#fff;">Arial</option>
                  <option value="Georgia" style="background:#1a1a2e;color:#fff;">Georgia</option>
                  <option value="Times New Roman" style="background:#1a1a2e;color:#fff;">Times New Roman</option>
                  <option value="Verdana" style="background:#1a1a2e;color:#fff;">Verdana</option>
                  <option value="Courier New" style="background:#1a1a2e;color:#fff;">Courier New</option>
                  <option value="Impact" style="background:#1a1a2e;color:#fff;">Impact</option>
                  <option value="Trebuchet MS" style="background:#1a1a2e;color:#fff;">Trebuchet MS</option>
                  <option value="Comic Sans MS" style="background:#1a1a2e;color:#fff;">Comic Sans</option>
                  <option value="Palatino" style="background:#1a1a2e;color:#fff;">Palatino</option>
                  <option value="Garamond" style="background:#1a1a2e;color:#fff;">Garamond</option>
                </select>
              </div>
            </div>
            <button class="tool-btn" id="clearWorkspaceBtn" title="Clear Workspace">🗑 Clear</button>
            <div class="toolbar-spacer"></div>
            <button class="tool-btn" id="zoomIn" title="Zoom In">🔍+</button>
            <button class="tool-btn" id="zoomOut" title="Zoom Out">🔍-</button>
            <span id="zoomLevel" style="color:#00d4ff;font-size:12px;white-space:nowrap;flex-shrink:0;margin:0 10px;">100%</span>
          </div>
          <div class="roadmap-sel-bar" id="roadmapSelBar" style="display:none;">
            <span class="roadmap-sel-info">
              <span class="roadmap-sel-icon">✓</span>
              <span id="roadmapSelCount">0 items selected</span>
            </span>
            <button class="roadmap-sel-generate" id="generateRoadmapBtn">✨ Generate Roadmap</button>
            <button class="roadmap-sel-clear" id="clearRoadmapSelBtn">✕ Clear</button>
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

    // Settings FAB
    const settingsFabBtn = document.getElementById('settingsFabBtn');
    if (settingsFabBtn) {
      settingsFabBtn.addEventListener('click', () => this.openSettings());
    }

    // Roadmap selection bar
    const generateRoadmapBtn = document.getElementById('generateRoadmapBtn');
    if (generateRoadmapBtn) {
      generateRoadmapBtn.addEventListener('click', () => this.generateRoadmap());
    }
    const clearRoadmapSelBtn = document.getElementById('clearRoadmapSelBtn');
    if (clearRoadmapSelBtn) {
      clearRoadmapSelBtn.addEventListener('click', () => {
        this.selectedWorkspaceItems.clear();
        this.updateMultiSelectBar();
        this.drawWorkspace();
      });
    }

    // API key save
    const saveApiKeyBtn = document.getElementById('saveApiKeyBtn');
    if (saveApiKeyBtn) {
      saveApiKeyBtn.addEventListener('click', () => {
        const input = document.getElementById('aiApiKeyInput') as HTMLInputElement | null;
        if (input) {
          this.aiApiKey = input.value.trim();
          localStorage.setItem('study-tracker-ai-key', this.aiApiKey);
          const status = document.getElementById('apiKeyStatus');
          if (status) {
            status.textContent = 'API key saved!';
            setTimeout(() => { if (status) status.textContent = ''; }, 3000);
          }
        }
      });
    }

    // Settings page buttons
    const settingsBackBtn = document.getElementById('settingsBackBtn');
    if (settingsBackBtn) {
      settingsBackBtn.addEventListener('click', () => this.closeSettings());
    }
    const settingsCloudBackupBtn = document.getElementById('settingsCloudBackupBtn');
    if (settingsCloudBackupBtn) {
      settingsCloudBackupBtn.addEventListener('click', () => this.createCloudBackup());
    }
    const settingsRestoreBackupBtn = document.getElementById('settingsRestoreBackupBtn');
    if (settingsRestoreBackupBtn) {
      settingsRestoreBackupBtn.addEventListener('click', () => this.restoreCloudBackup());
    }
    const settingsExportBtn = document.getElementById('settingsExportBtn');
    if (settingsExportBtn) {
      settingsExportBtn.addEventListener('click', () => this.exportBackupFile());
    }
    const settingsImportBtn = document.getElementById('settingsImportBtn');
    if (settingsImportBtn) {
      settingsImportBtn.addEventListener('click', () => this.importBackupFile());
    }
    const themeDarkBtn = document.getElementById('themeDarkBtn');
    if (themeDarkBtn) {
      themeDarkBtn.addEventListener('click', () => this.setTheme('dark'));
    }
    const themeLightBtn = document.getElementById('themeLightBtn');
    if (themeLightBtn) {
      themeLightBtn.addEventListener('click', () => this.setTheme('light'));
    }

    // Main view events
    const addModuleBtn = document.getElementById('addModuleBtn');
    if (addModuleBtn) {
      addModuleBtn.addEventListener('click', () => this.openAddModuleModal());
    }

    // Archive navigation button (main view → archive view)
    const openArchiveBtn = document.getElementById('openArchiveBtn');
    if (openArchiveBtn) {
      openArchiveBtn.addEventListener('click', () => this.openArchiveView());
    }

    // Archive view back button
    const archiveBackBtn = document.getElementById('archiveBackBtn');
    if (archiveBackBtn) {
      archiveBackBtn.addEventListener('click', () => this.closeArchiveView());
    }

    // New archive group button (in archive view)
    const newArchiveGroupBtn = document.getElementById('newArchiveGroupBtn');
    if (newArchiveGroupBtn) {
      newArchiveGroupBtn.addEventListener('click', () => this.openArchiveGroupModal());
    }

    // Archive group action buttons (rename / delete)
    document.querySelectorAll('.rename-group-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const groupId = (btn as HTMLElement).dataset.groupId;
        if (groupId) this.openArchiveGroupModal(groupId);
      });
    });

    document.querySelectorAll('.delete-group-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const groupId = (btn as HTMLElement).dataset.groupId;
        if (groupId) this.deleteArchiveGroup(groupId);
      });
    });

    // Restore and move buttons on archived module cards
    document.querySelectorAll('.restore-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const moduleId = (btn as HTMLElement).dataset.moduleId;
        if (moduleId) this.unarchiveModule(moduleId);
      });
    });

    document.querySelectorAll('.move-group-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const moduleId = (btn as HTMLElement).dataset.moduleId;
        if (moduleId) this.openMoveGroupModal(moduleId);
      });
    });

    // Archive module card clicks — open the module in detail view
    document.querySelectorAll('.archive-module-card').forEach((card) => {
      card.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.archive-card-btn')) return;
        const moduleId = (card as HTMLElement).dataset.moduleId;
        if (moduleId) this.openDetailView(moduleId);
      });
    });

    // Select-mode toggle button
    const selectModeBtn = document.getElementById('selectModeBtn');
    if (selectModeBtn) {
      selectModeBtn.addEventListener('click', () => this.toggleSelectMode());
    }

    // Bulk action panel buttons (only rendered when modules are selected)
    const bulkArchiveBtn = document.getElementById('bulkArchiveBtn');
    if (bulkArchiveBtn) {
      bulkArchiveBtn.addEventListener('click', () => this.openBulkArchiveModal());
    }
    const bulkDeleteBtn = document.getElementById('bulkDeleteBtn');
    if (bulkDeleteBtn) {
      bulkDeleteBtn.addEventListener('click', () => this.deleteSelectedModules());
    }

    // Module card clicks
    if (this.isSelectMode) {
      // In select mode: clicking a card toggles its selection
      const moduleCards = document.querySelectorAll('.module-card:not(.archive-module-card)');
      moduleCards.forEach((card) => {
        card.addEventListener('click', () => {
          const moduleId = (card as HTMLElement).dataset.moduleId;
          if (moduleId) this.toggleModuleSelection(moduleId);
        });
      });
    } else if (!this.isEditMode) {
      // Normal mode: clicking a card opens the detail view
      const moduleCards = document.querySelectorAll('.module-card:not(.archive-module-card)');
      moduleCards.forEach((card) => {
        card.addEventListener('click', (e) => {
          if ((e.target as HTMLElement).closest('.delete-btn')) return;
          const moduleId = (card as HTMLElement).dataset.moduleId;
          this.openDetailView(moduleId!);
        });
      });
    } else {
      // Edit mode: delete / rename / drag-drop handlers
      const deleteButtons = document.querySelectorAll('.delete-btn');
      deleteButtons.forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const moduleId = (btn as HTMLElement).dataset.moduleId;
          this.deleteModule(moduleId!);
        });
      });

      const editModuleBtns = document.querySelectorAll('.edit-module-btn');
      editModuleBtns.forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const moduleId = (btn as HTMLElement).dataset.moduleId;
          if (moduleId) this.openEditModuleModal(moduleId);
        });
      });

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

    // Detail image placeholder — click to open edit modal
    const detailImagePlaceholder = document.getElementById('detailImagePlaceholder');
    if (detailImagePlaceholder && this.currentModule) {
      detailImagePlaceholder.addEventListener('click', () => {
        if (this.currentModule) this.openEditModuleModal(this.currentModule.id);
      });
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

      // Timer controls
      const timerTabSw = document.getElementById('timerTabStopwatch');
      const timerTabPm = document.getElementById('timerTabPomodoro');
      const timerStartPause = document.getElementById('timerStartPause');
      const timerReset = document.getElementById('timerReset');
      if (timerTabSw) timerTabSw.addEventListener('click', () => this.switchTimerMode('stopwatch'));
      if (timerTabPm) timerTabPm.addEventListener('click', () => this.switchTimerMode('pomodoro'));
      if (timerStartPause) timerStartPause.addEventListener('click', () => this.timerRunning ? this.pauseTimer() : this.startTimer());
      if (timerReset) timerReset.addEventListener('click', () => {
        if (this.resetConfirmPending) {
          this.resetConfirmPending = false;
          this.resetTimer();
        } else {
          this.resetConfirmPending = true;
          timerReset.textContent = '⚠ Confirm? (cannot undo)';
          (timerReset as HTMLElement).classList.add('timer-reset-confirm');
          setTimeout(() => {
            if (this.resetConfirmPending) {
              this.resetConfirmPending = false;
              timerReset.textContent = '↺ Reset';
              (timerReset as HTMLElement).classList.remove('timer-reset-confirm');
            }
          }, 3000);
        }
      });
      const timerSessionReset = document.getElementById('timerSessionReset');
      if (timerSessionReset) timerSessionReset.addEventListener('click', () => {
        this.sessionSeconds = 0;
        this.updateSessionDisplay();
      });
      const timerTotal = document.getElementById('timerTotalDisplay');
      if (timerTotal) timerTotal.addEventListener('dblclick', () => this.editTotalTime());
    }

    // Auth form
    const authTabLogin = document.getElementById('authTabLogin');
    const authTabSignup = document.getElementById('authTabSignup');
    if (authTabLogin) authTabLogin.addEventListener('click', () => { this.authMode = 'login'; this.render(); });
    if (authTabSignup) authTabSignup.addEventListener('click', () => { this.authMode = 'signup'; this.render(); });

    const authForm = document.getElementById('authForm') as HTMLFormElement | null;
    if (authForm) {
      authForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = (document.getElementById('authEmail') as HTMLInputElement).value.trim();
        const password = (document.getElementById('authPassword') as HTMLInputElement).value;
        const confirmEl = document.getElementById('authPasswordConfirm') as HTMLInputElement | null;
        const errorEl = document.getElementById('authError') as HTMLElement;
        const submitBtn = document.getElementById('authSubmit') as HTMLButtonElement;

        if (!email || !password) return;
        if (this.authMode === 'signup' && confirmEl && password !== confirmEl.value) {
          errorEl.textContent = 'Passwords do not match.';
          return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = this.authMode === 'login' ? 'Signing in…' : 'Creating account…';
        errorEl.textContent = '';

        try {
          if (this.authMode === 'login') {
            await fbSignIn(email, password);
          } else {
            await fbSignUp(email, password);
          }
          // onAuthStateChanged handles re-render
        } catch (err: unknown) {
          errorEl.textContent = this.formatAuthError(err instanceof Error ? err.message : '');
          submitBtn.disabled = false;
          submitBtn.textContent = this.authMode === 'login' ? 'Sign In' : 'Create Account';
        }
      });
    }

    // Logout
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async () => {
        this.pauseTimer();
        await fbSignOut();
        this.isDetailView = false;
        this.currentModule = null;
      });
    }
  }

  private formatAuthError(msg: string): string {
    if (msg.includes('user-not-found') || msg.includes('wrong-password') || msg.includes('invalid-credential'))
      return 'Invalid email or password.';
    if (msg.includes('email-already-in-use')) return 'An account with this email already exists.';
    if (msg.includes('weak-password')) return 'Password must be at least 6 characters.';
    if (msg.includes('invalid-email')) return 'Please enter a valid email address.';
    if (msg.includes('network-request-failed')) return 'Network error — check your connection.';
    return 'Authentication failed. Please try again.';
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
      workspace: { items: [], offsetX: 0, offsetY: 0, zoom: 1 },
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

  private openEditModuleModal(moduleId: string): void {
    const module = this.modules.find(m => m.id === moduleId);
    if (!module) return;

    const overlay = document.getElementById('editModuleOverlay') as HTMLElement;
    if (!overlay) return;

    // Populate fields
    (overlay.querySelector('#editModuleId') as HTMLInputElement).value = moduleId;
    (overlay.querySelector('#editModuleName') as HTMLInputElement).value = module.name;
    (overlay.querySelector('#editModuleDescription') as HTMLTextAreaElement).value = module.description;

    const preview = overlay.querySelector('#editImagePreview') as HTMLImageElement;
    const removeBtn = overlay.querySelector('#editRemoveImageBtn') as HTMLButtonElement;
    if (module.image && module.image.startsWith('data:')) {
      preview.src = module.image;
      preview.style.display = 'block';
      overlay.dataset.imageData = module.image;
      removeBtn.style.display = 'inline-block';
    } else {
      preview.src = '';
      preview.style.display = 'none';
      delete overlay.dataset.imageData;
      removeBtn.style.display = 'none';
    }

    // Wire up listeners (clone to remove stale ones)
    const newOverlay = overlay.cloneNode(true) as HTMLElement;
    overlay.parentNode?.replaceChild(newOverlay, overlay);
    const fresh = document.getElementById('editModuleOverlay') as HTMLElement;

    // Re-grab elements in fresh clone
    const freshPreview = fresh.querySelector('#editImagePreview') as HTMLImageElement;
    const freshRemoveBtn = fresh.querySelector('#editRemoveImageBtn') as HTMLButtonElement;
    const uploadArea = fresh.querySelector('#editImageUploadArea') as HTMLElement;
    const fileInput = fresh.querySelector('#editImageInput') as HTMLInputElement;

    const handleFile = (file: File) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const data = e.target?.result as string;
        freshPreview.src = data;
        freshPreview.style.display = 'block';
        fresh.dataset.imageData = data;
        freshRemoveBtn.style.display = 'inline-block';
      };
      reader.readAsDataURL(file);
    };

    uploadArea.addEventListener('click', () => fileInput.click());
    uploadArea.addEventListener('dragover', (e) => { e.preventDefault(); uploadArea.style.background = 'rgba(0,212,255,0.1)'; });
    uploadArea.addEventListener('dragleave', () => { uploadArea.style.background = ''; });
    uploadArea.addEventListener('drop', (e) => {
      e.preventDefault();
      uploadArea.style.background = '';
      const files = (e as DragEvent).dataTransfer?.files;
      if (files?.[0]) handleFile(files[0]);
    });
    fileInput.addEventListener('change', () => { if (fileInput.files?.[0]) handleFile(fileInput.files[0]); });

    freshRemoveBtn.addEventListener('click', () => {
      freshPreview.src = '';
      freshPreview.style.display = 'none';
      delete fresh.dataset.imageData;
      freshRemoveBtn.style.display = 'none';
      fileInput.value = '';
    });

    fresh.querySelector('#editCancelBtn')!.addEventListener('click', () => this.closeEditModuleModal());
    fresh.addEventListener('click', (e) => { if (e.target === fresh) this.closeEditModuleModal(); });

    (fresh.querySelector('#editModuleForm') as HTMLFormElement).addEventListener('submit', (e) => {
      e.preventDefault();
      const name = (fresh.querySelector('#editModuleName') as HTMLInputElement).value.trim();
      const description = (fresh.querySelector('#editModuleDescription') as HTMLTextAreaElement).value.trim();
      if (!name || !description) return;

      const mod = this.modules.find(m => m.id === moduleId);
      if (mod) {
        mod.name = name;
        mod.description = description;
        mod.image = fresh.dataset.imageData || undefined;
        this.saveModules();
        this.pushHistory();
      }
      this.closeEditModuleModal();
      this.render();
    });

    fresh.style.opacity = '0';
    fresh.style.pointerEvents = 'auto';
    fresh.style.display = 'flex';
    void fresh.offsetHeight;
    fresh.style.opacity = '1';

    setTimeout(() => {
      (fresh.querySelector('#editModuleName') as HTMLInputElement)?.focus();
    }, 10);
  }

  private closeEditModuleModal(): void {
    const overlay = document.getElementById('editModuleOverlay') as HTMLElement;
    if (overlay) {
      overlay.style.opacity = '0';
      overlay.style.pointerEvents = 'none';
      setTimeout(() => { overlay.style.display = 'none'; }, 300);
    }
  }

  private openDetailView(moduleId: string): void {
    const module = this.modules.find((m) => m.id === moduleId);
    if (module) {
      this.currentModule = module;
      this.isDetailView = true;
      this.sessionSeconds = 0;
      this.detailViewAnimDone = false; // allow slideIn animation on fresh open
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
    this.closeFolderPopup();
    this.pauseTimer();
    // Remove any floating editing textareas that were attached to document.body
    document.querySelectorAll('textarea').forEach((ta) => {
      if (ta.style.position === 'fixed' && ta.style.zIndex === '10000') {
        ta.blur();
        ta.remove();
      }
    });
    this.editingNoteId = null;
    this.isDetailView = false;
    this.currentModule = null;
    this.render();
  }

  private getPlaceholderGradient(moduleId: string): string {
    // Deterministic hash from the module ID to pick a palette entry
    let hash = 0;
    for (let i = 0; i < moduleId.length; i++) {
      hash = (hash * 31 + moduleId.charCodeAt(i)) >>> 0;
    }
    const palettes = [
      ['#667eea', '#764ba2', '#f093fb'], // purple-blue
      ['#f7971e', '#ffd200', '#f7971e'], // amber
      ['#11998e', '#38ef7d', '#11998e'], // emerald
      ['#ee0979', '#ff6a00', '#ee0979'], // red-orange
      ['#4facfe', '#00f2fe', '#4facfe'], // sky blue
      ['#43e97b', '#38f9d7', '#43e97b'], // mint
      ['#fa709a', '#fee140', '#fa709a'], // pink-gold
      ['#a18cd1', '#fbc2eb', '#a18cd1'], // lavender
      ['#fd7043', '#42a5f5', '#fd7043'], // sunset
      ['#00c6ff', '#0072ff', '#00c6ff'], // ocean
    ];
    const [a, b, c] = palettes[hash % palettes.length];
    return `linear-gradient(135deg, ${a} 0%, ${b} 50%, ${c} 100%)`;
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
    this.closeFolderPopup();
    const ws = this.currentModule.workspace;
    ws.items = [];
    ws.connections = [];
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

    // Tool button handlers — only actual tool-selection buttons, not undo/redo/zoom/clear
    const toolButtonIds = new Set(['toolPointer', 'toolNote', 'toolDraw', 'toolErase', 'toolMedia', 'toolText', 'toolConnect', 'toolFolder']);
    const toolButtons = canvas.parentElement?.querySelectorAll('.tool-btn');
    if (toolButtons) {
      toolButtons.forEach((btn) => {
        const toolId = (btn as HTMLElement).id;
        if (!toolButtonIds.has(toolId)) return;
        btn.addEventListener('click', () => {
          toolButtons.forEach((b) => { if (toolButtonIds.has((b as HTMLElement).id)) b.classList.remove('active'); });
          btn.classList.add('active');
          this.selectTool(toolId);
        });
      });
    }

    // Color picker
    const drawColorInput = canvas.parentElement?.querySelector('#drawColor') as HTMLInputElement;
    if (drawColorInput) {
      drawColorInput.value = this.drawColor;
      drawColorInput.addEventListener('change', (e) => {
        this.drawColor = (e.target as HTMLInputElement).value;
      });
    }

    // Brush size slider
    const brushSlider = canvas.parentElement?.querySelector('#brushSizeSlider') as HTMLInputElement;
    const brushVal    = canvas.parentElement?.querySelector('#brushSizeVal')    as HTMLElement;
    if (brushSlider) {
      brushSlider.value = String(this.drawWidth);
      brushSlider.addEventListener('input', () => {
        this.drawWidth = parseInt(brushSlider.value);
        if (brushVal) brushVal.textContent = String(this.drawWidth);
      });
    }

    // Erase size slider
    const eraseSlider = canvas.parentElement?.querySelector('#eraseSizeSlider') as HTMLInputElement;
    const eraseVal    = canvas.parentElement?.querySelector('#eraseSizeVal')    as HTMLElement;
    if (eraseSlider) {
      eraseSlider.value = String(this.eraseWidth);
      eraseSlider.addEventListener('input', () => {
        this.eraseWidth = parseInt(eraseSlider.value);
        if (eraseVal) eraseVal.textContent = String(this.eraseWidth);
      });
    }

    // Text size select
    const textSizeSel = canvas.parentElement?.querySelector('#textSizeSelect') as HTMLSelectElement;
    if (textSizeSel) {
      textSizeSel.value = String(this.defaultFontSize);
      textSizeSel.addEventListener('change', () => {
        this.defaultFontSize = parseInt(textSizeSel.value);
        if (this.workspaceTool === 'pointer' && this.selectedItem?.type === 'text') {
          this.selectedItem.fontSize = this.defaultFontSize;
          this.saveModules();
          this.drawWorkspace();
        }
      });
    }

    // Text font select
    const textFontSel = canvas.parentElement?.querySelector('#textFontSelect') as HTMLSelectElement;
    if (textFontSel) {
      textFontSel.value = this.defaultFontFamily;
      textFontSel.addEventListener('change', () => {
        this.defaultFontFamily = textFontSel.value;
        if (this.workspaceTool === 'pointer' && this.selectedItem?.type === 'text') {
          this.selectedItem.fontFamily = this.defaultFontFamily;
          this.saveModules();
          this.drawWorkspace();
        }
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
      if (this.workspaceTool !== 'pointer' && this.workspaceTool !== 'connect') return;
      const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
      const ws = this.currentModule?.workspace;
      if (!ws) return;
      const cx = (e.clientX - rect.left) / ws.zoom;
      const cy = (e.clientY - rect.top) / ws.zoom;
      // Connection line takes priority over items
      const conn = this.getConnectionAtPosition(cx, cy, ws);
      if (conn) {
        this.showConnectionContextMenu(e.clientX, e.clientY, conn);
        return;
      }
      const item = this.getItemAtPosition(cx, cy, ws);
      if (item && item.type !== 'drawing') {
        this.showContextMenu(e.clientX, e.clientY, item);
      }
    });

    // Drag files from machine onto folder items on canvas
    canvas.addEventListener('dragover', (e) => {
      e.preventDefault();
      const ws = this.currentModule?.workspace;
      if (!ws) return;
      const rect = canvas.getBoundingClientRect();
      const cx = (e.clientX - rect.left) / ws.zoom;
      const cy = (e.clientY - rect.top) / ws.zoom;
      const item = this.getItemAtPosition(cx, cy, ws);
      const newId = item?.type === 'folder' ? item.id : null;
      if (newId !== this.dragOverFolderId) {
        this.dragOverFolderId = newId;
        this.drawWorkspace();
      }
      if (newId) e.dataTransfer!.dropEffect = 'copy';
    });
    canvas.addEventListener('dragleave', (e) => {
      if (!canvas.contains(e.relatedTarget as Node) && this.dragOverFolderId) {
        this.dragOverFolderId = null;
        this.drawWorkspace();
      }
    });
    canvas.addEventListener('drop', (e) => {
      e.preventDefault();
      const prevId = this.dragOverFolderId;
      this.dragOverFolderId = null;
      const ws = this.currentModule?.workspace;
      if (!ws || !prevId || !e.dataTransfer?.files.length) { this.drawWorkspace(); return; }
      const folder = ws.items.find((i) => i.id === prevId);
      if (folder?.type === 'folder') {
        this.addFilesToFolder(folder, Array.from(e.dataTransfer.files));
      }
      this.drawWorkspace();
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

    // Restore active tool (preserves selection across undo/redo/re-renders)
    const toolIdMap: { [key: string]: string } = {
      pointer: 'toolPointer', note: 'toolNote', draw: 'toolDraw',
      erase: 'toolErase', image: 'toolMedia', text: 'toolText',
      connect: 'toolConnect', folder: 'toolFolder',
    };
    const activeToolId = toolIdMap[this.workspaceTool] || 'toolPointer';
    const activeBtn = canvas.parentElement?.querySelector(`#${activeToolId}`);
    if (activeBtn) activeBtn.classList.add('active');
    // Sync canvas cursor classes
    canvas.classList.toggle('pan-cursor', this.workspaceTool === 'pointer');
    canvas.classList.toggle('eraser-cursor', this.workspaceTool === 'erase');
  }

  private drawWorkspace(): void {
    if (!this.workspaceCanvas || !this.workspaceCtx || !this.currentModule?.workspace) return;

    const ctx = this.workspaceCtx;
    const ws = this.currentModule.workspace;
    const w = this.workspaceCanvas.width;
    const h = this.workspaceCanvas.height;

    // Clear background — white in light mode, dark in dark mode
    ctx.fillStyle = this.theme === 'light' ? '#ffffff' : '#0a0a0a';
    ctx.fillRect(0, 0, w, h);

    // Draw grid lines
    const gridSize = 30;
    ctx.strokeStyle = this.theme === 'light' ? 'rgba(0, 0, 0, 0.08)' : 'rgba(0, 212, 255, 0.15)';
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

    // Draw grid dots
    ctx.fillStyle = this.theme === 'light' ? 'rgba(0, 0, 0, 0.15)' : 'rgba(0, 212, 255, 0.1)';
    for (let x = gridSize / 2; x < w; x += gridSize) {
      for (let y = gridSize / 2; y < h; y += gridSize) {
        ctx.beginPath();
        ctx.arc(x, y, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Draw connections behind items
    this.drawConnections(ctx, ws);

    // Draw workspace items (drawing layers rendered separately to isolate the eraser)
    ws.items.forEach((item) => {
      if (item.type === 'drawing') {
        this.renderDrawingLayer(ctx, item, ws);
      } else {
        this.drawWorkspaceItem(ctx, item, ws);
      }
    });

    // Draw connect-tool rubber-band on top of everything
    if (this.workspaceTool === 'connect' && this.connectFirstItem) {
      this.drawConnectRubberBand(ctx, ws);
    }

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

  private drawConnections(ctx: CanvasRenderingContext2D, ws: WorkspaceData): void {
    if (!ws.connections?.length) return;
    ws.connections.forEach((conn) => {
      const fromItem = ws.items.find((i) => i.id === conn.fromId);
      const toItem   = ws.items.find((i) => i.id === conn.toId);
      if (!fromItem || !toItem) return;

      const ax = (fromItem.x + ws.offsetX + fromItem.width  / 2) * ws.zoom;
      const ay = (fromItem.y + ws.offsetY + fromItem.height / 2) * ws.zoom;
      const bx = (toItem.x   + ws.offsetX + toItem.width   / 2) * ws.zoom;
      const by = (toItem.y   + ws.offsetY + toItem.height  / 2) * ws.zoom;

      const angle = Math.atan2(by - ay, bx - ax);
      const arrowSize = 11;

      ctx.save();
      ctx.strokeStyle = 'rgba(0,212,255,0.7)';
      ctx.lineWidth = 2;
      ctx.setLineDash([7, 4]);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      ctx.setLineDash([]);

      // Arrowhead at target end
      ctx.fillStyle = 'rgba(0,212,255,0.7)';
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx - arrowSize * Math.cos(angle - Math.PI / 6), by - arrowSize * Math.sin(angle - Math.PI / 6));
      ctx.lineTo(bx - arrowSize * Math.cos(angle + Math.PI / 6), by - arrowSize * Math.sin(angle + Math.PI / 6));
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    });
  }

  private drawConnectRubberBand(ctx: CanvasRenderingContext2D, ws: WorkspaceData): void {
    if (!this.connectFirstItem) return;
    const ix = (this.connectFirstItem.x + ws.offsetX) * ws.zoom;
    const iy = (this.connectFirstItem.y + ws.offsetY) * ws.zoom;
    const iw = this.connectFirstItem.width  * ws.zoom;
    const ih = this.connectFirstItem.height * ws.zoom;

    ctx.save();
    // Highlight ring around first selected item
    ctx.strokeStyle = '#00d4ff';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([5, 3]);
    ctx.strokeRect(ix - 3, iy - 3, iw + 6, ih + 6);
    ctx.setLineDash([]);

    // Rubber-band line to current mouse position
    const fromCx = ix + iw / 2;
    const fromCy = iy + ih / 2;
    const toCx   = this.mouseCanvasX * ws.zoom;
    const toCy   = this.mouseCanvasY * ws.zoom;

    ctx.strokeStyle = 'rgba(0,212,255,0.45)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(fromCx, fromCy);
    ctx.lineTo(toCx, toCy);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  private handleCanvasMouseDown(e: MouseEvent): void {
    const canvas = e.target as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / (this.currentModule?.workspace?.zoom || 1);
    const y = (e.clientY - rect.top) / (this.currentModule?.workspace?.zoom || 1);
    const ws = this.currentModule?.workspace;

    // Right-click: context menu on items/connections, cancel connect, or pan
    if (e.button === 2) {
      if (this.workspaceTool === 'pointer' || this.workspaceTool === 'connect') {
        const itemAtPos = this.getItemAtPosition(x, y, ws);
        if (itemAtPos && itemAtPos.type !== 'drawing') {
          // contextmenu event fires after mousedown and will show the menu
          return;
        }
        if (ws && this.getConnectionAtPosition(x, y, ws)) {
          // contextmenu will show connection menu
          return;
        }
        if (this.workspaceTool === 'connect') {
          // Right-click on empty space in connect mode cancels the pending selection
          this.connectFirstItem = null;
          this.drawWorkspace();
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
      // Check resize handle on selected item first
      if (this.selectedItem && ws) {
        const hitSize = 12 / ws.zoom;
        const handleX = this.selectedItem.x + ws.offsetX + this.selectedItem.width;
        const handleY = this.selectedItem.y + ws.offsetY + this.selectedItem.height;
        if (x >= handleX - hitSize && x <= handleX + 4 / ws.zoom &&
            y >= handleY - hitSize && y <= handleY + 4 / ws.zoom) {
          this.resizingItem   = this.selectedItem;
          this.resizeStartX   = x;
          this.resizeStartY   = y;
          this.resizeStartW   = this.selectedItem.width;
          this.resizeStartH   = this.selectedItem.height;
          return;
        }
      }

      const itemAtPos = this.getItemAtPosition(x, y, ws);

      // Shift+click: toggle multi-select for roadmap generation
      if (e.shiftKey && itemAtPos && itemAtPos.type !== 'drawing') {
        if (this.selectedWorkspaceItems.has(itemAtPos.id)) {
          this.selectedWorkspaceItems.delete(itemAtPos.id);
        } else {
          this.selectedWorkspaceItems.add(itemAtPos.id);
        }
        this.updateMultiSelectBar();
        this.drawWorkspace();
        return;
      }

      if (itemAtPos) {
        this.selectedItem = itemAtPos;
        this.updateToolOptions();
        // Double-click: open viewer or edit note/text
        if (itemAtPos.type === 'image' && e.detail === 2) {
          this.openImageLightbox(itemAtPos);
          return;
        }
        if ((itemAtPos.type === 'video' || itemAtPos.type === 'pdf') && e.detail === 2) {
          this.openMediaViewer(itemAtPos);
          return;
        }
        if (itemAtPos.type === 'note' && e.detail === 2) {
          e.preventDefault();
          this.isDrawing = false;
          this.startEditingNote(itemAtPos);
          return;
        }
        if (itemAtPos.type === 'text' && e.detail === 2) {
          e.preventDefault();
          this.isDrawing = false;
          this.startEditingText(itemAtPos);
          return;
        }
        if (itemAtPos.type === 'folder' && e.detail === 2) {
          e.preventDefault();
          this.isDrawing = false;
          this.openFolderPopup(itemAtPos);
          return;
        }
        // Single click: select and prepare for drag
        this.selectedItemOffsetX = x - (itemAtPos.x + (ws?.offsetX || 0));
        this.selectedItemOffsetY = y - (itemAtPos.y + (ws?.offsetY || 0));
        this.isDrawing = true;
      } else {
        this.selectedItem = null;
        this.updateToolOptions();
        if (!e.shiftKey) {
          this.selectedWorkspaceItems.clear();
          this.updateMultiSelectBar();
        }
      }
      this.drawWorkspace();
      return;
    }

    // Connect tool: handled separately (no isDrawing)
    if (this.workspaceTool === 'connect') {
      this.handleConnectClick(x, y);
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
      case 'text':
        this.addTextItem(x, y);
        break;
      case 'folder':
        this.addFolderItem(x, y);
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

    // Track mouse position for connect tool rubber-band line
    this.mouseCanvasX = x;
    this.mouseCanvasY = y;

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

    // Resize selected item
    if (this.resizingItem) {
      const dx = x - this.resizeStartX;
      const dy = y - this.resizeStartY;
      this.resizingItem.width  = Math.max(40, this.resizeStartW + dx);
      this.resizingItem.height = Math.max(40, this.resizeStartH + dy);
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

    // Cursor: show resize cursor when hovering over selected item's handle
    if (this.workspaceTool === 'pointer' && this.selectedItem && !this.isDrawing) {
      const hitSize = 12 / ws.zoom;
      const handleX = this.selectedItem.x + ws.offsetX + this.selectedItem.width;
      const handleY = this.selectedItem.y + ws.offsetY + this.selectedItem.height;
      if (x >= handleX - hitSize && x <= handleX + 4 / ws.zoom &&
          y >= handleY - hitSize && y <= handleY + 4 / ws.zoom) {
        canvas.style.cursor = 'nwse-resize';
      } else {
        canvas.style.cursor = '';
      }
    }

    // Connect tool rubber-band: redraw so the line follows the mouse
    if (this.workspaceTool === 'connect' && this.connectFirstItem) {
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
    this.resizingItem = null;
    if (this.workspaceCanvas) this.workspaceCanvas.style.cursor = '';
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
    const toolMap: { [key: string]: 'pointer' | 'note' | 'draw' | 'erase' | 'image' | 'text' | 'connect' | 'folder' } = {
      toolPointer: 'pointer',
      toolNote: 'note',
      toolDraw: 'draw',
      toolErase: 'erase',
      toolMedia: 'image', // 'image' is the internal tool type for all media
      toolText: 'text',
      toolConnect: 'connect',
      toolFolder: 'folder',
    };
    const prev = this.workspaceTool;
    this.workspaceTool = toolMap[toolId] || 'pointer';
    // Cancel any in-progress connection when switching tools
    if (prev === 'connect' && this.workspaceTool !== 'connect') {
      this.connectFirstItem = null;
    }
    if (this.workspaceCanvas) {
      this.workspaceCanvas.classList.toggle('pan-cursor', this.workspaceTool === 'pointer');
      this.workspaceCanvas.classList.toggle('eraser-cursor', this.workspaceTool === 'erase');
      this.workspaceCanvas.classList.toggle('crosshair-cursor', this.workspaceTool === 'connect');
      this.workspaceCanvas.style.cursor = '';
    }
    this.updateToolOptions();
    this.drawWorkspace();
  }

  private updateToolOptions(): void {
    const wrap    = document.getElementById('toolOptions') as HTMLElement;
    const optBrush = document.getElementById('optBrushSize') as HTMLElement;
    const optErase = document.getElementById('optEraseSize') as HTMLElement;
    const optText  = document.getElementById('optTextStyle') as HTMLElement;
    if (!wrap || !optBrush || !optErase || !optText) return;

    const showText  = this.workspaceTool === 'text' ||
                      (this.workspaceTool === 'pointer' && this.selectedItem?.type === 'text');
    const showBrush = this.workspaceTool === 'draw';
    const showErase = this.workspaceTool === 'erase';
    const showAny   = showText || showBrush || showErase;

    wrap.style.display     = showAny   ? 'flex' : 'none';
    optBrush.style.display = showBrush ? 'flex' : 'none';
    optErase.style.display = showErase ? 'flex' : 'none';
    optText.style.display  = showText  ? 'flex' : 'none';

    // Sync controls with current item (pointer+text selected) or global defaults
    if (showText) {
      const selSz  = document.getElementById('textSizeSelect')  as HTMLSelectElement;
      const selFnt = document.getElementById('textFontSelect')   as HTMLSelectElement;
      const item   = (this.workspaceTool === 'pointer') ? this.selectedItem : null;
      if (selSz)  selSz.value  = String(item?.fontSize   ?? this.defaultFontSize);
      if (selFnt) selFnt.value = item?.fontFamily ?? this.defaultFontFamily;
    }
  }

  private startDrawing(x: number, y: number): void {
    if (!this.currentModule?.workspace) return;
    const ws = this.currentModule.workspace;
    // Store in item-local space (subtract offset) so strokes render correctly after panning
    const stroke: DrawingStroke = {
      points: [{ x: x - ws.offsetX, y: y - ws.offsetY }],
      color: this.drawColor,
      width: this.workspaceTool === 'erase' ? this.eraseWidth : this.drawWidth,
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

  private addTextItem(x: number, y: number): void {
    if (!this.currentModule?.workspace) return;
    const ws = this.currentModule.workspace;
    const item: WorkspaceItem = {
      id: Math.random().toString(36),
      type: 'text',
      x: x - ws.offsetX,
      y: y - ws.offsetY,
      width: 220,
      height: 80,
      content: '',
      color: '#ffffff',
      fontSize: this.defaultFontSize,
      fontFamily: this.defaultFontFamily,
      zIndex: ws.items.length,
    };
    ws.items.push(item);
    this.saveModules();
    this.pushHistory();
    this.drawWorkspace();
    // Open for editing immediately
    this.startEditingText(item);
  }

  private startEditingText(item: WorkspaceItem): void {
    if (item.type !== 'text' || !this.workspaceCanvas) return;
    const ws = this.currentModule?.workspace;
    if (!ws) return;

    const canvasRect = this.workspaceCanvas.getBoundingClientRect();
    const screenX = (item.x + ws.offsetX) * ws.zoom;
    const screenY = (item.y + ws.offsetY) * ws.zoom;
    const screenW = item.width  * ws.zoom;
    const screenH = item.height * ws.zoom;
    const fs = (item.fontSize || 16) * ws.zoom;

    const textarea = document.createElement('textarea');
    textarea.value = item.content || '';
    textarea.placeholder = 'Type here…';
    textarea.style.cssText = `
      position: fixed;
      left: ${canvasRect.left + screenX}px;
      top: ${canvasRect.top + screenY}px;
      width: ${screenW}px;
      height: ${screenH}px;
      background: rgba(0,0,0,0.55);
      border: 2px solid #00d4ff;
      padding: 4px 6px;
      font: ${fs}px ${item.fontFamily || 'Arial'}, sans-serif;
      color: ${item.color || '#ffffff'};
      resize: none;
      z-index: 10000;
      box-sizing: border-box;
      outline: none;
      border-radius: 2px;
      overflow: auto;
    `;
    document.body.appendChild(textarea);
    requestAnimationFrame(() => { textarea.focus(); textarea.select(); });

    const isNewItem = !item.content; // placed fresh — remove if user types nothing

    const removeIfEmpty = () => {
      if (!item.content && ws) {
        ws.items = ws.items.filter(i => i.id !== item.id);
      }
    };

    const finish = () => {
      if (!document.body.contains(textarea)) return;
      item.content = textarea.value.trim();
      document.body.removeChild(textarea);
      if (isNewItem && !item.content) {
        removeIfEmpty();
      }
      this.saveModules();
      this.pushHistory();
      this.drawWorkspace();
    };

    requestAnimationFrame(() => textarea.addEventListener('blur', finish));
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (document.body.contains(textarea)) document.body.removeChild(textarea);
        if (isNewItem) removeIfEmpty();
        this.saveModules();
        this.drawWorkspace();
      } else if (e.key === 'Enter' && e.ctrlKey) {
        finish();
      }
      e.stopPropagation();
    });
  }

  private handleConnectClick(x: number, y: number): void {
    const ws = this.currentModule?.workspace;
    if (!ws) return;

    const item = this.getItemAtPosition(x, y, ws);
    if (!item || item.type === 'drawing') {
      // Clicked empty space — cancel pending selection
      this.connectFirstItem = null;
      this.drawWorkspace();
      return;
    }

    if (!this.connectFirstItem) {
      // First click — mark source item
      this.connectFirstItem = item;
      this.drawWorkspace();
    } else if (this.connectFirstItem.id === item.id) {
      // Clicked the same item — deselect
      this.connectFirstItem = null;
      this.drawWorkspace();
    } else {
      // Second click on a different item — create connection
      if (!ws.connections) ws.connections = [];
      const alreadyExists = ws.connections.some(
        (c) => (c.fromId === this.connectFirstItem!.id && c.toId === item.id) ||
                (c.fromId === item.id && c.toId === this.connectFirstItem!.id)
      );
      if (!alreadyExists) {
        ws.connections.push({
          id: Math.random().toString(36),
          fromId: this.connectFirstItem.id,
          toId: item.id,
        });
        this.saveModules();
        this.pushHistory();
      }
      this.connectFirstItem = null;
      this.drawWorkspace();
    }
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

    const name = fileName ? fileName.replace(/\.[^.]+$/, '') : undefined;

    const w = 200;
    const h = type === 'video' ? 140 : 200;
    const cx = this.mouseCanvasX || (this.workspaceCanvas ? this.workspaceCanvas.width / ws.zoom / 2 : 300);
    const cy = this.mouseCanvasY || (this.workspaceCanvas ? this.workspaceCanvas.height / ws.zoom / 2 : 200);
    const item: WorkspaceItem = {
      id: Math.random().toString(36).slice(2),
      type,
      x: cx - ws.offsetX - w / 2,
      y: cy - ws.offsetY - h / 2,
      width: w,
      height: h,
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

    // Multi-select highlight (orange dashed border + numbered badge)
    if (this.selectedWorkspaceItems.has(item.id)) {
      const idx = Array.from(this.selectedWorkspaceItems).indexOf(item.id) + 1;
      ctx.strokeStyle = '#ff9500';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([6, 3]);
      ctx.strokeRect(-4, -4, w + 8, h + 8);
      ctx.setLineDash([]);
      const badgeR = 10;
      ctx.fillStyle = '#ff9500';
      ctx.beginPath();
      ctx.arc(badgeR, badgeR, badgeR, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.min(11, badgeR * 1.2)}px Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(idx), badgeR, badgeR);
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

      case 'text': {
        const fontSize = item.fontSize || 16;
        ctx.font = `${fontSize}px ${item.fontFamily || 'Arial'}, sans-serif`;
        ctx.fillStyle = item.color || '#ffffff';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.shadowColor = 'rgba(0,0,0,0.85)';
        ctx.shadowBlur = 4;
        const textLines = this.wrapText(ctx, item.content || '', w - 8);
        textLines.forEach((line, i) => {
          if (4 + i * (fontSize + 4) < h) ctx.fillText(line, 4, 4 + i * (fontSize + 4));
        });
        ctx.shadowColor = 'transparent';
        break;
      }

      case 'folder': {
        const isDragTarget = this.dragOverFolderId === item.id;
        ctx.fillStyle = isDragTarget ? '#1a2510' : '#111a10';
        ctx.shadowColor = 'rgba(0,0,0,0.4)';
        ctx.shadowBlur = 8;
        ctx.fillRect(0, 0, w, h);
        ctx.shadowColor = 'transparent';

        if (isDragTarget) {
          ctx.strokeStyle = '#00ff88';
          ctx.lineWidth = 2;
          ctx.setLineDash([5, 3]);
          ctx.strokeRect(2, 2, w - 4, h - 4);
          ctx.setLineDash([]);
        }

        const fileCount = item.files?.length ?? 0;
        const fEmojiSize = Math.round(Math.min(w, h) * 0.42);
        const emojiYOffset = fileCount > 0 ? -8 : 0;
        ctx.font = `${fEmojiSize}px serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(isDragTarget ? '📂' : '📁', w / 2, h / 2 + emojiYOffset);

        if (fileCount > 0) {
          ctx.fillStyle = isDragTarget ? 'rgba(0,255,136,0.85)' : 'rgba(0,212,255,0.75)';
          ctx.font = `bold ${Math.max(9, Math.min(11, w * 0.08))}px Arial`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillText(`${fileCount} file${fileCount !== 1 ? 's' : ''}`, w / 2, h / 2 + fEmojiSize * 0.55 + emojiYOffset);
        }

        const fLabel = item.name || 'Folder';
        const fLabelH = 22;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(0, h - fLabelH, w, fLabelH);
        ctx.fillStyle = isDragTarget ? 'rgba(0,255,136,0.9)' : 'rgba(255,255,255,0.88)';
        ctx.font = `${Math.max(9, Math.min(11, w * 0.07))}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const fDN = fLabel.length > 24 ? fLabel.slice(0, 22) + '…' : fLabel;
        ctx.fillText(fDN, w / 2, h - fLabelH / 2);
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

  private getConnectionAtPosition(x: number, y: number, ws: WorkspaceData): Connection | null {
    if (!ws.connections?.length) return null;
    const threshold = 8 / ws.zoom; // 8 screen-pixels tolerance
    for (const conn of ws.connections) {
      const fromItem = ws.items.find((i) => i.id === conn.fromId);
      const toItem   = ws.items.find((i) => i.id === conn.toId);
      if (!fromItem || !toItem) continue;
      const ax = fromItem.x + ws.offsetX + fromItem.width  / 2;
      const ay = fromItem.y + ws.offsetY + fromItem.height / 2;
      const bx = toItem.x   + ws.offsetX + toItem.width   / 2;
      const by = toItem.y   + ws.offsetY + toItem.height  / 2;
      const dx = bx - ax;
      const dy = by - ay;
      const lenSq = dx * dx + dy * dy;
      if (lenSq === 0) continue;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / lenSq));
      const px = ax + t * dx;
      const py = ay + t * dy;
      const dist = Math.sqrt((x - px) ** 2 + (y - py) ** 2);
      if (dist <= threshold) return conn;
    }
    return null;
  }

  private removeConnection(connId: string): void {
    const ws = this.currentModule?.workspace;
    if (!ws?.connections) return;
    ws.connections = ws.connections.filter((c) => c.id !== connId);
    this.saveModules();
    this.pushHistory();
    this.drawWorkspace();
  }

  private removeAllConnectionsForItem(itemId: string): void {
    const ws = this.currentModule?.workspace;
    if (!ws?.connections) return;
    ws.connections = ws.connections.filter((c) => c.fromId !== itemId && c.toId !== itemId);
    this.saveModules();
    this.pushHistory();
    this.drawWorkspace();
  }

  private removeConnectedStructure(startItemId: string): void {
    const ws = this.currentModule?.workspace;
    if (!ws?.connections) return;
    // BFS to find all item IDs in the connected component
    const visited = new Set<string>([startItemId]);
    const queue = [startItemId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      ws.connections
        .filter((c) => c.fromId === current || c.toId === current)
        .forEach((c) => {
          const neighbor = c.fromId === current ? c.toId : c.fromId;
          if (!visited.has(neighbor)) { visited.add(neighbor); queue.push(neighbor); }
        });
    }
    // Remove all connections where both endpoints are in the component
    ws.connections = ws.connections.filter((c) => !visited.has(c.fromId) || !visited.has(c.toId));
    this.saveModules();
    this.pushHistory();
    this.drawWorkspace();
  }

  private showConnectionContextMenu(screenX: number, screenY: number, conn: Connection): void {
    this.hideContextMenu();
    const ws = this.currentModule?.workspace;
    if (!ws) return;

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
      min-width: 170px;
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

    menu.appendChild(makeBtn('✂  Remove connection', () => this.removeConnection(conn.id)));

    const divider = document.createElement('div');
    divider.style.cssText = 'height:1px;background:rgba(0,212,255,0.15);margin:2px 0;';
    menu.appendChild(divider);

    menu.appendChild(makeBtn('🗑  Remove whole structure', () => this.removeConnectedStructure(conn.fromId)));
    document.body.appendChild(menu);

    requestAnimationFrame(() => {
      const r = menu.getBoundingClientRect();
      if (r.right  > window.innerWidth)  menu.style.left = `${screenX - r.width}px`;
      if (r.bottom > window.innerHeight) menu.style.top  = `${screenY - r.height}px`;
    });

    const closeHandler = (e: MouseEvent) => {
      if (!menu.contains(e.target as Node)) {
        this.hideContextMenu();
        document.removeEventListener('mousedown', closeHandler, true);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', closeHandler, true), 0);
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

    if (item.type === 'folder') {
      menu.appendChild(makeBtn('📂  Open folder', () => this.openFolderPopup(item)));
      const sep = document.createElement('div');
      sep.style.cssText = 'height:1px;background:rgba(0,212,255,0.15);margin:2px 0;';
      menu.appendChild(sep);
    }
    menu.appendChild(makeBtn('✏  Rename', () => this.startRenamingItem(item)));
    menu.appendChild(makeBtn('🗑  Delete', () => this.deleteWorkspaceItem(item)));

    // Connection options when this item participates in any connections
    const ws = this.currentModule?.workspace;
    if (ws?.connections?.some((c) => c.fromId === item.id || c.toId === item.id)) {
      const divider = document.createElement('div');
      divider.style.cssText = 'height:1px;background:rgba(0,212,255,0.15);margin:2px 0;';
      menu.appendChild(divider);
      menu.appendChild(makeBtn('🔗  Remove connections', () => this.removeAllConnectionsForItem(item.id)));
      menu.appendChild(makeBtn('🗑  Remove whole structure', () => this.removeConnectedStructure(item.id)));
    }

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
    const ws = this.currentModule.workspace;
    ws.items = ws.items.filter((i) => i.id !== item.id);
    // Remove any connections that referenced this item
    if (ws.connections) {
      ws.connections = ws.connections.filter((c) => c.fromId !== item.id && c.toId !== item.id);
    }
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
      image: 'Image', video: 'Video', pdf: 'PDF Document', note: 'Note', text: 'Text', folder: 'Folder',
    };
    return map[type] ?? 'Item';
  }

  // ===== FOLDER METHODS =====

  private addFolderItem(x: number, y: number): void {
    if (!this.currentModule?.workspace) return;
    const ws = this.currentModule.workspace;
    const item: WorkspaceItem = {
      id: Math.random().toString(36),
      type: 'folder',
      x: x - ws.offsetX,
      y: y - ws.offsetY,
      width: 160,
      height: 160,
      name: 'New Folder',
      files: [],
      zIndex: ws.items.length,
    };
    ws.items.push(item);
    this.saveModules();
    this.pushHistory();
    this.drawWorkspace();
    // Open the folder immediately so the user can add files right away
    this.openFolderPopup(item);
  }

  private openFolderPopup(item: WorkspaceItem): void {
    if (item.type !== 'folder') return;
    this.closeFolderPopup();
    this.folderPopupItemId = item.id;

    const popup = document.createElement('div');
    popup.id = 'folderPopup';
    popup.style.cssText = `
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.88);
      display: flex; align-items: center; justify-content: center;
      z-index: 2147483647;
    `;

    const content = document.createElement('div');
    content.style.cssText = `
      position: relative;
      background: #0d1117;
      border: 1px solid rgba(0,212,255,0.35);
      border-radius: 12px;
      width: min(92vw, 820px);
      max-height: 85vh;
      overflow: hidden;
      display: flex; flex-direction: column;
      box-shadow: 0 0 60px rgba(0,212,255,0.15), 0 20px 60px rgba(0,0,0,0.8);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    `;

    // ── Header ──────────────────────────────────────────────────────────────
    const header = document.createElement('div');
    header.style.cssText = `
      display: flex; align-items: center; justify-content: space-between;
      padding: 14px 20px; gap: 12px;
      border-bottom: 1px solid rgba(0,212,255,0.15);
      background: rgba(0,212,255,0.04);
      flex-shrink: 0;
    `;

    // Editable folder name
    const titleWrap = document.createElement('div');
    titleWrap.style.cssText = `display:flex;align-items:center;gap:8px;min-width:0;`;
    const folderIcon = document.createElement('span');
    folderIcon.textContent = '📁';
    folderIcon.style.fontSize = '18px';
    const titleSpan = document.createElement('span');
    titleSpan.textContent = item.name || 'Folder';
    titleSpan.style.cssText = `color:#00d4ff;font-size:16px;font-weight:600;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:300px;`;
    titleSpan.title = 'Click to rename';
    titleSpan.onclick = () => {
      const input = document.createElement('input');
      input.type = 'text';
      input.value = item.name || '';
      input.placeholder = 'Folder name';
      input.style.cssText = `
        background:rgba(0,212,255,0.08);border:1px solid rgba(0,212,255,0.4);
        color:#00d4ff;padding:3px 8px;border-radius:4px;
        font-size:15px;font-weight:600;outline:none;width:220px;
        font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
      `;
      titleWrap.replaceChild(input, titleSpan);
      input.focus(); input.select();
      const commit = () => {
        item.name = input.value.trim() || 'Folder';
        titleSpan.textContent = item.name;
        titleWrap.replaceChild(titleSpan, input);
        this.saveModules();
        this.drawWorkspace();
      };
      input.addEventListener('blur', commit);
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') commit();
        else if (ev.key === 'Escape') { titleWrap.replaceChild(titleSpan, input); }
        ev.stopPropagation();
      });
    };
    titleWrap.appendChild(folderIcon);
    titleWrap.appendChild(titleSpan);

    const rightBtns = document.createElement('div');
    rightBtns.style.cssText = `display:flex;gap:8px;align-items:center;flex-shrink:0;`;

    const addBtn = document.createElement('button');
    addBtn.textContent = '+ Add Files';
    addBtn.style.cssText = `
      background:rgba(0,212,255,0.12);border:1px solid rgba(0,212,255,0.4);
      color:#00d4ff;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:13px;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
    `;
    addBtn.onmouseover = () => { addBtn.style.background = 'rgba(0,212,255,0.22)'; };
    addBtn.onmouseout  = () => { addBtn.style.background = 'rgba(0,212,255,0.12)'; };
    addBtn.onclick = () => this.triggerAddFilesToFolder(item);

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = `
      background:rgba(0,212,255,0.08);border:1px solid rgba(0,212,255,0.3);
      color:#00d4ff;width:32px;height:32px;border-radius:50%;
      cursor:pointer;font-size:15px;display:flex;align-items:center;justify-content:center;
    `;
    closeBtn.onclick = () => this.closeFolderPopup();

    rightBtns.appendChild(addBtn);
    rightBtns.appendChild(closeBtn);
    header.appendChild(titleWrap);
    header.appendChild(rightBtns);

    // ── Drop zone overlay (shown while dragging into popup) ─────────────────
    const dropOverlay = document.createElement('div');
    dropOverlay.style.cssText = `
      display:none;position:absolute;inset:0;
      background:rgba(0,212,255,0.07);
      border:2px dashed rgba(0,212,255,0.55);
      border-radius:12px;
      align-items:center;justify-content:center;
      font-size:22px;color:#00d4ff;
      pointer-events:none;z-index:10;
    `;
    dropOverlay.textContent = '📂  Drop files here';

    // ── File grid body ────────────────────────────────────────────────────────
    const body = document.createElement('div');
    body.id = 'folderPopupBody';
    body.style.cssText = `flex:1;overflow-y:auto;padding:20px;min-height:180px;`;

    content.appendChild(header);
    content.appendChild(body);
    content.appendChild(dropOverlay);
    popup.appendChild(content);
    document.body.appendChild(popup);

    this.renderFolderFiles(item);

    // Close on backdrop click
    popup.addEventListener('mousedown', (e) => { if (e.target === popup) this.closeFolderPopup(); });

    // Drag & drop files into folder via popup
    content.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer?.types.includes('Files')) dropOverlay.style.display = 'flex';
    });
    content.addEventListener('dragleave', (e) => {
      if (!content.contains(e.relatedTarget as Node)) dropOverlay.style.display = 'none';
    });
    content.addEventListener('drop', (e) => {
      e.preventDefault();
      dropOverlay.style.display = 'none';
      if (e.dataTransfer?.files.length) {
        this.addFilesToFolder(item, Array.from(e.dataTransfer.files));
      }
    });
  }

  private renderFolderFiles(item: WorkspaceItem): void {
    const body = document.getElementById('folderPopupBody');
    if (!body) return;
    const files = item.files ?? [];

    if (files.length === 0) {
      body.innerHTML = `
        <div style="
          display:flex;flex-direction:column;align-items:center;justify-content:center;
          height:160px;color:rgba(255,255,255,0.3);font-size:14px;
          font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
        ">
          <div style="font-size:52px;margin-bottom:14px;">📂</div>
          <div>No files yet — drag files in or click <strong style="color:rgba(0,212,255,0.6)">+ Add Files</strong></div>
        </div>`;
      return;
    }

    const grid = document.createElement('div');
    grid.style.cssText = `display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:12px;`;

    files.forEach((file) => {
      const card = document.createElement('div');
      card.style.cssText = `
        position:relative;background:rgba(255,255,255,0.04);
        border:1px solid rgba(255,255,255,0.1);border-radius:8px;
        padding:14px 8px 8px;cursor:pointer;
        display:flex;flex-direction:column;align-items:center;gap:6px;
        font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
        transition:background 0.12s,border-color 0.12s;
      `;

      const delBtn = document.createElement('button');
      delBtn.innerHTML = '✕';
      delBtn.title = 'Remove file';
      delBtn.style.cssText = `
        position:absolute;top:4px;right:4px;
        background:rgba(255,60,60,0.15);border:1px solid rgba(255,60,60,0.3);
        color:rgba(255,100,100,0.9);width:20px;height:20px;border-radius:50%;
        cursor:pointer;font-size:10px;display:flex;align-items:center;justify-content:center;
        opacity:0;transition:opacity 0.12s;padding:0;
      `;
      delBtn.onclick = (e) => { e.stopPropagation(); this.removeFileFromFolder(item, file.id); };

      const emojiEl = document.createElement('div');
      emojiEl.textContent = this.getFileEmoji(file.mimeType);
      emojiEl.style.cssText = `font-size:34px;line-height:1;`;

      const nameEl = document.createElement('div');
      const dispName = file.name.length > 16 ? file.name.slice(0, 14) + '…' : file.name;
      nameEl.textContent = dispName;
      nameEl.title = file.name;
      nameEl.style.cssText = `font-size:11px;color:rgba(255,255,255,0.65);text-align:center;word-break:break-word;line-height:1.3;`;

      card.onmouseover = () => {
        card.style.background = 'rgba(0,212,255,0.08)';
        card.style.borderColor = 'rgba(0,212,255,0.3)';
        delBtn.style.opacity = '1';
      };
      card.onmouseout = () => {
        card.style.background = 'rgba(255,255,255,0.04)';
        card.style.borderColor = 'rgba(255,255,255,0.1)';
        delBtn.style.opacity = '0';
      };
      card.onclick = () => this.openFolderFile(file);

      card.appendChild(delBtn);
      card.appendChild(emojiEl);
      card.appendChild(nameEl);
      grid.appendChild(card);
    });

    body.innerHTML = '';
    body.appendChild(grid);
  }

  private closeFolderPopup(): void {
    const popup = document.getElementById('folderPopup');
    if (popup?.parentNode) popup.parentNode.removeChild(popup);
    this.folderPopupItemId = null;
  }

  private triggerAddFilesToFolder(item: WorkspaceItem): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = 'image/*,video/*,audio/*,.pdf,application/pdf,.txt,.doc,.docx,.xls,.xlsx,.ppt,.pptx';
    input.onchange = (e) => {
      const files = Array.from((e.target as HTMLInputElement).files ?? []);
      if (files.length) this.addFilesToFolder(item, files);
    };
    input.click();
  }

  private addFilesToFolder(item: WorkspaceItem, files: File[]): void {
    if (item.type !== 'folder') return;
    if (!item.files) item.files = [];
    let remaining = files.length;
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (evt) => {
        item.files!.push({
          id: Math.random().toString(36),
          name: file.name,
          mimeType: file.type || 'application/octet-stream',
          content: evt.target!.result as string,
        });
        remaining--;
        if (remaining === 0) {
          this.saveModules();
          this.pushHistory();
          this.drawWorkspace();
          if (this.folderPopupItemId === item.id) this.renderFolderFiles(item);
        }
      };
      reader.readAsDataURL(file);
    });
  }

  private removeFileFromFolder(item: WorkspaceItem, fileId: string): void {
    if (!item.files) return;
    item.files = item.files.filter((f) => f.id !== fileId);
    this.saveModules();
    this.pushHistory();
    this.drawWorkspace();
    if (this.folderPopupItemId === item.id) this.renderFolderFiles(item);
  }

  private openFolderFile(file: FolderFile): void {
    const mime = file.mimeType;
    if (mime.startsWith('image/')) {
      // Reuse image lightbox with a temp item
      this.fullScreenImage = { id: 'tmp', type: 'image', x: 0, y: 0, width: 0, height: 0, content: file.content, zIndex: 0 };
      const lightbox = document.getElementById('imageLightbox');
      const img = document.getElementById('lightboxImage') as HTMLImageElement;
      if (lightbox && img) { img.src = file.content; lightbox.classList.add('show'); this.setupLightboxControls(); }
    } else if (mime.startsWith('video/') || mime === 'application/pdf' || mime === 'pdf') {
      const type = mime.startsWith('video/') ? 'video' : 'pdf';
      const tmpItem: WorkspaceItem = { id: 'tmp', type, x: 0, y: 0, width: 0, height: 0, content: file.content, zIndex: 0, name: file.name };
      this.openMediaViewer(tmpItem);
    } else if (mime.startsWith('audio/')) {
      this.openAudioViewer(file);
    } else {
      // Generic: show in a simple overlay with iframe
      this.openGenericFileViewer(file);
    }
  }

  private openAudioViewer(file: FolderFile): void {
    const viewer = document.getElementById('mediaViewer');
    const body = document.getElementById('mediaViewerBody');
    if (!viewer || !body) return;
    body.innerHTML = '';
    const audio = document.createElement('audio');
    audio.src = file.content;
    audio.controls = true;
    audio.autoplay = true;
    audio.style.cssText = 'width:100%;margin:20px 0;display:block;';
    const label = document.createElement('p');
    label.textContent = file.name;
    label.style.cssText = 'color:#fff;text-align:center;margin:0 0 12px;font-size:14px;opacity:0.7;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;';
    body.appendChild(label);
    body.appendChild(audio);
    viewer.style.display = 'flex';
    const closeBtn = document.getElementById('closeMediaViewer');
    if (closeBtn) closeBtn.onclick = () => this.closeMediaViewer();
    const bdHandler = (e: MouseEvent) => { if (e.target === viewer) { this.closeMediaViewer(); viewer.removeEventListener('click', bdHandler); } };
    viewer.addEventListener('click', bdHandler);
  }

  private openGenericFileViewer(file: FolderFile): void {
    const viewer = document.getElementById('mediaViewer');
    const body = document.getElementById('mediaViewerBody');
    if (!viewer || !body) return;
    body.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;padding:30px 20px;gap:14px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;';
    const icon = document.createElement('div');
    icon.textContent = this.getFileEmoji(file.mimeType);
    icon.style.fontSize = '56px';
    const nm = document.createElement('p');
    nm.textContent = file.name;
    nm.style.cssText = 'color:#fff;font-size:15px;margin:0;opacity:0.85;text-align:center;';
    const dlBtn = document.createElement('a');
    dlBtn.href = file.content;
    dlBtn.download = file.name;
    dlBtn.textContent = '⬇  Download file';
    dlBtn.style.cssText = 'color:#00d4ff;font-size:13px;text-decoration:none;border:1px solid rgba(0,212,255,0.4);padding:6px 16px;border-radius:6px;';
    wrap.appendChild(icon);
    wrap.appendChild(nm);
    wrap.appendChild(dlBtn);
    body.appendChild(wrap);
    viewer.style.display = 'flex';
    const closeBtn = document.getElementById('closeMediaViewer');
    if (closeBtn) closeBtn.onclick = () => this.closeMediaViewer();
    const bdHandler = (e: MouseEvent) => { if (e.target === viewer) { this.closeMediaViewer(); viewer.removeEventListener('click', bdHandler); } };
    viewer.addEventListener('click', bdHandler);
  }

  // ── Timer ────────────────────────────────────────────────────────────────

  private formatStopwatch(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  private formatPomodoro(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  private formatTotalTime(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m ${s}s`;
  }

  private startTimer(): void {
    if (this.timerRunning) return;
    const now = Date.now();
    this.timerRunning = true;
    this.swStartTs = now;
    if (this.timerMode === 'pomodoro') {
      // Reconstruct phase start so that the current secondsLeft stays accurate
      const phaseDur = this.pomodoroPhase === 'work' ? 25 * 60 : 5 * 60;
      this.pomodoroPhaseStartTs = now - (phaseDur - this.pomodoroSecondsLeft) * 1000;
      // Seconds already credited to studyTime in this phase before this resume
      this.pomodoroLastWorkSec = this.pomodoroPhase === 'work' ? phaseDur - this.pomodoroSecondsLeft : 0;
    }
    this.updateTimerStartPauseBtn();
    // Poll at 500 ms so the display catches up quickly after un-minimising
    this.timerInterval = setInterval(() => this.timerTick(), 500);
  }

  private pauseTimer(): void {
    if (!this.timerRunning) return;
    this.flushTimerState(); // sync state from wall-clock before stopping
    this.timerRunning = false;
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    // Persist base so the next Start resumes from here
    this.swBaseSeconds = this.stopwatchSeconds;
    this.updateTimerStartPauseBtn();
    if (this.currentModule) this.saveModules();
  }

  private resetTimer(): void {
    this.resetConfirmPending = false;
    this.pauseTimer();
    this.stopwatchSeconds = 0;
    this.swBaseSeconds = 0;
    this.pomodoroPhase = 'work';
    this.pomodoroSecondsLeft = 25 * 60;
    this.pomodoroLastWorkSec = 0;
    this.sessionSeconds = 0;
    this.updateTimerDisplay();
    this.updateTimerTotalDisplay();
    this.updateSessionDisplay();
    const phaseLabel = document.getElementById('timerPhaseLabel');
    if (phaseLabel) {
      phaseLabel.textContent = '🍅 Work';
      phaseLabel.className = 'timer-phase-label phase-work';
    }
    const resetBtn = document.getElementById('timerReset');
    if (resetBtn) {
      resetBtn.textContent = '↺ Reset';
      resetBtn.classList.remove('timer-reset-confirm');
    }
  }

  // Recompute all timer state from wall-clock timestamps.
  // Called every 500 ms and immediately when the page becomes visible again.
  private flushTimerState(): void {
    const now = Date.now();

    if (this.timerMode === 'stopwatch') {
      const elapsed = Math.floor((now - this.swStartTs) / 1000);
      const newSec = this.swBaseSeconds + elapsed;
      const delta = newSec - this.stopwatchSeconds;
      this.stopwatchSeconds = newSec;
      if (this.currentModule && delta > 0) {
        this.currentModule.studyTime = (this.currentModule.studyTime ?? 0) + delta;
        this.sessionSeconds += delta;
      }
    } else {
      // Pomodoro — elapsed time since current phase started
      let phaseElapsed = Math.floor((now - this.pomodoroPhaseStartTs) / 1000);
      let phaseDur = this.pomodoroPhase === 'work' ? 25 * 60 : 5 * 60;

      // Handle one or more phase transitions that happened while minimised
      while (phaseElapsed >= phaseDur) {
        // Credit any remaining work seconds in the phase that just ended
        if (this.pomodoroPhase === 'work') {
          const workDelta = phaseDur - this.pomodoroLastWorkSec;
          if (this.currentModule && workDelta > 0) {
            this.currentModule.studyTime = (this.currentModule.studyTime ?? 0) + workDelta;
            this.sessionSeconds += workDelta;
          }
        }
        phaseElapsed -= phaseDur;
        this.pomodoroPhase = this.pomodoroPhase === 'work' ? 'break' : 'work';
        this.pomodoroLastWorkSec = 0;
        phaseDur = this.pomodoroPhase === 'work' ? 25 * 60 : 5 * 60;
        // KEY: advance the phase-start timestamp so the next flush sees correct elapsed
        this.pomodoroPhaseStartTs = now - phaseElapsed * 1000;
        this.playBeep();
        this.updatePomodoroPhaseLabel();
      }

      // Credit work seconds in the current (ongoing) phase
      if (this.pomodoroPhase === 'work') {
        const workDelta = phaseElapsed - this.pomodoroLastWorkSec;
        if (this.currentModule && workDelta > 0) {
          this.currentModule.studyTime = (this.currentModule.studyTime ?? 0) + workDelta;
          this.sessionSeconds += workDelta;
        }
        this.pomodoroLastWorkSec = phaseElapsed;
      }
      this.pomodoroSecondsLeft = phaseDur - phaseElapsed;
    }
  }

  private timerTick(): void {
    this.flushTimerState();
    this.updateTimerDisplay();
    this.updateTimerTotalDisplay();
    this.updateSessionDisplay();
    // Autosave every ~30 s
    if (this.currentModule && this.stopwatchSeconds % 30 === 0 && this.stopwatchSeconds > 0) {
      this.saveModules();
    }
  }

  private updateTimerDisplay(): void {
    const display = document.getElementById('timerDisplay');
    if (!display) return;
    display.textContent = this.timerMode === 'stopwatch'
      ? this.formatStopwatch(this.stopwatchSeconds)
      : this.formatPomodoro(this.pomodoroSecondsLeft);
  }

  private updateTimerTotalDisplay(): void {
    const el = document.getElementById('timerTotalDisplay');
    if (el && el.tagName === 'SPAN' && this.currentModule) {
      el.textContent = this.formatTotalTime(this.currentModule.studyTime ?? 0);
    }
  }

  private updateSessionDisplay(): void {
    const el = document.getElementById('timerSessionDisplay');
    if (el) el.textContent = this.formatStopwatch(this.sessionSeconds);
  }

  private editTotalTime(): void {
    const span = document.getElementById('timerTotalDisplay');
    if (!span || !this.currentModule) return;

    const currentSeconds = this.currentModule.studyTime ?? 0;
    const h = Math.floor(currentSeconds / 3600);
    const m = Math.floor((currentSeconds % 3600) / 60);
    const s = currentSeconds % 60;

    const input = document.createElement('input');
    input.type = 'text';
    input.value = `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    input.className = 'timer-total-edit';
    input.title = 'H:MM:SS — Enter to save, Esc to cancel';

    const restore = (newSeconds?: number) => {
      const finalSeconds = newSeconds ?? currentSeconds;
      if (newSeconds !== undefined && this.currentModule) {
        this.currentModule.studyTime = finalSeconds;
        this.saveModules();
      }
      const newSpan = document.createElement('span');
      newSpan.id = 'timerTotalDisplay';
      newSpan.className = 'timer-total-value';
      newSpan.title = 'Double-click to edit';
      newSpan.style.cursor = 'pointer';
      newSpan.textContent = this.formatTotalTime(this.currentModule?.studyTime ?? 0);
      newSpan.addEventListener('dblclick', () => this.editTotalTime());
      input.replaceWith(newSpan);
    };

    const commit = () => {
      const parts = input.value.trim().split(':').map(Number);
      let parsed = NaN;
      if (parts.length === 3 && parts.every(n => !isNaN(n))) parsed = parts[0] * 3600 + parts[1] * 60 + parts[2];
      else if (parts.length === 2 && parts.every(n => !isNaN(n))) parsed = parts[0] * 60 + parts[1];
      else if (parts.length === 1 && !isNaN(parts[0])) parsed = parts[0];
      restore(isNaN(parsed) || parsed < 0 ? undefined : Math.floor(parsed));
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { input.removeEventListener('blur', commit); restore(); }
    });
    input.addEventListener('blur', commit);

    span.replaceWith(input);
    input.select();
  }

  private updateTimerStartPauseBtn(): void {
    const btn = document.getElementById('timerStartPause');
    if (btn) btn.textContent = this.timerRunning ? '⏸ Pause' : '▶ Start';
  }

  private updatePomodoroPhaseLabel(): void {
    const label = document.getElementById('timerPhaseLabel');
    if (label) {
      label.textContent = this.pomodoroPhase === 'work' ? '🍅 Work' : '☕ Break';
      label.className = `timer-phase-label ${this.pomodoroPhase === 'work' ? 'phase-work' : 'phase-break'}`;
    }
  }

  private switchTimerMode(mode: 'stopwatch' | 'pomodoro'): void {
    if (this.timerMode === mode) return;
    this.pauseTimer();
    this.timerMode = mode;
    this.stopwatchSeconds = 0;
    this.pomodoroPhase = 'work';
    this.pomodoroSecondsLeft = 25 * 60;
    this.render();
  }

  private playBeep(): void {
    try {
      const ctx = new AudioContext();
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);
      oscillator.frequency.value = 880;
      oscillator.type = 'sine';
      gainNode.gain.setValueAtTime(0.3, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
      oscillator.start(ctx.currentTime);
      oscillator.stop(ctx.currentTime + 0.8);
    } catch (_e) {
      // Audio not available
    }
  }

  // ─── Theme ──────────────────────────────────────────────────────────────────

  private applyTheme(): void {
    if (this.theme === 'light') {
      document.body.classList.add('light-mode');
    } else {
      document.body.classList.remove('light-mode');
    }
  }

  private setTheme(theme: 'dark' | 'light'): void {
    this.theme = theme;
    localStorage.setItem('study-tracker-theme', theme);
    this.applyTheme();
    this.render();
  }

  // ─── Settings navigation ────────────────────────────────────────────────────

  private openSettings(): void {
    this.isSettingsView = true;
    this.backupStatus = '';
    this.render();
  }

  private closeSettings(): void {
    this.isSettingsView = false;
    this.render();
  }

  // ─── Backup ──────────────────────────────────────────────────────────────────

  private exportBackupFile(): void {
    const data = JSON.stringify({ modules: this.modules, archiveGroups: this.archiveGroups }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `study-tracker-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    this.backupStatus = 'success:Backup file downloaded.';
    this.render();
  }

  private importBackupFile(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const parsed = JSON.parse(ev.target?.result as string);
          // Support both new { modules, archiveGroups } format and legacy plain array
          if (Array.isArray(parsed)) {
            this.modules = parsed;
          } else if (parsed && Array.isArray(parsed.modules)) {
            this.modules = parsed.modules;
            this.archiveGroups = Array.isArray(parsed.archiveGroups) ? parsed.archiveGroups : [];
          } else {
            throw new Error('Invalid format');
          }
          this.saveModules();
          this.pushHistory();
          this.backupStatus = `success:Imported ${this.modules.length} module(s) successfully.`;
        } catch {
          this.backupStatus = 'error:Invalid backup file.';
        }
        this.render();
      };
      reader.readAsText(file);
    };
    input.click();
  }

  private async createCloudBackup(): Promise<void> {
    if (!this.currentUser) {
      this.backupStatus = 'error:You must be signed in to create a cloud backup.';
      this.render();
      return;
    }
    this.backupStatus = 'loading:Creating backup…';
    this.render();
    try {
      await saveUserBackup(this.currentUser.uid, this.modules, this.archiveGroups);
      this.lastCloudBackupTime = Date.now();
      this.backupStatus = `success:Cloud backup created at ${new Date().toLocaleTimeString()}.`;
    } catch {
      this.backupStatus = 'error:Cloud backup failed. Check your connection.';
    }
    this.render();
  }

  private async restoreCloudBackup(): Promise<void> {
    if (!this.currentUser) {
      this.backupStatus = 'error:You must be signed in to restore a cloud backup.';
      this.render();
      return;
    }
    if (!confirm('Restore cloud backup? This will replace your current modules and archive.')) return;
    this.backupStatus = 'loading:Restoring backup…';
    this.render();
    try {
      const result = await loadUserBackup(this.currentUser.uid);
      if (!result) {
        this.backupStatus = 'error:No cloud backup found for this account.';
      } else {
        this.modules = result.modules as Module[];
        this.archiveGroups = (result.archiveGroups as ArchiveGroup[]) ?? [];
        this.saveModules();
        this.pushHistory();
        this.backupStatus = `success:Restored ${result.modules.length} module(s) from backup.`;
      }
    } catch {
      this.backupStatus = 'error:Restore failed. Check your connection.';
    }
    this.render();
  }

  // ─── Settings view ───────────────────────────────────────────────────────────

  private renderSettingsView(): string {
    const [statusType, statusMsg] = this.backupStatus.includes(':')
      ? this.backupStatus.split(':')
      : ['', this.backupStatus];

    const signedIn = !!this.currentUser;

    return `
      <div class="settings-view">
        <div class="settings-header">
          <button class="back-btn" id="settingsBackBtn">←</button>
          <h1>Settings</h1>
        </div>
        <div class="settings-content">

          <div class="settings-section">
            <div class="settings-section-title">Backup</div>

            <div class="settings-card">
              <div class="settings-card-title">Cloud Backup</div>
              <div class="settings-card-desc">Save a snapshot of all your modules and workspace data to your account on the cloud. You can restore it at any time.</div>
              <div class="settings-card-actions">
                <button class="settings-btn-action" id="settingsCloudBackupBtn" ${!signedIn ? 'disabled title="Sign in to use cloud backup"' : ''}>
                  ☁ Create Backup
                </button>
                <button class="settings-btn-action" id="settingsRestoreBackupBtn" ${!signedIn ? 'disabled title="Sign in to restore"' : ''}>
                  ↩ Restore Backup
                </button>
              </div>
              ${statusMsg ? `<div class="settings-status ${statusType}">${this.escapeHtml(statusMsg)}</div>` : ''}
            </div>

            <div class="settings-card">
              <div class="settings-card-title">Local Backup</div>
              <div class="settings-card-desc">Export all your data as a JSON file to keep on your device, or import a previously exported backup.</div>
              <div class="settings-card-actions">
                <button class="settings-btn-action" id="settingsExportBtn">⬇ Export to File</button>
                <button class="settings-btn-action" id="settingsImportBtn">⬆ Import from File</button>
              </div>
            </div>
          </div>

          <div class="settings-section">
            <div class="settings-section-title">AI Features</div>
            <div class="settings-card">
              <div class="settings-card-title">Anthropic API Key</div>
              <div class="settings-card-desc">Used for AI Roadmap generation. Get your key at console.anthropic.com. Stored locally on your device only.</div>
              <div style="display:flex;gap:8px;align-items:center;margin-top:8px;">
                <input type="password" id="aiApiKeyInput" value="${this.escapeHtml(this.aiApiKey)}"
                  placeholder="sk-ant-..."
                  style="flex:1;padding:8px 12px;background:var(--input-bg,#1a1a2e);border:1px solid rgba(0,212,255,0.3);color:var(--text-primary,#fff);border-radius:6px;font-size:13px;outline:none;">
                <button class="settings-btn-action" id="saveApiKeyBtn">Save</button>
              </div>
              <div id="apiKeyStatus" style="font-size:12px;color:#22c55e;margin-top:4px;min-height:16px;"></div>
            </div>
          </div>

          <div class="settings-section">
            <div class="settings-section-title">App Appearance</div>

            <div class="settings-card">
              <div class="settings-card-title">Theme</div>
              <div class="settings-card-desc">Choose between dark and light mode for the application.</div>
              <div class="theme-toggle">
                <button class="theme-option ${this.theme === 'dark' ? 'active' : ''}" id="themeDarkBtn">
                  <span class="theme-option-icon">🌙</span>
                  Dark
                </button>
                <button class="theme-option ${this.theme === 'light' ? 'active' : ''}" id="themeLightBtn">
                  <span class="theme-option-icon">☀</span>
                  Light
                </button>
              </div>
            </div>
          </div>

        </div>
      </div>
    `;
  }

  private getFileEmoji(mimeType: string): string {
    if (mimeType.startsWith('image/')) return '🖼️';
    if (mimeType.startsWith('video/')) return '🎬';
    if (mimeType === 'application/pdf' || mimeType === 'pdf') return '📄';
    if (mimeType.startsWith('audio/')) return '🎵';
    if (mimeType.includes('word') || mimeType.includes('document')) return '📝';
    if (mimeType.includes('sheet') || mimeType.includes('excel')) return '📊';
    if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return '📊';
    if (mimeType.startsWith('text/')) return '📃';
    return '📎';
  }

  // ─── AI Roadmap ──────────────────────────────────────────────────────────────

  private updateMultiSelectBar(): void {
    const bar = document.getElementById('roadmapSelBar');
    const countEl = document.getElementById('roadmapSelCount');
    const generateBtn = document.getElementById('generateRoadmapBtn') as HTMLButtonElement | null;
    if (!bar || !countEl) return;
    const count = this.selectedWorkspaceItems.size;
    if (count >= 2) {
      countEl.textContent = `${count} items selected`;
      bar.style.display = 'flex';
      if (generateBtn) {
        const hasKey = !!this.aiApiKey;
        generateBtn.disabled = !hasKey;
        generateBtn.title = hasKey ? 'Generate AI learning roadmap' : 'Add your Anthropic API key in Settings first';
        generateBtn.style.opacity = hasKey ? '1' : '0.4';
        generateBtn.style.cursor = hasKey ? 'pointer' : 'not-allowed';
      }
    } else {
      bar.style.display = 'none';
    }
  }

  private async generateRoadmap(): Promise<void> {
    const ws = this.currentModule?.workspace;
    if (!ws) return;
    const selectedItems = ws.items.filter(item => this.selectedWorkspaceItems.has(item.id));
    if (selectedItems.length < 2) return;
    if (!this.aiApiKey) {
      alert('Please add your Anthropic API key in Settings first.');
      return;
    }
    this.showRoadmapLoading();
    try {
      const result = await this.callAnthropicAPI(selectedItems);
      this.roadmapNodes = result.nodes;
      this.roadmapEdges = result.edges;
      this.roadmapTitle = result.title;
      this.roadmapExplanation = result.explanation;
      this.computeRoadmapLayout();
      this.showRoadmapOverlay();
    } catch (err) {
      this.hideRoadmapOverlay();
      alert(`Failed to generate roadmap: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }

  private async callAnthropicAPI(items: WorkspaceItem[]): Promise<{
    title: string;
    explanation: string;
    nodes: RoadmapNode[];
    edges: RoadmapEdge[];
  }> {
    const itemDescriptions = items.map((item) => {
      const label = item.name || item.content?.slice(0, 80) || `${item.type} item`;
      return `- ID: "${item.id}", Type: ${item.type}, Label: "${label}"`;
    }).join('\n');

    const prompt = `You are an expert learning path designer. Analyze these study materials and create a learning roadmap ordered from beginner to advanced.

Study materials:
${itemDescriptions}

Respond with ONLY valid JSON — no markdown fences, no extra text:
{
  "title": "Roadmap title",
  "explanation": "1-2 sentence description of the learning path",
  "nodes": [
    {
      "id": "n1",
      "itemId": "<exact ID from above>",
      "label": "<item label>",
      "level": 0,
      "reason": "<why this level, 1 sentence>"
    }
  ],
  "edges": [
    {"from": "n1", "to": "n2"}
  ]
}

Rules:
- level 0 = beginner/foundational, higher = more advanced
- Edges point FROM prerequisite TO dependent topic
- Every item must appear exactly once as a node
- itemId must exactly match an ID from the list above
- Create a tree or DAG (no cycles)`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': this.aiApiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-7',
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`API error ${response.status}: ${errText.slice(0, 200)}`);
    }

    const data = await response.json();
    const text: string = data.content?.[0]?.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in AI response');
    const parsed = JSON.parse(jsonMatch[0]);

    const nodes: RoadmapNode[] = (parsed.nodes || []).map((n: any) => ({
      id: n.id,
      itemId: n.itemId,
      label: n.label || 'Unnamed',
      level: typeof n.level === 'number' ? n.level : 0,
      reason: n.reason || '',
      x: 0,
      y: 0,
    }));

    return {
      title: parsed.title || 'Learning Roadmap',
      explanation: parsed.explanation || '',
      nodes,
      edges: (parsed.edges || []) as RoadmapEdge[],
    };
  }

  private computeRoadmapLayout(): void {
    const nodesByLevel = new Map<number, RoadmapNode[]>();
    for (const node of this.roadmapNodes) {
      if (!nodesByLevel.has(node.level)) nodesByLevel.set(node.level, []);
      nodesByLevel.get(node.level)!.push(node);
    }
    const nodeW = 210;
    const nodeH = 120;
    const hGap = 60;
    const vGap = 80;
    const sortedLevels = Array.from(nodesByLevel.keys()).sort((a, b) => a - b);
    sortedLevels.forEach((level, levelIdx) => {
      const nodesAtLevel = nodesByLevel.get(level)!;
      const totalW = nodesAtLevel.length * nodeW + (nodesAtLevel.length - 1) * hGap;
      const startX = Math.max(40, (900 - totalW) / 2);
      nodesAtLevel.forEach((node, i) => {
        node.x = startX + i * (nodeW + hGap);
        node.y = 50 + levelIdx * (nodeH + vGap);
      });
    });
  }

  private showRoadmapLoading(): void {
    this.hideRoadmapOverlay();
    const overlay = document.createElement('div');
    overlay.id = 'roadmapOverlay';
    overlay.className = 'roadmap-overlay';
    overlay.innerHTML = `
      <div class="roadmap-panel">
        <div class="roadmap-loading">
          <div class="roadmap-spinner"></div>
          <p>Analyzing your study materials…</p>
        </div>
      </div>`;
    document.body.appendChild(overlay);
  }

  private showRoadmapOverlay(): void {
    this.hideRoadmapOverlay();

    const maxX = this.roadmapNodes.length ? Math.max(...this.roadmapNodes.map(n => n.x)) + 270 : 900;
    const maxY = this.roadmapNodes.length ? Math.max(...this.roadmapNodes.map(n => n.y)) + 170 : 600;
    const canvasW = Math.max(maxX, 900);
    const canvasH = Math.max(maxY, 500);

    const levelColors: Record<number, { bg: string; border: string; badge: string }> = {
      0: { bg: '#052e16', border: '#22c55e', badge: '#22c55e' },
      1: { bg: '#172554', border: '#3b82f6', badge: '#3b82f6' },
      2: { bg: '#2e1065', border: '#a855f7', badge: '#a855f7' },
      3: { bg: '#431407', border: '#f97316', badge: '#f97316' },
    };
    const defaultColor = { bg: '#1a1a2e', border: '#00d4ff', badge: '#00d4ff' };
    const levelLabels: Record<number, string> = {
      0: 'Beginner', 1: 'Intermediate', 2: 'Advanced', 3: 'Expert',
    };

    const minLevel = this.roadmapNodes.length ? Math.min(...this.roadmapNodes.map(n => n.level)) : 0;
    const startNodeId = this.roadmapNodes.find(n => n.level === minLevel)?.id;

    const nodesHTML = this.roadmapNodes.map(node => {
      const colors = levelColors[node.level] ?? defaultColor;
      const levelLabel = levelLabels[node.level] ?? `Level ${node.level}`;
      const isStart = node.id === startNodeId;
      return `
        <div class="roadmap-node" id="rnode-${node.id}"
             style="left:${node.x}px;top:${node.y}px;border-color:${colors.border};background:${colors.bg};"
             data-nodeid="${node.id}">
          ${isStart ? `<div class="roadmap-node-start" style="background:${colors.badge};">START HERE</div>` : ''}
          <div class="roadmap-node-level" style="color:${colors.badge};border-color:${colors.badge};">${this.escapeHtml(levelLabel)}</div>
          <div class="roadmap-node-label">${this.escapeHtml(node.label)}</div>
          <div class="roadmap-node-reason">${this.escapeHtml(node.reason)}</div>
        </div>`;
    }).join('');

    const overlay = document.createElement('div');
    overlay.id = 'roadmapOverlay';
    overlay.className = 'roadmap-overlay';
    overlay.innerHTML = `
      <div class="roadmap-panel">
        <div class="roadmap-header">
          <div class="roadmap-title-area">
            <h2 class="roadmap-title">🗺 ${this.escapeHtml(this.roadmapTitle)}</h2>
            <p class="roadmap-explanation">${this.escapeHtml(this.roadmapExplanation)}</p>
          </div>
          <div class="roadmap-header-actions">
            <button class="roadmap-apply-btn" id="applyRoadmapBtn">Apply to Workspace</button>
            <button class="roadmap-close-btn" id="closeRoadmapBtn">✕ Close</button>
          </div>
        </div>
        <div class="roadmap-canvas-container">
          <div class="roadmap-canvas" id="roadmapCanvas" style="width:${canvasW}px;height:${canvasH}px;position:relative;">
            <svg class="roadmap-svg" id="roadmapSvg" width="${canvasW}" height="${canvasH}"
                 style="position:absolute;top:0;left:0;pointer-events:none;">
              <defs>
                <marker id="rm-arrow" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                  <polygon points="0 0, 10 3.5, 0 7" fill="rgba(0,212,255,0.8)" />
                </marker>
              </defs>
            </svg>
            ${nodesHTML}
          </div>
        </div>
      </div>`;

    document.body.appendChild(overlay);
    this.updateRoadmapArrows();

    document.getElementById('closeRoadmapBtn')?.addEventListener('click', () => this.hideRoadmapOverlay());
    document.getElementById('applyRoadmapBtn')?.addEventListener('click', () => this.applyRoadmapToWorkspace());

    this.roadmapNodes.forEach(node => {
      const nodeEl = document.getElementById(`rnode-${node.id}`);
      if (!nodeEl) return;
      nodeEl.addEventListener('pointerdown', (e: PointerEvent) => {
        e.preventDefault();
        nodeEl.setPointerCapture(e.pointerId);
        this.roadmapDragNodeId = node.id;
        this.roadmapDragStartX = e.clientX;
        this.roadmapDragStartY = e.clientY;
        this.roadmapNodeStartX = node.x;
        this.roadmapNodeStartY = node.y;
        nodeEl.classList.add('dragging');
      });
      nodeEl.addEventListener('pointermove', (e: PointerEvent) => {
        if (this.roadmapDragNodeId !== node.id) return;
        node.x = Math.max(0, this.roadmapNodeStartX + (e.clientX - this.roadmapDragStartX));
        node.y = Math.max(0, this.roadmapNodeStartY + (e.clientY - this.roadmapDragStartY));
        nodeEl.style.left = `${node.x}px`;
        nodeEl.style.top = `${node.y}px`;
        this.updateRoadmapArrows();
      });
      nodeEl.addEventListener('pointerup', () => {
        if (this.roadmapDragNodeId === node.id) {
          this.roadmapDragNodeId = null;
          nodeEl.classList.remove('dragging');
        }
      });
    });
  }

  private updateRoadmapArrows(): void {
    const svg = document.getElementById('roadmapSvg');
    if (!svg) return;
    svg.querySelectorAll('path').forEach(el => el.remove());
    const svgNS = 'http://www.w3.org/2000/svg';
    const nodeW = 210;
    const nodeH = 120;
    this.roadmapEdges.forEach(edge => {
      const fromNode = this.roadmapNodes.find(n => n.id === edge.from);
      const toNode = this.roadmapNodes.find(n => n.id === edge.to);
      if (!fromNode || !toNode) return;
      const x1 = fromNode.x + nodeW / 2;
      const y1 = fromNode.y + nodeH;
      const x2 = toNode.x + nodeW / 2;
      const y2 = toNode.y;
      const cy = (y2 - y1) * 0.45;
      const path = document.createElementNS(svgNS, 'path');
      path.setAttribute('d', `M ${x1} ${y1} C ${x1} ${y1 + cy}, ${x2} ${y2 - cy}, ${x2} ${y2}`);
      path.setAttribute('stroke', 'rgba(0,212,255,0.75)');
      path.setAttribute('stroke-width', '2');
      path.setAttribute('fill', 'none');
      path.setAttribute('marker-end', 'url(#rm-arrow)');
      svg.appendChild(path);
    });
  }

  private hideRoadmapOverlay(): void {
    document.getElementById('roadmapOverlay')?.remove();
  }

  private applyRoadmapToWorkspace(): void {
    const ws = this.currentModule?.workspace;
    if (!ws) return;
    if (!ws.connections) ws.connections = [];
    let added = 0;
    this.roadmapEdges.forEach(edge => {
      const fromNode = this.roadmapNodes.find(n => n.id === edge.from);
      const toNode = this.roadmapNodes.find(n => n.id === edge.to);
      if (!fromNode || !toNode) return;
      const exists = ws.connections!.some(
        c => (c.fromId === fromNode.itemId && c.toId === toNode.itemId) ||
             (c.fromId === toNode.itemId && c.toId === fromNode.itemId)
      );
      if (!exists) {
        ws.connections!.push({
          id: Math.random().toString(36).slice(2),
          fromId: fromNode.itemId,
          toId: toNode.itemId,
        });
        added++;
      }
    });
    if (added > 0) {
      this.saveModules();
      this.pushHistory();
      this.drawWorkspace();
    }
    this.hideRoadmapOverlay();
  }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new StudyTrackerApp();
});
