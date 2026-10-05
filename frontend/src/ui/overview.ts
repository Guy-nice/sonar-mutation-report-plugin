import { fmtAge, fmtPct, projectPageUrl } from '../format';
import { isFailing, sortProjects, summarizeOverview, summarizeProject, type ProjectSummary, type SortDir, type SortKey } from '../model';
import { injectStyles } from '../styles';
import type { DataSource, PrResult, ProjectRef, ProjectResult } from '../types';
import { clear, h } from './dom';

const COLUMNS: Array<{ key: SortKey; label: string }> = [
  { key: 'name', label: 'Project' },
  { key: 'failingOpen', label: 'Failing open PRs' },
  { key: 'passRate', label: 'Pass rate 30d' },
  { key: 'medianScore', label: 'Median score' },
  { key: 'adoption', label: 'Adoption' },
  { key: 'latest', label: 'Latest PR' },
];

function rateBar(pct: number): HTMLElement {
  const color = pct < 60 ? '#ef6c00' : pct < 75 ? '#f9a825' : pct < 90 ? '#7cb342' : '#2e7d32';
  return h('span', { class: 'md-bar' }, h('i', { style: `width:${Math.max(0, Math.min(100, pct))}%;background:${color}` }));
}

export function renderOverview(root: HTMLElement, data: DataSource, now: () => Date = () => new Date()): { reload(): Promise<void> } {
  injectStyles();
  const results = new Map<string, ProjectResult>();
  let projects: ProjectRef[] = [];
  let loading = true;
  let sortKey: SortKey = 'failingOpen';
  let sortDir: SortDir = 'desc';
  let onlyWithData = true;

  const body = h('div', { class: 'md' });
  root.replaceChildren(body);

  function latestCell(s: ProjectSummary): HTMLElement {
    const td = h('td', { 'data-col': 'latest' });
    if (s.error) return td;
    if (s.total === 0) {
      td.append(h('span', { class: 'md-muted' }, 'no PRs in the last 30 days'));
      return td;
    }
    const r = s.latest as PrResult;
    if (!r.hasData) {
      td.append(`#${r.pr.key} `, h('span', { class: 'md-muted' }, 'no mutation data'));
      return td;
    }
    const failing = isFailing(r);
    td.append(`#${r.pr.key} `, h('span', { class: `md-pill ${failing ? 'fail' : 'pass'}` }, `${failing ? 'FAIL' : 'PASS'} ${fmtPct(r.score)}`), ` ${fmtAge(r.pr.analysisDate, now())}`);
    return td;
  }

  function row(s: ProjectSummary): HTMLElement {
    const tr = h('tr', { 'data-project': s.key });
    tr.append(h('td', {}, h('a', { href: projectPageUrl(s.key) }, h('b', {}, s.name))));
    if (s.error) {
      tr.append(
        h('td', { 'data-col': 'failing', colspan: 5 }, h('span', { class: 'md-muted' }, `unavailable (${s.error}) `),
          h('button', { class: 'md-link', 'data-action': 'retry', onclick: () => retry(s.key) }, 'retry')),
      );
      return tr;
    }
    tr.append(
      h('td', { 'data-col': 'failing', class: s.failingOpen ? 'md-fail' : 'md-muted' }, String(s.failingOpen)),
      h('td', { 'data-col': 'passRate' }, fmtPct(s.passRate, s.passRate === null ? 1 : 0), s.passRate === null ? null : rateBar(s.passRate)),
      h('td', { 'data-col': 'median' }, fmtPct(s.medianScore)),
      h('td', { 'data-col': 'adoption', class: s.total > 0 && s.withData === 0 ? 'md-fail' : '' }, `${s.withData} / ${s.total}${s.withData > 0 ? ' PRs' : ''}`),
      latestCell(s),
    );
    return tr;
  }

  function paint(): void {
    const list = [...results.values()];
    const o = summarizeOverview(list, now());
    let summaries = list.map((r) => summarizeProject(r, now()));
    if (onlyWithData) summaries = summaries.filter((s) => s.withData > 0 || s.error !== null);
    summaries = sortProjects(summaries, sortKey, sortDir);

    const kpi = (name: string, v: string, label: string, cls = '') =>
      h('div', { class: 'md-kpi', 'data-tile': name }, h('div', { class: `v ${cls}` }, v), h('div', { class: 'l' }, label));

    const head = h('tr', {}, ...COLUMNS.map((c) =>
      h('th', { class: `sortable ${sortKey === c.key ? sortDir : ''}`, 'data-sort': c.key, onclick: () => {
        if (sortKey === c.key) sortDir = sortDir === 'desc' ? 'asc' : 'desc';
        else { sortKey = c.key; sortDir = c.key === 'name' ? 'asc' : 'desc'; }
        paint();
      } }, c.label)));

    clear(body);
    body.append(
      h('h1', {}, 'Mutation overview'),
      h('div', { class: 'md-kpis' },
        kpi('failingOpen', String(o.failingOpen), 'open PRs failing now', o.failingOpen ? 'md-fail' : ''),
        kpi('passRate', fmtPct(o.passRate, 0), 'PR pass rate (30d)'),
        kpi('projects', `${o.projectsWithData} / ${o.projectsTotal}`, 'projects using mutation'),
        kpi('median', fmtPct(o.medianScore), 'median new-code score')),
      h('div', { class: 'md-filters' },
        h('label', {}, h('input', { type: 'checkbox', 'data-filter': 'withData', ...(onlyWithData ? { checked: 'checked' } : {}), onclick: (e: Event) => {
          onlyWithData = (e.target as HTMLInputElement).checked;
          paint();
        } }), ' Only projects with mutation data'),
        h('span', {}, 'Last 30 days'),
        h('button', { class: 'md-link', 'data-action': 'refresh', onclick: () => void reload() }, 'Refresh'),
        loading ? h('span', { 'data-loading': 'true' }, `Loading ${results.size} / ${projects.length} projects...`) : null),
      projects.length === 0 && !loading
        ? h('p', { class: 'md-muted' }, 'No projects found.')
        : h('table', { class: 'md-table' }, h('thead', {}, head), h('tbody', {}, ...summaries.map(row))),
    );
  }

  async function retry(key: string): Promise<void> {
    const p = projects.find((x) => x.key === key);
    if (!p) return;
    results.set(key, await data.loadProject(p));
    paint();
  }

  async function load(clearFirst: boolean): Promise<void> {
    if (clearFirst) data.clearCache();
    results.clear();
    loading = true;
    paint();
    try {
      projects = await data.listProjects();
    } catch (e) {
      loading = false;
      clear(body);
      body.append(h('h1', {}, 'Mutation overview'), h('p', { class: 'md-fail' }, `Could not load projects: ${e instanceof Error ? e.message : String(e)}`));
      return;
    }
    paint();
    await Promise.all(projects.map(async (p) => {
      results.set(p.key, await data.loadProject(p));
      paint();
    }));
    loading = false;
    paint();
  }
  const reload = () => load(true);
  void load(false);

  return { reload };
}
