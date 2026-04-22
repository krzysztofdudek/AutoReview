import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pullSource } from '../../scripts/lib/remote-rules-pull.mjs';

test('pullSource rejects ext:: remote helper URL', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ar-sec-'));
  try {
    await assert.rejects(
      () => pullSource({ repoRoot: dir, source: { name: 'x', url: 'ext::sh -c evil', ref: 'main', path: '.' } }),
      /https.*http.*git.*ssh/i,
    );
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('pullSource rejects url starting with dash', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ar-sec-'));
  try {
    await assert.rejects(
      () => pullSource({ repoRoot: dir, source: { name: 'x', url: '--upload-pack=evil', ref: 'main', path: '.' } }),
      /cannot start with '-'/,
    );
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('pullSource rejects name with ..', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ar-sec-'));
  try {
    await assert.rejects(
      () => pullSource({ repoRoot: dir, source: { name: '../evil', url: 'https://example.com/x.git', ref: 'main', path: '.' } }),
      /cannot contain|name must match/,
    );
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('pullSource rejects path with ..', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ar-sec-'));
  try {
    await assert.rejects(
      () => pullSource({ repoRoot: dir, source: { name: 'x', url: 'https://example.com/x.git', ref: 'main', path: '../escape' } }),
      /cannot contain/,
    );
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('pullSource rejects empty url', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ar-sec-'));
  try {
    await assert.rejects(
      () => pullSource({ repoRoot: dir, source: { name: 'x', url: '', ref: 'main', path: '.' } }),
      /non-empty string/,
    );
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('pullSource rejects non-string url', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ar-sec-'));
  try {
    await assert.rejects(
      () => pullSource({ repoRoot: dir, source: { name: 'x', url: null, ref: 'main', path: '.' } }),
      /non-empty string/,
    );
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('pullSource rejects name with / (slash)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ar-sec-'));
  try {
    await assert.rejects(
      () => pullSource({ repoRoot: dir, source: { name: '/abs', url: 'https://example.com/x.git', ref: 'main', path: '.' } }),
      /cannot contain|start with|name must match/,
    );
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('pullSource rejects ref starting with dash', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ar-sec-'));
  try {
    await assert.rejects(
      () => pullSource({ repoRoot: dir, source: { name: 'x', url: 'https://example.com/x.git', ref: '-evil', path: '.' } }),
      /cannot contain|start with/,
    );
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('pullSource rejects ref with characters outside allowed set', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ar-sec-'));
  try {
    await assert.rejects(
      () => pullSource({ repoRoot: dir, source: { name: 'x', url: 'https://example.com/x.git', ref: 'bad ref with space', path: '.' } }),
      /ref must match/,
    );
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('pullSource rejects empty name', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ar-sec-'));
  try {
    await assert.rejects(
      () => pullSource({ repoRoot: dir, source: { name: '', url: 'https://example.com/x.git', ref: 'main', path: '.' } }),
      /non-empty string/,
    );
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('pullSource accepts omitted path field (no path check)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ar-sec-'));
  try {
    // url is an unreachable localhost — should fail at clone, not at validation
    await assert.rejects(
      () => pullSource({ repoRoot: dir, source: { name: 'x', url: 'https://127.0.0.1:1/x.git', ref: 'main' } }),
      (err) => !/must match|cannot contain/.test(err.message),
    );
  } finally { await rm(dir, { recursive: true, force: true }); }
});
