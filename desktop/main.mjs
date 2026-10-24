import { app, BrowserWindow, dialog, Menu, protocol, session } from 'electron';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { APP_URL, assetResponse, isAppUrl } from './assets.mjs';

app.setName('Folio');
app.setAppUserModelId('com.folio.reader');

// Honor an explicit profile location for isolated testing and alternate shelves.
const profileDirectory = app.commandLine.getSwitchValue('user-data-dir');
if (profileDirectory) {
  mkdirSync(path.resolve(profileDirectory), { recursive: true });
  app.setPath('userData', path.resolve(profileDirectory));
}

protocol.registerSchemesAsPrivileged([{
  scheme: 'folio',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
}]);

let mainWindow;

async function createWindow() {
  mainWindow = new BrowserWindow({
    title: 'Folio',
    width: 1440,
    height: 960,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#eee7d8',
    icon: path.join(app.getAppPath(), 'dist', 'icon-512.png'),
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  const window = mainWindow;
  window.once('ready-to-show', () => window.show());
  window.on('closed', () => { mainWindow = null; });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) event.preventDefault();
  });
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  await window.loadURL(APP_URL);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.whenReady().then(async () => {
    const distDirectory = path.join(app.getAppPath(), 'dist');
    protocol.handle('folio', request => assetResponse(request, distDirectory));
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
      { role: 'fileMenu' },
      { role: 'editMenu' },
      { label: 'View', submenu: [{ role: 'reload' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    ]));
    await createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow().catch(showStartupError);
    });
  }).catch(showStartupError);
}

function showStartupError(error) {
  dialog.showErrorBox('Folio could not start', error.message);
  app.quit();
}
