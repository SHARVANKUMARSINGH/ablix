import {
  TOKEN_NAMES,
  type CommandContribution, type CompletionItem, type Diagnostic, type EditorDocument, type InstalledExtension,
  type KeybindingContribution, type LanguageContribution, type MenuContribution, type MenuLocation, type PanelContribution,
  type PanelNode, type Permission, type ProviderContribution, type QuickPickItem, type SettingContribution,
  type SnippetContribution, type SnippetDef, type StatusItem, type ThemeContribution, type TokenName, type TokenRule,
} from "../types";
import { normalizeKey, RESERVED_KEYS } from "../keys";

/* ------------------------------ public types ------------------------------ */

export interface WorkerLike {
  postMessage(message: unknown): void;
  terminate(): void;
  onmessage: ((e: { data: any }) => void) | null; // eslint-disable-line @typescript-eslint/no-explicit-any
  onerror: ((e: { message?: string }) => void) | null;
}
export type WorkerFactory = (permissions: Permission[]) => WorkerLike;

/** What the IDE gives the host so extensions can (with permission) touch the editor/project. */
export interface WorkspaceBridge {
  getActiveDocument(): EditorDocument | null;
  replaceContent(text: string): void;
  replaceSelection(text: string): void;
  insertText(text: string): void;
  readFile(path: string): string | null;
  writeFile(path: string, content: string): Promise<void>;
  listFiles(): string[];
}

export interface HostStorage {
  loadSettings(extId: string): Promise<Record<string, unknown>>;
  saveSettings(extId: string, values: Record<string, unknown>): Promise<void>;
  getPref(key: string): Promise<unknown>;
  setPref(key: string, value: unknown): Promise<void>;
}

export interface Toast { id: number; text: string; level: "info" | "warning" | "error"; extId?: string }
export interface QuickPickRequest { title?: string; placeholder?: string; items: QuickPickItem[]; resolve: (item: QuickPickItem | null) => void }
export interface InputRequest { title?: string; prompt?: string; placeholder?: string; value?: string; resolve: (value: string | null) => void }

export interface HostSnapshot {
  version: number;
  running: string[];
  errors: Record<string, string>;
  logs: Record<string, string[]>;
  commands: CommandContribution[];
  menus: MenuContribution[];
  keybindings: KeybindingContribution[];
  languages: LanguageContribution[];
  completions: ProviderContribution[];
  diagnostics: ProviderContribution[];
  formatters: ProviderContribution[];
  snippets: SnippetContribution[];
  themes: ThemeContribution[];
  settings: SettingContribution[];
  settingValues: Record<string, Record<string, unknown>>;
  panels: PanelContribution[];
  statusItems: StatusItem[];
  themeId: string | null;
  toasts: Toast[];
  quickPick: QuickPickRequest | null;
  inputBox: InputRequest | null;
}

type Kind =
  | "command" | "menu" | "keybinding" | "language" | "completion" | "diagnostics" | "formatter"
  | "snippets" | "theme" | "settings" | "panel" | "status";
const KINDS: Kind[] = [
  "command", "menu", "keybinding", "language", "completion", "diagnostics", "formatter",
  "snippets", "theme", "settings", "panel", "status",
];

interface Running {
  ext: InstalledExtension;
  worker: WorkerLike;
  perms: Set<string>;
  state: "starting" | "active" | "stopping";
  pending: Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>;
  seq: number;
  lastSeen: number;
  watchdog: ReturnType<typeof setInterval> | null;
  activation: { resolve: () => void; reject: (e: Error) => void } | null;
  stopped: (() => void) | null;
  settings: Record<string, unknown>;
}

/* ------------------------------ validation ------------------------------ */

const MAX_PER_KIND = 200;
const BUILTIN_LANGS = ["js", "ts", "jsx", "tsx", "html", "css", "json", "md", "py", "plain"];
const COLOR_RE = /^(#[0-9a-f]{3,8}|(?:rgb|hsl)a?\([\d\s.,%/a-z-]+\)|[a-z]{3,20})$/i;
export const THEME_COLOR_KEYS = [
  "accent", "surface", "surface2", "border", "text", "textDim", "danger", ...TOKEN_NAMES,
] as const;
export const HOST_WATCHDOG_MS = 5000;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, max: number): string | undefined => (typeof v === "string" && v.length > 0 ? v.slice(0, max) : undefined);
const strList = (v: unknown, max = 40): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0).slice(0, 40).map((x) => x.slice(0, max)) : [];
const ID_RE = /^[A-Za-z0-9_.:-]{1,100}$/;

function sanitizeNode(n: unknown, depth = 0): PanelNode | null {
  if (!isObj(n) || depth > 6) return null;
  switch (n.type) {
    case "text": case "heading": case "code": {
      const text = typeof n.text === "string" ? n.text.slice(0, 5000) : "";
      return { type: n.type, text };
    }
    case "divider": return { type: "divider" };
    case "button": {
      const command = str(n.command, 100);
      const label = str(n.label, 80);
      return command && label ? { type: "button", label, command, args: n.args } : null;
    }
    case "input": {
      const command = str(n.command, 100);
      return command
        ? { type: "input", command, placeholder: str(n.placeholder, 80), value: str(n.value, 500), submitLabel: str(n.submitLabel, 30) }
        : null;
    }
    case "list": {
      if (!Array.isArray(n.items)) return null;
      const items = n.items.slice(0, 100).flatMap((it) => {
        if (!isObj(it)) return [];
        const label = str(it.label, 200);
        return label ? [{ label, detail: str(it.detail, 200), command: str(it.command, 100), args: it.args }] : [];
      });
      return { type: "list", items };
    }
    case "row": case "column": {
      if (!Array.isArray(n.children)) return null;
      const children = n.children.slice(0, 100).map((c) => sanitizeNode(c, depth + 1)).filter((c): c is PanelNode => !!c);
      return { type: n.type, children };
    }
    default: return null;
  }
}

function sanitizeRules(v: unknown): TokenRule[] {
  if (!Array.isArray(v)) return [];
  const rules: TokenRule[] = [];
  for (const r of v.slice(0, 60)) {
    if (!isObj(r) || typeof r.pattern !== "string" || r.pattern.length > 300) continue;
    if (!TOKEN_NAMES.includes(r.token as TokenName)) continue;
    const flags = typeof r.flags === "string" ? r.flags.replace(/[^imsu]/g, "") : "";
    try {
      const re = new RegExp(r.pattern, flags);
      if (re.test("")) continue; // rules that match the empty string would never advance
    } catch { continue; }
    rules.push({ pattern: r.pattern, flags, token: r.token as TokenName });
  }
  return rules;
}

export function sanitizeCompletions(v: unknown): CompletionItem[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 200).flatMap((it) => {
    if (!isObj(it)) return [];
    const label = str(it.label, 120);
    if (!label) return [];
    return [{
      label, insertText: typeof it.insertText === "string" ? it.insertText.slice(0, 5000) : undefined,
      detail: str(it.detail, 120), kind: str(it.kind, 20), isSnippet: it.isSnippet === true,
    }];
  });
}

export function sanitizeDiagnostics(v: unknown): Diagnostic[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 500).flatMap((d) => {
    if (!isObj(d) || typeof d.line !== "number" || !Number.isFinite(d.line)) return [];
    const message = str(d.message, 300);
    if (!message) return [];
    const severity = d.severity === "warning" || d.severity === "info" ? d.severity : "error";
    const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? Math.max(1, Math.floor(x)) : undefined);
    return [{ line: Math.max(1, Math.floor(d.line)), column: num(d.column), endColumn: num(d.endColumn), message, severity, source: str(d.source, 40) }];
  });
}

const toCloneable = (v: unknown) => {
  if (v === undefined) return undefined;
  try { return JSON.parse(JSON.stringify(v)); } catch { return undefined; }
};
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const langMatch = (langs: string[], language: string) => langs.includes("*") || langs.includes(language);

/* ------------------------------ the host ------------------------------ */

export class ExtensionHost {
  private running = new Map<string, Running>();
  private contrib: Record<Kind, Map<string, unknown>> = Object.fromEntries(KINDS.map((k) => [k, new Map()])) as never;
  private panelContent = new Map<string, PanelNode | null>();
  private builtinCommands = new Map<string, { title: string; category?: string; run: (...args: unknown[]) => unknown }>();
  private errors: Record<string, string> = {};
  private logs: Record<string, string[]> = {};
  private settingValues: Record<string, Record<string, unknown>> = {};
  private listeners = new Set<() => void>();
  private toasts: Toast[] = [];
  private toastSeq = 0;
  private quickPick: QuickPickRequest | null = null;
  private inputBox: InputRequest | null = null;
  private themeId: string | null = null;
  private bridge: WorkspaceBridge | null = null;
  private version = 0;
  private snap: HostSnapshot;
  private disposed = false;

  private createWorker: WorkerFactory;
  private storage: HostStorage;

  constructor(createWorker: WorkerFactory, storage: HostStorage) {
    this.createWorker = createWorker;
    this.storage = storage;
    this.snap = this.build();
  }

  /* ---- subscription (React useSyncExternalStore) ---- */
  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getSnapshot = () => this.snap;
  private emit() {
    this.snap = this.build();
    this.listeners.forEach((l) => l());
  }

  private build(): HostSnapshot {
    const vals = <T>(k: Kind) => [...this.contrib[k].values()] as T[];
    const extCommands = vals<CommandContribution>("command");
    const builtin: CommandContribution[] = [...this.builtinCommands].map(([id, c]) => ({ extId: "ablix", id, title: c.title, category: c.category }));
    return {
      version: ++this.version,
      running: [...this.running].filter(([, r]) => r.state === "active").map(([id]) => id),
      errors: { ...this.errors },
      logs: Object.fromEntries(Object.entries(this.logs).map(([k, v]) => [k, [...v]])),
      commands: [...builtin, ...extCommands],
      menus: vals("menu"),
      keybindings: vals("keybinding"),
      languages: vals("language"),
      completions: vals("completion"),
      diagnostics: vals("diagnostics"),
      formatters: vals("formatter"),
      snippets: vals("snippets"),
      themes: vals("theme"),
      settings: vals<SettingContribution[]>("settings").flat(),
      settingValues: { ...this.settingValues },
      panels: vals<PanelContribution>("panel").map((p) => ({ ...p, content: this.panelContent.get(`${p.extId}::${p.id}`) ?? null })),
      statusItems: vals("status"),
      themeId: this.themeId,
      toasts: [...this.toasts],
      quickPick: this.quickPick,
      inputBox: this.inputBox,
    };
  }

  setBridge(b: WorkspaceBridge | null) { this.bridge = b; }

  /* ---- lifecycle ---- */
  async start(installed: InstalledExtension[]) {
    this.themeId = ((await this.storage.getPref("theme")) as string | null | undefined) ?? null;
    this.emit();
    await Promise.allSettled(installed.filter((e) => e.enabled).map((e) => this.activate(e)));
  }

  isRunning(id: string) { return this.running.get(id)?.state === "active"; }

  async activate(ext: InstalledExtension): Promise<void> {
    if (this.disposed || this.running.has(ext.id)) return;
    delete this.errors[ext.id];
    this.logs[ext.id] = [];
    const perms = ext.manifest.permissions ?? [];
    const worker = this.createWorker(perms);
    const rec: Running = {
      ext, worker, perms: new Set(perms), state: "starting", pending: new Map(), seq: 0,
      lastSeen: Date.now(), watchdog: null, activation: null, stopped: null, settings: {},
    };
    this.running.set(ext.id, rec);
    worker.onmessage = (e) => this.onMessage(rec, e.data);
    worker.onerror = (e) => this.fail(rec, e.message || "The extension crashed");

    const activation = new Promise<void>((resolve, reject) => { rec.activation = { resolve, reject }; });
    activation.catch(() => undefined);
    const timer = setTimeout(() => rec.activation?.reject(new Error("Activation timed out after 15 seconds")), 15000);
    try {
      rec.settings = await this.storage.loadSettings(ext.id);
      this.settingValues[ext.id] = { ...rec.settings };
      worker.postMessage({ t: "init", ext: { id: ext.id, manifest: ext.manifest, files: ext.files }, settings: rec.settings });
      await activation;
      rec.state = "active";
      this.emit();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.fail(rec, `Failed to activate: ${msg.split("\n")[0]}`);
      throw new Error(msg);
    } finally {
      clearTimeout(timer);
    }
  }

  async deactivate(id: string): Promise<void> {
    const rec = this.running.get(id);
    if (!rec) return;
    rec.state = "stopping";
    const done = new Promise<void>((r) => { rec.stopped = r; });
    rec.worker.postMessage({ t: "deactivate" });
    await Promise.race([done, sleep(1500)]);
    this.cleanup(rec);
    this.emit();
  }

  async restart(ext: InstalledExtension) {
    await this.deactivate(ext.id);
    await this.activate(ext);
  }

  dispose() {
    this.disposed = true;
    for (const rec of [...this.running.values()]) this.cleanup(rec);
    this.listeners.clear();
  }

  private fail(rec: Running, reason: string) {
    if (!this.running.has(rec.ext.id) && rec.state !== "starting") return;
    this.errors[rec.ext.id] = reason;
    this.pushToast(`${rec.ext.manifest.name}: ${reason}`, "error", rec.ext.id);
    this.cleanup(rec);
    this.emit();
  }

  private cleanup(rec: Running) {
    if (rec.watchdog) clearInterval(rec.watchdog);
    rec.watchdog = null;
    try { rec.worker.terminate(); } catch { /* already gone */ }
    for (const p of rec.pending.values()) p.reject(new Error("Extension stopped"));
    rec.pending.clear();
    rec.activation?.reject(new Error("Extension stopped"));
    rec.activation = null;
    rec.stopped?.();
    const prefix = `${rec.ext.id}::`;
    for (const kind of KINDS) for (const key of [...this.contrib[kind].keys()]) if (key.startsWith(prefix)) this.contrib[kind].delete(key);
    for (const key of [...this.panelContent.keys()]) if (key.startsWith(prefix)) this.panelContent.delete(key);
    if (this.running.get(rec.ext.id) === rec) this.running.delete(rec.ext.id);
    if (this.themeId && !this.contrib.theme.has(`${prefix}${this.themeId.split("::")[1] ?? ""}`) && this.themeId.startsWith(prefix)) {
      // The active theme belonged to this extension: keep the preference, but it stops applying (see activeTheme()).
    }
  }

  /* ---- worker messages ---- */
  private onMessage(rec: Running, m: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
    if (!m || typeof m !== "object") return;
    rec.lastSeen = Date.now();
    switch (m.t) {
      case "register": this.register(rec, m.kind, m.id, m.data); break;
      case "unregister": this.unregister(rec, m.kind, m.id); break;
      case "update": this.update(rec, m.kind, m.id, m.data); break;
      case "call":
        this.handleCall(rec, String(m.method), Array.isArray(m.args) ? m.args : [])
          .then((value) => rec.worker.postMessage({ t: "callResult", id: m.id, ok: true, value: toCloneable(value) }))
          .catch((err) => rec.worker.postMessage({ t: "callResult", id: m.id, ok: false, error: err instanceof Error ? err.message : String(err) }));
        break;
      case "invokeResult": {
        const p = rec.pending.get(m.id);
        if (!p) break;
        rec.pending.delete(m.id);
        if (m.ok) p.resolve(m.value);
        else p.reject(new Error(String(m.error)));
        break;
      }
      case "activated": rec.activation?.resolve(); rec.activation = null; break;
      case "activate-error": rec.activation?.reject(new Error(String(m.error))); rec.activation = null; break;
      case "deactivated": rec.stopped?.(); break;
      case "log": {
        const list = (this.logs[rec.ext.id] ??= []);
        list.push(`[${String(m.level)}] ${String(m.text).slice(0, 2000)}`);
        if (list.length > 100) list.shift();
        this.emit();
        break;
      }
    }
  }

  private key(rec: Running, id: string) { return `${rec.ext.id}::${id}`; }
  private count(kind: Kind, extId: string) {
    let n = 0;
    for (const k of this.contrib[kind].keys()) if (k.startsWith(`${extId}::`)) n++;
    return n;
  }
  private note(rec: Running, text: string) {
    const list = (this.logs[rec.ext.id] ??= []);
    list.push(`[host] ${text}`);
    if (list.length > 100) list.shift();
  }

  private register(rec: Running, kind: Kind, rawId: unknown, data: unknown) {
    if (!KINDS.includes(kind) || typeof rawId !== "string" || !isObj(data) && kind !== "settings") return;
    const extId = rec.ext.id;
    const id = rawId.slice(0, 100);
    if (this.count(kind, extId) >= MAX_PER_KIND) { this.note(rec, `Too many ${kind} registrations`); return; }
    const d = (data ?? {}) as Record<string, unknown>;
    let value: unknown = null;

    switch (kind) {
      case "command": {
        const cid = str(d.id, 100);
        if (!cid || !ID_RE.test(cid) || cid.startsWith("ablix.")) { this.note(rec, `Invalid command id "${String(d.id)}" (ids may not start with "ablix.")`); return; }
        const clash = [...this.contrib.command.values()].some((c) => (c as CommandContribution).id === cid && (c as CommandContribution).extId !== extId);
        if (clash || this.builtinCommands.has(cid)) { this.note(rec, `Command "${cid}" is already registered by another extension`); return; }
        value = { extId, id: cid, title: str(d.title, 100) ?? cid, category: str(d.category, 40) } satisfies CommandContribution;
        this.contrib.command.set(this.key(rec, cid), value);
        this.emit();
        return;
      }
      case "menu": {
        const location = d.location as MenuLocation;
        const command = str(d.command, 100);
        const title = str(d.title, 80);
        if ((location !== "explorer/context" && location !== "editor/context") || !command || !title) { this.note(rec, "Invalid menu contribution"); return; }
        value = { extId, location, command, title, languages: strList(d.languages) } satisfies MenuContribution;
        break;
      }
      case "keybinding": {
        const key = typeof d.key === "string" ? normalizeKey(d.key) : null;
        const command = str(d.command, 100);
        const parts = key ? key.split("+") : [];
        const usable = parts.slice(0, -1).some((m) => m === "ctrl" || m === "alt" || m === "meta") || /^f\d{1,2}$/.test(parts[parts.length - 1] ?? "");
        if (!key || !command || !usable || RESERVED_KEYS.has(key)) { this.note(rec, `Invalid or reserved keybinding "${String(d.key)}"`); return; }
        value = { extId, key, command, args: d.args } satisfies KeybindingContribution;
        break;
      }
      case "language": {
        const lid = str(d.id, 40);
        if (!lid || !/^[a-z0-9_-]+$/.test(lid) || BUILTIN_LANGS.includes(lid)) { this.note(rec, `Invalid language id "${String(d.id)}"`); return; }
        const exts = strList(d.extensions, 20).map((e) => (e.startsWith(".") ? e : `.${e}`).toLowerCase());
        value = { extId, id: lid, name: str(d.name, 60) ?? lid, extensions: exts, filenames: strList(d.filenames, 80), rules: sanitizeRules(d.rules) } satisfies LanguageContribution;
        break;
      }
      case "completion": case "diagnostics": case "formatter": {
        const languages = strList(d.languages);
        value = { extId, providerId: id, languages: languages.length ? languages : ["*"], title: str(d.title, 60) } satisfies ProviderContribution;
        break;
      }
      case "snippets": {
        const language = str(d.language, 40);
        if (!language || !Array.isArray(d.snippets)) return;
        const snippets = d.snippets.slice(0, 200).flatMap((s): SnippetDef[] => {
          if (!isObj(s)) return [];
          const prefix = str(s.prefix, 40);
          const body = typeof s.body === "string" ? s.body.slice(0, 5000) : Array.isArray(s.body) ? s.body.filter((x) => typeof x === "string").join("\n").slice(0, 5000) : "";
          return prefix && body ? [{ prefix, body, description: str(s.description, 100) }] : [];
        });
        value = { extId, language, snippets } satisfies SnippetContribution;
        break;
      }
      case "theme": {
        const tid = str(d.id, 60);
        if (!tid || !/^[A-Za-z0-9_.-]+$/.test(tid)) { this.note(rec, `Invalid theme id "${String(d.id)}"`); return; }
        const colors: Record<string, string> = {};
        if (isObj(d.colors)) for (const [k, v] of Object.entries(d.colors)) {
          if ((THEME_COLOR_KEYS as readonly string[]).includes(k) && typeof v === "string" && COLOR_RE.test(v)) colors[k] = v;
        }
        value = { extId, id: tid, name: str(d.name, 60) ?? tid, colors } satisfies ThemeContribution;
        this.contrib.theme.set(this.key(rec, tid), value);
        this.emit();
        return;
      }
      case "settings": {
        const list = isObj(data) && Array.isArray(data.settings) ? data.settings : [];
        const out: SettingContribution[] = [];
        for (const s of list.slice(0, 50)) {
          if (!isObj(s)) continue;
          const key = str(s.key, 60);
          const type = s.type;
          if (!key || !/^[A-Za-z0-9_.-]+$/.test(key) || !["boolean", "string", "number", "enum"].includes(type as string)) continue;
          const options = type === "enum" ? strList(s.options, 60) : undefined;
          const def = s.default;
          const okDefault =
            (type === "boolean" && typeof def === "boolean") || (type === "number" && typeof def === "number") ||
            (type === "string" && typeof def === "string") || (type === "enum" && typeof def === "string" && !!options?.includes(def));
          if (!okDefault) { this.note(rec, `Setting "${key}" has an invalid default`); continue; }
          out.push({ extId, key, title: str(s.title, 80) ?? key, type: type as SettingContribution["type"], default: def as never, description: str(s.description, 200), options });
        }
        value = out;
        break;
      }
      case "panel": {
        const pid = str(d.id, 60);
        const title = str(d.title, 40);
        if (!pid || !title) return;
        value = { extId, id: pid, title, icon: str(d.icon, 30), content: null } satisfies PanelContribution;
        this.contrib.panel.set(this.key(rec, pid), value);
        this.emit();
        return;
      }
      case "status": {
        const sid = str(d.id, 60);
        if (!sid) return;
        value = this.statusFrom(rec, sid, d);
        this.contrib.status.set(this.key(rec, sid), value);
        this.emit();
        return;
      }
    }
    this.contrib[kind].set(this.key(rec, id), value);
    this.emit();
  }

  private statusFrom(rec: Running, id: string, d: Record<string, unknown>): StatusItem {
    return {
      extId: rec.ext.id, id, text: str(d.text, 80) ?? "", tooltip: str(d.tooltip, 200), command: str(d.command, 100),
      alignment: d.alignment === "right" ? "right" : "left", priority: typeof d.priority === "number" && Number.isFinite(d.priority) ? d.priority : 0,
    };
  }

  private unregister(rec: Running, kind: Kind, id: unknown) {
    if (!KINDS.includes(kind) || typeof id !== "string") return;
    this.contrib[kind].delete(this.key(rec, id));
    if (kind === "panel") this.panelContent.delete(this.key(rec, id));
    this.emit();
  }

  private update(rec: Running, kind: string, id: unknown, data: unknown) {
    if (typeof id !== "string") return;
    if (kind === "panel" && this.contrib.panel.has(this.key(rec, id))) {
      this.panelContent.set(this.key(rec, id), sanitizeNode(data));
      this.emit();
    } else if (kind === "status" && this.contrib.status.has(this.key(rec, id)) && isObj(data)) {
      this.contrib.status.set(this.key(rec, id), this.statusFrom(rec, id, data));
      this.emit();
    }
  }

  /* ---- calls from extensions into the app (permission-checked) ---- */
  private need(rec: Running, perm: Permission) {
    if (!rec.perms.has(perm)) throw new Error(`This extension needs the "${perm}" permission (add it to manifest.json)`);
  }

  private async handleCall(rec: Running, method: string, args: unknown[]): Promise<unknown> {
    const b = () => {
      if (!this.bridge) throw new Error("No workspace is open");
      return this.bridge;
    };
    switch (method) {
      case "window.showMessage": {
        const level = args[1] === "warning" || args[1] === "error" ? args[1] : "info";
        this.pushToast(String(args[0]).slice(0, 500), level, rec.ext.id);
        return null;
      }
      case "window.showQuickPick": {
        const items = Array.isArray(args[0]) ? args[0] : [];
        const opts = isObj(args[1]) ? args[1] : {};
        const clean: QuickPickItem[] = items.slice(0, 500).flatMap((it): QuickPickItem[] => {
          if (typeof it === "string") return [{ label: it.slice(0, 200), value: it }];
          if (isObj(it) && typeof it.label === "string") return [{ label: it.label.slice(0, 200), detail: str(it.detail, 200), value: it.value }];
          return [];
        });
        return this.showQuickPick(clean, { placeholder: str(opts.placeholder, 100), title: rec.ext.manifest.name });
      }
      case "window.showInputBox": {
        const o = isObj(args[0]) ? args[0] : {};
        return this.showInput({ title: rec.ext.manifest.name, prompt: str(o.prompt, 200), placeholder: str(o.placeholder, 100), value: str(o.value, 500) });
      }
      case "commands.execute": {
        const cmdArgs = Array.isArray(args[1]) ? args[1] : [];
        return this.executeCommand(String(args[0]), ...cmdArgs);
      }
      case "editor.getActiveDocument": this.need(rec, "editor"); return b().getActiveDocument();
      case "editor.replaceContent": this.need(rec, "editor"); b().replaceContent(String(args[0])); return null;
      case "editor.replaceSelection": this.need(rec, "editor"); b().replaceSelection(String(args[0])); return null;
      case "editor.insertText": this.need(rec, "editor"); b().insertText(String(args[0])); return null;
      case "workspace.readFile": this.need(rec, "workspace"); return b().readFile(String(args[0]));
      case "workspace.writeFile": this.need(rec, "workspace"); await b().writeFile(String(args[0]), String(args[1])); return null;
      case "workspace.listFiles": this.need(rec, "workspace"); return b().listFiles();
      case "settings.set": {
        const ok = await this.setSetting(rec.ext.id, String(args[0]), args[1], false);
        if (!ok) throw new Error(`Unknown or invalid setting "${String(args[0])}"`);
        return null;
      }
      default: throw new Error(`Unknown host method "${method}"`);
    }
  }

  /* ---- invoking extension handlers ---- */
  private invoke(extId: string, kind: string, target: string, args: unknown, timeoutMs?: number): Promise<unknown> {
    const rec = this.running.get(extId);
    if (!rec || rec.state !== "active") return Promise.reject(new Error("Extension is not running"));
    return new Promise((resolve, reject) => {
      const id = ++rec.seq;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const settle = <T,>(fn: (v: T) => void) => (v: T) => { if (timer) clearTimeout(timer); fn(v); };
      rec.pending.set(id, { resolve: settle(resolve), reject: settle(reject) });
      if (timeoutMs) timer = setTimeout(() => { rec.pending.delete(id); reject(new Error("Request timed out")); }, timeoutMs);
      this.watch(rec);
      rec.worker.postMessage({ t: "invoke", id, kind, target, args });
    });
  }

  /** While requests are outstanding, ping the worker. A worker stuck in a busy loop can't answer -> stop it. */
  private watch(rec: Running) {
    if (rec.watchdog) return;
    rec.lastSeen = Date.now();
    rec.watchdog = setInterval(() => {
      if (rec.pending.size === 0) { clearInterval(rec.watchdog!); rec.watchdog = null; return; }
      if (Date.now() - rec.lastSeen > HOST_WATCHDOG_MS) { this.fail(rec, "Stopped responding (possible infinite loop) and was stopped"); return; }
      rec.worker.postMessage({ t: "ping" });
    }, 500);
  }

  /* ---- commands ---- */
  registerBuiltinCommand(id: string, title: string, run: (...args: unknown[]) => unknown, category?: string) {
    this.builtinCommands.set(id, { title, category, run });
    this.emit();
  }

  unregisterBuiltinCommand(id: string) {
    if (this.builtinCommands.delete(id)) this.emit();
  }

  async executeCommand(id: string, ...args: unknown[]): Promise<unknown> {
    const builtin = this.builtinCommands.get(id);
    if (builtin) return builtin.run(...args);
    const cmd = this.snap.commands.find((c) => c.id === id && c.extId !== "ablix");
    if (!cmd) throw new Error(`Command "${id}" not found`);
    const rec = this.running.get(cmd.extId);
    if (!rec || rec.state !== "active") throw new Error(`Extension "${cmd.extId}" is not running`);
    return this.invoke(cmd.extId, "command", id, args);
  }

  /* ---- language features ---- */
  async provideCompletions(doc: EditorDocument, offset: number): Promise<CompletionItem[]> {
    const out: CompletionItem[] = [];
    await Promise.all(
      this.snap.completions.filter((p) => langMatch(p.languages, doc.language)).map(async (p) => {
        try { out.push(...sanitizeCompletions(await this.invoke(p.extId, "completion", p.providerId, { doc, offset }, 3000))); } catch { /* provider failed/timed out */ }
      })
    );
    for (const s of this.snap.snippets.filter((x) => x.language === "*" || x.language === doc.language)) {
      for (const sn of s.snippets) out.push({ label: sn.prefix, insertText: sn.body, detail: sn.description ?? "snippet", kind: "snippet", isSnippet: true });
    }
    return out;
  }

  async provideDiagnostics(doc: EditorDocument): Promise<Diagnostic[]> {
    const out: Diagnostic[] = [];
    await Promise.all(
      this.snap.diagnostics.filter((p) => langMatch(p.languages, doc.language)).map(async (p) => {
        try { out.push(...sanitizeDiagnostics(await this.invoke(p.extId, "diagnostics", p.providerId, { doc }, 3000))); } catch { /* ignore */ }
      })
    );
    return out;
  }

  hasFormatter(language: string) { return this.snap.formatters.some((p) => langMatch(p.languages, language)); }

  /** Returns the formatted text, or null if no formatter is registered for this language. */
  async formatDocument(doc: EditorDocument): Promise<string | null> {
    const p = this.snap.formatters.find((f) => langMatch(f.languages, doc.language));
    if (!p) return null;
    const result = await this.invoke(p.extId, "formatter", p.providerId, { doc }, 10000);
    if (typeof result !== "string") throw new Error("The formatter did not return text");
    return result;
  }

  /* ---- settings ---- */
  async setSetting(extId: string, key: string, value: unknown, notify = true): Promise<boolean> {
    const schema = this.snap.settings.find((s) => s.extId === extId && s.key === key);
    if (!schema) return false;
    const valid =
      (schema.type === "boolean" && typeof value === "boolean") || (schema.type === "number" && typeof value === "number" && Number.isFinite(value)) ||
      (schema.type === "string" && typeof value === "string") || (schema.type === "enum" && typeof value === "string" && !!schema.options?.includes(value));
    if (!valid) return false;
    const values = { ...(this.settingValues[extId] ?? {}), [key]: value };
    this.settingValues[extId] = values;
    await this.storage.saveSettings(extId, values);
    const rec = this.running.get(extId);
    if (rec) {
      rec.settings = values;
      if (notify) rec.worker.postMessage({ t: "event", name: "settingsChanged", data: { key, value } });
    }
    this.emit();
    return true;
  }

  getSetting(extId: string, key: string) {
    const schema = this.snap.settings.find((s) => s.extId === extId && s.key === key);
    return this.settingValues[extId]?.[key] ?? schema?.default;
  }

  async loadSettingValues(extId: string) {
    this.settingValues[extId] = await this.storage.loadSettings(extId);
    this.emit();
  }

  /* ---- themes ---- */
  async setTheme(id: string | null) {
    this.themeId = id;
    await this.storage.setPref("theme", id);
    this.emit();
  }
  /** Theme id is stored as "extId::themeId". */
  activeTheme(): ThemeContribution | null {
    if (!this.themeId) return null;
    const [extId, tid] = this.themeId.split("::");
    return this.snap.themes.find((t) => t.extId === extId && t.id === tid) ?? null;
  }

  /* ---- UI requests ---- */
  private pushToast(text: string, level: Toast["level"], extId?: string) {
    const toast: Toast = { id: ++this.toastSeq, text, level, extId };
    this.toasts = [...this.toasts, toast].slice(-4);
    const timer = setTimeout(() => this.dismissToast(toast.id), 6000) as unknown as { unref?: () => void };
    timer.unref?.();
    this.emit();
  }
  notify(text: string, level: Toast["level"] = "info") { this.pushToast(text, level); }
  dismissToast(id: number) {
    if (!this.toasts.some((t) => t.id === id)) return;
    this.toasts = this.toasts.filter((t) => t.id !== id);
    this.emit();
  }

  showQuickPick(items: QuickPickItem[], opts: { title?: string; placeholder?: string } = {}): Promise<QuickPickItem | null> {
    this.quickPick?.resolve(null);
    return new Promise((resolve) => {
      this.quickPick = { ...opts, items, resolve: (item) => { this.quickPick = null; this.emit(); resolve(item); } };
      this.emit();
    });
  }
  showInput(opts: { title?: string; prompt?: string; placeholder?: string; value?: string }): Promise<string | null> {
    this.inputBox?.resolve(null);
    return new Promise((resolve) => {
      this.inputBox = { ...opts, resolve: (v) => { this.inputBox = null; this.emit(); resolve(v); } };
      this.emit();
    });
  }
}
