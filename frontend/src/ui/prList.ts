import { fmtAge, fmtInt, fmtPct, scoreColor } from '../format';
import { inWindow, isFailing, isNoPrAnalysis, isOpen, isPassing, median } from '../model';
import { injectStyles } from '../styles';
import type { DataSource, PrResult, ProjectRef } from '../types';
import { clear, h } from './dom';

export function scoreBar(r: PrResult): HTMLElement {
  const pct = Math.max(0, Math.min(100, r.score ?? 0));
  return h('span', { class: 'md-bar' },
    h('i', { style: `width:${pct}%;background:${scoreColor(r.score, r.threshold)}` }),
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
  box.append(h('h1', {}, `Mutation - ${project.name}`));
  if (res.error) {
    box.append(isNoPrAnalysis(res.error)
      ? h('p', { class: 'md-note' }, 'This Sonar server has no pull request analysis (Developer Edition or higher is needed), so there is nothing to show.')
      : h('p', { class: 'md-fail' }, `Could not load pull requests: ${res.error}`));
    return;
  }
  const inWin = res.prs.filter((r) => inWindow(r, now()));
  if (inWin.length === 0) {
    box.append(h('p', { class: 'md-muted' }, 'No pull requests in the last 30 days.'));
    return;
  }

  let status: StatusFilter = 'all';
  let days = 30;
  const holder = h('div', {});

  function paint(): void {
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

    const withData = inWin.filter((r) => r.hasData);
    const scored = withData.filter((r) => r.score !== null);
    const passRate = scored.length ? (scored.filter(isPassing).length / scored.length) * 100 : null;
    const med = median(scored.map((r) => r.score as number));
    const failing = inWin.filter((r) => isFailing(r) && isOpen(r, now())).length;
    const kpi = (n: string, v: string, l: string, cls = '') =>
      h('div', { class: 'md-kpi', 'data-tile': n }, h('div', { class: `v ${cls}` }, v), h('div', { class: 'l' }, l));

    clear(holder);
    holder.append(
      h('div', { class: 'md-kpis' },
        kpi('failingOpen', String(failing), 'open PRs failing now', failing ? 'md-fail' : ''),
        kpi('passRate', fmtPct(passRate, 0), `pass rate (${scored.filter(isPassing).length} / ${scored.length} PRs)`),
        kpi('median', fmtPct(med), 'median new-code score'),
        kpi('withData', `${withData.length} / ${inWin.length}`, 'PRs with mutation data')),
      h('table', { class: 'md-table' },
        h('thead', {}, h('tr', {}, ...['PR', 'Title', 'Status', 'Analyzed', 'New-code score', 'Survived', 'No coverage'].map((t) => h('th', {}, t)))),
        h('tbody', {}, ...visible.map((r) => h('tr', { 'data-pr': r.pr.key },
          h('td', {}, h('button', { class: 'md-link', 'data-action': 'open', onclick: () => onOpen(r) }, `#${r.pr.key}`)),
          h('td', {}, r.pr.title),
          h('td', { 'data-col': 'status' }, statusPill(r)),
          h('td', { 'data-col': 'analyzed' }, fmtAge(r.pr.analysisDate, now())),
          h('td', { 'data-col': 'score' }, fmtPct(r.score), r.score !== null ? scoreBar(r) : null,
            r.thresholdAssumed && r.hasData ? h('span', { class: 'md-muted' }, ' (threshold assumed)') : null),
          h('td', { 'data-col': 'survived' }, r.hasData ? fmtInt(r.measures.new_mutation_survived) : '-'),
          h('td', { 'data-col': 'noCoverage' }, r.hasData ? fmtInt(r.measures.new_mutation_no_coverage) : '-'))))),
      h('p', { class: 'md-muted' }, 'Black tick on each bar = threshold. "Open" = analyzed in the last 7 days (Sonar does not say whether a pull request is merged).'),
    );
  }

  const select = (name: string, options: Array<[string, string]>, on: (v: string) => void) =>
    h('select', { 'data-filter': name, onchange: (e: Event) => { on((e.target as HTMLSelectElement).value); paint(); } },
      ...options.map(([v, l]) => h('option', { value: v, ...(v === '30' || v === 'all' ? { selected: 'selected' } : {}) }, l)));

  box.append(
    h('div', { class: 'md-filters' }, 'Status ',
      select('status', [['all', 'All'], ['failing', 'Failing'], ['passing', 'Passing'], ['nodata', 'No data']], (v) => { status = v as StatusFilter; }),
      ' Date ',
      select('days', [['7', 'Last 7 days'], ['14', 'Last 14 days'], ['30', 'Last 30 days']], (v) => { days = Number(v); })),
    holder,
  );
  paint();
}
