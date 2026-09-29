/** Expands VS Code-style snippet bodies: ${1:default}, ${2}, $3, $0. Returns text and the initial selection. */
export function expandSnippet(body: string): { text: string; start: number; end: number } {
  let out = "";
  const stops: { n: number; pos: number; len: number }[] = [];
  let i = 0;
  while (i < body.length) {
    const c = body[i];
    if (c === "\\" && i + 1 < body.length && "$\\}".includes(body[i + 1])) {
      out += body[i + 1];
      i += 2;
      continue;
    }
    if (c === "$") {
      const rest = body.slice(i);
      const m = /^\$\{(\d+)(?::([^}]*))?\}/.exec(rest);
      if (m) {
        const def = m[2] ?? "";
        stops.push({ n: Number(m[1]), pos: out.length, len: def.length });
        out += def;
        i += m[0].length;
        continue;
      }
      const m2 = /^\$(\d+)/.exec(rest);
      if (m2) {
        stops.push({ n: Number(m2[1]), pos: out.length, len: 0 });
        i += m2[0].length;
        continue;
      }
    }
    out += c;
    i++;
  }
  const first = stops.filter((s) => s.n > 0).sort((a, b) => a.n - b.n)[0] ?? stops.find((s) => s.n === 0);
  return first ? { text: out, start: first.pos, end: first.pos + first.len } : { text: out, start: out.length, end: out.length };
}
