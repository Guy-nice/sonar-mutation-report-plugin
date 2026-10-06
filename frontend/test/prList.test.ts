import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderPrList } from '../src/ui/prList';
import { FakeData, NOW, makePr, noData, project } from './fixtures';

let root: HTMLElement;
const keys = () => [...root.querySelectorAll('tbody tr[data-pr]')].map((r) => r.getAttribute('data-pr'));
const cell = (k: string, c: string) => root.querySelector(`tr[data-pr="${k}"] [data-col="${c}"]`)?.textContent ?? '';
const tile = (n: string) => root.querySelector(`[data-tile="${n}"] .v`)?.textContent ?? '';

beforeEach(() => {
  document.body.innerHTML = '<div id="r"></div>';
  root = document.getElementById('r')!;
});

const data = () => new FakeData([project('p', [
  makePr('14', { score: 70.9, hours: 3, measures: { new_mutation_survived: 19, new_mutation_no_coverage: 12 } }),
  makePr('13', { score: 84, hours: 30, measures: { new_mutation_survived: 3, new_mutation_no_coverage: 1 } }),
  noData('12', 60),
  makePr('10', { score: 80, hours: 24 * 9 }),
  makePr('1', { score: 50, hours: 24 * 40 }),
])]);

describe('PR list', () => {
  it('lists PRs of the last 30 days, newest first, and the tiles', async () => {
    await renderPrList(root, data(), { key: 'p', name: 'p' }, () => {}, () => NOW);
    expect(keys()).toEqual(['14', '13', '12', '10']);
    expect(tile('failingOpen')).toBe('1');
    expect(tile('withData')).toBe('3 / 4');
    expect(tile('passRate')).toBe('67%');
  });

  it('shows status, score and counts; dashes for a PR without data', async () => {
    await renderPrList(root, data(), { key: 'p', name: 'p' }, () => {}, () => NOW);
    expect(cell('14', 'status')).toBe('FAIL');
    expect(cell('14', 'score')).toContain('70.9%');
    expect(cell('14', 'survived')).toBe('19');
    expect(cell('13', 'status')).toBe('PASS');
    expect(cell('12', 'status')).toBe('NO DATA');
    expect(cell('12', 'score')).toBe('-');
    expect(cell('12', 'survived')).toBe('-');
  });

  it('a score equal to the threshold shows PASS', async () => {
    await renderPrList(root, data(), { key: 'p', name: 'p' }, () => {}, () => NOW);
    expect(cell('10', 'status')).toBe('PASS');
  });

  it('status filter', async () => {
    await renderPrList(root, data(), { key: 'p', name: 'p' }, () => {}, () => NOW);
    const sel = root.querySelector<HTMLSelectElement>('select[data-filter="status"]')!;
    sel.value = 'failing';
    sel.dispatchEvent(new Event('change'));
    expect(keys()).toEqual(['14']);
    sel.value = 'nodata';
    sel.dispatchEvent(new Event('change'));
    expect(keys()).toEqual(['12']);
  });

  it('date filter', async () => {
    await renderPrList(root, data(), { key: 'p', name: 'p' }, () => {}, () => NOW);
    const sel = root.querySelector<HTMLSelectElement>('select[data-filter="days"]')!;
    sel.value = '7';
    sel.dispatchEvent(new Event('change'));
    expect(keys()).toEqual(['14', '13', '12']);
  });

  it('clicking a PR calls onOpen with its result', async () => {
    const onOpen = vi.fn();
    await renderPrList(root, data(), { key: 'p', name: 'p' }, onOpen, () => NOW);
    root.querySelector<HTMLButtonElement>('tr[data-pr="13"] [data-action="open"]')!.click();
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ pr: expect.objectContaining({ key: '13' }) }));
  });

  it('zero PRs: message, no crash', async () => {
    await renderPrList(root, new FakeData([project('p', [])]), { key: 'p', name: 'p' }, () => {}, () => NOW);
    expect(root.textContent).toContain('No pull requests in the last 30 days');
  });

  it('load error: message with the cause', async () => {
    await renderPrList(root, new FakeData([project('p', [], 'HTTP 403 /api/x')]), { key: 'p', name: 'p' }, () => {}, () => NOW);
    expect(root.textContent).toContain('HTTP 403');
  });

  it('a PR with data but no score shows NO SCORE and stays out of the pass rate', async () => {
    const d = new FakeData([project('p', [makePr('1', { score: 90 }), makePr('2', { score: null })])]);
    await renderPrList(root, d, { key: 'p', name: 'p' }, () => {}, () => NOW);
    expect(cell('2', 'status')).toBe('NO SCORE');
    expect(tile('passRate')).toBe('100%');
  });

  it('says what open means', async () => {
    await renderPrList(root, data(), { key: 'p', name: 'p' }, () => {}, () => NOW);
    expect(root.textContent).toContain('analyzed in the last 7 days');
  });

  it('a server without pull request analysis gets a clear message', async () => {
    await renderPrList(root, new FakeData([project('p', [], 'HTTP 404 /api/project_pull_requests/list')]), { key: 'p', name: 'p' }, () => {}, () => NOW);
    expect(root.textContent).toContain('no pull request analysis');
  });

  it('a threshold that was assumed is flagged', async () => {
    const d = new FakeData([project('p', [makePr('1', { thresholdAssumed: true })])]);
    await renderPrList(root, d, { key: 'p', name: 'p' }, () => {}, () => NOW);
    expect(root.textContent).toContain('threshold assumed');
  });
});
