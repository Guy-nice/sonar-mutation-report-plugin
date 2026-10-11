import { describe, expect, it } from 'vitest';
import {
  BANDS, bandLabel, bandOf, computeTrend, distribution, lastUpdated,
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

describe('bandOf', () => {
  it('maps scores to Excellent / Good / Fair / Needs Work at the documented edges', () => {
    expect(bandOf(90)).toBe('excellent');
    expect(bandOf(89.9)).toBe('good');
    expect(bandOf(85)).toBe('good');
    expect(bandOf(84.9)).toBe('fair');
    expect(bandOf(75)).toBe('fair');
    expect(bandOf(74.9)).toBe('needs');
    expect(bandOf(0)).toBe('needs');
    expect(BANDS.map((b) => bandLabel(b.band))).toEqual(['Excellent', 'Good', 'Fair', 'Needs Work']);
  });
  it('no score has no band', () => {
    expect(bandOf(null)).toBeNull();
    expect(bandOf(undefined)).toBeNull();
    expect(bandOf(Number.NaN)).toBeNull();
  });
});

describe('computeTrend', () => {
  const day = 24;
  it('improving when the recent half median is a point or more above the older half', () => {
    const t = computeTrend([makePr('1', { score: 90, hours: 2 * day }), makePr('2', { score: 80, hours: 20 * day })], NOW);
    expect(t).toEqual({ direction: 'improving', delta: 10 });
  });
  it('declining when it is a point or more below', () => {
    const t = computeTrend([makePr('1', { score: 70, hours: 2 * day }), makePr('2', { score: 80, hours: 20 * day })], NOW);
    expect(t).toEqual({ direction: 'declining', delta: -10 });
  });
  it('stable inside one point either way', () => {
    expect(computeTrend([makePr('1', { score: 80.5, hours: 2 * day }), makePr('2', { score: 80, hours: 20 * day })], NOW).direction).toBe('stable');
    expect(computeTrend([makePr('1', { score: 79.5, hours: 2 * day }), makePr('2', { score: 80, hours: 20 * day })], NOW).direction).toBe('stable');
  });
  it('uses medians, not means', () => {
    const prs = [makePr('1', { score: 90, hours: day }), makePr('2', { score: 90, hours: 2 * day }), makePr('3', { score: 10, hours: 3 * day }), makePr('4', { score: 80, hours: 20 * day })];
    expect(computeTrend(prs, NOW).delta).toBe(10);
  });
  it('unknown when one half is empty, PRs are unscored, have no data or are older than the window', () => {
    expect(computeTrend([makePr('1', { hours: day })], NOW)).toEqual({ direction: 'unknown', delta: null });
    expect(computeTrend([makePr('1', { hours: day }), makePr('2', { score: null, hours: 20 * day })], NOW).direction).toBe('unknown');
    expect(computeTrend([makePr('1', { hours: day }), noData('2', 20 * day)], NOW).direction).toBe('unknown');
    expect(computeTrend([makePr('1', { hours: day }), makePr('2', { hours: 40 * day })], NOW).direction).toBe('unknown');
    expect(computeTrend([], NOW).direction).toBe('unknown');
  });
});

describe('distribution', () => {
  it('sums killed, survived, no coverage and the rest across PRs with data', () => {
    const a = makePr('1', { measures: { new_mutation_killed: 10, new_mutation_survived: 3, new_mutation_no_coverage: 2, new_mutation_timed_out: 1 } });
    const b = makePr('2', { measures: { new_mutation_killed: 5, new_mutation_survived: 1, new_mutation_memory_error: 2, new_mutation_unknown: 1 } });
    expect(distribution([a, b, noData('3')])).toEqual({ killed: 15, survived: 4, noCoverage: 2, other: 4, alive: 6, killedPct: (15 / 21) * 100 });
  });
  it('no mutants gives a null share, not NaN', () => {
    expect(distribution([]).killedPct).toBeNull();
    expect(distribution([noData('1')]).alive).toBe(0);
  });
});

describe('lastUpdated', () => {
  it('is the date of the latest analysis', () => {
    expect(lastUpdated([makePr('1', { hours: 100 }), makePr('2', { hours: 3 })])).toBe('2026-10-05');
  });
  it('is null without PRs or with unparseable dates', () => {
    expect(lastUpdated([])).toBeNull();
    const bad = makePr('1');
    bad.pr.analysisDate = 'garbage';
    expect(lastUpdated([bad])).toBeNull();
  });
});
