import { app, BrowserWindow, ipcMain, screen } from 'electron';
import path from 'path';

let mainWindow: BrowserWindow | null;

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    backgroundColor: '#0f0f0f',
    webPreferences: {
      preload: path.join(__dirname, '../renderer/preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });

  const isDev = process.env.NODE_ENV === 'development';
  const htmlPath = isDev
    ? path.join(__dirname, '../renderer/index.html')
    : path.join(__dirname, '../renderer/index.html');

  mainWindow.loadFile(htmlPath);

  // Show window only once the renderer has fully painted — eliminates the white flash
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Ping the renderer when the window is restored from minimised so it can
  // immediately flush wall-clock state rather than waiting for the next tick.
  mainWindow.on('restore', () => {
    mainWindow?.webContents.send('window-restored');
  });
};

app.on('ready', createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

let activeOverlayWin: BrowserWindow | null = null;

ipcMain.on('show-timer-overlay', (_event, type: 'work' | 'break') => {
  // Close any existing overlay before creating a new one to prevent stacking
  if (activeOverlayWin && !activeOverlayWin.isDestroyed()) {
    activeOverlayWin.close();
    activeOverlayWin = null;
  }

  const display = screen.getPrimaryDisplay();
  const { x, y, width, height } = display.bounds;

  const overlayWin = new BrowserWindow({
    x,
    y,
    width,
    height,
    show: false,           // Hidden until content is ready — prevents white flash
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    resizable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  activeOverlayWin = overlayWin;
  overlayWin.setIgnoreMouseEvents(true, { forward: true });
  overlayWin.loadFile(path.join(__dirname, '../renderer/overlay.html'), { query: { type } });

  // Only show once the page is fully painted to avoid white flash
  overlayWin.once('ready-to-show', () => {
    if (!overlayWin.isDestroyed()) overlayWin.show();
  });

  // Close after animation finishes (cardIn 0.65s + hold 3.5s + cardOut 0.55s + buffer)
  setTimeout(() => {
    if (!overlayWin.isDestroyed()) overlayWin.close();
    if (activeOverlayWin === overlayWin) activeOverlayWin = null;
  }, 5000);

  overlayWin.on('closed', () => {
    if (activeOverlayWin === overlayWin) activeOverlayWin = null;
  });
});
