// Content script — handles DOM commands from service worker
// Runs in isolated world, injects page-script.js for MAIN world access

// Inject page script for console capture
const script = document.createElement("script");
script.src = chrome.runtime.getURL("content/page-script.js");
(document.head || document.documentElement).appendChild(script);
script.onload = () => script.remove();

// Buffers — populated by page-script via postMessage
let pendingConsoleResolve = null;
let pendingNetworkResolve = null;

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  if (event.data?.type === "MAISIE_BRIDGE_CONSOLE_RESULT" && pendingConsoleResolve) {
    pendingConsoleResolve(event.data.entries);
    pendingConsoleResolve = null;
  }
  if (event.data?.type === "MAISIE_BRIDGE_NETWORK_RESULT" && pendingNetworkResolve) {
    pendingNetworkResolve(event.data.entries);
    pendingNetworkResolve = null;
  }
});

function getConsoleEntries() {
  return new Promise((resolve) => {
    pendingConsoleResolve = resolve;
    window.postMessage({ type: "MAISIE_BRIDGE_READ_CONSOLE" }, "*");
    setTimeout(() => {
      if (pendingConsoleResolve) {
        pendingConsoleResolve([]);
        pendingConsoleResolve = null;
      }
    }, 1000);
  });
}

function getNetworkEntries() {
  return new Promise((resolve) => {
    pendingNetworkResolve = resolve;
    window.postMessage({ type: "MAISIE_BRIDGE_READ_NETWORK" }, "*");
    setTimeout(() => {
      if (pendingNetworkResolve) {
        pendingNetworkResolve([]);
        pendingNetworkResolve = null;
      }
    }, 1000);
  });
}

// Handle commands from service worker
chrome.runtime.onMessage.addListener((command, sender, sendResponse) => {
  handleCommand(command).then(sendResponse);
  return true; // keep channel open for async response
});

async function handleCommand(cmd) {
  try {
    switch (cmd.action) {
      case "readText": {
        const el = cmd.selector ? document.querySelector(cmd.selector) : document.body;
        if (!el) return { success: false, error: `Element not found: ${cmd.selector}` };
        return { success: true, data: el.textContent || "" };
      }

      case "readHtml": {
        const el = cmd.selector ? document.querySelector(cmd.selector) : document.documentElement;
        if (!el) return { success: false, error: `Element not found: ${cmd.selector}` };
        return { success: true, data: el.outerHTML };
      }

      case "click": {
        const el = cmd.selector ? document.querySelector(cmd.selector) : null;
        if (!el) return { success: false, error: `Element not found: ${cmd.selector}` };
        el.click();
        return { success: true };
      }

      case "type": {
        const el = cmd.selector ? document.querySelector(cmd.selector) : null;
        if (!el) return { success: false, error: `Element not found: ${cmd.selector}` };
        el.focus();
        el.value = cmd.text || "";
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return { success: true };
      }

      case "waitFor": {
        const timeout = cmd.timeout || 5000;
        const found = await new Promise((resolve) => {
          if (document.querySelector(cmd.selector || "")) return resolve(true);
          const observer = new MutationObserver(() => {
            if (document.querySelector(cmd.selector || "")) {
              observer.disconnect();
              resolve(true);
            }
          });
          observer.observe(document.body, { childList: true, subtree: true });
          setTimeout(() => {
            observer.disconnect();
            resolve(false);
          }, timeout);
        });
        return { success: true, data: found };
      }

      case "scrollTo": {
        if (cmd.selector) {
          const el = document.querySelector(cmd.selector);
          if (!el) return { success: false, error: `Element not found: ${cmd.selector}` };
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        } else if (cmd.data && typeof cmd.data === "object") {
          window.scrollTo({ left: cmd.data.x || 0, top: cmd.data.y || 0, behavior: "smooth" });
        }
        return { success: true };
      }

      case "getAttribute": {
        const el = cmd.selector ? document.querySelector(cmd.selector) : null;
        if (!el) return { success: false, error: `Element not found: ${cmd.selector}` };
        return { success: true, data: el.getAttribute(cmd.attribute || "") };
      }

      case "getComputedStyle": {
        const el = cmd.selector ? document.querySelector(cmd.selector) : null;
        if (!el) return { success: false, error: `Element not found: ${cmd.selector}` };
        const style = window.getComputedStyle(el);
        return { success: true, data: style.getPropertyValue(cmd.property || "") };
      }

      case "getLocalStorage": {
        if (cmd.key) {
          return { success: true, data: localStorage.getItem(cmd.key) };
        }
        const entries = {};
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          entries[k] = localStorage.getItem(k);
        }
        return { success: true, data: entries };
      }

      case "setLocalStorage": {
        localStorage.setItem(cmd.key || "", cmd.value || "");
        return { success: true };
      }

      case "readConsole": {
        const entries = await getConsoleEntries();
        return { success: true, data: entries };
      }

      case "getNetworkDetails": {
        const entries = await getNetworkEntries();
        return { success: true, data: entries };
      }

      default:
        return { success: false, error: `Content script: unknown action ${cmd.action}` };
    }
  } catch (err) {
    return { success: false, error: String(err) };
  }
}
