// Drawzy's background worker. It only touches a tab when you press the shortcut or click the toolbar icon
// (the activeTab permission), so the extension never needs access to every site.

async function send(tab, message) {
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    await chrome.tabs.sendMessage(tab.id, message, { frameId: 0 });
  } catch {
    // Chrome doesn't let extensions draw on its own pages (chrome://, the Web Store, the new tab page).
    await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#e03131' });
    await chrome.action.setBadgeText({ tabId: tab.id, text: '!' });
    await chrome.action.setTitle({ tabId: tab.id, title: "Drawzy can't draw on this page. Chrome blocks extensions on its own pages." });
  }
}

const activeTab = async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0];

chrome.action.onClicked.addListener((tab) => send(tab, { type: 'toggle-draw' }));

chrome.commands.onCommand.addListener(async (command, tab) => {
  tab ??= await activeTab();
  if (tab) send(tab, { type: command });
});

// The overlay asks for "Screenshot with screen": capture what's visible in its tab.
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message.type !== 'capture' || !sender.tab) return false;
  chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' }).then(
    (dataURL) => reply({ dataURL }),
    (err) => reply({ error: err.message }),
  );
  return true;
});
