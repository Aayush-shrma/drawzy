const {
  app, BrowserWindow, globalShortcut, ipcMain, screen, Tray, Menu,
  nativeImage, desktopCapturer, clipboard, Notification, dialog, shell,
} = require('electron');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const IS_MAC = process.platform === 'darwin';
const IS_LINUX = process.platform === 'linux';
const IS_WIN = process.platform === 'win32';
const APP_ID = 'com.aayushsharma.drawzy';
const REPO_URL = 'https://github.com/Aayush-shrma/drawzy';
const ICON = path.join(__dirname, 'assets', 'icon.png');
// macOS menu bar icons are monochrome "template" images; Electron picks up the @2x file itself.
const TRAY_TEMPLATE = path.join(__dirname, 'assets', 'trayTemplate.png');
const DRAW_KEY = 'CommandOrControl+Shift+D';
const VISIBLE_KEY = 'CommandOrControl+Shift+H';
const MOD_LABEL = IS_MAC ? 'Cmd' : 'Ctrl';
const STARTUP_FLAG = '--startup';
// `drawzy --toggle` starts or stops drawing, `drawzy --toggle-visible` shows or hides drawings.
// Linux desktops on Wayland run these from system keyboard shortcuts.
const TOGGLE_FLAG = '--toggle';
const TOGGLE_VISIBLE_FLAG = '--toggle-visible';
// Wayland doesn't let an app float a click-through window above everything, so on Linux Drawzy runs as an
// X11 app (through XWayland on Wayland desktops). The flag has to be on the command line to take effect.
const X11_FLAG = '--ozone-platform=x11';
const SELF_TEST = process.argv.includes('--self-test');
const IS_WAYLAND = IS_LINUX && (process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY);

let win = null;
let tray = null;
let drawing = false;
let visible = true;

// A second copy hands over to the running one (see 'second-instance') and quits.
const isSecondCopy = !SELF_TEST && !app.requestSingleInstanceLock();
let relaunching = false;
if (isSecondCopy) {
  app.quit();
} else if (IS_WAYLAND && !process.argv.includes(X11_FLAG)) {
  // Started without the flag (e.g. a double-clicked AppImage): start again with it.
  relaunching = true;
  app.releaseSingleInstanceLock();
  app.relaunch({ ...(process.env.APPIMAGE && { execPath: process.env.APPIMAGE }), args: [...process.argv.slice(1), X11_FLAG] });
  app.exit(0);
} else if (IS_LINUX) {
  app.commandLine.appendSwitch('enable-transparent-visuals');
}

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
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    roundedCorners: false,
    enableLargerThanScreen: true,
    show: false,
    icon: ICON,
    backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  // On macOS and Linux, follow the user across desktops (and over full-screen apps on macOS).
  if (!IS_WIN) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
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
    // A menu bar app has to take focus explicitly to receive the drawing shortcuts.
    if (IS_MAC) app.focus({ steal: true });
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

// --- tray / menu bar ---

// The command that starts this copy of Drawzy, for keyboard shortcuts and login items on Linux.
function launchCommand(...args) {
  const exe = app.isPackaged ? [process.env.APPIMAGE || process.execPath] : [process.execPath, app.getAppPath()];
  return [...exe, X11_FLAG, ...args];
}

// Joins arguments the way .desktop files and GNOME shortcuts expect, quoting any with spaces.
function commandLine(args) {
  return args.map((a) => (/[\s"'\\$`]/.test(a) ? `"${a.replace(/(["`$\\])/g, '\\$1')}"` : a)).join(' ');
}

const AUTOSTART_FILE = path.join(app.getPath('appData'), 'autostart', 'drawzy.desktop');

function loginItemOptions() {
  if (IS_MAC) return {};
  // When run from source, Electron needs the app folder as an argument.
  return app.isPackaged
    ? { args: [STARTUP_FLAG] }
    : { path: process.execPath, args: [app.getAppPath(), STARTUP_FLAG] };
}

function openedAtLogin() {
  return IS_MAC ? app.getLoginItemSettings().wasOpenedAtLogin : process.argv.includes(STARTUP_FLAG);
}

function getOpenAtLogin() {
  if (IS_LINUX) return fs.existsSync(AUTOSTART_FILE);
  return app.getLoginItemSettings(loginItemOptions()).openAtLogin;
}

// Electron's login items don't cover Linux, so write the XDG autostart entry directly.
function setOpenAtLogin(on) {
  if (!IS_LINUX) app.setLoginItemSettings({ openAtLogin: on, ...loginItemOptions() });
  else if (!on) fs.rmSync(AUTOSTART_FILE, { force: true });
  else {
    fs.mkdirSync(path.dirname(AUTOSTART_FILE), { recursive: true });
    fs.writeFileSync(AUTOSTART_FILE, [
      '[Desktop Entry]',
      'Type=Application',
      'Name=Drawzy',
      `Exec=${commandLine(launchCommand(STARTUP_FLAG))}`,
      'Icon=drawzy',
      'X-GNOME-Autostart-enabled=true',
      '',
    ].join('\n'));
  }
  updateTray();
}

function trayIcon() {
  if (IS_MAC) return nativeImage.createFromPath(TRAY_TEMPLATE);
  const size = Math.round((IS_LINUX ? 22 : 16) * screen.getPrimaryDisplay().scaleFactor);
  return nativeImage.createFromPath(ICON).resize({ width: size, height: size, quality: 'best' });
}

function updateTray() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `Drawzy ${app.getVersion()}`, enabled: false },
    { type: 'separator' },
    { label: 'Draw on screen', type: 'checkbox', checked: drawing, accelerator: DRAW_KEY, click: () => setDrawing(!drawing) },
    { label: 'Show drawings', type: 'checkbox', checked: visible, accelerator: VISIBLE_KEY, click: () => setVisible(!visible) },
    { label: 'Clear drawings', click: () => win.webContents.send('command', 'clear') },
    { type: 'separator' },
    {
      label: IS_WIN ? 'Start with Windows' : 'Open at login', type: 'checkbox', checked: getOpenAtLogin(),
      click: (item) => setOpenAtLogin(item.checked),
    },
    { label: 'Help && updates', click: () => shell.openExternal(REPO_URL) },
    { label: 'Quit Drawzy', click: () => app.quit() },
  ]));
  tray.setToolTip(drawing ? 'Drawzy: drawing' : `Drawzy: ${MOD_LABEL}+Shift+D to draw`);
}

// --- IPC ---

ipcMain.on('exit-draw', () => setDrawing(false));
ipcMain.on('set-visible', (_, on) => setVisible(on));
ipcMain.on('quit', () => app.quit());
ipcMain.handle('get-open-at-login', () => getOpenAtLogin());
ipcMain.handle('set-open-at-login', (_, on) => setOpenAtLogin(on));

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

// On macOS this asks for Screen Recording permission the first time.
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

// --- Linux on Wayland: hand the global shortcuts to the desktop ---

// Remembers one-time Linux setup between launches.
const LINUX_STATE_FILE = path.join(app.getPath('userData'), 'linux-setup.json');

function linuxState() {
  try {
    return JSON.parse(fs.readFileSync(LINUX_STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveLinuxState(state) {
  fs.mkdirSync(path.dirname(LINUX_STATE_FILE), { recursive: true });
  fs.writeFileSync(LINUX_STATE_FILE, JSON.stringify(state));
}

const GNOME_KEYS = 'org.gnome.settings-daemon.plugins.media-keys';
const GNOME_KEY_DIR = '/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/';
const LINUX_SHORTCUTS = [
  { id: 'drawzy-draw', name: 'Drawzy: draw on screen', binding: '<Control><Shift>d', flag: TOGGLE_FLAG },
  { id: 'drawzy-visible', name: 'Drawzy: show or hide drawings', binding: '<Control><Shift>h', flag: TOGGLE_VISIBLE_FLAG },
];

const gsettings = (...args) => execFileSync('gsettings', args, { encoding: 'utf8', timeout: 5000 }).trim();
const gvariantString = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

// Adds Drawzy's shortcuts to GNOME's own custom shortcuts (Settings → Keyboard), the same place a user would.
// After the first time, only the command is refreshed (in case the AppImage moved), so edits and removals stick.
function setUpGnomeShortcuts(firstTime) {
  const list = gsettings('get', GNOME_KEYS, 'custom-keybindings');
  const paths = [...list.matchAll(/'([^']*)'/g)].map((m) => m[1]);
  for (const s of LINUX_SHORTCUTS) {
    const dir = `${GNOME_KEY_DIR}${s.id}/`;
    if (!firstTime && !paths.includes(dir)) continue;
    const schema = `${GNOME_KEYS}.custom-keybinding:${dir}`;
    gsettings('set', schema, 'command', gvariantString(commandLine(launchCommand(s.flag))));
    if (!firstTime) continue;
    gsettings('set', schema, 'name', gvariantString(s.name));
    gsettings('set', schema, 'binding', gvariantString(s.binding));
    if (!paths.includes(dir)) paths.push(dir);
  }
  if (firstTime) gsettings('set', GNOME_KEYS, 'custom-keybindings', `[${paths.map(gvariantString).join(', ')}]`);
}

// Returns true when the desktop now handles Ctrl+Shift+D and Ctrl+Shift+H.
function setUpWaylandShortcuts() {
  const state = linuxState();
  const desktop = (process.env.XDG_CURRENT_DESKTOP || '').toUpperCase();
  if (desktop.includes('GNOME')) {
    try {
      setUpGnomeShortcuts(!state.gnomeShortcuts);
      if (!state.gnomeShortcuts) saveLinuxState({ ...state, gnomeShortcuts: true });
      return true;
    } catch (err) {
      console.error('Could not add GNOME shortcuts:', err.message);
    }
  }
  if (!state.waylandHelpShown && Notification.isSupported()) {
    saveLinuxState({ ...state, waylandHelpShown: true });
    const n = new Notification({
      title: 'One step to use Ctrl+Shift+D',
      body: 'Your desktop blocks app shortcuts on Wayland. Click to copy the command for a custom keyboard shortcut and see how to add it.',
      icon: ICON,
    });
    n.on('click', () => {
      clipboard.writeText(commandLine(launchCommand(TOGGLE_FLAG)));
      shell.openExternal(`${REPO_URL}#linux-shortcut`);
    });
    n.show();
  }
  return false;
}

// --- self-test: launch the real overlay, check the drawing engine loaded, exit (used by CI) ---

function runSelfTest() {
  const fail = setTimeout(() => {
    console.error('SELFTEST timed out');
    app.exit(2);
  }, 30000);
  createWindow();
  win.webContents.once('did-finish-load', async () => {
    await new Promise((r) => setTimeout(r, 2000));
    const result = await win.webContents.executeJavaScript(`({
      rough: typeof rough,
      freehand: typeof getStroke === 'function',
      tools: document.querySelectorAll('[data-tool]').length,
      platform: window.overlay.platform,
    })`);
    const ok = result.rough === 'object' && result.freehand && result.tools > 5;
    console.log(`SELFTEST ${ok ? 'passed' : 'failed'} ${JSON.stringify(result)}`);
    clearTimeout(fail);
    app.exit(ok ? 0 : 1);
  });
}

// --- app lifecycle ---

app.setAppUserModelId(APP_ID);

app.whenReady().then(() => {
  if (relaunching || isSecondCopy) return;
  if (IS_MAC) {
    // No Dock icon: Drawzy lives in the menu bar. Keep a minimal Edit menu so copy/paste work while typing.
    app.dock?.hide();
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'editMenu' }]));
  } else {
    // Drop Electron's default menu so its shortcuts (reload, page zoom, close) don't fire.
    Menu.setApplicationMenu(null);
  }

  if (SELF_TEST) return runSelfTest();

  createWindow();
  // Started by a shortcut while Drawzy wasn't running yet: go straight to drawing.
  const drawNow = process.argv.includes(TOGGLE_FLAG);
  if (drawNow) win.once('ready-to-show', () => setDrawing(true));
  // Some Linux desktops (like Fedora's GNOME) hide tray icons; the in-app menu has the same options.
  tray = new Tray(trayIcon());
  // On Windows a click toggles drawing; on macOS a click opens the menu, as menu bar apps do.
  if (!IS_MAC) tray.on('click', () => setDrawing(!drawing));
  updateTray();

  // Drawzy has no window of its own, so say hello unless it started quietly at login or by the shortcut.
  const hello = !drawNow && !openedAtLogin();
  if (IS_WAYLAND && setUpWaylandShortcuts()) {
    if (hello) notify('Drawzy is running. Press Ctrl+Shift+D to draw on anything.');
    return;
  }
  const ok = globalShortcut.register(DRAW_KEY, () => setDrawing(!drawing))
    & globalShortcut.register(VISIBLE_KEY, () => setVisible(!visible));
  if (!ok) notify('A Drawzy shortcut is used by another app. Use the Drawzy menu to draw instead.');
  else if (hello) notify(`Drawzy is running. Press ${MOD_LABEL}+Shift+D to draw on anything.`);
});

// Opening Drawzy again (e.g. from the Start menu or Launchpad) jumps straight into drawing.
// The Linux keyboard shortcuts open it again with a flag that toggles instead.
app.on('second-instance', (_, argv) => {
  if (!win) return;
  if (argv.includes(TOGGLE_VISIBLE_FLAG)) setVisible(!visible);
  else if (argv.includes(TOGGLE_FLAG)) setDrawing(!drawing);
  else setDrawing(true);
});
app.on('activate', () => win && tray && setDrawing(true));
app.on('will-quit', () => globalShortcut.unregisterAll());
