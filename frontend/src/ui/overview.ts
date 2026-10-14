import { fmtDate, fmtDuration, fmtPct, projectPageUrl } from '../format';
import {
  distribution, gateOf, hasBefore, inWindow, isNoPrAnalysis, mean, sortProjects, summarizeOverview, summarizeProject,
  type ProjectSummary, type SortDir, type SortKey,
} from '../model';
import { injectStyles } from '../styles';
import type { DataSource, ProjectRef, ProjectResult } from '../types';
import { clear, h } from './dom';
import {
  DISTRIBUTION_TITLE, bandPill, card, changeCell, distributionCard, gateChange, legend, pageHeader, pairedBarChart, summaryTiles,
} from './widgets';

const TITLE = 'Mutation overview';
/** The portfolio filter value for components without a portfolio. */
const NO_PORTFOLIO = '\u0000none';

/** `num` columns are right-aligned. Gate and Status have no sort key: they are derived from the scores. */
const COLUMNS: Array<{ key: SortKey | null; label: string; num?: boolean }> = [
  { key: 'name', label: 'Component' },
  { key: 'portfolio', label: 'Portfolio' },
  { key: 'before', label: 'Before', num: true },
  { key: 'after', label: 'After', num: true },
  { key: 'change', label: 'Change (pts)', num: true },
  { key: null, label: 'Mutation gate' },
  { key: null, label: 'Status' },
  { key: 'scan', label: 'Last scan' },
  { key: 'time', label: 'Time taken', num: true },
];

export function renderOverview(root: HTMLElement, data: DataSource, now: () => Date = () => new Date()): { reload(): Promise<void>; dispose(): void } {
  injectStyles();
  const results = new Map<string, ProjectResult>();
  let projects: ProjectRef[] = [];
  let loading = true;
  /** Weakest components first: that is where a manager looks. */
  let sortKey: SortKey = 'after';
  let sortDir: SortDir = 'asc';
  let onlyWithData = false;
  let portfolio = '';
  /** Bumped by every load and by dispose: results of an older load are dropped. */
  let loadId = 0;

  const body = h('div', { class: 'md' });
  root.replaceChildren(body);

  function row(s: ProjectSummary): HTMLElement {
    const tr = h('tr', { 'data-project': s.key });
    tr.append(h('td', {}, h('a', { href: projectPageUrl(s.key) }, h('b', {}, s.name))));
    if (s.error) {
      tr.append(
        h('td', { 'data-col': 'error', colspan: COLUMNS.length - 1 }, h('span', { class: 'md-muted' }, `unavailable (${s.error}) `),
          h('button', { class: 'md-link', 'data-action': 'retry', onclick: () => retry(s.key) }, 'retry')),
      );
      return tr;
    }
    const gate = gateOf(s);
    tr.append(
      h('td', { 'data-col': 'portfolio' }, s.portfolio ?? h('span', { class: 'md-muted' }, '-')),
      h('td', { 'data-col': 'before', class: 'num' }, fmtPct(s.before)),
      h('td', { 'data-col': 'after', class: 'num' }, fmtPct(s.after)),
      h('td', { 'data-col': 'change', class: 'num' }, changeCell(s.change)),
      h('td', { 'data-col': 'gate' }, gateChange(gate.before, gate.after)),
      h('td', { 'data-col': 'status' }, bandPill(s.after)),
      h('td', { 'data-col': 'scan' }, s.scanDate ? fmtDate(s.scanDate) : h('span', { class: 'md-muted' }, s.total === 0 ? 'no PRs in the last 30 days' : 'never scanned')),
      h('td', { 'data-col': 'time', class: 'num' }, fmtDuration(s.durationSec)),
    );
    return tr;
  }

  /** Mean of the components that report both scores, so the row compares like with like. */
  function totalsRow(rows: ProjectSummary[]): HTMLElement | null {
    const both = rows.filter((s) => s.scanned && hasBefore(s.scanned));
    if (both.length === 0) return null;
    const before = mean(both.map((s) => s.before as number)) as number;
    const after = mean(both.map((s) => s.after as number)) as number;
    const passBefore = both.filter((s) => gateOf(s).before).length;
    const passAfter = both.filter((s) => gateOf(s).after).length;
    const times = rows.filter((s) => s.durationSec !== null).map((s) => s.durationSec as number);
    return h('tr', { class: 'md-sum', 'data-row': 'total' },
      h('td', {}, 'All components'), h('td', {}),
      h('td', { class: 'num' }, fmtPct(before)), h('td', { class: 'num' }, fmtPct(after)),
      h('td', { class: 'num' }, changeCell(after - before)),
      h('td', {}, h('span', { class: 'md-gate' }, h('span', { class: 'a' }, `${passBefore} pass`), h('span', { class: 'arr' }, '→'), h('span', { class: 'b' }, `${passAfter} pass`))),
      h('td', {}), h('td', {}),
      h('td', { class: 'num' }, times.length ? fmtDuration(times.reduce((a, v) => a + v, 0)) : '-'));
  }

  function paint(): void {
    const list = [...results.values()];
    if (!loading && list.length > 0 && list.every((r) => isNoPrAnalysis(r.error))) {
      clear(body);
      body.append(h('h1', {}, TITLE),
        h('p', { class: 'md-note' }, 'This Sonar server has no pull request analysis (Developer Edition or higher is needed), so there is nothing to show.'));
      return;
    }
    const o = summarizeOverview(list, now());
    const windowPrs = list.filter((r) => !r.error).flatMap((r) => r.prs.filter((p) => inWindow(p, now())));
    const all = list.map((r) => summarizeProject(r, now()));
    const portfolios = [...new Set(all.map((s) => s.portfolio).filter((p): p is string => p !== null))].sort((a, b) => a.localeCompare(b));
    let summaries = all;
    if (onlyWithData) summaries = summaries.filter((s) => s.withData > 0 || s.error !== null);
    if (portfolio) summaries = summaries.filter((s) => (portfolio === NO_PORTFOLIO ? s.portfolio === null : s.portfolio === portfolio));
    summaries = sortProjects(summaries, sortKey, sortDir);

    const pairs = all
      .filter((s) => s.after !== null)
      .sort((a, b) => (b.after as number) - (a.after as number) || a.name.localeCompare(b.name))
      .map((s) => ({ key: s.key, label: s.name, before: s.before, after: s.after as number, tick: (s.scanned as { threshold: number }).threshold }));

    const head = h('tr', {}, ...COLUMNS.map((c) => {
      const num = c.num ? 'num ' : '';
      if (c.key === null) return h('th', { class: num.trim() }, c.label);
      const key = c.key;
      return h('th', { class: `sortable ${num}${sortKey === key ? sortDir : ''}`, 'data-sort': key, onclick: () => {
        if (sortKey === key) sortDir = sortDir === 'desc' ? 'asc' : 'desc';
        else { sortKey = key; sortDir = key === 'name' || key === 'portfolio' ? 'asc' : 'desc'; }
        paint();
      } }, c.label);
    }));

    const totals = totalsRow(summaries.filter((s) => !s.error));
    clear(body);
    body.append(
      ...pageHeader(TITLE, windowPrs, `${o.projectsWithData} of ${o.projectsTotal} components use mutation`),
      summaryTiles(windowPrs, now()),
      h('div', { class: 'md-cards' },
        card('Before → After Agent, by Component', 'scores', pairedBarChart(pairs, loading ? 'Loading...' : 'No component has a score yet.')),
        distributionCard(DISTRIBUTION_TITLE, distribution(windowPrs))),
      card('Component changes', 'details',
        h('div', { class: 'md-filters' },
          h('label', {}, h('input', { type: 'checkbox', 'data-filter': 'withData', ...(onlyWithData ? { checked: 'checked' } : {}), onclick: (e: Event) => {
            onlyWithData = (e.target as HTMLInputElement).checked;
            paint();
          } }), ' Only components with mutation data'),
          portfolios.length === 0 ? null : h('label', {}, 'Portfolio ',
            h('select', { 'data-filter': 'portfolio', onchange: (e: Event) => { portfolio = (e.target as HTMLSelectElement).value; paint(); } },
              h('option', { value: '', ...(portfolio === '' ? { selected: 'selected' } : {}) }, 'All'),
              ...portfolios.map((p) => h('option', { value: p, ...(portfolio === p ? { selected: 'selected' } : {}) }, p)),
              h('option', { value: NO_PORTFOLIO, ...(portfolio === NO_PORTFOLIO ? { selected: 'selected' } : {}) }, 'No portfolio'))),
          h('span', {}, 'Last 30 days'),
          h('button', { class: 'md-link', 'data-action': 'refresh', onclick: () => void reload() }, 'Refresh'),
          loading ? h('span', { 'data-loading': 'true' }, `Loading ${results.size} / ${projects.length} components...`) : null),
        projects.length === 0 && !loading
          ? h('p', { class: 'md-muted' }, 'No components found.')
          : summaries.length === 0 && !loading
            ? h('p', { class: 'md-muted' }, 'No components with mutation data.')
            : h('table', { class: 'md-table' }, h('thead', {}, head), h('tbody', {}, ...summaries.map(row), totals)),
        legend(),
        h('p', { class: 'md-note2' }, 'Each row is the component\'s most recent pull request with mutation data. Before = new-code score of its first run; After = score after the agent wrote tests. Mutation gate = the new-code score against the component\'s threshold. Status is the band of the After score. Time taken = the whole agent run. The last row averages the components that report both scores.')),
    );
  }

  async function retry(key: string): Promise<void> {
    const p = projects.find((x) => x.key === key);
    if (!p) return;
    const id = loadId;
    const res = await data.loadProject(p);
    if (id !== loadId) return;
    results.set(key, res);
    paint();
  }

  async function load(clearFirst: boolean): Promise<void> {
    const id = ++loadId;
    if (clearFirst) data.clearCache();
    results.clear();
    loading = true;
    paint();
    try {
      const list = await data.listProjects();
      if (id !== loadId) return;
      projects = list;
    } catch (e) {
      if (id !== loadId) return;
      loading = false;
      clear(body);
      body.append(h('h1', {}, TITLE), h('p', { class: 'md-fail' }, `Could not load components: ${e instanceof Error ? e.message : String(e)}`));
      return;
    }
    paint();
    await Promise.all(projects.map(async (p) => {
      const res = await data.loadProject(p);
      if (id !== loadId) return;
      results.set(p.key, res);
      paint();
    }));
    if (id !== loadId) return;
    loading = false;
    paint();
  }
  const reload = () => load(true);
  void load(false);

  return { reload, dispose: () => { loadId++; } };
}
