const REACHABILITY_TIMEOUT_MS = 2000;

chrome.action.onClicked.addListener(async () => {
  const { yotramUrl } = await chrome.storage.local.get('yotramUrl');
  if (!yotramUrl) {
    await chrome.runtime.openOptionsPage();
    return;
  }

  const existingTabs = await chrome.tabs.query({});
  const openTab = existingTabs.find((tab) => tab.url && tab.url.startsWith(yotramUrl));
  if (openTab) {
    await chrome.tabs.update(openTab.id, { active: true });
    await chrome.windows.update(openTab.windowId, { focused: true });
    return;
  }

  const reachable = await isReachable(yotramUrl);
  if (reachable) {
    await chrome.tabs.create({ url: yotramUrl });
  } else {
    await chrome.tabs.create({ url: chrome.runtime.getURL('not-running.html') });
  }
});

async function isReachable(url) {
  try {
    await fetch(url, { method: 'GET', signal: AbortSignal.timeout(REACHABILITY_TIMEOUT_MS) });
    return true;
  } catch {
    return false;
  }
}
