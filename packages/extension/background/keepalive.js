// Keepalive — persists polling state across service worker restarts
// Uses chrome.alarms for wake-up and chrome.storage.session for state

const ALARM_NAME = "maisie-bridge-poll";
const STATE_KEY = "bridgeState";

const DEFAULT_STATE = {
  enabled: false,
  since: null,
  bridgeUrl: "http://localhost:3001",
  commandsExecuted: 0,
  lastPollTime: null,
  lastError: null,
};

export async function getState() {
  const result = await chrome.storage.session.get(STATE_KEY);
  return result[STATE_KEY] || { ...DEFAULT_STATE };
}

export async function setState(partial) {
  const current = await getState();
  await chrome.storage.session.set({ [STATE_KEY]: { ...current, ...partial } });
}

export async function startPolling(pollFn) {
  await setState({ enabled: true, since: new Date().toISOString() });
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 0.5 });
  pollFn();
  scheduleFastPoll(pollFn);
}

export async function stopPolling() {
  await setState({ enabled: false });
  chrome.alarms.clear(ALARM_NAME);
}

export function setupAlarmListener(pollFn) {
  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== ALARM_NAME) return;
    const state = await getState();
    if (!state.enabled) return;
    pollFn();
    scheduleFastPoll(pollFn);
  });
}

function scheduleFastPoll(pollFn, intervalMs = 2500) {
  setTimeout(async () => {
    const state = await getState();
    if (!state.enabled) return;
    await pollFn();
    scheduleFastPoll(pollFn, intervalMs);
  }, intervalMs);
}
