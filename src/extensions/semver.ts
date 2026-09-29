/** Minimal semver: MAJOR.MINOR.PATCH with an optional -prerelease tag. */
const RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

export function isValidVersion(v: string): boolean {
  return RE.test(v);
}

export function compareVersions(a: string, b: string): number {
  const ma = RE.exec(a);
  const mb = RE.exec(b);
  if (!ma || !mb) return a.localeCompare(b, undefined, { numeric: true });
  for (let i = 1; i <= 3; i++) {
    const d = Number(ma[i]) - Number(mb[i]);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  // A version without a prerelease tag is newer than one with it.
  if (ma[4] && !mb[4]) return -1;
  if (!ma[4] && mb[4]) return 1;
  if (ma[4] && mb[4]) return ma[4].localeCompare(mb[4], undefined, { numeric: true });
  return 0;
}

export const isNewer = (candidate: string, installed: string) => compareVersions(candidate, installed) > 0;
