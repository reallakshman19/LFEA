import { LINEAR_FEA_UNITS } from '../core/linear-fea-contract/index.js';

/** Render already-published B31 application evidence; never compute stress. */
export function nativeB31ResultsPanel(doc, state) {
  const section = doc.createElement('section');
  section.className = 'lfea-results-b31-publication';
  section.dataset.currentness = state?.publicationCurrentness ?? 'NONE';
  section.append(heading(doc, 'B31 code application — published engineering results'));
  section.append(facts(doc, [
    ['B31 authority', state?.authorityCurrentness ?? 'NONE'],
    ['B31 publication', state?.publicationCurrentness ?? 'NONE'],
    ['B31 authority identity', state?.authority?.semanticHash ?? null],
    ['B31 review identity', state?.authorization?.semanticHash ?? null],
    ['Code profile identity', state?.authority?.codeProfile?.semanticHash ?? null],
    ['Code check basis', b31BasisLabel(state)],
    ['Edition dataset identity', state?.authority?.editionDataset?.semanticHash ?? null],
  ]));
  if (state?.publicationCurrentness !== 'CURRENT' || !state.application) {
    if (state?.publicationStaleReasonCodes?.length) {
      section.append(codes(doc, 'Publication stale reasons', state.publicationStaleReasonCodes));
    }
    return section;
  }
  const application = state.application;
  section.append(facts(doc, [
    ['Application', application.applicationId],
    ['Application status', application.status],
    ['Application identity', application.semanticHash],
    ['Application evidence identity', application.evidenceHash],
  ]));
  const table = withHead(doc, [
    'Check', 'Category', 'Component', 'Code point', 'Combination',
    `Calculated stress [${LINEAR_FEA_UNITS.stress}]`,
    `Allowable [${LINEAR_FEA_UNITS.stress}]`,
    'Utilization', 'Status', 'Governing rule', 'Code-result identity',
  ]);
  for (const row of application.results) {
    const result = row.codeResult;
    table.append(tableRow(doc, [
      row.checkId,
      result.category,
      result.componentId,
      result.codePointId,
      result.combinationId,
      result.calculatedStress,
      result.allowableStress,
      result.utilization,
      result.status,
      result.governingRuleId,
      result.semanticHash,
    ]));
  }
  const wrap = doc.createElement('div');
  wrap.className = 'lfea-results-table-wrap';
  wrap.append(table);
  section.append(wrap);
  return section;
}

function heading(doc, value) {
  const node = doc.createElement('h4');
  node.textContent = value;
  return node;
}
function facts(doc, rows) {
  const table = doc.createElement('table');
  table.className = 'lfea-journey-table';
  for (const [label, value] of rows) {
    const tr = doc.createElement('tr');
    const th = doc.createElement('th');
    th.scope = 'row';
    th.textContent = label;
    const td = doc.createElement('td');
    td.textContent = display(value);
    tr.append(th, td);
    table.append(tr);
  }
  return table;
}
function withHead(doc, labels) {
  const table = doc.createElement('table');
  table.className = 'lfea-journey-table lfea-results-table';
  const tr = doc.createElement('tr');
  for (const label of labels) {
    const th = doc.createElement('th');
    th.textContent = label;
    tr.append(th);
  }
  table.append(tr);
  return table;
}
function tableRow(doc, values) {
  const tr = doc.createElement('tr');
  for (const value of values) {
    const td = doc.createElement('td');
    td.textContent = display(value);
    tr.append(td);
  }
  return tr;
}
function codes(doc, label, values) {
  const block = doc.createElement('div');
  block.append(heading(doc, label));
  const list = doc.createElement('ul');
  for (const value of values) {
    const item = doc.createElement('li');
    const code = doc.createElement('code');
    code.textContent = value;
    item.append(code);
    list.append(item);
  }
  block.append(list);
  return block;
}
function display(value) {
  return value === null || value === undefined || value === '' ? '—' : String(value);
}

function b31BasisLabel(state) {
  const reviewer = state?.authorization?.reviewerIdentity ?? null;
  if (!reviewer) return null;
  if (!reviewer.startsWith('NOT ENGINEER-REVIEWED')) return `Reviewed by ${reviewer}`;
  const source = state.authority?.editionDataset?.sourceIdentity?.sourceRevision ?? '';
  const expansion = (state.authority?.checks ?? []).some((row) => row.category === 'DISPLACEMENT_STRESS_RANGE')
    ? ' Expansion: operating minus sustained, SE = √((|Sa|+Sb)² + (2St)²) on the nominal section, allowable f(1.25Sc + 0.25Sh), f = 1.'
    : '';
  return `Allowables entered by user (${source}); W = 1; unity stress factors on straight pipe; sustained wall less corrosion allowance; pressure term P·di²/(Do²−di²).${expansion} NOT ENGINEER-REVIEWED.`;
}
