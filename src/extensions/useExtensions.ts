import { useEffect, useState } from "react";
import { ExtensionManager } from "./ExtensionManager";

export function useExtensions() {
  const [enabled, setEnabled] = useState(ExtensionManager.getSnapshot());

  useEffect(() => {
    ExtensionManager.init().then(setEnabled);
    return ExtensionManager.subscribe(setEnabled);
  }, []);

  return {
    enabled,
    isEnabled: (id: string) => !!enabled[id],
    setEnabled: (id: string, value: boolean) => ExtensionManager.setEnabled(id, value),
  };
}
