/** Keybinding helpers: "Ctrl+Shift+K" <-> normalized "ctrl+shift+k". */

const MODS = ["ctrl", "alt", "shift", "meta"] as const;
const ALIASES: Record<string, string> = {
  control: "ctrl", cmd: "meta", command: "meta", option: "alt", esc: "escape", return: "enter", space: " ", spacebar: " ",
};

export function normalizeKey(spec: string): string | null {
  const parts = spec.split("+").map((p) => (p === "" ? "+" : p.trim().toLowerCase()));
  const mods = new Set<string>();
  let key = "";
  for (const raw of parts) {
    const p = ALIASES[raw] ?? raw;
    if ((MODS as readonly string[]).includes(p)) mods.add(p);
    else if (!key && p) key = p;
    else return null;
  }
  if (!key) return null;
  return [...MODS.filter((m) => mods.has(m)), key].join("+");
}

export function eventToKey(e: { key: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }): string {
  const mods = MODS.filter(
    (m) => (m === "ctrl" && e.ctrlKey) || (m === "alt" && e.altKey) || (m === "shift" && e.shiftKey) || (m === "meta" && e.metaKey)
  );
  return [...mods, e.key.toLowerCase()].join("+");
}

/** Keys extensions may not take over. */
export const RESERVED_KEYS = new Set(["ctrl+s", "meta+s", "ctrl+shift+p", "meta+shift+p", "alt+shift+f"]);
