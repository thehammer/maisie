// Page script — injected into MAIN world for console capture + network interception
// Communicates with content script via window.postMessage

(function () {
  // --- Console capture ---
  const consoleBuffer = [];
  const MAX_BUFFER = 200;
  const origConsole = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    info: console.info.bind(console),
  };

  for (const level of ["log", "warn", "error", "info"]) {
    console[level] = function (...args) {
      origConsole[level](...args);
      consoleBuffer.push({
        level,
        text: args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "),
        time: new Date().toISOString(),
      });
      if (consoleBuffer.length > MAX_BUFFER) consoleBuffer.shift();
    };
  }

  // --- Network interception (fetch + XMLHttpRequest) ---
  const networkBuffer = [];
  const MAX_NETWORK = 500;

  function truncate(str, max) {
    if (typeof str !== "string") return str;
    return str.length > max ? str.slice(0, max) + `...[${str.length} chars]` : str;
  }

  function pushNetwork(entry) {
    networkBuffer.push(entry);
    if (networkBuffer.length > MAX_NETWORK) networkBuffer.shift();
  }

  // Intercept fetch()
  const origFetch = window.fetch;
  window.fetch = async function (input, init) {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input?.url || String(input);
    const method = init?.method || (input instanceof Request ? input.method : "GET");
    const reqHeaders = {};
    const headerSource = init?.headers || (input instanceof Request ? input.headers : null);
    if (headerSource) {
      const entries = headerSource instanceof Headers ? headerSource : new Headers(headerSource);
      entries.forEach((v, k) => { reqHeaders[k] = v; });
    }

    let reqBody = null;
    if (init?.body) {
      try {
        reqBody = typeof init.body === "string" ? truncate(init.body, 2000) : `[${init.body.constructor?.name || "body"}]`;
      } catch { reqBody = "[unreadable]"; }
    }

    const startTime = Date.now();
    const entry = {
      type: "fetch",
      url,
      method: method.toUpperCase(),
      requestHeaders: reqHeaders,
      requestBody: reqBody,
      startTime: new Date().toISOString(),
      status: null,
      responseHeaders: {},
      responseBody: null,
      duration: null,
      error: null,
    };

    try {
      const response = await origFetch.call(window, input, init);
      entry.status = response.status;
      entry.duration = Date.now() - startTime;
      response.headers.forEach((v, k) => { entry.responseHeaders[k] = v; });

      // Clone to read body without consuming the original
      const clone = response.clone();
      try {
        const text = await clone.text();
        entry.responseBody = truncate(text, 4000);
      } catch { entry.responseBody = "[unreadable]"; }

      pushNetwork(entry);
      return response;
    } catch (err) {
      entry.error = String(err);
      entry.duration = Date.now() - startTime;
      pushNetwork(entry);
      throw err;
    }
  };

  // Intercept XMLHttpRequest
  const origXHROpen = XMLHttpRequest.prototype.open;
  const origXHRSend = XMLHttpRequest.prototype.send;
  const origXHRSetHeader = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._maisie = {
      type: "xhr",
      method: method.toUpperCase(),
      url: typeof url === "string" ? url : String(url),
      requestHeaders: {},
      requestBody: null,
      startTime: null,
      status: null,
      responseHeaders: {},
      responseBody: null,
      duration: null,
      error: null,
    };
    return origXHROpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (this._maisie) this._maisie.requestHeaders[name] = value;
    return origXHRSetHeader.call(this, name, value);
  };

  XMLHttpRequest.prototype.send = function (body) {
    if (this._maisie) {
      this._maisie.startTime = new Date().toISOString();
      if (body) {
        try {
          this._maisie.requestBody = typeof body === "string" ? truncate(body, 2000) : `[${body.constructor?.name || "body"}]`;
        } catch { this._maisie.requestBody = "[unreadable]"; }
      }

      const startMs = Date.now();
      this.addEventListener("loadend", () => {
        if (!this._maisie) return;
        const entry = this._maisie;
        entry.status = this.status;
        entry.duration = Date.now() - startMs;
        try {
          const raw = this.getAllResponseHeaders();
          raw.split("\r\n").forEach((line) => {
            const idx = line.indexOf(":");
            if (idx > 0) entry.responseHeaders[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
          });
        } catch {}
        try {
          entry.responseBody = truncate(this.responseText, 4000);
        } catch { entry.responseBody = "[unreadable]"; }
        pushNetwork(entry);
      });

      this.addEventListener("error", () => {
        if (!this._maisie) return;
        this._maisie.error = "Network error";
        this._maisie.duration = Date.now() - startMs;
        pushNetwork(this._maisie);
      });
    }
    return origXHRSend.call(this, body);
  };

  // --- Message handler ---
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;

    if (event.data?.type === "MAISIE_BRIDGE_READ_CONSOLE") {
      const entries = [...consoleBuffer];
      consoleBuffer.length = 0;
      window.postMessage({ type: "MAISIE_BRIDGE_CONSOLE_RESULT", entries }, "*");
    }

    if (event.data?.type === "MAISIE_BRIDGE_READ_NETWORK") {
      const entries = [...networkBuffer];
      networkBuffer.length = 0;
      window.postMessage({ type: "MAISIE_BRIDGE_NETWORK_RESULT", entries }, "*");
    }
  });
})();
