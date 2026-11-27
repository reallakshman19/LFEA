import { semanticHash } from '../core/shared-piping-model/canonical-json.js';
import { codeStationFor } from './native-b31-code-stations.js';
import { lfeaNativeB31Error } from './native-b31-authority-contract.js';

/** Validate reviewed code parents before the authority can become reviewable. */
export function validateLfeaNativeB31CheckParents(preFlight, input, codeStationAuthority) {
  const structural = preFlight.preparation.structuralPreparation;
  const materials = new Map(structural.materialResolutions.map((row) => [row.semanticHash, row]));
  const sections = new Map(structural.sectionResolutions.map((row) => [row.semanticHash, row]));
  for (const check of input.checks) {
    const { component } = codeStationFor(codeStationAuthority, check.elementId, check.end);
    const material = materials.get(component.materialResolutionSemanticHash);
    const nominal = sections.get(component.analysisSectionSemanticHash);
    if (!material || !nominal) {
      throw lfeaNativeB31Error(
        'LFEA_NATIVE_B31_CHECK_PARENT_MISSING',
        `B31 check ${check.checkId} lacks retained material or nominal section authority.`,
      );
    }
    if (input.editionDataset.materialId !== material.materialState.materialId) {
      throw lfeaNativeB31Error(
        'LFEA_NATIVE_B31_EDITION_MATERIAL_MISMATCH',
        `B31 edition dataset material ${input.editionDataset.materialId} does not match ${material.materialState.materialId}.`,
      );
    }
    const sustained = check.sustainedSectionResolution;
    // An expansion range uses the nominal (uncorroded) section: nothing to check.
    if (sustained === null) continue;
    // A reducer end is checked with the size at that end: allowed only for a
    // REDUCER element under a reducer-rule factor set, and only for the size
    // of a pipe the element joins at that end.
    const reducerEnd = component.componentType === 'REDUCER'
      && REDUCER_FACTOR_RULE_IDS.includes(check.stressFactorSet.sourceIdentity.ruleId);
    if (sustained.dimensions.outerDiameter !== nominal.dimensions.outerDiameter) {
      if (!reducerEnd || !joinsSize(preFlight, check, sustained.dimensions.outerDiameter)) {
        throw lfeaNativeB31Error(
          'LFEA_NATIVE_B31_SUSTAINED_SECTION_OD_MISMATCH',
          `B31 check ${check.checkId} sustained section outer diameter differs from nominal B-2.3 authority.`,
        );
      }
    } else if (sustained.dimensions.wallThickness > nominal.dimensions.wallThickness) {
      throw lfeaNativeB31Error(
        'LFEA_NATIVE_B31_SUSTAINED_SECTION_WALL_INVALID',
        `B31 check ${check.checkId} sustained wall cannot exceed nominal wall.`,
      );
    }
  }
  return true;
}

const REDUCER_FACTOR_RULE_IDS = Object.freeze(['TABLE_1_1_SKETCH_3_1_REDUCER', 'TABLE_D300_REDUCER_UNITY']);
const SAME_SIZE = 0.01;

/** Does an element joining the check's end node declare (within 1%) this outer diameter? */
function joinsSize(preFlight, check, outerDiameter) {
  const structural = preFlight.preparation.structuralPreparation;
  const binding = structural.segmentBindings.find((row) => row.elementId === check.elementId);
  const node = check.end === 'I' ? binding?.startNodeId : binding?.endNodeId;
  const records = new Map((preFlight.diagnostics?.sourceBundle?.elementRecords ?? []).map((row) => [row.sourceFeatureId, row]));
  const sections = new Map(structural.sectionResolutions.map((row) => [row.semanticHash, row]));
  return structural.segmentBindings
    .filter((row) => row.elementId !== check.elementId && (row.startNodeId === node || row.endNodeId === node))
    .flatMap((row) => [records.get(row.sourceFeatureId)?.fieldEvidence?.DIAMETER?.canonicalValue,
      sections.get(row.analysisSectionSemanticHash)?.dimensions.outerDiameter])
    .some((value) => typeof value === 'number' && Math.abs(value - outerDiameter) <= SAME_SIZE * outerDiameter);
}

/** Bind reviewed check intent to exact retained frame/section/material parents. */
export function buildLfeaNativeB31ApplicationChecks(preFlight, chains, authority) {
  const structural = preFlight.preparation.structuralPreparation;
  const materials = new Map(structural.materialResolutions.map((row) => [row.semanticHash, row]));
  const sections = new Map(structural.sectionResolutions.map((row) => [row.semanticHash, row]));
  const chainById = new Map(chains.map((row) => [row.caseId, row]));
  return authority.checks.map((check) => {
    const { component, station } = codeStationFor(
      authority.codeStationAuthority,
      check.elementId,
      check.end,
    );
    const evaluationCase = chainById.get(check.evaluationCaseId);
    const frameElementRecord = evaluationCase?.frameElementById?.[check.elementId];
    const sectionResolution = sections.get(component.analysisSectionSemanticHash);
    const materialResolution = materials.get(component.materialResolutionSemanticHash);
    if (!evaluationCase || !frameElementRecord || !sectionResolution || !materialResolution) {
      throw lfeaNativeB31Error(
        'LFEA_NATIVE_B31_CHECK_PARENT_MISSING',
        `B31 check ${check.checkId} lacks exact frame/section/material authority.`,
      );
    }
    return {
      checkId: check.checkId,
      category: check.category,
      codePointId: station.stationId,
      componentId: component.componentId,
      combinationId: check.combinationId,
      actionSource: check.actionSource,
      frameElementRecord,
      sectionResolution,
      sustainedSectionResolution: check.sustainedSectionResolution,
      materialResolution,
      stressFactorSet: check.stressFactorSet,
      pressureStressContribution: check.pressureStressContribution,
      coldTemperature: check.coldTemperature,
      sustainedStress: check.sustainedStress,
      occasionalCategoryId: check.occasionalCategoryId,
    };
  });
}

export function lfeaNativeB31ApplicationId(authority, recoveryBatchHash) {
  const hash = semanticHash({ authority: authority.semanticHash, recoveryBatchHash });
  return `LFEA-B31-${hash.slice('fnv1a64:'.length).toUpperCase()}`;
}
