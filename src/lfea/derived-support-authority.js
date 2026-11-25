import { sealInterfaceProfile } from '../core/linear-piping-interface/index.js';
import { INPUTXML_DEFAULT_GRAVITY_DIRECTION } from '../core/linear-piping-analysis-consumer/inputxml-linear-physical-profile.js';
import { buildPipingPortTopologyGraph } from '../core/piping-topology/index.js';
import { createSharedPipingModel } from '../core/shared-piping-model/index.js';
import {
  buildRestraintCapabilityModel,
  buildSupportAttachmentModel,
} from '../core/support-restraints/index.js';

/**
 * Practical analysis (docs/PRACTICAL_ANALYSIS_POLICY.md): when nobody has
 * supplied separate support semantics, derive them from the restraints the
 * solver actually used. Every record carries LFEA_DERIVED_SUPPORT_SOURCE so
 * the sealed authority, history and dossier show the basis was derived.
 */
export const LFEA_DERIVED_SUPPORT_SOURCE = 'LFEA_DERIVED_FROM_MODEL_RESTRAINTS';
export const LFEA_DERIVED_SUPPORT_REVIEWER = 'NOT ENGINEER-REVIEWED (LFEA derived supports)';
export const LFEA_DEFAULT_PARALLEL_TOLERANCE = 1e-6;

const IDENTITY = Object.freeze({ lineId: '', branchId: '', systemId: '', zoneId: '' });
const refs = (key, sourcePath) => ({ sourceNodeKey: `node:${key}`, sourceEntityId: key, jsonPointer: `/${key}`, sourcePath });
const TRANSLATIONS = ['UX', 'UY', 'UZ'];
const ROTATIONS = ['RX', 'RY', 'RZ'];

export function lfeaDerivedUpGlobal() {
  const g = INPUTXML_DEFAULT_GRAVITY_DIRECTION;
  return { x: -g.x || 0, y: -g.y || 0, z: -g.z || 0 };
}

/** Build a support authority input from the current compilation, or null. */
export function deriveLfeaSupportAuthorityInput(preFlight) {
  const preparation = preFlight?.preparation;
  const model = preparation?.structuralPreparation?.compilation?.model;
  if (!model?.constraints?.length) return null;
  const sourceHash = preparation.sourceBundleSemanticHash;
  const nodesById = new Map(model.nodes.map((node) => [node.nodeId, node]));
  const constraintsByNode = groupBy(model.constraints, (row) => row.nodeId);
  const up = lfeaDerivedUpGlobal();
  const upDof = TRANSLATIONS[[up.x, up.y, up.z].findIndex((value) => Math.abs(value) === 1)] ?? 'UY';

  const supports = [];
  const usedComponents = new Set();
  const plans = [];
  for (const [nodeId, constraints] of [...constraintsByNode].sort(([a], [b]) => compareAscii(a, b))) {
    const node = nodesById.get(nodeId);
    const sourceEntityId = node?.sourceAncestry?.sourceComponentIds?.[0];
    if (!sourceEntityId) continue;
    const supportKey = `SUP-${nodeId}`;
    usedComponents.add(sourceEntityId);
    supports.push(supportRecord(supportKey, node.position, sourceEntityId, constraints, upDof));
    plans.push({ node, sourceEntityId, supportKey, constraints });
  }
  if (!plans.length) return null;

  const shared = createSharedPipingModel({
    project: { datasetId: 'LFEA-DERIVED-SUPPORT', name: 'LFEA derived supports', sourceName: LFEA_DERIVED_SUPPORT_SOURCE },
    units: { length: model.units?.length ?? 'm', force: model.units?.force ?? 'N', mass: model.units?.mass ?? 'kg' },
    sourceSnapshotRef: {
      schema: 'source-package-snapshot/v1', datasetId: 'LFEA-DERIVED-SUPPORT',
      sourceSchema: 'fea-inputxml-source-bundle/v1', sourceSemanticHash: sourceHash, sourceByteHash: null,
    },
    components: [...usedComponents].sort(compareAscii)
      .map((key) => pipeComponent(key, componentEnds(model, nodesById, key))),
    supports,
    sourceReferences: { nodes: [] },
    diagnostics: [],
  });
  const attachment = buildSupportAttachmentModel(shared, buildPipingPortTopologyGraph(shared));
  const restraint = buildRestraintCapabilityModel(attachment);

  const definitions = [];
  for (const plan of plans) {
    const attached = attachment.attachments.find((row) => row.supportKey === plan.supportKey);
    const restrained = restraint.restraints.find((row) => row.supportKey === plan.supportKey);
    if (!attached || !restrained?.solverEligible) continue;
    const dofs = plan.constraints.map((row) => ({
      dof: row.dof, behavior: row.behavior, constraintId: row.constraintId, stiffness: row.stiffness ?? null,
    }));
    definitions.push({
      interfaceId: `IF-${plan.node.nodeId}`,
      interfaceKind: dofs.length === 6 ? 'ANCHOR' : 'SUPPORT',
      nodeId: plan.node.nodeId,
      sourceEntityId: plan.sourceEntityId,
      supportBinding: {
        supportKey: plan.supportKey, attachmentId: attached.attachmentId, restraintId: restrained.restraintId,
      },
      basis: {
        origin: plan.node.position,
        e1: { x: 1, y: 0, z: 0 }, e2: { x: 0, y: 1, z: 0 }, e3: { x: 0, y: 0, z: 1 },
      },
      referencePointGlobal: plan.node.position,
      leverReferenceToNodeLocal: { x: 0, y: 0, z: 0 },
      dofMappings: dofs,
      reportingSignConvention: 'FORCE_ON_INTERFACE_FROM_PIPE',
      sourceEvidence: { sourceId: LFEA_DERIVED_SUPPORT_SOURCE, sourceRevision: '01', sourceSemanticHash: sourceHash },
      allowableProfileHash: null,
    });
  }
  if (!definitions.length) return null;

  const declared = (value) => ({ value, source: LFEA_DERIVED_SUPPORT_SOURCE });
  return {
    parentSourceBundleSemanticHash: sourceHash,
    parentModelSemanticHash: preparation.modelSemanticHash,
    supportSharedModel: shared,
    supportAttachmentModel: attachment,
    restraintCapabilityModel: restraint,
    definitions,
    interfaceProfile: sealInterfaceProfile({
      schema: 'linear-piping-interface-profile/v1',
      profileId: 'LFEA-DERIVED-SUPPORT-INTERFACE-R1',
      basisTolerance: declared(1e-12),
      positionTolerance: declared(1e-9),
      offsetTolerance: declared(1e-9),
      semanticHash: '',
    }),
    upGlobal: { value: up, source: `${LFEA_DERIVED_SUPPORT_SOURCE}: opposite of solve gravity` },
    parallelTolerance: declared(LFEA_DEFAULT_PARALLEL_TOLERANCE),
    modelVersion: declared(Number.isSafeInteger(model.modelRevision) ? model.modelRevision : 1),
  };
}

/**
 * Stage, accept and publish derived support actions for the current run.
 * Returns the publication state, or null when derivation is not possible.
 * Never throws: support loads are a labelled extra, not a gate on results.
 */
export function publishLfeaDerivedSupportActions(runtime) {
  try {
    const input = deriveLfeaSupportAuthorityInput(runtime.sourceController.getPreFlight());
    if (!input) return null;
    const staged = runtime.stageNativeSupportAuthority(input);
    runtime.authorizeNativeSupportAuthority({
      reviewerIdentity: LFEA_DERIVED_SUPPORT_REVIEWER,
      reason: `Practical run: ${input.definitions.length} support(s) derived from model restraints; `
        + `up axis opposite to solve gravity; parallel tolerance ${LFEA_DEFAULT_PARALLEL_TOLERANCE}.`,
      acceptedAuthoritySemanticHash: staged.authority.semanticHash,
    });
    return runtime.publishNativeSupportActions();
  } catch (error) {
    runtime.lastDerivedSupportError = error?.code ?? error?.message ?? 'UNKNOWN_ERROR';
    return null;
  }
}

function supportRecord(key, position, componentKey, constraints, upDof) {
  const dofs = new Set(constraints.map((row) => row.dof));
  const spring = constraints.some((row) => row.behavior !== 'FIXED');
  const state = (list) => (list.some((dof) => dofs.has(dof)) ? (spring ? 'SPRING' : 'RESTRAINED') : 'FREE');
  const horizontal = TRANSLATIONS.filter((dof) => dof !== upDof);
  const ev = (value, path) => [{ value, unit: '', sourceKind: 'sourceAttributes', sourcePath: `sourceAttributes.${path}` }];
  return {
    supportKey: key,
    sourceEntityId: key,
    name: key,
    type: dofs.size === 6 ? 'ANCHOR' : 'SUPPORT',
    identity: IDENTITY,
    position,
    engineeringProperties: {},
    compatibilityEvidence: {},
    supportEvidence: {
      attachedPortReferences: [],
      attachedComponentReferences: ev(componentKey, 'component'),
      supportedSourceEntityReferences: [],
      supportTypes: ev(dofs.size === 6 ? 'ANCHOR' : 'SUPPORT', 'type'),
      verticalCapabilities: ev(state([upDof]), 'vertical'),
      lateralCapabilities: ev(state(horizontal), 'lateral'),
      longitudinalCapabilities: ev(state(horizontal), 'longitudinal'),
      rotationalCapabilities: ev(state(ROTATIONS), 'rotational'),
      verticalGaps: [], lateralGaps: [], longitudinalGaps: [],
      stiffnessValues: [], springRateValues: [], frictionValues: [], multiAttachmentFlags: [],
    },
    sourceReferences: refs(key, `/derived/supports/${key}`),
    diagnostics: [],
  };
}

function componentEnds(model, nodesById, componentKey) {
  const elements = model.elements.filter((row) => row.sourceAncestry?.sourceComponentId === componentKey);
  const start = nodesById.get(elements[0]?.nodeI)?.position;
  const end = nodesById.get(elements.at(-1)?.nodeJ)?.position;
  return { start: start ?? { x: 0, y: 0, z: 0 }, end: end ?? { x: 1, y: 0, z: 0 } };
}

function pipeComponent(key, { start, end }) {
  const port = (role, position) => ({
    portKey: `${key}:port:${role}`, role, position, sourceReference: { sourceNodeId: `${key}:${role}` },
  });
  return {
    componentKey: key,
    sourceEntityId: key,
    name: key,
    type: 'PIPE',
    identity: IDENTITY,
    geometry: {
      start, end, center: null, points: [], branchPoints: [], sources: {},
      sourcePath: `/derived/components/${key}`,
      ports: [port('start', start), port('end', end)],
    },
    engineeringProperties: {},
    compatibilityEvidence: {},
    sourceReferences: refs(key, `/derived/components/${key}`),
    diagnostics: [],
  };
}

function groupBy(rows, keyOf) {
  const map = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}
function compareAscii(left, right) { return left < right ? -1 : left > right ? 1 : 0; }
