// @ts-nocheck
/*
 * Ablix extension runtime. This file runs INSIDE the extension Worker.
 * It is plain JavaScript (no imports) on purpose: the same source text is
 * embedded into the sandboxed worker at runtime (via ?raw), and it is also
 * imported directly by the Node test-suite. Keep `export` at line start so
 * the embedder can strip it.
 *
 * Protocol (postMessage, structured-clone data only):
 *   host -> worker : init | invoke | callResult | event | deactivate | ping
 *   worker -> host : register | unregister | update | call | invokeResult |
 *                    activated | activate-error | deactivated | log | pong
 */

export function lockDownGlobals(scope, permissions) {
  const perms = permissions || [];
  const names = ["Worker", "SharedWorker", "importScripts", "BroadcastChannel", "indexedDB", "caches"];
  if (perms.indexOf("network") === -1) {
    names.push("fetch", "XMLHttpRequest", "WebSocket", "EventSource", "WebTransport");
  }
  for (const name of names) {
    try {
      Object.defineProperty(scope, name, { value: undefined, configurable: false, writable: false });
    } catch (e) {
      try { scope[name] = undefined; } catch (e2) { /* ignore */ }
    }
  }
}

export function createExtensionRuntime(post, opts) {
  const options = opts || {};
  const API_VERSION = "1.0.0";
  let ext = null;
  let files = {};
  let mod = null;
  let settings = {};
  const defaults = {};
  const settingListeners = new Set();
  const handlers = new Map(); // "kind:id" -> function
  const pending = new Map(); // call id -> {resolve, reject}
  const moduleCache = {};
  let seq = 0;
  const nextId = () => ++seq;

  function call(method, args) {
    return new Promise((resolve, reject) => {
      const id = nextId();
      pending.set(id, { resolve, reject });
      post({ t: "call", id, method, args });
    });
  }

  function register(kind, id, data, handler) {
    if (handler) handlers.set(kind + ":" + id, handler);
    post({ t: "register", kind, id, data });
    return {
      dispose() {
        handlers.delete(kind + ":" + id);
        post({ t: "unregister", kind, id });
      },
    };
  }

  function needFn(fn, what) {
    if (typeof fn !== "function") throw new TypeError(what + " must be a function");
  }

  const api = {
    version: API_VERSION,
    commands: {
      register(id, handler, meta) {
        needFn(handler, "command handler");
        const m = meta || {};
        return register("command", String(id), { id: String(id), title: m.title || String(id), category: m.category }, handler);
      },
      execute(id, ...args) {
        return call("commands.execute", [String(id), args]);
      },
    },
    window: {
      showMessage(text, level) {
        return call("window.showMessage", [String(text), level || "info"]);
      },
      showQuickPick(items, options) {
        return call("window.showQuickPick", [items, options || {}]);
      },
      showInputBox(options) {
        return call("window.showInputBox", [options || {}]);
      },
    },
    menus: {
      register(menu) {
        return register("menu", "menu" + nextId(), menu);
      },
    },
    keybindings: {
      register(binding) {
        return register("keybinding", "key" + nextId(), binding);
      },
    },
    languages: {
      register(language) {
        return register("language", String(language.id), language);
      },
    },
    completions: {
      register(selector, provider) {
        needFn(provider && provider.provideCompletions, "provider.provideCompletions");
        const id = "completion" + nextId();
        return register("completion", id, { languages: selector.languages, title: selector.title }, (req) =>
          provider.provideCompletions(req.doc, req.offset)
        );
      },
    },
    diagnostics: {
      register(selector, provider) {
        needFn(provider && provider.provideDiagnostics, "provider.provideDiagnostics");
        const id = "diagnostics" + nextId();
        return register("diagnostics", id, { languages: selector.languages, title: selector.title }, (req) =>
          provider.provideDiagnostics(req.doc)
        );
      },
    },
    formatters: {
      register(selector, provider) {
        needFn(provider && provider.formatDocument, "provider.formatDocument");
        const id = "formatter" + nextId();
        return register("formatter", id, { languages: selector.languages, title: selector.title }, (req) =>
          provider.formatDocument(req.doc)
        );
      },
    },
    snippets: {
      register(language, list) {
        return register("snippets", "snip" + nextId(), { language: String(language), snippets: list });
      },
    },
    themes: {
      register(theme) {
        return register("theme", String(theme.id), theme);
      },
    },
    settings: {
      register(list) {
        for (const s of list) defaults[s.key] = s.default;
        return register("settings", "settings" + nextId(), { settings: list });
      },
      get(key) {
        return key in settings ? settings[key] : defaults[key];
      },
      set(key, value) {
        settings[key] = value;
        return call("settings.set", [String(key), value]);
      },
      onDidChange(cb) {
        needFn(cb, "settings listener");
        settingListeners.add(cb);
        return { dispose: () => settingListeners.delete(cb) };
      },
    },
    panels: {
      register(panel) {
        const reg = register("panel", String(panel.id), { id: String(panel.id), title: panel.title, icon: panel.icon });
        return {
          setContent(node) {
            post({ t: "update", kind: "panel", id: String(panel.id), data: node });
          },
          dispose: reg.dispose,
        };
      },
      setContent(id, node) {
        post({ t: "update", kind: "panel", id: String(id), data: node });
      },
    },
    statusBar: {
      create(item) {
        let current = Object.assign({ alignment: "left", priority: 0 }, item);
        const id = String(current.id || "status" + nextId());
        current.id = id;
        const reg = register("status", id, current);
        return {
          update(patch) {
            current = Object.assign({}, current, patch, { id });
            post({ t: "update", kind: "status", id, data: current });
          },
          dispose: reg.dispose,
        };
      },
    },
    editor: {
      getActiveDocument: () => call("editor.getActiveDocument", []),
      replaceContent: (text) => call("editor.replaceContent", [String(text)]),
      replaceSelection: (text) => call("editor.replaceSelection", [String(text)]),
      insertText: (text) => call("editor.insertText", [String(text)]),
    },
    workspace: {
      readFile: (path) => call("workspace.readFile", [String(path)]),
      writeFile: (path, content) => call("workspace.writeFile", [String(path), String(content)]),
      listFiles: () => call("workspace.listFiles", []),
    },
  };

  const fmt = (args) =>
    args
      .map((a) => {
        if (typeof a === "string") return a;
        try { return JSON.stringify(a); } catch (e) { return String(a); }
      })
      .join(" ");
  const sandboxConsole = {};
  for (const level of ["log", "info", "warn", "error"]) {
    sandboxConsole[level] = (...a) => post({ t: "log", level, text: fmt(a) });
  }

  /* ---------- tiny CommonJS loader for files inside the package ---------- */
  function dirOf(p) {
    const i = p.lastIndexOf("/");
    return i === -1 ? "" : p.slice(0, i);
  }
  function normalize(p) {
    const out = [];
    for (const part of p.split("/")) {
      if (part === "" || part === ".") continue;
      if (part === "..") out.pop();
      else out.push(part);
    }
    return out.join("/");
  }
  function resolvePath(fromDir, spec) {
    const base = normalize(spec.startsWith(".") ? (fromDir ? fromDir + "/" : "") + spec : spec);
    for (const c of [base, base + ".js", base + ".json", base + "/index.js"]) {
      if (Object.prototype.hasOwnProperty.call(files, c)) return c;
    }
    throw new Error("Cannot find module '" + spec + "'");
  }
  function makeRequire(fromDir) {
    return (spec) => loadModule(resolvePath(fromDir, String(spec)));
  }
  function loadModule(path) {
    if (moduleCache[path]) return moduleCache[path].exports;
    const module = { exports: {} };
    moduleCache[path] = module;
    if (/\.json$/i.test(path)) {
      module.exports = JSON.parse(files[path]);
      return module.exports;
    }
    const fn = new Function("module", "exports", "require", "ablix", "console", files[path] + "\n//# sourceURL=ablix-ext/" + path);
    fn(module, module.exports, makeRequire(dirOf(path)), api, sandboxConsole);
    return module.exports;
  }

  const toCloneable = (v) => {
    if (v === undefined) return undefined;
    try { return JSON.parse(JSON.stringify(v)); } catch (e) { return undefined; }
  };

  async function handleInit(m) {
    ext = m.ext;
    files = ext.files;
    settings = m.settings || {};
    try {
      if (options.lockDown) options.lockDown(ext.manifest.permissions || []);
      mod = loadModule(ext.manifest.main);
      if (mod && typeof mod.activate === "function") await mod.activate(api);
      post({ t: "activated" });
    } catch (e) {
      post({ t: "activate-error", error: String((e && e.stack) || e) });
    }
  }

  async function handleInvoke(m) {
    try {
      const fn = handlers.get(m.kind + ":" + m.target);
      if (!fn) throw new Error("No " + m.kind + " handler registered for '" + m.target + "'");
      const value = m.kind === "command" ? await fn(...(m.args || [])) : await fn(m.args);
      post({ t: "invokeResult", id: m.id, ok: true, value: toCloneable(value) });
    } catch (e) {
      post({ t: "invokeResult", id: m.id, ok: false, error: String((e && e.message) || e) });
    }
  }

  async function handleDeactivate() {
    try {
      if (mod && typeof mod.deactivate === "function") await mod.deactivate();
    } catch (e) {
      post({ t: "log", level: "error", text: "deactivate() threw: " + String((e && e.message) || e) });
    }
    post({ t: "deactivated" });
  }

  return {
    handle(m) {
      if (!m || typeof m !== "object") return;
      switch (m.t) {
        case "init": return handleInit(m);
        case "invoke": return handleInvoke(m);
        case "deactivate": return handleDeactivate();
        case "ping": post({ t: "pong" }); return;
        case "callResult": {
          const p = pending.get(m.id);
          if (!p) return;
          pending.delete(m.id);
          if (m.ok) p.resolve(m.value);
          else p.reject(new Error(m.error || "Host call failed"));
          return;
        }
        case "event":
          if (m.name === "settingsChanged") {
            settings[m.data.key] = m.data.value;
            for (const cb of settingListeners) {
              try { cb(m.data.key, m.data.value); } catch (e) { /* listener errors are the extension's problem */ }
            }
          }
          return;
      }
    },
  };
}
