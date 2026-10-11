import { renderOverview } from '../src/ui/overview';
import { renderProjectPage } from '../src/ui/projectPage';
import type { FileRow, SurvivorRow } from '../src/types';
import { FakeData, makePr, noData, project } from '../test/fixtures';

const f = (path: string, lang: string, score: number | null, alive: number, changed: number, whole: number | null): FileRow =>
  ({ fileKey: `qa:${path}`, path, language: lang, score, alive, changedLines: changed, wholeFileScore: whole });
const s = (path: string, line: number, status: 'SURVIVED' | 'NO_COVERAGE', operator: string): SurvivorRow =>
  ({ fileKey: `qa:${path}`, path, line, status, operator });

/** A PR whose counts follow its score: total mutants `total`, the alive ones split 60/40 into survived and no coverage. */
const mk = (key: string, score: number, hours: number, title: string, total = 80) => {
  const killed = Math.round((total * score) / 100);
  const alive = Math.max(0, total - killed - 2);
  const survived = Math.round(alive * 0.6);
  return makePr(key, { score, hours, title, measures: {
    new_mutation_score: score, new_mutation_total: total, new_mutation_killed: killed, new_mutation_survived: survived,
    new_mutation_no_coverage: alive - survived, new_mutation_timed_out: 1, new_mutation_memory_error: 0, new_mutation_unknown: 1,
    new_mutation_test_strength: Math.round((killed / Math.max(1, killed + survived)) * 1000) / 10 } });
};
const d = 24;

const pr14 = makePr('14', { score: 70.9, hours: 3, title: 'pricing rules refactor', measures: {
  new_mutation_score: 70.9, new_mutation_total: 127, new_mutation_killed: 90, new_mutation_survived: 19, new_mutation_no_coverage: 12,
  new_mutation_timed_out: 3, new_mutation_memory_error: 2, new_mutation_unknown: 1, new_mutation_test_strength: 82.6 } });

const data = new FakeData(
  [
    project('timeoff-webapp', [mk('1', 60, 2, 'holiday calendar', 90), mk('2', 65, 5, 'approval flow', 70), mk('3', 66, 8, 'balance rules', 60), mk('4', 72, 20 * d, 'ui polish', 50), mk('5', 70, 24 * d, 'a11y fixes', 40), noData('6', 90)]),
    project('scheduler-api', [mk('7', 76, 26, 'retry policy', 120), mk('8', 70, 30, 'slot allocator', 100), mk('9', 68, 18 * d, 'cron parser', 60)]),
    project('qa-rm-testing-gates', [pr14, mk('13', 84, 30, 'date helpers', 60), mk('12', 91.2, 50, 'validator edge cases', 70), mk('11', 80, 96, 'parser cleanup', 50), mk('10', 82.6, 216, 'Stryker gate', 60), mk('9', 72, 22 * d, 'legacy cleanup', 60)]),
    project('policy-engine', [mk('20', 91, 5, 'rule compiler', 150), mk('21', 85, 50, 'explain output', 90), mk('22', 80, 16 * d, 'schema v2', 80)]),
    project('core-services', [mk('40', 94, 12, 'auth hardening', 200), mk('41', 92, 70, 'token cache', 110), mk('42', 84, 19 * d, 'pagination', 90)]),
    project('billing-ui', [noData('30'), noData('31')]),
  ],
  { 'qa-rm-testing-gates#14': [f('src/utils/dates.ts', 'ts', 46.2, 14, 36, 46.2), f('src/services/pricing.ts', 'ts', 64.1, 10, 46, 64.6), f('tools/report_builder.py', 'py', 69.2, 4, 19, 68.2), f('src/main/java/com/nice/Policy.java', 'java', 80, 2, 25, 82.5), f('src/validators.ts', 'ts', 88.2, 2, 22, 88.2), f('src/api/client.ts', 'ts', 93.5, 1, 18, 91)] },
  { 'qa-rm-testing-gates#14': [s('src/utils/dates.ts', 7, 'SURVIVED', 'EqualityOperator'), s('src/utils/dates.ts', 12, 'NO_COVERAGE', 'BlockStatement'), s('src/utils/dates.ts', 19, 'SURVIVED', 'ConditionalExpression'), s('src/services/pricing.ts', 8, 'SURVIVED', 'ArithmeticOperator')] },
  [{ key: 'mutation_score', name: 'Mutation: Score', description: '', type: 'PERCENT' }, { key: 'new_mutation_score', name: 'Mutation: Score', description: '', type: 'PERCENT' }],
  { mutation_score: 76, new_mutation_score: 70.9, new_mutation_typescript_total: 90, new_mutation_typescript_killed: 62, new_mutation_typescript_survived: 18, new_mutation_typescript_score: 68.9, new_mutation_python_total: 19, new_mutation_python_killed: 14, new_mutation_python_survived: 4, new_mutation_python_score: 73.7, new_mutation_java_total: 18, new_mutation_java_killed: 14, new_mutation_java_survived: 2, new_mutation_java_score: 77.8 },
);

const now = () => new Date();
// The fixtures use a fixed clock in tests; here, shift dates relative to the real now.
for (const p of data.projects) for (const r of p.prs) r.pr.analysisDate = new Date(Date.now() - (Date.parse('2026-10-05T12:00:00Z') - Date.parse(r.pr.analysisDate))).toISOString();

renderOverview(document.getElementById('overview')!, data, now);
void renderProjectPage(document.getElementById('project')!, data, { kind: 'project', project: 'qa-rm-testing-gates' }, now);
void renderProjectPage(document.getElementById('detail')!, data, { kind: 'pr', project: 'qa-rm-testing-gates', pr: '14' }, now);
