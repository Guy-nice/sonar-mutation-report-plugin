import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderOverview } from '../src/ui/overview';
import { renderPrList } from '../src/ui/prList';
import { FakeData, NOW, improved, project } from './fixtures';

const data = () => new FakeData([project('p', [
  improved('1', 50, 70, 900, { hours: 3 }), improved('2', 60, 90, 300, { hours: 30 }), improved('3', 70, 80, 600, { hours: 24 * 20 }),
])]);

const shape = (root: HTMLElement) => ({
  heading: root.querySelector('h1')?.tagName,
  subtitle: root.querySelector('.md-sub')?.textContent?.startsWith('Mutation Score Dashboard • Last updated: '),
  tiles: [...root.querySelectorAll('[data-tile]')].map((t) => t.getAttribute('data-tile')),
  cards: [...root.querySelectorAll('[data-card]')].map((c) => c.getAttribute('data-card')),
  titles: [...root.querySelectorAll('[data-card] h2')].map((h) => h.textContent).filter((t) => t?.startsWith('Mutant')),
  legend: root.querySelectorAll('.md-legend span').length,
  statusBand: root.querySelector('td[data-col="status"] [data-band]') !== null,
});

describe('overview and project page share one design', () => {
  let a: HTMLElement;
  let b: HTMLElement;
  beforeEach(async () => {
    document.body.innerHTML = '<div id="a"></div><div id="b"></div>';
    a = document.getElementById('a')!;
    b = document.getElementById('b')!;
    renderOverview(a, data(), () => NOW);
    await vi.waitFor(() => expect(a.querySelector('[data-loading="true"]')).toBeNull());
    await renderPrList(b, data(), { key: 'p', name: 'p' }, () => {}, () => NOW);
  });

  it('same header, tiles, cards, distribution title, legend and status bands', () => {
    expect(shape(a)).toEqual(shape(b));
    expect(shape(a).tiles).toEqual(['improvement', 'failingOpen', 'passRate', 'duration']);
    expect(shape(a).cards).toEqual(['scores', 'distribution', 'details']);
  });

  it('same tile values for the same PRs', () => {
    const values = (r: HTMLElement) => [...r.querySelectorAll('[data-tile]')].map((t) => t.textContent);
    expect(values(a)).toEqual(values(b));
  });
});
