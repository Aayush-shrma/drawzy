const {
  app, BrowserWindow, globalShortcut, ipcMain, screen, Tray, Menu,
  nativeImage, desktopCapturer, clipboard, Notification, dialog, shell,
} = require('electron');
const fs = require('fs');
const path = require('path');

const APP_ID = 'com.aayushsharma.drawzy';
const REPO_URL = 'https://github.com/Aayush-shrma/drawzy';
const ICON = path.join(__dirname, 'assets', 'icon.png');
const DRAW_KEY = 'CommandOrControl+Shift+D';
const VISIBLE_KEY = 'CommandOrControl+Shift+H';
const STARTUP_FLAG = '--startup';

let win = null;
let tray = null;
let drawing = false;
let visible = true;

if (!app.requestSingleInstanceLock()) app.quit();

function createWindow() {
  const { bounds } = screen.getPrimaryDisplay();
  win = new BrowserWindow({
    ...bounds,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    icon: ICON,
    backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true);
  win.loadFile(path.join(__dirname, 'index.html'));
  // Pinch / Ctrl+wheel zooms the drawing, not the page.
  win.webContents.on('did-finish-load', () => win.webContents.setVisualZoomLevelLimits(1, 1));
  win.once('ready-to-show', () => win.showInactive());

  screen.on('display-metrics-changed', () => win.setBounds(screen.getPrimaryDisplay().bounds));
}

function setDrawing(on) {
  drawing = on;
  if (on) setVisible(true);
  win.setIgnoreMouseEvents(!on);
  if (on) {
    win.setAlwaysOnTop(true, 'screen-saver');
    win.show();
    win.focus();
  } else {
    win.blur();
  }
  win.webContents.send('mode', on);
  updateTray();
}

function setVisible(on) {
  visible = on;
  win.webContents.send('visible', on);
  updateTray();
}

function notify(body) {
  if (Notification.isSupported()) new Notification({ title: 'Drawzy', body, icon: ICON }).show();
}

// --- tray ---

function loginItemOptions() {
  // When run from source, Electron needs the app folder as an argument.
  return app.isPackaged
    ? { args: [STARTUP_FLAG] }
    : { path: process.execPath, args: [app.getAppPath(), STARTUP_FLAG] };
}

function trayIcon() {
  const size = Math.round(16 * screen.getPrimaryDisplay().scaleFactor);
  return nativeImage.createFromPath(ICON).resize({ width: size, height: size, quality: 'best' });
}

function updateTray() {
  if (!tray) return;
  const startup = app.getLoginItemSettings(loginItemOptions()).openAtLogin;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `Drawzy ${app.getVersion()}`, enabled: false },
    { type: 'separator' },
    { label: 'Draw on screen', type: 'checkbox', checked: drawing, accelerator: DRAW_KEY, click: () => setDrawing(!drawing) },
    { label: 'Show drawings', type: 'checkbox', checked: visible, accelerator: VISIBLE_KEY, click: () => setVisible(!visible) },
    { label: 'Clear drawings', click: () => win.webContents.send('command', 'clear') },
    { type: 'separator' },
    {
      label: 'Start with Windows', type: 'checkbox', checked: startup,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked, ...loginItemOptions() }),
    },
    { label: 'Help && updates', click: () => shell.openExternal(REPO_URL) },
    { label: 'Quit Drawzy', click: () => app.quit() },
  ]));
  tray.setToolTip(drawing ? 'Drawzy: drawing' : 'Drawzy: Ctrl+Shift+D to draw');
}

// --- IPC ---

ipcMain.on('exit-draw', () => setDrawing(false));
ipcMain.on('set-visible', (_, on) => setVisible(on));

// The overlay sits above everything, so step down while a file dialog is open.
async function withDialog(fn) {
  win.setAlwaysOnTop(false);
  try {
    return await fn();
  } finally {
    win.setAlwaysOnTop(true, 'screen-saver');
    win.focus();
  }
}

const IMAGE_TYPES = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp',
};

ipcMain.handle('save-file', (_, { name, filters, data, base64 }) => withDialog(async () => {
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: path.join(app.getPath('documents'), name),
    filters,
  });
  if (canceled || !filePath) return null;
  fs.writeFileSync(filePath, base64 ? Buffer.from(data, 'base64') : data);
  return filePath;
}));

ipcMain.handle('open-file', (_, { filters, asDataURL }) => withDialog(async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, { filters, properties: ['openFile'] });
  if (canceled || !filePaths.length) return null;
  const file = filePaths[0];
  const buf = fs.readFileSync(file);
  if (!asDataURL) return { name: path.basename(file), data: buf.toString('utf8') };
  const mime = IMAGE_TYPES[path.extname(file).slice(1).toLowerCase()] || 'application/octet-stream';
  return { name: path.basename(file), data: `data:${mime};base64,${buf.toString('base64')}` };
}));

ipcMain.handle('copy-image', (_, dataURL) => clipboard.writeImage(nativeImage.createFromDataURL(dataURL)));

ipcMain.handle('read-clipboard', () => {
  const image = clipboard.readImage();
  return image.isEmpty() ? { text: clipboard.readText() } : { image: image.toDataURL() };
});

ipcMain.handle('write-clipboard-text', (_, text) => clipboard.writeText(text));

ipcMain.handle('screenshot', async () => {
  const display = screen.getPrimaryDisplay();
  const thumbnailSize = {
    width: Math.round(display.size.width * display.scaleFactor),
    height: Math.round(display.size.height * display.scaleFactor),
  };
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize });
  const source = sources.find((s) => s.display_id === String(display.id)) || sources[0];
  const image = source.thumbnail;
  clipboard.writeImage(image);
  const dir = path.join(app.getPath('pictures'), 'Drawzy');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(dir, `drawzy-${stamp}.png`);
  fs.writeFileSync(file, image.toPNG());
  return file;
});

// --- app lifecycle ---

app.setAppUserModelId(APP_ID);

app.whenReady().then(() => {
  // Drop Electron's default menu so its shortcuts (reload, page zoom, close) don't fire.
  Menu.setApplicationMenu(null);
  createWindow();
  tray = new Tray(trayIcon());
  tray.on('click', () => setDrawing(!drawing));
  updateTray();

  const ok = globalShortcut.register(DRAW_KEY, () => setDrawing(!drawing))
    & globalShortcut.register(VISIBLE_KEY, () => setVisible(!visible));
  if (!ok) notify('A Drawzy hotkey is used by another app. Click the tray icon to draw instead.');
  // Drawzy has no window of its own, so say hello unless Windows started it quietly.
  else if (!process.argv.includes(STARTUP_FLAG)) notify('Drawzy is running. Press Ctrl+Shift+D to draw on anything.');
});

// Opening Drawzy again (e.g. from the Start menu) jumps straight into drawing.
app.on('second-instance', () => win && setDrawing(true));
app.on('will-quit', () => globalShortcut.unregisterAll());
