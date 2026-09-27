/**
 * A small, dependency-free tokenizer used to syntax-highlight the custom
 * editor. It is intentionally simple (regex-driven, single-pass) rather than
 * a full language-server-grade highlighter — good enough for readability
 * without pulling in Monaco/CodeMirror.
 */

export type Lang = "js" | "ts" | "jsx" | "tsx" | "html" | "css" | "json" | "md" | "py" | "plain";

export function langFromFilename(filename: string): Lang {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  switch (ext) {
    case "js":
    case "mjs":
    case "cjs":
      return "js";
    case "ts":
      return "ts";
    case "jsx":
      return "jsx";
    case "tsx":
      return "tsx";
    case "html":
    case "htm":
      return "html";
    case "css":
    case "scss":
      return "css";
    case "json":
      return "json";
    case "md":
      return "md";
    case "py":
      return "py";
    default:
      return "plain";
  }
}

interface Token {
  text: string;
  cls: string; // maps to a CSS class, e.g. "tok-keyword"
}

const JS_KEYWORDS = new Set([
  "const", "let", "var", "function", "return", "if", "else", "for", "while",
  "do", "switch", "case", "break", "continue", "class", "extends", "new",
  "this", "import", "export", "default", "from", "as", "async", "await",
  "try", "catch", "finally", "throw", "typeof", "instanceof", "in", "of",
  "true", "false", "null", "undefined", "void", "yield", "interface", "type",
  "implements", "public", "private", "protected", "readonly", "enum",
  "namespace", "declare", "static", "get", "set",
]);

const PY_KEYWORDS = new Set([
  "def", "return", "if", "elif", "else", "for", "while", "break", "continue",
  "class", "import", "from", "as", "try", "except", "finally", "raise",
  "with", "lambda", "yield", "pass", "True", "False", "None", "and", "or",
  "not", "in", "is", "global", "nonlocal", "async", "await",
]);

const GENERIC_TOKEN_RE =
  /(\/\/.*$)|(#.*$)|(\/\*[\s\S]*?\*\/)|("(?:[^"\\]|\\.)*")|('(?:[^'\\]|\\.)*')|(`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)|(<\/?[A-Za-z][\w-]*)|([{}()[\];,.:?!&|=+\-*/%<>~^])/gm;

function tokenizeGeneric(line: string, keywords: Set<string>): Token[] {
  const tokens: Token[] = [];
  let lastIndex = 0;
  GENERIC_TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = GENERIC_TOKEN_RE.exec(line))) {
    if (m.index > lastIndex) {
      tokens.push({ text: line.slice(lastIndex, m.index), cls: "" });
    }
    const [full, lineComment, hashComment, blockComment, dq, sq, tpl, num, word, tag, punct] = m;
    if (lineComment || hashComment || blockComment) tokens.push({ text: full, cls: "tok-comment" });
    else if (dq || sq || tpl) tokens.push({ text: full, cls: "tok-string" });
    else if (num) tokens.push({ text: full, cls: "tok-number" });
    else if (tag) tokens.push({ text: full, cls: "tok-tag" });
    else if (word) tokens.push({ text: full, cls: keywords.has(full) ? "tok-keyword" : "" });
    else if (punct) tokens.push({ text: full, cls: "tok-punct" });
    lastIndex = m.index + full.length;
  }
  if (lastIndex < line.length) tokens.push({ text: line.slice(lastIndex), cls: "" });
  return tokens;
}

function tokenizeCss(line: string): Token[] {
  const tokens: Token[] = [];
  const re = /(\/\*[\s\S]*?\*\/)|([.#]?[A-Za-z-]+(?=\s*[:{]))|("[^"]*"|'[^']*')|([{}:;])/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    if (m.index > lastIndex) tokens.push({ text: line.slice(lastIndex, m.index), cls: "" });
    const [full, comment, prop, str, punct] = m;
    if (comment) tokens.push({ text: full, cls: "tok-comment" });
    else if (str) tokens.push({ text: full, cls: "tok-string" });
    else if (prop) tokens.push({ text: full, cls: "tok-tag" });
    else if (punct) tokens.push({ text: full, cls: "tok-punct" });
    lastIndex = m.index + full.length;
  }
  if (lastIndex < line.length) tokens.push({ text: line.slice(lastIndex), cls: "" });
  return tokens;
}

export function highlightLine(line: string, lang: Lang): Token[] {
  switch (lang) {
    case "js":
    case "ts":
    case "jsx":
    case "tsx":
      return tokenizeGeneric(line, JS_KEYWORDS);
    case "py":
      return tokenizeGeneric(line, PY_KEYWORDS);
    case "html":
      return tokenizeGeneric(line, new Set());
    case "css":
      return tokenizeCss(line);
    case "json":
      return tokenizeGeneric(line, new Set());
    default:
      return [{ text: line, cls: "" }];
  }
}
