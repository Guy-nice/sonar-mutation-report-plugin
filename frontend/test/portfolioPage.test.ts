import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderPortfolioPage } from '../src/ui/portfolioPage';
import { FakeData } from './fixtures';

let root: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = '<div id="r"></div>';
  root = document.getElementById('r')!;
});

const ready = () => vi.waitFor(() => expect(root.querySelector('table')).not.toBeNull());
const projects = () => [...root.querySelectorAll('tbody tr[data-project]')].map((r) => r.getAttribute('data-project'));
const cell = (key: string, col: string) => root.querySelector(`tr[data-project="${key}"] [data-col="${col}"]`)?.textContent ?? '';
const total = (col: string) => root.querySelector(`tr[data-row="total"] [data-col="${col}"]`)?.textContent ?? '';

function sample(): FakeData {
  const d = new FakeData([]);
  d.breakdown = {
    name: 'APQ',
    rows: [
      // big project, no mutation data at all
      { key: 'big', name: 'Big', measures: { lines_to_cover: 900, uncovered_lines: 90, ncloc: 10000 } },
      // small project with mutation data: 1% of its code mutation tested
      { key: 'small', name: 'Small', measures: { lines_to_cover: 100, uncovered_lines: 10, ncloc: 1000, mutation_lines: 10, mutation_killed: 9, mutation_total: 10, mutation_survived: 1, mutation_no_coverage: 0 } },
    ],
  };
  return d;
}

describe('portfolio breakdown page', () => {
  it('asks for the registry measures of the portfolio and titles the page with its name', async () => {
    const d = sample();
    await renderPortfolioPage(root, d, 'APQ');
    await ready();
    expect(d.calls.find((c) => c.startsWith('loadPortfolioBreakdown:APQ:'))).toBeDefined();
    expect(root.querySelector('h1')?.textContent).toBe('Mutation breakdown - APQ');
  });

  it('shows a row per project and a weighted total', async () => {
    await renderPortfolioPage(root, sample(), 'APQ');
    await ready();
    expect(projects()).toEqual(['big', 'small']);
    expect(total('coverage')).toBe('90.0%'); // (1000 - 100) / 1000, not the mean of two 90% projects by chance
    expect(total('score')).toBe('90.0%'); // 9 / 10: only one project has mutation data
    expect(total('reach')).toBe('0.1%'); // 10 mutation tested lines of 11,000
    expect(root.querySelector('tr[data-row="total"] td')?.textContent).toBe('Portfolio total (2 projects)');
  });

  it('shows - for a project with no mutation data, never 0', async () => {
    await renderPortfolioPage(root, sample(), 'APQ');
    await ready();
    expect(cell('big', 'score')).toBe('-');
    expect(cell('big', 'survived')).toBe('-');
    expect(cell('big', 'coverage')).toBe('90.0%');
  });

  it('greys out a mutation score whose reach is under 5% and says why', async () => {
    await renderPortfolioPage(root, sample(), 'APQ');
    await ready();
    const score = root.querySelector('tr[data-project="small"] [data-col="score"]')!;
    expect(score.classList.contains('md-dim')).toBe(true);
    expect(score.getAttribute('title')).toContain('Only 1.0% of the code is mutation tested');
    expect(root.querySelector('tr[data-project="small"] [data-col="coverage"]')!.classList.contains('md-dim')).toBe(false);
  });

  it('does not grey the score when the reach is high', async () => {
    const d = sample();
    d.breakdown.rows[1].measures.mutation_lines = 500;
    await renderPortfolioPage(root, d, 'APQ');
    await ready();
    expect(root.querySelector('tr[data-project="small"] [data-col="score"]')!.classList.contains('md-dim')).toBe(false);
  });

  it('switches to new code: new coverage columns, and - for mutation measures that exist only for overall code', async () => {
    const d = sample();
    d.breakdown.rows[0].measures.new_lines_to_cover = 50;
    d.breakdown.rows[0].measures.new_uncovered_lines = 5;
    await renderPortfolioPage(root, d, 'APQ');
    await ready();
    (root.querySelector('[data-scope="new"]') as HTMLElement).click();
    expect(cell('big', 'coverage')).toBe('90.0%');
    expect(cell('small', 'coverage')).toBe('-');
    expect(cell('small', 'score')).toBe('-');
    expect(root.querySelector('[data-scope="new"]')!.classList.contains('on')).toBe(true);
  });

  it('sorts by a column; a project with no value stays last in both directions', async () => {
    await renderPortfolioPage(root, sample(), 'APQ');
    await ready();
    const th = () => root.querySelector('th[data-sort="score"]') as HTMLElement;
    th().click();
    expect(projects()).toEqual(['small', 'big']);
    th().click();
    expect(projects()).toEqual(['small', 'big']);
    (root.querySelector('th[data-sort="name"]') as HTMLElement).click();
    expect(projects()).toEqual(['big', 'small']);
  });

  it('says so when the portfolio has no projects, and when it cannot be read', async () => {
    const d = new FakeData([]);
    await renderPortfolioPage(root, d, 'APQ');
    expect(root.textContent).toContain('no projects you may see');
    const bad = new FakeData([]);
    bad.loadPortfolioBreakdown = async () => { throw new Error('HTTP 403'); };
    await renderPortfolioPage(root, bad, 'APQ');
    expect(root.querySelector('.md-fail')?.textContent).toContain('HTTP 403');
  });
});
