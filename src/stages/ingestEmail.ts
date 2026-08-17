/**
 * Stage 0 (email) — ingest sent e-mail as corpus material (mbox parsing that
 * mirrors Python's `mailbox` + `email.policy` semantics).
 *
 * Reads Google Takeout archives (corpus/inbox/*.zip containing a Sent .mbox) or
 * bare .mbox files dropped in corpus/inbox/, plus Outlook-for-Mac .olm archives.
 *
 * Authorship is enforced, not assumed: a "Sent" export can contain whole
 * conversation threads. The dominant From address across each mailbox is taken as
 * the owner's, and only messages From that address are kept. Per message: prefer
 * the text/plain part (fall back to stripped HTML), strip quoted reply chains and
 * signatures, drop long URLs, skip empty/short bodies. Each kept message is
 * language-tagged and split into per-language chunks (mixed mail).
 *
 * Writes corpus/email-sent.jsonl (one JSON record per line). Stdout is aggregates
 * only (counts) — never message text, names, or addresses (privacy contract).
 *
 * ── Why not mailparser ────────────────────────────────────────────────────────
 * `mailparser` was evaluated first (it is the obvious MIME library), but its
 * high-level `simpleParser` cannot reproduce the Python `email` behaviour the
 * stage depends on bit-for-bit, as verified against real archives:
 *   1. It AGGREGATES every text/plain (or every text/html) part into one string,
 *      whereas Python's `get_body(preferencelist=("plain","html"))` selects a
 *      SINGLE part. Messages with two html branches (e.g. an empty body next to a
 *      signature part) then gain spurious extra records.
 *   2. It UN-FLOWS `format=flowed` text/plain (RFC 3676), joining soft-wrapped
 *      lines; Python's `get_content()` returns the raw text, so line structure —
 *      and therefore the `"\n-- \n"` signature split and per-paragraph language
 *      split — diverges (≈16% of this corpus is flowed).
 *   3. It normalizes CRLF→LF; Python preserves the original line endings, which
 *      the signature-delimiter split is sensitive to.
 * So MIME structure, part selection and transfer decoding implement
 * get_body + get_content directly, and charset decoding uses `iconv-lite`
 * — mailparser's own charset engine, which matches Python's codecs byte-for-byte
 * on this corpus (utf-8, us-ascii, iso-8859-1/7/15, windows-1251/1252/1253). No
 * async remains, so this entry point runs and returns synchronously.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import AdmZip from "adm-zip";
import { splitByLang } from "../lib/lang.js";
import { whitespaceSplit } from "../lib/text.js";
import { Counter } from "../lib/counter.js";
import { corpusDir } from "../lib/paths.js";

// iconv-lite is a dependency of mailparser (already installed) and is the charset
// decoder mailparser itself uses; it reproduces Python's `bytes.decode(charset,
// errors="replace")` (including the U+FFFD replacements) for every charset here.
const iconv = createRequire(import.meta.url)("iconv-lite") as {
  decode(
    buf: Buffer,
    encoding: string,
    options?: { stripBOM?: boolean },
  ): string;
  encodingExists(encoding: string): boolean;
};

// ── Regexes (flags chosen to match Python `re`) ────────────────────────────────

// Quoted reply / forwarded-message intros. Python compiled with (?im); applied
// per line via `.match(line)` (anchored at start). The `m` flag is inert on a
// single line but kept for fidelity; `.` never matches a newline in either engine
// (no DOTALL), matching Python.
const QUOTE_INTRO_RE =
  /^\s*(-*\s*on .{5,120}wrote\s*-*:?|-{3,} ?forwarded message ?-{3,}|-{3,} ?original message ?-{3,}|am .{5,80}schrieb:?|op .{5,80}schreef:?|##-.*-##|from:\s.+|sent:\s.+|to:\s.+|subject:\s.+|στις .{5,80}έγραψε:?)\s*$/im;
const OUTLOOK_DIVIDER_RE = /^\s*_{10,}\s*$/; // Outlook reply divider line
const URL_RE = /https?:\/\/\S+/g;
const TAG_RE = /<[^>]+>/g;
const HTMLISH_RE = /<(html|body|div|p|span|meta)[ >]/i;
// Delivery-failure bounces. Python compiled with re.I only (no MULTILINE), so `^`
// anchors at string start; `.` never crosses a newline.
const BOUNCE_RE =
  /^\s*(\*\* ?Delivery (incomplete|has failed)|Delivery Status Notification|Your message .{0,60}(couldn't|could not) be delivered)/i;

// ── HTML entity decoding (replicates Python's html.unescape, pragmatically) ────
//
// Python's html.unescape resolves the FULL HTML5 named-entity table (~2000 names,
// some without a trailing semicolon) plus numeric refs with a Windows-1252 remap
// for 0x80–0x9F. We cover numeric refs (with that remap) and a curated set of the
// named entities that actually appear in mail. DIVERGENCE: exotic named entities
// and the no-semicolon legacy forms outside this set are left un-decoded. This
// only affects html-only messages, so it is scoped narrowly — flagged for the
// harness.
const CP1252: Record<number, string> = {
  0x80: "€",
  0x82: "‚",
  0x83: "ƒ",
  0x84: "„",
  0x85: "…",
  0x86: "†",
  0x87: "‡",
  0x88: "ˆ",
  0x89: "‰",
  0x8a: "Š",
  0x8b: "‹",
  0x8c: "Œ",
  0x8e: "Ž",
  0x91: "‘",
  0x92: "’",
  0x93: "“",
  0x94: "”",
  0x95: "•",
  0x96: "–",
  0x97: "—",
  0x98: "˜",
  0x99: "™",
  0x9a: "š",
  0x9b: "›",
  0x9c: "œ",
  0x9e: "ž",
  0x9f: "Ÿ",
};
const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  copy: "©",
  reg: "®",
  trade: "™",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  laquo: "«",
  raquo: "»",
  bull: "•",
  middot: "·",
  deg: "°",
  plusmn: "±",
  times: "×",
  divide: "÷",
  frac12: "½",
  frac14: "¼",
  frac34: "¾",
  sup1: "¹",
  sup2: "²",
  sup3: "³",
  micro: "µ",
  para: "¶",
  sect: "§",
  dagger: "†",
  Dagger: "‡",
  permil: "‰",
  prime: "′",
  Prime: "″",
  euro: "€",
  pound: "£",
  yen: "¥",
  cent: "¢",
  curren: "¤",
  brvbar: "¦",
  uml: "¨",
  ordf: "ª",
  not: "¬",
  shy: "­",
  macr: "¯",
  acute: "´",
  cedil: "¸",
  ordm: "º",
  iquest: "¿",
  iexcl: "¡",
  Agrave: "À",
  Aacute: "Á",
  Acirc: "Â",
  Atilde: "Ã",
  Auml: "Ä",
  Aring: "Å",
  AElig: "Æ",
  Ccedil: "Ç",
  Egrave: "È",
  Eacute: "É",
  Ecirc: "Ê",
  Euml: "Ë",
  Igrave: "Ì",
  Iacute: "Í",
  Icirc: "Î",
  Iuml: "Ï",
  ETH: "Ð",
  Ntilde: "Ñ",
  Ograve: "Ò",
  Oacute: "Ó",
  Ocirc: "Ô",
  Otilde: "Õ",
  Ouml: "Ö",
  Oslash: "Ø",
  Ugrave: "Ù",
  Uacute: "Ú",
  Ucirc: "Û",
  Uuml: "Ü",
  Yacute: "Ý",
  THORN: "Þ",
  szlig: "ß",
  agrave: "à",
  aacute: "á",
  acirc: "â",
  atilde: "ã",
  auml: "ä",
  aring: "å",
  aelig: "æ",
  ccedil: "ç",
  egrave: "è",
  eacute: "é",
  ecirc: "ê",
  euml: "ë",
  igrave: "ì",
  iacute: "í",
  icirc: "î",
  iuml: "ï",
  eth: "ð",
  ntilde: "ñ",
  ograve: "ò",
  oacute: "ó",
  ocirc: "ô",
  otilde: "õ",
  ouml: "ö",
  oslash: "ø",
  ugrave: "ù",
  uacute: "ú",
  ucirc: "û",
  uuml: "ü",
  yacute: "ý",
  thorn: "þ",
  yuml: "ÿ",
};

function charFromNum(num: number): string {
  if (Number.isNaN(num) || num === 0) return "�";
  if (Object.prototype.hasOwnProperty.call(CP1252, num)) return CP1252[num]!;
  if ((num >= 0xd800 && num <= 0xdfff) || num > 0x10ffff) return "�";
  try {
    return String.fromCodePoint(num);
  } catch {
    return "�";
  }
}

function htmlUnescape(s: string): string {
  return s.replace(
    /&(#[0-9]+;?|#[xX][0-9a-fA-F]+;?|[a-zA-Z][a-zA-Z0-9]*;?)/g,
    (m, ref: string) => {
      if (ref[0] === "#") {
        const body = ref.replace(/;$/, "");
        const num =
          body[1] === "x" || body[1] === "X"
            ? parseInt(body.slice(2), 16)
            : parseInt(body.slice(1), 10);
        return charFromNum(num);
      }
      const name = ref.replace(/;$/, "");
      if (Object.prototype.hasOwnProperty.call(NAMED, name))
        return NAMED[name]!;
      return m; // unknown entity: leave verbatim (as Python does for non-matches)
    },
  );
}

// ── Text helpers ───────────────────────────────────────────────────────────────

/**
 * Python `str.splitlines()`: splits on universal line boundaries and, unlike
 * `str.split("\n")`, produces NO trailing empty element when the string ends with
 * a boundary. `"a\n".splitlines() == ["a"]`, `"".splitlines() == []`.
 */
function splitlines(s: string): string[] {
  if (s === "") return [];
  const parts = s.split(/\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/);
  if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

/** Reference `html_to_text`: strip script/style, turn breaks into newlines, drop
 *  remaining tags, unescape entities. */
function htmlToText(markup: string): string {
  // (?is)<(style|script).*?</\1> — DOTALL + IGNORECASE, non-greedy, backreference.
  let m = markup.replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ");
  m = m.replace(/<br\s*\/?>|<\/p>|<\/div>/gi, "\n");
  return htmlUnescape(m.replace(TAG_RE, " "));
}

// Python `str.strip()` / `str.lstrip()` whitespace set (chars where `isspace()` is
// True): differs from JS `\s`/`trim()` in two ways that both bite here — Python
// strips the C1/ASCII separators \x1c–\x1f and NEL \x85 (JS does not), and Python
// does NOT strip U+FEFF (the BOM), which JS `trim()` removes. A leading BOM must
// survive into the record text.
const PY_WS =
  "\\t\\n\\v\\f\\r\\x1c\\x1d\\x1e\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const PY_LSTRIP_RE = new RegExp(`^[${PY_WS}]+`);
const PY_STRIP_RE = new RegExp(`^[${PY_WS}]+|[${PY_WS}]+$`, "g");
const pyStrip = (s: string): string => s.replace(PY_STRIP_RE, "");

/** Reference `clean`: signature/quote/URL stripping and whitespace collapse. */
function clean(textIn: string): string {
  let text = textIn.split("\n-- \n")[0] ?? ""; // signature delimiter
  const lines: string[] = [];
  let done = false;
  for (const line of splitlines(text)) {
    if (QUOTE_INTRO_RE.test(line)) done = true; // reply chain begins
    if (OUTLOOK_DIVIDER_RE.test(line)) done = true; // Outlook reply divider
    if (done || line.replace(PY_LSTRIP_RE, "").startsWith(">")) continue;
    lines.push(line);
  }
  text = lines.join("\n");
  text = text.replace(URL_RE, " ");
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n{3,}/g, "\n\n");
  return pyStrip(text);
}

// Under `email.policy.default`, `msg.get("Date")` returns a header whose string
// value is the RE-SERIALIZED date: fields zero-padded, weekday recomputed from the
// calendar date, the ORIGINAL wall-clock time and UTC offset preserved (no
// conversion), named/obsolete zones mapped to a numeric offset, trailing comments
// dropped, and — when the value cannot be parsed — the raw string returned as-is.
// This mirrors `email.utils.format_datetime(email.utils.parsedate_to_datetime(v))`
// with its raise→raw fallback, verified against real archives (e.g. a raw
// "Thu, 4 Jun 2026 …" is emitted as "Thu, 04 Jun 2026 …").
const DATE_MONTHS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};
const DATE_MON = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const DATE_WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]; // Date.getUTCDay(): 0=Sun
const DATE_ZONES: Record<string, string> = {
  ut: "+0000",
  utc: "+0000",
  gmt: "+0000",
  z: "+0000",
  est: "-0500",
  edt: "-0400",
  cst: "-0600",
  cdt: "-0500",
  mst: "-0700",
  mdt: "-0600",
  pst: "-0800",
  pdt: "-0700",
};
const RFC5322_RE =
  /^\s*(?:[A-Za-z]+\s*,\s*)?(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*\s+(\d{2,4})\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?\s+([+-]\d{4}|[A-Za-z]+)/;
const pad2 = (n: number): string => String(n).padStart(2, "0");

function formatEmailDate(raw: string): string {
  const m = RFC5322_RE.exec(raw);
  if (!m) return raw;
  const day = parseInt(m[1]!, 10);
  const mon = DATE_MONTHS[m[2]!.toLowerCase()];
  if (mon === undefined) return raw;
  let year = parseInt(m[3]!, 10);
  if (m[3]!.length <= 2) year += year < 69 ? 2000 : 1900; // RFC 2-digit-year rule
  const hh = parseInt(m[4]!, 10);
  const mm = parseInt(m[5]!, 10);
  const ss = m[6] ? parseInt(m[6], 10) : 0;
  if (hh > 23 || mm > 59 || ss > 59) return raw; // datetime() would raise → raw
  let zone = m[7]!;
  if (!/^[+-]\d{4}$/.test(zone)) {
    const z = DATE_ZONES[zone.toLowerCase()];
    if (z === undefined) return raw; // unknown named zone → raw (documented)
    zone = z;
  }
  const dt = new Date(Date.UTC(year, mon, day));
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== mon ||
    dt.getUTCDate() !== day
  ) {
    return raw; // calendar overflow (e.g. Feb 31): datetime() would raise → raw
  }
  return `${DATE_WD[dt.getUTCDay()]}, ${pad2(day)} ${DATE_MON[mon]} ${year} ${pad2(hh)}:${pad2(mm)}:${pad2(ss)} ${zone}`;
}

/** Reference `from_addr`: lowercase the From value, take the address between the
 *  last "<" and ">". The rstrip(">")-then-strip() order is preserved. */
function fromAddr(fromValue: string): string {
  const f = fromValue.toLowerCase();
  if (f.includes("<")) {
    return f.split("<").pop()!.replace(/>+$/, "").trim();
  }
  return f.trim();
}

// ── Minimal MIME parser (ports the subset of Python's `email` this stage uses) ──

interface MimeNode {
  contentType: string; // lowercased "type/subtype"; default "text/plain"
  charset?: string;
  boundary?: string;
  startParam?: string; // multipart/related "start" param
  cte: string; // content-transfer-encoding, lowercased ("" if none)
  disposition: string; // content-disposition type, lowercased ("" if none)
  contentId?: string;
  isMultipart: boolean;
  parts: MimeNode[];
  bodyStart: number; // leaf: raw body byte range in the shared buffer
  bodyEnd: number;
}

/** Split "value; k=v; k2=\"v2\"" into a bare value plus lowercased params. */
function parseParams(raw: string): {
  value: string;
  params: Record<string, string>;
} {
  const params: Record<string, string> = {};
  const segs: string[] = [];
  let cur = "";
  let q = false;
  for (const ch of raw) {
    if (ch === '"') q = !q;
    if (ch === ";" && !q) {
      segs.push(cur);
      cur = "";
    } else cur += ch;
  }
  segs.push(cur);
  const value = (segs.shift() ?? "").trim();
  for (const seg of segs) {
    const eq = seg.indexOf("=");
    if (eq < 0) continue;
    const k = seg.slice(0, eq).trim().toLowerCase();
    let v = seg.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"') && v.length >= 2)
      v = v.slice(1, -1);
    if (k) params[k] = v;
  }
  return { value, params };
}

/** Parse headers from `start` up to the blank line (or a non-header line); return
 *  the header map (lowercased keys → values, folding removed) and the body start. */
function parseHeaders(
  buf: Buffer,
  start: number,
  end: number,
): { headers: Map<string, string[]>; bodyStart: number } {
  const headers = new Map<string, string[]>();
  let cur = "";
  const flush = (): void => {
    if (!cur) return;
    const ci = cur.indexOf(":");
    if (ci > 0) {
      const k = cur.slice(0, ci).trim().toLowerCase();
      const v = cur.slice(ci + 1).trim();
      const arr = headers.get(k);
      if (arr) arr.push(v);
      else headers.set(k, [v]);
    }
    cur = "";
  };
  let i = start;
  while (i < end) {
    let nl = buf.indexOf(0x0a, i);
    if (nl < 0 || nl > end) nl = end;
    let ce = nl; // content end (exclusive), strip a trailing CR
    if (ce > i && buf[ce - 1] === 0x0d) ce--;
    const next = nl < end ? nl + 1 : end;
    if (ce === i) {
      flush(); // blank line ends the headers
      return { headers, bodyStart: next };
    }
    const first = buf[i]!;
    const isCont = first === 0x20 || first === 0x09; // SP or TAB → folded continuation
    const line = buf.toString("latin1", i, ce);
    if (isCont) {
      cur += line; // unfold: the CRLF was the only thing removed by folding
    } else {
      if (line.indexOf(":") <= 0) {
        flush(); // not a header and not a continuation → body starts here
        return { headers, bodyStart: i };
      }
      flush();
      cur = line;
    }
    i = next;
  }
  flush();
  return { headers, bodyStart: end };
}

/** Split a multipart body [start,end) into child [start,end) ranges on `boundary`,
 *  matching RFC 2046 / Python's parser: the CRLF preceding a delimiter belongs to
 *  the delimiter, so it is excluded from the preceding part. */
function splitParts(
  buf: Buffer,
  start: number,
  end: number,
  boundary: string,
): [number, number][] {
  const open = "--" + boundary;
  const close = open + "--";
  const parts: [number, number][] = [];
  let i = start;
  let partStart = -1; // -1 while still in the preamble
  while (i <= end) {
    let nl = buf.indexOf(0x0a, i);
    if (nl < 0 || nl > end) nl = end;
    let ce = nl;
    if (ce > i && buf[ce - 1] === 0x0d) ce--;
    const line = buf.toString("latin1", i, ce).replace(/[ \t]+$/, ""); // trailing WS allowed
    const next = nl < end ? nl + 1 : end + 1;
    if (line === open || line === close) {
      if (partStart >= 0) {
        let pe = i; // drop the single CRLF/LF that precedes this delimiter line
        if (pe > partStart && buf[pe - 1] === 0x0a) {
          pe--;
          if (pe > partStart && buf[pe - 1] === 0x0d) pe--;
        }
        parts.push([partStart, pe]);
      }
      if (line === close) return parts;
      partStart = nl < end ? nl + 1 : end;
    }
    if (nl >= end) break;
    i = next;
  }
  // No closing delimiter: an open part runs to the end of the body.
  if (partStart >= 0 && partStart <= end) parts.push([partStart, end]);
  return parts;
}

function firstHeader(
  headers: Map<string, string[]>,
  key: string,
): string | undefined {
  return headers.get(key)?.[0];
}

function parseNode(buf: Buffer, start: number, end: number): MimeNode {
  const { headers, bodyStart } = parseHeaders(buf, start, end);
  const ct = parseParams(firstHeader(headers, "content-type") ?? "text/plain");
  const contentType = ct.value.toLowerCase() || "text/plain";
  const cdRaw = firstHeader(headers, "content-disposition") ?? "";
  const disposition = cdRaw.split(";")[0]!.trim().toLowerCase();
  const node: MimeNode = {
    contentType,
    charset: ct.params["charset"],
    boundary: ct.params["boundary"],
    startParam: ct.params["start"],
    cte: (firstHeader(headers, "content-transfer-encoding") ?? "")
      .trim()
      .toLowerCase(),
    disposition,
    contentId: firstHeader(headers, "content-id"),
    isMultipart: false,
    parts: [],
    bodyStart,
    bodyEnd: end,
  };
  if (contentType.startsWith("multipart/") && node.boundary) {
    node.isMultipart = true;
    node.parts = splitParts(buf, bodyStart, end, node.boundary).map(([s, e]) =>
      parseNode(buf, s, e),
    );
  }
  return node;
}

function isAttachment(node: MimeNode): boolean {
  return node.disposition === "attachment"; // Python EmailMessage.is_attachment()
}

/**
 * Port of `EmailMessage.get_body(preferencelist=("plain","html"))`: walk the tree
 * for non-attachment text parts, yielding (preference index, part); the FIRST part
 * with the lowest index wins (plain beats html; first plain short-circuits).
 */
function getBody(root: MimeNode): MimeNode | null {
  const pref = ["plain", "html"];
  const found: [number, MimeNode][] = [];
  const walk = (node: MimeNode): void => {
    if (isAttachment(node)) return;
    const slash = node.contentType.indexOf("/");
    const maintype =
      slash >= 0 ? node.contentType.slice(0, slash) : node.contentType;
    const subtype = slash >= 0 ? node.contentType.slice(slash + 1) : "";
    if (maintype === "text") {
      const idx = pref.indexOf(subtype);
      if (idx >= 0) found.push([idx, node]);
      return;
    }
    if (maintype !== "multipart" || subtype === "digest") return;
    if (subtype !== "related") {
      for (const sub of node.parts) walk(sub);
      return;
    }
    // multipart/related: "related" is not in our preferencelist, so only recurse
    // into the root part (the "start" part, else the first).
    let candidate: MimeNode | undefined;
    if (node.startParam)
      candidate = node.parts.find((p) => p.contentId === node.startParam);
    if (!candidate) candidate = node.parts[0];
    if (candidate) walk(candidate);
  };
  walk(root);
  let best = pref.length;
  let body: MimeNode | null = null;
  for (const [prio, node] of found) {
    if (prio < best) {
      best = prio;
      body = node;
      if (prio === 0) break;
    }
  }
  return body;
}

/** Port of `binascii.a2b_qp` (header=False): decode quoted-printable bytes. */
function decodeQuotedPrintable(raw: Buffer): Buffer {
  const out: number[] = [];
  const n = raw.length;
  const isHex = (b: number): boolean =>
    (b >= 0x30 && b <= 0x39) ||
    (b >= 0x41 && b <= 0x46) ||
    (b >= 0x61 && b <= 0x66);
  const hv = (b: number): number =>
    b <= 0x39 ? b - 0x30 : b <= 0x46 ? b - 0x37 : b - 0x57;
  for (let i = 0; i < n; i++) {
    const c = raw[i]!;
    if (c === 0x3d) {
      // '='
      if (i + 1 >= n) break; // trailing '=' at EOF → dropped
      if (raw[i + 1] === 0x0a) {
        i += 1;
        continue;
      } // "=\n" soft break
      if (raw[i + 1] === 0x0d && i + 2 < n && raw[i + 2] === 0x0a) {
        i += 2;
        continue;
      } // "=\r\n" soft break
      if (i + 2 < n && isHex(raw[i + 1]!) && isHex(raw[i + 2]!)) {
        out.push(hv(raw[i + 1]!) * 16 + hv(raw[i + 2]!));
        i += 2;
        continue;
      }
      out.push(c); // lone '=' kept literally
      continue;
    }
    out.push(c);
  }
  return Buffer.from(out);
}

/** Port of `get_payload(decode=True)`: transfer-decode the leaf part to bytes. */
function transferDecode(buf: Buffer, node: MimeNode): Buffer {
  const raw = buf.subarray(node.bodyStart, node.bodyEnd);
  if (node.cte === "base64")
    return Buffer.from(raw.toString("latin1"), "base64");
  if (node.cte === "quoted-printable") return decodeQuotedPrintable(raw);
  return raw; // 7bit / 8bit / binary / none → raw bytes
}

/** Port of the raw_data_manager `get_content()` for a text part: transfer-decode,
 *  then charset-decode with replacement (Python default charset "ASCII"). */
function getContent(buf: Buffer, node: MimeNode): string {
  const bytes = transferDecode(buf, node);
  let charset = node.charset || "ASCII";
  if (!iconv.encodingExists(charset)) charset = "ASCII";
  // Python's bytes.decode keeps a leading BOM; iconv-lite strips it unless told not to.
  return iconv.decode(bytes, charset, { stripBOM: false });
}

/** Reference `body_text`: prefer plain part; else HTML→text; else "". */
function bodyText(buf: Buffer, root: MimeNode): string {
  const part = getBody(root);
  if (part === null) return "";
  let content: string;
  try {
    content = getContent(buf, part);
  } catch {
    return "";
  }
  if (part.contentType === "text/html") content = htmlToText(content);
  return content;
}

// ── mbox splitting ──────────────────────────────────────────────────────────────

/**
 * Split raw mbox bytes into per-message byte slices, matching Python's
 * `mailbox.mbox`: every line beginning with "From " (at column 0) starts a new
 * message, that "From " envelope line is dropped, and a message's content runs to
 * the start of the next "From " line. Content before the first "From " line (if
 * any) belongs to no message, exactly as `_generate_toc` discards it.
 */
function splitMbox(buf: Buffer): [number, number][] {
  const isFromAt = (pos: number): boolean =>
    pos + 5 <= buf.length &&
    buf[pos] === 0x46 && // 'F'
    buf[pos + 1] === 0x72 && // 'r'
    buf[pos + 2] === 0x6f && // 'o'
    buf[pos + 3] === 0x6d && // 'm'
    buf[pos + 4] === 0x20; // ' '

  const starts: number[] = [];
  if (isFromAt(0)) starts.push(0);
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0a && isFromAt(i + 1)) starts.push(i + 1);
  }

  const ranges: [number, number][] = [];
  for (let s = 0; s < starts.length; s++) {
    const start = starts[s]!;
    const nl = buf.indexOf(0x0a, start); // end of the "From " envelope line
    const contentStart = nl < 0 ? buf.length : nl + 1;
    const contentEnd = s + 1 < starts.length ? starts[s + 1]! : buf.length;
    ranges.push([Math.min(contentStart, contentEnd), contentEnd]);
  }
  return ranges;
}

// ── Outlook .olm archives (a ZIP of per-message XML files) ──────────────────────
//
// Ported from `iter_olm_messages` / `_olm_field`. The reference uses Python's
// ElementTree; Node has no built-in XML parser and no XML dependency is available,
// so this is a compact scanner replicating exactly the two operations the
// reference performs: pre-order search for the first element whose tag NAME
// contains a needle, returning that element's text (else its first non-empty
// attribute value). It resolves the five predefined XML entities and numeric refs,
// and reads CDATA literally. DIVERGENCE from ElementTree:
// ElementTree would RAISE on malformed XML (and a strict reader then skips that
// message) whereas this scanner is lenient; and mixed-content nuances (comments
// splitting text into .text/.tail, namespaces, DTD entities) are not modelled.
// This path only runs when *.olm files are present.

function xmlUnescape(s: string): string {
  return s.replace(
    /&(#[0-9]+;|#[xX][0-9a-fA-F]+;|lt;|gt;|amp;|quot;|apos;)/g,
    (m, ref: string) => {
      if (ref[0] === "#") {
        const body = ref.slice(0, -1);
        const num =
          body[1] === "x" || body[1] === "X"
            ? parseInt(body.slice(2), 16)
            : parseInt(body.slice(1), 10);
        return charFromNum(num);
      }
      switch (ref) {
        case "lt;":
          return "<";
        case "gt;":
          return ">";
        case "amp;":
          return "&";
        case "quot;":
          return '"';
        case "apos;":
          return "'";
        default:
          return m;
      }
    },
  );
}

function readElementText(xml: string, pos: number): string {
  let out = "";
  let i = pos;
  while (i < xml.length) {
    if (xml[i] === "<") {
      if (xml.startsWith("<![CDATA[", i)) {
        const end = xml.indexOf("]]>", i + 9);
        if (end < 0) {
          out += xml.slice(i + 9);
          i = xml.length;
        } else {
          out += xml.slice(i + 9, end);
          i = end + 3;
        }
        continue;
      }
      break; // a start tag, end tag, comment or PI terminates .text
    }
    const lt = xml.indexOf("<", i);
    const chunkEnd = lt < 0 ? xml.length : lt;
    out += xmlUnescape(xml.slice(i, chunkEnd));
    i = chunkEnd;
  }
  return out;
}

function olmField(xml: string, needle: string): string {
  const want = needle.toLowerCase();
  let i = 0;
  while (i < xml.length) {
    const lt = xml.indexOf("<", i);
    if (lt < 0) break;
    if (xml.startsWith("<!--", lt)) {
      const e = xml.indexOf("-->", lt + 4);
      i = e < 0 ? xml.length : e + 3;
      continue;
    }
    if (xml.startsWith("<![CDATA[", lt)) {
      const e = xml.indexOf("]]>", lt + 9);
      i = e < 0 ? xml.length : e + 3;
      continue;
    }
    if (xml.startsWith("<?", lt)) {
      const e = xml.indexOf("?>", lt + 2);
      i = e < 0 ? xml.length : e + 2;
      continue;
    }
    if (xml.startsWith("<!", lt)) {
      const e = xml.indexOf(">", lt + 2);
      i = e < 0 ? xml.length : e + 1;
      continue;
    }
    const gt = xml.indexOf(">", lt);
    if (gt < 0) break;
    if (xml[lt + 1] === "/") {
      i = gt + 1; // end tag
      continue;
    }
    let tagContent = xml.slice(lt + 1, gt);
    const selfClosing = tagContent.endsWith("/");
    if (selfClosing) tagContent = tagContent.slice(0, -1);
    const nameMatch = /^([^\s/>]+)/.exec(tagContent);
    const tagName = nameMatch ? nameMatch[1]! : "";
    if (tagName.toLowerCase().includes(want)) {
      const text = selfClosing ? "" : readElementText(xml, gt + 1);
      if (text && text.trim()) return text;
      const attrRe = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
      let am: RegExpExecArray | null;
      while ((am = attrRe.exec(tagContent)) !== null) {
        const v = am[3] !== undefined ? am[3] : (am[4] ?? "");
        if (v) return xmlUnescape(v);
      }
    }
    i = gt + 1;
  }
  return "";
}

interface OlmRow {
  source: string;
  sender: string;
  date: string;
  body: string;
}

function iterOlmMessages(inbox: string): OlmRow[] {
  const rows: OlmRow[] = [];
  let entries: string[];
  try {
    entries = fs.readdirSync(inbox);
  } catch {
    return rows;
  }
  const olms = entries
    .filter((n) => n.endsWith(".olm"))
    .map((n) => path.join(inbox, n))
    .sort();
  for (const olm of olms) {
    let zip: AdmZip;
    try {
      zip = new AdmZip(olm);
    } catch {
      continue;
    }
    const stem = stemOf(olm);
    for (const entry of zip.getEntries()) {
      const low = entry.entryName.toLowerCase();
      if (!low.includes("sent") || !low.endsWith(".xml")) continue;
      let xml: string;
      try {
        xml = entry.getData().toString("utf8");
      } catch {
        continue;
      }
      const sender = olmField(xml, "SenderAddress").toLowerCase().trim();
      let body = olmField(xml, "CopyBody") || olmField(xml, "CopyHTMLBody");
      if (HTMLISH_RE.test(body.slice(0, 400))) body = htmlToText(body);
      rows.push({
        source: stem,
        sender,
        date: olmField(xml, "SentTime"),
        body,
      });
    }
  }
  return rows;
}

// ── mbox discovery ─────────────────────────────────────────────────────────────

/** Python `Path.stem`: filename with its LAST suffix removed. */
function stemOf(file: string): string {
  const base = path.basename(file);
  const ext = path.extname(base);
  return ext ? base.slice(0, base.length - ext.length) : base;
}

interface MboxSource {
  source: string;
  path: string;
}

/** Ported `iter_mboxes`: sent .mbox entries extracted from *.zip archives (in
 *  archive order, per sorted archive), then bare *.mbox files (sorted). */
function iterMboxes(inbox: string, extract: string): MboxSource[] {
  const out: MboxSource[] = [];
  let entries: string[];
  try {
    entries = fs.readdirSync(inbox);
  } catch {
    return out;
  }

  const zips = entries
    .filter((n) => n.endsWith(".zip"))
    .map((n) => path.join(inbox, n))
    .sort();
  for (const z of zips) {
    let zip: AdmZip;
    try {
      zip = new AdmZip(z);
    } catch {
      continue;
    }
    const zStem = stemOf(z);
    for (const entry of zip.getEntries()) {
      const name = entry.entryName;
      const low = name.toLowerCase();
      if (low.endsWith(".mbox") && low.includes("sent")) {
        fs.mkdirSync(extract, { recursive: true });
        const target = path.join(
          extract,
          `${zStem}-${path.posix.basename(name)}`,
        );
        if (!fs.existsSync(target)) fs.writeFileSync(target, entry.getData());
        out.push({ source: zStem, path: target });
      }
    }
  }

  const mboxes = entries
    .filter((n) => n.endsWith(".mbox"))
    .map((n) => path.join(inbox, n))
    .sort();
  for (const m of mboxes) out.push({ source: stemOf(m), path: m });

  return out;
}

// ── Record emission ─────────────────────────────────────────────────────────────

interface RecordResult {
  n: number; // records written
  skippedLocal: number; // chunks/messages skipped
}

/**
 * Reference `write_records`: emit one JSONL record per language chunk. A bounce
 * notice skips the whole message (counts once). Chunks under 5 words are skipped.
 * Record key order (ts, source, lang, words, text) and compact JSON serialization
 * are fixed by the porting contract; non-ASCII stays literal.
 */
function writeRecords(
  out: string[],
  text: string,
  ts: string,
  source: string,
  wordsByLang: Map<string, number>,
): RecordResult {
  if (BOUNCE_RE.test(text)) return { n: 0, skippedLocal: 1 };
  let n = 0;
  let skippedLocal = 0;
  for (const [lang, chunk] of splitByLang(text)) {
    const words = whitespaceSplit(chunk).length;
    if (words < 5) {
      skippedLocal++;
      continue;
    }
    out.push(
      JSON.stringify({
        ts,
        source: `email:${source}`,
        lang,
        words,
        text: chunk,
      }) + "\n",
    );
    wordsByLang.set(lang, (wordsByLang.get(lang) ?? 0) + words);
    n++;
  }
  return { n, skippedLocal };
}

// ── Entry point ─────────────────────────────────────────────────────────────────

/** One parsed mbox message: the top-level From value, raw Date value, and body. */
interface MboxMessage {
  from: string;
  date: string;
  body: string;
}

/**
 * Universal-newline translation (\r\n and lone \r → \n). The reference reads each
 * message through `email.message_from_binary_file`, which wraps the bytes in a
 * `TextIOWrapper` in universal-newlines mode, so the ENTIRE message (headers,
 * boundaries and bodies) is LF-normalized before parsing. Matching this is what
 * makes the `"\n-- \n"` signature split and per-line quote stripping line up.
 * (Encoded newlines like a quoted-printable "=0D=0A" are ordinary
 * characters here and survive to decode as CRLF, exactly as in Python.)
 */
function normalizeNewlines(buf: Buffer): Buffer {
  const out = Buffer.allocUnsafe(buf.length);
  let j = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0d) {
      out[j++] = 0x0a;
      if (i + 1 < buf.length && buf[i + 1] === 0x0a) i++; // consume the \n of \r\n
    } else out[j++] = buf[i]!;
  }
  return out.subarray(0, j);
}

function readMbox(p: string): MboxMessage[] {
  const buf = fs.readFileSync(p);
  const msgs: MboxMessage[] = [];
  for (const [s, e] of splitMbox(buf)) {
    const msg = normalizeNewlines(buf.subarray(s, e));
    const root = parseNode(msg, 0, msg.length);
    const { headers } = parseHeaders(msg, 0, msg.length);
    msgs.push({
      from: firstHeader(headers, "from") ?? "",
      date: firstHeader(headers, "date") ?? "",
      body: bodyText(msg, root),
    });
  }
  return msgs;
}

/**
 * Ingest sent e-mail into corpus/email-sent.jsonl. Returns a process exit code.
 * `argv` is accepted for a uniform stage signature but unused, mirroring the
 * reference `main()` which takes no arguments.
 */
export function runIngestEmail(_argv: string[]): number {
  const corpus = corpusDir();
  const inbox = path.join(corpus, "inbox");
  const extract = path.join(inbox, "extracted");
  const outPath = path.join(corpus, "email-sent.jsonl");

  let kept = 0;
  let skipped = 0;
  let notOwner = 0;
  // Seed the language totals in insertion order; "gr-latn" is
  // appended on first sight. Order decides the stdout summary order below.
  const wordsByLang = new Map<string, number>([
    ["en", 0],
    ["el", 0],
    ["other", 0],
  ]);
  const outChunks: string[] = [];

  // ── mbox path: per source, detect the dominant From address and keep only that
  //    sender's messages, in mailbox order. ──
  for (const { source, path: p } of iterMboxes(inbox, extract)) {
    const msgs = readMbox(p);
    const froms = msgs.map((m) => fromAddr(m.from));
    const counts = new Counter<string>();
    for (const fa of froms) counts.add(fa);
    const owner = counts.size ? counts.mostCommon(1)[0]![0] : "";
    process.stdout.write(
      `${source}: owner address detected (${counts.get(owner)}/${froms.length} messages)\n`,
    );
    for (let k = 0; k < msgs.length; k++) {
      if (froms[k] !== owner) {
        notOwner++;
        continue;
      }
      const text = clean(msgs[k]!.body);
      if (whitespaceSplit(text).length < 5) {
        skipped++;
        continue;
      }
      const r = writeRecords(
        outChunks,
        text,
        formatEmailDate(msgs[k]!.date),
        source,
        wordsByLang,
      );
      kept += r.n;
      skipped += r.skippedLocal;
    }
  }

  // ── Outlook .olm path: group per source (first-seen order), dominant-sender
  //    filter, same guarantee as the mbox path. ──
  const olmBySource = new Map<string, OlmRow[]>();
  for (const row of iterOlmMessages(inbox)) {
    const arr = olmBySource.get(row.source);
    if (arr) arr.push(row);
    else olmBySource.set(row.source, [row]);
  }
  for (const [source, rows] of olmBySource) {
    const counts = new Counter<string>();
    for (const r of rows) if (r.sender) counts.add(r.sender);
    const owner = counts.size ? counts.mostCommon(1)[0]![0] : "";
    process.stdout.write(
      `${source} (olm): owner address detected (${counts.get(owner)}/${rows.length} messages)\n`,
    );
    for (const r of rows) {
      if (r.sender !== owner) {
        notOwner++;
        continue;
      }
      const text = clean(r.body);
      if (whitespaceSplit(text).length < 5) {
        skipped++;
        continue;
      }
      const rec = writeRecords(outChunks, text, r.date, source, wordsByLang);
      kept += rec.n;
      skipped += rec.skippedLocal;
    }
  }

  // The reference opens the output with mode "w" at the start (truncating even
  // when nothing is written); write once here for the same net effect.
  fs.mkdirSync(corpus, { recursive: true });
  fs.writeFileSync(outPath, outChunks.join(""));

  process.stdout.write(
    `kept: ${kept} messages, skipped short/empty: ${skipped}, dropped not-owner: ${notOwner}\n`,
  );
  for (const [lang, w] of wordsByLang) {
    if (w) process.stdout.write(`  ${lang}: ${w} words\n`);
  }
  return 0;
}
