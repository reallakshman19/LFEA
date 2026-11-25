import { publishLfeaDerivedSupportActions } from './derived-support-authority.js';
import { rerunLfeaPracticalB31Check, runLfeaPracticalB31Check } from './practical-b31-check.js';

/**
 * Practical-run publications that follow every archived Run
 * (docs/PRACTICAL_ANALYSIS_POLICY.md): derived support actions, then the
 * B31.3 sustained check when the user has entered Sc/Sh. Neither ever blocks
 * Results.
 */
export function publishLfeaPracticalExtras(runtime) {
  publishLfeaDerivedSupportActions(runtime);
  rerunLfeaPracticalB31Check(runtime);
}

export { runLfeaPracticalB31Check };
