// Runs in the page you're drawing on. It adds one full-window frame that holds the drawing app and switches
// it between "drawing" (takes the mouse) and "not drawing" (clicks pass through to the page).
// The background worker injects it again on every shortcut press, so it only sets itself up once.

if (!window.__drawzy) {
  window.__drawzy = true;

  let frame = null;
  let ready = false;
  let drawing = false;
  let visible = true;
  const pending = [];

  // Messages to the frame go through the extension, not the page, so the page can't read or fake them.
  const tell = (message) => {
    if (ready) chrome.runtime.sendMessage({ ...message, to: 'overlay' }).catch(() => {});
    else pending.push(message);
  };

  function createFrame() {
    frame = document.createElement('iframe');
    const page = location.origin + location.pathname;
    frame.src = `${chrome.runtime.getURL('src/overlay.html')}#${encodeURIComponent(page)}`;
    frame.allow = 'clipboard-read; clipboard-write';
    frame.setAttribute('aria-label', 'Drawzy drawing layer');
    const style = {
      all: 'initial',
      position: 'fixed',
      inset: '0',
      width: '100vw',
      height: '100vh',
      border: '0',
      margin: '0',
      padding: '0',
      background: 'transparent',
      'color-scheme': 'normal',
      'z-index': '2147483647',
      'pointer-events': 'none',
    };
    for (const [k, v] of Object.entries(style)) frame.style.setProperty(k, v, 'important');
    document.documentElement.appendChild(frame);
  }

  function setDrawing(on) {
    drawing = on;
    if (on) setVisible(true);
    frame.style.setProperty('pointer-events', on ? 'auto' : 'none', 'important');
    if (on) frame.focus();
    else frame.blur();
    tell({ type: 'mode', on });
  }

  function setVisible(on) {
    visible = on;
    tell({ type: 'visible', on });
  }

  chrome.runtime.onMessage.addListener((message, sender) => {
    if (sender.id !== chrome.runtime.id) return;
    if (message.type === 'toggle-draw') {
      if (!frame) createFrame();
      setDrawing(!drawing);
    } else if (message.type === 'toggle-visible') {
      if (frame) setVisible(!visible);
    } else if (message.type === 'ready') {
      ready = true;
      pending.splice(0).forEach(tell);
    } else if (message.type === 'exit-draw') {
      setDrawing(false);
    } else if (message.type === 'set-visible') {
      setVisible(message.on);
    }
  });
}
