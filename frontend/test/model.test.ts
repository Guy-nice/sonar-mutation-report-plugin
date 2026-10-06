import { describe, expect, it } from 'vitest';
import {
  inWindow, isFailing, isNoPrAnalysis, isOpen, isPassing, median, sortFilesWeakestFirst, sortProjects, summarizeOverview, summarizeProject,
} from '../src/model';
import type { FileRow } from '../src/types';
import { NOW, makePr, noData, project } from './fixtures';

describe('isFailing / isPassing', () => {
  it('score below threshold fails', () => {
    expect(isFailing(makePr('1', { score: 79.9 }))).toBe(true);
    expect(isPassing(makePr('1', { score: 79.9 }))).toBe(false);
  });
  it('score equal to the threshold passes', () => {
    expect(isFailing(makePr('1', { score: 80 }))).toBe(false);
    expect(isPassing(makePr('1', { score: 80 }))).toBe(true);
  });
  it('no data and null score are neither failing nor passing', () => {
    expect(isFailing(noData('1'))).toBe(false);
    expect(isPassing(noData('1'))).toBe(false);
    const nullScore = makePr('2', { score: null });
    expect(isFailing(nullScore)).toBe(false);
    expect(isPassing(nullScore)).toBe(false);
  });
});

describe('windows', () => {
  it('30 day window', () => {
    expect(inWindow(makePr('1', { hours: 24 * 29 }), NOW)).toBe(true);
    expect(inWindow(makePr('1', { hours: 24 * 31 }), NOW)).toBe(false);
  });
  it('future analysis dates (clock skew) count as in window and open', () => {
    expect(inWindow(makePr('1', { hours: -2 }), NOW)).toBe(true);
    expect(isOpen(makePr('1', { hours: -2 }), NOW)).toBe(true);
  });
  it('open means analyzed in the last 7 days', () => {
    expect(isOpen(makePr('1', { hours: 24 * 6 }), NOW)).toBe(true);
    expect(isOpen(makePr('1', { hours: 24 * 8 }), NOW)).toBe(false);
  });
});

describe('PRs with data but no score', () => {
  it('count as adopted but stay out of the pass rate and median', () => {
    const scoreless = makePr('2', { score: null });
    const s = summarizeProject(project('p', [makePr('1', { score: 90 }), scoreless]), NOW);
    expect(s.withData).toBe(2);
    expect(s.passRate).toBe(100);
    expect(s.medianScore).toBe(90);
    const o = summarizeOverview([project('p', [makePr('1', { score: 90 }), scoreless])], NOW);
    expect(o.passRate).toBe(100);
  });
});

describe('isNoPrAnalysis', () => {
  it('recognizes a 404 on the pull request list endpoint only', () => {
    expect(isNoPrAnalysis('HTTP 404 /api/project_pull_requests/list')).toBe(true);
    expect(isNoPrAnalysis('HTTP 403 /api/project_pull_requests/list')).toBe(false);
    expect(isNoPrAnalysis('HTTP 404 /api/measures/component')).toBe(false);
    expect(isNoPrAnalysis(null)).toBe(false);
  });
});

describe('median', () => {
  it('odd, even, empty', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe('summarizeProject', () => {
  it('counts failing open PRs, pass rate, median, adoption, latest', () => {
    const res = project('p', [
      makePr('1', { score: 70, hours: 2 }),
      makePr('2', { score: 90, hours: 30 }),
      makePr('3', { score: 80, hours: 50 }),
      noData('4', 60),
      makePr('5', { score: 50, hours: 24 * 40 }), // outside the window: ignored
    ]);
    const s = summarizeProject(res, NOW);
    expect(s.total).toBe(4);
    expect(s.withData).toBe(3);
    expect(s.failingOpen).toBe(1);
    expect(s.passRate).toBeCloseTo((2 / 3) * 100);
    expect(s.medianScore).toBe(80);
    expect(s.latest?.pr.key).toBe('1');
  });
  it('a failing PR that is no longer open does not count as failing now', () => {
    const s = summarizeProject(project('p', [makePr('1', { score: 10, hours: 24 * 10 })]), NOW);
    expect(s.failingOpen).toBe(0);
    expect(s.passRate).toBe(0);
  });
  it('zero PRs: no division by zero, nulls not zeros', () => {
    const s = summarizeProject(project('p', []), NOW);
    expect(s).toMatchObject({ total: 0, withData: 0, failingOpen: 0, passRate: null, medianScore: null, latest: null });
  });
  it('only PRs without data: passRate and median are null', () => {
    const s = summarizeProject(project('p', [noData('1'), noData('2')]), NOW);
    expect(s.total).toBe(2);
    expect(s.withData).toBe(0);
    expect(s.passRate).toBeNull();
    expect(s.medianScore).toBeNull();
  });
  it('keeps the error', () => {
    expect(summarizeProject(project('p', [], 'boom'), NOW).error).toBe('boom');
  });
});

describe('summarizeOverview', () => {
  it('aggregates across projects and ignores errored projects in counts', () => {
    const o = summarizeOverview(
      [
        project('a', [makePr('1', { score: 70 }), makePr('2', { score: 90 })]),
        project('b', [makePr('3', { score: 100 })]),
        project('c', [noData('4')]),
        project('d', [], 'unavailable'),
      ],
      NOW,
    );
    expect(o.failingOpen).toBe(1);
    expect(o.passRate).toBeCloseTo((2 / 3) * 100);
    expect(o.projectsWithData).toBe(2);
    expect(o.projectsTotal).toBe(4);
    expect(o.medianScore).toBe(90);
  });
  it('empty input gives nulls', () => {
    const o = summarizeOverview([], NOW);
    expect(o).toMatchObject({ failingOpen: 0, passRate: null, projectsWithData: 0, projectsTotal: 0, medianScore: null });
  });
});

describe('sortProjects', () => {
  const list = () => [
    summarizeProject(project('beta', [makePr('1', { score: 90 })]), NOW),
    summarizeProject(project('alpha', [makePr('2', { score: 60 }), makePr('3', { score: 50 })]), NOW),
    summarizeProject(project('gamma', [noData('4')]), NOW),
    summarizeProject(project('delta', [makePr('5', { score: 70 })]), NOW),
  ];
  it('default: failing open desc, ties by name, no-data projects last', () => {
    expect(sortProjects(list(), 'failingOpen', 'desc').map((s) => s.key)).toEqual(['alpha', 'delta', 'beta', 'gamma']);
  });
  it('projects without data stay last even when ascending', () => {
    expect(sortProjects(list(), 'medianScore', 'asc').map((s) => s.key)).toEqual(['alpha', 'delta', 'beta', 'gamma']);
  });
  it('sorts by name', () => {
    expect(sortProjects(list(), 'name', 'asc').map((s) => s.key)).toEqual(['alpha', 'beta', 'delta', 'gamma']);
  });
  it('does not mutate the input', () => {
    const l = list();
    const before = l.map((s) => s.key);
    sortProjects(l, 'name', 'asc');
    expect(l.map((s) => s.key)).toEqual(before);
  });
});

describe('sortFilesWeakestFirst', () => {
  const f = (path: string, score: number | null): FileRow => ({ fileKey: path, path, language: 'ts', score, alive: 0, changedLines: null, wholeFileScore: null });
  it('ascending score, null scores last', () => {
    expect(sortFilesWeakestFirst([f('a', 80), f('b', null), f('c', 40)]).map((x) => x.path)).toEqual(['c', 'a', 'b']);
  });
});
