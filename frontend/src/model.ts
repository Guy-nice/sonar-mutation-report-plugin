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

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export interface ProjectSummary {
  key: string;
  name: string;
  error: string | null;
  /** PRs analyzed in the window. */
  total: number;
  /** PRs in the window with mutation data. */
  withData: number;
  failingOpen: number;
  passRate: number | null;
  medianScore: number | null;
  latest: PrResult | null;
}

export function summarizeProject(res: ProjectResult, now: Date): ProjectSummary {
  const prs = res.prs.filter((r) => inWindow(r, now));
  const withData = prs.filter((r) => r.hasData);
  const scored = withData.filter((r) => r.score !== null);
  const passing = scored.filter(isPassing).length;
  const latest = [...prs].sort((a, b) => b.pr.analysisDate.localeCompare(a.pr.analysisDate))[0] ?? null;
  return {
    key: res.project.key,
    name: res.project.name,
    error: res.error,
    total: prs.length,
    withData: withData.length,
    failingOpen: prs.filter((r) => isFailing(r) && isOpen(r, now)).length,
    passRate: scored.length ? (passing / scored.length) * 100 : null,
    medianScore: median(scored.map((r) => r.score as number)),
    latest,
  };
}

export interface OverviewSummary {
  failingOpen: number;
  passRate: number | null;
  projectsWithData: number;
  projectsTotal: number;
  medianScore: number | null;
}

export function summarizeOverview(results: ProjectResult[], now: Date): OverviewSummary {
  const ok = results.filter((r) => !r.error);
  const prs = ok.flatMap((r) => r.prs.filter((p) => inWindow(p, now)));
  const withData = prs.filter((p) => p.hasData);
  const scored = withData.filter((p) => p.score !== null);
  const passing = scored.filter(isPassing).length;
  return {
    failingOpen: prs.filter((p) => isFailing(p) && isOpen(p, now)).length,
    passRate: scored.length ? (passing / scored.length) * 100 : null,
    projectsWithData: ok.filter((r) => r.prs.some((p) => inWindow(p, now) && p.hasData)).length,
    projectsTotal: results.length,
    medianScore: median(scored.map((p) => p.score as number)),
  };
}

export type SortKey = 'name' | 'failingOpen' | 'passRate' | 'medianScore' | 'adoption' | 'latest';
export type SortDir = 'asc' | 'desc';

function sortValue(s: ProjectSummary, key: SortKey): number | string | null {
  switch (key) {
    case 'name': return s.name.toLowerCase();
    case 'failingOpen': return s.failingOpen;
    case 'passRate': return s.passRate;
    case 'medianScore': return s.medianScore;
    case 'adoption': return s.total ? s.withData / s.total : 0;
    case 'latest': return s.latest ? s.latest.pr.analysisDate : null;
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
