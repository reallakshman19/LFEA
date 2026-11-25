import {
  LinearPipingInputXmlSourceWorkflowController,
} from '../workspace/linear-piping-inputxml-source-workflow.js';
import {
  lfeaComponentFactorBasis,
  mountLfeaInlineBendFactorAuthorityControl,
} from '../workspace/lfea-bend-factor-authority-control.js';

export const LFEA_AUTO_ACCEPT_APPROVER = 'NOT ENGINEER-REVIEWED (LFEA auto-accept)';

/**
 * Standalone-only adapter around the existing governed native InputXML source
 * controller. It adds a read-only state notification hook and the component
 * factor basis control (B31.3 / B31J edition, smooth-90 bends). When the user
 * has not chosen a basis the analysis runs on the declared default and the
 * basis line says so; it never blocks the run.
 */
export class LfeaStandaloneInputXmlSourceController
  extends LinearPipingInputXmlSourceWorkflowController {
  constructor(panelContainer, documentRef, onStateChanged) {
    super(panelContainer, documentRef);
    this.onStandaloneStateChanged = typeof onStateChanged === 'function'
      ? onStateChanged
      : null;
    this.basisPanel = null;
    this.basisLabel = null;
  }

  render() {
    super.render();
    if (this.autoAcceptWarnings()) return; // authorizePreFlight re-renders
    this.renderBasisPanel();
    this.onStandaloneStateChanged?.(this.getSnapshot(), this.getPreFlight());
  }

  /**
   * Practical analysis: disclosed WARN findings label the run, they do not
   * stop it. The authorization is still sealed through the governed path,
   * with the approver recorded as not engineer-reviewed so every result,
   * dossier and history row shows it. BLOCK (physically invalid input) is
   * never auto-accepted: the domain refuses to authorize it.
   */
  autoAcceptWarnings() {
    const preFlight = this.getPreFlight();
    if (!preFlight || preFlight.status !== 'WARN' || preFlight.solveAuthorized) return false;
    if (this.autoAcceptAttempted === preFlight) return false;
    this.autoAcceptAttempted = preFlight;
    const warningCount = (preFlight.preparation?.findings ?? [])
      .filter((finding) => finding.disposition === 'CONDITIONAL').length;
    try {
      this.authorizePreFlight({
        approverIdentity: LFEA_AUTO_ACCEPT_APPROVER,
        reason: `Practical run: ${warningCount} disclosed warning(s) accepted automatically. `
          + 'Results are labelled NOT ENGINEER-REVIEWED.',
      });
      return true;
    } catch {
      return false;
    }
  }

  renderBasisPanel() {
    const container = this.panelContainer ?? this.container ?? null;
    const doc = this.documentRef ?? container?.ownerDocument ?? null;
    if (!container || !doc || typeof doc.createElement !== 'function') return;
    if (!this.basisPanel) {
      this.basisPanel = doc.createElement('div');
      this.basisPanel.dataset.role = 'lfea-analysis-basis';
      this.basisPanel.className = 'lfea-analysis-basis';
      const heading = doc.createElement('strong');
      heading.textContent = 'Component factor basis';
      this.basisLabel = doc.createElement('span');
      this.basisLabel.dataset.role = 'lfea-analysis-basis-label';
      const control = mountLfeaInlineBendFactorAuthorityControl(doc);
      this.basisPanel.append(heading, ' ', this.basisLabel, control.root);
    }
    const basis = lfeaComponentFactorBasis();
    const approver = this.getPreFlight()?.authorization?.approverIdentity ?? null;
    const reviewNote = approver === LFEA_AUTO_ACCEPT_APPROVER
      ? ' Warnings: accepted automatically — results are NOT ENGINEER-REVIEWED.'
      : '';
    this.basisLabel.textContent = (basis.assumed
      ? `ASSUMED (default): ${basis.label}. Choose below to change.`
      : `Selected: ${basis.label}.`) + reviewNote;
    this.basisPanel.dataset.assumed = String(basis.assumed);
    if (this.basisPanel.parentNode !== container || container.firstChild !== this.basisPanel) {
      container.prepend(this.basisPanel);
    }
  }

  destroy() {
    this.onStandaloneStateChanged = null;
    this.basisPanel?.remove();
    super.destroy();
  }
}
