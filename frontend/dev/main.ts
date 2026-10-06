import { renderOverview } from '../src/ui/overview';
import { renderProjectPage } from '../src/ui/projectPage';
import type { FileRow, SurvivorRow } from '../src/types';
import { FakeData, makePr, noData, project } from '../test/fixtures';

const f = (path: string, lang: string, score: number | null, alive: number, changed: number, whole: number | null): FileRow =>
  ({ fileKey: `qa:${path}`, path, language: lang, score, alive, changedLines: changed, wholeFileScore: whole });
const s = (path: string, line: number, status: 'SURVIVED' | 'NO_COVERAGE', operator: string): SurvivorRow =>
  ({ fileKey: `qa:${path}`, path, line, status, operator });

const pr14 = makePr('14', { score: 70.9, hours: 3, title: 'pricing rules refactor', measures: {
  new_mutation_score: 70.9, new_mutation_total: 127, new_mutation_killed: 90, new_mutation_survived: 19, new_mutation_no_coverage: 12,
  new_mutation_timed_out: 3, new_mutation_memory_error: 2, new_mutation_unknown: 1, new_mutation_test_strength: 82.6 } });

const data = new FakeData(
  [
    project('timeoff-webapp', [makePr('1', { score: 60, hours: 2 }), makePr('2', { score: 65, hours: 5 }), makePr('3', { score: 66, hours: 8 }), makePr('4', { score: 90, hours: 40 }), makePr('5', { score: 88, hours: 70 }), noData('6', 90)]),
    project('scheduler-api', [makePr('7', { score: 76, hours: 26 }), makePr('8', { score: 70, hours: 30 }), makePr('9', { score: 95, hours: 90 })]),
    project('qa-rm-testing-gates', [pr14, makePr('13', { score: 84, hours: 30, title: 'date helpers' }), makePr('12', { score: 91.2, hours: 50, title: 'validator edge cases' }), makePr('11', { score: 80, hours: 96, title: 'parser cleanup' }), makePr('10', { score: 82.6, hours: 216, title: 'Stryker gate' })]),
    project('policy-engine', [makePr('20', { score: 91, hours: 5 }), makePr('21', { score: 85, hours: 50 })]),
    project('billing-ui', [noData('30'), noData('31')]),
  ],
  { 'qa-rm-testing-gates#14': [f('src/utils/dates.ts', 'ts', 46.2, 14, 36, 46.2), f('src/services/pricing.ts', 'ts', 64.1, 10, 46, 64.6), f('tools/report_builder.py', 'py', 69.2, 4, 19, 68.2), f('src/main/java/com/nice/Policy.java', 'java', 80, 2, 25, 82.5), f('src/validators.ts', 'ts', 88.2, 2, 22, 88.2)] },
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
