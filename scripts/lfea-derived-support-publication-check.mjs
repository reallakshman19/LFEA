#!/usr/bin/env node
/**
 * Practical analysis: support actions (Fa / Fl / Fv) are published from
 * supports derived from the restraints the solve actually used, labelled as
 * derived and NOT ENGINEER-REVIEWED. Real CAESAR II models BM1 and BM4.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LFEA_DERIVED_SUPPORT_SOURCE,
  deriveLfeaSupportAuthorityInput,
  lfeaDerivedUpGlobal,
} from '../src/lfea/derived-support-authority.js';
import { createLfeaNativeExecutionAuthority } from '../src/lfea/native-execution-authority.js';
import {
  LFEA_PUBLICATION_STATUS,
  createLfeaNativePublicationReadiness,
} from '../src/lfea/native-publication-readiness.js';
import { createLfeaNativeResultsAuthority } from '../src/lfea/native-results-authority.js';
import { createLfeaNativeSupportPublicationAuthority } from '../src/lfea/native-support-publication-authority.js';
import { createLinearPipingInputXmlIntake } from '../src/workspace/linear-piping-inputxml-intake.js';
import {
  authorizeLinearPipingInputXmlPreFlight,
  prepareLinearPipingInputXmlPreFlight,
} from '../src/workspace/linear-piping-inputxml-prefea.js';

assert.deepEqual(lfeaDerivedUpGlobal(), { x: 0, y: 1, z: 0 }, 'up is opposite of InputXML solve gravity (-Y)');

for (const [name, path, expectedSupports] of [
  ['BM1', 'benchmarks/LFEA/BM1/BM1_InputXML.xml', null],
  ['BM4', 'benchmarks/LFEA/BM4/InputXML_BM4.repaired.xml', 30],
]) {
  let preFlight = prepareLinearPipingInputXmlPreFlight(
    createLinearPipingInputXmlIntake({ fileName: path, content: readFileSync(path, 'utf8') }, {}),
  );
  if (!preFlight.solveAuthorized) {
    preFlight = authorizeLinearPipingInputXmlPreFlight(preFlight, {
      approverIdentity: 'NOT ENGINEER-REVIEWED (LFEA auto-accept)', reason: 'Derived support check.',
    });
  }
  const input = deriveLfeaSupportAuthorityInput(preFlight);
  assert.ok(input, `${name}: supports derive from model restraints`);
  const constrainedNodes = new Set(preFlight.preparation.structuralPreparation.compilation.model.constraints
    .map((row) => row.nodeId));
  assert.equal(input.definitions.length, constrainedNodes.size, `${name}: one interface per restrained node`);
  if (expectedSupports) assert.equal(input.definitions.length, expectedSupports);
  for (const definition of input.definitions) {
    assert.equal(definition.sourceEvidence.sourceId, LFEA_DERIVED_SUPPORT_SOURCE);
  }
  assert.match(input.upGlobal.source, /LFEA_DERIVED_FROM_MODEL_RESTRAINTS/u);

  const executionState = createLfeaNativeExecutionAuthority().run(preFlight);
  const resultsState = createLfeaNativeResultsAuthority().recover(preFlight, executionState);
  const authority = createLfeaNativeSupportPublicationAuthority();
  const staged = authority.stage(preFlight, input);
  authority.authorize(preFlight, {
    reviewerIdentity: 'NOT ENGINEER-REVIEWED (LFEA derived supports)',
    reason: 'Derived support check.',
    acceptedAuthoritySemanticHash: staged.authority.semanticHash,
  });
  const readiness = createLfeaNativePublicationReadiness({
    preFlight, resultsState,
    supportAuthority: authority.readinessAuthority(preFlight, executionState, resultsState),
  });
  assert.equal(readiness.supportActions.status, LFEA_PUBLICATION_STATUS.READY, `${name}: support actions READY`);
  const published = authority.publish(preFlight, executionState, resultsState);
  assert.equal(published.publicationCurrentness, 'CURRENT');
  let resolved = 0;
  let verticalSum = 0;
  for (const row of published.publications) {
    for (const action of row.publication.actions) {
      if (action.triadStatus === 'RESOLVED') {
        resolved += 1;
        verticalSum += action.fVertical;
      }
    }
  }
  assert.ok(resolved > 0, `${name}: at least one support resolves Fa/Fl/Fv`);
  // Force on the supports from the pipe: under weight, the net vertical is downward.
  assert.ok(verticalSum < 0, `${name}: net vertical support load is downward under weight (${verticalSum})`);
  console.log(`${name} PASS ${input.definitions.length} derived supports, ${resolved} resolved actions, net Fv ${verticalSum.toFixed(1)} N`);
}
console.log('LFEA derived support publication check PASS');
