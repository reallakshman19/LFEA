import { declaredLengthToSiFactor } from '../core/linear-piping-analysis-consumer/restraint-spring-rate.js';

/**
 * One-way and gapped supports, solved by active-set iteration.
 *
 * Practical analysis (docs/PRACTICAL_ANALYSIS_POLICY.md). Two support
 * behaviours act only on contact:
 *
 * - a one-way support (CAESAR "+Y" etc.) pushes the pipe one way and lifts off
 *   if the pipe moves away;
 * - a gapped guide or limit stop (CAESAR GAP > 0) does nothing until the pipe
 *   has moved the gap distance, then holds it there; a two-way gapped
 *   restraint has a stop on each side.
 *
 * Both are the same contact: a gap g (0 for a plain one-way support) and the
 * side(s) the pipe can touch. Per load case the iteration:
 *
 *   1. solves with every restraint as the linear model has it;
 *   2. opens every contact that pulls instead of pushing, and every gap (a pipe
 *      sitting at zero cannot be touching a stop g away); closes every open
 *      contact the pipe has moved past, holding it at the gap distance;
 *   3. repeats until nothing changes, at most LFEA_UNILATERAL_ACTIVE_SET_ITERATION_CAP
 *      solves per case.
 *
 * On by default, labelled LFEA_UNILATERAL_ACTIVE_SET_ITERATION, and sealed into
 * the raw execution batch. It never blocks: if a case does not settle, or a
 * change cannot be solved (for example a mechanism), the last solved state is
 * published with a status that says so. One-way springs and gaps whose length
 * cannot be resolved stay linear and are counted. Support friction (CAESAR
 * FRIC_COEF) is not applied yet: supports slide freely, and the count of
 * friction coefficients not applied is recorded and shown.
 */
export const LFEA_UNILATERAL_ACTIVE_SET_SOURCE = 'LFEA_UNILATERAL_ACTIVE_SET_ITERATION';
export const LFEA_UNILATERAL_ACTIVE_SET_REVIEWER = 'NOT ENGINEER-REVIEWED (LFEA unilateral active set)';
export const LFEA_UNILATERAL_ACTIVE_SET_SCHEMA = 'lfea-unilateral-active-set/v2';
export const LFEA_UNILATERAL_ACTIVE_SET_ITERATION_CAP = 20;
export const LFEA_UNILATERAL_ACTIVE_SET_STATUS = Object.freeze({
  NOT_APPLICABLE: 'NOT_APPLICABLE',
  CONVERGED: 'CONVERGED',
  NOT_CONVERGED_ITERATION_CAP: 'NOT_CONVERGED_ITERATION_CAP',
  NOT_CONVERGED_CYCLE: 'NOT_CONVERGED_CYCLE',
  STOPPED_RELEASE_UNSOLVABLE: 'STOPPED_RELEASE_UNSOLVABLE',
  NOT_EVALUATED: 'NOT_EVALUATED',
});

/** Relative tolerances: a force or movement smaller than this share of the case's largest is treated as zero. */
const RELATIVE_FORCE_TOLERANCE = 1e-9;
const RELATIVE_GAP_TOLERANCE = 1e-9;
const TRANSLATIONS = Object.freeze(['UX', 'UY', 'UZ']);
const GAP_CLOSED_CODE = 'GENERIC_APPROX_GAP_CLOSED';
const FRICTION_IGNORED_CODE = 'GENERIC_APPROX_FRICTION_IGNORED';
const OPEN = 'OPEN';
const LINEAR = 'LINEAR';
const closedOn = (side) => (side > 0 ? 'CLOSED+' : 'CLOSED-');
const sideOf = (state) => (state === 'CLOSED+' ? 1 : state === 'CLOSED-' ? -1 : 0);

/**
 * Contact candidates. `sourceBundle` (the pre-flight's InputXML source bundle)
 * supplies GAP values.
 */
export function lfeaUnilateralCandidates(preparation, sourceBundle = null) {
  const structural = preparation?.structuralPreparation;
  const constraints = structural?.compilation?.model?.constraints ?? [];
  const byId = new Map(constraints.map((row) => [row.constraintId, row]));
  const gaps = sourceGaps(sourceBundle);
  const candidates = [];
  const linearized = { oneWaySpring: 0, gapUnresolved: 0, frictionNotApplied: 0 };
  for (const binding of structural?.constraintBindings ?? []) {
    const action = binding.unilateralAction ?? null;
    const codes = binding.limitationCodes ?? [];
    const gapped = codes.includes(GAP_CLOSED_CODE);
    if (codes.includes(FRICTION_IGNORED_CODE)) linearized.frictionNotApplied += 1;
    if (!action && !gapped) continue;
    const dof = action?.dof ?? (binding.targetDofs?.length === 1 ? binding.targetDofs[0] : null);
    const constraint = (binding.declarationIds ?? []).map((id) => byId.get(id))
      .find((row) => row?.behavior === 'FIXED' && row.dof === dof && TRANSLATIONS.includes(dof));
    if (!constraint) {
      if (action) linearized.oneWaySpring += 1;
      if (gapped) linearized.gapUnresolved += 1;
      continue;
    }
    const gap = gapped ? (gaps.get(binding.sourceFeatureId) ?? null) : 0;
    if (gap === null) {
      linearized.gapUnresolved += 1;
      if (!action) continue;
    }
    candidates.push(Object.freeze({
      constraintId: constraint.constraintId,
      nodeId: constraint.nodeId,
      dof,
      kind: action ? (gap ? 'ONE_WAY_GAPPED' : 'ONE_WAY') : 'GAPPED',
      gap: gap ?? 0,
      sides: Object.freeze(action ? [-action.resistedSign] : [1, -1]),
      resistedSign: action?.resistedSign ?? null,
      sourceNodeId: String(binding.sourceNodeId),
      sourceFeatureId: binding.sourceFeatureId,
    }));
  }
  candidates.sort((left, right) => compareAscii(left.constraintId, right.constraintId));
  return Object.freeze({ candidates: Object.freeze(candidates), linearized: Object.freeze(linearized) });
}

/**
 * Run the iteration and return the final governed batch.
 *
 * `solve(caseIds, activeSetRecord)` must run the governed solve gateway for
 * those cases; the record carries each case's solver inputs.
 */
export function solveWithLfeaUnilateralActiveSet(preparation, requestedCaseIds, solve, options = {}) {
  const found = lfeaUnilateralCandidates(preparation, options.sourceBundle ?? null);
  const context = {
    candidates: found.candidates,
    constraints: preparation.structuralPreparation.compilation.model.constraints,
  };
  const cases = requestedCaseIds.map((caseId) => (found.candidates.length === 0
    ? caseRecord(caseId, LFEA_UNILATERAL_ACTIVE_SET_STATUS.NOT_APPLICABLE, initialState(context), context, 0, [])
    : iterateCase(caseId, context, solve)));
  return solve(requestedCaseIds, activeSetRecord(cases, found));
}

function initialState(context) {
  return new Map(context.candidates.map((row) => [row.constraintId, row.gap > 0 ? LINEAR : closedOn(row.sides[0])]));
}

function iterateCase(caseId, context, solve) {
  const solveCase = (state) => {
    const batch = solve([caseId], provisionalRecord(caseId, context, state));
    return batch?.caseExecutions?.find((row) => row.caseId === caseId) ?? null;
  };
  let state = initialState(context);
  let current = solveCase(state);
  if (!current?.execution) {
    return caseRecord(caseId, LFEA_UNILATERAL_ACTIVE_SET_STATUS.NOT_EVALUATED, state, context, 1, []);
  }
  const seen = new Set([signature(state)]);
  const history = [];
  let solveCount = 1;
  for (;;) {
    const changes = evaluate(current.execution, context, state);
    if (changes.length === 0) {
      return caseRecord(caseId, LFEA_UNILATERAL_ACTIVE_SET_STATUS.CONVERGED, state, context, solveCount, history);
    }
    if (solveCount >= LFEA_UNILATERAL_ACTIVE_SET_ITERATION_CAP) {
      return caseRecord(caseId, LFEA_UNILATERAL_ACTIVE_SET_STATUS.NOT_CONVERGED_ITERATION_CAP, state, context, solveCount, history);
    }
    // Changing several supports at once can leave a span free to move; then
    // apply only the most severe change, the conservative single step.
    const attempts = [applyChanges(state, changes)];
    if (changes.length > 1) attempts.push(applyChanges(state, changes.slice(0, 1)));
    let accepted = null;
    for (const attempt of attempts) {
      if (seen.has(signature(attempt))) continue;
      solveCount += 1;
      const solved = trySolve(solveCase, attempt);
      if (solved) { accepted = { state: attempt, solved }; break; }
    }
    if (!accepted) {
      const cycled = attempts.every((attempt) => seen.has(signature(attempt)));
      return caseRecord(caseId, cycled
        ? LFEA_UNILATERAL_ACTIVE_SET_STATUS.NOT_CONVERGED_CYCLE
        : LFEA_UNILATERAL_ACTIVE_SET_STATUS.STOPPED_RELEASE_UNSOLVABLE, state, context, solveCount, history);
    }
    history.push(historyEntry(solveCount, state, accepted.state));
    state = accepted.state;
    seen.add(signature(state));
    current = accepted.solved;
  }
}

function trySolve(solveCase, state) {
  try {
    const row = solveCase(state);
    return row?.execution && row.executionStatus !== 'BLOCKED' ? row : null;
  } catch {
    return null;
  }
}

/** Every contact change the current solve calls for, most severe first. */
function evaluate(execution, context, state) {
  const reactions = sumByKey(execution.reactions);
  const displacements = sumByKey(execution.displacement);
  const springActions = groundedSpringActions(context.constraints, displacements);
  const forceScale = Math.max(maxAbs(execution.reactions.filter((row) => TRANSLATIONS.includes(row.dof))), Number.MIN_VALUE);
  const gapScale = Math.max(
    maxAbs(execution.displacement.filter((row) => TRANSLATIONS.includes(row.dof))),
    ...context.candidates.map((row) => row.gap),
    Number.MIN_VALUE,
  );
  const changes = [];
  for (const candidate of context.candidates) {
    const key = `${candidate.nodeId}:${candidate.dof}`;
    const contact = state.get(candidate.constraintId);
    if (contact === LINEAR) {
      changes.push({ id: candidate.constraintId, to: OPEN, severity: Number.POSITIVE_INFINITY });
      continue;
    }
    if (contact === OPEN) {
      const movement = displacements.get(key) ?? 0;
      const side = candidate.sides.find((value) => movement * value > candidate.gap + RELATIVE_GAP_TOLERANCE * gapScale);
      if (side !== undefined) {
        changes.push({ id: candidate.constraintId, to: closedOn(side), severity: (movement * side - candidate.gap) / gapScale });
      }
      continue;
    }
    // Closed on side s: the stop must push the pipe back toward -s. Its own
    // reaction is the node's total less any grounded spring sharing the DOF.
    const own = (reactions.get(key) ?? 0) - (springActions.get(key) ?? 0);
    const pull = own * sideOf(contact);
    if (pull > RELATIVE_FORCE_TOLERANCE * forceScale) {
      changes.push({ id: candidate.constraintId, to: OPEN, severity: pull / forceScale });
    }
  }
  changes.sort((left, right) => right.severity - left.severity || compareAscii(left.id, right.id));
  return changes;
}

function applyChanges(state, changes) {
  const next = new Map(state);
  for (const change of changes) next.set(change.id, change.to);
  return next;
}

function solverInputs(context, state) {
  const releasedConstraintIds = [];
  const constraintOffsets = [];
  for (const candidate of context.candidates) {
    const contact = state.get(candidate.constraintId);
    if (contact === OPEN) releasedConstraintIds.push(candidate.constraintId);
    else if (sideOf(contact) !== 0 && candidate.gap > 0) {
      constraintOffsets.push({ constraintId: candidate.constraintId, value: sideOf(contact) * candidate.gap });
    }
  }
  return { releasedConstraintIds, constraintOffsets };
}

function groundedSpringActions(constraints, displacements) {
  const actions = new Map();
  const add = (key, value) => actions.set(key, (actions.get(key) ?? 0) + value);
  for (const constraint of constraints) {
    if (constraint.behavior !== 'LINEAR_SPRING' || constraint.connectedNodeId) continue;
    if (!Array.isArray(constraint.direction)) {
      const key = `${constraint.nodeId}:${constraint.dof}`;
      add(key, -constraint.stiffness * (displacements.get(key) ?? 0));
      continue;
    }
    const u = TRANSLATIONS.map((dof) => displacements.get(`${constraint.nodeId}:${dof}`) ?? 0);
    const extension = constraint.direction.reduce((sum, component, index) => sum + component * u[index], 0);
    constraint.direction.forEach((component, index) => {
      add(`${constraint.nodeId}:${TRANSLATIONS[index]}`, -constraint.stiffness * extension * component);
    });
  }
  return actions;
}

/** GAP in metres per restraint source feature; null where the length unit cannot be resolved. */
function sourceGaps(sourceBundle) {
  const gaps = new Map();
  const factor = declaredLengthToSiFactor(sourceBundle?.unitSystem?.lengthUnit);
  for (const record of sourceBundle?.elementRecords ?? []) {
    for (const feature of record.childFeatures ?? []) {
      if (feature.kind !== 'RESTRAINT') continue;
      const gap = Number(feature.rawAttributes?.GAP);
      gaps.set(feature.sourceFeatureId, Number.isFinite(gap) && gap > 0 && typeof factor === 'number' ? gap * factor : null);
    }
  }
  return gaps;
}

function provisionalRecord(caseId, context, state) {
  return {
    schema: LFEA_UNILATERAL_ACTIVE_SET_SCHEMA,
    sourceId: LFEA_UNILATERAL_ACTIVE_SET_SOURCE,
    provisional: true,
    cases: [{ caseId, ...solverInputs(context, state) }],
  };
}

function historyEntry(solve, before, after) {
  const changes = [];
  for (const [id, to] of after) {
    if (before.get(id) !== to) changes.push(Object.freeze({ constraintId: id, from: before.get(id), to }));
  }
  return Object.freeze({ solve, changes: Object.freeze(changes) });
}

function caseRecord(caseId, status, state, context, solveCount, history) {
  const inputs = solverInputs(context, state);
  const view = (row) => ({ constraintId: row.constraintId, nodeId: row.nodeId, sourceNodeId: row.sourceNodeId, dof: row.dof });
  return Object.freeze({
    caseId,
    status,
    solveCount,
    releasedConstraintIds: Object.freeze(inputs.releasedConstraintIds),
    constraintOffsets: Object.freeze(inputs.constraintOffsets.map((row) => Object.freeze(row))),
    liftedOff: Object.freeze(context.candidates
      .filter((row) => row.resistedSign !== null && state.get(row.constraintId) === OPEN)
      .map((row) => Object.freeze({ ...view(row), resistedSign: row.resistedSign }))),
    gaps: Object.freeze(context.candidates
      .filter((row) => row.gap > 0)
      .map((row) => Object.freeze({ ...view(row), gap: row.gap, state: state.get(row.constraintId) }))),
    history: Object.freeze([...history]),
  });
}

function activeSetRecord(cases, found) {
  const statuses = cases.map((row) => row.status);
  const status = statuses.every((value) => value === LFEA_UNILATERAL_ACTIVE_SET_STATUS.NOT_APPLICABLE)
    ? LFEA_UNILATERAL_ACTIVE_SET_STATUS.NOT_APPLICABLE
    : statuses.find((value) => value !== LFEA_UNILATERAL_ACTIVE_SET_STATUS.CONVERGED
      && value !== LFEA_UNILATERAL_ACTIVE_SET_STATUS.NOT_APPLICABLE) ?? LFEA_UNILATERAL_ACTIVE_SET_STATUS.CONVERGED;
  return {
    schema: LFEA_UNILATERAL_ACTIVE_SET_SCHEMA,
    sourceId: LFEA_UNILATERAL_ACTIVE_SET_SOURCE,
    reviewerIdentity: LFEA_UNILATERAL_ACTIVE_SET_REVIEWER,
    provisional: false,
    iterationCap: LFEA_UNILATERAL_ACTIVE_SET_ITERATION_CAP,
    relativeForceTolerance: RELATIVE_FORCE_TOLERANCE,
    relativeGapTolerance: RELATIVE_GAP_TOLERANCE,
    candidateCount: found.candidates.filter((row) => row.resistedSign !== null).length,
    gapCandidateCount: found.candidates.filter((row) => row.gap > 0).length,
    linearizedSpringCount: found.linearized.oneWaySpring,
    linearizedGapCount: found.linearized.gapUnresolved,
    frictionNotAppliedCount: found.linearized.frictionNotApplied,
    status,
    cases,
  };
}

/** One line for the Results basis, or null when no record exists. */
export function lfeaUnilateralActiveSetLabel(record) {
  if (!record) return null;
  const friction = record.frictionNotAppliedCount
    ? ` ${record.frictionNotAppliedCount} support friction coefficient(s) not applied: those supports slide freely.`
    : '';
  if (record.status === LFEA_UNILATERAL_ACTIVE_SET_STATUS.NOT_APPLICABLE) {
    return `No rigid one-way or gapped supports in the model (${LFEA_UNILATERAL_ACTIVE_SET_SOURCE}).${friction}`;
  }
  const gapText = (row) => {
    const all = row.gaps ?? [];
    if (all.length === 0) return '';
    const closed = all.filter((gap) => gap.state !== OPEN);
    return `, gaps ${closed.length} closed${closed.length
      ? ` (${closed.map((gap) => `${gap.sourceNodeId} ${gap.dof} ${gap.state === 'CLOSED+' ? '+' : '-'}${formatMm(gap.gap)} mm`).join(', ')})`
      : ''} / ${all.length - closed.length} open`;
  };
  const perCase = record.cases.map((row) => `${row.caseId}: ${row.liftedOff.length} lifted off`
    + `${row.liftedOff.length ? ` (${row.liftedOff.map((lift) => lift.sourceNodeId).join(', ')})` : ''}`
    + `${gapText(row)}, ${row.solveCount} solve(s), ${row.status}`).join('; ');
  const linear = [
    record.linearizedSpringCount ? `${record.linearizedSpringCount} one-way spring(s) kept linear` : '',
    record.linearizedGapCount ? `${record.linearizedGapCount} gap(s) with unresolved length unit kept closed` : '',
  ].filter(Boolean).join('; ');
  const warning = record.status === LFEA_UNILATERAL_ACTIVE_SET_STATUS.CONVERGED
    ? '' : ' Did not converge: the last solved state is shown.';
  return `One-way and gapped supports solved by active-set iteration (${LFEA_UNILATERAL_ACTIVE_SET_SOURCE}): `
    + `${record.candidateCount} one-way, ${record.gapCandidateCount ?? 0} gapped; ${perCase}. `
    + 'Lifted-off supports and open gaps carry zero; closed gaps hold the pipe at the gap distance.'
    + `${linear ? ` ${linear}.` : ''}${friction}${warning} ${LFEA_UNILATERAL_ACTIVE_SET_REVIEWER}.`;
}

function signature(state) {
  return [...state].sort(([left], [right]) => compareAscii(left, right)).map(([id, value]) => `${id}=${value}`).join('|');
}
function formatMm(metres) { return String(Math.round(metres * 1e4) / 10); }
function sumByKey(rows) {
  const map = new Map();
  for (const row of rows ?? []) {
    const key = `${row.nodeId}:${row.dof}`;
    map.set(key, (map.get(key) ?? 0) + row.value);
  }
  return map;
}
function maxAbs(rows) { return rows.reduce((max, row) => Math.max(max, Math.abs(row.value)), 0); }
function compareAscii(left, right) { return left < right ? -1 : left > right ? 1 : 0; }
