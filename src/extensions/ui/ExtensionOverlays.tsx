import { useEffect, useMemo, useState } from "react";
import { extensionHost, extensionService, useHostSnapshot } from "../useExtensionSystem";
import { eventToKey } from "../keys";
import { installFromPicker } from "../installFlow";
import { InputBox, QuickPick } from "./QuickPick";
import { UiIcon } from "../../icons/Icons";

const THEME_VARS: Record<string, string> = {
  accent: "--accent", surface: "--surface", surface2: "--surface-2", border: "--border",
  text: "--text", textDim: "--text-dim", danger: "--danger",
};
const BUILTIN_KEYS: Record<string, string> = { "ctrl+shift+p": "ablix.commandPalette", "meta+shift+p": "ablix.commandPalette", "alt+shift+f": "ablix.formatDocument" };

/** App-wide extension UI: boots the service, applies themes, toasts, quick pick, input box, command palette, keybindings. */
export function ExtensionOverlays() {
  const snap = useHostSnapshot();
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => { void extensionService.start(); }, []);

  useEffect(() => {
    const open = () => setPaletteOpen(true);
    extensionHost.registerBuiltinCommand("ablix.commandPalette", "Show All Commands", open, "Ablix");
    extensionHost.registerBuiltinCommand("ablix.installFromFile", "Install Extension from File…", () => installFromPicker(), "Extensions");
    extensionHost.registerBuiltinCommand("ablix.selectTheme", "Select Color Theme", async () => {
      const themes = extensionHost.getSnapshot().themes;
      const pick = await extensionHost.showQuickPick(
        [{ label: "Ablix Dark (default)", detail: "Built-in", value: null }, ...themes.map((t) => ({ label: t.name, detail: t.extId, value: `${t.extId}::${t.id}` }))],
        { title: "Select Color Theme" }
      );
      if (pick) await extensionHost.setTheme((pick.value as string | null) ?? null);
    }, "Ablix");
    return () => {
      for (const id of ["ablix.commandPalette", "ablix.installFromFile", "ablix.selectTheme"]) extensionHost.unregisterBuiltinCommand(id);
    };
  }, []);

  // Theme: map the active theme's colors onto CSS variables.
  const theme = snap.themeId ? snap.themes.find((t) => `${t.extId}::${t.id}` === snap.themeId) ?? null : null;
  useEffect(() => {
    const root = document.documentElement;
    const set: string[] = [];
    if (theme) {
      for (const [k, v] of Object.entries(theme.colors)) {
        const prop = THEME_VARS[k] ?? `--tok-${k}`;
        root.style.setProperty(prop, v);
        set.push(prop);
      }
    }
    return () => set.forEach((p) => root.style.removeProperty(p));
  }, [theme]);

  // Keybindings (extension + built-in).
  const bindings = useMemo(() => new Map(snap.keybindings.map((k) => [k.key, k])), [snap.keybindings]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const key = eventToKey(e);
      const ext = bindings.get(key);
      const cmd = ext?.command ?? BUILTIN_KEYS[key];
      if (!cmd) return;
      if (!extensionHost.getSnapshot().commands.some((c) => c.id === cmd)) return;
      e.preventDefault();
      extensionHost.executeCommand(cmd, ...(ext?.args !== undefined ? [ext.args] : [])).catch((err) => extensionHost.notify(String(err.message ?? err), "error"));
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [bindings]);

  const paletteItems = useMemo(
    () =>
      [...snap.commands]
        .sort((a, b) => (a.category ?? "").localeCompare(b.category ?? "") || a.title.localeCompare(b.title))
        .map((c) => ({ label: c.category && !c.title.startsWith(c.category) ? `${c.category}: ${c.title}` : c.title, detail: c.id, value: c.id })),
    [snap.commands]
  );

  return (
    <>
      {paletteOpen && (
        <QuickPick
          title="Command Palette"
          placeholder="Type a command…"
          items={paletteItems}
          onCancel={() => setPaletteOpen(false)}
          onPick={(item) => {
            setPaletteOpen(false);
            extensionHost.executeCommand(String(item.value)).catch((err) => extensionHost.notify(String(err.message ?? err), "error"));
          }}
        />
      )}
      {snap.quickPick && (
        <QuickPick
          title={snap.quickPick.title}
          placeholder={snap.quickPick.placeholder}
          items={snap.quickPick.items}
          onCancel={() => snap.quickPick?.resolve(null)}
          onPick={(item) => snap.quickPick?.resolve(item)}
        />
      )}
      {snap.inputBox && (
        <InputBox
          title={snap.inputBox.title}
          prompt={snap.inputBox.prompt}
          placeholder={snap.inputBox.placeholder}
          value={snap.inputBox.value}
          onCancel={() => snap.inputBox?.resolve(null)}
          onSubmit={(v) => snap.inputBox?.resolve(v)}
        />
      )}
      <div className="toast-stack" aria-live="polite">
        {snap.toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.level}`} role="status" onClick={() => extensionHost.dismissToast(t.id)}>
            <UiIcon name={t.level === "info" ? "bell" : "warning"} size={13} />
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </>
  );
}
