import { requireDeclaredValue } from '../shared-analysis-contract/declared-value.js';
import { requireFrameElement } from '../linear-fea-frame-element/index.js';
import { requireLoadPrimitive, requirePhysicalLoadCase } from '../linear-fea-load-case/index.js';
import { requirePipeSectionResolution } from '../linear-fea-section/index.js';
import { requireTraceableDeclaredValue } from '../linear-fea-b31-code-engine/index.js';
import { deepFreeze } from '../shared-piping-model/immutable.js';
import { failCodeApplication } from './contracts.js';

export const PRESSURE_STRESS_CONFLICT_CODE = 'PIPING_B31_PRESSURE_STRESS_CONFLICT';
export const PRESSURE_EFFECT_NOT_IMPLEMENTED_CODE = 'PIPING_B31_PRESSURE_EFFECT_NOT_IMPLEMENTED';
export const PRESSURE_BASIS_NOT_DERIVABLE_CODE = 'PIPING_B31_PRESSURE_BASIS_NOT_DERIVABLE';
export const PRESSURE_CODE_STRESS_NOT_AUTHORIZED_CODE = 'PIPING_B31_PRESSURE_CODE_STRESS_NOT_AUTHORIZED';
export const LONGITUDINAL_PRESSURE_STRESS_FORMULA_ID =
  'B31_3_LONGITUDINAL_PRESSURE_STRESS_AREA_RATIO_V1';

// Every pressure effect the load-case contract can authorize is applied by the
// solver today (see SOLVER_APPLIED_PRESSURE_EFFECTS). The refusal path stays so
// a future effect the solver does not apply is blocked, never dropped.
const UNIMPLEMENTED_PRESSURE_EFFECT_CODES = Object.freeze({});
const UNIMPLEMENTED_PRESSURE_EFFECTS = Object.freeze(
  Object.keys(UNIMPLEMENTED_PRESSURE_EFFECT_CODES),
);
/**
 * Effects of pressure that the linear solver applies itself: axialThrust is
 * the closed-end pressure elongation initial strain (frame-element.js),
 * bourdon is the bend Bourdon augmentation, and pressureStiffening reduces
 * bend flexibility (bend-component.js; no effect on straight pipe). A bend SIF
 * supplied without the pressure correction is conservative. Their
 * consequences are already inside the solved member forces, which exclude the
 * internally balanced end-cap thrust, so the code term S = P*Do/(4t) is added
 * once and nothing is counted twice. They are disclosed in the source string.
 */
export const SOLVER_APPLIED_PRESSURE_EFFECTS = Object.freeze(['pressureStiffening', 'axialThrust', 'bourdon']);

function requirePressurePrimitive(value) {
  const primitive = requireLoadPrimitive(value);
  if (primitive.kind !== 'PRESSURE') {
    failCodeApplication(
      'pressurePrimitive must be a sealed PRESSURE load primitive.',
      'PIPING_B31_PRESSURE_PRIMITIVE_REQUIRED',
    );
  }
  return primitive;
}

function unsupportedEffectLimitations(primitive) {
  return UNIMPLEMENTED_PRESSURE_EFFECTS
    .filter((effect) => primitive.authorizedEffects[effect] === true)
    .map((effect) => deepFreeze({
      code: UNIMPLEMENTED_PRESSURE_EFFECT_CODES[effect],
      status: 'BLOCKED',
      effect,
      primitiveId: primitive.primitiveId,
      elementId: primitive.elementId,
      disclosure: `PRESSURE effect ${effect} is authorized but is not implemented by the linear piping code-application layer.`,
    }));
}

function requireNoUnsupportedEffects(primitive) {
  const limitations = unsupportedEffectLimitations(primitive);
  if (limitations.length > 0) {
    failCodeApplication(
      `PRESSURE primitive ${primitive.primitiveId} authorizes unimplemented effects.`,
      PRESSURE_EFFECT_NOT_IMPLEMENTED_CODE,
      { primitiveId: primitive.primitiveId, elementId: primitive.elementId, limitations },
    );
  }
}

/**
 * Derive the longitudinal pressure-stress contribution for one pipe.
 *
 * ASME B31.3 counts pressure in the sustained longitudinal force Fa, so the
 * stress is the end-cap force over the metal area:
 * S = P * di^2 / (Do^2 - di^2), with di = Do - 2t, using gauge pressure and
 * the dimensions retained by the sealed B-2.3 section resolution passed in
 * (for SUSTAINED, the nominal-less-allowances section when one is cited).
 * This is the form CAESAR II reports as SLP. The thin-wall P * Do / (4 * t)
 * is the B31.1 form and is not used. No section property is reconstructed.
 *
 * @param {object} args
 * @param {Readonly<object>} args.pressurePrimitive Sealed PRESSURE primitive.
 * @param {Readonly<object>} args.sectionResolution Sealed B-2.3 pipe-section resolution.
 * @returns {Readonly<{value:number, source:string}>}
 */
export function derivePressureStressContribution({ pressurePrimitive, sectionResolution }) {
  const primitive = requirePressurePrimitive(pressurePrimitive);
  const section = requirePipeSectionResolution(sectionResolution);
  requireNoUnsupportedEffects(primitive);
  if (primitive.authorizedEffects.codeStress !== true) {
    failCodeApplication(
      `PRESSURE primitive ${primitive.primitiveId} does not authorize codeStress.`,
      PRESSURE_CODE_STRESS_NOT_AUTHORIZED_CODE,
      { primitiveId: primitive.primitiveId, elementId: primitive.elementId },
    );
  }
  if (primitive.pressureBasis !== 'GAUGE') {
    failCodeApplication(
      `PRESSURE primitive ${primitive.primitiveId} uses ${primitive.pressureBasis}; longitudinal pressure stress requires a gauge-pressure differential and no ambient-pressure authority was supplied.`,
      PRESSURE_BASIS_NOT_DERIVABLE_CODE,
      {
        primitiveId: primitive.primitiveId,
        elementId: primitive.elementId,
        pressureBasis: primitive.pressureBasis,
      },
    );
  }

  const { outerDiameter, innerDiameter } = section.dimensions;
  const innerSquared = innerDiameter * innerDiameter;
  const value = (primitive.pressure * innerSquared) / (outerDiameter * outerDiameter - innerSquared);
  if (!Number.isFinite(value)) {
    failCodeApplication(
      'Derived longitudinal pressure stress is non-finite.',
      'PIPING_B31_PRESSURE_STRESS_NONFINITE',
      { primitiveId: primitive.primitiveId, elementId: primitive.elementId },
    );
  }
  const solverApplied = SOLVER_APPLIED_PRESSURE_EFFECTS
    .filter((effect) => primitive.authorizedEffects[effect] === true);
  const disclosure = solverApplied.length ? `:SOLVER_APPLIED_${solverApplied.join('+')}` : '';
  return deepFreeze({
    value,
    source: `${LONGITUDINAL_PRESSURE_STRESS_FORMULA_ID}:${primitive.primitiveId}:${primitive.semanticHash}:${section.semanticHash}${disclosure}`,
  });
}

/**
 * Resolve the B31 check input from its cited physical case. With no matching
 * PRESSURE primitive, the existing explicit caller-supply path is unchanged.
 */
export function resolvePressureStressContribution({
  loadCase,
  frameElementRecord,
  sectionResolution,
  suppliedContribution,
}) {
  const acceptedLoadCase = requirePhysicalLoadCase(loadCase);
  const element = requireFrameElement(frameElementRecord);
  const pressurePrimitive = acceptedLoadCase.primitives.find(
    (primitive) => primitive.kind === 'PRESSURE' && primitive.elementId === element.elementId,
  );
  if (pressurePrimitive === undefined) return suppliedContribution;

  requireNoUnsupportedEffects(pressurePrimitive);
  if (pressurePrimitive.authorizedEffects.codeStress !== true) return suppliedContribution;

  const derived = derivePressureStressContribution({ pressurePrimitive, sectionResolution });
  if (suppliedContribution !== null) {
    const supplied = requireTraceableDeclaredValue(
      requireDeclaredValue(
        { pressureStressContribution: suppliedContribution },
        'pressureStressContribution',
        {},
      ),
      'pressureStressContribution',
      'CODE_ENGINE_SOURCE_NOT_TRACEABLE',
    );
    if (supplied.value !== derived.value) {
      failCodeApplication(
        'Caller-supplied pressureStressContribution conflicts with the value derived from the cited PRESSURE primitive and section resolution.',
        PRESSURE_STRESS_CONFLICT_CODE,
        {
          primitiveId: pressurePrimitive.primitiveId,
          elementId: pressurePrimitive.elementId,
          supplied: { value: supplied.value, source: supplied.source },
          derived,
        },
      );
    }
  }
  return derived;
}
