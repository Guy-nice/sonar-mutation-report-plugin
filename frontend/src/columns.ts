/**
 * The columns of the portfolio breakdown, as data. Adding a column (security or reliability rating, a new
 * mutation measure) is one entry here: the page, the totals and the sorting need no change.
 *
 * Every value is a ratio of SUMS of base measures, never a mean of percentages: a portfolio total is then
 * what Sonar itself would show, and a big project weighs more than a small one.
 */
export type Scope = 'overall' | 'new';

/** Base measure -> number, summed over a set of projects. A measure no project has is absent. */
export type Sums = Record<string, number>;

export interface Column {
  id: string;
  label: string;
  help: string;
  format: 'pct' | 'int';
  /** Sonar measure keys the column reads, per scope. Their sums are given to `value`. */
  inputs: (scope: Scope) => string[];
  /** The column's value from the sums of its inputs, or null when it cannot be told (a missing input, a zero denominator). */
  value: (s: Sums, scope: Scope) => number | null;
  /** True when the value is a mutation percentage that misleads while few lines are mutation tested. */
  needsReach?: boolean;
}

/** Below this share of the code, a mutation percentage is a sample, not a measure of the code. */
export const MIN_REACH_PCT = 5;

const p = (scope: Scope) => (scope === 'new' ? 'new_' : '');
const ratio = (num: number | undefined, den: number | undefined): number | null =>
  num === undefined || den === undefined || den <= 0 ? null : (100 * num) / den;

export const COLUMNS: Column[] = [
  {
    id: 'coverage', label: 'Coverage', format: 'pct',
    help: 'Covered share of the lines to cover (Sonar). Overall code or new code.',
    inputs: (sc) => [`${p(sc)}lines_to_cover`, `${p(sc)}uncovered_lines`],
    value: (s, sc) => {
      const lines = s[`${p(sc)}lines_to_cover`];
      const open = s[`${p(sc)}uncovered_lines`];
      return lines === undefined || open === undefined ? null : ratio(lines - open, lines);
    },
  },
  {
    id: 'reach', label: 'Mutation reach', format: 'pct',
    help: 'Share of the code that mutation testing looked at: analyzable lines of the mutated files / lines of code. '
      + 'Mutation data comes from the files that pull requests changed, so this is usually small.',
    inputs: (sc) => (sc === 'new' ? ['new_mutation_lines', 'new_lines'] : ['mutation_lines', 'ncloc']),
    value: (s, sc) => {
      const r = sc === 'new' ? ratio(s.new_mutation_lines, s.new_lines) : ratio(s.mutation_lines, s.ncloc);
      return r === null ? null : Math.min(100, r);
    },
  },
  {
    id: 'score', label: 'Mutation score', format: 'pct', needsReach: true,
    help: 'Killed mutants / all mutants. Read it together with the reach.',
    inputs: (sc) => [`${p(sc)}mutation_killed`, `${p(sc)}mutation_total`],
    value: (s, sc) => ratio(s[`${p(sc)}mutation_killed`], s[`${p(sc)}mutation_total`]),
  },
  {
    id: 'strength', label: 'Test strength', format: 'pct', needsReach: true,
    help: 'Killed / (killed + survived): ignores mutants that no test reaches.',
    inputs: (sc) => [`${p(sc)}mutation_killed`, `${p(sc)}mutation_survived`],
    value: (s, sc) => {
      const k = s[`${p(sc)}mutation_killed`];
      const v = s[`${p(sc)}mutation_survived`];
      return k === undefined || v === undefined ? null : ratio(k, k + v);
    },
  },
  {
    id: 'survived', label: 'Survived', format: 'int',
    help: 'Mutants that a test ran but did not catch.',
    inputs: (sc) => [`${p(sc)}mutation_survived`],
    value: (s, sc) => s[`${p(sc)}mutation_survived`] ?? null,
  },
  {
    id: 'noCoverage', label: 'No coverage', format: 'int',
    help: 'Mutants that no test reaches.',
    inputs: (sc) => [`${p(sc)}mutation_no_coverage`],
    value: (s, sc) => s[`${p(sc)}mutation_no_coverage`] ?? null,
  },
];

/** Every Sonar measure key the registry reads, for both scopes, without duplicates. */
export function allInputKeys(columns: Column[] = COLUMNS): string[] {
  return [...new Set(columns.flatMap((c) => [...c.inputs('overall'), ...c.inputs('new')]))];
}

/** Sum each measure over the rows that have it. A measure no row has stays absent (so the column says "-", not 0). */
export function sumMeasures(rows: Array<Record<string, number>>): Sums {
  const out: Sums = {};
  for (const r of rows) for (const [k, v] of Object.entries(r)) out[k] = (out[k] ?? 0) + v;
  return out;
}

/** A mutation percentage is greyed out while the reach is known and below MIN_REACH_PCT. */
export function isSample(col: Column, reach: number | null): boolean {
  return col.needsReach === true && reach !== null && reach < MIN_REACH_PCT;
}
