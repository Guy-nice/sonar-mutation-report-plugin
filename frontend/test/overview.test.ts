import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderOverview } from '../src/ui/overview';
import { FakeData, NOW, improved, makePr, noData, project } from './fixtures';

const flush = () => vi.waitFor(() => expect(root.querySelector('[data-loading="true"]')).toBeNull());
let root: HTMLElement;
const mount = (data: FakeData) => renderOverview(root, data, () => NOW);
const rows = () => [...root.querySelectorAll('tbody tr[data-project]')].map((r) => r.getAttribute('data-project'));
const cell = (key: string, col: string) => root.querySelector(`tr[data-project="${key}"] [data-col="${col}"]`)?.textContent ?? '';
const tile = (name: string) => root.querySelector(`[data-tile="${name}"] .v`)?.textContent ?? '';
const tileSub = (name: string) => root.querySelector(`[data-tile="${name}"] .s`)?.textContent ?? '';
const total = (i: number) => root.querySelector('tr[data-row="total"]')?.children[i]?.textContent ?? '';

const showAll = () => root.querySelector<HTMLInputElement>('[data-filter="withData"]')!.click();

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<div id="r"></div>';
  root = document.getElementById('r')!;
});

const sample = () => new FakeData([
  project('timeoff', [improved('1', 40, 60, 600, { portfolio: 'Routing' }), improved('2', 50, 70, 300, { hours: 30 }), noData('4')]),
  project('policy', [improved('5', 78, 95, 120, { hours: 5, portfolio: 'Platform' })]),
  project('billing', [noData('6'), noData('7')]),
]);

describe('a big server', () => {
  it('repaints in batches, not once per project, and ends with every project loaded', async () => {
    const many = Array.from({ length: 60 }, (_, i) => project(`p${i}`, [improved(String(i), 50, 70, 60)]));
    let paints = 0;
    const obs = new MutationObserver(() => { paints++; });
    obs.observe(root, { childList: true, subtree: true });
    mount(new FakeData(many));
    await flush();
    obs.disconnect();
    expect(rows()).toHaveLength(60);
    expect(paints).toBeLessThan(60 * 3);
  });

  it('projects that had mutation data load first next time, and are remembered', async () => {
    const loaded: string[] = [];
    class Spy extends FakeData {
      async loadProject(p: { key: string; name: string }) { loaded.push(p.key); return super.loadProject(p); }
    }
    const data = () => new Spy([project('a', [noData('1')]), project('b', [improved('2', 50, 70, 60)]), project('c', [noData('3')])]);
    mount(data());
    await flush();
    expect(loaded).toEqual(['a', 'b', 'c']);
    expect(JSON.parse(localStorage.getItem('mutation-dashboard-adopters:') ?? '[]')).toEqual(['b']);
    loaded.length = 0;
    document.body.innerHTML = '<div id="r"></div>';
    root = document.getElementById('r')!;
    mount(data());
    await flush();
    expect(loaded).toEqual(['b', 'a', 'c']);
  });

  it('unusable storage never breaks the page', async () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    mount(sample());
    await flush();
    expect(rows()).toEqual(['timeoff', 'policy']);
    spy.mockRestore();
  });
});

describe('overview honesty and robustness', () => {
  it('a PR with data but no score shows dashes and no gate result, never PASS', async () => {
    mount(new FakeData([project('p', [makePr('1', { score: null })])]));
    await flush();
    expect(cell('p', 'after')).toBe('-');
    expect(cell('p', 'gate')).toBe('-→-');
    expect(cell('p', 'status')).toBe('No data');
  });

  it('says what open means for the failing tile', async () => {
    mount(sample());
    await flush();
    expect(tileSub('failingOpen')).toBe('below the threshold');
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
    expect(cell('a', 'after')).toBe('95.0%');
    expect(root.querySelector('[data-loading="true"]')).toBeNull();
  });
});

describe('overview', () => {
  it('shows the four tiles: before to after, failing now, pass rate, time', async () => {
    mount(sample());
    await flush();
    expect([...root.querySelectorAll('[data-tile]')].map((t) => t.getAttribute('data-tile'))).toEqual(['improvement', 'failingOpen', 'passRate', 'duration']);
    expect(tile('improvement')).toBe('56%→75%');
    expect(tileSub('improvement')).toBe('+19.0 pts average over 3 PRs');
    expect(tile('failingOpen')).toBe('2');
    expect(tile('passRate')).toBe('33%');
    expect(tileSub('passRate')).toBe('1 / 3 PRs (was 0 / 3)');
    expect(tile('duration')).toBe('17m');
    expect(tileSub('duration')).toBe('average 5m per PR (3 PRs)');
    expect(root.querySelector('.md-sub')?.textContent).toContain('2 of 3 components use mutation');
  });

  it('there is no median anywhere', async () => {
    mount(sample());
    await flush();
    expect(root.textContent?.toLowerCase()).not.toContain('median');
    expect(root.querySelector('[data-tile="trend"]')).toBeNull();
  });

  it('without agent data the before and time tiles say what is missing, not zero', async () => {
    mount(new FakeData([project('p', [makePr('1', { score: 90 })])]));
    await flush();
    expect(tile('improvement')).toBe('-');
    expect(tileSub('improvement')).toContain('first score');
    expect(tile('duration')).toBe('-');
    expect(tileSub('passRate')).toBe('1 / 1 PRs');
  });

  it('default order is weakest After first; components without data last once shown', async () => {
    mount(sample());
    await flush();
    expect(rows()).toEqual(['timeoff', 'policy']);
    showAll();
    expect(rows()).toEqual(['timeoff', 'policy', 'billing']);
  });

  it('components without data are hidden by default, with their count; unchecking shows the adoption gap', async () => {
    mount(sample());
    await flush();
    expect(rows()).toEqual(['timeoff', 'policy']);
    expect(root.querySelector('.md-filters label')?.textContent).toContain('(1 without data hidden)');
    showAll();
    expect(rows()).toEqual(['timeoff', 'policy', 'billing']);
    expect(root.querySelector('.md-filters label')?.textContent).not.toContain('hidden');
  });

  it('nobody adopted: says so instead of an empty table', async () => {
    mount(new FakeData([project('billing', [noData('6')])]));
    await flush();
    expect(root.textContent).toContain('No components with mutation data');
  });

  it('a component row: portfolio, before, after, change, gate, scan date, time', async () => {
    mount(sample());
    await flush();
    expect(cell('timeoff', 'portfolio')).toBe('Routing');
    expect(cell('timeoff', 'before')).toBe('40.0%');
    expect(cell('timeoff', 'after')).toBe('60.0%');
    expect(cell('timeoff', 'change')).toBe('▲ +20.0');
    expect(cell('timeoff', 'gate')).toBe('Fail→Fail');
    expect(cell('timeoff', 'scan')).toBe('2026-10-05');
    expect(cell('timeoff', 'time')).toBe('10m');
    expect(cell('policy', 'gate')).toBe('Fail→Pass');
    expect(root.querySelector('tr[data-project="policy"] [data-col="gate"] .b')?.className).toContain('ok');
  });

  it('a decline shows a red down arrow', async () => {
    mount(new FakeData([project('p', [improved('1', 70, 66, 60)])]));
    await flush();
    expect(cell('p', 'change')).toBe('▼ -4.0');
    expect(root.querySelector('[data-col="change"] .md-dn')).not.toBeNull();
  });

  it('shows dashes, not zeros, for components without data', async () => {
    mount(sample());
    await flush();
    showAll();
    for (const col of ['before', 'after', 'change', 'time']) expect(cell('billing', col)).toBe('-');
    expect(cell('billing', 'gate')).toBe('-→-');
    expect(cell('billing', 'scan')).toBe('never scanned');
    expect(cell('billing', 'portfolio')).toBe('-');
  });

  it('the last row averages the components that report both scores', async () => {
    mount(sample());
    await flush();
    expect(total(0)).toBe('All components');
    expect(total(2)).toBe('59.0%');
    expect(total(3)).toBe('77.5%');
    expect(total(4)).toBe('▲ +18.5');
    expect(total(5)).toBe('0 pass→1 pass');
    expect(total(8)).toBe('12m');
  });

  it('no total row when no component reports a first score', async () => {
    mount(new FakeData([project('p', [makePr('1', { score: 90 })])]));
    await flush();
    expect(root.querySelector('tr[data-row="total"]')).toBeNull();
  });

  it('status shows the score band of the After score; components without data have no band', async () => {
    mount(sample());
    await flush();
    showAll();
    expect(cell('billing', 'status')).toBe('No data');
    expect(root.querySelector('tr[data-project="timeoff"] [data-col="status"] [data-band]')?.getAttribute('data-band')).toBe('needs');
    expect(root.querySelector('tr[data-project="policy"] [data-col="status"] [data-band]')?.getAttribute('data-band')).toBe('excellent');
  });

  it('dashboard cards: before/after bars best first, mutant distribution and legend', async () => {
    mount(sample());
    await flush();
    expect([...root.querySelectorAll('[data-card="scores"] [data-bar]')].map((b) => b.getAttribute('data-bar'))).toEqual(['policy', 'timeoff']);
    expect(root.querySelector('[data-card="scores"] h2')?.textContent).toBe('Before → After Agent, by Component');
    expect(root.querySelector('[data-card="scores"] [data-bar="policy"] .p')?.textContent).toBe('78% → 95%');
    expect(root.querySelector('[data-card="distribution"] [data-part="killed"]')?.textContent).toBe('102');
    expect(root.querySelector('[data-card="distribution"] [data-part="alive"]')?.textContent).toBe('18');
    expect(root.querySelector('.md-legend')?.textContent).toContain('Needs Work (<75%)');
    expect(root.querySelector('.md-sub')?.textContent).toBe('Mutation Score Dashboard • Last updated: 2026-10-05 • 2 of 3 components use mutation');
  });

  it('a bar without a first score shows a dash for before', async () => {
    mount(new FakeData([project('p', [makePr('1', { score: 90 })])]));
    await flush();
    expect(root.querySelector('[data-bar="p"] .p')?.textContent).toBe('- → 90%');
  });

  it('clicking a sort header re-sorts and toggles direction', async () => {
    mount(sample());
    await flush();
    showAll();
    const th = root.querySelector<HTMLElement>('th[data-sort="name"]')!;
    th.click();
    expect(rows()).toEqual(['billing', 'policy', 'timeoff']);
    th.click();
    expect(rows()).toEqual(['timeoff', 'policy', 'billing']);
  });

  it('every data column sorts; gate and status do not', async () => {
    mount(sample());
    await flush();
    expect([...root.querySelectorAll('th[data-sort]')].map((t) => t.getAttribute('data-sort')))
      .toEqual(['name', 'portfolio', 'before', 'after', 'change', 'scan', 'time']);
    root.querySelector<HTMLElement>('th[data-sort="change"]')!.click();
    expect(rows()).toEqual(['timeoff', 'policy']);
    root.querySelector<HTMLElement>('th[data-sort="before"]')!.click();
    expect(rows()).toEqual(['policy', 'timeoff']);
  });

  it('the portfolio filter appears when a portfolio exists and narrows the rows', async () => {
    mount(sample());
    await flush();
    const sel = root.querySelector<HTMLSelectElement>('select[data-filter="portfolio"]')!;
    expect([...sel.options].map((o) => o.textContent)).toEqual(['All', 'Platform', 'Routing', 'No portfolio']);
    sel.value = 'Platform';
    sel.dispatchEvent(new Event('change'));
    expect(rows()).toEqual(['policy']);
    const again = root.querySelector<HTMLSelectElement>('select[data-filter="portfolio"]')!;
    expect(again.value).toBe('Platform');
    showAll();
    const third = root.querySelector<HTMLSelectElement>('select[data-filter="portfolio"]')!;
    third.value = '\u0000none';
    third.dispatchEvent(new Event('change'));
    expect(rows()).toEqual(['billing']);
  });

  it('no portfolio filter when no component has one', async () => {
    mount(new FakeData([project('p', [makePr('1')])]));
    await flush();
    expect(root.querySelector('select[data-filter="portfolio"]')).toBeNull();
  });

  it('a component that fails shows unavailable with retry; the rest still render', async () => {
    const data = sample();
    data.projects.push(project('secret', [], 'HTTP 403 /api/x'));
    mount(data);
    await flush();
    expect(cell('secret', 'error')).toContain('unavailable');
    expect(rows()).toContain('policy');
    data.projects[3] = project('secret', [makePr('9', { score: 99 })]);
    root.querySelector<HTMLButtonElement>('tr[data-project="secret"] [data-action="retry"]')!.click();
    await vi.waitFor(() => expect(cell('secret', 'after')).toBe('99.0%'));
  });

  it('a component with PRs only outside the window shows no PRs in the last 30 days', async () => {
    mount(new FakeData([project('old', [makePr('1', { hours: 24 * 60 })])]));
    await flush();
    showAll();
    expect(cell('old', 'scan')).toContain('no PRs in the last 30 days');
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
    expect(root.textContent).toContain('No components');
  });

  it('component name links to the project page', async () => {
    mount(sample());
    await flush();
    const a = root.querySelector<HTMLAnchorElement>('tr[data-project="timeoff"] a')!;
    expect(a.getAttribute('href')).toContain('/project/extension/mutationreport/project?id=timeoff');
  });
});
