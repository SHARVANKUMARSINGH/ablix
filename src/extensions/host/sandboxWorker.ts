import runtimeSource from "../worker/runtime.js?raw";
import type { Permission } from "../types";
import type { WorkerLike } from "./ExtensionHost";

/**
 * Real isolation for extension code:
 *
 *   Ablix page  <-postMessage->  sandboxed <iframe> (opaque origin, CSP)  <->  Web Worker
 *
 * - The Worker runs off the UI thread, so an extension stuck in `while(true){}` cannot freeze Ablix.
 * - The iframe is `sandbox="allow-scripts"` WITHOUT allow-same-origin: no access to Ablix's
 *   IndexedDB, cookies, localStorage or DOM.
 * - The iframe's CSP (inherited by the blob: Worker it spawns) sets `connect-src 'none'` unless the
 *   manifest requests the "network" permission, which also blocks fetch/XHR/WebSocket/import().
 * Everything an extension can do to the app goes through the validated message API in ExtensionHost.
 */

export function workerBootstrapSource(): string {
  return (
    runtimeSource.replace(/^export /gm, "") +
    `
;(function () {
  var post = self.postMessage.bind(self);
  var rt = createExtensionRuntime(post, { lockDown: function (p) { lockDownGlobals(self, p); } });
  self.addEventListener("message", function (e) { rt.handle(e.data); });
  post({ t: "ready" });
})();
`
  );
}

const BOOT_TIMEOUT_MS = 6000;

export function createSandboxedWorker(permissions: Permission[]): WorkerLike {
  const csp = [
    "default-src 'none'",
    "script-src 'unsafe-eval' 'unsafe-inline' blob:",
    "worker-src blob:",
    permissions.includes("network") ? "connect-src https: wss:" : "connect-src 'none'",
  ].join("; ");

  // "<" is escaped so extension/runtime text can never close the <script> element early.
  const srcLiteral = JSON.stringify(workerBootstrapSource()).replace(/</g, "\\u003c");
  const inner =
    `const w = new Worker(URL.createObjectURL(new Blob([${srcLiteral}], { type: "text/javascript" })));` +
    `w.onmessage = (e) => parent.postMessage(e.data, "*");` +
    `w.onerror = (e) => parent.postMessage({ t: "worker-error", error: String(e.message || "worker error") }, "*");` +
    `addEventListener("message", (e) => { if (e.source === parent) w.postMessage(e.data); });`;

  const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", "allow-scripts");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = "position:absolute;width:0;height:0;border:0;visibility:hidden;pointer-events:none";
  iframe.srcdoc =
    `<!doctype html><meta http-equiv="Content-Security-Policy" content="${csp}"><script>${inner}<\/script>`;

  let ready = false;
  let dead = false;
  const queue: unknown[] = [];

  const handle: WorkerLike = {
    onmessage: null,
    onerror: null,
    postMessage(message) {
      if (dead) return;
      if (!ready) queue.push(message);
      else iframe.contentWindow?.postMessage(message, "*");
    },
    terminate() {
      dead = true;
      window.removeEventListener("message", listener);
      clearTimeout(bootTimer);
      iframe.remove();
    },
  };

  const listener = (e: MessageEvent) => {
    if (e.source !== iframe.contentWindow) return;
    const data = e.data as { t?: string; error?: string } | null;
    if (data?.t === "ready" && !ready) {
      ready = true;
      clearTimeout(bootTimer);
      for (const m of queue.splice(0)) iframe.contentWindow?.postMessage(m, "*");
      return;
    }
    if (data?.t === "worker-error") {
      handle.onerror?.({ message: data.error ?? "worker error" });
      return;
    }
    handle.onmessage?.({ data: e.data });
  };
  window.addEventListener("message", listener);

  const bootTimer = setTimeout(() => {
    if (!ready) handle.onerror?.({ message: "The extension sandbox failed to start" });
  }, BOOT_TIMEOUT_MS);

  document.body.appendChild(iframe);
  return handle;
}
