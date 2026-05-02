import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir, stat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { run } from '../../scripts/bin/validate.mjs';
import { makeRepo } from '../lib/git-helpers.mjs';

function captureStreams() {
  const out = [], err = [];
  return {
    stdout: { write: (s) => out.push(s) },
    stderr: { write: (s) => err.push(s) },
    out: () => out.join(''),
    err: () => err.join(''),
  };
}

test('internal crash in validate context exits 2 (3-state spec §28)', async () => {
  const { dir, run: git, cleanup } = await makeRepo();
  try {
    await mkdir(join(dir, '.autoreview/rules'), { recursive: true });
    await writeFile(join(dir, '.autoreview/config.yaml'),
      'tiers:\n  default:\n    provider: ollama\n    model: stub\n    endpoint: http://localhost:11434\n');
    await writeFile(join(dir, '.autoreview/rules/r.md'), `---\nname: R\ntriggers: 'path:"**/*.ts"'\n---\nbody`);
    await writeFile(join(dir, 'a.ts'), 'x');
    git('add', 'a.ts');
    const streams = captureStreams();
    // Mutually-exclusive scope args trigger a throw from scope-resolver inside _run
    const code = await run(['--scope', 'staged', '--sha', 'HEAD'], {
      cwd: dir, env: process.env, ...streams,
    });
    assert.equal(code, 2);
    assert.match(streams.err(), /\[error\] internal/);
  } finally { await cleanup(); }
});

test('exits 0 with warning when .autoreview missing', async () => {
  const { dir, cleanup } = await makeRepo();
  try {
    const streams = captureStreams();
    const code = await run([], { cwd: dir, env: process.env, ...streams });
    assert.equal(code, 0);
    assert.match(streams.err(), /not initialized/i);
  } finally { await cleanup(); }
});

test('hard context: failed rule -> exit 1', async () => {
  const { dir, run: git, cleanup } = await makeRepo();
  try {
    await mkdir(join(dir, '.autoreview/rules'), { recursive: true });
    await writeFile(join(dir, '.autoreview/config.yaml'),
      'tiers:\n  default:\n    provider: ollama\n    model: stub\n    endpoint: http://localhost:11434\n');
    await writeFile(join(dir, '.autoreview/rules/r.md'), `---\nname: R\ntriggers: 'path:"**/*.ts"'\nseverity: error\n---\nbody`);
    await writeFile(join(dir, 'a.ts'), 'x');
    git('add', 'a.ts');
    const streams = captureStreams();
    const code = await run(['--scope', 'staged'], {
      cwd: dir, env: { ...process.env, AUTOREVIEW_STUB_PROVIDER: 'fail' }, ...streams,
    });
    assert.equal(code, 1);
    assert.match(streams.err(), /\[reject\]/);
  } finally { await cleanup(); }
});

test('warning-severity: failed rule -> exit 0 with [warn]', async () => {
  const { dir, run: git, cleanup } = await makeRepo();
  try {
    await mkdir(join(dir, '.autoreview/rules'), { recursive: true });
    await writeFile(join(dir, '.autoreview/config.yaml'),
      'tiers:\n  default:\n    provider: ollama\n    model: stub\n    endpoint: http://localhost:11434\n');
    await writeFile(join(dir, '.autoreview/rules/r.md'), `---\nname: R\ntriggers: 'path:"**/*.ts"'\nseverity: warning\n---\nbody`);
    await writeFile(join(dir, 'a.ts'), 'x');
    git('add', 'a.ts');
    const streams = captureStreams();
    const code = await run(['--scope', 'staged'], {
      cwd: dir, env: { ...process.env, AUTOREVIEW_STUB_PROVIDER: 'fail' }, ...streams,
    });
    assert.equal(code, 0);
    assert.match(streams.err(), /\[warn\]/);
  } finally { await cleanup(); }
});

test('precommit honours tier consensus (no global cap)', async () => {
  const { dir, run: git, cleanup } = await makeRepo();
  try {
    await mkdir(join(dir, '.autoreview/rules'), { recursive: true });
    await writeFile(join(dir, '.autoreview/config.yaml'),
      'tiers:\n  default:\n    provider: ollama\n    model: stub\n    endpoint: http://localhost:11434\n    consensus: 3\n');
    await writeFile(join(dir, '.autoreview/rules/r.md'), `---\nname: R\ntriggers: 'path:"**/*.ts"'\n---\nbody`);
    await writeFile(join(dir, 'a.ts'), 'x');
    git('add', 'a.ts');
    const streams = captureStreams();
    const code = await run(['--scope', 'staged', '--context', 'precommit'], {
      cwd: dir, env: { ...process.env, AUTOREVIEW_STUB_PROVIDER: 'pass' }, ...streams,
    });
    assert.equal(code, 0);
  } finally { await cleanup(); }
});

test('stub pass: exit 0 with [pass]', async () => {
  const { dir, run: git, cleanup } = await makeRepo();
  try {
    await mkdir(join(dir, '.autoreview/rules'), { recursive: true });
    await writeFile(join(dir, '.autoreview/config.yaml'),
      'tiers:\n  default:\n    provider: ollama\n    model: stub\n    endpoint: http://localhost:11434\n');
    await writeFile(join(dir, '.autoreview/rules/r.md'), `---\nname: R\ntriggers: 'path:"**/*.ts"'\n---\nbody`);
    await writeFile(join(dir, 'a.ts'), 'x');
    git('add', 'a.ts');
    const streams = captureStreams();
    const code = await run(['--scope', 'staged'], {
      cwd: dir, env: { ...process.env, AUTOREVIEW_STUB_PROVIDER: 'pass' }, ...streams,
    });
    assert.equal(code, 0);
    assert.match(streams.err(), /\[pass\]/);
  } finally { await cleanup(); }
});

test('stub error on severity:error rule exits 1 with [error] (spec §5 exit policy)', async () => {
  const { dir, run: git, cleanup } = await makeRepo();
  try {
    await mkdir(join(dir, '.autoreview/rules'), { recursive: true });
    await writeFile(join(dir, '.autoreview/config.yaml'),
      'tiers:\n  default:\n    provider: ollama\n    model: stub\n    endpoint: http://localhost:11434\n');
    await writeFile(join(dir, '.autoreview/rules/r.md'), `---\nname: R\ntriggers: 'path:"**/*.ts"'\nseverity: error\n---\nbody`);
    await writeFile(join(dir, 'a.ts'), 'x');
    git('add', 'a.ts');
    const streams = captureStreams();
    const code = await run(['--scope', 'staged'], {
      cwd: dir, env: { ...process.env, AUTOREVIEW_STUB_PROVIDER: 'error' }, ...streams,
    });
    assert.equal(code, 1);
    assert.match(streams.err(), /\[error\]/);
  } finally { await cleanup(); }
});

test('stub error on severity:warning rule exits 0 with [error]', async () => {
  const { dir, run: git, cleanup } = await makeRepo();
  try {
    await mkdir(join(dir, '.autoreview/rules'), { recursive: true });
    await writeFile(join(dir, '.autoreview/config.yaml'),
      'tiers:\n  default:\n    provider: ollama\n    model: stub\n    endpoint: http://localhost:11434\n');
    await writeFile(join(dir, '.autoreview/rules/r.md'), `---\nname: R\ntriggers: 'path:"**/*.ts"'\nseverity: warning\n---\nbody`);
    await writeFile(join(dir, 'a.ts'), 'x');
    git('add', 'a.ts');
    const streams = captureStreams();
    const code = await run(['--scope', 'staged'], {
      cwd: dir, env: { ...process.env, AUTOREVIEW_STUB_PROVIDER: 'error' }, ...streams,
    });
    assert.equal(code, 0);
    assert.match(streams.err(), /\[error\]/);
  } finally { await cleanup(); }
});

test('validate --content-file + --target-path runs reviewer on hypothetical content (§15)', async () => {
  const { dir, cleanup } = await makeRepo();
  try {
    await mkdir(join(dir, '.autoreview/rules'), { recursive: true });
    await writeFile(join(dir, '.autoreview/config.yaml'),
      'tiers:\n  default:\n    provider: ollama\n    model: stub\n    endpoint: http://localhost:11434\n');
    await writeFile(join(dir, '.autoreview/rules/r.md'),
      `---\nname: R\ntriggers: 'path:"src/api/**/*.ts"'\n---\nbody`);
    const draft = join(dir, 'draft.txt');
    await writeFile(draft, 'hypothetical content');
    const streams = captureStreams();
    const code = await run([
      '--content-file', draft,
      '--target-path', 'src/api/users.ts',
    ], { cwd: dir, env: { ...process.env, AUTOREVIEW_STUB_PROVIDER: 'pass' }, ...streams });
    assert.equal(code, 0);
    assert.match(streams.err(), /\[pass\] src\/api\/users\.ts/);
  } finally { await cleanup(); }
});

test('validate warns when declared remote source is not cached', async () => {
  const { dir, run: git, cleanup } = await makeRepo();
  try {
    await mkdir(join(dir, '.autoreview/rules'), { recursive: true });
    await writeFile(join(dir, '.autoreview/config.yaml'),
      'tiers:\n  default:\n    provider: ollama\n    model: stub\n    endpoint: http://localhost:11434\nremote_rules:\n  - name: missing\n    url: "http://nowhere"\n    ref: v1\n    path: .\n');
    await writeFile(join(dir, 'a.ts'), 'x');
    git('add', 'a.ts');
    const streams = captureStreams();
    const code = await run(['--scope', 'staged'], {
      cwd: dir, env: { ...process.env, AUTOREVIEW_STUB_PROVIDER: 'pass' }, ...streams,
    });
    assert.equal(code, 0);
    assert.match(streams.err(), /remote source 'missing@v1' has no cache/);
  } finally { await cleanup(); }
});




test('precommit quick mode with reject prints debug hint', async () => {
  const { dir, run: git, cleanup } = await makeRepo();
  try {
    await mkdir(join(dir, '.autoreview/rules'), { recursive: true });
    await writeFile(join(dir, '.autoreview/config.yaml'),
      'tiers:\n  default:\n    provider: ollama\n    model: stub\n    endpoint: http://localhost:11434\n');
    await writeFile(join(dir, '.autoreview/rules/r.md'),
      `---\nname: R\ntriggers: 'path:"**/*.ts"'\nseverity: error\n---\nbody`);
    await writeFile(join(dir, 'a.ts'), 'x');
    git('add', 'a.ts');
    const streams = captureStreams();
    const code = await run(['--scope', 'staged', '--context', 'precommit'], {
      cwd: dir, env: { ...process.env, AUTOREVIEW_STUB_PROVIDER: 'fail' }, ...streams,
    });
    assert.equal(code, 1);
    assert.match(streams.err(), /\[hint\]/i);
    assert.match(streams.err(), /thinking/i);
  } finally { await cleanup(); }
});

test('precommit thinking mode with reject does NOT print debug hint', async () => {
  const { dir, run: git, cleanup } = await makeRepo();
  try {
    await mkdir(join(dir, '.autoreview/rules'), { recursive: true });
    await writeFile(join(dir, '.autoreview/config.yaml'),
      'tiers:\n  default:\n    provider: ollama\n    model: stub\n    endpoint: http://localhost:11434\n    mode: thinking\n');
    await writeFile(join(dir, '.autoreview/rules/r.md'),
      `---\nname: R\ntriggers: 'path:"**/*.ts"'\nseverity: error\n---\nbody`);
    await writeFile(join(dir, 'a.ts'), 'x');
    git('add', 'a.ts');
    const streams = captureStreams();
    const code = await run(['--scope', 'staged', '--context', 'precommit'], {
      cwd: dir, env: { ...process.env, AUTOREVIEW_STUB_PROVIDER: 'fail' }, ...streams,
    });
    assert.equal(code, 1);
    assert.doesNotMatch(streams.err(), /\[hint\]/i);
  } finally { await cleanup(); }
});

test('parallel fan-out: 5 files × 4 rules = 20 verdicts at parallel: 5 (spec §F.1)', async () => {
  const { dir, run: git, cleanup } = await makeRepo();
  try {
    await mkdir(join(dir, '.autoreview/rules'), { recursive: true });
    await writeFile(join(dir, '.autoreview/config.yaml'),
      'tiers:\n  default:\n    provider: ollama\n    model: stub\n    endpoint: http://localhost:11434\n    parallel: 5\n');
    for (let r = 0; r < 4; r++) {
      await writeFile(join(dir, `.autoreview/rules/r${r}.md`),
        `---\nname: R${r}\ntriggers: 'path:"**/*.ts"'\n---\nbody`);
    }
    for (let i = 0; i < 5; i++) {
      await writeFile(join(dir, `f${i}.ts`), `const x${i} = 1;`);
      git('add', `f${i}.ts`);
    }
    const streams = captureStreams();
    const code = await run(['--scope', 'staged'], {
      cwd: dir, env: { ...process.env, AUTOREVIEW_STUB_PROVIDER: 'pass' }, ...streams,
    });
    assert.equal(code, 0);
    const passLines = streams.err().split('\n').filter(l => l.startsWith('[pass]'));
    assert.equal(passLines.length, 20);
    const day = new Date().toISOString().slice(0, 10);
    const body = await readFile(join(dir, '.autoreview/.history', `${day}.jsonl`), 'utf8');
    const recs = body.trim().split('\n').map(JSON.parse);
    const summaries = recs.filter(r => r.type === 'file-summary');
    assert.equal(summaries.length, 5, 'one file-summary per file');
    for (const s of summaries) {
      assert.equal(s.matched_rules.length, 4, `${s.file} should have 4 matched rules`);
    }
  } finally { await cleanup(); }
});

test('file matching zero rules emits empty file-summary', async () => {
  const { dir, run: git, cleanup } = await makeRepo();
  try {
    await mkdir(join(dir, '.autoreview/rules'), { recursive: true });
    await writeFile(join(dir, '.autoreview/config.yaml'),
      'tiers:\n  default:\n    provider: ollama\n    model: stub\n    endpoint: http://localhost:11434\n');
    await writeFile(join(dir, '.autoreview/rules/r.md'), `---\nname: R\ntriggers: 'path:"**/*.ts"'\n---\nbody`);
    await writeFile(join(dir, 'README.md'), 'docs');
    git('add', 'README.md');
    const streams = captureStreams();
    const code = await run(['--scope', 'staged'], {
      cwd: dir, env: { ...process.env, AUTOREVIEW_STUB_PROVIDER: 'pass' }, ...streams,
    });
    assert.equal(code, 0);
    const day = new Date().toISOString().slice(0, 10);
    const body = await readFile(join(dir, '.autoreview/.history', `${day}.jsonl`), 'utf8');
    const records = body.trim().split('\n').map(JSON.parse);
    const summaries = records.filter(r => r.type === 'file-summary');
    assert.equal(summaries.length, 1);
    assert.equal(summaries[0].file, 'README.md');
    assert.deepEqual(summaries[0].matched_rules, []);
  } finally { await cleanup(); }
});

test('large run prints [info] cost warning when pairs × consensus > 100', async () => {
  const { dir, run: git, cleanup } = await makeRepo();
  try {
    await mkdir(join(dir, '.autoreview/rules'), { recursive: true });
    await writeFile(join(dir, '.autoreview/config.yaml'),
      'tiers:\n  default:\n    provider: ollama\n    model: stub\n    endpoint: http://localhost:11434\n');
    for (let r = 0; r < 11; r++) {
      await writeFile(join(dir, `.autoreview/rules/r${r}.md`),
        `---\nname: R${r}\ntriggers: 'path:"**/*.ts"'\n---\nbody`);
    }
    for (let i = 0; i < 10; i++) {
      await writeFile(join(dir, `f${i}.ts`), `const x${i} = 1;`);
      git('add', `f${i}.ts`);
    }
    const streams = captureStreams();
    const code = await run(['--scope', 'staged'], {
      cwd: dir, env: { ...process.env, AUTOREVIEW_STUB_PROVIDER: 'pass' }, ...streams,
    });
    assert.equal(code, 0);
    assert.match(streams.err(), /\[info\] .*110.*pair/i);
  } finally { await cleanup(); }
});

test('small run does NOT print [info] cost warning', async () => {
  const { dir, run: git, cleanup } = await makeRepo();
  try {
    await mkdir(join(dir, '.autoreview/rules'), { recursive: true });
    await writeFile(join(dir, '.autoreview/config.yaml'),
      'tiers:\n  default:\n    provider: ollama\n    model: stub\n    endpoint: http://localhost:11434\n');
    await writeFile(join(dir, '.autoreview/rules/r.md'),
      `---\nname: R\ntriggers: 'path:"**/*.ts"'\n---\nbody`);
    await writeFile(join(dir, 'a.ts'), 'x');
    git('add', 'a.ts');
    const streams = captureStreams();
    await run(['--scope', 'staged'], {
      cwd: dir, env: { ...process.env, AUTOREVIEW_STUB_PROVIDER: 'pass' }, ...streams,
    });
    assert.doesNotMatch(streams.err(), /\[info\] .*pair/i);
  } finally { await cleanup(); }
});



test('Promise.all wrapped in try/finally — historySession.close runs (spec §E.1.5, §F.1 Ctrl-C)', async () => {
  const { dir, run: git, cleanup } = await makeRepo();
  try {
    await mkdir(join(dir, '.autoreview/rules'), { recursive: true });
    await writeFile(join(dir, '.autoreview/config.yaml'),
      'tiers:\n  default:\n    provider: ollama\n    model: stub\n    endpoint: http://localhost:11434\n');
    await writeFile(join(dir, '.autoreview/rules/r.md'),
      `---\nname: R\ntriggers: 'path:"**/*.ts"'\n---\nbody`);
    await writeFile(join(dir, 'a.ts'), 'x');
    git('add', 'a.ts');
    const streams = captureStreams();
    await run(['--scope', 'staged'], {
      cwd: dir, env: { ...process.env, AUTOREVIEW_STUB_PROVIDER: 'pass' }, ...streams,
    });
    const day = new Date().toISOString().slice(0, 10);
    const stats = await stat(join(dir, '.autoreview/.history', `${day}.jsonl`));
    assert.ok(stats.size > 0, 'history file must be flushed and non-empty after run completes');
  } finally { await cleanup(); }
});

test('benchmark §F.3.4: parallel:10 vs parallel:1 over 100 pairs ≥ 5× speedup with all verdicts present', async () => {
  // Spec §F.3 acceptance criterion #4: at parallel: 10 the stub-based validate run on 100 pairs
  // (20 files × 5 rules) must be at least 5× faster than parallel: 1, and all 100 verdicts must
  // be emitted both runs. The stub honours AUTOREVIEW_STUB_DELAY_MS (per-call latency) and
  // AUTOREVIEW_STUB_PARALLEL (semaphore cap) so we can observe the validate.mjs fan-out shape.
  // Per-call latency must dominate the fixed per-pair overhead (history append, prompt build,
  // verdict report — ~5–8ms each) for the 5× ratio to be reliable.
  const setup = async () => {
    const { dir, run: git, cleanup } = await makeRepo();
    await mkdir(join(dir, '.autoreview/rules'), { recursive: true });
    await writeFile(join(dir, '.autoreview/config.yaml'),
      'tiers:\n  default:\n    provider: ollama\n    model: stub\n    endpoint: http://localhost:11434\n');
    for (let r = 0; r < 5; r++) {
      await writeFile(join(dir, `.autoreview/rules/r${r}.md`),
        `---\nname: R${r}\ntriggers: 'path:"**/*.ts"'\n---\nbody`);
    }
    for (let i = 0; i < 20; i++) {
      await writeFile(join(dir, `f${i}.ts`), `const x${i} = 1;`);
      git('add', `f${i}.ts`);
    }
    return { dir, cleanup };
  };

  const runOnce = async (parallel) => {
    const { dir, cleanup } = await setup();
    try {
      const streams = captureStreams();
      const start = Date.now();
      const code = await run(['--scope', 'staged'], {
        cwd: dir,
        env: {
          ...process.env,
          AUTOREVIEW_STUB_PROVIDER: 'pass',
          AUTOREVIEW_STUB_DELAY_MS: '100',
          AUTOREVIEW_STUB_PARALLEL: String(parallel),
        },
        ...streams,
      });
      const elapsed = Date.now() - start;
      const passLines = streams.err().split('\n').filter(l => l.startsWith('[pass]')).length;
      assert.equal(code, 0);
      assert.equal(passLines, 100, `expected 100 [pass] lines for 20×5 fan-out at parallel=${parallel}`);
      return elapsed;
    } finally { await cleanup(); }
  };

  const sequential = await runOnce(1);
  const parallel10 = await runOnce(10);
  const ratio = sequential / parallel10;
  assert.ok(ratio >= 5,
    `expected sequential/parallel10 ratio >= 5, got ${ratio.toFixed(2)}× (seq=${sequential}ms, par10=${parallel10}ms)`);
});
