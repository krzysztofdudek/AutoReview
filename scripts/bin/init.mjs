#!/usr/bin/env node
// scripts/bin/init.mjs
import { cp, mkdir, stat, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from '../lib/args.mjs';
import { repoRoot, installPrecommit, gitignoreEnsure } from '../lib/git-utils.mjs';
import { pluginRoot, readFileOrNull } from '../lib/fs-utils.mjs';
import { request } from '../lib/http-client.mjs';
import { pullSource } from '../lib/remote-rules-pull.mjs';
import { parse as parseYaml } from '../lib/yaml-min.mjs';
import { ollamaHasModel } from '../lib/providers/ollama.mjs';

const KNOWN_PROVIDERS = ['ollama', 'anthropic', 'openai', 'google', 'openai-compat', 'claude-code', 'codex', 'gemini-cli'];

async function ollamaReachable() {
  try {
    const r = await request({ url: 'http://localhost:11434/api/tags', timeoutMs: 1000 });
    return r.status === 200;
  } catch { return false; }
}

async function copyPluginRuntime(repoRootPath, root) {
  const dst = join(repoRootPath, '.autoreview/runtime');
  await mkdir(join(dst, 'bin'), { recursive: true });
  await cp(join(root, 'scripts/lib'), join(dst, 'lib'), { recursive: true });
  await cp(join(root, 'scripts/bin/validate.mjs'), join(dst, 'bin/validate.mjs'));
}

export async function run(argv, ctx) {
  try {
    return await _run(argv, ctx);
  } catch (err) {
    ctx.stderr.write(`[error] internal: ${err.stack ?? err.message ?? String(err)}\n`);
    return 2;
  }
}

async function _run(argv, { cwd, env, stdout, stderr }) {
  const { values } = parseArgs(argv, {
    booleans: ['upgrade', 'install-precommit', 'skip-example', 'precommit-overwrite', 'precommit-skip', 'precommit-append'],
  });

  let root;
  try { root = await repoRoot(cwd); }
  catch { stderr.write('[error] not a git repo\n'); return 1; }

  const autoreview = join(root, '.autoreview');
  const existing = await stat(autoreview).catch(() => null);
  if (existing?.isDirectory() && !values.upgrade) {
    stderr.write('[info] .autoreview already exists. Use --upgrade to refresh.\n');
    return 0;
  }

  // Step 2: ensure directory layout
  await mkdir(join(autoreview, 'rules'), { recursive: true });
  await mkdir(join(autoreview, '.history'), { recursive: true });
  await mkdir(join(autoreview, 'runtime'), { recursive: true });
  await mkdir(join(autoreview, 'remote_rules'), { recursive: true });

  // Step 3+4: provider choice
  const chosen = values.provider;
  if (!chosen) {
    const ollamaOk = await ollamaReachable();
    stdout.write('No --provider specified. Options:\n');
    if (ollamaOk) stdout.write('  ollama (recommended — local Ollama reachable)\n');
    else stdout.write('  ollama (install first — http://ollama.ai)\n');
    for (const p of KNOWN_PROVIDERS) if (p !== 'ollama') stdout.write(`  ${p}\n`);
    stderr.write('[error] re-run with --provider <name>\n');
    return 1;
  }
  if (!KNOWN_PROVIDERS.includes(chosen)) {
    stderr.write(`[error] unknown provider '${chosen}'. Choose one of: ${KNOWN_PROVIDERS.join(', ')}\n`);
    return 1;
  }

  // Step 4b: warn if paid provider chosen without API key
  const PAID_PROVIDERS = ['anthropic', 'openai', 'google', 'openai-compat'];
  const ENV_KEYS = {
    anthropic: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
    google: 'GOOGLE_API_KEY',
    'openai-compat': 'OPENAI_COMPAT_API_KEY',
  };
  if (PAID_PROVIDERS.includes(chosen) && !env[ENV_KEYS[chosen]]) {
    stderr.write(`[warn] ${chosen} requires an API key. Set ${ENV_KEYS[chosen]} in your environment or add it to .autoreview/config.secrets.yaml (file is gitignored).\n`);
  }

  // Step 5-7: write config files from templates
  const root_plugin = pluginRoot(import.meta.url, env);
  const repoTemplate = await readFileOrNull(join(root_plugin, 'templates/config-repo.yaml'))
    ?? `version: "0.1"\nprovider:\n  active: ${chosen}\n`;
  // Inject active provider into the repo template if it's the default.
  const repoConfig = repoTemplate.replace(/provider:\s*\n\s*active:\s*\w[\w-]*/, `provider:\n  active: ${chosen}`);
  await writeFile(join(autoreview, 'config.yaml'), repoConfig);

  // §24: auto-pull declared remote sources so the first review run has a cache.
  try {
    const parsed = parseYaml(repoConfig);
    const sources = parsed?.remote_rules ?? [];
    for (const source of sources) {
      try {
        stdout.write(`pulling remote ${source.name}@${source.ref}...\n`);
        await pullSource({ repoRoot: root, source, env });
      } catch (err) {
        stderr.write(`[warn] remote pull failed for ${source.name}: ${err.message}\n`);
      }
    }
  } catch (err) {
    stderr.write(`[warn] remote_rules pull skipped: ${err.message}\n`);
  }

  const personalTemplate = await readFileOrNull(join(root_plugin, 'templates/config-personal.yaml'))
    ?? '# Personal overrides. Gitignored.\n';
  await writeFile(join(autoreview, 'config.personal.yaml'), personalTemplate);

  const secretsTemplate = await readFileOrNull(join(root_plugin, 'templates/config-secrets.yaml'))
    ?? '# Fill in API keys. Gitignored.\n';
  await writeFile(join(autoreview, 'config.secrets.yaml'), secretsTemplate);

  // Step 8: gitignore
  await gitignoreEnsure(root, [
    '.autoreview/config.personal.yaml',
    '.autoreview/config.secrets.yaml',
    '.autoreview/.history/',
    '.autoreview/runtime/',
  ]);

  // Step 9: precommit hook
  if (values['install-precommit']) {
    const precommitBody = await readFileOrNull(join(root_plugin, 'templates/precommit-hook.sh'))
      ?? '#!/usr/bin/env sh\nexec node "$(git rev-parse --show-toplevel)/.autoreview/runtime/bin/validate.mjs" --scope staged --context precommit "$@"\n';
    const status = await installPrecommit(root, precommitBody);
    if (status === 'installed') {
      stdout.write('pre-commit hook installed.\n');
    } else if (status === 'exists-identical') {
      stdout.write('pre-commit hook already installed.\n');
    } else if (status === 'exists-different') {
      const existingBody = await readFile(join(root, '.git/hooks/pre-commit'), 'utf8');
      if (values['precommit-overwrite']) {
        await writeFile(join(root, '.git/hooks/pre-commit'), precommitBody);
        stdout.write('pre-commit hook overwritten.\n');
      } else if (values['precommit-skip']) {
        stdout.write('pre-commit hook: kept existing.\n');
      } else if (values['precommit-append']) {
        await writeFile(join(root, '.git/hooks/pre-commit'), existingBody + '\n' + precommitBody);
        stdout.write('pre-commit hook appended.\n');
      } else {
        stdout.write(`existing hook:\n${existingBody}\n\nproposed hook:\n${precommitBody}\n`);
        stderr.write('[error] pre-commit exists; pass --precommit-overwrite|--precommit-skip|--precommit-append\n');
        return 1;
      }
    }
  } else {
    stdout.write(`pre-commit hook NOT installed (pass --install-precommit to install).\n`);
  }

  // Step 10: copy runtime
  try {
    await copyPluginRuntime(root, root_plugin);
  } catch (err) {
    stderr.write(`[warn] runtime copy failed: ${err.message}\n`);
  }

  // Step 11: example rule
  if (!values['skip-example']) {
    const example = await readFileOrNull(join(root_plugin, 'templates/example-rule.md'));
    if (example) await writeFile(join(autoreview, 'rules/example.md'), example);
  }

  stdout.write(`\n.autoreview/ initialized with provider=${chosen}.\nNext: /autoreview:create-rule or /autoreview:validate\n`);

  // UX: after writing config, check if ollama model is actually pulled.
  if (chosen === 'ollama') {
    const defaultModel = 'qwen2.5-coder:7b';
    const endpoint = env.OLLAMA_HOST ?? 'http://localhost:11434';
    if (await ollamaReachable()) {
      const hasModel = await ollamaHasModel(endpoint, defaultModel);
      if (!hasModel) {
        stdout.write(`\n[next-step] Pull the reviewer model before first use:\n  ollama pull ${defaultModel}\n`);
      }
    } else {
      stdout.write(`\n[next-step] Ollama not detected. Install it (https://ollama.ai), then:\n  ollama serve &\n  ollama pull ${defaultModel}\n`);
    }
  }

  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run(process.argv.slice(2), { cwd: process.cwd(), env: process.env, stdout: process.stdout, stderr: process.stderr })
    .then(c => process.exit(c ?? 0));
}
