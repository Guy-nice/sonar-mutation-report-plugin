import { describe, expect, it } from 'vitest';
import { COLUMNS, MIN_REACH_PCT, allInputKeys, isSample, sumMeasures } from '../src/columns';

const col = (id: string) => COLUMNS.find((c) => c.id === id)!;

describe('column values are ratios of sums', () => {
  it('coverage = covered / lines to cover, overall and new', () => {
    expect(col('coverage').value({ lines_to_cover: 200, uncovered_lines: 50 }, 'overall')).toBe(75);
    expect(col('coverage').value({ new_lines_to_cover: 40, new_uncovered_lines: 10 }, 'new')).toBe(75);
    expect(col('coverage').value({ lines_to_cover: 200, uncovered_lines: 50 }, 'new')).toBeNull();
  });
  it('a portfolio total weighs a big project more than a small one (not a mean of percentages)', () => {
    const big = { mutation_killed: 900, mutation_total: 1000 };
    const small = { mutation_killed: 0, mutation_total: 10 };
    expect(col('score').value(sumMeasures([big, small]), 'overall')).toBeCloseTo(89.1, 1);
  });
  it('test strength ignores mutants no test reaches', () => {
    expect(col('strength').value({ mutation_killed: 30, mutation_survived: 10 }, 'overall')).toBe(75);
  });
  it('reach = mutation tested lines / lines of code, never above 100', () => {
    expect(col('reach').value({ mutation_lines: 50, ncloc: 1000 }, 'overall')).toBe(5);
    expect(col('reach').value({ mutation_lines: 2000, ncloc: 1000 }, 'overall')).toBe(100);
    expect(col('reach').value({ new_mutation_lines: 10, new_lines: 40 }, 'new')).toBe(25);
  });
  it('a missing input or a zero denominator is null, never 0', () => {
    expect(col('score').value({}, 'overall')).toBeNull();
    expect(col('score').value({ mutation_killed: 0, mutation_total: 0 }, 'overall')).toBeNull();
    expect(col('reach').value({ mutation_lines: 5, ncloc: 0 }, 'overall')).toBeNull();
    expect(col('survived').value({}, 'overall')).toBeNull();
  });
  it('counts read the scope prefix', () => {
    expect(col('survived').value({ mutation_survived: 3, new_mutation_survived: 1 }, 'new')).toBe(1);
    expect(col('noCoverage').value({ mutation_no_coverage: 3 }, 'overall')).toBe(3);
  });
});

describe('sumMeasures', () => {
  it('sums per measure over the rows that have it, and leaves a measure nobody has absent', () => {
    expect(sumMeasures([{ a: 1, b: 2 }, { a: 4 }])).toEqual({ a: 5, b: 2 });
    expect(sumMeasures([])).toEqual({});
  });
});

describe('the registry', () => {
  it('lists every input once, for both scopes', () => {
    const keys = allInputKeys();
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(expect.arrayContaining(['lines_to_cover', 'new_uncovered_lines', 'mutation_lines', 'ncloc', 'new_lines', 'mutation_killed']));
  });
  it('a new column is one entry: its inputs join the keys with no other change', () => {
    const security = { id: 'sec', label: 'Security', help: '', format: 'int' as const, inputs: () => ['security_issues'], value: (s: Record<string, number>) => s.security_issues ?? null };
    expect(allInputKeys([...COLUMNS, security])).toContain('security_issues');
  });
  it('greys a mutation percentage out only while the reach is known and under the minimum', () => {
    expect(isSample(col('score'), MIN_REACH_PCT - 0.1)).toBe(true);
    expect(isSample(col('score'), MIN_REACH_PCT)).toBe(false);
    expect(isSample(col('score'), null)).toBe(false);
    expect(isSample(col('coverage'), 0.1)).toBe(false);
  });
});
