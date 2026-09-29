import { useState } from "react";

/**
 * Centralized icon abstraction.
 * - UiIcon: general interface icons via Font Awesome (loaded from CDN in index.html)
 * - FileIcon: file/language icons via vscode-icons CDN, keyed off filename/extension
 * - AppIcon: application icons (real Ablix branding, still swappable in one place)
 *
 * No component in the app should reference a CDN URL or a raw <i className="fa-..."> directly.
 * Everything routes through here so sources can be swapped in one place later.
 */

const FA_MAP: Record<string, string> = {
  folder: "fa-solid fa-folder",
  "folder-open": "fa-solid fa-folder-open",
  file: "fa-solid fa-file",
  trash: "fa-solid fa-trash",
  rename: "fa-solid fa-pen",
  refresh: "fa-solid fa-arrows-rotate",
  settings: "fa-solid fa-gear",
  search: "fa-solid fa-magnifying-glass",
  close: "fa-solid fa-xmark",
  minimize: "fa-solid fa-minus",
  maximize: "fa-solid fa-square",
  "new-folder": "fa-solid fa-folder-plus",
  "new-file": "fa-solid fa-file-circle-plus",
  open: "fa-solid fa-arrow-up-right-from-square",
  start: "fa-solid fa-grip",
  "chevron-right": "fa-solid fa-chevron-right",
  "chevron-down": "fa-solid fa-chevron-down",
  terminal: "fa-solid fa-terminal",
  play: "fa-solid fa-play",
  eye: "fa-solid fa-eye",
  plug: "fa-solid fa-plug",
  download: "fa-solid fa-download",
  expand: "fa-solid fa-expand",
  compress: "fa-solid fa-compress",
  clock: "fa-regular fa-clock",
  "puzzle-piece": "fa-solid fa-puzzle-piece",
  package: "fa-solid fa-box",
  wand: "fa-solid fa-wand-magic-sparkles",
  list: "fa-solid fa-list",
  bolt: "fa-solid fa-bolt",
  star: "fa-solid fa-star",
  bug: "fa-solid fa-bug",
  code: "fa-solid fa-code",
  palette: "fa-solid fa-palette",
  wrench: "fa-solid fa-wrench",
  book: "fa-solid fa-book",
  bell: "fa-solid fa-bell",
  command: "fa-solid fa-keyboard",
  warning: "fa-solid fa-triangle-exclamation",
  check: "fa-solid fa-check",
  upload: "fa-solid fa-upload",
  store: "fa-solid fa-store",
  chart: "fa-solid fa-chart-simple",
  note: "fa-solid fa-note-sticky",
  globe: "fa-solid fa-globe",
  fallback: "fa-regular fa-file-lines",
};

export const hasUiIcon = (name: string) => name in FA_MAP;

export function UiIcon({
  name,
  size = 16,
  className = "",
}: {
  name: keyof typeof FA_MAP | string;
  size?: number;
  className?: string;
}) {
  const cls = FA_MAP[name] ?? FA_MAP.fallback;
  return (
    <i
      className={`${cls} ${className}`}
      style={{ fontSize: size, lineHeight: 1 }}
      aria-hidden="true"
    />
  );
}

// vscode-icons-js exposes a filename/extension -> icon-file-name resolver we mimic here
// with a small local mapping (kept dependency-free); backed by the public vscode-icons CDN.
const VSCODE_ICONS_BASE =
  "https://cdn.jsdelivr.net/gh/vscode-icons/vscode-icons/icons";

const EXT_ICON_MAP: Record<string, string> = {
  html: "file_type_html.svg",
  htm: "file_type_html.svg",
  css: "file_type_css.svg",
  scss: "file_type_scss.svg",
  js: "file_type_js.svg",
  mjs: "file_type_js.svg",
  cjs: "file_type_js.svg",
  ts: "file_type_typescript.svg",
  jsx: "file_type_reactjs.svg",
  tsx: "file_type_reactts.svg",
  json: "file_type_json.svg",
  md: "file_type_markdown.svg",
  py: "file_type_python.svg",
  txt: "file_type_text.svg",
  yml: "file_type_yaml.svg",
  yaml: "file_type_yaml.svg",
  gitignore: "file_type_git.svg",
};

const NAME_ICON_MAP: Record<string, string> = {
  "package.json": "file_type_node.svg",
  "package-lock.json": "file_type_node.svg",
  "tsconfig.json": "file_type_tsconfig.svg",
};

export function FileIcon({
  filename,
  isFolder = false,
  isOpen = false,
  size = 16,
}: {
  filename: string;
  isFolder?: boolean;
  isOpen?: boolean;
  size?: number;
}) {
  if (isFolder) {
    return <UiIcon name={isOpen ? "folder-open" : "folder"} size={size} />;
  }

  const lower = filename.toLowerCase();
  const iconFile =
    NAME_ICON_MAP[lower] ??
    EXT_ICON_MAP[lower.split(".").pop() ?? ""] ??
    null;

  if (!iconFile) {
    // No emoji fallback ever — Font Awesome generic file icon instead.
    return <UiIcon name="fallback" size={size} />;
  }

  return (
    <img
      src={`${VSCODE_ICONS_BASE}/${iconFile}`}
      width={size}
      height={size}
      alt=""
      draggable={false}
      onError={(e) => {
        // Swap to Font Awesome fallback rather than any emoji if the CDN asset fails.
        (e.currentTarget as HTMLImageElement).style.display = "none";
      }}
    />
  );
}

// Real branding, centralized here so swapping it again later (a new mark, a
// different app) never means touching DesktopIcon/Taskbar/AblixIDE directly.
const APP_ICON_SRC: Record<"ablix", string> = {
  ablix: "/assets/icon-192.png",
};

export function AppIcon({
  app,
  size = 40,
}: {
  app: "ablix";
  size?: number;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    // Last-resort fallback if the asset ever fails to load — a letter tile,
    // not an emoji, matching the "no emoji anywhere" rule.
    return (
      <div
        className="app-icon-placeholder"
        style={{ width: size, height: size, fontSize: size * 0.5 }}
      >
        A
      </div>
    );
  }

  return (
    <img
      src={APP_ICON_SRC[app]}
      alt=""
      width={size}
      height={size}
      draggable={false}
      className="app-icon-image"
      style={{ width: size, height: size }}
      onError={() => setFailed(true)}
    />
  );
}
