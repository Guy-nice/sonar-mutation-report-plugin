import { fmtDate, fmtDuration, fmtInt, fmtPct } from '../format';
import { distribution, inWindow, isFailing, isNoPrAnalysis, isPassing, hasBefore, change, wasPassing } from '../model';
import { injectStyles } from '../styles';
import type { DataSource, PrResult, ProjectRef } from '../types';
import { clear, h } from './dom';
import {
  DISTRIBUTION_TITLE, bandPill, card, changeCell, distributionCard, gateChange, legend, pageHeader, pairedBarChart, summaryTiles,
} from './widgets';

/** Bars in the "score by PR" card: the most recent PRs only. */
const CHART_PRS = 6;

export function statusPill(r: PrResult): HTMLElement {
  if (!r.hasData) return h('span', { class: 'md-pill none' }, 'NO DATA');
  if (isFailing(r)) return h('span', { class: 'md-pill fail' }, 'FAIL');
  if (isPassing(r)) return h('span', { class: 'md-pill pass' }, 'PASS');
  return h('span', { class: 'md-pill none' }, 'NO SCORE');
}

type StatusFilter = 'all' | 'failing' | 'passing' | 'nodata';

export async function renderPrList(
  root: HTMLElement, data: DataSource, project: ProjectRef, onOpen: (pr: PrResult) => void, now: () => Date = () => new Date(),
): Promise<void> {
  injectStyles();
  const box = h('div', { class: 'md' });
  root.replaceChildren(box);
  box.append(h('h1', {}, `Mutation - ${project.name}`), h('p', { class: 'md-muted' }, 'Loading pull requests...'));

  const res = await data.loadProject(project);
  clear(box);
  const title = `Mutation - ${project.name}`;
  if (res.error) {
    box.append(h('h1', {}, title));
    box.append(isNoPrAnalysis(res.error)
      ? h('p', { class: 'md-note' }, 'This Sonar server has no pull request analysis (Developer Edition or higher is needed), so there is nothing to show.')
      : h('p', { class: 'md-fail' }, `Could not load pull requests: ${res.error}`));
    return;
  }
  const inWin = res.prs.filter((r) => inWindow(r, now()));
  if (inWin.length === 0) {
    box.append(h('h1', {}, title), h('p', { class: 'md-muted' }, 'No pull requests in the last 30 days.'));
    return;
  }

  const portfolio = [...inWin].filter((r) => r.hasData).sort((a, b) => b.pr.analysisDate.localeCompare(a.pr.analysisDate)).find((r) => r.portfolio !== null)?.portfolio;
  box.append(...pageHeader(title, inWin, ...(portfolio ? [`Portfolio: ${portfolio}`] : []), `${inWin.filter((r) => r.hasData).length} of ${inWin.length} PRs have mutation data`));

  let status: StatusFilter = 'all';
  let days = 30;
  /** Only the table depends on the filters, so only it is repainted: the filter controls keep their state and focus. */
  const tableHolder = h('div', {});

  function paintTable(): void {
    const visible = inWin
      .filter((r) => {
        const age = (now().getTime() - new Date(r.pr.analysisDate).getTime()) / 86_400_000;
        if (age > days) return false;
        if (status === 'failing') return isFailing(r);
        if (status === 'passing') return isPassing(r);
        if (status === 'nodata') return !r.hasData;
        return true;
      })
      .sort((a, b) => b.pr.analysisDate.localeCompare(a.pr.analysisDate));

    clear(tableHolder);
    tableHolder.append(h('table', { class: 'md-table' },
      h('thead', {}, h('tr', {}, ...(['PR', 'Title', 'Last scan', 'Before', 'After', 'Change (pts)', 'Mutation gate', 'Status', 'Time taken', 'Survived', 'No coverage'] as const).map((t) =>
        h('th', { class: ['Before', 'After', 'Change (pts)', 'Time taken', 'Survived', 'No coverage'].includes(t) ? 'num' : '' }, t)))),
      h('tbody', {}, ...visible.map((r) => h('tr', { 'data-pr': r.pr.key },
        h('td', {}, h('button', { class: 'md-link', 'data-action': 'open', onclick: () => onOpen(r) }, `#${r.pr.key}`)),
        h('td', {}, r.pr.title),
        h('td', { 'data-col': 'scan' }, fmtDate(r.pr.analysisDate)),
        h('td', { 'data-col': 'before', class: 'num' }, fmtPct(r.scoreBefore)),
        h('td', { 'data-col': 'score', class: 'num' }, fmtPct(r.score),
          r.thresholdAssumed && r.hasData ? h('span', { class: 'md-muted' }, ' (threshold assumed)') : null),
        h('td', { 'data-col': 'change', class: 'num' }, changeCell(change(r))),
        h('td', { 'data-col': 'gate' }, r.score === null ? gateChange(null, null) : gateChange(hasBefore(r) ? wasPassing(r) : null, isPassing(r))),
        h('td', { 'data-col': 'status' }, bandPill(r.score)),
        h('td', { 'data-col': 'time', class: 'num' }, fmtDuration(r.durationSec)),
        h('td', { 'data-col': 'survived', class: 'num' }, r.hasData ? fmtInt(r.measures.new_mutation_survived) : '-'),
        h('td', { 'data-col': 'noCoverage', class: 'num' }, r.hasData ? fmtInt(r.measures.new_mutation_no_coverage) : '-'))))));
  }

  const select = (name: string, options: Array<[string, string]>, on: (v: string) => void) =>
    h('select', { 'data-filter': name, onchange: (e: Event) => { on((e.target as HTMLSelectElement).value); paintTable(); } },
      ...options.map(([v, l]) => h('option', { value: v, ...(v === '30' || v === 'all' ? { selected: 'selected' } : {}) }, l)));

  const scored = inWin.filter((r) => r.hasData && r.score !== null);
  const recent = [...scored].sort((a, b) => b.pr.analysisDate.localeCompare(a.pr.analysisDate)).slice(0, CHART_PRS);

  box.append(
    summaryTiles(inWin, now()),
    h('div', { class: 'md-cards' },
      card('Before → After Agent, by Pull Request', 'scores',
        pairedBarChart(recent.map((r) => ({ key: r.pr.key, label: `#${r.pr.key} ${r.pr.title}`, before: r.scoreBefore, after: r.score as number, tick: r.threshold })), 'No scored pull requests.')),
      distributionCard(DISTRIBUTION_TITLE, distribution(inWin))),
    card('Pull Requests', 'details',
      h('div', { class: 'md-filters' }, 'Status ',
        select('status', [['all', 'All'], ['failing', 'Failing'], ['passing', 'Passing'], ['nodata', 'No data']], (v) => { status = v as StatusFilter; }),
        ' Date ',
        select('days', [['7', 'Last 7 days'], ['14', 'Last 14 days'], ['30', 'Last 30 days']], (v) => { days = Number(v); })),
      tableHolder,
      legend(),
      h('p', { class: 'md-note2' }, 'Before = new-code score of the first run; After = score after the agent wrote tests. Mutation gate = the new-code score against the threshold (the black tick); Status and bar colors are score bands. Time taken = the whole agent run. "Open" = analyzed in the last 7 days (Sonar does not say whether a pull request is merged).')));
  paintTable();
}
