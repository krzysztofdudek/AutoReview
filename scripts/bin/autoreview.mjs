#!/usr/bin/env node
// scripts/bin/autoreview.mjs — unified CLI entry. Routes to subcommands.

const SUBCOMMANDS = {
  init: () => import('./init.mjs'),
  validate: () => import('./validate.mjs'),
  review: () => import('./validate.mjs'),           // alias per spec §13
  'create-rule': () => import('./create-rule.mjs'),
  'check-breadth': () => import('./check-breadth.mjs'),
  context: () => import('./context.mjs'),
  guide: () => import('./guide.mjs'),
  'pull-remote': () => import('./pull-remote.mjs'),
  'reviewer-test': () => import('./reviewer-test.mjs'),
  history: () => import('./history.mjs'),
};

export async function run(argv, ctx) {
  const [sub, ...rest] = argv;
  if (!sub || sub === '--help' || sub === '-h') {
    ctx.stdout.write(`autoreview <subcommand> [args]\n\nSubcommands:\n  ${Object.keys(SUBCOMMANDS).join('\n  ')}\n`);
    return 0;
  }
  const loader = SUBCOMMANDS[sub];
  if (!loader) {
    ctx.stderr.write(`[error] unknown subcommand: ${sub}\n`);
    return 1;
  }
  const mod = await loader();
  return mod.run(rest, ctx);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run(process.argv.slice(2), {
    cwd: process.cwd(), env: process.env,
    stdout: process.stdout, stderr: process.stderr,
  }).then(c => process.exit(c ?? 0));
}
