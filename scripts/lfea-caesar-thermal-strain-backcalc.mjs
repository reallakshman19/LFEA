#!/usr/bin/env node
/**
 * Back-calculates the thermal strain CAESAR II applied, from CAESAR's own
 * output, for every benchmark that has it (BM1, BM4, BM4_L).
 *
 * In CAESAR's expansion case (OPE minus SUS, friction-free), weight and
 * pressure cancel, so each straight element obeys
 *   (u_to - u_from) . e  =  eps * L  +  N * L / (E * A)
 * exactly, whatever the supports did (the restraint states only change N).
 * u comes from CAESAR's displacement report, N from its local force report
 * (axial FX, tension positive at the TO end), E, A and L from the model. So
 * eps = (u_to - u_from) . e / L - N / (E A) per element, grouped by material
 * and operating temperature. The median of a group is CAESAR's strain there.
 *
 * Exported for lfea-thermal-default.js's record and CI. Run directly to print.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createLinearPipingInputXmlIntake } from '../src/workspace/linear-piping-inputxml-intake.js';
import { prepareLinearPipingInputXmlPreFlight } from '../src/workspace/linear-piping-inputxml-prefea.js';
import { createLinearPipingAccdbSession, prepareLinearPipingAccdbPreFlight } from '../src/workspace/linear-piping-accdb-intake.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ACCDB_TABLES = ['INPUT_BASIC_ELEMENT_DATA', 'INPUT_BENDS', 'INPUT_CONTROL', 'INPUT_FORCMNT', 'INPUT_NODAL_COORDINATES',
  'INPUT_OFFSETS', 'INPUT_REDUCERS', 'INPUT_RESTRAINTS', 'INPUT_RIGIDS', 'INPUT_SIFTEES', 'INPUT_UNITS'];
export const MINIMUM_SPAN_M = 0.1;

export const CAESAR_THERMAL_BENCHMARKS = Object.freeze([
  Object.freeze({ id: 'BM1', kind: 'XML', model: 'benchmarks/LFEA/BM1/BM1_InputXML.xml', output: 'benchmarks/LFEA/BM1/BM1_CIIOutput.xml', expCase: 'CASE 5 (EXP) L5=L3-L4' }),
  Object.freeze({ id: 'BM4', kind: 'XML', model: 'benchmarks/LFEA/BM4/InputXML_BM4.xml', output: 'benchmarks/LFEA/BM4/Output_BM4.xml', expCase: 'CASE 21 (EXP) L21=L20-L19' }),
  Object.freeze({ id: 'BM4_L', kind: 'ACCDB', model: 'benchmarks/LFEA/BM4/BM4_L/BM4_L.ACCDB', expCaseNumber: 14 }),
]);

function attributes(tag) {
  return Object.fromEntries([...tag.matchAll(/([A-Z_0-9]+)="([^"]*)"/gu)].map((m) => [m[1], Number(m[2])]));
}

function xmlReport(xml, tag, loadCase) {
  for (const match of xml.matchAll(new RegExp(`<${tag}[^>]*>`, 'gu'))) {
    if (match[0].includes(`LOADCASE="${loadCase}"`)) {
      return xml.slice(match.index + match[0].length, xml.indexOf(`</${tag}>`, match.index));
    }
  }
  throw new Error(`No ${tag} for ${loadCase}.`);
}

/** CAESAR's EXP-case node translations (m) and element axial forces (N, tension +). */
function caesarExpansion(benchmark) {
  const displacement = new Map();
  const axial = new Map();
  if (benchmark.kind === 'XML') {
    const xml = readFileSync(`${ROOT}${benchmark.output}`, 'utf8');
    for (const m of xmlReport(xml, 'DISPLACEMENT_REPORT', benchmark.expCase).matchAll(/<NODE NUMBER="([^"]*)">[\s\S]*?(<TRANSLATIONS[^>]*>)/gu)) {
      const t = attributes(m[2]);
      displacement.set(String(Math.round(Number(m[1]))), [t.DX / 1000, t.DY / 1000, t.DZ / 1000]);
    }
    for (const m of xmlReport(xml, 'LOCAL_FORCE_REPORT', benchmark.expCase).matchAll(/<ELEMENT [^>]*FROM_NODE="([^"]*)" TO_NODE="([^"]*)">[\s\S]*?<TO ([^/]*)\//gu)) {
      axial.set(`${Math.round(Number(m[1]))}-${Math.round(Number(m[2]))}`, attributes(`<x ${m[3]}>`).FX);
    }
    return { displacement, axial };
  }
  return caesarAccdb(benchmark, displacement, axial);
}

let MDBReader = null;
async function loadMdb() {
  if (MDBReader === null) {
    const module = await import('mdb-reader');
    MDBReader = module.default ?? module;
  }
  return MDBReader;
}

function caesarAccdb(benchmark, displacement, axial) {
  const reader = new MDBReader(readFileSync(`${ROOT}${benchmark.model}`));
  for (const row of reader.getTable('OUTPUT_DISPLACEMENTS').getData()) {
    if (Number(row.LCASE_NUM) === benchmark.expCaseNumber) displacement.set(String(Math.round(row.NODE)), [row.DX / 1000, row.DY / 1000, row.DZ / 1000]);
  }
  for (const row of reader.getTable('OUTPUT_LOCAL_ELEMENT_FORCES').getData()) {
    if (Number(row.LCASE_NUM) === benchmark.expCaseNumber) axial.set(`${Math.round(row.FROM_NODE)}-${Math.round(row.TO_NODE)}`, row.FXT);
  }
  return { displacement, axial };
}

function preFlightFor(benchmark) {
  const options = { preparationOptions: { authorityOptions: { thermalDefaultBasis: null } } };
  if (benchmark.kind === 'XML') {
    const content = readFileSync(`${ROOT}${benchmark.model}`, 'utf8');
    return prepareLinearPipingInputXmlPreFlight(createLinearPipingInputXmlIntake({ fileName: benchmark.model, content }, { requestedCaseIds: ['IXP-W'] }), options);
  }
  const reader = new MDBReader(readFileSync(`${ROOT}${benchmark.model}`));
  const tables = Object.fromEntries(ACCDB_TABLES.map((name) => [name, { rows: reader.getTable(name).getData() }]));
  const session = createLinearPipingAccdbSession(tables, { fileName: benchmark.model, requestedCaseIds: ['IXP-W'] });
  return prepareLinearPipingAccdbPreFlight(session.intake, session.sourceBundle, options);
}

const nodeKey = (id) => String(id).replace(/^.*\.N/u, '').replace(/^N/u, '');

/** Per-element strains for one benchmark, and their per-temperature groups. */
export async function backCalculateCaesarThermalStrain(benchmark) {
  await loadMdb();
  const preFlight = preFlightFor(benchmark);
  const source = preFlight.preparation.sourcePreparation;
  const kinds = new Map(source.segmentBindings.map((row) => [row.segmentId, row.componentKind]));
  const nodes = new Map(source.normalizedGeometry.nodes.map((node) => [String(node.id), node]));
  const { displacement, axial } = caesarExpansion(benchmark);
  const elements = [];
  for (const segment of source.normalizedGeometry.segments) {
    const analysis = segment.meta?.analysis ?? {};
    if (kinds.get(String(segment.id)) !== 'STRAIGHT_PIPE' || !Number.isFinite(analysis.operatingTemperature)) continue;
    const from = nodeKey(segment.startNodeId);
    const to = nodeKey(segment.endNodeId);
    const uFrom = displacement.get(from);
    const uTo = displacement.get(to);
    const force = axial.get(`${from}-${to}`);
    const a = nodes.get(String(segment.startNodeId));
    const b = nodes.get(String(segment.endNodeId));
    if (!uFrom || !uTo || force === undefined || !a || !b) continue;
    const vector = [b.x - a.x, b.y - a.y, b.z - a.z];
    const length = Math.hypot(...vector);
    if (!(length >= MINIMUM_SPAN_M)) continue;
    const stretch = vector.reduce((sum, component, index) => sum + component * (uTo[index] - uFrom[index]), 0) / length;
    const inner = segment.diameter - 2 * segment.thickness;
    const area = (Math.PI / 4) * (segment.diameter ** 2 - inner ** 2);
    elements.push({
      element: `${from}-${to}`,
      materialNumber: segment.meta.materialNumber,
      operatingTemperatureC: +(analysis.operatingTemperature - 273.15).toFixed(6),
      length,
      strain: stretch / length - force / (analysis.elasticModulus * area),
    });
  }
  const groups = new Map();
  for (const row of elements) {
    const key = `${row.materialNumber}@${row.operatingTemperatureC}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return {
    benchmarkId: benchmark.id,
    elements,
    groups: [...groups.values()].map((rows) => {
      const strains = rows.map((row) => row.strain).sort((x, y) => x - y);
      const median = strains[strains.length >> 1];
      return {
        materialNumber: rows[0].materialNumber,
        operatingTemperatureC: rows[0].operatingTemperatureC,
        spans: strains.length,
        medianStrain: median,
        maxRelativeScatter: Math.max(...strains.map((value) => Math.abs(value / median - 1))),
      };
    }),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  for (const benchmark of CAESAR_THERMAL_BENCHMARKS) {
    if (!existsSync(`${ROOT}${benchmark.model}`)) continue;
    const result = await backCalculateCaesarThermalStrain(benchmark);
    console.log(JSON.stringify({ benchmarkId: result.benchmarkId, groups: result.groups }));
  }
}
