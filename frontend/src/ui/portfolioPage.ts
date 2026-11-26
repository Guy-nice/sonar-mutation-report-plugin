import { COLUMNS, MIN_REACH_PCT, allInputKeys, isSample, sumMeasures, type Column, type Scope, type Sums } from '../columns';
import { fmtInt, fmtPct, projectPageUrl, sonarBase } from '../format';
import { injectStyles } from '../styles';
import type { DataSource, PortfolioRow } from '../types';
import { clear, h } from './dom';
import { card } from './widgets';

interface View {
  row: PortfolioRow | null; // null = the total row
  sums: Sums;
}

const fmt = (col: Column, v: number | null): string => (col.format === 'pct' ? fmtPct(v) : fmtInt(v));

/**
 * Breakdown of one Sonar Portfolio: a row per project and a total, with coverage and mutation columns side by side,
 * for overall code or new code. The columns come from the registry in ../columns.ts.
 */
export async function renderPortfolioPage(root: HTMLElement, data: DataSource, portfolioKey: string): Promise<void> {
  injectStyles();
  const box = h('div', { class: 'md' });
  root.replaceChildren(box);
  box.append(h('h1', {}, 'Mutation breakdown'), h('p', { class: 'md-muted' }, 'Loading projects...'));

  let name = portfolioKey;
  let rows: PortfolioRow[];
  try {
    const b = await data.loadPortfolioBreakdown(portfolioKey, allInputKeys());
    name = b.name;
    rows = b.rows;
  } catch (e) {
    clear(box);
    box.append(h('h1', {}, 'Mutation breakdown'), h('p', { class: 'md-fail' }, `Could not load this portfolio: ${e instanceof Error ? e.message : String(e)}`));
    return;
  }

  let scope: Scope = 'overall';
  let sortId: string | 'name' = 'name';
  let dir: 1 | -1 = 1;
  const holder = h('div', {});

  const views = (): { total: View; list: View[] } => ({
    total: { row: null, sums: sumMeasures(rows.map((r) => r.measures)) },
    list: rows.map((r) => ({ row: r, sums: r.measures })),
  });

  function cellValue(col: Column, v: View): number | null {
    return col.value(v.sums, scope);
  }
  function reachOf(v: View): number | null {
    return COLUMNS.find((c) => c.id === 'reach')!.value(v.sums, scope);
  }

  function valueCell(col: Column, v: View): HTMLElement {
    const value = cellValue(col, v);
    const reach = reachOf(v);
    const sample = isSample(col, reach);
    return h('td', {
      class: `num${sample ? ' md-dim' : ''}`, 'data-col': col.id,
      ...(sample ? { title: `Only ${fmtPct(reach)} of the code is mutation tested (below ${MIN_REACH_PCT}%). Read this as a sample, not as the score of the code.` } : {}),
    }, fmt(col, value));
  }

  function paint(): void {
    const { total, list } = views();
    const sorted = [...list].sort((a, b) => {
      if (sortId === 'name') return dir * a.row!.name.localeCompare(b.row!.name);
      const col = COLUMNS.find((c) => c.id === sortId)!;
      const x = cellValue(col, a);
      const y = cellValue(col, b);
      if (x === null && y === null) return a.row!.name.localeCompare(b.row!.name);
      if (x === null) return 1; // no value sorts last, whatever the direction
      if (y === null) return -1;
      return dir * (x - y);
    });
    const th = (id: string, label: string, help: string, num: boolean) =>
      h('th', { class: `sortable${num ? ' num' : ''}${sortId === id ? (dir === 1 ? ' asc' : ' desc') : ''}`, 'data-sort': id, title: help,
        onclick: () => { if (sortId === id) dir = dir === 1 ? -1 : 1; else { sortId = id; dir = 1; } paint(); } }, label);
    clear(holder);
    holder.append(h('table', { class: 'md-table' },
      h('thead', {}, h('tr', {}, th('name', 'Project', 'Project name', false), ...COLUMNS.map((c) => th(c.id, c.label, c.help, true)))),
      h('tbody', {},
        h('tr', { class: 'md-sum', 'data-row': 'total' }, h('td', {}, `Portfolio total (${rows.length} projects)`), ...COLUMNS.map((c) => valueCell(c, total))),
        ...sorted.map((v) => h('tr', { 'data-project': v.row!.key },
          h('td', {}, h('a', { href: projectPageUrl(v.row!.key) }, v.row!.name)),
          ...COLUMNS.map((c) => valueCell(c, v)))))));
  }

  const scopeButton = (id: Scope, label: string) =>
    h('button', { class: `md-tab${scope === id ? ' on' : ''}`, 'data-scope': id, onclick: () => { scope = id; render(); } }, label);

  function render(): void {
    clear(box);
    box.append(
      h('a', { class: 'md-back', href: `${sonarBase()}/extension/mutationreport/overview`, 'data-action': 'back' }, '← Mutation overview'),
      h('h1', {}, `Mutation breakdown - ${name}`),
      h('div', { class: 'md-tabs' }, scopeButton('overall', 'Overall code'), scopeButton('new', 'New code')));
    if (rows.length === 0) {
      box.append(h('p', { class: 'md-muted' }, 'This portfolio has no projects you may see.'));
      return;
    }
    paint();
    box.append(card('Projects', 'breakdown', holder,
      h('p', { class: 'md-note2' }, 'Totals are sums over the projects (killed / total, covered / lines to cover), not averages of percentages. '
        + 'Coverage is Sonar\'s own for the whole project. Mutation data covers only the files that pull requests changed, so read the '
        + `score together with the reach: a score under ${MIN_REACH_PCT}% reach is greyed out. `
        + (scope === 'new' ? 'New code: mutation measures of the new code come from pull request analyses, see the Mutation overview; "-" means none on the main branch.' : ''))));
  }
  render();
}
