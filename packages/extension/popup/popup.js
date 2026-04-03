const STATE_KEY = "bridgeState";
const statusEl = document.getElementById("status");
const bridgeUrlEl = document.getElementById("bridgeUrl");
const commandCountEl = document.getElementById("commandCount");
const lastPollEl = document.getElementById("lastPoll");
const toggleBtn = document.getElementById("toggleBtn");
const resetBtn = document.getElementById("resetBtn");
const errorEl = document.getElementById("error");

async function getState() {
  const result = await chrome.storage.session.get(STATE_KEY);
  return result[STATE_KEY] || { enabled: false, bridgeUrl: "http://localhost:3001", commandsExecuted: 0 };
}

async function updateUI() {
  const state = await getState();
  bridgeUrlEl.value = state.bridgeUrl || "http://localhost:3001";
  commandCountEl.textContent = state.commandsExecuted || 0;

  if (state.lastPollTime) {
    const ago = Math.round((Date.now() - new Date(state.lastPollTime).getTime()) / 1000);
    lastPollEl.textContent = ago < 60 ? `${ago}s ago` : `${Math.round(ago / 60)}m ago`;
  } else {
    lastPollEl.textContent = "-";
  }

  if (state.enabled) {
    statusEl.textContent = "Polling";
    statusEl.className = "status polling";
    toggleBtn.textContent = "Stop";
  } else {
    statusEl.textContent = "Stopped";
    statusEl.className = "status disconnected";
    toggleBtn.textContent = "Start";
  }

  if (state.lastError) {
    errorEl.textContent = state.lastError;
    errorEl.hidden = false;
  } else {
    errorEl.hidden = true;
  }
}

toggleBtn.addEventListener("click", async () => {
  const state = await getState();
  if (state.enabled) {
    chrome.runtime.sendMessage({ type: "STOP_POLLING" });
  } else {
    // Save URL before starting
    const url = bridgeUrlEl.value.trim();
    await chrome.storage.session.set({ [STATE_KEY]: { ...state, bridgeUrl: url, lastError: null } });
    chrome.runtime.sendMessage({ type: "START_POLLING" });
  }
  setTimeout(updateUI, 300);
});

resetBtn.addEventListener("click", async () => {
  chrome.runtime.sendMessage({ type: "RESET_BRIDGE" });
  setTimeout(updateUI, 500);
});

bridgeUrlEl.addEventListener("change", async () => {
  const state = await getState();
  await chrome.storage.session.set({ [STATE_KEY]: { ...state, bridgeUrl: bridgeUrlEl.value.trim() } });
});

// Refresh UI periodically while popup is open
updateUI();
setInterval(updateUI, 2000);
