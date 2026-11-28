import { semanticHash } from '../core/shared-piping-model/canonical-json.js';
import { sealStressFactorSet } from '../core/linear-fea-b31-code-engine/index.js';
import { derivePressureStressContribution } from '../core/linear-piping-code-application/pressure-stress-derivation.js';
import { isLfeaFittingTarget } from './practical-b31-fittings.js';
import {
  PIPE_SECTION_FORMULATION_ID,
  PIPE_SECTION_REQUEST_SCHEMA,
  computePipeSectionRequestSemanticHash,
  resolvePipeSection,
} from '../core/linear-fea-section/index.js';

export const LFEA_SUSTAINED_SECTION_SOURCE = 'LFEA_NOMINAL_LESS_CORROSION_ALLOWANCE';

const SUSTAINED_PHYSICAL_CASE_ROLES = Object.freeze(['WEIGHT_BASE', 'WEIGHT_PRESSURE']);

/**
 * Real candidates only: the exact same eligibility rules
 * native-b31-code-stations.js/native-b31-authority-contract.js enforce at
 * stage() time, applied here so a person only ever sees selectable options
 * that will actually be accepted -- nothing is offered that stage() would
 * reject.
 */
export function listB31SustainedCandidates(preFlight) {
  const structural = preFlight?.preparation?.structuralPreparation;
  const physicalCases = preFlight?.preparation?.physicalPreparation?.physicalCases;
  if (!structural || !Array.isArray(physicalCases)) return [];
  const elements = structural.segmentBindings.filter(isLfeaNativeB31Target);
  const cases = physicalCases.filter((row) => SUSTAINED_PHYSICAL_CASE_ROLES.includes(row.caseRole));
  const rows = [];
  for (const binding of elements) {
    for (const end of ['I', 'J']) {
      for (const physicalCase of cases) {
        rows.push({
          elementId: binding.elementId, end, caseId: physicalCase.caseId, caseRole: physicalCase.caseRole,
          candidateId: `${binding.elementId}:${end}:${physicalCase.caseId}`,
        });
      }
    }
  }
  return rows;
}

/**
 * B31 targets: exact straight pipe, plus reducer and tee elements and bend
 * leads and arc chords, checked with B31J factors from practical-b31-fittings.js. The same
 * rule native-b31-code-stations.js enforces at stage() time.
 */
export function isLfeaNativeB31Target(binding) {
  return (binding.componentKind === 'STRAIGHT_PIPE'
    && binding.representabilityDisposition === 'IMPLEMENTED_EXACTLY'
    && binding.limitationCode === null)
    || isLfeaFittingTarget(binding);
}

/**
 * Build one real SUSTAINED check for a selected candidate. Every field is
 * either read directly from already-sealed preFlight authority (section
 * resolution) or derived through the existing, generic, production formula
 * (derivePressureStressContribution, S = P*di^2/(Do^2-di^2) on the
 * nominal-less-corrosion-allowance sustained section) -- nothing here
 * recomputes stiffness, flexibility, or a new engineering result.
 *
 * stressFactorSet: `fitting` (practical-b31-fittings.js) supplies B31J
 * factors, and for a reducer end its section, at reducer and welding-tee
 * ends. Otherwise it is a disclosed unity default: the production straight-pipe convention already established at
 * scripts/lfea-b3.18-bm1-bend-authorities.mjs's bm1CodeStressFactorSet
 * non-bend branch is SIF = 1. This mirrors that exact shape, generalized to
 * any candidate rather than one benchmark fixture.
 */
export function buildB31SustainedCheck({ preFlight, elementId, end, caseId, checkId, fitting = null }) {
  const structural = preFlight.preparation.structuralPreparation;
  const binding = structural.segmentBindings.find((row) => row.elementId === elementId);
  if (!binding) throw authoringError('LFEA_B31_AUTHORING_ELEMENT_MISSING', `Element ${elementId} is not a governed structural binding.`);
  const sectionResolution = structural.sectionResolutions
    .find((row) => row.semanticHash === binding.analysisSectionSemanticHash);
  if (!sectionResolution) throw authoringError('LFEA_B31_AUTHORING_SECTION_MISSING', `No retained section resolution for ${elementId}.`);
  const physicalCase = preFlight.preparation.physicalPreparation.physicalCases.find((row) => row.caseId === caseId);
  if (!physicalCase) throw authoringError('LFEA_B31_AUTHORING_CASE_MISSING', `Physical case ${caseId} is not retained.`);

  const allowance = corrosionAllowanceFor(preFlight, binding);
  const endSection = fitting?.endSection ?? null;
  const sustainedSection = endSection || allowance > 0
    ? sustainedEndSection(sectionResolution, endSection ?? sectionResolution.dimensions, allowance, elementId, end)
    : sectionResolution;
  const sizeText = endSection ? `, at the reducer's ${Math.round(endSection.outerDiameter * 10000) / 10} mm end` : '';
  return Object.freeze({
    checkId, category: 'SUSTAINED', elementId, end, combinationId: caseId,
    actionSource: Object.freeze({ kind: 'SINGLE_CASE', caseId }),
    evaluationCaseId: caseId,
    stressFactorSet: fitting?.stressFactorSet
      ?? unityStraightPipeStressFactorSet(elementId, binding.sourceSegmentId ?? binding.sourceFeatureId ?? elementId),
    sectionBasisReason: allowance > 0
      ? `B31.3 sustained section${sizeText}: nominal wall less the model's corrosion allowance (CORR_ALLOW ${allowance * 1000} mm); no mill tolerance deducted.`
      : `B31.3 sustained section${sizeText}: nominal wall; the model gives no corrosion allowance for this element.`,
    sustainedSectionResolution: sustainedSection,
    pressureStressContribution: pressureStressContributionFor(physicalCase, elementId, sustainedSection),
    coldTemperature: null, sustainedStress: null, occasionalCategoryId: null,
  });
}

/**
 * Build one DISPLACEMENT_STRESS_RANGE (expansion) check: the action range from
 * the sustained case to the operating case (CAESAR's EXP = OPE - SUS), with
 * the fitting's displacement SIFs (or unity), on the nominal (uncorroded)
 * section; a reducer end uses that end's nominal size. The allowable is B31.3
 * Eq. (1a), f (1.25 Sc + 0.25 Sh), from the edition dataset.
 */
export function buildB31ExpansionCheck({
  preFlight, elementId, end, fromCaseId, toCaseId, checkId, fitting = null, coldTemperature,
}) {
  const structural = preFlight.preparation.structuralPreparation;
  const binding = structural.segmentBindings.find((row) => row.elementId === elementId);
  if (!binding) throw authoringError('LFEA_B31_AUTHORING_ELEMENT_MISSING', `Element ${elementId} is not a governed structural binding.`);
  const nominal = structural.sectionResolutions.find((row) => row.semanticHash === binding.analysisSectionSemanticHash);
  const endSection = fitting?.endSection ?? null;
  return Object.freeze({
    checkId, category: 'DISPLACEMENT_STRESS_RANGE', elementId, end,
    combinationId: `${toCaseId}-MINUS-${fromCaseId}`,
    actionSource: Object.freeze({ kind: 'CASE_RANGE', fromCaseId, toCaseId }),
    evaluationCaseId: toCaseId,
    stressFactorSet: fitting?.stressFactorSet
      ?? unityStraightPipeStressFactorSet(elementId, binding.sourceSegmentId ?? binding.sourceFeatureId ?? elementId),
    sectionBasisReason: `B31.3 expansion range: nominal (uncorroded) section${endSection ? ', at the reducer end size' : ''}, as CAESAR with corroded stress cases off.`,
    sustainedSectionResolution: endSection && nominal ? sustainedEndSection(nominal, endSection, 0, elementId, end) : null,
    pressureStressContribution: null,
    coldTemperature,
    sustainedStress: null,
    occasionalCategoryId: null,
  });
}

/** CORR_ALLOW in metres as resolved by intake (explicit or inherited), else 0. */
export function corrosionAllowanceFor(preFlight, binding) {
  const records = preFlight?.diagnostics?.sourceBundle?.elementRecords ?? [];
  const record = records.find((row) => row.sourceFeatureId === binding.sourceFeatureId)
    ?? records[binding.sourceIndex];
  const value = record?.fieldEvidence?.CORR_ALLOW?.canonicalValue;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/** Sustained section at a check end: the end's own size (a reducer end may differ), wall less corrosion allowance. */
function sustainedEndSection(nominal, { outerDiameter, wallThickness }, allowance, elementId, end) {
  const atEnd = outerDiameter !== nominal.dimensions.outerDiameter || wallThickness !== nominal.dimensions.wallThickness;
  const reduced = wallThickness - allowance;
  if (!(reduced > 0)) {
    throw authoringError('LFEA_B31_AUTHORING_CORROSION_EXCEEDS_WALL',
      `Corrosion allowance ${allowance} m is not less than the ${wallThickness} m wall of ${elementId}.`);
  }
  const payload = {
    schema: PIPE_SECTION_REQUEST_SCHEMA,
    sectionStateId: `${nominal.sectionState.sectionStateId}${atEnd ? `-${end}-END` : ''}${allowance > 0 ? '-LESS-CA' : ''}`,
    formulationId: PIPE_SECTION_FORMULATION_ID,
    outerDiameter,
    wallThickness: reduced,
    sourceEvidence: Object.freeze({
      sourceId: LFEA_SUSTAINED_SECTION_SOURCE,
      sourceRevision: '01',
      sourceSemanticHash: semanticHash(atEnd ? { nominal: nominal.semanticHash, allowance, end, outerDiameter, wallThickness } : { nominal: nominal.semanticHash, allowance }),
    }),
  };
  return resolvePipeSection({ request: { ...payload, semanticHash: computePipeSectionRequestSemanticHash(payload) } });
}

function pressureStressContributionFor(physicalCase, elementId, sectionResolution) {
  const primitive = physicalCase.loadCase.primitives
    .find((row) => row.kind === 'PRESSURE' && row.elementId === elementId);
  if (!primitive || primitive.authorizedEffects.codeStress !== true) {
    return Object.freeze({
      value: 0,
      source: `NO_CODE_STRESS_AUTHORIZED_PRESSURE_PRIMITIVE_ON_${elementId}_IN_${physicalCase.caseId}_V1`,
    });
  }
  return derivePressureStressContribution({ pressurePrimitive: primitive, sectionResolution });
}

function unityStraightPipeStressFactorSet(componentId, sourceRevision) {
  const source = 'LFEA native B31 authoring; disclosed unity stress factor for an exact straight-pipe target';
  const directional = Object.freeze({
    axial: Object.freeze({ value: 1, source }), torsional: Object.freeze({ value: 1, source }),
    inPlaneBending: Object.freeze({ value: 1, source }), outOfPlaneBending: Object.freeze({ value: 1, source }),
  });
  return sealStressFactorSet({
    schema: 'fea-b31-stress-factor-set/v1',
    factorSetId: `${componentId}.LFEA-NATIVE.UNITY`,
    componentId,
    sourceIdentity: Object.freeze({
      standard: 'LFEA_NATIVE_STRAIGHT_PIPE_UNITY', edition: '01', ruleId: 'NON-BEND-UNITY',
      sourceRevision: String(sourceRevision),
      sourceSemanticHash: semanticHash({ componentId, sourceRevision, source }),
    }),
    applicability: Object.freeze({ status: 'WITHIN_RANGE', ruleId: 'NON-BEND-UNITY', evaluatedBy: 'LFEA_NATIVE_B31_AUTHORING' }),
    momentDirectionMapping: Object.freeze({ inPlaneField: 'my', outOfPlaneField: 'mz' }),
    sustainedIndices: directional, occasionalIndices: directional, displacementSifs: directional,
    userOverride: null,
    semanticHash: '',
  });
}

function authoringError(code, message) {
  const error = new TypeError(message);
  error.code = code;
  error.analysisStage = 'LFEA_NATIVE_B31_AUTHORING';
  return error;
}
