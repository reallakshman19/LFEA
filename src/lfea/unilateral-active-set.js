/**
 * One-way (unilateral) supports, solved by active-set iteration.
 *
 * Practical analysis (docs/PRACTICAL_ANALYSIS_POLICY.md): a CAESAR "+Y" support
 * can only push the pipe up. The linear model restrains it both ways, so a
 * support the real pipe lifts off can end up pulling the pipe down. This
 * module repeats the linear solve per load case:
 *
 *   1. solve with the current active set;
 *   2. release every one-way support whose reaction opposes the only
 *      direction it can resist;
 *   3. re-engage every released support whose pipe has moved back into it
 *      (its gap has closed);
 *   4. stop when nothing changes, capped at LFEA_UNILATERAL_ACTIVE_SET_ITERATION_CAP
 *      solves per case.
 *
 * It is on by default and labelled LFEA_UNILATERAL_ACTIVE_SET_ITERATION. The
 * final record is sealed into the raw execution batch. It never blocks: if a
 * case does not converge, or a release would leave the pipe free to move as a
 * mechanism, the last solved state is published with a status that says so.
 * Only rigid one-way supports are iterated; a one-way spring stays linearized
 * and is counted in the record.
 */
export const LFEA_UNILATERAL_ACTIVE_SET_SOURCE = 'LFEA_UNILATERAL_ACTIVE_SET_ITERATION';
export const LFEA_UNILATERAL_ACTIVE_SET_REVIEWER = 'NOT ENGINEER-REVIEWED (LFEA unilateral active set)';
export const LFEA_UNILATERAL_ACTIVE_SET_SCHEMA = 'lfea-unilateral-active-set/v1';
export const LFEA_UNILATERAL_ACTIVE_SET_ITERATION_CAP = 20;
export const LFEA_UNILATERAL_ACTIVE_SET_STATUS = Object.freeze({
  NOT_APPLICABLE: 'NOT_APPLICABLE',
  CONVERGED: 'CONVERGED',
  NOT_CONVERGED_ITERATION_CAP: 'NOT_CONVERGED_ITERATION_CAP',
  NOT_CONVERGED_CYCLE: 'NOT_CONVERGED_CYCLE',
  STOPPED_RELEASE_UNSOLVABLE: 'STOPPED_RELEASE_UNSOLVABLE',
  NOT_EVALUATED: 'NOT_EVALUATED',
});

/** Relative tolerances: a reaction or gap smaller than this share of the case's largest is treated as zero. */
const RELATIVE_FORCE_TOLERANCE = 1e-9;
const RELATIVE_GAP_TOLERANCE = 1e-9;
const TRANSLATIONS = Object.freeze(['UX', 'UY', 'UZ']);

/** Rigid one-way supports the iteration may release, and one-way springs it leaves linear. */
export function lfeaUnilateralCandidates(preparation) {
  const structural = preparation?.structuralPreparation;
  const constraints = structural?.compilation?.model?.constraints ?? [];
  const byId = new Map(constraints.map((row) => [row.constraintId, row]));
  const candidates = [];
  let linearizedSpringCount = 0;
  for (const binding of structural?.constraintBindings ?? []) {
    const action = binding.unilateralAction;
    if (!action) continue;
    const constraint = (binding.declarationIds ?? []).map((id) => byId.get(id))
      .find((row) => row?.behavior === 'FIXED' && row.dof === action.dof);
    if (!constraint) { linearizedSpringCount += 1; continue; }
    candidates.push(Object.freeze({
      constraintId: constraint.constraintId,
      nodeId: constraint.nodeId,
      dof: constraint.dof,
      resistedSign: action.resistedSign,
      sourceNodeId: String(binding.sourceNodeId),
      sourceFeatureId: binding.sourceFeatureId,
    }));
  }
  candidates.sort((left, right) => compareAscii(left.constraintId, right.constraintId));
  return Object.freeze({ candidates: Object.freeze(candidates), linearizedSpringCount });
}

/**
 * Run the iteration and return the final governed batch.
 *
 * `solve(caseIds, activeSetRecord)` must run the governed solve gateway for
 * those cases; the record names the released constraints per case.
 */
export function solveWithLfeaUnilateralActiveSet(preparation, requestedCaseIds, solve) {
  const { candidates, linearizedSpringCount } = lfeaUnilateralCandidates(preparation);
  const model = preparation.structuralPreparation.compilation.model;
  const cases = candidates.length === 0
    ? requestedCaseIds.map((caseId) => notApplicableCase(caseId))
    : requestedCaseIds.map((caseId) => iterateCase(caseId, candidates, model, solve));
  return solve(requestedCaseIds, activeSetRecord(cases, candidates.length, linearizedSpringCount));
}

function iterateCase(caseId, candidates, model, solve) {
  const solveCase = (released) => {
    const batch = solve([caseId], provisionalRecord(caseId, released));
    return batch?.caseExecutions?.find((row) => row.caseId === caseId) ?? null;
  };
  let released = [];
  let current = solveCase(released);
  if (!current?.execution) return caseRecord(caseId, LFEA_UNILATERAL_ACTIVE_SET_STATUS.NOT_EVALUATED, released, candidates, 1, []);
  const seen = new Set([released.join('|')]);
  const history = [];
  let solveCount = 1;
  for (;;) {
    const step = evaluate(current.execution, candidates, new Set(released), model);
    if (step.release.length === 0 && step.engage.length === 0) {
      return caseRecord(caseId, LFEA_UNILATERAL_ACTIVE_SET_STATUS.CONVERGED, released, candidates, solveCount, history);
    }
    if (solveCount >= LFEA_UNILATERAL_ACTIVE_SET_ITERATION_CAP) {
      return caseRecord(caseId, LFEA_UNILATERAL_ACTIVE_SET_STATUS.NOT_CONVERGED_ITERATION_CAP, released, candidates, solveCount, history);
    }
    const attempts = [nextSet(released, step.release, step.engage)];
    // Releasing several supports at once can leave a span free to move; then
    // release only the worst one, which is the conservative single step.
    if (step.release.length > 1) attempts.push(nextSet(released, step.release.slice(0, 1), step.engage));
    let accepted = null;
    for (const attempt of attempts) {
      if (seen.has(attempt.join('|'))) continue;
      solveCount += 1;
      const solved = trySolve(solveCase, attempt);
      if (solved) { accepted = { set: attempt, solved }; break; }
    }
    if (!accepted) {
      const cycled = attempts.every((attempt) => seen.has(attempt.join('|')));
      return caseRecord(caseId, cycled
        ? LFEA_UNILATERAL_ACTIVE_SET_STATUS.NOT_CONVERGED_CYCLE
        : LFEA_UNILATERAL_ACTIVE_SET_STATUS.STOPPED_RELEASE_UNSOLVABLE, released, candidates, solveCount, history);
    }
    const releasedNow = accepted.set.filter((id) => !released.includes(id));
    const engagedNow = released.filter((id) => !accepted.set.includes(id));
    history.push(Object.freeze({
      solve: solveCount,
      released: Object.freeze(releasedNow),
      reengaged: Object.freeze(engagedNow),
      liftedOffCount: accepted.set.length,
    }));
    released = accepted.set;
    seen.add(released.join('|'));
    current = accepted.solved;
  }
}

function trySolve(solveCase, released) {
  try {
    const row = solveCase(released);
    return row?.execution && row.executionStatus !== 'BLOCKED' ? row : null;
  } catch {
    return null;
  }
}

/** Which engaged supports pull the wrong way, and which released ones the pipe has moved back into. */
function evaluate(execution, candidates, released, model) {
  const reactions = sumByKey(execution.reactions);
  const displacements = sumByKey(execution.displacement);
  const springActions = groundedSpringActions(model, displacements);
  const forceScale = maxAbs(execution.reactions.filter((row) => TRANSLATIONS.includes(row.dof)));
  const gapScale = maxAbs(execution.displacement.filter((row) => TRANSLATIONS.includes(row.dof)));
  const release = [];
  const engage = [];
  for (const candidate of candidates) {
    const key = `${candidate.nodeId}:${candidate.dof}`;
    if (released.has(candidate.constraintId)) {
      const movement = (displacements.get(key) ?? 0) * candidate.resistedSign;
      if (movement < -RELATIVE_GAP_TOLERANCE * gapScale) engage.push(candidate.constraintId);
      continue;
    }
    const own = (reactions.get(key) ?? 0) - (springActions.get(key) ?? 0);
    const signed = own * candidate.resistedSign;
    if (signed < -RELATIVE_FORCE_TOLERANCE * forceScale) release.push({ id: candidate.constraintId, signed });
  }
  release.sort((left, right) => left.signed - right.signed || compareAscii(left.id, right.id));
  return { release: release.map((row) => row.id), engage: engage.sort(compareAscii) };
}

function groundedSpringActions(model, displacements) {
  const actions = new Map();
  const add = (key, value) => actions.set(key, (actions.get(key) ?? 0) + value);
  for (const constraint of model.constraints) {
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

function nextSet(released, release, engage) {
  const engageSet = new Set(engage);
  return [...new Set([...released.filter((id) => !engageSet.has(id)), ...release])].sort(compareAscii);
}

function provisionalRecord(caseId, released) {
  return {
    schema: LFEA_UNILATERAL_ACTIVE_SET_SCHEMA,
    sourceId: LFEA_UNILATERAL_ACTIVE_SET_SOURCE,
    provisional: true,
    cases: [{ caseId, releasedConstraintIds: [...released] }],
  };
}

function notApplicableCase(caseId) {
  return caseRecord(caseId, LFEA_UNILATERAL_ACTIVE_SET_STATUS.NOT_APPLICABLE, [], [], 0, []);
}

function caseRecord(caseId, status, released, candidates, solveCount, history) {
  const byId = new Map(candidates.map((row) => [row.constraintId, row]));
  return Object.freeze({
    caseId,
    status,
    solveCount,
    releasedConstraintIds: Object.freeze([...released]),
    liftedOff: Object.freeze(released.map((id) => {
      const row = byId.get(id);
      return Object.freeze({
        constraintId: id, nodeId: row.nodeId, sourceNodeId: row.sourceNodeId, dof: row.dof, resistedSign: row.resistedSign,
      });
    })),
    history: Object.freeze([...history]),
  });
}

function activeSetRecord(cases, candidateCount, linearizedSpringCount) {
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
    candidateCount,
    linearizedSpringCount,
    status,
    cases,
  };
}

/** One line for the Results basis, or null when no record exists. */
export function lfeaUnilateralActiveSetLabel(record) {
  if (!record) return null;
  if (record.status === LFEA_UNILATERAL_ACTIVE_SET_STATUS.NOT_APPLICABLE) {
    return `No rigid one-way supports in the model (${LFEA_UNILATERAL_ACTIVE_SET_SOURCE}).`;
  }
  const perCase = record.cases.map((row) => `${row.caseId}: ${row.liftedOff.length} lifted off`
    + `${row.liftedOff.length ? ` (${row.liftedOff.map((lift) => lift.sourceNodeId).join(', ')})` : ''}`
    + `, ${row.solveCount} solve(s), ${row.status}`).join('; ');
  const springs = record.linearizedSpringCount ? ` ${record.linearizedSpringCount} one-way spring(s) kept linear.` : '';
  const warning = record.status === LFEA_UNILATERAL_ACTIVE_SET_STATUS.CONVERGED
    ? '' : ' Did not converge: the last solved state is shown.';
  return `One-way supports solved by active-set iteration (${LFEA_UNILATERAL_ACTIVE_SET_SOURCE}): `
    + `${record.candidateCount} one-way support(s); ${perCase}. Lifted-off supports carry zero.${springs}${warning} `
    + `${LFEA_UNILATERAL_ACTIVE_SET_REVIEWER}.`;
}

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
