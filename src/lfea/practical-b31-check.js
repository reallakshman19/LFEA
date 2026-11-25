import { semanticHash } from '../core/shared-piping-model/canonical-json.js';
import { sealCodeProfile, sealEditionDataset } from '../core/linear-fea-b31-code-engine/index.js';
import { buildB31SustainedCheck, listB31SustainedCandidates } from './native-b31-authoring.js';

/**
 * Practical analysis (docs/PRACTICAL_ANALYSIS_POLICY.md): the B31.3 SUSTAINED
 * check runs from two numbers the user types (Sc, Sh in MPa) instead of a
 * pasted, pre-sealed code profile and edition dataset. ASME allowable tables
 * are licensed, so LFEA never supplies them; CAESAR InputXML models normally
 * leave them unset (-1.0101). Every value carries LFEA_USER_ALLOWABLE_SOURCE.
 */
export const LFEA_USER_ALLOWABLE_SOURCE = 'LFEA_USER_ENTERED_ALLOWABLES';
export const LFEA_B31_PRACTICAL_REVIEWER = 'NOT ENGINEER-REVIEWED (LFEA user allowables)';
export const LFEA_B31_REFERENCE_COLD_TEMPERATURE_K = 294.26; // 70 °F, the B31.3 Sc reference temperature
const MPA = 1e6;
const PRESSURE_EFFECT_NOT_IMPLEMENTED = 'PIPING_B31_PRESSURE_EFFECT_NOT_IMPLEMENTED';

/** Build a B31 authority input, or throw with a plain message. */
export function deriveLfeaB31AuthorityInput(preFlight, { scMpa, shMpa }, { weightOnly = false, caseIds = null } = {}) {
  const sc = positive(scMpa, 'Sc');
  const sh = positive(shMpa, 'Sh');
  const structural = preFlight?.preparation?.structuralPreparation;
  if (!structural) throw practicalError('LFEA_B31_PRACTICAL_MODEL_REQUIRED', 'Import a model before running the code check.');
  const candidates = listB31SustainedCandidates(preFlight)
    .filter((row) => !weightOnly || row.caseRole === 'WEIGHT_BASE')
    .filter((row) => !caseIds || caseIds.includes(row.caseId));
  if (!candidates.length) {
    throw practicalError('LFEA_B31_PRACTICAL_NO_CANDIDATES', 'The model has no straight-pipe elements in a weight case to check.');
  }
  // One edition dataset per authority: check the material with the most candidates.
  const materialOf = (elementId) => {
    const binding = structural.segmentBindings.find((row) => row.elementId === elementId);
    return structural.materialResolutions.find((row) => row.semanticHash === binding?.materialResolutionSemanticHash);
  };
  const byMaterial = new Map();
  for (const row of candidates) {
    const material = materialOf(row.elementId);
    if (!material) continue;
    const key = material.materialState.materialId;
    if (!byMaterial.has(key)) byMaterial.set(key, { material, rows: [] });
    byMaterial.get(key).rows.push(row);
  }
  const [materialId, chosen] = [...byMaterial].sort((a, b) => b[1].rows.length - a[1].rows.length)[0];
  const hot = chosen.material.materialState.evaluationTemperature;
  const declared = (value, what) => ({ value, source: `${LFEA_USER_ALLOWABLE_SOURCE}: ${what}` });
  const allowablePoints = hot > LFEA_B31_REFERENCE_COLD_TEMPERATURE_K
    ? [
      { absoluteTemperature: LFEA_B31_REFERENCE_COLD_TEMPERATURE_K, allowableStress: declared(sc * MPA, 'Sc') },
      { absoluteTemperature: hot, allowableStress: declared(sh * MPA, 'Sh') },
    ]
    : [{ absoluteTemperature: hot, allowableStress: declared(sh * MPA, 'Sh') }];
  const codeProfile = sealCodeProfile({
    schema: 'fea-b31-code-profile/v1',
    profileId: 'LINEAR-B31-CODE-PROFILE-R1',
    codeProfileId: 'LFEA-PRACTICAL-B31-3-SUSTAINED',
    scope: 'METALLIC_PROCESS_PIPING_B31_3',
    editionStandard: 'ASME_B31_3_2024',
    flexibilitySource: 'ASME_B31J_2023',
    temperatureInterpolationPolicy: 'LINEAR_BRACKET_INTERPOLATION_V1',
    displacementRangeCombinationRuleId: 'DISPLACEMENT_RANGE_COLD_HOT_CYCLE_REDUCTION_LINEAR_V1',
    occasionalDurationFactors: [],
    liberalAllowableUse: false,
    liberalAllowableUpliftFactor: null,
    semanticHash: '',
  });
  const editionDataset = sealEditionDataset({
    schema: 'fea-b31-edition-dataset/v1',
    datasetId: `LFEA-PRACTICAL-${materialId}`,
    sourceIdentity: {
      standard: LFEA_USER_ALLOWABLE_SOURCE,
      edition: 'USER-ENTERED',
      sourceRevision: `Sc=${sc}MPa;Sh=${sh}MPa`,
      sourceSemanticHash: semanticHash({ materialId, sc, sh, hot }),
    },
    materialId,
    allowablePoints,
    displacementRangeCoefficients: {
      coldWeight: declared(1.25, 'B31.3 Eq. (1a) form, not used by SUSTAINED'),
      hotWeight: declared(0.25, 'B31.3 Eq. (1a) form, not used by SUSTAINED'),
      cycleReductionFactor: declared(1, 'f = 1, not used by SUSTAINED'),
    },
    weldJointFactor: declared(1, 'W = 1 assumed'),
    semanticHash: '',
  });
  const checks = chosen.rows.map((row) => buildB31SustainedCheck({
    preFlight, elementId: row.elementId, end: row.end, caseId: row.caseId,
    checkId: `B31-SUS-${row.elementId}-${row.end}-${row.caseId}`,
  }));
  return {
    input: {
      parentSourceBundleSemanticHash: preFlight.preparation.sourceBundleSemanticHash,
      parentModelSemanticHash: preFlight.preparation.modelSemanticHash,
      codeProfile, editionDataset, checks,
    },
    materialId,
    skippedMaterialCount: byMaterial.size - 1,
    skippedCheckCount: candidates.length - checks.length,
  };
}

/**
 * Stage, accept and publish the practical code check for the current run.
 * Returns a short status line. Throws only for bad Sc/Sh or no model, so the
 * Code tab can show the message; it never touches Results.
 */
export function runLfeaPracticalB31Check(runtime, allowables) {
  const preFlight = runtime.sourceController.getPreFlight();
  const caseIds = (runtime.executionAuthority.getState()?.execution?.caseExecutions ?? []).map((row) => row.caseId);
  if (!caseIds.length) throw practicalError('LFEA_B31_PRACTICAL_RUN_REQUIRED', 'Run the analysis first, then run the code check.');
  deriveLfeaB31AuthorityInput(preFlight, allowables, { weightOnly: true }); // validates Sc/Sh and model
  runtime.practicalB31Allowables = { scMpa: Number(allowables.scMpa), shMpa: Number(allowables.shMpa) };
  try {
    return publishPractical(runtime, deriveLfeaB31AuthorityInput(preFlight, allowables, { caseIds }), allowables, '');
  } catch (error) {
    if (error?.code !== PRESSURE_EFFECT_NOT_IMPLEMENTED) throw error;
    // Pressure cases need axial-thrust/Bourdon code terms LFEA does not implement yet:
    // check the weight case alone and say so, rather than stopping.
    return publishPractical(runtime, deriveLfeaB31AuthorityInput(preFlight, allowables, { weightOnly: true, caseIds }),
      allowables, ' Weight+pressure cases not checked: pressure axial thrust/Bourdon code terms are not implemented yet.');
  }
}

function publishPractical(runtime, derived, allowables, note) {
  const staged = runtime.stageNativeB31Authority(derived.input);
  runtime.authorizeNativeB31Authority({
    reviewerIdentity: LFEA_B31_PRACTICAL_REVIEWER,
    reason: `Practical run: Sc ${allowables.scMpa} MPa, Sh ${allowables.shMpa} MPa entered by user; W = 1; `
      + 'unity stress factors on straight pipe.',
    acceptedAuthoritySemanticHash: staged.authority.semanticHash,
  });
  runtime.publishNativeB31Application();
  const skipped = derived.skippedMaterialCount
    ? ` ${derived.skippedCheckCount} check(s) on ${derived.skippedMaterialCount} other material(s) not run (one material per check set).`
    : '';
  return `B31.3 sustained check published: ${derived.input.checks.length} check(s), material ${derived.materialId}. `
    + `Allowables entered by user. NOT ENGINEER-REVIEWED.${note}${skipped}`;
}

/** After each Run: repeat the code check if the user has already entered Sc/Sh. */
export function rerunLfeaPracticalB31Check(runtime) {
  if (!runtime.practicalB31Allowables) return null;
  try { return runLfeaPracticalB31Check(runtime, runtime.practicalB31Allowables); }
  catch { return null; }
}

function positive(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw practicalError('LFEA_B31_PRACTICAL_ALLOWABLE_INVALID', `${name} must be a positive number in MPa.`);
  }
  return number;
}

function practicalError(code, message) {
  const error = new TypeError(message);
  error.code = code;
  return error;
}
