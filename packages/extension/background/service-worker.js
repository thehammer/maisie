// Maisie Bridge service worker — polls bridge API, dispatches commands
import { fetchMessages, resetBridge } from "./bridge-client.js";
import { getState, setState, startPolling, stopPolling, setupAlarmListener } from "./keepalive.js";
import { executeCommand, setupNetworkMonitoring } from "./command-handlers.js";

// Initialize network monitoring
setupNetworkMonitoring();

// Poll the bridge API for new commands
async function poll() {
  try {
    const state = await getState();
    if (!state.enabled) return;

    const messages = await fetchMessages(state.since);
    let newSince = state.since;

    for (const msg of messages) {
      newSince = msg.timestamp;
      if (msg.from === "code" && msg.command) {
        await executeCommand(msg.command);
        await setState({
          commandsExecuted: (state.commandsExecuted || 0) + 1,
        });
      }
    }

    await setState({
      since: newSince,
      lastPollTime: new Date().toISOString(),
      lastError: null,
    });
  } catch (err) {
    await setState({ lastError: String(err) });
  }
}

// Set up alarm-based keepalive
setupAlarmListener(poll);

// Handle messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "START_POLLING") {
    startPolling(poll);
    sendResponse({ ok: true });
  } else if (message.type === "STOP_POLLING") {
    stopPolling();
    sendResponse({ ok: true });
  } else if (message.type === "RESET_BRIDGE") {
    resetBridge();
    sendResponse({ ok: true });
  }
  return true; // keep message channel open for async
});

// Auto-start polling if previously enabled (service worker restart)
(async () => {
  const state = await getState();
  if (state.enabled) {
    chrome.alarms.create("maisie-bridge-poll", { periodInMinutes: 0.5 });
    startPolling(poll);
  }
})();
