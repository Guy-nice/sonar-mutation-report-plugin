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

describe('overview honesty and robustness', () => {
  it('a PR with data but no score shows NO SCORE, never PASS', async () => {
    mount(new FakeData([project('p', [makePr('1', { score: null })])]));
    await flush();
    expect(cell('p', 'latest')).toContain('NO SCORE');
    expect(cell('p', 'latest')).not.toContain('PASS');
  });

  it('says what open means', async () => {
    mount(sample());
    await flush();
    expect(root.textContent).toContain('analyzed in the last 7 days');
  });

  it('a server without pull request analysis gets one clear message, not one error per project', async () => {
    const e = 'HTTP 404 /api/project_pull_requests/list';
    mount(new FakeData([project('a', [], e), project('b', [], e)]));
    await flush();
    expect(root.textContent).toContain('no pull request analysis');
    expect(root.querySelectorAll('tr[data-project]')).toHaveLength(0);
  });

  it('a refresh during a load drops the stale results and keeps the progress indicator', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    class Slow extends FakeData {
      first = true;
      async loadProject(p: { key: string; name: string }) {
        if (this.first) {
          this.first = false;
          await gate;
          return project('a', [makePr('1', { score: 10 })]);
        }
        return project('a', [makePr('2', { score: 95 })]);
      }
    }
    const handle = renderOverview(root, new Slow([project('a', [])]), () => NOW);
    await vi.waitFor(() => expect(root.textContent).toContain('Loading'));
    const second = handle.reload();
    await second;
    release();
    await new Promise((r) => setTimeout(r, 20));
    expect(cell('a', 'latest')).toContain('#2');
    expect(cell('a', 'latest')).not.toContain('#1');
    expect(root.querySelector('[data-loading="true"]')).toBeNull();
  });
});

describe('overview', () => {
  it('shows tiles and sorts by failing open PRs, no-data projects last', async () => {
    mount(sample());
    await flush();
    expect(rows()).toEqual(['timeoff', 'policy', 'billing']);
    expect(tile('failingOpen')).toBe('2');
    expect(tile('projects')).toBe('2 / 3');
  });

  it('projects without data are visible by default so the adoption gap shows; the filter hides them', async () => {
    mount(sample());
    await flush();
    expect(rows()).toEqual(['timeoff', 'policy', 'billing']);
    root.querySelector<HTMLInputElement>('[data-filter="withData"]')!.click();
    expect(rows()).toEqual(['timeoff', 'policy']);
  });

  it('filter on and nobody adopted: says so instead of an empty table', async () => {
    mount(new FakeData([project('billing', [noData('6')])]));
    await flush();
    root.querySelector<HTMLInputElement>('[data-filter="withData"]')!.click();
    expect(root.textContent).toContain('No projects with mutation data');
  });

  it('shows dashes, not zeros, for projects without data', async () => {
    mount(sample());
    await flush();
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
    expect(rows()).toEqual(['billing', 'policy', 'timeoff']);
    th.click();
    expect(rows()).toEqual(['timeoff', 'policy', 'billing']);
  });

  it('a project that fails shows unavailable with retry; the rest still render', async () => {
    const data = sample();
    data.projects.push(project('secret', [], 'HTTP 403 /api/x'));
    mount(data);
    await flush();
    expect(cell('secret', 'failing')).toContain('unavailable');
    expect(rows()).toContain('policy');
    data.projects[3] = project('secret', [makePr('9', { score: 99 })]);
    root.querySelector<HTMLButtonElement>('tr[data-project="secret"] [data-action="retry"]')!.click();
    await vi.waitFor(() => expect(cell('secret', 'latest')).toContain('#9'));
  });

  it('a project with PRs only outside the window shows no PRs in the last 30 days', async () => {
    mount(new FakeData([project('old', [makePr('1', { hours: 24 * 60 })])]));
    await flush();
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
