import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderOverview } from '../src/ui/overview';
import { FakeData, NOW, makePr, noData, project } from './fixtures';

const flush = () => vi.waitFor(() => expect(root.querySelector('[data-loading="true"]')).toBeNull());
let root: HTMLElement;
const mount = (data: FakeData) => renderOverview(root, data, () => NOW);
const rows = () => [...root.querySelectorAll('tbody tr[data-project]')].map((r) => r.getAttribute('data-project'));
const cell = (key: string, col: string) => root.querySelector(`tr[data-project="${key}"] [data-col="${col}"]`)?.textContent ?? '';
const tile = (name: string) => root.querySelector(`[data-tile="${name}"] .v`)?.textContent ?? '';

beforeEach(() => {
  document.body.innerHTML = '<div id="r"></div>';
  root = document.getElementById('r')!;
});

const sample = () => new FakeData([
  project('timeoff', [makePr('1', { score: 60 }), makePr('2', { score: 65 }), makePr('3', { score: 90 }), noData('4')]),
  project('policy', [makePr('5', { score: 95 })]),
  project('billing', [noData('6'), noData('7')]),
]);

describe('overview', () => {
  it('shows tiles and sorts by failing open PRs, no-data projects last (filter off)', async () => {
    mount(sample());
    await flush();
    root.querySelector<HTMLInputElement>('[data-filter="withData"]')!.click();
    expect(rows()).toEqual(['timeoff', 'policy', 'billing']);
    expect(tile('failingOpen')).toBe('2');
    expect(tile('projects')).toBe('2 / 3');
  });

  it('only-with-data filter is on by default and hides projects without data', async () => {
    mount(sample());
    await flush();
    expect(rows()).toEqual(['timeoff', 'policy']);
  });

  it('shows dashes, not zeros, for projects without data', async () => {
    mount(sample());
    await flush();
    root.querySelector<HTMLInputElement>('[data-filter="withData"]')!.click();
    expect(cell('billing', 'passRate')).toBe('-');
    expect(cell('billing', 'median')).toBe('-');
    expect(cell('billing', 'adoption')).toBe('0 / 2');
  });

  it('renders pass rate, median, adoption and latest PR', async () => {
    mount(sample());
    await flush();
    expect(cell('timeoff', 'passRate')).toContain('33%');
    expect(cell('timeoff', 'median')).toBe('65.0%');
    expect(cell('timeoff', 'adoption')).toBe('3 / 4 PRs');
    expect(cell('policy', 'latest')).toContain('#5');
    expect(cell('policy', 'latest')).toContain('PASS');
  });

  it('pass rate shows a bar when there is data and none when there is not', async () => {
    mount(sample());
    await flush();
    root.querySelector<HTMLInputElement>('[data-filter="withData"]')!.click();
    expect(root.querySelector('tr[data-project="timeoff"] [data-col="passRate"] .md-bar')).not.toBeNull();
    expect(root.querySelector('tr[data-project="billing"] [data-col="passRate"] .md-bar')).toBeNull();
  });

  it('clicking a sort header re-sorts and toggles direction', async () => {
    mount(sample());
    await flush();
    const th = root.querySelector<HTMLElement>('th[data-sort="name"]')!;
    th.click();
    expect(rows()).toEqual(['policy', 'timeoff']);
    th.click();
    expect(rows()).toEqual(['timeoff', 'policy']);
  });

  it('a project that fails shows unavailable with retry; the rest still render', async () => {
    const data = sample();
    data.projects.push(project('secret', [], 'HTTP 403 /api/x'));
    mount(data);
    await flush();
    root.querySelector<HTMLInputElement>('[data-filter="withData"]')!.click();
    expect(cell('secret', 'failing')).toContain('unavailable');
    expect(rows()).toContain('policy');
    data.projects[3] = project('secret', [makePr('9', { score: 99 })]);
    root.querySelector<HTMLButtonElement>('tr[data-project="secret"] [data-action="retry"]')!.click();
    await vi.waitFor(() => expect(cell('secret', 'latest')).toContain('#9'));
  });

  it('a project with PRs only outside the window shows no PRs in the last 30 days', async () => {
    mount(new FakeData([project('old', [makePr('1', { hours: 24 * 60 })])]));
    await flush();
    root.querySelector<HTMLInputElement>('[data-filter="withData"]')!.click();
    expect(cell('old', 'latest')).toContain('no PRs in the last 30 days');
  });

  it('refresh clears the cache and reloads', async () => {
    const data = sample();
    mount(data);
    await flush();
    root.querySelector<HTMLButtonElement>('[data-action="refresh"]')!.click();
    await flush();
    expect(data.calls).toContain('clearCache');
    expect(data.calls.filter((c) => c === 'listProjects')).toHaveLength(2);
  });

  it('empty Sonar: shows an empty message, no crash', async () => {
    mount(new FakeData([]));
    await flush();
    expect(root.textContent).toContain('No projects');
  });

  it('project name links to the project page', async () => {
    mount(sample());
    await flush();
    const a = root.querySelector<HTMLAnchorElement>('tr[data-project="timeoff"] a')!;
    expect(a.getAttribute('href')).toContain('/project/extension/mutationreport/project?id=timeoff');
  });
});
