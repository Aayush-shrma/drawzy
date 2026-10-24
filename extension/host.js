// The Chrome extension's stand-in for the desktop app's preload bridge (src/preload.js). The drawing engine
// (renderer.js) talks only to window.overlay, so with this in place it runs unchanged inside a web page.

(() => {
  const listeners = { mode: [], visible: [], command: [] };
  let tabId = null;
  const toPage = [];

  // Talk to content.js in this tab through the extension, out of the page's reach.
  const tellPage = (message) => {
    if (tabId === null) return toPage.push(message);
    chrome.tabs.sendMessage(tabId, message, { frameId: 0 }).catch(() => {});
  };

  // Say hello once the drawing engine below has loaded and registered its listeners.
  const loaded = new Promise((resolve) => window.addEventListener('load', resolve));
  Promise.all([chrome.tabs.getCurrent(), loaded]).then(([tab]) => {
    tabId = tab.id;
    toPage.splice(0).forEach(tellPage);
  });

  chrome.runtime.onMessage.addListener((message, sender) => {
    if (message.to !== 'overlay' || sender.tab?.id !== tabId) return;
    if (message.type === 'mode') listeners.mode.forEach((cb) => cb(message.on));
    if (message.type === 'visible') listeners.visible.forEach((cb) => cb(message.on));
  });

  const ua = navigator.userAgentData?.platform || navigator.platform;
  const platform = /mac/i.test(ua) ? 'darwin' : /win/i.test(ua) ? 'win32' : 'linux';

  // Decoded by hand: the overlay's content security policy doesn't allow fetch() on data: URLs.
  function dataURLToBlob(dataURL) {
    const [head, body] = dataURL.split(',');
    const bytes = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
    return new Blob([bytes], { type: head.slice(5).split(';')[0] });
  }

  function download(name, blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    return `Downloads/${name}`;
  }

  function pickFile(filters, asDataURL) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = filters.flatMap((f) => f.extensions.map((e) => `.${e}`)).join(',');
      input.addEventListener('cancel', () => resolve(null));
      input.addEventListener('change', () => {
        const file = input.files[0];
        if (!file) return resolve(null);
        const reader = new FileReader();
        reader.onload = () => resolve({ name: file.name, data: reader.result });
        if (asDataURL) reader.readAsDataURL(file);
        else reader.readAsText(file);
      });
      input.click();
    });
  }

  const blobToDataURL = (blob) =>
    new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });

  window.overlay = {
    host: 'browser',
    platform,
    // One drawing per page, so notes on one site don't show up on another.
    drawingKey: `drawzy.drawing:${decodeURIComponent(location.hash.slice(1))}`,
    onMode: (cb) => listeners.mode.push(cb),
    onVisible: (cb) => listeners.visible.push(cb),
    onCommand: (cb) => listeners.command.push(cb),
    exitDraw: () => tellPage({ type: 'exit-draw' }),
    setVisible: (on) => tellPage({ type: 'set-visible', on }),
    quit: () => {},
    getOpenAtLogin: async () => false,
    setOpenAtLogin: async () => {},

    async screenshot() {
      const { dataURL, error } = await chrome.runtime.sendMessage({ type: 'capture' });
      if (error) throw new Error(error);
      const blob = dataURLToBlob(dataURL);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]).catch(() => {});
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      return download(`drawzy-${stamp}.png`, blob);
    },

    async saveFile({ name, data, base64 }) {
      const blob = base64
        ? dataURLToBlob(`data:image/png;base64,${data}`)
        : new Blob([data], { type: 'application/json' });
      return download(name, blob);
    },

    openFile: ({ filters, asDataURL }) => pickFile(filters, asDataURL),

    async copyImage(dataURL) {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': dataURLToBlob(dataURL) })]);
    },

    async readClipboard() {
      try {
        for (const item of await navigator.clipboard.read()) {
          const type = item.types.find((t) => t.startsWith('image/'));
          if (type) return { image: await blobToDataURL(await item.getType(type)) };
        }
        return { text: await navigator.clipboard.readText() };
      } catch {
        return { text: '' };
      }
    },

    writeClipboardText: (text) => navigator.clipboard.writeText(text),
  };

  tellPage({ type: 'ready' });
})();
