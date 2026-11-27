/**
 * Hangers CAESAR would size, designed in two passes (practical analysis,
 * docs/PRACTICAL_ANALYSIS_POLICY.md).
 *
 * A CAESAR hanger with no spring rate is a request for CAESAR's hanger
 * design, which starts from a restrained-weight solve: the pipe's weight with
 * every such hanger held rigid. LFEA runs that solve (weight only, the same
 * governed chain as any run) and then carries each hanger as a constant-effort
 * support of its restrained-weight reaction in every case. That is CAESAR's
 * design load without its spring selection: no load variation with travel,
 * which a spring of up to 25% variation would add. A hanger the pipe would
 * pull down on gets no load. Labelled LFEA_HANGER_CONSTANT_EFFORT_DEFAULT,
 * NOT ENGINEER-REVIEWED; the loads and the weight run they came from are sealed
 * into the pre-flight. If the weight pass cannot run, the model is left exactly
 * as it was (still blocked by the undesigned hangers).
 */
import { createLfeaNativeExecutionAuthority } from '../lfea/native-execution-authority.js';
import { authorizeLinearPipingInputXmlPreFlight } from './linear-piping-inputxml-prefea.js';

export const LFEA_HANGER_DESIGN_SOURCE = 'LFEA_HANGER_CONSTANT_EFFORT_DEFAULT';
export const LFEA_HANGER_DESIGN_REVIEWER = 'NOT ENGINEER-REVIEWED (LFEA hanger restrained-weight pass)';
const UNDESIGNED_CODE = 'MODEL_HANGER_PREDEFINED_DATA_INCOMPLETE';

/**
 * `prepare(intake, options)` runs the pre-flight; `weightIntake()` seals the
 * same source with only the weight case requested.
 */
/**
 * `onNote(text)`, when given, hears why a weight pass could not run, so the
 * Source tab can say so instead of leaving only the undesigned-hanger finding.
 */
export function prepareLfeaPreFlightWithHangerDesign({
  intake, prepare, weightIntake, weightCaseId = 'IXP-W', onNote = () => {},
}) {
  const base = prepare(intake, {});
  const undesigned = (base.diagnostics?.representabilityDiagnostics?.inventory ?? [])
    .filter((row) => row.active && row.sourceKind === 'HANGER' && row.classification?.designRequired);
  if (undesigned.length === 0 || !(base.preparation?.findings ?? []).some((row) => row.code === UNDESIGNED_CODE)) return base;
  try {
    const pass = prepare(weightIntake(), withDesign({ mode: 'RESTRAINED_WEIGHT' }));
    if (pass.status === 'BLOCK') {
      const reasons = [...new Set(pass.preparation.findings.filter((row) => row.disposition === 'BLOCK')
        .map((row) => row.message))].slice(0, 2);
      onNote(`Hanger design: the restrained-weight pass is blocked (${reasons.join(' ')}), so the ${undesigned.length} hanger(s) CAESAR would size stay undesigned.`);
      return base;
    }
    const design = restrainedWeightLoads(pass, weightCaseId);
    if (design === null) return base;
    return prepare(intake, withDesign({ mode: 'CONSTANT_EFFORT', loads: design.loads, basis: design.basis }));
  } catch (error) {
    onNote(`Hanger design: the restrained-weight pass failed (${error?.message ?? error}); the hanger(s) stay undesigned.`);
    return base;
  }
}

function restrainedWeightLoads(passPreFlight, weightCaseId) {
  const preFlight = passPreFlight.solveAuthorized ? passPreFlight : authorizeLinearPipingInputXmlPreFlight(passPreFlight, {
    approverIdentity: LFEA_HANGER_DESIGN_REVIEWER,
    reason: 'Restrained-weight pass for hangers CAESAR would size.',
  });
  const state = createLfeaNativeExecutionAuthority().run(preFlight, { requestedCaseIds: [weightCaseId] });
  const execution = state.execution?.caseExecutions?.find((row) => row.caseId === weightCaseId)?.execution;
  if (!execution) return null;
  const structural = preFlight.preparation.structuralPreparation;
  const constraintById = new Map(structural.compilation.model.constraints.map((row) => [row.constraintId, row]));
  const loads = {};
  for (const binding of structural.constraintBindings.filter((row) => row.sourceKind === 'HANGER'
    && row.hangerDesignMode === 'RESTRAINED_WEIGHT')) {
    const nodeId = binding.declarationIds.map((id) => constraintById.get(id)?.nodeId).find(Boolean) ?? null;
    const reaction = nodeId === null ? 0 : execution.reactions
      .filter((row) => row.nodeId === nodeId && row.dof === 'UY')
      .reduce((sum, row) => sum + row.value, 0);
    loads[binding.sourceFeatureId] = Math.max(0, reaction);
  }
  return {
    loads,
    basis: Object.freeze({
      source: LFEA_HANGER_DESIGN_SOURCE,
      reviewerIdentity: LFEA_HANGER_DESIGN_REVIEWER,
      restrainedWeightCaseId: weightCaseId,
      restrainedWeightExecutionBatchId: state.execution.executionBatchId,
    }),
  };
}

function withDesign(hangerDesign) {
  return { diagnosticsOptions: { representabilityOptions: { hangerDesign } } };
}
