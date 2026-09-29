import { useSyncExternalStore } from "react";
import { ExtensionService } from "./ExtensionService";
import { createSandboxedWorker } from "./host/sandboxWorker";

/** The app-wide extension service (one per page load). Extensions run in sandboxed Workers. */
export const extensionService = new ExtensionService(createSandboxedWorker);
export const extensionHost = extensionService.host;

if (import.meta.env.DEV) {
  // Test hook for the automated browser run; not exposed in production builds.
  (window as unknown as { __ablixExt: unknown }).__ablixExt = { service: extensionService, host: extensionHost };
}

export function useHostSnapshot() {
  return useSyncExternalStore(extensionHost.subscribe, extensionHost.getSnapshot);
}

export function useInstalledExtensions() {
  return useSyncExternalStore(extensionService.subscribe, extensionService.getInstalled);
}
