/** Shared types for the Ablix extension system (.ablixext packages, host, runtime). */

export const PERMISSIONS = ["editor", "workspace", "network"] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_INFO: Record<Permission, string> = {
  editor: "Read and modify the file open in the editor",
  workspace: "Read and write files in your project",
  network: "Make network requests to the internet",
};

export interface ExtensionManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  main: string;
  permissions?: Permission[];
  category?: string;
  icon?: string;
}

export type ExtensionSource =
  | { kind: "marketplace"; rowId: string; fileId: string }
  | { kind: "local" };

export interface InstalledExtension {
  id: string;
  manifest: ExtensionManifest;
  /** Text files from the package (path -> content), incl. the main file. */
  files: Record<string, string>;
  readme: string;
  enabled: boolean;
  installedAt: number;
  updatedAt: number;
  source: ExtensionSource;
}

/* ---------------- Contribution shapes (validated host-side) ---------------- */

export const TOKEN_NAMES = [
  "keyword", "string", "comment", "number", "tag", "punct", "type", "function", "variable", "constant", "operator",
] as const;
export type TokenName = (typeof TOKEN_NAMES)[number];

export interface TokenRule {
  pattern: string;
  flags?: string;
  token: TokenName;
}

export interface CommandContribution { extId: string; id: string; title: string; category?: string }
export type MenuLocation = "explorer/context" | "editor/context";
export interface MenuContribution { extId: string; location: MenuLocation; command: string; title: string; languages?: string[] }
export interface KeybindingContribution { extId: string; key: string; command: string; args?: unknown }
export interface LanguageContribution { extId: string; id: string; name: string; extensions: string[]; filenames: string[]; rules: TokenRule[] }
export interface ProviderContribution { extId: string; providerId: string; languages: string[]; title?: string }
export interface SnippetDef { prefix: string; body: string; description?: string }
export interface SnippetContribution { extId: string; language: string; snippets: SnippetDef[] }
export interface ThemeContribution { extId: string; id: string; name: string; colors: Record<string, string> }
export type SettingType = "boolean" | "string" | "number" | "enum";
export interface SettingContribution {
  extId: string; key: string; title: string; type: SettingType;
  default: string | number | boolean; description?: string; options?: string[];
}
export interface PanelContribution { extId: string; id: string; title: string; icon?: string; content: PanelNode | null }
export interface StatusItem {
  extId: string; id: string; text: string; tooltip?: string; command?: string;
  alignment: "left" | "right"; priority: number;
}

/** Declarative panel UI — rendered by React on the host, never raw HTML. */
export type PanelNode =
  | { type: "text"; text: string }
  | { type: "heading"; text: string }
  | { type: "code"; text: string }
  | { type: "divider" }
  | { type: "button"; label: string; command: string; args?: unknown }
  | { type: "input"; placeholder?: string; value?: string; submitLabel?: string; command: string }
  | { type: "list"; items: { label: string; detail?: string; command?: string; args?: unknown }[] }
  | { type: "row" | "column"; children: PanelNode[] };

export interface EditorDocument {
  path: string;
  language: string;
  text: string;
  selection?: { start: number; end: number };
}

export interface Diagnostic {
  line: number; // 1-based
  column?: number; // 1-based
  endColumn?: number;
  message: string;
  severity: "error" | "warning" | "info";
  source?: string;
}

export interface CompletionItem {
  label: string;
  insertText?: string;
  detail?: string;
  kind?: string;
  isSnippet?: boolean;
}

export interface QuickPickItem { label: string; detail?: string; value?: unknown }
