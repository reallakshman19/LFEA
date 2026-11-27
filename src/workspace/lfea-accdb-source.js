/**
 * A CAESAR II ACCDB as an LFEA source, for the Source tab.
 *
 * The file is read in the page (nothing is uploaded): the eleven model tables
 * through the shared ACCDB reader, the model-health source bundle parsed once,
 * and a SHA-256 over the exact bytes for custody. Pre-flight then runs through
 * the same governed chain as InputXML (linear-piping-accdb-intake.js), so Run,
 * Results and the B31 check need nothing ACCDB-specific.
 */
import { readAccdbNamedTables } from '../core/fea-benchmarks/caesar-accdb-reader-core.js';
import { parseAccdbModelHealthSource } from '../core/linear-piping-analysis-consumer/accdb-source-binding.js';
import { createLinearPipingAccdbIntake, prepareLinearPipingAccdbPreFlight } from './linear-piping-accdb-intake.js';

/** The INPUT_* tables the ACCDB adapter reads; nothing else enters the model identity. */
export const LFEA_ACCDB_MODEL_TABLES = Object.freeze([
  'INPUT_BASIC_ELEMENT_DATA', 'INPUT_BENDS', 'INPUT_CONTROL', 'INPUT_FORCMNT',
  'INPUT_NODAL_COORDINATES', 'INPUT_OFFSETS', 'INPUT_REDUCERS', 'INPUT_RESTRAINTS',
  'INPUT_RIGIDS', 'INPUT_SIFTEES', 'INPUT_UNITS',
]);

export function isLfeaAccdbFileName(fileName) {
  return /\.(accdb|mdb)$/iu.test(String(fileName ?? '').trim());
}

/** Read a user-selected ACCDB File into an immutable source record. */
export async function readLfeaAccdbSource(file, { readTables = readAccdbNamedTables } = {}) {
  if (!file || typeof file.arrayBuffer !== 'function') throw new TypeError('An ACCDB File is required.');
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const readLog = [];
  const tables = await readTables(bytes, LFEA_ACCDB_MODEL_TABLES, readLog);
  const missing = LFEA_ACCDB_MODEL_TABLES.filter((name) => !tables[name]);
  if (missing.includes('INPUT_BASIC_ELEMENT_DATA') || missing.includes('INPUT_NODAL_COORDINATES')
    || missing.includes('INPUT_UNITS')) {
    throw new TypeError(`${file.name} is not a CAESAR II model database: missing ${missing.join(', ')}.`);
  }
  const sourceBundle = parseAccdbModelHealthSource(tables, { source: `accdb-${file.name}`, fileName: file.name });
  return Object.freeze({
    fileName: file.name,
    byteLength: bytes.byteLength,
    sha256: await sha256Hex(buffer),
    tables,
    sourceBundle,
    missingTables: Object.freeze(missing),
  });
}

export function createLfeaAccdbIntake(source, { requestedProfileId, requestedCaseIds }) {
  return createLinearPipingAccdbIntake(source.tables, {
    fileName: source.fileName, requestedProfileId, requestedCaseIds,
  });
}

export function prepareLfeaAccdbPreFlight(source, intake, options = {}) {
  return prepareLinearPipingAccdbPreFlight(intake, source.sourceBundle, options);
}

async function sha256Hex(buffer) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  const digest = await subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
