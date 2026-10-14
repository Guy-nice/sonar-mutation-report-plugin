import type { FileRow, PrResult, ProjectResult } from './types';

export const WINDOW_DAYS = 30;
export const OPEN_WINDOW_DAYS = 7;
const DAY_MS = 86_400_000;

export function ageDays(iso: string, now: Date): number {
  return (now.getTime() - new Date(iso).getTime()) / DAY_MS;
}

/** Negative ages (clock skew) count as inside the window. Unparseable dates are outside it. */
export function inWindow(r: PrResult, now: Date): boolean {
  const age = ageDays(r.pr.analysisDate, now);
  return Number.isNaN(age) ? false : age <= WINDOW_DAYS;
}

/** Sonar does not reliably expose open vs merged: open means analyzed recently. */
export function isOpen(r: PrResult, now: Date): boolean {
  const age = ageDays(r.pr.analysisDate, now);
  return !Number.isNaN(age) && age <= OPEN_WINDOW_DAYS;
}

export function isFailing(r: PrResult): boolean {
  return r.hasData && r.score !== null && r.score < r.threshold;
}

export function isPassing(r: PrResult): boolean {
  return r.hasData && r.score !== null && r.score >= r.threshold;
}

/** True when the list endpoint 404s: the server has no pull request analysis (needs Developer Edition or higher). */
export function isNoPrAnalysis(error: string | null): boolean {
  return error !== null && /HTTP 404 \/api\/project_pull_requests\/list/.test(error);
}

export function mean(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((a, v) => a + v, 0) / values.length;
}

/** A scored PR that also carries the score of its first run, so the effect of the agent can be shown. */
export function hasBefore(r: PrResult): boolean {
  return r.hasData && r.score !== null && r.scoreBefore !== null;
}

/** New-code score after minus before, in points. Null when either is unknown. */
export function change(r: PrResult): number | null {
  return hasBefore(r) ? (r.score as number) - (r.scoreBefore as number) : null;
}

export function wasPassing(r: PrResult): boolean {
  return hasBefore(r) && (r.scoreBefore as number) >= r.threshold;
}

export interface ProjectSummary {
  key: string;
  name: string;
  error: string | null;
  /** PRs analyzed in the window. */
  total: number;
  /** PRs in the window with mutation data. */
  withData: number;
  /** The most recent PR with mutation data: the component row shows its numbers. */
  scanned: PrResult | null;
  /** Group of the component (sonar.mutation.portfolio) as seen on that PR. */
  portfolio: string | null;
  before: number | null;
  after: number | null;
  change: number | null;
  /** ISO date of the last scan. */
  scanDate: string | null;
  durationSec: number | null;
}

export function summarizeProject(res: ProjectResult, now: Date): ProjectSummary {
  const prs = res.prs.filter((r) => inWindow(r, now));
  const withData = prs.filter((r) => r.hasData);
  const scanned = [...withData].sort((a, b) => b.pr.analysisDate.localeCompare(a.pr.analysisDate))[0] ?? null;
  return {
    key: res.project.key,
    name: res.project.name,
    error: res.error,
    total: prs.length,
    withData: withData.length,
    scanned,
    portfolio: scanned?.portfolio ?? null,
    before: scanned?.scoreBefore ?? null,
    after: scanned?.score ?? null,
    change: scanned ? change(scanned) : null,
    scanDate: scanned?.pr.analysisDate ?? null,
    durationSec: scanned?.durationSec ?? null,
  };
}

/** Quality gate of a component's last scan before and after the agent. Null = unknown. */
export function gateOf(s: ProjectSummary): { before: boolean | null; after: boolean | null } {
  const r = s.scanned;
  if (!r || r.score === null) return { before: null, after: null };
  return { before: hasBefore(r) ? wasPassing(r) : null, after: isPassing(r) };
}

export interface OverviewSummary {
  projectsWithData: number;
  projectsTotal: number;
}

export function summarizeOverview(results: ProjectResult[], now: Date): OverviewSummary {
  const ok = results.filter((r) => !r.error);
  return {
    projectsWithData: ok.filter((r) => r.prs.some((p) => inWindow(p, now) && p.hasData)).length,
    projectsTotal: results.length,
  };
}

export type SortKey = 'name' | 'portfolio' | 'before' | 'after' | 'change' | 'scan' | 'time';
export type SortDir = 'asc' | 'desc';

function sortValue(s: ProjectSummary, key: SortKey): number | string | null {
  switch (key) {
    case 'name': return s.name.toLowerCase();
    case 'portfolio': return s.portfolio === null ? null : s.portfolio.toLowerCase();
    case 'before': return s.before;
    case 'after': return s.after;
    case 'change': return s.change;
    case 'scan': return s.scanDate;
    case 'time': return s.durationSec;
  }
}

/** Projects without mutation data (or errored) always sort last, whatever the direction. Ties by name. */
export function sortProjects(list: ProjectSummary[], key: SortKey, dir: SortDir): ProjectSummary[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...list].sort((a, b) => {
    const aEmpty = a.withData === 0 || a.error !== null;
    const bEmpty = b.withData === 0 || b.error !== null;
    if (key !== 'name' && aEmpty !== bEmpty) return aEmpty ? 1 : -1;
    const av = sortValue(a, key);
    const bv = sortValue(b, key);
    if (av !== bv && av !== null && bv !== null) return (av < bv ? -1 : 1) * sign;
    if (av !== bv && (av === null || bv === null)) return av === null ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
}

export function sortFilesWeakestFirst(files: FileRow[]): FileRow[] {
  return [...files].sort((a, b) => {
    if (a.score === b.score) return a.path.localeCompare(b.path);
    if (a.score === null) return 1;
    if (b.score === null) return -1;
    return a.score - b.score;
  });
}

export type Band = 'excellent' | 'good' | 'fair' | 'needs';

export const BANDS: Array<{ band: Band; label: string; range: string; min: number }> = [
  { band: 'excellent', label: 'Excellent', range: '90%+', min: 90 },
  { band: 'good', label: 'Good', range: '85–89%', min: 85 },
  { band: 'fair', label: 'Fair', range: '75–84%', min: 75 },
  { band: 'needs', label: 'Needs Work', range: '<75%', min: -Infinity },
];

/** Presentation band of a mutation score. This is not the quality gate: the gate is the per-project threshold. */
export function bandOf(score: number | null | undefined): Band | null {
  if (score === null || score === undefined || Number.isNaN(score)) return null;
  return (BANDS.find((b) => score >= b.min) as (typeof BANDS)[number]).band;
}

export function bandLabel(band: Band): string {
  return (BANDS.find((b) => b.band === band) as (typeof BANDS)[number]).label;
}

export interface Distribution {
  killed: number;
  survived: number;
  noCoverage: number;
  /** timeout + memory error + unknown: neither killed nor alive in the bar. */
  other: number;
  /** survived + no coverage. */
  alive: number;
  /** Share of killed among killed + alive, in percent. Null when both are zero. */
  killedPct: number | null;
}

export function distribution(prs: PrResult[]): Distribution {
  let killed = 0;
  let survived = 0;
  let noCoverage = 0;
  let other = 0;
  for (const r of prs) {
    if (!r.hasData) continue;
    const m = r.measures;
    killed += m.new_mutation_killed ?? 0;
    survived += m.new_mutation_survived ?? 0;
    noCoverage += m.new_mutation_no_coverage ?? 0;
    other += (m.new_mutation_timed_out ?? 0) + (m.new_mutation_memory_error ?? 0) + (m.new_mutation_unknown ?? 0);
  }
  const alive = survived + noCoverage;
  return { killed, survived, noCoverage, other, alive, killedPct: killed + alive > 0 ? (killed / (killed + alive)) * 100 : null };
}

/** Date (YYYY-MM-DD) of the most recent analysis, or null when there is none. */
export function lastUpdated(prs: PrResult[]): string | null {
  const times = prs.map((r) => new Date(r.pr.analysisDate).getTime()).filter((t) => !Number.isNaN(t));
  return times.length ? new Date(Math.max(...times)).toISOString().slice(0, 10) : null;
}
