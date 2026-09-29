export function lockDownGlobals(scope: unknown, permissions: string[]): void;
export function createExtensionRuntime(
  post: (message: unknown) => void,
  opts?: { lockDown?: (permissions: string[]) => void }
): { handle(message: unknown): unknown };
