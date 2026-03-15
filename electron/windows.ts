import { BrowserWindow, ipcMain } from 'electron'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const nodeRequire = createRequire(import.meta.url)

const APP_ROOT = path.join(__dirname, '..')
const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
const RENDERER_DIST = path.join(APP_ROOT, 'dist')
const WINDOW_ICON_PATH = path.join(process.env.VITE_PUBLIC || RENDERER_DIST, 'app-icons', 'recordly-512.png')

let hudOverlayWindow: BrowserWindow | null = null;
let webcamWindow: BrowserWindow | null = null;

function getScreen() {
  return nodeRequire('electron').screen as typeof import('electron').screen
}

ipcMain.on('hud-overlay-hide', () => {
  if (hudOverlayWindow && !hudOverlayWindow.isDestroyed()) {
    hudOverlayWindow.minimize();
  }
});

export function createHudOverlayWindow(): BrowserWindow {
  const primaryDisplay = getScreen().getPrimaryDisplay();
  const { workArea } = primaryDisplay;


  const windowWidth = 600;
  const windowHeight = 155;

  const x = Math.floor(workArea.x + (workArea.width - windowWidth) / 2);
  const y = Math.floor(workArea.y + workArea.height - windowHeight - 5);

  const win = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    minWidth: 600,
    maxWidth: 600,
    minHeight: 155,
    maxHeight: 155,
    x: x,
    y: y,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  })


  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date).toLocaleString())
  })

  hudOverlayWindow = win;

  win.on('closed', () => {
    if (hudOverlayWindow === win) {
      hudOverlayWindow = null;
    }
  });


  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL + '?windowType=hud-overlay')
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'), { 
      query: { windowType: 'hud-overlay' } 
    })
  }

  return win
}

export function createEditorWindow(): BrowserWindow {
  const isMac = process.platform === 'darwin';

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    ...(process.platform !== 'darwin' && {
      icon: WINDOW_ICON_PATH,
    }),
    ...(isMac && {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 12, y: 12 },
    }),
    transparent: false,
    resizable: true,
    alwaysOnTop: false,
    skipTaskbar: false,
    title: 'Recordly',
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
      backgroundThrottling: false,
    },
  })

  // Maximize the window by default
  win.maximize();

  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date).toLocaleString())
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL + '?windowType=editor')
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'), { 
      query: { windowType: 'editor' } 
    })
  }

  return win
}

export function createSourceSelectorWindow(): BrowserWindow {
  const { width, height } = getScreen().getPrimaryDisplay().workAreaSize
  
  const win = new BrowserWindow({
    width: 620,
    height: 420,
    minHeight: 350,
    maxHeight: 500,
    x: Math.round((width - 620) / 2),
    y: Math.round((height - 420) / 2),
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    transparent: true,
    ...(process.platform !== 'darwin' && {
      icon: WINDOW_ICON_PATH,
    }),
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL + '?windowType=source-selector')
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'), { 
      query: { windowType: 'source-selector' } 
    })
  }

  return win
}

export function createWebcamWindow(): BrowserWindow {
  const { width, height } = getScreen().getPrimaryDisplay().workAreaSize
  
  const WEBCAM_SIZE = 200
  const win = new BrowserWindow({
    width: WEBCAM_SIZE,
    height: WEBCAM_SIZE,
    x: Math.round(width - WEBCAM_SIZE - 50),
    y: Math.round(height - WEBCAM_SIZE - 50),
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    transparent: true,
    hasShadow: false,
    skipTaskbar: true,
    ...(process.platform !== 'darwin' && {
      icon: WINDOW_ICON_PATH,
    }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  webcamWindow = win

  win.on('closed', () => {
    if (webcamWindow === win) {
      webcamWindow = null
    }
  })

  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.setAlwaysOnTop(true, 'floating', 1)

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL + '?windowType=webcam')
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'), { 
      query: { windowType: 'webcam' } 
    })
  }

  return win
}

export function getWebcamWindow(): BrowserWindow | null {
  return webcamWindow
}

export function closeWebcamWindow(): void {
  if (webcamWindow && !webcamWindow.isDestroyed()) {
    webcamWindow.close()
    webcamWindow = null
  }
}

