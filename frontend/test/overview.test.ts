import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderOverview } from '../src/ui/overview';
import { FakeData, NOW, improved, makePr, noData, project } from './fixtures';

const flush = () => vi.waitFor(() => expect(root.querySelector('[data-status="ready"]')).not.toBeNull());
let root: HTMLElement;
const mount = (data: FakeData) => renderOverview(root, data, () => NOW);
const rows = () => [...root.querySelectorAll('tbody tr[data-project]')].map((r) => r.getAttribute('data-project'));
const cell = (key: string, col: string) => root.querySelector(`tr[data-project="${key}"] [data-col="${col}"]`)?.textContent ?? '';
const tile = (name: string) => root.querySelector(`[data-tile="${name}"] .v`)?.textContent ?? '';
const tileSub = (name: string) => root.querySelector(`[data-tile="${name}"] .s`)?.textContent ?? '';
const total = (i: number) => root.querySelector('tr[data-row="total"]')?.children[i]?.textContent ?? '';

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<div id="r"></div>';
  root = document.getElementById('r')!;
});

/** Portfolios are Sonar Portfolios: billing is in Platform although it has no mutation data. */
const sample = () => {
  const data = new FakeData([
    project('timeoff', [improved('1', 40, 60, 600), improved('2', 50, 70, 300, { hours: 30 }), noData('4')]),
    project('policy', [improved('5', 78, 95, 120, { hours: 5 })]),
    project('billing', [noData('6'), noData('7')]),
  ]);
  data.portfolios = [
    { key: 'r', name: 'Routing', projectKeys: ['timeoff'] },
    { key: 'p', name: 'Platform', projectKeys: ['policy', 'billing'] },
  ];
  return data;
};
/** Everything in one portfolio, so row order shows the sort and not the grouping. */
const oneTeam = (data: FakeData) => {
  data.portfolios = [{ key: 't', name: 'Team', projectKeys: data.projects.map((p) => p.project.key) }];
  return data;
};

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
    expect(rows()).toEqual(['policy', 'timeoff']);
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
    await vi.waitFor(() => expect(root.textContent).toContain('no pull request analysis'));
    expect(root.querySelectorAll('tr[data-project]')).toHaveLength(0);
  });

  it('a refresh during a load drops the stale results and keeps the progress indicator', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    class Slow extends FakeData {
      first = true;
      started = false;
      async loadProject(p: { key: string; name: string }) {
        if (this.first) {
          this.first = false;
          this.started = true;
          await gate;
          return project('a', [makePr('1', { score: 10 })]);
        }
        return project('a', [makePr('2', { score: 95 })]);
      }
    }
    const slow = new Slow([project('a', [])]);
    const handle = renderOverview(root, slow, () => NOW);
    // the first load must be waiting on its project before the refresh starts
    await vi.waitFor(() => expect(slow.started).toBe(true));
    expect(root.querySelector('[data-status="loading"]')).not.toBeNull();
    const second = handle.reload();
    await second;
    release();
    await new Promise((r) => setTimeout(r, 20));
    expect(cell('a', 'after')).toBe('95.0%');
    expect(root.querySelector('[data-status="loading"]')).toBeNull();
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
    expect(root.querySelector('.md-sub')?.textContent).toContain('2 live components in 2 portfolios');
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

  it('lists live components only, grouped by Sonar Portfolio A-Z, weakest After first inside a group', async () => {
    mount(sample());
    await flush();
    expect(rows()).toEqual(['policy', 'timeoff']);
    expect([...root.querySelectorAll('tr[data-portfolio]')].map((r) => r.getAttribute('data-portfolio'))).toEqual(['Platform', 'Routing']);
    mount(oneTeam(new FakeData([project('a', [improved('1', 50, 90, 60)]), project('b', [improved('2', 30, 50, 60)])])));
    await flush();
    expect(rows()).toEqual(['b', 'a']);
  });

  it('components without a recent mutation run are not listed, only counted', async () => {
    mount(sample());
    await flush();
    expect(rows()).not.toContain('billing');
    expect(root.querySelector('.md-filters')?.textContent).toContain('1 without a recent mutation run hidden');
    expect(root.querySelector('.md-filters input[type="checkbox"]')).toBeNull();
  });

  it('nobody adopted: says so instead of an empty table', async () => {
    mount(new FakeData([project('billing', [noData('6')])]));
    await flush();
    expect(root.textContent).toContain('No live components');
  });

  it('a component in several portfolios is listed under each; one in none goes to No portfolio, last', async () => {
    const data = new FakeData([project('a', [improved('1', 50, 90, 60)]), project('b', [improved('2', 30, 50, 60)]), project('loner', [improved('3', 40, 60, 60)])]);
    data.portfolios = [{ key: 'x', name: 'X', projectKeys: ['a', 'b'] }, { key: 'y', name: 'Y', projectKeys: ['a'] }];
    mount(data);
    await flush();
    expect([...root.querySelectorAll('tr[data-portfolio], tbody tr[data-project]')].map((r) => r.getAttribute('data-portfolio') ?? r.getAttribute('data-project')))
      .toEqual(['X', 'b', 'a', 'Y', 'a', '\u0000none', 'loner']);
    expect(root.querySelector('tr[data-portfolio="X"]')?.textContent).toContain('2 components');
  });

  it('clicking a portfolio row collapses and expands its components', async () => {
    mount(sample());
    await flush();
    root.querySelector<HTMLElement>('tr[data-portfolio="Platform"]')!.click();
    expect(rows()).toEqual(['timeoff']);
    root.querySelector<HTMLElement>('tr[data-portfolio="Platform"]')!.click();
    expect(rows()).toEqual(['policy', 'timeoff']);
  });

  it('a portfolio row averages its components that report both scores', async () => {
    const data = new FakeData([project('a', [improved('1', 40, 60, 60)]), project('b', [improved('2', 60, 90, 60)])]);
    data.portfolios = [{ key: 't', name: 'Team', projectKeys: ['a', 'b'] }];
    mount(data);
    await flush();
    const cells = [...(root.querySelector('tr[data-portfolio="Team"]')?.children ?? [])].map((c) => c.textContent);
    expect(cells.slice(1, 4)).toEqual(['50.0%', '75.0%', '▲ +25.0']);
  });

  it('a component row: before, after, change, gate, scan date, time', async () => {
    mount(sample());
    await flush();
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

  it('a live component from an older agent shows dashes, not zeros, for what it does not report', async () => {
    mount(new FakeData([project('old', [makePr('1', { score: 90 })])]));
    await flush();
    for (const col of ['before', 'change', 'time']) expect(cell('old', col)).toBe('-');
    expect(cell('old', 'after')).toBe('90.0%');
    expect(cell('old', 'gate')).toBe('-→Pass');
  });

  it('the last row averages the components that report both scores', async () => {
    mount(sample());
    await flush();
    expect(total(0)).toBe('All live components');
    expect(total(1)).toBe('59.0%');
    expect(total(2)).toBe('77.5%');
    expect(total(3)).toBe('▲ +18.5');
    expect(total(4)).toBe('0 pass→1 pass');
    expect(total(7)).toBe('12m');
  });

  it('with no first score anywhere, the total row shows the After average and dashes', async () => {
    mount(new FakeData([project('p', [makePr('1', { score: 90 })])]));
    await flush();
    expect([1, 2, 3].map(total)).toEqual(['-', '90.0%', '-']);
  });

  it('status shows the score band of the After score', async () => {
    mount(sample());
    await flush();
    expect(root.querySelector('tr[data-project="timeoff"] [data-col="status"] [data-band]')?.getAttribute('data-band')).toBe('needs');
    expect(root.querySelector('tr[data-project="policy"] [data-col="status"] [data-band]')?.getAttribute('data-band')).toBe('excellent');
  });

  it('dashboard cards: before/after bars best first, mutant distribution and legend', async () => {
    mount(sample());
    await flush();
    expect([...root.querySelectorAll('[data-card="scores"] [data-bar]')].map((b) => b.getAttribute('data-bar'))).toEqual(['Platform', 'Routing']);
    expect(root.querySelector('[data-card="scores"] h2')?.textContent).toBe('Before → After Agent, by Portfolio');
    expect(root.querySelector('[data-card="scores"] [data-bar="Platform"] .p')?.textContent).toBe('78% → 95%');
    expect(root.querySelector('[data-card="distribution"] [data-part="killed"]')?.textContent).toBe('102');
    expect(root.querySelector('[data-card="distribution"] [data-part="alive"]')?.textContent).toBe('18');
    expect(root.querySelector('.md-legend')?.textContent).toContain('Needs Work (<75%)');
    expect(root.querySelector('.md-sub')?.textContent).toBe('Mutation Score Dashboard • Last updated: 2026-10-05 • 2 live components in 2 portfolios');
  });

  it('a portfolio with no first score anywhere has no bar', async () => {
    mount(new FakeData([project('p', [makePr('1', { score: 90 })])]));
    await flush();
    expect(root.querySelector('[data-card="scores"] [data-bar]')).toBeNull();
    expect(root.querySelector('[data-card="scores"]')?.textContent).toContain('No portfolio has a score yet.');
  });

  it('clicking a sort header re-sorts and toggles direction', async () => {
    mount(oneTeam(sample()));
    await flush();
    const th = root.querySelector<HTMLElement>('th[data-sort="name"]')!;
    th.click();
    expect(rows()).toEqual(['policy', 'timeoff']);
    th.click();
    expect(rows()).toEqual(['timeoff', 'policy']);
  });

  it('every data column sorts; gate and status do not', async () => {
    mount(oneTeam(sample()));
    await flush();
    expect([...root.querySelectorAll('th[data-sort]')].map((t) => t.getAttribute('data-sort')))
      .toEqual(['name', 'before', 'after', 'change', 'scan', 'time']);
    root.querySelector<HTMLElement>('th[data-sort="change"]')!.click();
    expect(rows()).toEqual(['timeoff', 'policy']);
    root.querySelector<HTMLElement>('th[data-sort="before"]')!.click();
    expect(rows()).toEqual(['policy', 'timeoff']);
  });

  it('the portfolio filter lists the portfolios with live components and narrows the rows', async () => {
    mount(sample());
    await flush();
    const sel = root.querySelector<HTMLSelectElement>('select[data-filter="portfolio"]')!;
    expect([...sel.options].map((o) => o.textContent)).toEqual(['All', 'Platform', 'Routing']);
    sel.value = 'Platform';
    sel.dispatchEvent(new Event('change'));
    expect(rows()).toEqual(['policy']);
    expect(root.querySelector<HTMLSelectElement>('select[data-filter="portfolio"]')!.value).toBe('Platform');
  });

  it('No portfolio is a filter choice only when a live component is in none', async () => {
    const data = sample();
    data.projects.push(project('loner', [improved('9', 40, 60, 60)]));
    mount(data);
    await flush();
    const sel = root.querySelector<HTMLSelectElement>('select[data-filter="portfolio"]')!;
    expect([...sel.options].map((o) => o.textContent)).toEqual(['All', 'Platform', 'Routing', 'No portfolio']);
    sel.value = '\u0000none';
    sel.dispatchEvent(new Event('change'));
    expect(rows()).toEqual(['loner']);
  });

  it('a server without Portfolios: no filter, every live component under No portfolio', async () => {
    mount(new FakeData([project('p', [makePr('1')])]));
    await flush();
    expect(root.querySelector('select[data-filter="portfolio"]')).toBeNull();
    expect(root.querySelector('tr[data-portfolio]')?.textContent).toContain('No portfolio');
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

  it('a component with PRs only outside the window is not live and not listed', async () => {
    mount(new FakeData([project('old', [makePr('1', { hours: 24 * 60 })])]));
    await flush();
    expect(rows()).toEqual([]);
    expect(root.textContent).toContain('No live components');
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

describe('adoption summary', () => {
  const card = () => root.querySelector('[data-card="adoption"]')!;
  const row = (name: string) => card().querySelector(`[data-portfolio-adoption="${name}"]`)?.textContent ?? '';

  it('counts active components (a PR in the window) that use mutation, overall and per Sonar Portfolio', async () => {
    mount(sample());
    await flush();
    expect(card().querySelector('.md-adopt-big')?.textContent).toBe('67%');
    expect(card().querySelector('.md-adopt-cap')?.textContent).toBe('2 of 3 active components use mutation testing');
    expect(row('Platform')).toContain('1 of 2 (50%)');
    expect(row('Routing')).toContain('1 of 1 (100%)');
  });

  it('a component with no PR in the window is not active: not in the 100%', async () => {
    const data = sample();
    data.projects.push(project('dead', [makePr('1', { hours: 24 * 60, hasData: false, score: null })]));
    mount(data);
    await flush();
    expect(card().querySelector('.md-adopt-cap')?.textContent).toBe('2 of 3 active components use mutation testing');
  });

  it('a component in several portfolios counts in each, once overall', async () => {
    const data = new FakeData([project('a', [improved('1', 50, 90, 60)]), project('b', [noData('2')])]);
    data.portfolios = [{ key: 'x', name: 'X', projectKeys: ['a', 'b'] }, { key: 'y', name: 'Y', projectKeys: ['a'] }];
    mount(data);
    await flush();
    expect(card().querySelector('.md-adopt-cap')?.textContent).toBe('1 of 2 active components use mutation testing');
    expect(row('X')).toContain('1 of 2 (50%)');
    expect(row('Y')).toContain('1 of 1 (100%)');
  });

  it('no active component: a dash, not 0%', async () => {
    mount(new FakeData([]));
    await flush();
    expect(card().querySelector('.md-adopt-big')?.textContent).toBe('-');
  });
});

describe('loading and ready', () => {
  it('shows progress and a partial mark while loading, then a ready mark with the time', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    class Slow extends FakeData {
      async loadProject(p: { key: string; name: string }) {
        if (p.key === 'slow') await gate;
        return super.loadProject(p);
      }
    }
    const data = new Slow([project('fast', [improved('1', 50, 70, 60)]), project('slow', [improved('2', 40, 60, 60)])]);
    mount(data);
    await vi.waitFor(() => expect(root.querySelector('[data-status="loading"]')?.textContent).toContain('Loading data: 1 of 2 components (50%)'));
    expect(root.querySelector('[data-card="adoption"] .md-partial')).not.toBeNull();
    expect(root.querySelector('[data-status="ready"]')).toBeNull();
    release();
    await flush();
    expect(root.querySelector('[data-status="loading"]')).toBeNull();
    expect(root.querySelector('[data-status="ready"]')?.textContent).toContain('Data ready');
    expect(root.querySelector('[data-status="ready"]')?.textContent).toContain('2 components checked at');
    expect(root.querySelector('[data-card="adoption"] .md-partial')).toBeNull();
  });

  it('the ready mark has a Refresh that loads again', async () => {
    const data = sample();
    mount(data);
    await flush();
    root.querySelector<HTMLButtonElement>('[data-action="refresh-status"]')!.click();
    await flush();
    expect(data.calls.filter((c) => c === 'listProjects')).toHaveLength(2);
  });
});

describe('inactive components are not checked again for a day', () => {
  const loaded: string[] = [];
  class Spy extends FakeData {
    async loadProject(p: { key: string; name: string }) { loaded.push(p.key); return super.loadProject(p); }
  }
  const data = () => new Spy([project('live', [improved('1', 50, 70, 60)]), project('idle', [makePr('9', { hours: 24 * 45 })])]);
  const remount = () => { document.body.innerHTML = '<div id="r"></div>'; root = document.getElementById('r')!; };

  it('a component with no PR in the window is skipped on the next visit, and the ready mark says so', async () => {
    loaded.length = 0;
    mount(data());
    await flush();
    expect(loaded.sort()).toEqual(['idle', 'live']);
    loaded.length = 0;
    remount();
    mount(data());
    await flush();
    expect(loaded).toEqual(['live']);
    expect(root.querySelector('[data-status="ready"]')?.textContent).toContain('1 skipped');
  });

  it('Refresh checks every component again', async () => {
    mount(data());
    await flush();
    remount();
    mount(data());
    await flush();
    loaded.length = 0;
    root.querySelector<HTMLButtonElement>('[data-action="refresh-status"]')!.click();
    await flush();
    expect(loaded.sort()).toEqual(['idle', 'live']);
  });

  it('a component checked more than a day ago is checked again', async () => {
    mount(data());
    await flush();
    remount();
    loaded.length = 0;
    renderOverview(root, data(), () => new Date(NOW.getTime() + 25 * 3_600_000));
    await vi.waitFor(() => expect(root.querySelector('[data-status="ready"]')).not.toBeNull());
    expect(loaded.sort()).toEqual(['idle', 'live']);
  });
});
