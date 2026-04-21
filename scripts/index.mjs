// scripts/index.mjs — Public JS API for AutoReview.
// Stable surface for IDE extensions, CI, and agent integrations (spec §14).

export { loadConfig, DEFAULT_CONFIG } from './lib/config-loader.mjs';
export { loadRules } from './lib/rule-loader.mjs';
export { reviewFile } from './lib/reviewer.mjs';
export { resolveScope } from './lib/scope-resolver.mjs';
export { getProvider, clearProviderCache } from './lib/provider-client.mjs';
export { parse as parseTrigger, evaluate as evaluateTrigger, matchPath } from './lib/trigger-engine.mjs';
export { buildPrompt } from './lib/prompt-builder.mjs';
export { parseResponse } from './lib/response-parser.mjs';
export { appendVerdict, appendFileSummary } from './lib/history.mjs';
export { scanSuppressMarkers } from './lib/suppress-parser.mjs';
export { createIntentGate } from './lib/intent-gate.mjs';
export { pullSource } from './lib/remote-rules-pull.mjs';
// Subcommand runners:
export { run as runValidate } from './bin/validate.mjs';
export { run as runInit } from './bin/init.mjs';
export { run as runCreateRule } from './bin/create-rule.mjs';
export { run as runCheckBreadth } from './bin/check-breadth.mjs';
export { run as runContext } from './bin/context.mjs';
export { run as runGuide } from './bin/guide.mjs';
export { run as runPullRemote } from './bin/pull-remote.mjs';
