import { codeUrl, fmtAge, fmtInt, fmtPct } from '../format';
import { distribution, sortFilesWeakestFirst } from '../model';
import { injectStyles } from '../styles';
import type { DataSource, FileRow, PrResult, SurvivorRow } from '../types';
import { h } from './dom';
import { scoreBar, statusPill } from './prList';
import type { DetailRenderer } from './projectPage';
import { barChart, card, distributionCard, legend, tile } from './widgets';

/** Bars in the "weakest files" card. */
const CHART_FILES = 6;
const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1);

const LANGUAGES = ['typescript', 'javascript', 'csharp', 'java', 'python', 'go', 'other'];
const LANG_FIELDS = ['total', 'killed', 'survived', 'score'];
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function survivorTable(rows: SurvivorRow[], projectKey: string, prKey: string, withFile: boolean): HTMLElement {
  return h('table', { class: 'md-table' },
    h('thead', {}, h('tr', {}, ...[withFile ? 'File' : null, 'Line', 'Status', 'Operator'].map((t) => (t ? h('th', {}, t) : null)))),
    h('tbody', {}, ...rows.map((s) => h('tr', { 'data-survivor': `${s.fileKey}:${s.line}` },
      withFile ? h('td', {}, s.path) : null,
      h('td', {}, h('a', { href: codeUrl(projectKey, prKey, s.fileKey, s.line), target: '_blank', rel: 'noopener' }, String(s.line))),
      h('td', { class: 'md-fail' }, s.status === 'SURVIVED' ? 'SURVIVED' : 'NO COVERAGE'),
      h('td', {}, s.operator || '-')))));
}

export const renderPrDetail: DetailRenderer = async (root, data, projectKey, r, onBack, now = () => new Date()) => {
  injectStyles();
  const m = r.measures;
  const other = ['new_mutation_timed_out', 'new_mutation_memory_error', 'new_mutation_unknown'].map((k) => m[k]);
  const otherSum = other.every((v) => v === undefined) ? null : other.reduce<number>((a, v) => a + (v ?? 0), 0);
  const dist = distribution([r]);
  const weakest = h('div', {}, h('p', { class: 'md-empty' }, 'Loading files...'));

  const panels: Record<string, HTMLElement> = {
    files: h('div', { 'data-panel': 'files' }, h('p', { class: 'md-muted' }, 'Loading files...')),
    survivors: h('div', { 'data-panel': 'survivors', hidden: 'hidden' }, h('p', { class: 'md-muted' }, 'Loading survivors...')),
    languages: h('div', { 'data-panel': 'languages', hidden: 'hidden' }),
    metrics: h('div', { 'data-panel': 'metrics', hidden: 'hidden' }),
  };
  const tabs: Record<string, HTMLButtonElement> = {};
  const loaded = new Set<string>();

  function select(name: string): void {
    for (const [k, b] of Object.entries(tabs)) b.className = `md-tab${k === name ? ' on' : ''}`;
    for (const [k, p] of Object.entries(panels)) { if (k === name) p.removeAttribute('hidden'); else p.setAttribute('hidden', 'hidden'); }
    if (name === 'languages' && !loaded.has(name)) { loaded.add(name); void loadLanguages(); }
    if (name === 'metrics' && !loaded.has(name)) { loaded.add(name); void loadMetrics(); }
  }
  const tab = (name: string, label: string) => {
    tabs[name] = h('button', { class: 'md-tab', 'data-tab': name, onclick: () => select(name) }, label);
    return tabs[name];
  };

  root.replaceChildren(h('div', { class: 'md' },
    h('button', { class: 'md-link', 'data-action': 'back', onclick: onBack }, 'All pull requests'),
    h('div', { class: 'md-head' },
      h('div', {}, h('div', { class: 't' }, `PR #${r.pr.key} - ${r.pr.title} `, statusPill(r)),
        h('div', { class: 'm' }, `${r.pr.branch} → ${r.pr.base} · analyzed ${fmtAge(r.pr.analysisDate, now())}`)),
      h('div', {}, h('div', { class: `md-big ${r.score !== null && r.score < r.threshold ? 'md-fail' : ''}`, 'data-part': 'score' }, fmtPct(r.score)),
        h('div', { class: 'm' }, `new-code score · threshold ${r.threshold}%${r.thresholdAssumed ? ' (assumed)' : ''}`)),
    ),
    h('div', { class: 'md-kpis' },
      tile('total', 'Mutants in changed lines', fmtInt(m.new_mutation_total), `${fmtInt(m.new_mutation_killed)} killed by tests`),
      tile('alive', 'Alive mutants', fmtInt(dist.alive), `${fmtInt(dist.survived)} survived, ${fmtInt(dist.noCoverage)} no coverage`, dist.alive ? 'md-fail' : ''),
      tile('strength', 'Test strength', fmtPct(m.new_mutation_test_strength), 'killed / (killed + survived)'),
      tile('other', 'Timeout / memory / unknown', fmtInt(otherSum), 'not counted as killed')),
    h('div', { class: 'md-cards' },
      card('Weakest Files', 'files', weakest, h('p', { class: 'md-note2' }, 'Black tick on each bar = threshold.')),
      distributionCard('Mutant Distribution (changed lines)', dist)),
    card('Pull Request Details', 'details',
      h('div', { class: 'md-tabs' }, tab('files', 'Files'), tab('survivors', 'Survivors'), tab('languages', 'Languages'), tab('metrics', 'All metrics')),
      panels.files, panels.survivors, panels.languages, panels.metrics,
      legend())));
  select('files');

  async function loadFilesAndSurvivors(): Promise<void> {
    let files: FileRow[] = [];
    let survivors: SurvivorRow[] = [];
    let filesErr = '';
    let survErr = '';
    await Promise.all([
      data.loadFiles(projectKey, r.pr.key).then((x) => { files = sortFilesWeakestFirst(x); }, (e) => { filesErr = msg(e); }),
      data.loadSurvivors(projectKey, r.pr.key).then((x) => { survivors = x; }, (e) => { survErr = msg(e); }),
    ]);

    tabs.survivors.textContent = survErr ? 'Survivors' : `Survivors (${survivors.length})`;
    panels.survivors.replaceChildren(survErr ? h('p', { class: 'md-fail' }, `Could not load survivors: ${survErr}`)
      : survivors.length ? survivorTable(survivors, projectKey, r.pr.key, true) : h('p', { class: 'md-muted' }, 'No surviving mutants in the changed lines.'));

    if (filesErr) {
      weakest.replaceChildren(h('p', { class: 'md-fail' }, `Could not load files: ${filesErr}`));
      panels.files.replaceChildren(h('p', { class: 'md-fail' }, `Could not load files: ${filesErr}`));
      return;
    }
    if (files.length === 0) {
      weakest.replaceChildren(barChart([], 'No files with mutation data.'));
      panels.files.replaceChildren(h('p', { class: 'md-muted' }, 'No files with mutation data.'));
      return;
    }
    weakest.replaceChildren(barChart(
      files.filter((f) => f.score !== null).slice(0, CHART_FILES).map((f) => ({ key: f.fileKey, label: baseName(f.path), pct: f.score as number, tick: r.threshold })),
      'No scored files.'));

    let selected = files[0].fileKey;
    const right = h('div', { style: 'flex:2' });
    const table = h('tbody', {});
    const paintRight = () => {
      const f = files.find((x) => x.fileKey === selected)!;
      right.replaceChildren(h('div', { class: 'md-lbl' }, `Survivors in ${f.path}`),
        survErr ? h('p', { class: 'md-fail' }, survErr) : survivorTable(survivors.filter((s) => s.fileKey === selected), projectKey, r.pr.key, false));
    };
    const paintRows = () => table.replaceChildren(...files.map((f) =>
      h('tr', { 'data-file': f.fileKey, class: f.fileKey === selected ? 'selected' : '', style: 'cursor:pointer', onclick: () => { selected = f.fileKey; paintRows(); paintRight(); } },
        h('td', {}, f.path), h('td', {}, f.language),
        h('td', { 'data-col': 'score', class: `num ${f.score !== null && f.score < r.threshold ? 'md-fail' : ''}` }, fmtPct(f.score)),
        h('td', { 'data-col': 'alive', class: 'num' }, fmtInt(f.alive)), h('td', { class: 'num' }, fmtInt(f.changedLines)),
        h('td', { class: 'num md-muted' }, fmtPct(f.wholeFileScore)))));
    paintRows();
    paintRight();
    panels.files.replaceChildren(h('div', { class: 'md-row' },
      h('div', { style: 'flex:3' }, h('div', { class: 'md-lbl' }, 'Files - weakest first'),
        h('table', { class: 'md-table' }, h('thead', {}, h('tr', {}, ...['File', 'Lang', 'New-code score', 'Alive', 'Changed lines', 'Whole file'].map((t) => h('th', { class: ['File', 'Lang'].includes(t) ? '' : 'num' }, t)))), table)),
      right));
  }

  async function loadLanguages(): Promise<void> {
    try {
      const keys = LANGUAGES.flatMap((l) => LANG_FIELDS.map((f) => `new_mutation_${l}_${f}`));
      const v = await data.loadAllMeasures(projectKey, r.pr.key, keys);
      const langs = LANGUAGES.filter((l) => v[`new_mutation_${l}_total`] !== undefined);
      panels.languages.replaceChildren(langs.length === 0 ? h('p', { class: 'md-muted' }, 'No per-language data.')
        : h('table', { class: 'md-table' }, h('thead', {}, h('tr', {}, ...['Language', 'Mutants', 'Killed', 'Survived', 'Score'].map((t) => h('th', { class: t === 'Language' ? '' : 'num' }, t)))),
          h('tbody', {}, ...langs.map((l) => h('tr', { 'data-lang': l }, h('td', {}, l), h('td', { class: 'num' }, fmtInt(v[`new_mutation_${l}_total`])),
            h('td', { class: 'num' }, fmtInt(v[`new_mutation_${l}_killed`])), h('td', { class: 'num' }, fmtInt(v[`new_mutation_${l}_survived`])),
            h('td', { 'data-col': 'score', class: 'num' }, fmtPct(v[`new_mutation_${l}_score`])))))));
    } catch (e) {
      panels.languages.replaceChildren(h('p', { class: 'md-fail' }, `Could not load languages: ${msg(e)}`));
    }
  }

  async function loadMetrics(): Promise<void> {
    try {
      const infos = await data.loadMetrics();
      const v = await data.loadAllMeasures(projectKey, r.pr.key, infos.map((i) => i.key));
      const have = infos.filter((i) => v[i.key] !== undefined).sort((a, b) => a.key.localeCompare(b.key));
      panels.metrics.replaceChildren(have.length === 0 ? h('p', { class: 'md-muted' }, 'No mutation measures for this pull request.')
        : h('table', { class: 'md-table' }, h('thead', {}, h('tr', {}, ...['Metric', 'Key', 'Value'].map((t) => h('th', {}, t)))),
          h('tbody', {}, ...have.map((i) => h('tr', { 'data-metric': i.key, title: i.description },
            h('td', {}, i.name), h('td', { class: 'md-muted' }, i.key), h('td', { 'data-col': 'value' }, String(v[i.key])))))));
    } catch (e) {
      panels.metrics.replaceChildren(h('p', { class: 'md-fail' }, `Could not load metrics: ${msg(e)}`));
    }
  }

  void loadFilesAndSurvivors();
};

export { scoreBar };
