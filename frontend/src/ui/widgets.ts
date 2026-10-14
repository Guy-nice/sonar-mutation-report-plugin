import { fmtDuration, fmtInt, fmtPct, fmtPts } from '../format';
import { BANDS, bandLabel, bandOf, hasBefore, isFailing, isOpen, isPassing, lastUpdated, mean, wasPassing, type Band, type Distribution } from '../model';
import type { PrResult } from '../types';
import { h, type Child } from './dom';

/** Title and subtitle, the same on every page. `facts` are extra subtitle parts, e.g. "5 of 6 projects use mutation". */
export function pageHeader(title: string, prs: PrResult[], ...facts: string[]): HTMLElement[] {
  const updated = lastUpdated(prs.filter((r) => r.hasData));
  const parts = ['Mutation Score Dashboard', ...(updated ? [`Last updated: ${updated}`] : []), ...facts];
  return [h('h1', {}, title), h('p', { class: 'md-sub' }, parts.join(' \u2022 '))];
}

export const DISTRIBUTION_TITLE = 'Mutant Distribution (last 30 days)';

const kids = (c: Child | Child[]): Child[] => (Array.isArray(c) ? c : [c]);

export function tile(name: string, label: string, value: Child | Child[], sub: Child | Child[], valueClass = ''): HTMLElement {
  return h('div', { class: 'md-kpi', 'data-tile': name },
    h('div', { class: 'l' }, label), h('div', { class: `v ${valueClass}` }, ...kids(value)), h('div', { class: 's' }, ...kids(sub)));
}

/** "52% -> 64%" with the after value colored by its direction, or "-" when no PR carries both scores. */
function improvementTile(prs: PrResult[]): HTMLElement {
  const both = prs.filter(hasBefore);
  const before = mean(both.map((r) => r.scoreBefore as number));
  const after = mean(both.map((r) => r.score as number));
  if (before === null || after === null) {
    return tile('improvement', 'Score before → after agent', '-', 'needs PRs from an agent that reports the first score');
  }
  return tile('improvement', 'Score before → after agent',
    [fmtPct(before, 0), h('span', { class: 'md-arrow' }, '→'), h('span', { class: after >= before ? 'md-pass' : 'md-fail' }, fmtPct(after, 0))],
    [h('span', { class: after >= before ? 'md-pass' : 'md-fail' }, `${fmtPts(after - before)} pts`), ` average over ${both.length} PRs`]);
}

/** Time of the agent runs. Only PRs that report a duration count; the sub line says how many. */
function durationTile(prs: PrResult[]): HTMLElement {
  const timed = prs.filter((r) => r.hasData && r.durationSec !== null).map((r) => r.durationSec as number);
  const total = timed.reduce((a, v) => a + v, 0);
  const avg = mean(timed);
  return tile('duration', 'Time to test and fix', timed.length ? fmtDuration(total) : '-',
    timed.length ? `average ${fmtDuration(avg)} per PR (${timed.length} PRs)` : 'needs PRs from an agent that reports its run time');
}

/** The four tiles on the overview and on every project page. `prs` are the PRs in the 30 day window. */
export function summaryTiles(prs: PrResult[], now: Date): HTMLElement {
  const scored = prs.filter((r) => r.hasData && r.score !== null);
  const passing = scored.filter(isPassing).length;
  const failing = prs.filter((r) => isFailing(r) && isOpen(r, now)).length;
  const withBefore = scored.filter(hasBefore);
  // "was" only when every scored PR has a first score: otherwise the two fractions would not compare.
  const was = withBefore.length === scored.length && scored.length > 0 ? ` (was ${withBefore.filter(wasPassing).length} / ${scored.length})` : '';
  return h('div', { class: 'md-kpis' },
    improvementTile(prs),
    tile('failingOpen', 'Open PRs failing now', String(failing), 'below the threshold', failing ? 'md-fail' : ''),
    tile('passRate', 'PR pass rate', fmtPct(scored.length ? (passing / scored.length) * 100 : null, 0), `${passing} / ${scored.length} PRs${was}`),
    durationTile(prs));
}

export interface PairRow {
  label: string;
  /** Score before the agent; null when not reported. */
  before: number | null;
  after: number;
  /** Threshold mark, in percent. */
  tick: number;
  key?: string;
}

/** Two bars per row: the first run in grey, the final result in its score-band color. */
export function pairedBarChart(rows: PairRow[], emptyText: string): HTMLElement {
  if (rows.length === 0) return h('p', { class: 'md-empty' }, emptyText);
  const clamp = (n: number) => Math.max(0, Math.min(100, n));
  const track = (kind: string, pct: number | null, tick: number) => h('span', { class: `md-track ${kind}` },
    pct === null ? null : h('i', { class: `md-fill ${kind === 'after' ? bandOf(pct) ?? '' : ''}`, style: `width:${clamp(pct)}%` }),
    h('b', { class: 'md-tick', style: `left:${clamp(tick)}%` }));
  return h('div', {},
    h('div', { class: 'md-pair' }, ...rows.map((r) =>
      h('div', { class: 'md-pr', 'data-bar': r.key ?? r.label },
        h('span', { class: 'n', title: r.label }, r.label),
        h('div', { class: 'tr' }, track('before', r.before, r.tick), track('after', r.after, r.tick)),
        h('span', { class: 'p' }, h('span', { class: 'was' }, r.before === null ? '-' : fmtPct(r.before, 0)), ' → ', fmtPct(r.after, 0))))),
    h('div', { class: 'md-key' },
      h('span', {}, h('i', { class: 'before' }), 'Before agent'), h('span', {}, h('i', { class: 'after' }), 'After agent'),
      h('span', {}, h('b', {}), 'Threshold')));
}

/** "Fail -> Pass": the quality gate before and after the agent. Unknown sides show "-". */
export function gateChange(before: boolean | null, after: boolean | null): HTMLElement {
  const word = (v: boolean | null) => (v === null ? '-' : v ? 'Pass' : 'Fail');
  return h('span', { class: 'md-gate' },
    h('span', { class: 'a' }, word(before)), h('span', { class: 'arr' }, '→'),
    h('span', { class: `b ${after === null ? '' : after ? 'ok' : 'bad'}` }, word(after)));
}

/** Signed point change with an arrow, green up and red down; "-" when unknown. */
export function changeCell(pts: number | null): HTMLElement {
  if (pts === null) return h('span', { class: 'md-muted' }, '-');
  return h('span', { class: pts >= 0 ? 'md-up' : 'md-dn' }, `${pts >= 0 ? '▲' : '▼'} ${fmtPts(pts)}`);
}

export function card(title: string, name: string, ...children: Child[]): HTMLElement {
  return h('section', { class: 'md-card', 'data-card': name }, h('h2', {}, title), ...children);
}

export interface BarRow {
  label: string;
  pct: number;
  /** Threshold mark, in percent. */
  tick?: number;
  key?: string;
}

/** Horizontal bars; each bar is colored by the score band of its value. */
export function barChart(rows: BarRow[], emptyText: string): HTMLElement {
  if (rows.length === 0) return h('p', { class: 'md-empty' }, emptyText);
  return h('div', { class: 'md-hbars' }, ...rows.map((r) =>
    h('div', { class: 'md-hbar', 'data-bar': r.key ?? r.label },
      h('span', { class: 'n', title: r.label }, r.label),
      h('span', { class: 'md-track' },
        h('i', { class: `md-fill ${bandOf(r.pct) ?? ''}`, style: `width:${Math.max(0, Math.min(100, r.pct))}%` }),
        r.tick === undefined ? null : h('b', { class: 'md-tick', style: `left:${Math.max(0, Math.min(100, r.tick))}%` })),
      h('span', { class: 'p' }, fmtPct(r.pct, 0)))));
}

export function distributionCard(title: string, d: Distribution, emptyText = 'No mutants analyzed yet.'): HTMLElement {
  if (d.killed + d.alive === 0) return card(title, 'distribution', h('p', { class: 'md-empty' }, emptyText));
  const killed = d.killedPct as number;
  const alive = 100 - killed;
  return card(title, 'distribution',
    h('div', { class: 'md-dist' },
      h('div', {}, h('div', { class: 'big ok', 'data-part': 'killed' }, fmtInt(d.killed)), h('div', { class: 'cap' }, 'Killed mutants')),
      h('div', {}, h('div', { class: 'big bad', 'data-part': 'alive' }, fmtInt(d.alive)),
        h('div', { class: 'cap' }, `Alive mutants (${fmtInt(d.survived)} survived, ${fmtInt(d.noCoverage)} no coverage)`))),
    h('div', { class: 'md-split' }, h('i', { class: 'ok', style: `width:${killed}%` }), h('i', { class: 'bad', style: `width:${alive}%` })),
    h('div', { class: 'md-splitcap' }, h('span', {}, `${killed.toFixed(0)}% killed`), h('span', {}, `${alive.toFixed(0)}% alive`)),
    d.other > 0 ? h('p', { class: 'md-note2' }, `${fmtInt(d.other)} more timed out, hit a memory error or have unknown status (not in the bar).`) : null);
}

export function bandPill(score: number | null): HTMLElement {
  const b = bandOf(score);
  return b ? h('span', { class: `md-pill ${b}`, 'data-band': b }, bandLabel(b)) : h('span', { class: 'md-pill none' }, 'No data');
}

export function legend(): HTMLElement {
  return h('div', { class: 'md-legend' }, ...BANDS.map((b) =>
    h('span', {}, h('i', { class: b.band as Band }), `${b.label} (${b.range})`)));
}
