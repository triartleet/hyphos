/**
 * The local web app and the feedback log.
 *
 * `serve` runs the Translate-style UI on localhost only (D-001: the data plane
 * never leaves the machine; the server binds 127.0.0.1). It exposes JSON
 * endpoints — registers, infer, feedback, rewrite, enforce, score — with fixed
 * routing, error mapping (a `SysExit` becomes an HTTP 502), and compact
 * `ensure_ascii=False` JSON responses.
 *
 * `record_feedback` appends a verdict to `corpus/feedback.jsonl` and returns
 * aggregate counts plus a suggestion once enough negative evidence accumulates.
 *
 * Static files are served from `$HYPHOS_WEB` or `./web` under the current
 * working directory (unlike corpus/profiles, which resolve from the package
 * root via ../lib/paths).
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { corpusDir } from "../lib/paths.js";
import { pyDumps } from "./pyjson.js";
import { SysExit } from "./sysexit.js";
import {
  registersInfo,
  inferRegister,
  score,
  type ScoreResult,
} from "./score.js";
import { rewrite, judge } from "./rewrite.js";
import { enforce } from "./rules.js";

const TYPES: Record<string, string> = {
  ".html": "text/html",
  ".json": "application/json",
  ".js": "text/javascript",
  ".svg": "image/svg+xml",
  ".css": "text/css",
  ".webmanifest": "application/manifest+json",
};

type Verdict = "good" | "fine" | "bad";

function webDir(): string {
  return process.env.HYPHOS_WEB ?? path.join(process.cwd(), "web");
}

// Python datetime.now().isoformat(timespec="seconds"): local time, no timezone.
function isoSeconds(d: Date): string {
  const p = (x: number): string => String(x).padStart(2, "0");
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  );
}

export interface FeedbackResult {
  counts: Record<Verdict, number>;
  suggestion: string | null;
}

/** Append a good/fine/bad verdict and return aggregate counts plus a suggestion. */
export function recordFeedback(entry: Record<string, unknown>): FeedbackResult {
  const fb = path.join(corpusDir(), "feedback.jsonl");
  const rec = {
    ts: isoSeconds(new Date()),
    register: (entry.register as string | undefined) ?? "?",
    verdict: (entry.verdict as string | undefined) ?? "fine",
    note: String((entry.note as string | undefined) || "").slice(0, 500),
  };
  fs.appendFileSync(fb, pyDumps(rec, { ensureAscii: false }) + "\n");

  const counts: Record<Verdict, number> = { good: 0, fine: 0, bad: 0 };
  for (const line of fs.readFileSync(fb, "utf8").split("\n")) {
    if (line.length === 0) continue;
    const o = JSON.parse(line) as { register?: string; verdict?: string };
    if (
      o.register === rec.register &&
      o.verdict &&
      (["good", "fine", "bad"] as string[]).includes(o.verdict)
    ) {
      counts[o.verdict as Verdict]++;
    }
  }
  let suggestion: string | null = null;
  if (counts.bad >= 3 && counts.bad > counts.good) {
    suggestion =
      "this register keeps disappointing — expand its source " +
      "material (drop samples in corpus/) or revisit its style " +
      "guide; the justifications in corpus/feedback.jsonl say why";
  }
  return { counts, suggestion };
}

function sendJson(res: http.ServerResponse, code: number, obj: unknown): void {
  const body = Buffer.from(pyDumps(obj, { ensureAscii: false }), "utf8");
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": String(body.length),
  });
  res.end(body);
}

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function handleGet(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  web: string,
): void {
  const urlPath = (req.url ?? "/").split("?")[0]!;
  const name = urlPath.replace(/^\/+/, "") || "index.html";
  const webResolved = path.resolve(web);
  const resolved = path.resolve(web, name);
  // web must be a strict ancestor of the resolved path (blocks traversal).
  const rel = path.relative(webResolved, resolved);
  const inside = rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
  let isFile = false;
  try {
    isFile = fs.statSync(resolved).isFile();
  } catch {
    isFile = false;
  }
  if (!isFile || !inside) {
    res.statusCode = 404;
    res.end();
    return;
  }
  const body = fs.readFileSync(resolved);
  const ctype = TYPES[path.extname(resolved)] ?? "application/octet-stream";
  res.writeHead(200, {
    "Content-Type": ctype,
    "Content-Length": String(body.length),
  });
  res.end(body);
}

async function handlePost(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  try {
    const raw = await readBody(req);
    const body = JSON.parse(
      raw.length > 0 ? raw.toString("utf8") : "{}",
    ) as Record<string, unknown>;
    const text = (body.text as string | undefined) ?? "";
    const register0 = (body.register as string | undefined) ?? "editorial";
    const route = req.url ?? ""; // matches Python self.path (query included)

    if (route === "/api/registers") {
      sendJson(res, 200, { registers: registersInfo() });
    } else if (route === "/api/infer") {
      sendJson(res, 200, inferRegister(text));
    } else if (route === "/api/feedback") {
      sendJson(res, 200, recordFeedback(body));
    } else if (route === "/api/rewrite") {
      let inferred: unknown = null;
      let register = register0;
      if (register === "auto") {
        inferred = inferRegister(text);
        register = (inferred as { register: string }).register;
      }
      const [out, rep, backend] = await rewrite(
        register,
        text,
        (body.backend as string | undefined) ?? "auto",
        (body.typos as string | undefined) ?? "none",
      );
      const sc: ScoreResult = score(out, register);
      if (body.judge)
        sc.judge = await judge(
          out,
          register,
          (body.backend as string | undefined) ?? "auto",
        );
      sendJson(res, 200, {
        text: out,
        enforcement: rep,
        backend,
        register,
        inferred,
        score: sc,
      });
    } else if (route === "/api/enforce") {
      const [out, rep] = enforce(text);
      sendJson(res, 200, { text: out, enforcement: rep });
    } else if (route === "/api/score") {
      sendJson(res, 200, score(text, register0));
    } else {
      sendJson(res, 404, { error: "unknown endpoint" });
    }
  } catch (e) {
    if (e instanceof SysExit) sendJson(res, 502, { error: e.message });
    else
      sendJson(res, 500, { error: e instanceof Error ? e.message : String(e) });
  }
}

/** Start the local-only web server. Runs until interrupted. */
export function serve(port: number): void {
  const web = webDir();
  const server = http.createServer((req, res) => {
    if (req.method === "GET") {
      handleGet(req, res, web);
    } else if (req.method === "POST") {
      void handlePost(req, res);
    } else {
      res.statusCode = 501;
      res.end();
    }
  });
  server.listen(port, "127.0.0.1", () => {
    process.stdout.write(
      `hyphos serving on http://127.0.0.1:${port} (local only, Ctrl-C stops)\n`,
    );
  });
}

/** `serve` subcommand entry. */
export function runServe(opts: { port: number }): void {
  serve(opts.port);
}
