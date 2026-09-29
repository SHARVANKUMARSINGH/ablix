import { useSyncExternalStore } from "react";
import { fetchMarketplace, type MarketplaceRow } from "./marketplace";

interface State { rows: MarketplaceRow[]; loading: boolean; error: string | null; loaded: boolean }
let state: State = { rows: [], loading: false, error: null, loaded: false };
const listeners = new Set<() => void>();
const set = (patch: Partial<State>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

/** Fetches the listing from the Appwrite table (shared by the Marketplace tab and update detection). */
export async function refreshMarketplace() {
  if (state.loading) return;
  set({ loading: true, error: null });
  try {
    set({ rows: await fetchMarketplace(), loading: false, loaded: true });
  } catch (e) {
    set({ loading: false, error: e instanceof Error ? e.message : String(e), loaded: true });
  }
}

export function useMarketplace() {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => state
  );
}
