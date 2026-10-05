import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderPrDetail } from '../src/ui/prDetail';
import type { FileRow, SurvivorRow } from '../src/types';
import { FakeData, NOW, makePr, project } from './fixtures';

let root: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = '<div id="r"></div>';
  root = document.getElementById('r')!;
});

const file = (path: string, score: number | null, alive = 1): FileRow =>
  ({ fileKey: `p:${path}`, path, language: 'ts', score, alive, changedLines: 10, wholeFileScore: score });
const surv = (path: string, line: number, status: 'SURVIVED' | 'NO_COVERAGE' = 'SURVIVED'): SurvivorRow =>
  ({ fileKey: `p:${path}`, path, line, status, operator: 'Eq' });

const pr = makePr('14', {
  score: 70.9,
  measures: { new_mutation_score: 70.9, new_mutation_total: 127, new_mutation_killed: 90, new_mutation_survived: 19, new_mutation_no_coverage: 12, new_mutation_timed_out: 3, new_mutation_memory_error: 2, new_mutation_unknown: 1, new_mutation_test_strength: 82.6 },
});
const data = (extra: Partial<FakeData> = {}) => Object.assign(new FakeData([project('p', [pr])],
  { 'p#14': [file('a.ts', 80), file('dates.ts', 46.2, 14), file('x.ts', null, 0)] },
  { 'p#14': [surv('dates.ts', 7), surv('dates.ts', 12, 'NO_COVERAGE'), surv('a.ts', 3)] },
  [{ key: 'mutation_score', name: 'Mutation: Score', description: 'Share killed', type: 'PERCENT' }, { key: 'new_mutation_total', name: 'Mutations: Total', description: '', type: 'INT' }],
  { mutation_score: 76, new_mutation_total: 127, new_mutation_typescript_total: 100, new_mutation_typescript_killed: 70, new_mutation_typescript_survived: 20, new_mutation_typescript_score: 70, new_mutation_python_total: 27, new_mutation_python_killed: 20, new_mutation_python_survived: 5, new_mutation_python_score: 74.1 }), extra);

const text = (sel: string) => root.querySelector(sel)?.textContent ?? '';
const open = async (d = data()) => { await renderPrDetail(root, d, 'p', pr, () => {}, () => NOW); };

describe('PR detail', () => {
  it('header shows verdict, score and threshold', async () => {
    await open();
    expect(text('[data-part="score"]')).toContain('70.9%');
    expect(root.textContent).toContain('threshold 80%');
    expect(root.textContent).toContain('FAIL');
    expect(root.textContent).toContain('feature/14');
  });

  it('tiles show counts; timeout/memory/unknown are summed; absent values are dashes', async () => {
    await open();
    expect(text('[data-tile="total"] .v')).toBe('127');
    expect(text('[data-tile="survived"] .v')).toBe('19');
    expect(text('[data-tile="other"] .v')).toBe('6');
    expect(text('[data-tile="strength"] .v')).toBe('82.6%');
    const sparse = makePr('15', { measures: { new_mutation_score: 90 } });
    await renderPrDetail(root, data(), 'p', sparse, () => {}, () => NOW);
    expect(text('[data-tile="total"] .v')).toBe('-');
    expect(text('[data-tile="other"] .v')).toBe('-');
    expect(text('[data-tile="strength"] .v')).toBe('-');
  });

  it('files tab: weakest first, no-score files last', async () => {
    await open();
    await vi.waitFor(() => expect(root.querySelectorAll('tr[data-file]')).toHaveLength(3));
    expect([...root.querySelectorAll('tr[data-file]')].map((r) => r.getAttribute('data-file'))).toEqual(['p:dates.ts', 'p:a.ts', 'p:x.ts']);
    expect(root.querySelector('tr[data-file="p:x.ts"] [data-col="score"]')?.textContent).toBe('-');
  });

  it('a file whose alive count is unknown shows a dash, not 0', async () => {
    const d = data();
    d.files['p#14'] = [{ ...file('a.ts', 80), alive: null }];
    await open(d);
    await vi.waitFor(() => expect(root.querySelectorAll('tr[data-file]')).toHaveLength(1));
    expect(root.querySelector('tr[data-file="p:a.ts"] [data-col="alive"]')?.textContent).toBe('-');
  });

  it('survivors panel starts on the weakest file and follows the selected file', async () => {
    await open();
    await vi.waitFor(() => expect(root.querySelectorAll('[data-panel="files"] tr[data-survivor]')).toHaveLength(2));
    root.querySelector<HTMLElement>('tr[data-file="p:a.ts"]')!.click();
    expect(root.querySelectorAll('[data-panel="files"] tr[data-survivor]')).toHaveLength(1);
  });

  it('survivor lines link to Sonar code view', async () => {
    await open();
    await vi.waitFor(() => expect(root.querySelector('[data-panel="files"] tr[data-survivor] a')).not.toBeNull());
    const href = root.querySelector('[data-panel="files"] tr[data-survivor] a')!.getAttribute('href')!;
    expect(href).toContain('/code?id=p&pullRequest=14&selected=p%3Adates.ts&line=7');
  });

  it('survivors tab lists all and shows the count in the tab label', async () => {
    await open();
    await vi.waitFor(() => expect(root.querySelector('button[data-tab="survivors"]')!.textContent).toContain('(3)'));
    root.querySelector<HTMLButtonElement>('button[data-tab="survivors"]')!.click();
    expect(root.querySelectorAll('[data-panel="survivors"] tr[data-survivor]')).toHaveLength(3);
  });

  it('languages tab builds rows from per-language measures', async () => {
    await open();
    root.querySelector<HTMLButtonElement>('button[data-tab="languages"]')!.click();
    await vi.waitFor(() => expect(root.querySelectorAll('[data-panel="languages"] tr[data-lang]')).toHaveLength(2));
    expect(text('tr[data-lang="typescript"] [data-col="score"]')).toBe('70.0%');
  });

  it('all-metrics tab lists every mutation metric with its value', async () => {
    await open();
    root.querySelector<HTMLButtonElement>('button[data-tab="metrics"]')!.click();
    await vi.waitFor(() => expect(root.querySelectorAll('[data-panel="metrics"] tr[data-metric]')).toHaveLength(2));
    expect(text('tr[data-metric="mutation_score"] [data-col="value"]')).toBe('76');
  });

  it('empty files and survivors show a message instead of an empty table', async () => {
    await open(new FakeData([project('p', [pr])]));
    await vi.waitFor(() => expect(root.textContent).toContain('No files with mutation data'));
  });

  it('back button calls onBack', async () => {
    const onBack = vi.fn();
    await renderPrDetail(root, data(), 'p', pr, onBack, () => NOW);
    root.querySelector<HTMLButtonElement>('[data-action="back"]')!.click();
    expect(onBack).toHaveBeenCalled();
  });

  it('a failing sub-request shows an inline error and the rest of the page still works', async () => {
    const d = data();
    d.loadFiles = async () => { throw new Error('HTTP 500 files'); };
    await open(d);
    await vi.waitFor(() => expect(root.textContent).toContain('HTTP 500 files'));
    expect(text('[data-part="score"]')).toContain('70.9%');
  });
});
