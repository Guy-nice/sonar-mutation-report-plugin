import { fmtAge, fmtPct, projectPageUrl } from '../format';
import {
  distribution, inWindow, isFailing, isNoPrAnalysis, sortProjects, summarizeOverview, summarizeProject,
  type ProjectSummary, type SortDir, type SortKey,
} from '../model';
import { injectStyles } from '../styles';
import type { DataSource, PrResult, ProjectRef, ProjectResult } from '../types';
import { clear, h } from './dom';
import { DISTRIBUTION_TITLE, bandPill, barChart, card, distributionCard, legend, pageHeader, summaryTiles } from './widgets';

const TITLE = 'Mutation overview';

/** `num` columns are right-aligned. Status has no sort key: it is a band of the median score. */
const COLUMNS: Array<{ key: SortKey | null; label: string; num?: boolean }> = [
  { key: 'name', label: 'Project' },
  { key: 'failingOpen', label: 'Failing open PRs', num: true },
  { key: 'passRate', label: 'Pass rate 30d', num: true },
  { key: 'medianScore', label: 'Median score', num: true },
  { key: null, label: 'Status' },
  { key: 'adoption', label: 'Adoption', num: true },
  { key: 'latest', label: 'Latest PR' },
];

export function renderOverview(root: HTMLElement, data: DataSource, now: () => Date = () => new Date()): { reload(): Promise<void>; dispose(): void } {
  injectStyles();
  const results = new Map<string, ProjectResult>();
  let projects: ProjectRef[] = [];
  let loading = true;
  let sortKey: SortKey = 'failingOpen';
  let sortDir: SortDir = 'desc';
  let onlyWithData = false;
  /** Bumped by every load and by dispose: results of an older load are dropped. */
  let loadId = 0;

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
    if (r.score === null) {
      td.append(`#${r.pr.key} `, h('span', { class: 'md-pill none' }, 'NO SCORE'), ` ${fmtAge(r.pr.analysisDate, now())}`);
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
        h('td', { 'data-col': 'failing', colspan: 6 }, h('span', { class: 'md-muted' }, `unavailable (${s.error}) `),
          h('button', { class: 'md-link', 'data-action': 'retry', onclick: () => retry(s.key) }, 'retry')),
      );
      return tr;
    }
    tr.append(
      h('td', { 'data-col': 'failing', class: `num ${s.failingOpen ? 'md-fail' : 'md-muted'}` }, String(s.failingOpen)),
      h('td', { 'data-col': 'passRate', class: 'num' }, fmtPct(s.passRate, s.passRate === null ? 1 : 0)),
      h('td', { 'data-col': 'median', class: 'num' }, fmtPct(s.medianScore)),
      h('td', { 'data-col': 'status' }, bandPill(s.medianScore)),
      h('td', { 'data-col': 'adoption', class: `num ${s.total > 0 && s.withData === 0 ? 'md-fail' : ''}` }, `${s.withData} / ${s.total}${s.withData > 0 ? ' PRs' : ''}`),
      latestCell(s),
    );
    return tr;
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
    let summaries = all;
    if (onlyWithData) summaries = summaries.filter((s) => s.withData > 0 || s.error !== null);
    summaries = sortProjects(summaries, sortKey, sortDir);

    const scoreBars = all
      .filter((s) => s.medianScore !== null)
      .sort((a, b) => (b.medianScore as number) - (a.medianScore as number) || a.name.localeCompare(b.name))
      .map((s) => ({ key: s.key, label: s.name, pct: s.medianScore as number }));

    const head = h('tr', {}, ...COLUMNS.map((c) => {
      const num = c.num ? 'num ' : '';
      if (c.key === null) return h('th', { class: num.trim() }, c.label);
      const key = c.key;
      return h('th', { class: `sortable ${num}${sortKey === key ? sortDir : ''}`, 'data-sort': key, onclick: () => {
        if (sortKey === key) sortDir = sortDir === 'desc' ? 'asc' : 'desc';
        else { sortKey = key; sortDir = key === 'name' ? 'asc' : 'desc'; }
        paint();
      } }, c.label);
    }));

    clear(body);
    body.append(
      ...pageHeader(TITLE, windowPrs, `${o.projectsWithData} of ${o.projectsTotal} projects use mutation`),
      summaryTiles(windowPrs, now()),
      h('div', { class: 'md-cards' },
        card('Median Score by Project', 'scores', barChart(scoreBars, loading ? 'Loading...' : 'No project has a score yet.')),
        distributionCard(DISTRIBUTION_TITLE, distribution(windowPrs))),
      card('Project Details', 'details',
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
          : summaries.length === 0 && !loading
            ? h('p', { class: 'md-muted' }, 'No projects with mutation data.')
            : h('table', { class: 'md-table' }, h('thead', {}, head), h('tbody', {}, ...summaries.map(row))),
        legend(),
        h('p', { class: 'md-note2' }, 'Status is the band of the median score; the quality gate is each project\'s threshold. "Open" = analyzed in the last 7 days (Sonar does not say whether a pull request is merged).')),
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
      body.append(h('h1', {}, TITLE), h('p', { class: 'md-fail' }, `Could not load projects: ${e instanceof Error ? e.message : String(e)}`));
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
