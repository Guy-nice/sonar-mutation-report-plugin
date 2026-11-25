import { fmtDate, fmtDuration, fmtPct, projectPageUrl, sonarBase } from '../format';
import {
  adoption, distribution, gateOf, groupByPortfolio, hasBefore, inWindow, isLive, isNoPrAnalysis, mean, sortProjects, summarizeOverview, summarizeProject,
  type PortfolioGroup, type ProjectSummary, type SortDir, type SortKey,
} from '../model';
import { injectStyles } from '../styles';
import type { DataSource, PortfolioRef, ProjectRef, ProjectResult } from '../types';
import { clear, h, type Child } from './dom';
import {
  DISTRIBUTION_TITLE, adoptionCard, bandPill, card, changeCell, distributionCard, gateChange, legend, pageHeader, pairedBarChart, summaryTiles,
} from './widgets';

const TITLE = 'Mutation overview';
/** The portfolio filter value for components without a portfolio. */
const NO_PORTFOLIO = '\u0000none';
/** Longest wait between repaints while projects stream in. */
const PAINT_MS = 250;
const ADOPTERS_KEY = 'mutation-dashboard-adopters:';

/** Keys of the projects that had mutation data on an earlier visit (this browser, this server). Never throws. */
function knownAdopters(): Set<string> {
  try {
    const raw = globalThis.localStorage?.getItem(ADOPTERS_KEY + sonarBase());
    const list: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(list) ? list.filter((k): k is string => typeof k === 'string') : []);
  } catch {
    return new Set();
  }
}

function rememberAdopter(key: string): void {
  try {
    const known = knownAdopters();
    if (known.has(key)) return;
    known.add(key);
    globalThis.localStorage?.setItem(ADOPTERS_KEY + sonarBase(), JSON.stringify([...known]));
  } catch {
    // storage full or disabled: the order of loading is only an optimization
  }
}

/** `num` columns are right-aligned. Gate and Status have no sort key: they are derived from the scores. */
const COLUMNS: Array<{ key: SortKey | null; label: string; num?: boolean }> = [
  { key: 'name', label: 'Component' },
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
  let portfolioDefs: PortfolioRef[] = [];
  /** When the last load finished: shown on the ready mark. */
  let readyAt: Date | null = null;
  /** Weakest components first: that is where a manager looks. */
  let sortKey: SortKey = 'after';
  let sortDir: SortDir = 'asc';
  /** Group headers the user collapsed. */
  const collapsed = new Set<string>();
  let portfolio = '';
  /** Bumped by every load and by dispose: results of an older load are dropped. */
  let loadId = 0;
  let paintTimer: ReturnType<typeof setTimeout> | null = null;

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
  function summaryRow(label: Child, rows: ProjectSummary[], cls: string, attrs: Record<string, string> = {}, onclick?: () => void): HTMLElement | null {
    const both = rows.filter((s) => s.scanned && hasBefore(s.scanned));
    const times = rows.filter((s) => s.durationSec !== null).map((s) => s.durationSec as number);
    const scans = rows.map((s) => s.scanDate).filter((d): d is string => d !== null).sort();
    const tr = h('tr', { class: cls, ...attrs, ...(onclick ? { onclick } : {}) }, h('td', {}, label));
    if (both.length === 0) {
      // Older agents report no first score: show what exists (the after score) and leave the rest empty.
      const afters = rows.map((s) => s.after).filter((v): v is number => v !== null);
      const a = mean(afters);
      tr.append(h('td', { class: 'num' }, '-'), h('td', { class: 'num' }, fmtPct(a)), h('td', { class: 'num' }, changeCell(null)), h('td', {}, '-'),
        h('td', {}, bandPill(a)), h('td', {}, scans.length ? fmtDate(scans[scans.length - 1]) : '-'),
        h('td', { class: 'num' }, times.length ? fmtDuration(times.reduce((x, v) => x + v, 0)) : '-'));
      return tr;
    }
    const before = mean(both.map((s) => s.before as number)) as number;
    const after = mean(both.map((s) => s.after as number)) as number;
    const passBefore = both.filter((s) => gateOf(s).before).length;
    const passAfter = both.filter((s) => gateOf(s).after).length;
    tr.append(
      h('td', { class: 'num' }, fmtPct(before)), h('td', { class: 'num' }, fmtPct(after)),
      h('td', { class: 'num' }, changeCell(after - before)),
      h('td', {}, h('span', { class: 'md-gate' }, h('span', { class: 'a' }, `${passBefore} pass`), h('span', { class: 'arr' }, '→'), h('span', { class: 'b' }, `${passAfter} pass`))),
      h('td', {}, bandPill(after)),
      h('td', {}, scans.length ? fmtDate(scans[scans.length - 1]) : '-'),
      h('td', { class: 'num' }, times.length ? fmtDuration(times.reduce((a, v) => a + v, 0)) : '-'));
    return tr;
  }

  function groupRows(g: PortfolioGroup): HTMLElement[] {
    const id = g.portfolio ?? NO_PORTFOLIO;
    const open = !collapsed.has(id);
    const label = h('span', {}, h('span', { class: 'md-caret' }, open ? '▾' : '▸'), ' ', h('b', {}, g.portfolio ?? 'No portfolio'),
      h('span', { class: 'md-muted' }, `  ${g.rows.length} ${g.rows.length === 1 ? 'component' : 'components'}`));
    const head = summaryRow(label, g.rows, 'md-group', { 'data-portfolio': id }, () => { if (open) collapsed.add(id); else collapsed.delete(id); paint(); }) as HTMLElement;
    return [head, ...(open ? g.rows.map(row) : [])];
  }

  /** While projects stream in, repaint at most every PAINT_MS: one repaint per project is quadratic on a big server. */
  function schedulePaint(): void {
    if (paintTimer !== null) return;
    paintTimer = setTimeout(() => { paintTimer = null; paint(); }, PAINT_MS);
  }

  /** Tells the user whether the numbers below are final: progress while loading, a ready mark with the time when done. */
  function statusBar(): HTMLElement {
    if (loading) {
      const known = projects.length > 0;
      const pct = known ? Math.round((results.size / projects.length) * 100) : 0;
      return h('div', { class: 'md-status loading', 'data-status': 'loading', role: 'status' },
        h('span', { class: 'md-spin', 'aria-hidden': 'true' }),
        h('div', { class: 'md-status-main' },
          h('b', {}, known ? `Loading data: ${results.size} of ${projects.length} components (${pct}%)` : 'Loading components and portfolios...'),
          h('span', { class: 'md-muted' }, ' The numbers below are partial and change until loading is done.'),
          h('div', { class: 'md-track md-status-track' }, h('span', { class: 'md-fill', style: `width:${pct}%` }))));
    }
    return h('div', { class: 'md-status ready', 'data-status': 'ready', role: 'status' },
      h('span', { class: 'md-tickmark', 'aria-hidden': 'true' }, '✓'),
      h('div', { class: 'md-status-main' },
        h('b', {}, 'Data ready'),
        h('span', { class: 'md-muted' }, ` ${projects.length} components checked${readyAt ? ` at ${readyAt.toTimeString().slice(0, 5)}` : ''}. `),
        h('button', { class: 'md-link', 'data-action': 'refresh-status', onclick: () => void reload() }, 'Refresh')));
  }

  function paint(): void {
    if (paintTimer !== null) { clearTimeout(paintTimer); paintTimer = null; }
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
    const portfolios = groupByPortfolio(all.filter(isLive), portfolioDefs).map((g) => g.portfolio).filter((p): p is string => p !== null);
    let summaries = all;
    // Only live components: a PR with mutation data in the window. The rest is counted, not listed.
    const dormant = all.filter((s) => !isLive(s) && s.error === null).length;
    summaries = summaries.filter((s) => isLive(s) || s.error !== null);
    if (portfolio) summaries = summaries.filter((s) => groupByPortfolio([s], portfolioDefs).some((g) => (portfolio === NO_PORTFOLIO ? g.portfolio === null : g.portfolio === portfolio)));
    summaries = sortProjects(summaries, sortKey, sortDir);

    const pairs = groupByPortfolio(all.filter(isLive), portfolioDefs)
      .map((g) => ({ name: g.portfolio ?? 'No portfolio', rows: g.rows.filter((s) => s.scanned && hasBefore(s.scanned)) }))
      .filter((g) => g.rows.length > 0)
      .map((g) => ({
        key: g.name, label: `${g.name} (${g.rows.length})`,
        before: mean(g.rows.map((s) => s.before as number)), after: mean(g.rows.map((s) => s.after as number)) as number,
        tick: g.rows[0].scanned?.threshold ?? 80,
      }))
      .sort((a, b) => b.after - a.after || a.label.localeCompare(b.label));

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

    const live = summaries.filter((s) => !s.error);
    const groups = groupByPortfolio(live, portfolioDefs);
    const failed = summaries.filter((s) => s.error);
    const totals = summaryRow('All live components', live, 'md-sum', { 'data-row': 'total' });
    clear(body);
    body.append(
      ...pageHeader(TITLE, windowPrs, `${o.projectsWithData} live ${o.projectsWithData === 1 ? 'component' : 'components'} in ${portfolios.length + (groupByPortfolio(all.filter(isLive), portfolioDefs).some((g) => g.portfolio === null) ? 1 : 0)} ${'portfolios'}`),
      statusBar(),
      adoptionCard(adoption(all, portfolioDefs), loading),
      summaryTiles(windowPrs, now()),
      h('div', { class: 'md-cards' },
        card('Before → After Agent, by Portfolio', 'scores', pairedBarChart(pairs, loading ? 'Loading...' : 'No portfolio has a score yet.')),
        distributionCard(DISTRIBUTION_TITLE, distribution(windowPrs))),
      card('Component changes, by portfolio', 'details',
        h('div', { class: 'md-filters' },
          h('span', {}, `Live components only: a pull request with mutation data in the last 30 days${dormant > 0 ? ` (${dormant} without a recent mutation run hidden)` : ''}`),
          portfolios.length === 0 ? null : h('label', {}, 'Portfolio ',
            h('select', { 'data-filter': 'portfolio', onchange: (e: Event) => { portfolio = (e.target as HTMLSelectElement).value; paint(); } },
              h('option', { value: '', ...(portfolio === '' ? { selected: 'selected' } : {}) }, 'All'),
              ...portfolios.map((p) => h('option', { value: p, ...(portfolio === p ? { selected: 'selected' } : {}) }, p)),
              h('option', { value: NO_PORTFOLIO, ...(portfolio === NO_PORTFOLIO ? { selected: 'selected' } : {}) }, 'No portfolio'))),
          h('button', { class: 'md-link', 'data-action': 'refresh', onclick: () => void reload() }, 'Refresh'),
          loading ? h('span', { 'data-loading': 'true' }, `Loading ${results.size} / ${projects.length} components...`) : null),
        projects.length === 0 && !loading
          ? h('p', { class: 'md-muted' }, 'No components found.')
          : summaries.length === 0 && !loading
            ? h('p', { class: 'md-muted' }, 'No live components: no pull request with mutation data in the last 30 days.')
            : h('table', { class: 'md-table' }, h('thead', {}, head), h('tbody', {}, ...groups.flatMap(groupRows), ...failed.map(row), totals)),
        legend(),
        h('p', { class: 'md-note2' }, 'Only live components are listed (a pull request with mutation data in the last 30 days), grouped by Sonar Portfolio (a component in several portfolios is listed under each). Click a portfolio to collapse it. Each component row is its most recent pull request with mutation data; a portfolio row averages its components. Before = new-code score of its first run; After = score after the agent wrote tests. Mutation gate = the new-code score against the component\'s threshold. Status is the band of the After score. Time taken = the whole agent run. The last row averages all live components that report both scores.')),
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
    readyAt = null;
    paint();
    try {
      const [list, defs] = await Promise.all([data.listProjects(), data.listPortfolios()]);
      if (id !== loadId) return;
      portfolioDefs = defs;
      // Projects that had mutation data last time load first, so the page fills in at once on a big server.
      const known = knownAdopters();
      projects = [...list].sort((a, b) => Number(known.has(b.key)) - Number(known.has(a.key)));
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
      if (res.prs.some((r) => r.hasData)) rememberAdopter(p.key);
      schedulePaint();
    }));
    if (id !== loadId) return;
    loading = false;
    readyAt = now();
    paint();
  }
  const reload = () => load(true);
  void load(false);

  return { reload, dispose: () => { loadId++; if (paintTimer !== null) { clearTimeout(paintTimer); paintTimer = null; } } };
}
