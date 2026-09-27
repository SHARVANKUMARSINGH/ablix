

/**
 * Centralized icon abstraction.
 * - UiIcon: general interface icons via Font Awesome (loaded from CDN in index.html)
 * - FileIcon: file/language icons via vscode-icons CDN, keyed off filename/extension
 * - AppIcon: application icons (Ablix placeholder for now, easy to swap later)
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
  clock: "fa-regular fa-clock",
  fallback: "fa-regular fa-file-lines",
};

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

/**
 * Application icon. Currently a temporary "A" placeholder tile — swap the `src`
 * (or the whole render body) here once final branding is supplied, without
 * touching any calling component.
 */
export function AppIcon({
  app,
  size = 40,
}: {
  app: "ablix";
  size?: number;
}) {
  void app; // only one app for now; kept for future multi-app support
  return (
    <div
      className="app-icon-placeholder"
      style={{ width: size, height: size, fontSize: size * 0.5 }}
    >
      A
    </div>
  );
}
