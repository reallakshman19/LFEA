#!/usr/bin/env node
/**
 * Practical analysis: the B31.3 SUSTAINED check runs from user-entered Sc/Sh
 * on real CAESAR II models (BM1, BM4), labelled NOT ENGINEER-REVIEWED. Pressure
 * cases whose pressure loads authorize unimplemented code terms fall back to
 * the weight case with a disclosed note instead of stopping.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLfeaNativeB31PublicationAuthority } from '../src/lfea/native-b31-publication-authority.js';
import { createLfeaNativeExecutionAuthority } from '../src/lfea/native-execution-authority.js';
import { createLfeaNativeResultsAuthority } from '../src/lfea/native-results-authority.js';
import {
  LFEA_B31_PRACTICAL_REVIEWER,
  LFEA_USER_ALLOWABLE_SOURCE,
  deriveLfeaB31AuthorityInput,
  runLfeaPracticalB31Check,
} from '../src/lfea/practical-b31-check.js';
import { createLinearPipingInputXmlIntake } from '../src/workspace/linear-piping-inputxml-intake.js';
import {
  authorizeLinearPipingInputXmlPreFlight,
  prepareLinearPipingInputXmlPreFlight,
} from '../src/workspace/linear-piping-inputxml-prefea.js';

function runtimeFor(path, requestedCaseIds) {
  let preFlight = prepareLinearPipingInputXmlPreFlight(createLinearPipingInputXmlIntake(
    { fileName: path, content: readFileSync(path, 'utf8') }, requestedCaseIds ? { requestedCaseIds } : {},
  ));
  if (!preFlight.solveAuthorized) {
    preFlight = authorizeLinearPipingInputXmlPreFlight(preFlight, {
      approverIdentity: 'NOT ENGINEER-REVIEWED (LFEA auto-accept)', reason: 'Practical B31 check.',
    });
  }
  const executionAuthority = createLfeaNativeExecutionAuthority();
  const executionState = executionAuthority.run(preFlight);
  const resultsState = createLfeaNativeResultsAuthority().recover(preFlight, executionState);
  const b31 = createLfeaNativeB31PublicationAuthority();
  return {
    preFlight, b31,
    sourceController: { getPreFlight: () => preFlight },
    executionAuthority,
    stageNativeB31Authority: (input) => b31.stage(preFlight, input),
    authorizeNativeB31Authority: (approval) => b31.authorize(preFlight, approval),
    publishNativeB31Application: () => b31.publish(preFlight, executionState, resultsState),
  };
}

const bm4 = runtimeFor('benchmarks/LFEA/BM4/InputXML_BM4.repaired.xml');
assert.throws(() => deriveLfeaB31AuthorityInput(bm4.preFlight, { scMpa: '', shMpa: 130 }),
  (error) => error.code === 'LFEA_B31_PRACTICAL_ALLOWABLE_INVALID');
const bm4Status = runLfeaPracticalB31Check(bm4, { scMpa: 137.9, shMpa: 130 });
// 128 since 2026-11-26: reducer and tee elements are checked too (B31J factors).
assert.match(bm4Status, /128 check\(s\)/u);
assert.match(bm4Status, /B31J SIFs at 0 reducer end\(s\) and 5 welding-tee end\(s\) \(LFEA_PRACTICAL_B31_FITTINGS\); CAESAR-fitted SIFs at 8 weldolet run end\(s\), LFEA default \(LFEA_DEFAULT_WELDOLET_CAESAR_BACKCALC\), no B31J weldolet equations; 1 fitting end\(s\) not covered, unity factors/u);
assert.match(bm4Status, /NOT ENGINEER-REVIEWED/u);
const bm4State = bm4.b31.getState();
assert.equal(bm4State.publicationCurrentness, 'CURRENT');
assert.equal(bm4State.authorization.reviewerIdentity, LFEA_B31_PRACTICAL_REVIEWER);
assert.equal(bm4State.authority.editionDataset.sourceIdentity.standard, LFEA_USER_ALLOWABLE_SOURCE);
const bm4Results = bm4State.application.results;
assert.equal(bm4Results.length, 128);
for (const row of bm4Results) {
  assert.equal(row.codeResult.allowableStress, 130e6, 'SUSTAINED compares against the entered Sh');
  assert.ok(Number.isFinite(row.codeResult.utilization) && row.codeResult.utilization >= 0);
}
console.log(`BM4 PASS ${bm4Status}`);

const bm1 = runtimeFor('benchmarks/LFEA/BM1/BM1_InputXML.xml', ['IXP-W', 'IXP-WP']);
const bm1Status = runLfeaPracticalB31Check(bm1, { scMpa: 137.9, shMpa: 130 });
assert.match(bm1Status, /36 check\(s\)/u, 'BM1 checks both the weight and the weight+pressure case');
assert.doesNotMatch(bm1Status, /not checked/u);
const bm1Results = bm1.b31.getState().application.results;
const sp = bm1Results.filter((row) => row.codeResult.stressTerms.pressure > 0);
assert.equal(sp.length, 18, 'every W+P check carries the P*Do/(4t) term');
for (const row of bm1Results) {
  const pressureCase = row.codeResult.stressTerms.pressure > 0;
  assert.equal(pressureCase, row.checkId.endsWith('IXP-WP'), `${row.checkId} pressure term only in W+P`);
}
assert.equal(bm1.b31.getState().publicationCurrentness, 'CURRENT');
console.log(`BM1 PASS ${bm1Status}`);
console.log('LFEA practical B31 check PASS');
