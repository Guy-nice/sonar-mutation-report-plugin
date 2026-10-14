import { renderOverview } from '../src/ui/overview';
import { renderProjectPage } from '../src/ui/projectPage';
import type { FileRow, SurvivorRow } from '../src/types';
import { FakeData, improved, makePr, noData, project } from '../test/fixtures';

const f = (path: string, lang: string, score: number | null, alive: number, changed: number, whole: number | null): FileRow =>
  ({ fileKey: `qa:${path}`, path, language: lang, score, alive, changedLines: changed, wholeFileScore: whole });
const s = (path: string, line: number, status: 'SURVIVED' | 'NO_COVERAGE', operator: string): SurvivorRow =>
  ({ fileKey: `qa:${path}`, path, line, status, operator });

/**
 * A PR the agent improved from `before` to `after` in `minutes`. Mutant counts follow the final score: `total` mutants,
 * the alive ones split 60/40 into survived and no coverage.
 */
const mk = (key: string, before: number, after: number, minutes: number, hours: number, title: string, portfolio: string | null, total = 80) => {
  const killed = Math.round((total * after) / 100);
  const alive = Math.max(0, total - killed - 2);
  const survived = Math.round(alive * 0.6);
  return improved(key, before, after, minutes * 60, { hours, title, portfolio, measures: {
    new_mutation_score: after, new_mutation_total: total, new_mutation_killed: killed, new_mutation_survived: survived,
    new_mutation_no_coverage: alive - survived, new_mutation_timed_out: 1, new_mutation_memory_error: 0, new_mutation_unknown: 1,
    new_mutation_test_strength: Math.round((killed / Math.max(1, killed + survived)) * 1000) / 10 } });
};
const d = 24;
const PS = 'Platform Services';
const RT = 'Routing';

const pr212 = mk('212', 58, 67, 22, 3, 'token refresh retry', RT, 127);

const data = new FakeData(
  [
    project('auth-service', [mk('301', 78, 84, 14, 30, 'session expiry', PS, 140)]),
    project('queue-manager', [pr212, mk('209', 61, 83, 17, 2 * d, 'queue priority lanes', RT, 100), mk('205', 44, 71, 29, 6 * d, 'dead-letter handling', RT, 90), mk('198', 70, 88, 12, 11 * d, 'visibility timeout fix', RT, 70), mk('194', 36, 52, 33, 16 * d, 'metrics exporter', RT, 120)]),
    project('api-gateway', [mk('88', 38, 52, 31, 28, 'rate limiter', PS, 160), mk('85', 41, 49, 26, 9 * d, 'route table', PS, 90)]),
    project('router-core', [mk('51', 30, 44, 38, 2 * d, 'matcher rewrite', RT, 150)]),
    project('storage-service', [mk('77', 55, 71, 19, 3 * d, 'blob lifecycle', PS, 110)]),
    project('rules-engine', [noData('12', 40)]),
    // an older agent: no first score, no run time, no portfolio
    project('legacy-reports', [makePr('7', { score: 91, hours: 5 * d, title: 'export fix' })]),
  ],
  { 'queue-manager#212': [f('src/utils/dates.ts', 'ts', 46.2, 14, 36, 46.2), f('src/services/pricing.ts', 'ts', 64.1, 10, 46, 64.6), f('tools/report_builder.py', 'py', 69.2, 4, 19, 68.2), f('src/main/java/com/nice/Policy.java', 'java', 80, 2, 25, 82.5), f('src/validators.ts', 'ts', 88.2, 2, 22, 88.2), f('src/api/client.ts', 'ts', 93.5, 1, 18, 91)] },
  { 'queue-manager#212': [s('src/utils/dates.ts', 7, 'SURVIVED', 'EqualityOperator'), s('src/utils/dates.ts', 12, 'NO_COVERAGE', 'BlockStatement'), s('src/utils/dates.ts', 19, 'SURVIVED', 'ConditionalExpression'), s('src/services/pricing.ts', 8, 'SURVIVED', 'ArithmeticOperator')] },
  [{ key: 'mutation_score', name: 'Mutation: Score', description: '', type: 'PERCENT' }, { key: 'new_mutation_score', name: 'Mutation: Score', description: '', type: 'PERCENT' }],
  { mutation_score: 76, new_mutation_score: 67, new_mutation_score_before: 58, mutation_run_duration: 1320, new_mutation_typescript_total: 90, new_mutation_typescript_killed: 62, new_mutation_typescript_survived: 18, new_mutation_typescript_score: 68.9, new_mutation_python_total: 19, new_mutation_python_killed: 14, new_mutation_python_survived: 4, new_mutation_python_score: 73.7, new_mutation_java_total: 18, new_mutation_java_killed: 14, new_mutation_java_survived: 2, new_mutation_java_score: 77.8 },
);

const now = () => new Date();
// The fixtures use a fixed clock in tests; here, shift dates relative to the real now.
for (const p of data.projects) for (const r of p.prs) r.pr.analysisDate = new Date(Date.now() - (Date.parse('2026-10-05T12:00:00Z') - Date.parse(r.pr.analysisDate))).toISOString();

renderOverview(document.getElementById('overview')!, data, now);
void renderProjectPage(document.getElementById('project')!, data, { kind: 'project', project: 'queue-manager' }, now);
void renderProjectPage(document.getElementById('detail')!, data, { kind: 'pr', project: 'queue-manager', pr: '212' }, now);
