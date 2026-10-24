// Builds the Chrome extension into dist/extension and zips it as dist/Drawzy-chrome.zip.
// The extension reuses the desktop app's drawing engine (src/renderer.js, src/style.css and the overlay markup)
// with extension/host.js standing in for the Electron preload bridge.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.join(__dirname, '..');
const out = path.join(root, 'dist', 'extension');
const pkg = require('../package.json');

const copy = (from, to) => {
  fs.mkdirSync(path.dirname(path.join(out, to)), { recursive: true });
  fs.copyFileSync(path.join(root, from), path.join(out, to));
};

fs.rmSync(out, { recursive: true, force: true });

for (const file of ['background.js', 'content.js', 'icons/icon16.png', 'icons/icon32.png', 'icons/icon48.png', 'icons/icon128.png']) {
  copy(`extension/${file}`, file);
}
copy('extension/host.js', 'src/host.js');
copy('src/renderer.js', 'src/renderer.js');
copy('src/style.css', 'src/style.css');
// Same relative paths as in the desktop app, so renderer.js loads them unchanged.
copy('node_modules/roughjs/bundled/rough.js', 'node_modules/roughjs/bundled/rough.js');
copy('node_modules/perfect-freehand/dist/esm/index.mjs', 'node_modules/perfect-freehand/dist/esm/index.mjs');

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'extension', 'manifest.json'), 'utf8'));
manifest.version = pkg.version;
fs.writeFileSync(path.join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

// The overlay page is the desktop one with the extension's bridge loaded first. Inside a web page it must
// not declare a color scheme, or Chrome paints an opaque background behind the frame.
let html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
const bridge = '<script src="host.js"></script>\n  <script src="renderer.js"></script>';
if (!html.includes('<script src="renderer.js"></script>')) throw new Error('index.html no longer loads renderer.js');
html = html
  .replace('<script src="renderer.js"></script>', bridge)
  .replace('</head>', '  <style>:root, :root[data-theme] { color-scheme: normal !important; } html, body { background: transparent; }</style>\n</head>');
fs.writeFileSync(path.join(out, 'src', 'overlay.html'), html);

// --- zip (stored with deflate, no dependencies) ---

function zip(dir, target) {
  const files = [];
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push(full);
    }
  };
  walk(dir);

  const local = [];
  const central = [];
  let offset = 0;
  for (const full of files.sort()) {
    const name = Buffer.from(path.relative(dir, full).split(path.sep).join('/'));
    const data = fs.readFileSync(full);
    const packed = zlib.deflateRawSync(data, { level: 9 });
    const crc = zlib.crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(8, 8); // deflate
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(packed.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(name.length, 26);
    local.push(header, name, packed);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(packed.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, name);
    offset += header.length + name.length + packed.length;
  }
  const centralSize = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  fs.writeFileSync(target, Buffer.concat([...local, ...central, end]));
  return files.length;
}

const target = path.join(root, 'dist', 'Drawzy-chrome.zip');
const count = zip(out, target);
console.log(`Built ${path.relative(root, out)} (${count} files) and ${path.relative(root, target)} (v${pkg.version})`);
