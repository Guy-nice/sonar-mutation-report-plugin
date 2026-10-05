import type { DataSource, FileRow, MetricInfo, PrResult, ProjectRef, ProjectResult, SurvivorRow } from '../src/types';

export const NOW = new Date('2026-10-05T12:00:00Z');

export function hoursAgo(h: number): string {
  return new Date(NOW.getTime() - h * 3_600_000).toISOString();
}

export function makePr(key: string, over: Partial<PrResult> & { hours?: number; title?: string } = {}): PrResult {
  const { hours = 3, title = `PR ${key}`, ...rest } = over;
  return {
    pr: { key, title, branch: `feature/${key}`, base: 'main', analysisDate: hoursAgo(hours) },
    hasData: true,
    score: 85,
    threshold: 80,
    thresholdAssumed: false,
    measures: { new_mutation_score: 85, new_mutation_total: 40, new_mutation_killed: 34, new_mutation_survived: 4, new_mutation_no_coverage: 2 },
    ...rest,
  };
}

export function noData(key: string, hours = 3): PrResult {
  return makePr(key, { hours, hasData: false, score: null, measures: {} });
}

export class FakeData implements DataSource {
  calls: string[] = [];
  constructor(
    public projects: ProjectResult[],
    public files: Record<string, FileRow[]> = {},
    public survivors: Record<string, SurvivorRow[]> = {},
    public metrics: MetricInfo[] = [],
    public allMeasures: Record<string, number> = {},
  ) {}
  async listProjects(): Promise<ProjectRef[]> {
    this.calls.push('listProjects');
    return this.projects.map((p) => p.project);
  }
  async loadProject(project: ProjectRef): Promise<ProjectResult> {
    this.calls.push(`loadProject:${project.key}`);
    return this.projects.find((p) => p.project.key === project.key)!;
  }
  async loadPullRequest(projectKey: string, prKey: string): Promise<PrResult | null> {
    const p = this.projects.find((x) => x.project.key === projectKey);
    return p?.prs.find((r) => r.pr.key === prKey) ?? null;
  }
  async loadFiles(projectKey: string, prKey: string): Promise<FileRow[]> {
    return this.files[`${projectKey}#${prKey}`] ?? [];
  }
  async loadSurvivors(projectKey: string, prKey: string): Promise<SurvivorRow[]> {
    return this.survivors[`${projectKey}#${prKey}`] ?? [];
  }
  async loadMetrics(): Promise<MetricInfo[]> {
    return this.metrics;
  }
  async loadAllMeasures(): Promise<Record<string, number>> {
    return this.allMeasures;
  }
  clearCache(): void {
    this.calls.push('clearCache');
  }
}

export function project(key: string, prs: PrResult[], error: string | null = null): ProjectResult {
  return { project: { key, name: key }, prs, error };
}
