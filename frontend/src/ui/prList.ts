import { fmtAge, fmtInt, fmtPct } from '../format';
import { bandOf, distribution, inWindow, isFailing, isNoPrAnalysis, isPassing } from '../model';
import { injectStyles } from '../styles';
import type { DataSource, PrResult, ProjectRef } from '../types';
import { clear, h } from './dom';
import { DISTRIBUTION_TITLE, bandPill, barChart, card, distributionCard, legend, pageHeader, summaryTiles } from './widgets';

/** Bars in the "score by PR" card: the most recent PRs only. */
const CHART_PRS = 6;

export function scoreBar(r: PrResult): HTMLElement {
  const pct = Math.max(0, Math.min(100, r.score ?? 0));
  return h('span', { class: 'md-bar' },
    h('i', { class: bandOf(r.score) ?? '', style: `width:${pct}%` }),
    h('b', { style: `left:${Math.max(0, Math.min(100, r.threshold))}%` }));
}

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

  box.append(...pageHeader(title, inWin, `${inWin.filter((r) => r.hasData).length} of ${inWin.length} PRs have mutation data`));

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
      h('thead', {}, h('tr', {}, ...(['PR', 'Title', 'Gate', 'Analyzed', 'New-code score', 'Status', 'Survived', 'No coverage'] as const).map((t) =>
        h('th', { class: t === 'Survived' || t === 'No coverage' ? 'num' : '' }, t)))),
      h('tbody', {}, ...visible.map((r) => h('tr', { 'data-pr': r.pr.key },
        h('td', {}, h('button', { class: 'md-link', 'data-action': 'open', onclick: () => onOpen(r) }, `#${r.pr.key}`)),
        h('td', {}, r.pr.title),
        h('td', { 'data-col': 'gate' }, statusPill(r)),
        h('td', { 'data-col': 'analyzed' }, fmtAge(r.pr.analysisDate, now())),
        h('td', { 'data-col': 'score' }, h('span', { class: 'md-sc' }, fmtPct(r.score)), r.score !== null ? scoreBar(r) : null,
          r.thresholdAssumed && r.hasData ? h('span', { class: 'md-muted' }, ' (threshold assumed)') : null),
        h('td', { 'data-col': 'status' }, bandPill(r.score)),
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
      card('New-code Score by Pull Request', 'scores',
        barChart(recent.map((r) => ({ key: r.pr.key, label: `#${r.pr.key} ${r.pr.title}`, pct: r.score as number, tick: r.threshold })), 'No scored pull requests.'),
        h('p', { class: 'md-note2' }, 'Black tick on each bar = threshold.')),
      distributionCard(DISTRIBUTION_TITLE, distribution(inWin))),
    card('Pull Requests', 'details',
      h('div', { class: 'md-filters' }, 'Status ',
        select('status', [['all', 'All'], ['failing', 'Failing'], ['passing', 'Passing'], ['nodata', 'No data']], (v) => { status = v as StatusFilter; }),
        ' Date ',
        select('days', [['7', 'Last 7 days'], ['14', 'Last 14 days'], ['30', 'Last 30 days']], (v) => { days = Number(v); })),
      tableHolder,
      legend(),
      h('p', { class: 'md-note2' }, 'Gate is the quality gate (new-code score against the threshold, the black tick); Status and bar colors are score bands. "Open" = analyzed in the last 7 days (Sonar does not say whether a pull request is merged).')));
  paintTable();
}
