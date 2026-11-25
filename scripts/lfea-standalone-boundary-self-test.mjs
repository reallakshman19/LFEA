import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Extracted LFEA repo: LAFEA and the combined AA3 shell are physically absent
// by design (AA3's "physical-absence rehearsal" is this repo's permanent state).
// Imports of either must still be rejected as boundary violations.
assertForbiddenFixture('scripts/fixtures/lfea-standalone-forbidden-legacy-import.js');
assertForbiddenFixture('scripts/fixtures/lfea-standalone-forbidden-import.js');

const lafeaWitness = path.join(ROOT, 'src/workspace/lafea-workbench-controller.js');
if (fs.existsSync(lafeaWitness)) {
  throw new Error('LFEA repo must not contain LAFEA runtime modules (found the LAFEA witness).');
}
console.log('LFEA standalone boundary self-test PASS (LAFEA absent; LAFEA and legacy imports rejected).');

function assertForbiddenFixture(entry) {
  const result = spawnSync(
    process.execPath,
    ['scripts/lfea-standalone-boundary-check.mjs', '--entry', entry],
    { cwd: ROOT, encoding: 'utf8' },
  );
  if (result.error) throw result.error;
  if (result.status === 0) {
    throw new Error(`Standalone boundary self-test expected ${entry} to fail.`);
  }
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  if (!output.includes('Forbidden LAFEA/legacy dependency')) {
    throw new Error(`Standalone boundary self-test failed for the wrong reason (${entry}):\n${output}`);
  }
}
