/**
 * JSON helpers that reproduce Python's `json` module byte-for-byte, because the
 * parity harness diffs this tool's stdout and file output against the reference.
 * Two behaviours differ from the JavaScript built-ins and matter here:
 *
 *  1. Python prints floats and ints differently: `json.dumps(100.0)` is
 *     `"100.0"` but `json.dumps(100)` is `"100"`. JavaScript has one number type,
 *     so a value that must render as a float is wrapped in `PyFloat`.
 *  2. `json.dumps` escapes non-ASCII by default (`ensure_ascii=True` → an em dash
 *     becomes `—`); the reference uses that default for stdout reports and
 *     `ensure_ascii=False` (literal text) for files and the web server. Both are
 *     supported here via the `ensureAscii` option.
 *
 * The indent/compact separators also match Python: indented output uses `","`
 * between items, compact output uses `", "` (and always `": "` after a key).
 */

/** Wraps a number that must serialise as a Python float (with a trailing `.0`). */
export class PyFloat {
  constructor(public readonly value: number) {}
}

/** Convenience constructor for {@link PyFloat}. */
export function pf(x: number): PyFloat {
  return new PyFloat(x);
}

/** Numeric value of a plain number or a {@link PyFloat}. */
export function numOf(x: number | PyFloat): number {
  return x instanceof PyFloat ? x.value : x;
}

/** Python `repr(float)` for the value ranges this tool produces. */
function pyFloatRepr(x: number): string {
  if (Number.isNaN(x)) return "NaN";
  if (x === Infinity) return "Infinity";
  if (x === -Infinity) return "-Infinity";
  if (Object.is(x, -0)) return "-0.0";
  if (Number.isInteger(x)) {
    // Python appends ".0" to whole-valued floats. Astronomically large integral
    // floats would switch to exponent form in CPython; the metrics here never
    // reach that range, so the plain decimal form is faithful.
    if (Math.abs(x) < 1e16) return x.toString() + ".0";
    return x.toString();
  }
  // For non-integers in the normal range, JS and CPython agree on the shortest
  // round-tripping decimal, so `toString()` matches Python's repr.
  return x.toString();
}

/** Escape a string the way Python's json encoder does. */
function encodeString(s: string, ensureAscii: boolean): string {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    const code = s.charCodeAt(i);
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (ch === "\b") out += "\\b";
    else if (ch === "\f") out += "\\f";
    else if (code < 0x20) out += "\\u" + code.toString(16).padStart(4, "0");
    // ensure_ascii escapes everything above 0x7f; 0x7f (DEL) itself stays literal,
    // matching CPython. Astral characters are two UTF-16 units here, so each
    // surrogate is emitted as its own \uXXXX — exactly the surrogate pair Python
    // writes.
    else if (ensureAscii && code > 0x7f)
      out += "\\u" + code.toString(16).padStart(4, "0");
    else out += ch;
  }
  return out + '"';
}

export interface PyDumpsOptions {
  /** Spaces per indent level. Omit for compact (single-line) output. */
  indent?: number;
  /** Escape non-ASCII as \uXXXX (Python `ensure_ascii`, default true). */
  ensureAscii?: boolean;
}

/** Serialise a value like Python's `json.dumps`. See the module doc for details. */
export function pyDumps(obj: unknown, opts: PyDumpsOptions = {}): string {
  const ensureAscii = opts.ensureAscii ?? true;
  const indent = opts.indent;
  const itemSep = indent === undefined ? ", " : ",";
  const keySep = ": ";

  const ser = (v: unknown, level: number): string => {
    if (v === null || v === undefined) return "null";
    if (v instanceof PyFloat) return pyFloatRepr(v.value);
    const t = typeof v;
    if (t === "number") {
      const num = v as number;
      // A plain number models a Python int; a non-integer plain number is a
      // defensive fallback (should not occur — floats are wrapped in PyFloat).
      return Number.isInteger(num) ? num.toString() : pyFloatRepr(num);
    }
    if (t === "boolean") return v ? "true" : "false";
    if (t === "string") return encodeString(v as string, ensureAscii);
    if (Array.isArray(v)) {
      if (v.length === 0) return "[]";
      if (indent === undefined)
        return "[" + v.map((x) => ser(x, level)).join(itemSep) + "]";
      const pad = " ".repeat(indent * (level + 1));
      const end = " ".repeat(indent * level);
      return (
        "[\n" +
        v.map((x) => pad + ser(x, level + 1)).join(itemSep + "\n") +
        "\n" +
        end +
        "]"
      );
    }
    if (t === "object") {
      const entries = Object.entries(v as Record<string, unknown>).filter(
        ([, val]) => val !== undefined,
      );
      if (entries.length === 0) return "{}";
      const body = (k: string, val: unknown, lvl: number): string =>
        encodeString(k, ensureAscii) + keySep + ser(val, lvl);
      if (indent === undefined)
        return (
          "{" +
          entries.map(([k, val]) => body(k, val, level)).join(itemSep) +
          "}"
        );
      const pad = " ".repeat(indent * (level + 1));
      const end = " ".repeat(indent * level);
      return (
        "{\n" +
        entries
          .map(([k, val]) => pad + body(k, val, level + 1))
          .join(itemSep + "\n") +
        "\n" +
        end +
        "}"
      );
    }
    return "null";
  };

  return ser(obj, 0);
}

/**
 * Parse JSON while preserving Python's int/float distinction: a number literal
 * containing `.`, `e`, or `E` becomes a {@link PyFloat}, everything else stays a
 * plain number. This lets values read from `fingerprint.json` round-trip through
 * `pyDumps` with the same `.0`-or-not rendering CPython would produce.
 */
export function pyJsonParse(text: string): unknown {
  let i = 0;
  const n = text.length;

  const ws = (): void => {
    while (i < n) {
      const c = text[i]!;
      if (c === " " || c === "\t" || c === "\n" || c === "\r") i++;
      else break;
    }
  };
  const expect = (lit: string): void => {
    if (text.slice(i, i + lit.length) !== lit)
      throw new SyntaxError(`expected ${lit} at ${i}`);
    i += lit.length;
  };

  const parseString = (): string => {
    if (text[i] !== '"') throw new SyntaxError(`expected string at ${i}`);
    i++;
    let s = "";
    while (i < n) {
      const c = text[i]!;
      if (c === '"') {
        i++;
        return s;
      }
      if (c === "\\") {
        i++;
        const e = text[i]!;
        if (e === '"') s += '"';
        else if (e === "\\") s += "\\";
        else if (e === "/") s += "/";
        else if (e === "n") s += "\n";
        else if (e === "t") s += "\t";
        else if (e === "r") s += "\r";
        else if (e === "b") s += "\b";
        else if (e === "f") s += "\f";
        else if (e === "u") {
          s += String.fromCharCode(parseInt(text.slice(i + 1, i + 5), 16));
          i += 4;
        } else s += e;
        i++;
      } else {
        s += c;
        i++;
      }
    }
    throw new SyntaxError("unterminated string");
  };

  const parseNumber = (): number | PyFloat => {
    const start = i;
    if (text[i] === "-") i++;
    while (i < n && text[i]! >= "0" && text[i]! <= "9") i++;
    let isFloat = false;
    if (text[i] === ".") {
      isFloat = true;
      i++;
      while (i < n && text[i]! >= "0" && text[i]! <= "9") i++;
    }
    if (text[i] === "e" || text[i] === "E") {
      isFloat = true;
      i++;
      if (text[i] === "+" || text[i] === "-") i++;
      while (i < n && text[i]! >= "0" && text[i]! <= "9") i++;
    }
    const val = Number(text.slice(start, i));
    return isFloat ? new PyFloat(val) : val;
  };

  const parseValue = (): unknown => {
    ws();
    const c = text[i];
    if (c === "{") return parseObject();
    if (c === "[") return parseArray();
    if (c === '"') return parseString();
    if (c === "t") {
      expect("true");
      return true;
    }
    if (c === "f") {
      expect("false");
      return false;
    }
    if (c === "n") {
      expect("null");
      return null;
    }
    return parseNumber();
  };

  const parseObject = (): Record<string, unknown> => {
    const obj: Record<string, unknown> = {};
    i++; // {
    ws();
    if (text[i] === "}") {
      i++;
      return obj;
    }
    for (;;) {
      ws();
      const key = parseString();
      ws();
      if (text[i] !== ":") throw new SyntaxError(`expected : at ${i}`);
      i++;
      obj[key] = parseValue();
      ws();
      const ch = text[i];
      if (ch === ",") {
        i++;
        continue;
      }
      if (ch === "}") {
        i++;
        break;
      }
      throw new SyntaxError(`expected , or } at ${i}`);
    }
    return obj;
  };

  const parseArray = (): unknown[] => {
    const arr: unknown[] = [];
    i++; // [
    ws();
    if (text[i] === "]") {
      i++;
      return arr;
    }
    for (;;) {
      arr.push(parseValue());
      ws();
      const ch = text[i];
      if (ch === ",") {
        i++;
        continue;
      }
      if (ch === "]") {
        i++;
        break;
      }
      throw new SyntaxError(`expected , or ] at ${i}`);
    }
    return arr;
  };

  const result = parseValue();
  ws();
  return result;
}
