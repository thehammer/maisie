// Command handlers — maps BridgeCommandAction to implementation
// Service worker handles: tab mgmt, screenshots, evalJs, network, cookies
// Content script handles: DOM operations, localStorage

import { postResult } from "./bridge-client.js";

// Network request ring buffer
const networkLog = [];
const MAX_NETWORK_LOG = 500;

export function setupNetworkMonitoring() {
  chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
      networkLog.push({
        requestId: details.requestId,
        url: details.url,
        method: details.method,
        type: details.type,
        startTime: details.timeStamp,
        tabId: details.tabId,
      });
      if (networkLog.length > MAX_NETWORK_LOG) networkLog.shift();
    },
    { urls: ["<all_urls>"] }
  );

  chrome.webRequest.onCompleted.addListener(
    (details) => {
      const entry = networkLog.find((e) => e.requestId === details.requestId);
      if (entry) {
        entry.statusCode = details.statusCode;
        entry.endTime = details.timeStamp;
        entry.duration = details.timeStamp - entry.startTime;
      }
    },
    { urls: ["<all_urls>"] }
  );

  chrome.webRequest.onErrorOccurred.addListener(
    (details) => {
      const entry = networkLog.find((e) => e.requestId === details.requestId);
      if (entry) {
        entry.error = details.error;
        entry.endTime = details.timeStamp;
      }
    },
    { urls: ["<all_urls>"] }
  );
}

// Get the active tab
async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// Send command to content script and wait for response
function sendToContentScript(tabId, command) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, command, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

// Content-script-handled actions
const CONTENT_SCRIPT_ACTIONS = new Set([
  "readText", "readHtml", "click", "type", "waitFor",
  "scrollTo", "getAttribute", "getComputedStyle",
  "getLocalStorage", "setLocalStorage", "readConsole",
  "getNetworkDetails",
]);

export async function executeCommand(command) {
  const { action } = command;

  try {
    // Delegate to content script if appropriate
    if (CONTENT_SCRIPT_ACTIONS.has(action)) {
      const tab = await getActiveTab();
      if (!tab) throw new Error("No active tab");
      const result = await sendToContentScript(tab.id, command);
      if (result.success) {
        await postResult(action, true, result.data);
      } else {
        await postResult(action, false, undefined, result.error);
      }
      return;
    }

    // Service worker handles these directly
    switch (action) {
      case "navigate": {
        const tab = await getActiveTab();
        if (!tab) throw new Error("No active tab");
        await chrome.tabs.update(tab.id, { url: command.url });
        // Wait for page load
        await new Promise((resolve) => {
          const listener = (tabId, info) => {
            if (tabId === tab.id && info.status === "complete") {
              chrome.tabs.onUpdated.removeListener(listener);
              resolve();
            }
          };
          chrome.tabs.onUpdated.addListener(listener);
          setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }, command.timeout || 10000);
        });
        await postResult("navigate", true);
        break;
      }

      case "screenshot": {
        const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: "png" });
        await postResult("screenshot", true, dataUrl);
        break;
      }

      case "getTabs": {
        const tabs = await chrome.tabs.query({});
        const data = tabs.map((t) => ({
          id: t.id,
          url: t.url,
          title: t.title,
          active: t.active,
          windowId: t.windowId,
        }));
        await postResult("getTabs", true, data);
        break;
      }

      case "openTab": {
        const newTab = await chrome.tabs.create({ url: command.url, active: true });
        await postResult("openTab", true, { id: newTab.id, url: newTab.url });
        break;
      }

      case "closeTab": {
        await chrome.tabs.remove(command.tabId);
        await postResult("closeTab", true);
        break;
      }

      case "switchTab": {
        await chrome.tabs.update(command.tabId, { active: true });
        await postResult("switchTab", true);
        break;
      }

      case "evalJs": {
        const tab = await getActiveTab();
        if (!tab) throw new Error("No active tab");
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: "MAIN",
          func: (code) => {
            try { return { success: true, data: eval(code) }; }
            catch (e) { return { success: false, error: String(e) }; }
          },
          args: [command.code || ""],
        });
        const result = results[0]?.result;
        if (result?.success) {
          await postResult("evalJs", true, result.data);
        } else {
          await postResult("evalJs", false, undefined, result?.error || "evalJs failed");
        }
        break;
      }

      case "getPageInfo": {
        const tab = await getActiveTab();
        if (!tab) throw new Error("No active tab");
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => ({
            url: location.href,
            title: document.title,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
            readyState: document.readyState,
          }),
        });
        await postResult("getPageInfo", true, results[0]?.result);
        break;
      }

      case "getNetworkLog": {
        const entries = [...networkLog];
        networkLog.length = 0;
        await postResult("getNetworkLog", true, entries);
        break;
      }

      case "waitForNetworkIdle": {
        const timeout = command.timeout || 5000;
        const idleMs = 500;
        const start = Date.now();
        await new Promise((resolve) => {
          const check = () => {
            const inflight = networkLog.filter((e) => !e.endTime);
            if (inflight.length === 0) {
              setTimeout(() => {
                const stillInflight = networkLog.filter((e) => !e.endTime);
                if (stillInflight.length === 0) resolve();
                else if (Date.now() - start > timeout) resolve();
                else check();
              }, idleMs);
            } else if (Date.now() - start > timeout) {
              resolve();
            } else {
              setTimeout(check, 200);
            }
          };
          check();
        });
        const inflight = networkLog.filter((e) => !e.endTime).length;
        await postResult("waitForNetworkIdle", true, { idle: inflight === 0 });
        break;
      }

      case "getCookies": {
        const tab = await getActiveTab();
        if (!tab?.url) throw new Error("No active tab with URL");
        const cookies = await chrome.cookies.getAll({ url: tab.url });
        const data = cookies.map((c) => ({
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path,
          secure: c.secure,
          httpOnly: c.httpOnly,
          expirationDate: c.expirationDate,
        }));
        await postResult("getCookies", true, data);
        break;
      }

      default:
        await postResult(action, false, undefined, `Unknown action: ${action}`);
    }
  } catch (err) {
    await postResult(action, false, undefined, String(err));
  }
}
