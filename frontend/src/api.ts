import { sonarBase } from './format';
import {
  DEFAULT_THRESHOLD, type DataSource, type FileRow, type MetricInfo, type PrResult, type ProjectRef, type ProjectResult,
  type PullRequestRef, type SurvivorRow,
} from './types';

export const MAX_CONCURRENCY = 6;
export const CACHE_TTL_MS = 5 * 60_000;
export const PAGE_SIZE = 500;
export const MAX_METRIC_KEYS = 50;
export const SURVIVOR_RULES = 'external_mutation-report:survived,external_mutation-report:no-coverage';
export const PR_METRICS = [
  'new_mutation_score', 'mutation_threshold', 'new_mutation_total', 'new_mutation_killed', 'new_mutation_survived',
  'new_mutation_no_coverage', 'new_mutation_timed_out', 'new_mutation_memory_error', 'new_mutation_unknown',
  'new_mutation_test_strength',
];
const FILE_METRICS = ['new_mutation_score', 'new_mutation_alive', 'new_mutation_lines', 'mutation_score', 'new_mutation_total'];
const MUTATION_DOMAIN = 'Mutation Analysis';

type Params = Record<string, string | number | undefined>;
interface RawMeasure { metric: string; value?: string; period?: { value?: string } }

export function toMeasureMap(measures: RawMeasure[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of measures) {
    const raw = m.value ?? m.period?.value;
    if (raw === undefined) continue;
    const n = Number.parseFloat(raw);
    if (!Number.isNaN(n)) out[m.metric] = n;
  }
  return out;
}

export function parseOperator(message: string): string {
  const a = /detect the (\S+) mutation/.exec(message);
  if (a) return a[1];
  const b = /\((\S+) mutant not executed\)/.exec(message);
  return b ? b[1] : '';
}

class HttpError extends Error {
  constructor(public status: number, path: string) {
    super(`HTTP ${status} ${path}`);
  }
}

export class SonarApi implements DataSource {
  private cache = new Map<string, { at: number; value: Promise<unknown> }>();
  private active = 0;
  private queue: Array<() => void> = [];

  constructor(
    private fetchFn: typeof fetch = (...args) => fetch(...args),
    private now: () => number = Date.now,
    private baseUrl: string = sonarBase(),
  ) {}

  clearCache(): void {
    this.cache.clear();
  }

  /** Counting semaphore with direct hand-off, so the cap is never exceeded. */
  private async slot<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= MAX_CONCURRENCY) await new Promise<void>((resolve) => this.queue.push(resolve));
    else this.active++;
    try {
      return await fn();
    } finally {
      const next = this.queue.shift();
      if (next) next();
      else this.active--;
    }
  }

  private get<T>(path: string, params: Params): Promise<T> {
    const qs = Object.entries(params)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
    const url = `${this.baseUrl}${path}?${qs}`;
    const hit = this.cache.get(url);
    if (hit && this.now() - hit.at < CACHE_TTL_MS) return hit.value as Promise<T>;
    const value = this.slot(async () => {
      const res = await this.fetchFn(url, { credentials: 'same-origin' });
      if (!res.ok) throw new HttpError(res.status, path);
      return (await res.json()) as T;
    });
    this.cache.set(url, { at: this.now(), value });
    value.catch(() => this.cache.delete(url));
    return value;
  }

  private async all<T, R>(path: string, params: Params, pick: (r: R) => T[]): Promise<T[]> {
    const out: T[] = [];
    for (let p = 1; ; p++) {
      const r = await this.get<R & { paging?: { total?: number } }>(path, { ...params, ps: PAGE_SIZE, p });
      const items = pick(r);
      out.push(...items);
      const total = r.paging?.total ?? out.length;
      if (items.length === 0 || out.length >= total) break;
    }
    return out;
  }

  async listProjects(): Promise<ProjectRef[]> {
    const items = await this.all<{ key: string; name: string }, { components: { key: string; name: string }[] }>(
      '/api/components/search', { qualifiers: 'TRK' }, (r) => r.components ?? []);
    return items.map((c) => ({ key: c.key, name: c.name }));
  }

  private async pullRequests(projectKey: string): Promise<PullRequestRef[]> {
    const r = await this.get<{ pullRequests?: Array<{ key: string; title?: string; branch?: string; base?: string; target?: string; analysisDate?: string }> }>(
      '/api/project_pull_requests/list', { project: projectKey });
    return (r.pullRequests ?? []).map((p) => ({
      key: p.key, title: p.title ?? '', branch: p.branch ?? '', base: p.base ?? p.target ?? '', analysisDate: p.analysisDate ?? '',
    }));
  }

  private async measures(component: string, prKey: string, keys: string[]): Promise<Record<string, number>> {
    const r = await this.get<{ component?: { measures?: RawMeasure[] } }>('/api/measures/component', {
      component, pullRequest: prKey, metricKeys: keys.join(','),
    });
    return toMeasureMap(r.component?.measures ?? []);
  }

  private async prResult(projectKey: string, pr: PullRequestRef): Promise<PrResult> {
    let measures: Record<string, number> = {};
    try {
      measures = await this.measures(projectKey, pr.key, PR_METRICS);
    } catch (e) {
      if (!(e instanceof HttpError && e.status === 404)) throw e; // no analysis data for this PR: treat as no data
    }
    const score = measures.new_mutation_score ?? null;
    const hasData = Object.keys(measures).some((k) => k.includes('mutation'));
    const hasThreshold = measures.mutation_threshold !== undefined;
    return {
      pr, hasData, score, measures,
      threshold: hasThreshold ? measures.mutation_threshold : DEFAULT_THRESHOLD,
      thresholdAssumed: !hasThreshold,
    };
  }

  async loadProject(project: ProjectRef): Promise<ProjectResult> {
    try {
      const prs = await this.pullRequests(project.key);
      const results = await Promise.all(prs.map((p) => this.prResult(project.key, p)));
      return { project, prs: results, error: null };
    } catch (e) {
      return { project, prs: [], error: e instanceof Error ? e.message : String(e) };
    }
  }

  async loadPullRequest(projectKey: string, prKey: string): Promise<PrResult | null> {
    const pr = (await this.pullRequests(projectKey)).find((p) => p.key === prKey);
    return pr ? this.prResult(projectKey, pr) : null;
  }

  async loadFiles(projectKey: string, prKey: string): Promise<FileRow[]> {
    type Comp = { key: string; path?: string; name?: string; language?: string; measures?: RawMeasure[] };
    const comps = await this.all<Comp, { components: Comp[] }>(
      '/api/measures/component_tree',
      { component: projectKey, pullRequest: prKey, qualifiers: 'FIL', metricKeys: FILE_METRICS.join(',') },
      (r) => r.components ?? []);
    const rows: FileRow[] = [];
    for (const c of comps) {
      const m = toMeasureMap(c.measures ?? []);
      if (m.new_mutation_total === undefined && m.new_mutation_score === undefined) continue;
      rows.push({
        fileKey: c.key, path: c.path ?? c.name ?? c.key, language: c.language ?? '',
        score: m.new_mutation_score ?? null, alive: m.new_mutation_alive ?? 0,
        changedLines: m.new_mutation_lines ?? null, wholeFileScore: m.mutation_score ?? null,
      });
    }
    return rows;
  }

  async loadSurvivors(projectKey: string, prKey: string): Promise<SurvivorRow[]> {
    type Issue = { component: string; line?: number; rule: string; message?: string };
    const paths = new Map<string, string>();
    const issues = await this.all<Issue, { issues: Issue[]; components?: Array<{ key: string; path?: string }> }>(
      '/api/issues/search',
      { componentKeys: projectKey, pullRequest: prKey, rules: SURVIVOR_RULES },
      (r) => {
        for (const c of r.components ?? []) if (c.path) paths.set(c.key, c.path);
        return r.issues ?? [];
      });
    return issues
      .filter((i) => i.line !== undefined)
      .map((i): SurvivorRow => ({
        fileKey: i.component,
        path: paths.get(i.component) ?? i.component,
        line: i.line as number,
        status: i.rule.endsWith(':no-coverage') ? 'NO_COVERAGE' : 'SURVIVED',
        operator: parseOperator(i.message ?? ''),
      }))
      .sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
  }

  async loadMetrics(): Promise<MetricInfo[]> {
    const r = await this.all<{ key: string; name: string; description?: string; type: string; domain?: string }, { metrics: Array<{ key: string; name: string; description?: string; type: string; domain?: string }> }>(
      '/api/metrics/search', {}, (x) => x.metrics ?? []);
    return r.filter((m) => m.domain === MUTATION_DOMAIN).map((m) => ({ key: m.key, name: m.name, description: m.description ?? '', type: m.type }));
  }

  async loadAllMeasures(projectKey: string, prKey: string, metricKeys: string[]): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (let i = 0; i < metricKeys.length; i += MAX_METRIC_KEYS) {
      Object.assign(out, await this.measures(projectKey, prKey, metricKeys.slice(i, i + MAX_METRIC_KEYS)));
    }
    return out;
  }
}
