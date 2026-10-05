export const DEFAULT_THRESHOLD = 80;

export interface ProjectRef {
  key: string;
  name: string;
}

export interface PullRequestRef {
  key: string;
  title: string;
  branch: string;
  base: string;
  analysisDate: string;
}

export interface PrResult {
  pr: PullRequestRef;
  /** The PR was analyzed with a mutation report (any mutation measure exists). */
  hasData: boolean;
  /** new_mutation_score, or null when absent. */
  score: number | null;
  threshold: number;
  /** True when mutation_threshold was missing and DEFAULT_THRESHOLD was used. */
  thresholdAssumed: boolean;
  measures: Record<string, number>;
}

export interface ProjectResult {
  project: ProjectRef;
  prs: PrResult[];
  /** Set when loading this project failed; prs is then empty. */
  error: string | null;
}

export interface MetricInfo {
  key: string;
  name: string;
  description: string;
  type: string;
}

export interface FileRow {
  fileKey: string;
  path: string;
  language: string;
  score: number | null;
  alive: number;
  changedLines: number | null;
  wholeFileScore: number | null;
}

export interface SurvivorRow {
  fileKey: string;
  path: string;
  line: number;
  status: 'SURVIVED' | 'NO_COVERAGE';
  operator: string;
}

/** Everything the UI needs from Sonar. The only implementation that touches the network is SonarApi. */
export interface DataSource {
  listProjects(): Promise<ProjectRef[]>;
  /** Never rejects: a failure becomes ProjectResult.error. */
  loadProject(project: ProjectRef): Promise<ProjectResult>;
  loadPullRequest(projectKey: string, prKey: string): Promise<PrResult | null>;
  loadFiles(projectKey: string, prKey: string): Promise<FileRow[]>;
  loadSurvivors(projectKey: string, prKey: string): Promise<SurvivorRow[]>;
  loadMetrics(): Promise<MetricInfo[]>;
  loadAllMeasures(projectKey: string, prKey: string, metricKeys: string[]): Promise<Record<string, number>>;
  clearCache(): void;
}
