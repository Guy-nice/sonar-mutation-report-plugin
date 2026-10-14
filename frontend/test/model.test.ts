import { describe, expect, it } from 'vitest';
import {
  BANDS, bandLabel, bandOf, change, distribution, gateOf, hasBefore, lastUpdated,
  inWindow, isFailing, isNoPrAnalysis, isOpen, isPassing, mean, sortFilesWeakestFirst, sortProjects, summarizeOverview, summarizeProject, wasPassing,
} from '../src/model';
import type { FileRow } from '../src/types';
import { NOW, improved, makePr, noData, project } from './fixtures';

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
  it('count as adopted; a scoreless newest PR is still the component row, with null scores', () => {
    const scoreless = makePr('2', { score: null, hours: 1 });
    const s = summarizeProject(project('p', [makePr('1', { score: 90, hours: 5 }), scoreless]), NOW);
    expect(s.withData).toBe(2);
    expect(s.scanned?.pr.key).toBe('2');
    expect(s.after).toBeNull();
    expect(gateOf(s)).toEqual({ before: null, after: null });
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

describe('mean', () => {
  it('averages, and is null for nothing', () => {
    expect(mean([1, 2, 6])).toBe(3);
    expect(mean([])).toBeNull();
  });
});

describe('before and after the agent', () => {
  it('change is after minus before; both must be known', () => {
    expect(change(improved('1', 58, 67, 60))).toBe(9);
    expect(change(improved('1', 70, 66, 60))).toBe(-4);
    expect(change(makePr('1'))).toBeNull();
    expect(change(improved('1', 50, 60, 60, { score: null }))).toBeNull();
    expect(hasBefore(noData('1'))).toBe(false);
  });
  it('was passing compares the first score with the threshold, at the edge too', () => {
    expect(wasPassing(improved('1', 80, 90, 1))).toBe(true);
    expect(wasPassing(improved('1', 79.9, 90, 1))).toBe(false);
    expect(wasPassing(makePr('1'))).toBe(false);
  });
});

describe('summarizeProject', () => {
  it('the component row is the most recent PR with data; older and no-data PRs do not count', () => {
    const res = project('p', [
      improved('1', 50, 70, 600, { hours: 2, portfolio: 'Routing' }),
      improved('2', 60, 90, 300, { hours: 30 }),
      noData('4', 1), // newest, but no mutation data
      makePr('5', { score: 50, hours: 24 * 40 }), // outside the window: ignored
    ]);
    const s = summarizeProject(res, NOW);
    expect(s.total).toBe(3);
    expect(s.withData).toBe(2);
    expect(s.scanned?.pr.key).toBe('1');
    expect(s).toMatchObject({ portfolio: 'Routing', before: 50, after: 70, change: 20, durationSec: 600 });
    expect(s.scanDate).toBe(res.prs[0].pr.analysisDate);
    expect(gateOf(s)).toEqual({ before: false, after: false });
  });
  it('gate before and after: Fail -> Pass', () => {
    expect(gateOf(summarizeProject(project('p', [improved('1', 78, 84, 1)]), NOW))).toEqual({ before: false, after: true });
  });
  it('a PR from an agent that does not report the first score: no before, no change, gate after only', () => {
    const s = summarizeProject(project('p', [makePr('1', { score: 90 })]), NOW);
    expect(s).toMatchObject({ before: null, after: 90, change: null, durationSec: null, portfolio: null });
    expect(gateOf(s)).toEqual({ before: null, after: true });
  });
  it('zero PRs: nulls not zeros', () => {
    const s = summarizeProject(project('p', []), NOW);
    expect(s).toMatchObject({ total: 0, withData: 0, scanned: null, portfolio: null, before: null, after: null, change: null, scanDate: null, durationSec: null });
  });
  it('only PRs without data: no scan', () => {
    const s = summarizeProject(project('p', [noData('1'), noData('2')]), NOW);
    expect(s.total).toBe(2);
    expect(s.withData).toBe(0);
    expect(s.scanned).toBeNull();
    expect(gateOf(s)).toEqual({ before: null, after: null });
  });
  it('keeps the error', () => {
    expect(summarizeProject(project('p', [], 'boom'), NOW).error).toBe('boom');
  });
});

describe('summarizeOverview', () => {
  it('counts components with data and ignores errored ones', () => {
    const o = summarizeOverview(
      [
        project('a', [makePr('1', { score: 70 }), makePr('2', { score: 90 })]),
        project('b', [makePr('3', { score: 100 })]),
        project('c', [noData('4')]),
        project('d', [], 'unavailable'),
      ],
      NOW,
    );
    expect(o.projectsWithData).toBe(2);
    expect(o.projectsTotal).toBe(4);
  });
  it('empty input gives zeros', () => {
    expect(summarizeOverview([], NOW)).toEqual({ projectsWithData: 0, projectsTotal: 0 });
  });
});

describe('sortProjects', () => {
  const list = () => [
    summarizeProject(project('beta', [improved('1', 80, 90, 300, { portfolio: 'Routing', hours: 5 })]), NOW),
    summarizeProject(project('alpha', [improved('2', 40, 60, 900, { portfolio: 'Platform', hours: 2 })]), NOW),
    summarizeProject(project('gamma', [noData('4')]), NOW),
    summarizeProject(project('delta', [improved('5', 30, 70, 60, { hours: 9 })]), NOW),
  ];
  it('by after, ascending: weakest first, ties by name, no-data components last', () => {
    expect(sortProjects(list(), 'after', 'asc').map((s) => s.key)).toEqual(['alpha', 'delta', 'beta', 'gamma']);
  });
  it('components without data stay last even when descending', () => {
    expect(sortProjects(list(), 'after', 'desc').map((s) => s.key)).toEqual(['beta', 'delta', 'alpha', 'gamma']);
  });
  it('by change, before, time and scan date', () => {
    expect(sortProjects(list(), 'change', 'desc').map((s) => s.key)).toEqual(['delta', 'alpha', 'beta', 'gamma']);
    expect(sortProjects(list(), 'before', 'asc').map((s) => s.key)).toEqual(['delta', 'alpha', 'beta', 'gamma']);
    expect(sortProjects(list(), 'time', 'asc').map((s) => s.key)).toEqual(['delta', 'beta', 'alpha', 'gamma']);
    expect(sortProjects(list(), 'scan', 'desc').map((s) => s.key)).toEqual(['alpha', 'beta', 'delta', 'gamma']);
  });
  it('by portfolio: a component without one sorts after those with one', () => {
    expect(sortProjects(list(), 'portfolio', 'asc').map((s) => s.key)).toEqual(['alpha', 'beta', 'delta', 'gamma']);
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
