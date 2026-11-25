#!/usr/bin/env node
// Runs the green LFEA check set listed in scripts/ci-checks.json with a small
// worker pool. Each check is an independent `node <script>` process.
//
//   node scripts/run-ci-checks.mjs                 # all non-browser checks
//   node scripts/run-ci-checks.mjs --browser-only  # checks that launch Chromium
//   node scripts/run-ci-checks.mjs --jobs 2
//
// Exits non-zero if any check fails, and prints each failure's output tail.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BROWSER_CHECKS = new Set(['scripts/lfea-phase6h-demo-browser-check.mjs']);
const TIMEOUT_MS = 10 * 60 * 1000;

const args = process.argv.slice(2);
const browserOnly = args.includes('--browser-only');
const jobsIndex = args.indexOf('--jobs');
const jobs = jobsIndex >= 0 ? Number(args[jobsIndex + 1]) : Math.max(1, Math.min(4, os.cpus().length));

const { checks } = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/ci-checks.json'), 'utf8'));
const list = checks.filter((check) => BROWSER_CHECKS.has(check) === browserOnly);

const failures = [];
let next = 0;
let done = 0;

function runOne(check) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [check], { cwd: ROOT });
    let tail = '';
    const keep = (chunk) => { tail = (tail + chunk).slice(-6000); };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    const timer = setTimeout(() => { tail += '\n[run-ci-checks] timed out'; child.kill(); }, TIMEOUT_MS);
    child.on('close', (code) => {
      clearTimeout(timer);
      done += 1;
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      console.log(`[${done}/${list.length}] ${code === 0 ? 'PASS' : 'FAIL'} ${check} (${seconds}s)`);
      if (code !== 0) failures.push({ check, tail });
      resolve();
    });
  });
}

async function worker() {
  while (next < list.length) await runOne(list[next++]);
}

await Promise.all(Array.from({ length: jobs }, worker));

if (failures.length) {
  for (const { check, tail } of failures) console.error(`\n===== ${check} =====\n${tail}`);
  console.error(`\n${failures.length} of ${list.length} checks failed.`);
  process.exit(1);
}
console.log(`\nAll ${list.length} checks passed.`);
