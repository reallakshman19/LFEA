import { semanticHash } from '../core/shared-piping-model/canonical-json.js';
import { sealStressFactorSet } from '../core/linear-fea-b31-code-engine/index.js';
import {
  FACTOR_CALCULATION_REQUEST_SCHEMA,
  bendGeometry,
  calculateB31Factors,
  reducerGeometry,
  weldingTeeGeometry,
} from '../core/linear-fea-b31-factor-calculator/index.js';
import { declaredLengthToSiFactor } from '../core/linear-piping-analysis-consumer/restraint-spring-rate.js';
import { LFEA_WELDOLET_DEFAULT, lfeaWeldoletRunFactors } from './lfea-weldolet-default.js';

export { LFEA_WELDOLET_DEFAULT };

/**
 * B31J stress factors (and reducer end sections) for the practical sustained
 * check at reducers and welding tees (docs/PRACTICAL_ANALYSIS_POLICY.md).
 *
 * - REDUCER elements (CAESAR reducer records): both ends get the B31J
 *   Table 1-1 reducer SIF. The end at DIAMETER2 is checked with that size
 *   (THICKNESS2, or the joining pipe's wall when 0), the other end with the
 *   element's own section: the factor calculator's matching-pipe rule.
 *   CAESAR's ALPHA, R2 and L2 are used where given; where 0, labelled
 *   defaults (LFEA_REDUCER_DEFAULTS) stand in.
 * - An end at a CAESAR welding tee (SIF TYPE 3) with three legs gets the
 *   B31J welding-tee run or branch SIF (run = the two most nearly opposite
 *   legs). In-plane / out-of-plane follow the element's local axes when one is
 *   normal to the tee plane; otherwise the larger factor is used both ways.
 *
 * - A run end at a CAESAR weldolet (SIF TYPE 5) gets a labelled default:
 *   LFEA has no B31J weldolet equations, so the run SIFs CAESAR printed on
 *   BM4_L, fitted in R/T, stand in (src/lfea/lfea-weldolet-default.js):
 *   expansion i in and out of plane and axial, i_t in torsion; sustained
 *   index min(0.75 i, sqrt(i)), axial 1. A weldolet branch end keeps unity.
 *
 * - Bends (a lead straight plus arc chords, `isLfeaBendPart`): every chord
 *   end (the tangent points included) gets the B31J bend SIF with the
 *   declared-pressure correction; in-plane is bending in the bend plane. The
 *   lead is plain pipe, as in CAESAR, unless it is at most 1% of the bend
 *   radius long (CAESAR's near point on the FROM node). A tee or weldolet SIF at a node wins;
 *   where the tee has no factors (two legs), the bend SIF stands.
 *
 * Other fitting types (sweepolets, fabricated tees ...) keep unity factors
 * and are counted. Nothing here blocks.
 */
export const LFEA_PRACTICAL_FITTING_SOURCE = 'LFEA_PRACTICAL_B31_FITTINGS';
export const LFEA_PRACTICAL_FITTING_PROFILE = 'B31_3_2022_B31J_2017';
export const LFEA_REDUCER_DEFAULTS = Object.freeze({
  coneAngle: 'when ALPHA is 0: half-angle of the cone from the element, atan((D1 - D2) / 2 / L)',
  smallEndTransitionRadiusOverD2: 0.1,
  smallEndCylinderLengthOverL: 0.1,
  bodyMinimumWall: 'large-end wall T1',
});
export const LFEA_FITTING_TARGET_KINDS = Object.freeze(['TEE', 'REDUCER']);
/** Lead length, as a fraction of the bend radius, at or below which the lead's start is on the bend. */
export const LFEA_BEND_LEAD_ON_ARC = 0.01;
const CAESAR_WELDING_TEE = 3;
const CAESAR_WELDOLET = 5;
const AXIS_ALIGNED = 0.999;
const SAME_SIZE = 0.01;
const MAPPING = Object.freeze({ inPlaneField: 'my', outOfPlaneField: 'mz' });

/** A bend's straight lead or one of its arc chords (any component kind). */
export function isLfeaBendPart(binding) {
  return (binding.bendChordOf ?? null) !== null || binding.retopologyRole === 'BEND_INCOMING_STRAIGHT';
}

/** A TEE or REDUCER element, or a bend's lead or arc chord, the check may target. */
export function isLfeaFittingTarget(binding) {
  return String(binding.representabilityDisposition).startsWith('IMPLEMENTED_')
    && (isLfeaBendPart(binding) || LFEA_FITTING_TARGET_KINDS.includes(binding.componentKind));
}

/**
 * Map `${elementId}:${end}` -> { kind, stressFactorSet, endSection, note } for
 * fitting ends, plus `unsupported` (key -> note) for ends left at unity.
 * `endSection` is { outerDiameter, wallThickness } in metres or null (own section).
 */
export function lfeaB31EndFittings(preFlight) {
  const structural = preFlight.preparation.structuralPreparation;
  const sections = new Map(structural.sectionResolutions.map((row) => [row.semanticHash, row]));
  const elements = new Map(structural.compilation.model.elements.map((row) => [row.elementId, row]));
  const positions = new Map(structural.compilation.model.nodes.map((row) => [row.nodeId, row.position]));
  const sourceBundle = preFlight?.diagnostics?.sourceBundle ?? null;
  const toMetres = declaredLengthToSiFactor(String(sourceBundle?.unitSystem?.declared?.length ?? sourceBundle?.unitSystem?.lengthUnit ?? '')
    .replace(/\.$/u, '').toLowerCase());
  const records = new Map((sourceBundle?.elementRecords ?? []).map((row) => [row.sourceFeatureId, row]));
  const section = (binding) => sections.get(binding.analysisSectionSemanticHash)?.dimensions ?? null;
  const at = (node) => structural.segmentBindings.filter((row) => row.startNodeId === node || row.endNodeId === node);
  const ends = (binding) => {
    const row = elements.get(binding.elementId);
    return { I: positions.get(row.nodeI), J: positions.get(row.nodeJ) };
  };
  const outward = (binding, node) => {
    const { I, J } = ends(binding);
    return unit(binding.startNodeId === node ? minus(J, I) : minus(I, J));
  };
  const teeTypes = caesarSifTypes(records);
  const bendSegments = new Map((preFlight.preparation.sourcePreparation?.normalizedGeometry?.segments ?? [])
    .filter((row) => row.meta?.bendDeclaredRadius > 0).map((row) => [String(row.id), row]));
  const bendSets = new Map();
  const fittings = new Map();
  const unsupported = new Map();

  for (const binding of structural.segmentBindings) {
    const target = (binding.componentKind === 'STRAIGHT_PIPE' && binding.limitationCode === null) || isLfeaFittingTarget(binding);
    if (!target) continue;
    if (binding.componentKind === 'REDUCER') {
      const reducer = reducerFactors(binding);
      if (reducer.endSections) {
        for (const end of ['I', 'J']) {
          fittings.set(`${binding.elementId}:${end}`, {
            kind: 'REDUCER', stressFactorSet: reducer.factorSet, endSection: reducer.endSections[end], note: reducer.note,
          });
        }
      } else {
        for (const end of ['I', 'J']) unsupported.set(`${binding.elementId}:${end}`, reducer.note);
      }
      continue;
    }
    for (const [end, node] of [['I', binding.startNodeId], ['J', binding.endNodeId]]) {
      const key = `${binding.elementId}:${end}`;
      // A bend's arc: every chord end (the first chord's I end is the tangent
      // point). The lead is plain pipe, as CAESAR has it, unless it vanishes.
      const onArc = isLfeaBendPart(binding) && ((binding.bendChordOf ?? null) !== null || vanishingLead(binding));
      if (teeTypes.has(node)) {
        const weldolet = teeTypes.get(node) === CAESAR_WELDOLET;
        const tee = weldolet ? weldoletFactors(binding, end, node) : teeFactors(binding, end, node, teeTypes.get(node));
        const kind = weldolet ? 'WELDOLET' : 'WELDING_TEE';
        if (tee.factorSet) {
          fittings.set(key, { kind, stressFactorSet: tee.factorSet, endSection: null, note: tee.note });
          continue;
        }
        if (!onArc) {
          unsupported.set(key, tee.note);
          continue;
        }
      }
      if (!onArc) continue;
      const bend = bendFactors(binding, end);
      if (bend.factorSet) fittings.set(key, { kind: 'BEND', stressFactorSet: bend.factorSet, endSection: null, note: bend.note });
      else unsupported.set(key, bend.note);
    }
  }
  return Object.freeze({ fittings, unsupported });

  /**
   * B31J bend SIFs (Table 1-1 Sketch 1-1) with the declared-pressure
   * correction, the same factors CAESAR prints for BM4_L's bends; sustained
   * index = the SIF (B31J direct). In-plane is bending in the bend plane.
   */
  function bendFactors(binding, end) {
    const sourceId = String(binding.bendChordOf ?? binding.sourceSegmentId);
    if (!bendSets.has(sourceId)) bendSets.set(sourceId, bendFactorSet(sourceId, binding));
    const { set, normal, note } = bendSets.get(sourceId);
    if (!set) return { factorSet: null, note };
    // Arc chords are solved inside the bend component, whose reference vector
    // is the bend-plane normal (bend-component.js, BEND_PLANE_NORMAL_V1): local
    // y is that normal, so in-plane is my. The structural model's own chord
    // axes are not the solved ones. The lead is an ordinary frame element.
    const axes = elements.get(binding.elementId).localAxes;
    const chord = (binding.bendChordOf ?? null) !== null;
    const mapping = chord || Math.abs(dot(axes.y, normal)) > AXIS_ALIGNED ? { inPlaneField: 'my', outOfPlaneField: 'mz' }
      : Math.abs(dot(axes.z, normal)) > AXIS_ALIGNED ? { inPlaneField: 'mz', outOfPlaneField: 'my' } : null;
    return {
      factorSet: practicalFactorSet(binding.elementId, set, `BEND_${end}`, mapping),
      note: `${note}${mapping ? '' : ' (bend plane off the local axes: larger factor both ways)'}`,
    };
  }

  /** A lead shorter than LFEA_BEND_LEAD_ON_ARC of the bend radius: its start is the bend's near point (CAESAR's SIF there too). */
  function vanishingLead(binding) {
    const radius = bendSegments.get(String(binding.sourceSegmentId))?.meta?.bendDeclaredRadius;
    const { I, J } = ends(binding);
    return radius > 0 && norm(minus(J, I)) <= LFEA_BEND_LEAD_ON_ARC * radius;
  }

  function bendFactorSet(sourceId, binding) {
    const segment = bendSegments.get(sourceId) ?? null;
    const pipe = section(binding);
    const meta = segment?.meta ?? {};
    const centre = meta.bendArcCentre;
    const label = `bend ${segment?.startNodeId ?? sourceId}-${segment?.endNodeId ?? ''}`;
    if (!segment || !pipe || !centre || !meta.bendTangentStart || !meta.bendTangentEnd || !(meta.bendDeclaredRadius > 0)) {
      return { set: null, note: `${label}: no usable bend geometry, unity factors` };
    }
    const toCentre = (point) => [point.x - centre.x, point.y - centre.y, point.z - centre.z];
    const [start, finish] = [toCentre(meta.bendTangentStart), toCentre(meta.bendTangentEnd)];
    const angle = (Math.acos(Math.max(-1, Math.min(1, dot(unit(start), unit(finish))))) * 180) / Math.PI;
    const modulus = meta.analysis?.elasticModulus;
    const pressure = modulus > 0 && meta.analysis?.pressure > 0 ? meta.analysis.pressure : 0;
    const result = calculateB31Factors({
      schema: FACTOR_CALCULATION_REQUEST_SCHEMA,
      calculationId: `${sourceId}.LFEA-BEND`,
      componentId: sourceId,
      editionProfileId: LFEA_PRACTICAL_FITTING_PROFILE,
      componentType: 'BEND',
      geometry: bendGeometry({
        lengthUnit: 'm',
        outerDiameter: pipe.outerDiameter,
        wallThickness: pipe.wallThickness,
        bendRadius: meta.bendDeclaredRadius,
        pressure,
        elasticModulus: modulus > 0 ? modulus : 1,
        bendAngleDegrees: angle,
        smooth90FlexibilityCorrection: false,
        sourceEvidence: { sourceId: `${LFEA_PRACTICAL_FITTING_SOURCE}:BEND:${sourceId}`, sourceRevision: '01' },
      }),
      momentDirectionMapping: { ...MAPPING },
      semanticHash: '',
    });
    if (result.status !== 'QUALIFIED') return { set: null, note: `${label}: outside the B31J bend range, unity factors` };
    const set = result.stressFactorSets[0];
    return {
      set,
      normal: unit(cross(start, finish)),
      note: `${label} (R ${mm(meta.bendDeclaredRadius)} mm, ${angle.toFixed(1)} deg, i ${set.displacementSifs.inPlaneBending.value.toFixed(3)}`
        + ` / ${set.displacementSifs.outOfPlaneBending.value.toFixed(3)}${pressure > 0 ? ', pressure-corrected' : ''})`,
    };
  }

  function reducerFactors(binding) {
    const label = `reducer ${binding.startNodeId}-${binding.endNodeId}`;
    const raw = reducerRecord(records.get(binding.sourceFeatureId));
    const own = section(binding);
    if (!raw || !own || !(raw.DIAMETER2 > 0) || typeof toMetres !== 'number') {
      return { endSections: null, note: `${label}: no usable reducer record, unity factors and own section` };
    }
    // CAESAR: DIAMETER is the reducer's FROM end, DIAMETER2 its TO end (J).
    const d2 = raw.DIAMETER2 * toMetres;
    const joining = at(binding.endNodeId).filter((row) => row.elementId !== binding.elementId).map(declaredSize).find(Boolean) ?? null;
    const t2 = raw.THICKNESS2 > 0 ? raw.THICKNESS2 * toMetres : joining?.wallThickness ?? null;
    if (!(t2 > 0)) return { endSections: null, note: `${label}: no wall at DIAMETER2, unity factors and own section` };
    const other = { outerDiameter: d2, wallThickness: t2 };
    const [large, small] = own.outerDiameter > d2 ? [own, other] : [other, own];
    const { I, J } = ends(binding);
    const length = norm(minus(J, I));
    const given = (value) => (value > 0 ? value : null);
    const coneAngleDegrees = given(raw.ALPHA) ?? (Math.atan((large.outerDiameter - small.outerDiameter) / 2 / length) * 180) / Math.PI;
    const r2 = given(raw.R2) === null ? LFEA_REDUCER_DEFAULTS.smallEndTransitionRadiusOverD2 * small.outerDiameter : raw.R2 * toMetres;
    const l2 = given(raw.L2) === null ? LFEA_REDUCER_DEFAULTS.smallEndCylinderLengthOverL * length : raw.L2 * toMetres;
    const defaults = [given(raw.ALPHA) === null && 'cone angle', given(raw.R2) === null && 'r2', given(raw.L2) === null && 'L2'].filter(Boolean);
    const result = calculateB31Factors({
      schema: FACTOR_CALCULATION_REQUEST_SCHEMA,
      calculationId: `${binding.elementId}.LFEA-REDUCER`,
      componentId: binding.elementId,
      editionProfileId: LFEA_PRACTICAL_FITTING_PROFILE,
      componentType: 'REDUCER',
      geometry: reducerGeometry({
        lengthUnit: 'm',
        largeEndOuterDiameter: large.outerDiameter,
        largeEndWallThickness: large.wallThickness,
        smallEndOuterDiameter: small.outerDiameter,
        smallEndWallThickness: small.wallThickness,
        coneAngleDegrees,
        smallEndTransitionRadius: r2,
        smallEndCylinderLength: l2,
        bodyMinimumWallThickness: large.wallThickness,
        sourceEvidence: { sourceId: `${LFEA_PRACTICAL_FITTING_SOURCE}:REDUCER:${binding.sourceFeatureId}`, sourceRevision: '01' },
      }),
      momentDirectionMapping: { ...MAPPING },
      semanticHash: '',
    });
    const note = `${label} (${mm(large.outerDiameter)} to ${mm(small.outerDiameter)} mm, cone ${coneAngleDegrees.toFixed(1)} deg`
      + `${defaults.length ? `; LFEA default ${defaults.join(', ')}` : ''})`;
    if (result.status !== 'QUALIFIED') return { endSections: null, note: `${note}: outside the B31J reducer range, unity factors and own section` };
    return {
      note,
      factorSet: practicalFactorSet(binding.elementId, result.stressFactorSets[0], 'REDUCER', MAPPING),
      endSections: { I: null, J: other },
    };
  }

  /** The pipe size a source element declares (a rigid's analysis section is the rigid's, not the pipe's). */
  function declaredSize(row) {
    const evidence = records.get(row.sourceFeatureId)?.fieldEvidence ?? {};
    const outerDiameter = evidence.DIAMETER?.canonicalValue;
    const wallThickness = evidence.WALL_THICK?.canonicalValue;
    return outerDiameter > 0 && wallThickness > 0 ? { outerDiameter, wallThickness } : section(row);
  }

  function teeFactors(binding, end, node, type) {
    const label = `fitting at ${node} (CAESAR SIF type ${type})`;
    if (type !== CAESAR_WELDING_TEE) return { factorSet: null, note: `${label}: type not in the LFEA factor calculator, unity factors` };
    const legs = at(node);
    if (legs.length !== 3) return { factorSet: null, note: `${label}: ${legs.length} legs, not a three-leg tee, unity factors` };
    const directions = legs.map((row) => outward(row, node));
    const runPair = mostOpposite(directions);
    const branchIndex = [0, 1, 2].find((index) => !runPair.includes(index));
    const run = section(legs[runPair[0]]);
    const declaredBranch = section(legs[branchIndex]);
    // A branch a hair larger than the run (168.30 vs 168.27 mm) is the same size.
    const branch = declaredBranch.outerDiameter > run.outerDiameter && declaredBranch.outerDiameter <= run.outerDiameter * (1 + SAME_SIZE)
      ? { ...declaredBranch, outerDiameter: run.outerDiameter } : declaredBranch;
    const result = calculateB31Factors({
      schema: FACTOR_CALCULATION_REQUEST_SCHEMA,
      calculationId: `${binding.elementId}.${end}.LFEA-TEE`,
      componentId: binding.elementId,
      editionProfileId: LFEA_PRACTICAL_FITTING_PROFILE,
      componentType: 'WELDING_TEE',
      geometry: weldingTeeGeometry({
        lengthUnit: 'm',
        runOuterDiameter: run.outerDiameter,
        runWallThickness: run.wallThickness,
        branchOuterDiameter: branch.outerDiameter,
        branchWallThickness: branch.wallThickness,
        fittingQuality: 'UNVERIFIED',
        sourceEvidence: { sourceId: `${LFEA_PRACTICAL_FITTING_SOURCE}:WELDING_TEE:${node}`, sourceRevision: '01' },
      }),
      momentDirectionMapping: { ...MAPPING },
      semanticHash: '',
    });
    if (result.status !== 'QUALIFIED') return { factorSet: null, note: `${label}: outside the B31J welding-tee range, unity factors` };
    const leg = legs.indexOf(binding) === branchIndex ? 'BRANCH' : 'RUN';
    // Every leg of a three-leg welding tee is solved with the B31J branch
    // modifier, whose reference vector is the tee-plane normal
    // (directional-branch-flexibility.js; production teeExactMechanics):
    // local y is that normal, so in-plane is my. The structural model's own
    // leg axes are not the solved ones (a branch leg's can have z on the normal).
    const set = result.stressFactorSets.find((row) => row.factorSetId.endsWith(`.${leg}.B31.SIF`));
    return {
      factorSet: practicalFactorSet(binding.elementId, set, `WELDING_TEE_${leg}_${end}`, { ...MAPPING }),
      note: `welding tee at ${node}, ${leg.toLowerCase()}`,
    };
  }

  /** Weldolet run end: two collinear legs (branch not modelled), or the run pair of three. */
  function weldoletFactors(binding, end, node) {
    const label = `weldolet at ${node}`;
    const legs = at(node);
    const directions = legs.map((row) => outward(row, node));
    const run = legs.length === 2 || legs.length === 3 ? mostOpposite(directions) : null;
    if (!run || dot(directions[run[0]], directions[run[1]]) > -AXIS_ALIGNED) {
      return { factorSet: null, note: `${label}: ${legs.length} legs without a straight run, unity factors` };
    }
    if (!run.includes(legs.indexOf(binding))) return { factorSet: null, note: `${label}: branch end, unity factors` };
    const pipe = section(binding);
    const factors = lfeaWeldoletRunFactors(pipe.outerDiameter, pipe.wallThickness);
    const { inPlaneBending, torsional } = factors.displacementSifs;
    return {
      factorSet: weldoletFactorSet(binding.elementId, end, node, pipe, factors),
      note: `${label}, run (R/T ${factors.radiusToThickness.toFixed(2)}${factors.extrapolated ? ', extrapolated' : ''}, `
        + `i ${inPlaneBending.toFixed(3)}, it ${torsional.toFixed(3)}; ${LFEA_WELDOLET_DEFAULT.label})`,
    };
  }
}

/** Indices of the two most nearly opposite directions. */
function mostOpposite(directions) {
  let pair = [0, 1];
  for (const next of [[0, 2], [1, 2]]) {
    if (directions.length < 3) break;
    if (dot(directions[next[0]], directions[next[1]]) < dot(directions[pair[0]], directions[pair[1]])) pair = next;
  }
  return pair;
}

function weldoletFactorSet(elementId, end, node, pipe, factors) {
  const { standard, ruleId, sourceId, sourceRevision, label } = LFEA_WELDOLET_DEFAULT;
  const source = `${sourceId} ${ruleId}; ${label}`;
  const directional = (values) => Object.freeze(Object.fromEntries(Object.entries(values)
    .map(([key, value]) => [key, Object.freeze({ value, source })])));
  const sustained = directional(factors.sustainedIndices);
  return sealStressFactorSet({
    schema: 'fea-b31-stress-factor-set/v1',
    factorSetId: `${elementId}.WELDOLET_RUN_${end}.${LFEA_PRACTICAL_FITTING_SOURCE}`,
    componentId: elementId,
    sourceIdentity: Object.freeze({
      standard, edition: 'BM4_L', ruleId, sourceRevision,
      sourceSemanticHash: semanticHash({ sourceId, ruleId, node, outerDiameter: pipe.outerDiameter, wallThickness: pipe.wallThickness }),
    }),
    // Extrapolation beyond the CAESAR points is disclosed in the end's note.
    applicability: Object.freeze({ status: 'WITHIN_RANGE', ruleId, evaluatedBy: LFEA_PRACTICAL_FITTING_SOURCE }),
    momentDirectionMapping: { ...MAPPING },
    // In = out of plane, so the plane mapping does not matter.
    sustainedIndices: sustained, occasionalIndices: sustained, displacementSifs: directional(factors.displacementSifs),
    userOverride: null,
    semanticHash: '',
  });
}

/** Counts for the status line and the sealed check reason. */
export function lfeaFittingSummary(found) {
  const count = (kind) => [...found.fittings.values()].filter((row) => row.kind === kind).length;
  return Object.freeze({
    reducerEnds: count('REDUCER'),
    teeEnds: count('WELDING_TEE'),
    weldoletEnds: count('WELDOLET'),
    bendEnds: count('BEND'),
    unityFittingEnds: found.unsupported.size,
    semanticHash: semanticHash([...found.fittings].map(([key, row]) => [key, row.stressFactorSet.semanticHash])),
  });
}

/** Re-seal a calculator factor set for the checked element, with its plane mapping (or the larger factor both ways). */
function practicalFactorSet(elementId, set, tag, mapping) {
  const both = (indices) => {
    if (mapping) return indices;
    const larger = Math.max(indices.inPlaneBending.value, indices.outOfPlaneBending.value);
    return { ...indices, inPlaneBending: { ...indices.inPlaneBending, value: larger }, outOfPlaneBending: { ...indices.outOfPlaneBending, value: larger } };
  };
  return sealStressFactorSet({
    schema: set.schema,
    factorSetId: `${elementId}.${tag}.${LFEA_PRACTICAL_FITTING_SOURCE}`,
    componentId: elementId,
    sourceIdentity: set.sourceIdentity,
    applicability: set.applicability,
    momentDirectionMapping: mapping ?? { ...MAPPING },
    sustainedIndices: both(set.sustainedIndices),
    occasionalIndices: both(set.occasionalIndices),
    displacementSifs: both(set.displacementSifs),
    userOverride: null,
    semanticHash: '',
  });
}

function reducerRecord(record) {
  const feature = (record?.childFeatures ?? []).find((row) => row.kind === 'REDUCER');
  if (!feature) return null;
  const value = (name) => {
    const number = Number(feature.rawAttributes?.[name]);
    return Number.isFinite(number) && number > 0 ? number : 0;
  };
  return { DIAMETER2: value('DIAMETER2'), THICKNESS2: value('THICKNESS2'), ALPHA: value('ALPHA'), R2: value('R2'), L2: value('L2') };
}

/** CAESAR SIF TYPE per source node (declared types > 0 only). */
function caesarSifTypes(records) {
  const types = new Map();
  for (const record of records.values()) {
    for (const feature of record.childFeatures ?? []) {
      if (feature.kind !== 'SIF') continue;
      const type = Number(feature.rawAttributes?.TYPE);
      const node = Number(feature.rawAttributes?.NODE);
      if (Number.isFinite(type) && type > 0 && Number.isFinite(node) && node > 0) types.set(String(Math.round(node)), Math.round(type));
    }
  }
  return types;
}

const minus = (a, b) => [a.x - b.x, a.y - b.y, a.z - b.z];
const norm = (v) => Math.hypot(...v);
const unit = (v) => { const n = norm(v); return v.map((c) => c / n); };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const mm = (metres) => String(Math.round(metres * 10000) / 10);
