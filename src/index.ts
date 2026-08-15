/**
 * Public API for the hyphos library.
 *
 * Re-exports the pipeline stage entry points (runX) and the model-free / model-
 * driven command functions, plus the deterministic enforcement engine
 * (enforce/rules) that other tools most often want to embed directly.
 */

// Deterministic enforcement engine (D-003) and the rules data.
export {
  enforce,
  loadRules,
  applyOne,
  rulesSelftest,
  runRules,
  runEnforce,
  RULES,
  PIPELINE_FIXTURES,
} from "./commands/rules.js";
export type { Rule, RuleKind, RuleTest, EnforceReport } from "./commands/rules.js";

// Model-free scoring and register discovery.
export {
  score,
  textMetrics,
  loadFingerprint,
  registersInfo,
  inferRegister,
  runScore,
} from "./commands/score.js";
export type { ScoreResult, RegisterInfo, InferResult } from "./commands/score.js";

// Model-driven rewrite and the LLM judge (D-005 backends).
export {
  rewrite,
  judge,
  buildPrompt,
  injectTypos,
  callClaudeCli,
  callApi,
  runRewrite,
} from "./commands/rewrite.js";

// Blind self-test.
export { blind, runBlind } from "./commands/blind.js";

// Local web server and feedback log.
export { serve, runServe, recordFeedback } from "./commands/serve.js";
export type { FeedbackResult } from "./commands/serve.js";

// JSON helpers with Python-matching semantics (used across the ports).
export { PyFloat, pyDumps, pyJsonParse } from "./commands/pyjson.js";
export { SysExit } from "./commands/sysexit.js";

// Corpus pipeline stages.
export { runExtract } from "./stages/extract.js";
export { runCurate } from "./stages/curate.js";
export { runTag } from "./stages/tag.js";
export { runSalvage } from "./stages/salvage.js";
export { runIngestChat } from "./stages/ingestChat.js";
export { runIngestEmail } from "./stages/ingestEmail.js";
export { runFingerprint } from "./stages/fingerprint.js";
