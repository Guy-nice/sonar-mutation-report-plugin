import { fmtInt, fmtPct } from '../format';
import { BANDS, bandLabel, bandOf, type Band, type Distribution, type Trend } from '../model';
import { h, type Child } from './dom';

export function pageHeader(title: string, subtitle: string): HTMLElement[] {
  return [h('h1', {}, title), h('p', { class: 'md-sub' }, subtitle)];
}

export function tile(name: string, label: string, value: string, sub: string, valueClass = ''): HTMLElement {
  return h('div', { class: 'md-kpi', 'data-tile': name },
    h('div', { class: 'l' }, label), h('div', { class: `v ${valueClass}` }, value), h('div', { class: 's' }, sub));
}

const TREND_VIEW: Record<Trend['direction'], { arrow: string; text: string }> = {
  improving: { arrow: '↗', text: 'Improving' },
  declining: { arrow: '↘', text: 'Declining' },
  stable: { arrow: '→', text: 'Stable' },
  unknown: { arrow: '–', text: 'No trend yet' },
};

export function trendTile(t: Trend): HTMLElement {
  const v = TREND_VIEW[t.direction];
  const sub = t.delta === null
    ? 'needs scored PRs in both halves of the window'
    : `${t.delta >= 0 ? '+' : '−'}${Math.abs(t.delta).toFixed(1)} pts vs previous 15 days`;
  return tile('trend', 'Score trend', `${v.arrow} ${v.text}`, sub, t.direction === 'declining' ? 'md-fail' : '');
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
