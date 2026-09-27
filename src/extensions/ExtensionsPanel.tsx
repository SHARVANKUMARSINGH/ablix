import { BUILTIN_EXTENSIONS } from "./ExtensionManager";
import { useExtensions } from "./useExtensions";

export function ExtensionsPanel() {
  const { enabled, isEnabled, setEnabled } = useExtensions();
  void enabled; // subscribed for re-render; read via isEnabled for clarity below

  return (
    <div className="extensions-panel">
      <div className="ablix-explorer-header">Extensions</div>
      <p className="extensions-note">
        Built-in extensions only — there's no marketplace to install third-party ones from yet.
      </p>
      {BUILTIN_EXTENSIONS.map((ext) => (
        <div className="extension-row" key={ext.id}>
          <div className="extension-row-text">
            <div className="extension-row-name">{ext.name}</div>
            <div className="extension-row-desc">{ext.description}</div>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={isEnabled(ext.id)}
              onChange={(e) => setEnabled(ext.id, e.target.checked)}
            />
            <span className="switch-track" />
          </label>
        </div>
      ))}
    </div>
  );
}
