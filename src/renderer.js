/* global rough, overlay */

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const rc = rough.canvas(canvas);
const gen = rc.generator;
const textEditor = document.getElementById('text-editor');
const $ = (id) => document.getElementById(id);

const FONT = '"Segoe Print", "Bradley Hand", "Chalkboard SE", "Comic Sans MS", cursive';
const IS_MAC = window.overlay?.platform === 'darwin';
// The Chrome extension runs this same engine inside a page; it has no app to quit or start at login.
const IN_BROWSER = window.overlay?.host === 'browser';
// Shortcut labels are written Windows-style and translated for macOS.
const keyLabel = (s) => (IS_MAC ? s.replace(/Ctrl/g, 'Cmd').replace(/Alt/g, 'Option') : s);
const LINE_HEIGHT = 1.5;
const SELECTION_PAD = 6;
const HANDLE_SIZE = 9;
const NOTE_PAD = 14;
const NOTE_COLOR = '#ffec99';
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 30;
const CANVAS_BACKGROUNDS = {
  light: ['#ffffff', '#f8f9fa', '#f5faff', '#fffce8', '#fdf8f6'],
  dark: ['#121212', '#161718', '#13171c', '#181605', '#1b1615'],
};

// perfect-freehand (what Excalidraw uses for its pen) ships as an ES module.
let getStroke = null;
import('../node_modules/perfect-freehand/dist/esm/index.mjs').then((m) => {
  getStroke = m.getStroke;
  elements.forEach(touch);
  render();
});

// ---------------------------------------------------------------- settings & storage

const SETTINGS_KEY = 'drawzy.settings';
// The extension keeps a separate drawing for each page.
const DRAWING_KEY = window.overlay?.drawingKey || 'drawzy.drawing';

function load(key) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? undefined;
  } catch {
    return undefined;
  }
}

function store(key, value) {
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

const settings = {
  theme: 'system', // 'light' | 'dark' | 'system'
  onExit: 'keep', // 'keep' drawings on screen, or 'hide' them until drawing again
  remember: true, // keep drawings after quitting the app
  toolLock: true, // stay on the current tool after drawing (off = back to select, like Excalidraw)
  ...load(SETTINGS_KEY),
};

const saveSettings = () => store(SETTINGS_KEY, settings);

const state = {
  drawMode: false,
  tool: 'pen',
  board: null, // canvas background colour, null = see-through
  lastBoard: null,
  capturing: false,
  spaceDown: false,
  prefsOpen: false,
  style: {
    stroke: '#e03131',
    bg: 'transparent',
    fillStyle: 'hachure',
    strokeWidth: 4,
    strokeStyle: 'solid',
    roughness: 1,
    opacity: 100,
    fontSize: 28,
  },
};

// screen = scene * zoom + (x, y)
const view = { x: 0, y: 0, zoom: 1 };
const toScene = (sx, sy) => [(sx - view.x) / view.zoom, (sy - view.y) / view.zoom];
const toScreen = (x, y) => [x * view.zoom + view.x, y * view.zoom + view.y];
const px = (n) => n / view.zoom; // screen pixels -> scene units

let elements = [];
let selected = new Set();
let action = null; // what the current pointer drag is doing
let editing = null; // text or note element being typed into
let laser = [];
let history = [];
let historyIndex = -1;
let lastPointer = null; // scene coords, for pasting

// ---------------------------------------------------------------- icons

const ICONS = {
  hand: '<path d="M8 13V5.5a1.5 1.5 0 013 0V12M11 11V4.5a1.5 1.5 0 013 0V12M14 11.5V6a1.5 1.5 0 013 0v8c0 4-2.5 7-6.5 7-3 0-4.5-1.5-6-4l-2-3.5a1.5 1.5 0 012.5-1.6L8 14"/>',
  select: '<path d="M6 3l13 8-6 1.5L10 19z"/>',
  rect: '<rect x="4" y="4" width="16" height="16" rx="2.5"/>',
  diamond: '<path d="M12 3l9 9-9 9-9-9z"/>',
  ellipse: '<circle cx="12" cy="12" r="8.5"/>',
  arrow: '<path d="M5 19L19 5M10 5h9v9"/>',
  line: '<path d="M5 19L19 5"/>',
  pen: '<path d="M4 20l4.5-1L19 8.5 15.5 5 5 15.5zM13.5 7l3.5 3.5"/>',
  text: '<path d="M5 7V5h14v2M12 5v14M9 19h6"/>',
  note: '<path d="M5 4h14v10l-6 6H5z"/><path d="M13 20v-6h6M8 9h8M8 12.5h4"/>',
  eraser: '<path d="M9 20h11M4.5 14.5l9-9 6 6-8.5 8.5H9z"/><path d="M8.5 10.5l6 6"/>',
  laser: '<circle cx="12" cy="12" r="2.5"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2 2M16.4 16.4l2 2M5.6 18.4l2-2M16.4 7.6l2-2"/>',
  image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16l-5-5-8 8"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>',
  unlock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 017.5-2"/>',
  more: '<g fill="currentColor" stroke="none"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></g>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 010 11H11"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 000 11H13"/>',
  board: '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 21l4-5 4 5"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  moon: '<path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  folder: '<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  exportImage: '<rect x="3" y="4" width="18" height="15" rx="2"/><path d="M3 15l5-5 4 4M14 12l2-2 5 5"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3"/>',
  bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 015 0c0 1.7-2.5 2-2.5 4M12 17h.01"/>',
  sliders: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  up: '<path d="M6 15l6-6 6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  minus: '<path d="M5 12h14"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  toBack: '<path d="M12 4v11M8 11l4 4 4-4M5 20h14"/>',
  backward: '<path d="M12 5v13M8 14l4 4 4-4"/>',
  forward: '<path d="M12 19V6M8 10l4-4 4 4"/>',
  toFront: '<path d="M12 20V9M8 13l4-4 4 4M5 4h14"/>',
  exit: '<path d="M15 4h4v16h-4M10 16l4-4-4-4M14 12H4"/>',
  power: '<path d="M12 3v8M7 6.3a7.5 7.5 0 1 0 10 0"/>',
};

const svg = (inner) => `<svg viewBox="0 0 24 24">${inner}</svg>`;

// ---------------------------------------------------------------- tools

const TOOLS = [
  { id: 'hand', name: 'Hand (pan)', letter: 'h', hint: 'Drag to move around · scroll to pan · Ctrl+scroll to zoom' },
  { id: 'select', name: 'Select', key: '1', letter: 'v', hint: 'Click to select · drag handles to resize · Shift+click to add · double-click text to edit' },
  { id: 'rect', name: 'Rectangle', key: '2', letter: 'r', hint: "Click and drag, release when you're finished · Shift for a square" },
  { id: 'diamond', name: 'Diamond', key: '3', letter: 'd', hint: "Click and drag, release when you're finished · Shift for even sides" },
  { id: 'ellipse', name: 'Ellipse', key: '4', letter: 'o', hint: "Click and drag, release when you're finished · Shift for a circle" },
  { id: 'arrow', name: 'Arrow', key: '5', letter: 'a', hint: 'Click and drag · Shift snaps to 15° steps' },
  { id: 'line', name: 'Line', key: '6', letter: 'l', hint: 'Click and drag · Shift snaps to 15° steps' },
  { id: 'pen', name: 'Draw', key: '7', letter: 'p', hint: "Click and drag, release when you're finished" },
  { id: 'text', name: 'Text', key: '8', letter: 't', hint: 'Click anywhere to type · Esc or Ctrl+Enter when done' },
  { id: 'note', name: 'Sticky note', letter: 'n', hint: 'Click to drop a sticky note, or drag to size it' },
  { id: 'eraser', name: 'Eraser', key: '0', letter: 'e', hint: 'Drag over anything to erase it' },
  { id: 'laser', name: 'Laser pointer', letter: 'k', hint: 'Click and drag to point at things — the trail fades away', more: true },
];

const toolById = (id) => TOOLS.find((t) => t.id === id);

const MORE_ITEMS = [
  { id: 'laser', icon: 'laser', label: 'Laser pointer', kbd: 'K', run: () => setTool('laser') },
  { id: 'image', icon: 'image', label: 'Insert image', kbd: 'I', run: () => insertImage() },
  { id: 'board', icon: 'board', label: 'Toggle canvas background', kbd: 'B', run: () => toggleBoard() },
  { id: 'camera', icon: 'camera', label: 'Screenshot with screen', kbd: 'Ctrl+Shift+S', run: () => screenshot() },
];

function buildToolbar() {
  const bar = $('toolbar');
  const toolBtn = (t) => `<button class="btn" data-tool="${t.id}" title="${t.name} — ${t.letter.toUpperCase()}${t.key ? ` or ${t.key}` : ''}">${svg(ICONS[t.id])}<span class="key">${t.letter.toUpperCase()}</span></button>`;
  bar.innerHTML =
    `<button class="btn" id="lock-btn" title="Keep selected tool active after drawing — Q"></button>` +
    '<div class="sep"></div>' +
    TOOLS.filter((t) => !t.more).map(toolBtn).join('') +
    '<div class="sep"></div>' +
    `<button class="btn" id="more-btn" title="More tools">${svg(ICONS.more)}</button>` +
    `<button class="btn" id="exit-btn" title="Stop drawing — Esc">${svg(ICONS.close)}</button>`;

  bar.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.tool) setTool(btn.dataset.tool);
    else if (btn.id === 'lock-btn') toggleToolLock();
    else if (btn.id === 'more-btn') toggleDropdown('more-menu');
    else if (btn.id === 'exit-btn') overlay.exitDraw();
  });

  $('more-menu').innerHTML = MORE_ITEMS.map((m) => `<button class="menu-item" data-more="${m.id}"><span class="menu-icon">${svg(ICONS[m.icon])}</span><span class="grow">${m.label}</span><kbd>${keyLabel(m.kbd)}</kbd></button>`).join('');
  $('more-menu').addEventListener('click', (e) => {
    const item = e.target.closest('[data-more]');
    if (!item) return;
    closeDropdowns();
    MORE_ITEMS.find((m) => m.id === item.dataset.more).run();
  });
  refreshLock();
}

function refreshLock() {
  const btn = $('lock-btn');
  btn.innerHTML = svg(settings.toolLock ? ICONS.lock : ICONS.unlock);
  btn.classList.toggle('active', settings.toolLock);
}

function toggleToolLock() {
  settings.toolLock = !settings.toolLock;
  saveSettings();
  refreshLock();
  renderMenu();
  toast(settings.toolLock ? 'Tool lock on — tools stay selected after drawing' : 'Tool lock off — back to Select after each shape');
}

function toolCursor() {
  if (state.spaceDown || state.tool === 'hand') return action?.kind === 'pan' ? 'grabbing' : 'grab';
  if (state.tool === 'select') return 'default';
  if (state.tool === 'text') return 'text';
  return 'crosshair';
}

function setTool(tool) {
  commitText();
  state.tool = tool;
  if (tool !== 'select') selected.clear();
  document.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === tool));
  $('more-btn').classList.toggle('active', !!toolById(tool)?.more);
  $('tool-hint').textContent = keyLabel(toolById(tool)?.hint || '');
  canvas.style.cursor = toolCursor();
  refreshPanel();
  render();
}

// Without tool lock, finishing a shape drops back to Select with it selected (Excalidraw's default).
function selectAfterCreate(el) {
  setTool('select');
  selected = new Set([el.id]);
  refreshPanel();
  render();
}

// ---------------------------------------------------------------- dropdowns & main menu

function toggleDropdown(id, open) {
  const menu = $(id);
  const show = open ?? menu.classList.contains('hidden');
  closeDropdowns();
  if (!show) return;
  menu.classList.remove('hidden');
  if (id === 'more-menu') {
    const r = $('more-btn').getBoundingClientRect();
    menu.style.left = `${Math.min(r.left, innerWidth - 314)}px`;
    $('more-btn').classList.add('active');
  } else {
    $('menu-btn').classList.add('active');
    renderMenu();
  }
}

function closeDropdowns() {
  $('menu').classList.add('hidden');
  $('more-menu').classList.add('hidden');
  $('menu-btn').classList.remove('active');
  $('more-btn').classList.toggle('active', !!toolById(state.tool)?.more);
}

const MENU_ITEMS = [
  { id: 'open', icon: 'folder', label: 'Open', kbd: 'Ctrl+O', run: () => openScene() },
  { id: 'save', icon: 'download', label: 'Save to…', kbd: 'Ctrl+S', run: () => saveScene() },
  { id: 'export', icon: 'exportImage', label: 'Export image…', kbd: 'Ctrl+Shift+E', run: () => exportImage() },
  { id: 'copy-png', icon: 'copy', label: 'Copy as PNG', kbd: 'Shift+Alt+C', run: () => copyAsPng() },
  { id: 'screenshot', icon: 'camera', label: 'Screenshot with screen', kbd: 'Ctrl+Shift+S', run: () => screenshot() },
  { id: 'palette', icon: 'bolt', label: 'Command palette', kbd: 'Ctrl+/', accent: true, run: () => openPalette() },
  { id: 'find', icon: 'search', label: 'Find on canvas', kbd: 'Ctrl+F', run: () => openFind() },
  { id: 'help', icon: 'help', label: 'Help', kbd: '?', run: () => openHelp() },
  { id: 'reset', icon: 'trash', label: 'Reset the canvas', run: () => clearAll() },
  { id: 'quit', icon: 'power', label: 'Quit Drawzy', desktop: true, run: () => overlay.quit() },
].filter((m) => !(IN_BROWSER && m.desktop));

const PREF_ITEMS = [
  { id: 'lock', check: () => settings.toolLock, label: 'Tool lock', kbd: 'Q', run: () => toggleToolLock() },
  { heading: 'When I stop drawing' },
  { id: 'exit-keep', check: () => settings.onExit === 'keep', label: 'Keep drawings on screen', run: () => setOnExit('keep') },
  { id: 'exit-hide', check: () => settings.onExit === 'hide', label: 'Hide until I draw again', run: () => setOnExit('hide') },
  { sep: true },
  { id: 'remember', check: () => settings.remember, label: 'Remember after quitting', run: () => toggleRemember() },
  { id: 'login', check: () => state.openAtLogin, label: 'Open at login', desktop: true, run: () => toggleOpenAtLogin() },
].filter((m) => !(IN_BROWSER && m.desktop));

function menuItem(m, extraClass = '') {
  const icon = m.check
    ? `<span class="menu-icon check${m.check() ? '' : ' off'}">${svg(ICONS.check)}</span>`
    : `<span class="menu-icon">${svg(ICONS[m.icon])}</span>`;
  return `<button class="menu-item${m.accent ? ' accent' : ''}${extraClass}" data-menu="${m.id}">${icon}<span class="grow">${m.label}</span>${m.kbd ? `<kbd>${keyLabel(m.kbd)}</kbd>` : ''}</button>`;
}

function renderMenu() {
  $('hint').textContent = keyLabel(settings.onExit === 'keep'
    ? 'Esc or Ctrl+Shift+D to stop drawing · drawings stay on screen · Ctrl+Shift+H hides them'
    : 'Esc or Ctrl+Shift+D to stop drawing · drawings hide and come back next time · Ctrl+Shift+H shows them');

  const theme = resolvedTheme();
  const prefs = state.prefsOpen
    ? PREF_ITEMS.map((m) => (m.sep ? '<div class="menu-sep"></div>' : m.heading ? `<div class="menu-heading">${m.heading}</div>` : menuItem(m, ' sub'))).join('')
    : '';
  const bgs = [null, ...CANVAS_BACKGROUNDS[theme]];

  $('menu').innerHTML =
    MENU_ITEMS.map((m) => menuItem(m)).join('') +
    '<div class="menu-sep"></div>' +
    `<button class="menu-item" data-menu="prefs"><span class="menu-icon">${svg(ICONS.sliders)}</span><span class="grow">Preferences</span><span class="menu-icon menu-chevron${state.prefsOpen ? ' open' : ''}">${svg(ICONS.chevron)}</span></button>` +
    prefs +
    `<div class="menu-row"><span>Theme</span><div class="segmented">${['light', 'dark', 'system'].map((t) =>
      `<button data-theme-choice="${t}" class="${settings.theme === t ? 'active' : ''}" title="${t[0].toUpperCase() + t.slice(1)}">${svg(ICONS[{ light: 'sun', dark: 'moon', system: 'monitor' }[t]])}</button>`).join('')}</div></div>` +
    '<div class="menu-label">Canvas background</div>' +
    `<div class="bg-swatches">${bgs.map((c) =>
      `<button class="swatch${c ? '' : ' none'}${state.board === c ? ' active' : ''}" data-board="${c ?? ''}" title="${c ?? 'See-through (show the screen)'}" style="${c ? `background:${c}` : ''}"></button>`).join('')}</div>`;
}

function buildMenu() {
  $('menu-btn').innerHTML = svg(ICONS.menu);
  $('menu-btn').addEventListener('click', () => toggleDropdown('menu'));
  $('menu').addEventListener('click', (e) => {
    const theme = e.target.closest('[data-theme-choice]');
    if (theme) return setTheme(theme.dataset.themeChoice);
    const board = e.target.closest('[data-board]');
    if (board) {
      setBoard(board.dataset.board || null);
      return renderMenu();
    }
    const item = e.target.closest('[data-menu]');
    if (!item) return;
    const id = item.dataset.menu;
    if (id === 'prefs') {
      state.prefsOpen = !state.prefsOpen;
      return renderMenu();
    }
    const pref = PREF_ITEMS.find((m) => m.id === id);
    if (pref) {
      pref.run();
      return renderMenu();
    }
    closeDropdowns();
    MENU_ITEMS.find((m) => m.id === id).run();
  });
  renderMenu();
}

// Login items live in the main process; the menu keeps a copy so it can draw the checkmark.
function toggleOpenAtLogin() {
  state.openAtLogin = !state.openAtLogin;
  overlay.setOpenAtLogin(state.openAtLogin);
}

function setOnExit(mode) {
  settings.onExit = mode;
  saveSettings();
  renderMenu();
}

function toggleRemember() {
  settings.remember = !settings.remember;
  saveSettings();
  saveDrawing();
  renderMenu();
}

// ---------------------------------------------------------------- theme & canvas background

const darkQuery = matchMedia('(prefers-color-scheme: dark)');
const resolvedTheme = () => (settings.theme === 'system' ? (darkQuery.matches ? 'dark' : 'light') : settings.theme);

function applyTheme() {
  document.documentElement.dataset.theme = resolvedTheme();
  renderMenu();
  render();
}

function setTheme(theme) {
  settings.theme = theme;
  saveSettings();
  applyTheme();
}

darkQuery.addEventListener('change', applyTheme);

function setBoard(color) {
  state.board = color;
  if (color) state.lastBoard = color;
  render();
}

function toggleBoard() {
  setBoard(state.board ? null : state.lastBoard || CANVAS_BACKGROUNDS[resolvedTheme()][0]);
  renderMenu();
}

// ---------------------------------------------------------------- style panel

const OPTION_ICONS = {
  strokeWidth: (w) => svg(`<path d="M4 12h16" stroke-width="${w * 0.7}"/>`),
  strokeStyle: (s) => svg(`<path d="M3 12h18" stroke-width="2" ${s === 'dashed' ? 'stroke-dasharray="5 4"' : s === 'dotted' ? 'stroke-dasharray="0.5 4"' : ''}/>`),
  roughness: (r) => svg(['<path d="M3 16C8 6 16 6 21 8" stroke-width="2"/>',
    '<path d="M3 16c3-5 5-7 8-8s7-1 10 0" stroke-width="2"/><path d="M4 15c4-6 9-9 17-6" stroke-width="1.2"/>',
    '<path d="M3 17c2-3 3-6 6-8 2-1 3 2 5 0s4-3 7-1" stroke-width="2"/><path d="M4 14c3-4 4-7 8-6s5-1 9 1" stroke-width="1.2"/>'][r]),
  fillStyle: (f) => svg(f === 'solid' ? '<rect x="4" y="4" width="16" height="16" rx="2" fill="currentColor" stroke-width="1.5"/>'
    : `<rect x="4" y="4" width="16" height="16" rx="2" stroke-width="1.5"/><path d="M4 12l8-8M4 18l14-14M9 20l11-11M15 20l5-5" stroke-width="1.3"/>${f === 'cross-hatch' ? '<path d="M12 4l8 8M6 4l14 14M4 9l11 11M4 15l5 5" stroke-width="1.3"/>' : ''}`),
};

const PANEL = [
  { key: 'stroke', label: 'Stroke', colors: ['#1e1e1e', '#ffffff', '#e03131', '#2f9e44', '#1971c2', '#f08c00'] },
  { key: 'bg', label: 'Background', colors: ['transparent', '#ffc9c9', '#b2f2bb', '#a5d8ff', '#ffec99'] },
  { key: 'fillStyle', label: 'Fill', options: [['hachure', 'Hachure'], ['cross-hatch', 'Cross-hatch'], ['solid', 'Solid']] },
  { key: 'strokeWidth', label: 'Stroke width', options: [[2, 'Thin'], [4, 'Bold'], [7, 'Extra bold']] },
  { key: 'strokeStyle', label: 'Stroke style', options: [['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted']] },
  { key: 'roughness', label: 'Sloppiness', options: [[0, 'Architect'], [1, 'Artist'], [2, 'Cartoonist']] },
  { key: 'fontSize', label: 'Font size', options: [[20, 'S'], [28, 'M'], [40, 'L'], [60, 'XL']] },
  { key: 'opacity', label: 'Opacity', range: true },
  { key: 'layers', label: 'Layers', actions: [['toBack', 'Send to back — Ctrl+Shift+['], ['backward', 'Send backward — Ctrl+['], ['forward', 'Bring forward — Ctrl+]'], ['toFront', 'Bring to front — Ctrl+Shift+]']] },
  { key: 'actions', label: 'Actions', actions: [['copy', 'Duplicate — Ctrl+D'], ['trash', 'Delete — Del']] },
];

const PANEL_ACTIONS = {
  toBack: () => reorder('back'),
  backward: () => reorder('backward'),
  forward: () => reorder('forward'),
  toFront: () => reorder('front'),
  copy: () => duplicateSelected(),
  trash: () => deleteSelected(),
};

function buildPanel() {
  const panel = $('panel');
  panel.innerHTML = PANEL.map((row) => {
    let body;
    if (row.colors) {
      body = row.colors.map((c) => `<button class="swatch${c === 'transparent' ? ' none' : ''}" data-key="${row.key}" data-value="${c}" title="${c}" style="${c === 'transparent' ? '' : `background:${c}`}"></button>`).join('') +
        `<label class="swatch custom" title="Custom color"><input type="color" data-key="${row.key}"></label>`;
    } else if (row.range) {
      body = '<input id="opacity" type="range" min="10" max="100" step="10">';
    } else if (row.actions) {
      body = row.actions.map(([icon, title]) => `<button class="opt" data-panel-action="${icon}" title="${title}">${svg(ICONS[icon])}</button>`).join('');
    } else {
      body = row.options.map(([v, name]) => `<button class="opt" data-key="${row.key}" data-value="${v}" title="${name}">${OPTION_ICONS[row.key] ? OPTION_ICONS[row.key](v) : name}</button>`).join('');
    }
    return `<div class="row" data-row="${row.key}"><div class="label">${row.label}</div><div class="opts">${body}</div></div>`;
  }).join('');

  panel.addEventListener('click', (e) => {
    const act = e.target.closest('[data-panel-action]');
    if (act) return PANEL_ACTIONS[act.dataset.panelAction]();
    const btn = e.target.closest('button[data-key]');
    if (!btn) return;
    const raw = btn.dataset.value;
    setStyle(btn.dataset.key, isNaN(raw) ? raw : Number(raw));
  });
  panel.addEventListener('input', (e) => {
    if (e.target.type === 'color') setStyle(e.target.dataset.key, e.target.value, false);
    if (e.target.id === 'opacity') setStyle('opacity', Number(e.target.value), false);
  });
  // Live inputs only record one undo step once the user lets go.
  panel.addEventListener('change', () => commit());
}

function setStyle(key, value, record = true) {
  state.style[key] = value;
  for (const el of selectedElements()) {
    if (key === 'fontSize' && el.type !== 'text' && el.type !== 'note') continue;
    el[key] = value;
    touch(el);
  }
  if (editing) {
    editing[key] = value;
    styleTextEditor();
  }
  if (record) commit();
  refreshPanel();
  render();
}

const SHAPES = ['rect', 'ellipse', 'diamond'];

function refreshPanel() {
  const panel = $('panel');
  const sel = selectedElements();
  const quietTools = ['select', 'hand', 'eraser', 'laser'];
  panel.classList.toggle('hidden', !sel.length && quietTools.includes(state.tool));

  // Show the selected element's style when there is one, like Excalidraw.
  const src = sel[0] || state.style;
  const types = sel.length ? sel.map((e) => e.type) : [state.tool];
  const has = (...ts) => types.some((t) => ts.includes(t));
  const visibleRows = {
    stroke: !types.every((t) => t === 'image'),
    bg: has(...SHAPES, 'note'),
    fillStyle: has(...SHAPES) && src.bg !== 'transparent',
    strokeWidth: has(...SHAPES, 'line', 'arrow', 'pen'),
    strokeStyle: has(...SHAPES, 'line', 'arrow'),
    roughness: has(...SHAPES, 'line', 'arrow'),
    fontSize: has('text', 'note'),
    layers: sel.length > 0,
    actions: sel.length > 0,
  };
  panel.querySelectorAll('.row').forEach((row) => {
    row.classList.toggle('hidden', visibleRows[row.dataset.row] === false);
  });
  panel.querySelectorAll('[data-value]').forEach((b) => {
    b.classList.toggle('active', String(src[b.dataset.key] ?? state.style[b.dataset.key]) === b.dataset.value);
  });
  panel.querySelector('#opacity').value = src.opacity ?? 100;
}

// ---------------------------------------------------------------- elements

let idCounter = 0;
const newId = () => `${Date.now().toString(36)}-${(idCounter++).toString(36)}`;

function newElement(type, props) {
  const { stroke, bg, fillStyle, strokeWidth, strokeStyle, roughness, opacity, fontSize } = state.style;
  const el = {
    id: newId(), type, seed: Math.floor(Math.random() * 2 ** 31),
    stroke, bg, fillStyle, strokeWidth, strokeStyle, roughness, opacity, ...props,
  };
  if (type === 'text') el.fontSize = fontSize;
  return el;
}

// Rough.js shapes and pen outlines are cached on the element; drop the cache after any change.
const touch = (el) => { delete el._drawables; };

const selectedElements = () => elements.filter((el) => selected.has(el.id));

const clone = (el) => JSON.parse(JSON.stringify(el, (k, v) => (k === '_drawables' ? undefined : v)));

const isLinear = (el) => el.type === 'line' || el.type === 'arrow';
const linePoints = (el) => [[el.x1, el.y1], ...(el.mid || []), [el.x2, el.y2]];

function pointsBox(points) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

function box(el) {
  if (el.type === 'pen') return pointsBox(el.points);
  if (isLinear(el)) return pointsBox(linePoints(el));
  if (el.type === 'text') {
    ctx.font = `${el.fontSize}px ${FONT}`;
    const lines = el.text.split('\n');
    const w = Math.max(...lines.map((l) => ctx.measureText(l).width));
    return { x: el.x, y: el.y, w, h: lines.length * el.fontSize * LINE_HEIGHT };
  }
  const x = Math.min(el.x1, el.x2), y = Math.min(el.y1, el.y2);
  return { x, y, w: Math.abs(el.x2 - el.x1), h: Math.abs(el.y2 - el.y1) };
}

function unionBox(els) {
  if (!els.length) return null;
  const boxes = els.map(box);
  const x = Math.min(...boxes.map((b) => b.x)), y = Math.min(...boxes.map((b) => b.y));
  return { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y };
}

function roughOptions(el) {
  const o = {
    seed: el.seed,
    stroke: el.stroke,
    strokeWidth: el.strokeWidth,
    roughness: el.roughness,
    bowing: 1,
    fillStyle: el.fillStyle,
    fillWeight: el.strokeWidth / 2,
    hachureGap: el.strokeWidth * 4,
  };
  if (el.bg !== 'transparent') o.fill = el.bg;
  if (el.strokeStyle === 'dashed') o.strokeLineDash = [8, 8 + el.strokeWidth];
  if (el.strokeStyle === 'dotted') o.strokeLineDash = [1.5, 6 + el.strokeWidth];
  if (el.strokeStyle !== 'solid') o.disableMultiStroke = true;
  return o;
}

function drawables(el) {
  if (el._drawables) return el._drawables;
  const o = roughOptions(el);
  const { x, y, w, h } = box(el);
  let result;
  switch (el.type) {
    case 'rect':
      result = [gen.rectangle(x, y, w, h, o)];
      break;
    case 'ellipse':
      result = [gen.ellipse(x + w / 2, y + h / 2, w, h, o)];
      break;
    case 'diamond':
      result = [gen.polygon([[x + w / 2, y], [x + w, y + h / 2], [x + w / 2, y + h], [x, y + h / 2]], o)];
      break;
    case 'line':
    case 'arrow': {
      delete o.fill;
      const pts = linePoints(el);
      result = [pts.length > 2 ? gen.linearPath(pts, o) : gen.line(el.x1, el.y1, el.x2, el.y2, o)];
      if (el.type === 'arrow') {
        const [fx, fy] = pts[pts.length - 2];
        const angle = Math.atan2(el.y2 - fy, el.x2 - fx);
        const len = Math.hypot(el.x2 - fx, el.y2 - fy);
        const head = Math.min(20 + el.strokeWidth * 2, len * 0.4);
        const spread = Math.PI / 7;
        const wing = (s) => [el.x2 - head * Math.cos(angle + s), el.y2 - head * Math.sin(angle + s)];
        result.push(gen.linearPath([wing(-spread), [el.x2, el.y2], wing(spread)], { ...o, strokeLineDash: undefined }));
      }
      break;
    }
    default:
      result = [];
  }
  el._drawables = result;
  return result;
}

// Same settings Excalidraw uses for its freedraw tool.
function penPath(el) {
  if (el._drawables) return el._drawables;
  const outline = getStroke(el.points, {
    size: el.strokeWidth * 2.2,
    thinning: 0.6,
    smoothing: 0.5,
    streamline: 0.5,
    easing: (t) => Math.sin((t * Math.PI) / 2),
    simulatePressure: !el.pressure,
    last: action?.el !== el,
  });
  const path = new Path2D();
  if (outline.length) {
    path.moveTo(outline[0][0], outline[0][1]);
    for (let i = 0; i < outline.length; i++) {
      const [x0, y0] = outline[i];
      const [x1, y1] = outline[(i + 1) % outline.length];
      path.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
    }
    path.closePath();
  }
  el._drawables = path;
  return path;
}

function drawPen(el, c) {
  if (getStroke) {
    c.fillStyle = el.stroke;
    c.fill(penPath(el));
    return;
  }
  // Fallback until perfect-freehand has loaded.
  const p = el.points;
  c.strokeStyle = el.stroke;
  c.lineWidth = el.strokeWidth * 1.2;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.beginPath();
  c.moveTo(p[0][0], p[0][1]);
  for (const [x, y] of p) c.lineTo(x, y);
  c.stroke();
}

function drawText(el, c) {
  c.font = `${el.fontSize}px ${FONT}`;
  c.fillStyle = el.stroke;
  c.textBaseline = 'top';
  el.text.split('\n').forEach((line, i) => {
    // Small offset matches where the textarea puts the glyphs.
    c.fillText(line, el.x, el.y + i * el.fontSize * LINE_HEIGHT + el.fontSize * (LINE_HEIGHT - 1) / 2);
  });
}

function wrapText(c, text, maxWidth) {
  const lines = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (line && c.measureText(next).width > maxWidth) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

const noteColor = (el) => (el.bg === 'transparent' ? NOTE_COLOR : el.bg);

function drawNote(el, c, hideText) {
  const { x, y, w, h } = box(el);
  c.save();
  c.shadowColor = 'rgba(0, 0, 0, 0.22)';
  c.shadowBlur = 14;
  c.shadowOffsetY = 4;
  c.fillStyle = noteColor(el);
  c.beginPath();
  c.roundRect(x, y, w, h, 4);
  c.fill();
  c.restore();
  // a darker strip along the top, like the sticky edge
  c.fillStyle = 'rgba(0, 0, 0, 0.06)';
  c.fillRect(x, y, w, Math.min(10, h));
  if (hideText || !el.text) return;
  c.save();
  c.beginPath();
  c.rect(x, y, w, h);
  c.clip();
  c.font = `${el.fontSize}px ${FONT}`;
  c.fillStyle = el.stroke;
  c.textBaseline = 'top';
  wrapText(c, el.text, w - NOTE_PAD * 2).forEach((line, i) => {
    c.fillText(line, x + NOTE_PAD, y + NOTE_PAD + i * el.fontSize * LINE_HEIGHT + el.fontSize * (LINE_HEIGHT - 1) / 2);
  });
  c.restore();
}

const imageCache = new Map();
function getImage(src) {
  let img = imageCache.get(src);
  if (!img) {
    img = new Image();
    img.onload = () => render();
    img.src = src;
    imageCache.set(src, img);
  }
  return img;
}

function drawImage(el, c) {
  const img = getImage(el.src);
  const { x, y, w, h } = box(el);
  if (img.complete && img.naturalWidth) c.drawImage(img, x, y, w, h);
}

function drawElement(el, c = ctx, r = rc) {
  if (el.type === 'pen') drawPen(el, c);
  else if (el.type === 'text') drawText(el, c);
  else if (el.type === 'note') drawNote(el, c, c === ctx && el === editing);
  else if (el.type === 'image') drawImage(el, c);
  else for (const d of drawables(el)) r.draw(d);
}

// ---------------------------------------------------------------- hit testing

function distToSegment(px_, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = dx || dy ? Math.max(0, Math.min(1, ((px_ - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(px_ - (ax + t * dx), py - (ay + t * dy));
}

function nearPolyline(points, x, y, tol) {
  if (points.length === 1) return Math.hypot(x - points[0][0], y - points[0][1]) < tol;
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1], [bx, by] = points[i];
    if (distToSegment(x, y, ax, ay, bx, by) < tol) return true;
  }
  return false;
}

function inBox(el, x, y, pad = 0) {
  const b = box(el);
  return x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad;
}

// True when the point touches the element's visible ink. tol is in scene units.
function hitsInk(el, x0, y0, tol) {
  tol += el.strokeWidth / 2;
  const { x, y, w, h } = box(el);
  const filled = el.bg !== 'transparent';
  switch (el.type) {
    case 'text':
      return inBox(el, x0, y0, tol / 2);
    case 'note':
    case 'image':
      return inBox(el, x0, y0);
    case 'pen':
      return nearPolyline(el.points, x0, y0, tol);
    case 'line':
    case 'arrow':
      return nearPolyline(linePoints(el), x0, y0, tol);
    case 'rect':
      if (filled && inBox(el, x0, y0)) return true;
      return inBox(el, x0, y0, tol) && !(x0 > x + tol && x0 < x + w - tol && y0 > y + tol && y0 < y + h - tol);
    case 'diamond': {
      const pts = [[x + w / 2, y], [x + w, y + h / 2], [x + w / 2, y + h], [x, y + h / 2], [x + w / 2, y]];
      if (filled && Math.abs(x0 - x - w / 2) / (w / 2) + Math.abs(y0 - y - h / 2) / (h / 2) <= 1) return true;
      return nearPolyline(pts, x0, y0, tol);
    }
    case 'ellipse': {
      const rx = Math.max(w / 2, 1), ry = Math.max(h / 2, 1);
      const d = Math.hypot((x0 - x - rx) / rx, (y0 - y - ry) / ry);
      if (filled && d <= 1) return true;
      return Math.abs(d - 1) * Math.min(rx, ry) < tol;
    }
  }
  return false;
}

function elementAt(x, y) {
  for (let i = elements.length - 1; i >= 0; i--) if (hitsInk(elements[i], x, y, px(6))) return elements[i];
  for (let i = elements.length - 1; i >= 0; i--) if (inBox(elements[i], x, y, px(4))) return elements[i];
  return null;
}

// ---------------------------------------------------------------- resize handles

// A lone line or arrow gets endpoint handles; everything else gets a box with 8 handles.
function getHandles() {
  const sel = selectedElements();
  if (!sel.length || action?.kind === 'marquee') return [];
  if (sel.length === 1 && isLinear(sel[0])) {
    const el = sel[0];
    return [{ id: 'p1', x: el.x1, y: el.y1 }, { id: 'p2', x: el.x2, y: el.y2 }];
  }
  const b = unionBox(sel);
  const pad = px(SELECTION_PAD);
  const x = b.x - pad, y = b.y - pad, w = b.w + pad * 2, h = b.h + pad * 2;
  const handles = [
    { id: 'nw', x, y }, { id: 'ne', x: x + w, y }, { id: 'se', x: x + w, y: y + h }, { id: 'sw', x, y: y + h },
  ];
  // Side handles only when there is room for them on screen.
  if (w * view.zoom > 40) handles.push({ id: 'n', x: x + w / 2, y }, { id: 's', x: x + w / 2, y: y + h });
  if (h * view.zoom > 40) handles.push({ id: 'e', x: x + w, y: y + h / 2 }, { id: 'w', x, y: y + h / 2 });
  return handles;
}

function handleAt(x, y) {
  const r = px(HANDLE_SIZE);
  return getHandles().find((h) => Math.abs(x - h.x) <= r && Math.abs(y - h.y) <= r) || null;
}

const HANDLE_CURSORS = {
  nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize',
  n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', p1: 'move', p2: 'move',
};

function startResize(handle, x, y, shift) {
  const sel = selectedElements();
  action = {
    kind: 'resize',
    handle: handle.id,
    startX: x,
    startY: y,
    box: unionBox(sel),
    originals: new Map(sel.map((el) => [el.id, clone(el)])),
    keepAspect: sel.some((el) => el.type === 'text' || el.type === 'image'),
    shift,
  };
}

const scalePoint = (x, y, t) => [t.ax + (x - t.ax) * t.sx, t.ay + (y - t.ay) * t.sy];

function snapAngle(dx, dy) {
  const step = Math.PI / 12;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  const len = Math.hypot(dx, dy);
  return [len * Math.cos(angle), len * Math.sin(angle)];
}

function applyResize(x, y, shift) {
  const a = action;
  const sel = selectedElements();

  if (a.handle === 'p1' || a.handle === 'p2') {
    const el = sel[0];
    const n = a.handle === 'p1' ? 1 : 2;
    const [ox, oy] = n === 1 ? (el.mid?.[0] || [el.x2, el.y2]) : (el.mid?.[el.mid.length - 1] || [el.x1, el.y1]);
    let dx = x - ox, dy = y - oy;
    if (shift) [dx, dy] = snapAngle(dx, dy);
    el[`x${n}`] = ox + dx;
    el[`y${n}`] = oy + dy;
    touch(el);
    return;
  }

  const b = a.box, h = a.handle;
  const dx = x - a.startX, dy = y - a.startY;
  let sx = 1, sy = 1;
  if (h.includes('e')) sx = (b.w + dx) / b.w;
  if (h.includes('w')) sx = (b.w - dx) / b.w;
  if (h.includes('s')) sy = (b.h + dy) / b.h;
  if (h.includes('n')) sy = (b.h - dy) / b.h;
  if (!(b.w > 1)) sx = 1;
  if (!(b.h > 1)) sy = 1;
  // Corners keep the aspect ratio with Shift, and always for text and images.
  if (h.length === 2 && (shift || a.keepAspect)) {
    const s = Math.max(Math.abs(sx), Math.abs(sy));
    sx = Math.sign(sx || 1) * s;
    sy = Math.sign(sy || 1) * s;
  }
  const t = {
    sx, sy,
    ax: h.includes('w') ? b.x + b.w : b.x,
    ay: h.includes('n') ? b.y + b.h : b.y,
  };

  for (const el of sel) {
    const o = a.originals.get(el.id);
    if (el.type === 'pen') {
      el.points = o.points.map(([x0, y0, ...rest]) => [...scalePoint(x0, y0, t), ...rest]);
    } else if (el.type === 'text') {
      const ob = box(o);
      const factor = Math.abs(h === 'n' || h === 's' ? sy : sx);
      const [x1, y1] = scalePoint(ob.x, ob.y, t);
      const [x2, y2] = scalePoint(ob.x + ob.w, ob.y + ob.h, t);
      el.fontSize = Math.max(6, o.fontSize * factor);
      el.x = Math.min(x1, x2);
      el.y = Math.min(y1, y2);
    } else {
      [el.x1, el.y1] = scalePoint(o.x1, o.y1, t);
      [el.x2, el.y2] = scalePoint(o.x2, o.y2, t);
      if (o.mid) el.mid = o.mid.map(([mx, my]) => scalePoint(mx, my, t));
    }
    touch(el);
  }
}

// ---------------------------------------------------------------- view (zoom & pan)

const clampZoom = (z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

function viewChanged() {
  $('zoom-label').textContent = `${Math.round(view.zoom * 100)}%`;
  const aligned = Math.abs(view.zoom - 1) < 1e-6 && Math.abs(view.x) < 0.5 && Math.abs(view.y) < 0.5;
  $('reset-view').classList.toggle('hidden', aligned);
  if (editing) styleTextEditor();
  canvas.style.cursor = toolCursor();
  render();
}

function setZoom(zoom, cx = innerWidth / 2, cy = innerHeight / 2) {
  const z = clampZoom(zoom);
  view.x = cx - ((cx - view.x) * z) / view.zoom;
  view.y = cy - ((cy - view.y) * z) / view.zoom;
  view.zoom = z;
  viewChanged();
}

// Steps through tidy percentages like Excalidraw's +/- buttons.
function zoomStep(dir) {
  const z = view.zoom;
  const step = z < 1 ? 0.1 : z < 2 ? 0.25 : z < 5 ? 0.5 : 1;
  const next = dir > 0 ? Math.floor(z / step + 1e-6) * step + step : Math.ceil(z / step - 1e-6) * step - step;
  setZoom(next);
}

function resetView() {
  view.x = 0;
  view.y = 0;
  view.zoom = 1;
  viewChanged();
}

function centerOn(b, zoom = view.zoom) {
  view.zoom = clampZoom(zoom);
  view.x = innerWidth / 2 - (b.x + b.w / 2) * view.zoom;
  view.y = innerHeight / 2 - (b.y + b.h / 2) * view.zoom;
  viewChanged();
}

function zoomToFit() {
  const b = unionBox(selected.size ? selectedElements() : elements);
  if (!b) return resetView();
  const pad = 100;
  const z = Math.min((innerWidth - pad * 2) / Math.max(b.w, 1), (innerHeight - pad * 2) / Math.max(b.h, 1), 4);
  centerOn(b, z);
}

window.addEventListener('wheel', (e) => {
  if (!state.drawMode || e.target.closest?.('.island, .backdrop')) return;
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) {
    // Trackpad pinches arrive as small ctrl+wheel deltas, mouse wheels as big ones.
    const delta = Math.max(-50, Math.min(50, e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY));
    setZoom(view.zoom * Math.exp(-delta * 0.01), e.clientX, e.clientY);
  } else {
    let dx = e.deltaX, dy = e.deltaY;
    if (e.shiftKey && !dx) [dx, dy] = [dy, 0];
    view.x -= dx;
    view.y -= dy;
    viewChanged();
  }
}, { passive: false });

function buildBottomBars() {
  document.querySelector('[data-zoom="out"]').innerHTML = svg(ICONS.minus);
  document.querySelector('[data-zoom="in"]').innerHTML = svg(ICONS.plus);
  $('zoom').addEventListener('click', (e) => {
    const b = e.target.closest('[data-zoom]');
    if (!b) return;
    ({ in: () => zoomStep(1), out: () => zoomStep(-1), reset: () => setZoom(1) })[b.dataset.zoom]();
  });
  document.querySelector('[data-history="undo"]').innerHTML = svg(ICONS.undo);
  document.querySelector('[data-history="redo"]').innerHTML = svg(ICONS.redo);
  $('history-bar').addEventListener('click', (e) => {
    const b = e.target.closest('[data-history]');
    if (b) (b.dataset.history === 'undo' ? undo : redo)();
  });
  $('reset-view').addEventListener('click', resetView);
}

function refreshHistoryButtons() {
  document.querySelector('[data-history="undo"]').disabled = historyIndex <= 0;
  document.querySelector('[data-history="redo"]').disabled = historyIndex >= history.length - 1;
}

// ---------------------------------------------------------------- rendering

let frameQueued = false;
function render() {
  if (frameQueued) return;
  frameQueued = true;
  requestAnimationFrame(() => {
    frameQueued = false;
    paint();
  });
}

function paint() {
  const dpr = window.devicePixelRatio;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, innerWidth, innerHeight);

  if (state.board) {
    ctx.fillStyle = state.board;
    ctx.fillRect(0, 0, innerWidth, innerHeight);
  }

  ctx.setTransform(dpr * view.zoom, 0, 0, dpr * view.zoom, dpr * view.x, dpr * view.y);
  for (const el of elements) {
    if (el === editing && el.type === 'text') continue;
    ctx.save();
    ctx.globalAlpha = el.opacity / 100;
    drawElement(el);
    ctx.restore();
  }
  if (state.drawMode && !state.capturing) paintSelection();

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  paintLaser();
}

function paintSelection() {
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  const sel = selectedElements();
  ctx.save();
  ctx.strokeStyle = accent;
  ctx.lineWidth = px(1);

  if (sel.length && !(sel.length === 1 && isLinear(sel[0]))) {
    if (sel.length > 1) {
      ctx.globalAlpha = 0.4;
      ctx.setLineDash([px(3), px(3)]);
      for (const el of sel) {
        const b = box(el);
        ctx.strokeRect(b.x - px(2), b.y - px(2), b.w + px(4), b.h + px(4));
      }
      ctx.globalAlpha = 1;
    }
    const b = unionBox(sel);
    const pad = px(SELECTION_PAD);
    ctx.setLineDash([px(6), px(4)]);
    ctx.strokeRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2);
  }

  ctx.setLineDash([]);
  ctx.fillStyle = '#ffffff';
  const size = px(HANDLE_SIZE);
  for (const h of getHandles()) {
    ctx.beginPath();
    if (h.id.startsWith('p')) ctx.arc(h.x, h.y, size / 2 + px(1), 0, Math.PI * 2);
    else ctx.roundRect(h.x - size / 2, h.y - size / 2, size, size, px(2));
    ctx.fill();
    ctx.stroke();
  }

  if (action?.kind === 'marquee') {
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.08;
    const m = normRect(action);
    ctx.fillRect(m.x, m.y, m.w, m.h);
    ctx.globalAlpha = 1;
    ctx.strokeRect(m.x, m.y, m.w, m.h);
  }
  ctx.restore();
}

// Laser points are kept in screen pixels, so the trail ignores zoom.
function paintLaser() {
  const now = performance.now();
  laser = laser.filter((p) => now - p.t < 800);
  if (laser.length < 2) {
    if (laser.length) render();
    return;
  }
  ctx.save();
  ctx.lineCap = 'round';
  ctx.shadowColor = '#ff2d2d';
  ctx.shadowBlur = 12;
  for (let i = 1; i < laser.length; i++) {
    const a = laser[i - 1], b = laser[i];
    if (b.stroke !== a.stroke) continue;
    const life = 1 - (now - b.t) / 800;
    ctx.strokeStyle = `rgba(255, 45, 45, ${life})`;
    ctx.lineWidth = 2 + 4 * life;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.restore();
  render(); // keep fading
}

const normRect = (r) => ({ x: Math.min(r.x1, r.x2), y: Math.min(r.y1, r.y2), w: Math.abs(r.x2 - r.x1), h: Math.abs(r.y2 - r.y1) });

function resize() {
  const dpr = window.devicePixelRatio;
  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
  canvas.style.width = `${innerWidth}px`;
  canvas.style.height = `${innerHeight}px`;
  paint();
}

// Draws elements onto a fresh canvas, cropped to their bounds, for export.
function renderToDataURL(els, background) {
  const b = unionBox(els);
  const padding = 24;
  const w = b.w + padding * 2, h = b.h + padding * 2;
  const scale = Math.min(2, 8000 / Math.max(w, h));
  const off = document.createElement('canvas');
  off.width = Math.ceil(w * scale);
  off.height = Math.ceil(h * scale);
  const c = off.getContext('2d');
  if (background) {
    c.fillStyle = background;
    c.fillRect(0, 0, off.width, off.height);
  }
  c.setTransform(scale, 0, 0, scale, (padding - b.x) * scale, (padding - b.y) * scale);
  const r = rough.canvas(off);
  for (const el of els) {
    c.save();
    c.globalAlpha = el.opacity / 100;
    drawElement(el, c, r);
    c.restore();
  }
  return off.toDataURL('image/png');
}

// ---------------------------------------------------------------- history

const snapshot = () => JSON.stringify(elements, (k, v) => (k === '_drawables' ? undefined : v));

let warnedStorage = false;
function saveDrawing() {
  const ok = store(DRAWING_KEY, settings.remember && elements.length ? snapshot() : undefined);
  if (!ok && !warnedStorage) {
    warnedStorage = true;
    toast("This drawing is too big to remember after quitting (images take a lot of space) — use Save to… instead");
  }
}

function commit() {
  const snap = snapshot();
  if (history[historyIndex] === snap) return;
  history = history.slice(0, historyIndex + 1);
  history.push(snap);
  historyIndex = history.length - 1;
  saveDrawing();
  refreshHistoryButtons();
}

function restore(index) {
  historyIndex = index;
  elements = JSON.parse(history[index]);
  const ids = new Set(elements.map((e) => e.id));
  selected = new Set([...selected].filter((id) => ids.has(id)));
  saveDrawing();
  refreshHistoryButtons();
  refreshPanel();
  render();
}

function undo() {
  commitText();
  if (historyIndex > 0) restore(historyIndex - 1);
}

function redo() {
  if (historyIndex < history.length - 1) restore(historyIndex + 1);
}

// ---------------------------------------------------------------- editing helpers

function translate(el, dx, dy) {
  if (el.type === 'pen') el.points = el.points.map(([x, y, ...rest]) => [x + dx, y + dy, ...rest]);
  else if (el.type === 'text') { el.x += dx; el.y += dy; }
  else {
    el.x1 += dx; el.y1 += dy; el.x2 += dx; el.y2 += dy;
    if (el.mid) el.mid = el.mid.map(([x, y]) => [x + dx, y + dy]);
  }
  touch(el);
}

function deleteSelected() {
  if (!selected.size) return;
  elements = elements.filter((el) => !selected.has(el.id));
  selected.clear();
  commit();
  refreshPanel();
  render();
}

function duplicateSelected() {
  const copies = selectedElements().map((el) => {
    const copy = { ...clone(el), id: newId() };
    translate(copy, px(16), px(16));
    return copy;
  });
  if (!copies.length) return;
  elements.push(...copies);
  selected = new Set(copies.map((c) => c.id));
  commit();
  render();
}

function reorder(where) {
  if (!selected.size) return;
  const isSel = (el) => selected.has(el.id);
  if (where === 'front') elements = [...elements.filter((e) => !isSel(e)), ...elements.filter(isSel)];
  else if (where === 'back') elements = [...elements.filter(isSel), ...elements.filter((e) => !isSel(e))];
  else if (where === 'forward') {
    for (let i = elements.length - 2; i >= 0; i--) {
      if (isSel(elements[i]) && !isSel(elements[i + 1])) [elements[i], elements[i + 1]] = [elements[i + 1], elements[i]];
    }
  } else {
    for (let i = 1; i < elements.length; i++) {
      if (isSel(elements[i]) && !isSel(elements[i - 1])) [elements[i], elements[i - 1]] = [elements[i - 1], elements[i]];
    }
  }
  commit();
  render();
}

function selectAll() {
  setTool('select');
  selected = new Set(elements.map((el) => el.id));
  refreshPanel();
  render();
}

function clearAll() {
  commitText();
  if (!elements.length) return;
  elements = [];
  selected.clear();
  commit();
  refreshPanel();
  render();
  toast(keyLabel('Canvas cleared — Ctrl+Z to bring it back'));
}

function eraseAt(x, y) {
  const before = elements.length;
  elements = elements.filter((el) => !hitsInk(el, x, y, px(8)));
  if (elements.length !== before) action.erased = true;
}

// Hold Shift: squares/circles for shapes, 15° steps for lines.
function constrain(el, x, y, shift) {
  let dx = x - el.x1, dy = y - el.y1;
  if (shift) {
    if (isLinear(el)) [dx, dy] = snapAngle(dx, dy);
    else {
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      dx = Math.sign(dx || 1) * d;
      dy = Math.sign(dy || 1) * d;
    }
  }
  el.x2 = el.x1 + dx;
  el.y2 = el.y1 + dy;
}

// ---------------------------------------------------------------- text & sticky notes

function styleTextEditor() {
  const el = editing, z = view.zoom;
  const isNote = el.type === 'note';
  textEditor.classList.toggle('note', isNote);
  textEditor.style.fontSize = `${el.fontSize * z}px`;
  textEditor.style.color = el.stroke;
  textEditor.style.opacity = el.opacity / 100;
  if (isNote) {
    const b = box(el);
    const [sx, sy] = toScreen(b.x, b.y);
    Object.assign(textEditor.style, {
      left: `${sx}px`, top: `${sy}px`, width: `${b.w * z}px`, height: `${b.h * z}px`, padding: `${NOTE_PAD * z}px`,
    });
  } else {
    const [sx, sy] = toScreen(el.x, el.y);
    Object.assign(textEditor.style, { left: `${sx}px`, top: `${sy}px`, padding: '0' });
    sizeTextEditor();
  }
}

function sizeTextEditor() {
  if (!editing || editing.type === 'note') return;
  ctx.font = `${editing.fontSize}px ${FONT}`;
  const lines = textEditor.value.split('\n');
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width));
  textEditor.style.width = `${Math.max((w + editing.fontSize) * view.zoom, 40)}px`;
  textEditor.style.height = `${lines.length * editing.fontSize * LINE_HEIGHT * view.zoom}px`;
}

function startText(x, y, existing) {
  commitText();
  editing = existing || newElement('text', { x, y: y - (state.style.fontSize * LINE_HEIGHT) / 2, text: '' });
  textEditor.value = editing.text;
  textEditor.style.display = 'block';
  styleTextEditor();
  setTimeout(() => textEditor.focus(), 0);
  render();
}

function commitText() {
  if (!editing) return;
  const el = editing;
  editing = null;
  textEditor.style.display = 'none';
  const text = textEditor.value.replace(/\s+$/, '');
  const index = elements.indexOf(el);
  let created = false;
  if (el.type === 'note') el.text = text;
  else if (!text) {
    if (index >= 0) elements.splice(index, 1);
  } else {
    el.text = text;
    if (index < 0) {
      elements.push(el);
      created = true;
    }
  }
  touch(el);
  commit();
  if (created && !settings.toolLock) selectAfterCreate(el);
  render();
}

textEditor.addEventListener('input', sizeTextEditor);
textEditor.addEventListener('blur', commitText);
textEditor.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Escape' || (e.key === 'Enter' && e.ctrlKey)) {
    e.preventDefault();
    commitText();
  }
});

// ---------------------------------------------------------------- images & clipboard

function viewCenter() {
  return toScene(innerWidth / 2, innerHeight / 2);
}

function addImage(src) {
  const img = new Image();
  img.onload = () => {
    imageCache.set(src, img);
    const maxW = px(innerWidth * 0.5), maxH = px(innerHeight * 0.5);
    const s = Math.min(1 / window.devicePixelRatio, maxW / img.naturalWidth, maxH / img.naturalHeight);
    const w = img.naturalWidth * s, h = img.naturalHeight * s;
    const [cx, cy] = lastPointer || viewCenter();
    const el = newElement('image', { x1: cx - w / 2, y1: cy - h / 2, x2: cx + w / 2, y2: cy + h / 2, src });
    elements.push(el);
    commit();
    selectAfterCreate(el);
  };
  img.onerror = () => toast("Couldn't read that image");
  img.src = src;
}

async function insertImage() {
  const file = await overlay.openFile({
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'] }],
    asDataURL: true,
  });
  if (file) addImage(file.data);
}

const CLIPBOARD_TYPE = 'drawzy/clipboard';

async function copySelected(cut = false) {
  const sel = selectedElements();
  if (!sel.length) return;
  await overlay.writeClipboardText(JSON.stringify({ type: CLIPBOARD_TYPE, elements: sel.map(clone) }));
  if (cut) deleteSelected();
  else toast(`Copied ${sel.length} item${sel.length > 1 ? 's' : ''}`);
}

async function paste() {
  const clip = await overlay.readClipboard();
  if (clip.image) return addImage(clip.image);
  const text = (clip.text || '').trim();
  if (!text) return;
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    // plain text
  }
  const [cx, cy] = lastPointer || viewCenter();
  if (data?.type === CLIPBOARD_TYPE) {
    const copies = data.elements.map((el) => ({ ...el, id: newId() }));
    const b = unionBox(copies);
    copies.forEach((el) => translate(el, cx - (b.x + b.w / 2), cy - (b.y + b.h / 2)));
    elements.push(...copies);
    commit();
    setTool('select');
    selected = new Set(copies.map((c) => c.id));
  } else if (data?.type === 'excalidraw/clipboard' || data?.type === 'excalidraw') {
    // Pasting straight from excalidraw.com works too.
    const copies = fromExcalidrawScene(data);
    const b = unionBox(copies);
    if (!b) return;
    copies.forEach((el) => translate(el, cx - (b.x + b.w / 2), cy - (b.y + b.h / 2)));
    elements.push(...copies);
    commit();
    setTool('select');
    selected = new Set(copies.map((c) => c.id));
  } else {
    const el = newElement('text', { x: cx, y: cy, text });
    elements.push(el);
    commit();
    selectAfterCreate(el);
  }
  refreshPanel();
  render();
}

// ---------------------------------------------------------------- .excalidraw files

const WIDTH_TO_EX = { 2: 1, 4: 2, 7: 4 };
const widthFromEx = (w) => (w <= 1 ? 2 : w <= 2 ? 4 : 7);

function toExcalidraw(el, files) {
  const b = box(el);
  const base = {
    id: el.id, angle: 0, x: b.x, y: b.y, width: b.w, height: b.h,
    strokeColor: el.stroke, backgroundColor: el.bg, fillStyle: el.fillStyle,
    strokeWidth: WIDTH_TO_EX[el.strokeWidth] ?? 2, strokeStyle: el.strokeStyle,
    roughness: el.roughness, opacity: el.opacity, groupIds: [], frameId: null, roundness: null,
    seed: el.seed, version: 1, versionNonce: el.seed, isDeleted: false, boundElements: null,
    updated: Date.now(), link: null, locked: false,
  };
  const textEl = (props) => ({
    ...base, type: 'text', backgroundColor: 'transparent', fontFamily: 1, textAlign: 'left',
    verticalAlign: 'top', containerId: null, lineHeight: LINE_HEIGHT, autoResize: true, ...props, originalText: props.text,
  });
  switch (el.type) {
    case 'rect': return [{ ...base, type: 'rectangle' }];
    case 'ellipse': return [{ ...base, type: 'ellipse' }];
    case 'diamond': return [{ ...base, type: 'diamond' }];
    case 'line':
    case 'arrow':
      return [{
        ...base, type: el.type, x: el.x1, y: el.y1, backgroundColor: 'transparent',
        points: linePoints(el).map(([x, y]) => [x - el.x1, y - el.y1]),
        lastCommittedPoint: null, startBinding: null, endBinding: null,
        startArrowhead: null, endArrowhead: el.type === 'arrow' ? 'arrow' : null,
      }];
    case 'pen': {
      const [x0, y0] = el.points[0];
      return [{
        ...base, type: 'freedraw', x: x0, y: y0, backgroundColor: 'transparent',
        points: el.points.map(([x, y]) => [x - x0, y - y0]),
        pressures: el.pressure ? el.points.map((p) => p[2]) : [],
        simulatePressure: !el.pressure, lastCommittedPoint: null,
      }];
    }
    case 'text':
      return [textEl({ text: el.text, fontSize: el.fontSize })];
    case 'note':
      // A filled rectangle plus a text element; customData lets us rebuild the note on open.
      return [
        { ...base, type: 'rectangle', backgroundColor: noteColor(el), fillStyle: 'solid', strokeColor: 'transparent', roughness: 0, roundness: { type: 3 }, customData: { drawzy: 'note', text: el.text, fontSize: el.fontSize, textColor: el.stroke } },
        textEl({ id: `${el.id}-text`, x: b.x + NOTE_PAD, y: b.y + NOTE_PAD, width: b.w - NOTE_PAD * 2, height: b.h - NOTE_PAD * 2, text: el.text, fontSize: el.fontSize, customData: { drawzy: 'note-text' } }),
      ];
    case 'image': {
      const mimeType = el.src.slice(5, el.src.indexOf(';'));
      files[el.id] = { mimeType, id: el.id, dataURL: el.src, created: Date.now() };
      return [{ ...base, type: 'image', fileId: el.id, status: 'saved', scale: [1, 1], strokeColor: 'transparent', backgroundColor: 'transparent' }];
    }
  }
  return [];
}

function toExcalidrawScene(els = elements) {
  const files = {};
  return {
    type: 'excalidraw',
    version: 2,
    source: 'drawzy',
    elements: els.flatMap((el) => toExcalidraw(el, files)),
    appState: { viewBackgroundColor: state.board || '#ffffff', gridSize: null },
    files,
  };
}

function fromExcalidraw(ex, files) {
  if (ex.isDeleted || ex.customData?.drawzy === 'note-text') return null;
  const common = {
    id: newId(),
    seed: ex.seed ?? Math.floor(Math.random() * 2 ** 31),
    stroke: ex.strokeColor ?? '#1e1e1e',
    bg: ex.backgroundColor ?? 'transparent',
    fillStyle: ['hachure', 'cross-hatch', 'solid'].includes(ex.fillStyle) ? ex.fillStyle : 'hachure',
    strokeWidth: widthFromEx(ex.strokeWidth ?? 2),
    strokeStyle: ex.strokeStyle || 'solid',
    roughness: ex.roughness ?? 1,
    opacity: ex.opacity ?? 100,
  };
  const rect = { x1: ex.x, y1: ex.y, x2: ex.x + ex.width, y2: ex.y + ex.height };
  switch (ex.type) {
    case 'rectangle':
      if (ex.customData?.drawzy === 'note') {
        return { ...common, ...rect, type: 'note', text: ex.customData.text || '', fontSize: ex.customData.fontSize || 20, stroke: ex.customData.textColor || '#1e1e1e' };
      }
      return { ...common, ...rect, type: 'rect' };
    case 'ellipse':
    case 'diamond':
      return { ...common, ...rect, type: ex.type };
    case 'line':
    case 'arrow': {
      const pts = (ex.points || [[0, 0]]).map(([x, y]) => [ex.x + x, ex.y + y]);
      if (pts.length < 2) return null;
      const el = { ...common, type: ex.type === 'arrow' && ex.endArrowhead ? 'arrow' : 'line', x1: pts[0][0], y1: pts[0][1], x2: pts[pts.length - 1][0], y2: pts[pts.length - 1][1] };
      if (pts.length > 2) el.mid = pts.slice(1, -1);
      return el;
    }
    case 'freedraw': {
      const pressure = !ex.simulatePressure && ex.pressures?.length > 0;
      return { ...common, type: 'pen', pressure, points: ex.points.map(([x, y], i) => [ex.x + x, ex.y + y, pressure ? ex.pressures[i] ?? 0.5 : 0.5]) };
    }
    case 'text':
      return { ...common, type: 'text', x: ex.x, y: ex.y, text: ex.text ?? ex.originalText ?? '', fontSize: ex.fontSize || 20 };
    case 'image': {
      const file = files?.[ex.fileId];
      return file ? { ...common, ...rect, type: 'image', src: file.dataURL } : null;
    }
  }
  return null; // frames, embeds etc. aren't supported
}

function fromExcalidrawScene(scene) {
  return (scene.elements || []).map((ex) => fromExcalidraw(ex, scene.files)).filter(Boolean);
}

async function saveScene() {
  if (!elements.length) return toast('Nothing to save yet');
  const file = await overlay.saveFile({
    name: 'drawing.excalidraw',
    filters: [{ name: 'Excalidraw drawing', extensions: ['excalidraw'] }, { name: 'JSON', extensions: ['json'] }],
    data: JSON.stringify(toExcalidrawScene(), null, 2),
  });
  if (file) toast(`Saved to ${file} — you can open it on excalidraw.com too`);
}

async function openScene() {
  const file = await overlay.openFile({ filters: [{ name: 'Excalidraw drawing', extensions: ['excalidraw', 'json'] }] });
  if (!file) return;
  try {
    const loaded = fromExcalidrawScene(JSON.parse(file.data));
    commitText();
    elements = loaded;
    selected.clear();
    commit();
    refreshPanel();
    zoomToFit();
    toast(keyLabel(`Opened ${file.name} — Ctrl+Z to go back`));
  } catch {
    toast(`${file.name} isn't an Excalidraw drawing`);
  }
}

async function exportImage() {
  const els = selected.size ? selectedElements() : elements;
  if (!els.length) return toast('Nothing to export yet');
  const dataURL = renderToDataURL(els, state.board);
  const file = await overlay.saveFile({
    name: 'drawing.png',
    filters: [{ name: 'PNG image', extensions: ['png'] }],
    data: dataURL.split(',')[1],
    base64: true,
  });
  if (file) toast(`Exported ${selected.size ? 'selection' : 'drawing'} to ${file}`);
}

async function copyAsPng() {
  const els = selected.size ? selectedElements() : elements;
  if (!els.length) return toast('Nothing to copy yet');
  await overlay.copyImage(renderToDataURL(els, state.board));
  toast(`Copied ${selected.size ? 'selection' : 'drawing'} as PNG`);
}

// ---------------------------------------------------------------- find on canvas

const find = { matches: [], index: 0 };

function openFind() {
  $('find').classList.remove('hidden');
  $('find-input').focus();
  $('find-input').select();
  runFind();
}

function closeFind() {
  $('find').classList.add('hidden');
  $('find-input').blur();
}

function runFind() {
  const q = $('find-input').value.trim().toLowerCase();
  find.matches = q ? elements.filter((el) => (el.type === 'text' || el.type === 'note') && el.text.toLowerCase().includes(q)) : [];
  find.index = 0;
  showFindMatch();
}

function showFindMatch() {
  const n = find.matches.length;
  $('find-count').textContent = $('find-input').value.trim() ? (n ? `${find.index + 1} of ${n}` : 'No results') : '';
  if (!n) return;
  const el = find.matches[find.index];
  setTool('select');
  selected = new Set([el.id]);
  refreshPanel();
  centerOn(box(el));
}

function stepFind(dir) {
  if (!find.matches.length) return;
  find.index = (find.index + dir + find.matches.length) % find.matches.length;
  showFindMatch();
}

function buildFind() {
  $('find-prev').innerHTML = svg(ICONS.up);
  $('find-next').innerHTML = svg(ICONS.down);
  $('find-close').innerHTML = svg(ICONS.close);
  $('find-input').addEventListener('input', runFind);
  $('find-input').addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') stepFind(e.shiftKey ? -1 : 1);
    if (e.key === 'Escape') closeFind();
  });
  $('find-prev').addEventListener('click', () => stepFind(-1));
  $('find-next').addEventListener('click', () => stepFind(1));
  $('find-close').addEventListener('click', closeFind);
}

// ---------------------------------------------------------------- command palette

function commands() {
  return [
    ...TOOLS.map((t) => ({ name: `Tool: ${t.name}`, icon: t.id, keys: t.letter.toUpperCase(), run: () => setTool(t.id) })),
    { name: 'Insert image', icon: 'image', keys: 'I', run: insertImage },
    { name: 'Undo', icon: 'undo', keys: 'Ctrl+Z', run: undo },
    { name: 'Redo', icon: 'redo', keys: 'Ctrl+Y', run: redo },
    { name: 'Zoom in', icon: 'plus', keys: 'Ctrl+=', run: () => zoomStep(1) },
    { name: 'Zoom out', icon: 'minus', keys: 'Ctrl+-', run: () => zoomStep(-1) },
    { name: 'Reset zoom', icon: 'search', keys: 'Ctrl+0', run: () => setZoom(1) },
    { name: 'Zoom to fit everything', icon: 'fit', keys: 'Shift+1', run: zoomToFit },
    { name: 'Reset view to match screen', icon: 'monitor', run: resetView },
    { name: 'Select all', icon: 'select', keys: 'Ctrl+A', run: selectAll },
    { name: 'Duplicate selection', icon: 'copy', keys: 'Ctrl+D', run: duplicateSelected },
    { name: 'Delete selection', icon: 'trash', keys: 'Del', run: deleteSelected },
    { name: 'Bring to front', icon: 'toFront', keys: 'Ctrl+Shift+]', run: () => reorder('front') },
    { name: 'Send to back', icon: 'toBack', keys: 'Ctrl+Shift+[', run: () => reorder('back') },
    { name: 'Copy selection', icon: 'copy', keys: 'Ctrl+C', run: () => copySelected() },
    { name: 'Paste', icon: 'copy', keys: 'Ctrl+V', run: paste },
    { name: 'Open drawing…', icon: 'folder', keys: 'Ctrl+O', run: openScene },
    { name: 'Save to…', icon: 'download', keys: 'Ctrl+S', run: saveScene },
    { name: 'Export image…', icon: 'exportImage', keys: 'Ctrl+Shift+E', run: exportImage },
    { name: 'Copy as PNG', icon: 'copy', keys: 'Shift+Alt+C', run: copyAsPng },
    { name: 'Screenshot with screen', icon: 'camera', keys: 'Ctrl+Shift+S', run: screenshot },
    { name: 'Find on canvas', icon: 'search', keys: 'Ctrl+F', run: openFind },
    { name: 'Toggle dark mode', icon: 'moon', keys: 'Alt+Shift+D', run: () => setTheme(resolvedTheme() === 'dark' ? 'light' : 'dark') },
    { name: 'Theme: follow system', icon: 'monitor', run: () => setTheme('system') },
    { name: 'Toggle canvas background', icon: 'board', keys: 'B', run: toggleBoard },
    { name: `Tool lock: turn ${settings.toolLock ? 'off' : 'on'}`, icon: settings.toolLock ? 'unlock' : 'lock', keys: 'Q', run: toggleToolLock },
    { name: 'When I stop drawing: keep drawings on screen', icon: 'check', run: () => setOnExit('keep') },
    { name: 'When I stop drawing: hide until I draw again', icon: 'check', run: () => setOnExit('hide') },
    { name: `Remember drawings after quitting: turn ${settings.remember ? 'off' : 'on'}`, icon: 'check', run: toggleRemember },
    { name: 'Keyboard shortcuts', icon: 'help', keys: '?', run: openHelp },
    { name: 'Reset the canvas', icon: 'trash', run: clearAll },
    { name: `Open at login: turn ${state.openAtLogin ? 'off' : 'on'}`, icon: 'check', desktop: true, run: toggleOpenAtLogin },
    { name: 'Stop drawing', icon: 'exit', keys: 'Esc', run: () => overlay.exitDraw() },
    { name: 'Quit Drawzy', icon: 'power', desktop: true, run: () => overlay.quit() },
  ].filter((c) => !(IN_BROWSER && c.desktop));
}

const palette = { items: [], index: 0 };

function openPalette() {
  closeDropdowns();
  $('palette-backdrop').classList.remove('hidden');
  $('palette-input').value = '';
  renderPalette();
  $('palette-input').focus();
}

function closePalette() {
  $('palette-backdrop').classList.add('hidden');
}

function renderPalette() {
  const words = $('palette-input').value.toLowerCase().split(/\s+/).filter(Boolean);
  palette.items = commands().filter((c) => words.every((w) => c.name.toLowerCase().includes(w)));
  palette.index = Math.min(palette.index, Math.max(0, palette.items.length - 1));
  $('palette-list').innerHTML = palette.items.length
    ? palette.items.map((c, i) => `<div class="palette-item${i === palette.index ? ' active' : ''}" data-index="${i}"><span class="menu-icon">${svg(ICONS[c.icon] || '')}</span><span class="grow">${c.name}</span>${c.keys ? `<kbd>${keyLabel(c.keys)}</kbd>` : ''}</div>`).join('')
    : '<div class="palette-empty">No matching commands</div>';
  $('palette-list').querySelector('.active')?.scrollIntoView({ block: 'nearest' });
}

function runPaletteItem(i) {
  const cmd = palette.items[i];
  closePalette();
  if (cmd) cmd.run();
}

function buildPalette() {
  $('palette-input').addEventListener('input', () => {
    palette.index = 0;
    renderPalette();
  });
  $('palette-input').addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') closePalette();
    else if (e.key === 'Enter') runPaletteItem(palette.index);
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = palette.items.length;
      if (n) palette.index = (palette.index + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
      renderPalette();
    }
  });
  $('palette-list').addEventListener('click', (e) => {
    const item = e.target.closest('[data-index]');
    if (item) runPaletteItem(Number(item.dataset.index));
  });
  $('palette-backdrop').addEventListener('pointerdown', (e) => {
    if (e.target === $('palette-backdrop')) closePalette();
  });
}

// ---------------------------------------------------------------- help

const SHORTCUTS = [
  ['Tools', [
    ['Hand (pan)', 'H'], ['Select', 'V or 1'], ['Rectangle', 'R or 2'], ['Diamond', 'D or 3'], ['Ellipse', 'O or 4'],
    ['Arrow', 'A or 5'], ['Line', 'L or 6'], ['Draw', 'P or 7'], ['Text', 'T or 8'], ['Sticky note', 'N'],
    ['Insert image', 'I or 9'], ['Eraser', 'E or 0'], ['Laser pointer', 'K'], ['Tool lock', 'Q'],
  ]],
  ['View', [
    ['Zoom in / out', 'Ctrl+scroll'], ['Zoom in', 'Ctrl+='], ['Zoom out', 'Ctrl+-'], ['Reset zoom', 'Ctrl+0'],
    ['Zoom to fit', 'Shift+1'], ['Pan', 'Scroll · Space+drag · middle-drag'], ['Canvas background', 'B'],
    ['Dark mode', 'Alt+Shift+D'], ['Find on canvas', 'Ctrl+F'], ['Command palette', 'Ctrl+/'],
  ]],
  ['Editor', [
    ['Undo / redo', 'Ctrl+Z / Ctrl+Y'], ['Select all', 'Ctrl+A'], ['Copy / cut / paste', 'Ctrl+C / X / V'],
    ['Duplicate', 'Ctrl+D'], ['Delete', 'Del'], ['Bring forward / to front', 'Ctrl+] / Ctrl+Shift+]'],
    ['Send backward / to back', 'Ctrl+[ / Ctrl+Shift+['], ['Perfect shapes, 15° lines', 'Hold Shift'],
    ['Edit text or note', 'Double-click'], ['Finish typing', 'Esc or Ctrl+Enter'],
  ]],
  ['Drawzy', [
    ['Start / stop drawing', 'Ctrl+Shift+D'], ['Show / hide drawings', 'Ctrl+Shift+H'], ['Stop drawing', 'Esc'],
    ['Open', 'Ctrl+O'], ['Save to…', 'Ctrl+S'], ['Export image', 'Ctrl+Shift+E'], ['Copy as PNG', 'Shift+Alt+C'],
    ['Screenshot with screen', 'Ctrl+Shift+S'], ['Help', '?'],
  ]],
];

function buildHelp() {
  $('help-close').innerHTML = svg(ICONS.close);
  $('help-body').innerHTML = SHORTCUTS.map(([title, rows]) =>
    `<div><h3>${title}</h3>${rows.map(([name, keys]) => `<div class="help-row"><span>${name}</span><kbd>${keyLabel(keys)}</kbd></div>`).join('')}</div>`).join('');
  $('help-close').addEventListener('click', closeHelp);
  $('help-backdrop').addEventListener('pointerdown', (e) => {
    if (e.target === $('help-backdrop')) closeHelp();
  });
}

function openHelp() {
  closeDropdowns();
  $('help-backdrop').classList.remove('hidden');
}

function closeHelp() {
  $('help-backdrop').classList.add('hidden');
}

const modalOpen = () => !$('palette-backdrop').classList.contains('hidden') || !$('help-backdrop').classList.contains('hidden');

// ---------------------------------------------------------------- pointer input

canvas.addEventListener('pointerdown', (e) => {
  if (!state.drawMode) return;
  closeDropdowns();
  if (editing) {
    commitText();
    return;
  }
  canvas.setPointerCapture(e.pointerId);

  // Space+drag, middle-drag and the hand tool all pan.
  if (e.button === 1 || state.spaceDown || (state.tool === 'hand' && e.button === 0)) {
    e.preventDefault();
    action = { kind: 'pan', lastX: e.clientX, lastY: e.clientY };
    canvas.style.cursor = 'grabbing';
    return;
  }
  if (e.button !== 0) return;

  const [x, y] = toScene(e.clientX, e.clientY);

  switch (state.tool) {
    case 'select': {
      const handle = handleAt(x, y);
      if (handle) {
        startResize(handle, x, y, e.shiftKey);
        break;
      }
      const hit = elementAt(x, y);
      if (hit) {
        if (e.shiftKey && selected.has(hit.id)) selected.delete(hit.id);
        else {
          if (!selected.has(hit.id) && !e.shiftKey) selected.clear();
          selected.add(hit.id);
        }
        action = { kind: 'move', lastX: x, lastY: y, moved: false };
      } else {
        if (!e.shiftKey) selected.clear();
        action = { kind: 'marquee', x1: x, y1: y, x2: x, y2: y, keep: new Set(selected) };
      }
      refreshPanel();
      break;
    }
    case 'pen': {
      const pen = e.pointerType === 'pen';
      const el = newElement('pen', { points: [[x, y, pen ? e.pressure : 0.5]], pressure: pen });
      elements.push(el);
      action = { kind: 'create', el };
      break;
    }
    case 'text': {
      const hit = elementAt(x, y);
      if (hit?.type === 'text' || hit?.type === 'note') startText(0, 0, hit);
      else startText(x, y);
      break;
    }
    case 'note': {
      const bg = state.style.bg === 'transparent' ? NOTE_COLOR : state.style.bg;
      const el = newElement('note', { x1: x, y1: y, x2: x, y2: y, text: '', bg, stroke: '#1e1e1e', fontSize: 20 });
      elements.push(el);
      action = { kind: 'create', el };
      break;
    }
    case 'eraser':
      action = { kind: 'erase', erased: false };
      eraseAt(x, y);
      break;
    case 'laser':
      action = { kind: 'laser', stroke: e.timeStamp };
      laser.push({ x: e.clientX, y: e.clientY, t: performance.now(), stroke: action.stroke });
      break;
    default: {
      const el = newElement(state.tool, { x1: x, y1: y, x2: x, y2: y });
      elements.push(el);
      action = { kind: 'create', el };
    }
  }
  render();
});

function hoverCursor(x, y) {
  if (state.tool !== 'select' || state.spaceDown) return;
  const handle = handleAt(x, y);
  canvas.style.cursor = handle ? HANDLE_CURSORS[handle.id] : elementAt(x, y) ? 'move' : 'default';
}

canvas.addEventListener('pointermove', (e) => {
  const [x, y] = toScene(e.clientX, e.clientY);
  lastPointer = [x, y];
  if (!action) {
    if (state.drawMode) hoverCursor(x, y);
    return;
  }
  switch (action.kind) {
    case 'pan':
      view.x += e.clientX - action.lastX;
      view.y += e.clientY - action.lastY;
      action.lastX = e.clientX;
      action.lastY = e.clientY;
      viewChanged();
      canvas.style.cursor = 'grabbing';
      return;
    case 'create': {
      const el = action.el;
      if (el.type === 'pen') {
        const events = e.getCoalescedEvents?.() || [];
        for (const ev of events.length ? events : [e]) {
          el.points.push([...toScene(ev.clientX, ev.clientY), el.pressure ? ev.pressure : 0.5]);
        }
      } else {
        constrain(el, x, y, e.shiftKey);
      }
      touch(el);
      break;
    }
    case 'move': {
      const dx = x - action.lastX, dy = y - action.lastY;
      for (const el of selectedElements()) translate(el, dx, dy);
      action.lastX = x;
      action.lastY = y;
      action.moved = true;
      break;
    }
    case 'resize':
      applyResize(x, y, e.shiftKey);
      action.moved = true;
      break;
    case 'marquee': {
      action.x2 = x;
      action.y2 = y;
      const m = normRect(action);
      selected = new Set(action.keep);
      for (const el of elements) {
        const b = box(el);
        if (b.x >= m.x && b.y >= m.y && b.x + b.w <= m.x + m.w && b.y + b.h <= m.y + m.h) selected.add(el.id);
      }
      break;
    }
    case 'erase':
      eraseAt(x, y);
      break;
    case 'laser':
      laser.push({ x: e.clientX, y: e.clientY, t: performance.now(), stroke: action.stroke });
      break;
  }
  render();
});

function endPointer() {
  if (!action) return;
  const done = action;
  action = null;
  switch (done.kind) {
    case 'pan':
      canvas.style.cursor = toolCursor();
      break;
    case 'create': {
      const el = done.el;
      if (el.type === 'note') {
        // A click (no drag) drops a standard-sized note centred on the cursor.
        const b = box(el);
        if (b.w < px(20) || b.h < px(20)) {
          const size = 200;
          [el.x1, el.y1, el.x2, el.y2] = [el.x1 - size / 2, el.y1 - size / 2, el.x1 + size / 2, el.y1 + size / 2];
        } else [el.x1, el.y1, el.x2, el.y2] = [b.x, b.y, b.x + b.w, b.y + b.h];
        touch(el);
        commit();
        if (!settings.toolLock) selectAfterCreate(el);
        startText(0, 0, el);
        break;
      }
      const b = box(el);
      const min = px(4);
      const tiny = el.type !== 'pen' && (isLinear(el) ? Math.hypot(b.w, b.h) < min : b.w < min || b.h < min);
      if (tiny) elements.pop();
      else {
        touch(el); // rebuild the pen outline with its finished end cap
        commit();
        if (!settings.toolLock && el.type !== 'pen') selectAfterCreate(el);
      }
      break;
    }
    case 'move':
    case 'resize':
      if (done.moved) commit();
      break;
    case 'marquee':
      refreshPanel();
      break;
    case 'erase':
      if (done.erased) commit();
      break;
  }
  render();
}

canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

canvas.addEventListener('dblclick', (e) => {
  if (!state.drawMode || state.tool !== 'select') return;
  const [x, y] = toScene(e.clientX, e.clientY);
  const hit = elementAt(x, y);
  if (hit?.type === 'text' || hit?.type === 'note') startText(0, 0, hit);
  else if (!hit) startText(x, y);
});

// ---------------------------------------------------------------- keyboard

window.addEventListener('keydown', (e) => {
  if (!state.drawMode || editing) return;
  if (e.target.closest?.('input, textarea')) return;
  if (modalOpen()) {
    if (e.key === 'Escape') {
      closePalette();
      closeHelp();
    }
    return;
  }

  const key = e.key.toLowerCase();
  const mod = e.ctrlKey || e.metaKey;

  if (e.code === 'Space') {
    if (!state.spaceDown) {
      state.spaceDown = true;
      canvas.style.cursor = toolCursor();
    }
    e.preventDefault();
    return;
  }

  if (e.altKey && e.shiftKey && e.code === 'KeyD') return setTheme(resolvedTheme() === 'dark' ? 'light' : 'dark');
  if (e.altKey && e.shiftKey && e.code === 'KeyC') return copyAsPng();

  if (mod) {
    const shortcuts = {
      z: () => (e.shiftKey ? redo() : undo()),
      y: redo,
      a: selectAll,
      d: duplicateSelected,
      c: () => copySelected(),
      x: () => copySelected(true),
      v: paste,
      o: openScene,
      s: () => (e.shiftKey ? screenshot() : saveScene()),
      e: () => e.shiftKey && exportImage(),
      f: openFind,
      '/': openPalette,
      p: () => e.shiftKey && openPalette(),
      '=': () => zoomStep(1),
      '+': () => zoomStep(1),
      '-': () => zoomStep(-1),
      0: () => setZoom(1),
    };
    if (e.code === 'BracketRight') reorder(e.shiftKey ? 'front' : 'forward');
    else if (e.code === 'BracketLeft') reorder(e.shiftKey ? 'back' : 'backward');
    else if (shortcuts[key]) shortcuts[key]();
    else return;
    e.preventDefault();
    return;
  }
  if (e.altKey) return;

  if (e.code === 'Digit1' && e.shiftKey) return zoomToFit();
  if (key === '?') return openHelp();

  if (key === 'escape') {
    if (!$('menu').classList.contains('hidden') || !$('more-menu').classList.contains('hidden')) closeDropdowns();
    else if (!$('find').classList.contains('hidden')) closeFind();
    else if (selected.size) {
      selected.clear();
      refreshPanel();
      render();
    } else overlay.exitDraw();
    return;
  }
  if (key === 'delete' || key === 'backspace') return deleteSelected();
  if (key === 'b') return toggleBoard();
  if (key === 'q') return toggleToolLock();
  if (key === 'i' || key === '9') return insertImage();

  const tool = TOOLS.find((t) => t.key === key || t.letter === key);
  if (tool) setTool(tool.id);
});

window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') {
    state.spaceDown = false;
    canvas.style.cursor = toolCursor();
  }
});

// ---------------------------------------------------------------- screenshot & toast

let toastTimer;
function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

async function screenshot() {
  commitText();
  state.capturing = true;
  document.body.classList.add('capturing');
  paint();
  await nextFrame();
  try {
    const file = await overlay.screenshot();
    toast(`Copied to clipboard and saved to ${file}`);
  } catch (err) {
    toast(`Screenshot failed: ${err.message}`);
  } finally {
    state.capturing = false;
    document.body.classList.remove('capturing');
    render();
  }
}

// ---------------------------------------------------------------- main process events

overlay.onMode((on) => {
  state.drawMode = on;
  document.body.classList.toggle('drawing', on);
  if (!on) {
    commitText();
    closeDropdowns();
    closePalette();
    closeHelp();
    closeFind();
    selected.clear();
    action = null;
    state.spaceDown = false;
    // A canvas background would block the screen once clicks pass through again.
    state.board = null;
    // Main shows them again next time drawing starts; Ctrl+Shift+H brings them back early.
    if (settings.onExit === 'hide') overlay.setVisible(false);
  }
  refreshPanel();
  render();
});

overlay.onVisible((on) => {
  canvas.style.visibility = on ? 'visible' : 'hidden';
});

overlay.onMode((on) => {
  if (on) overlay.getOpenAtLogin().then((v) => { state.openAtLogin = v; });
});

overlay.onCommand((cmd) => {
  if (cmd === 'clear') clearAll();
});

// ---------------------------------------------------------------- boot

applyTheme();
buildToolbar();
buildMenu();
buildPanel();
buildBottomBars();
buildFind();
buildPalette();
buildHelp();
document.querySelectorAll('[title]').forEach((el) => { el.title = keyLabel(el.title); });
if (settings.remember) elements = load(DRAWING_KEY) || [];
setTool('pen');
commit();
viewChanged();
window.addEventListener('resize', resize);
resize();
