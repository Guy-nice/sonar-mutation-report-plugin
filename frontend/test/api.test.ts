import { describe, expect, it } from 'vitest';
import { CACHE_TTL_MS, MAX_CONCURRENCY, PAGE_SIZE, SonarApi, parseOperator, toMeasureMap } from '../src/api';

type Handler = (url: string) => unknown | Promise<unknown> | { status: number };

function fakeFetch(handler: Handler) {
  const calls: string[] = [];
  const fn = (async (url: string) => {
    calls.push(url);
    const out = (await handler(url)) as { status?: number } & Record<string, unknown>;
    if (out && typeof out === 'object' && 'status' in out && Object.keys(out).length === 1) {
      return { ok: false, status: out.status, json: async () => ({}) };
    }
    return { ok: true, status: 200, json: async () => out };
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const hoursAgoIso = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const prList = (n: number) => ({
  pullRequests: Array.from({ length: n }, (_, i) => ({
    key: String(i + 1), title: `t${i + 1}`, branch: `b${i + 1}`, base: 'main', analysisDate: hoursAgoIso(2),
  })),
});

describe('toMeasureMap / parseOperator', () => {
  it('reads value and period.value, skips non numbers', () => {
    expect(toMeasureMap([{ metric: 'a', value: '1.5' }, { metric: 'new_b', period: { value: '70' } }, { metric: 'c', value: 'x' }, { metric: 'd' }]))
      .toEqual({ a: 1.5, new_b: 70 });
  });
  it('parses the operator from the sensor messages', () => {
    expect(parseOperator('A test executes this line but does not detect the EqualityOperator mutation. Strengthen the assertions.')).toBe('EqualityOperator');
    expect(parseOperator('No test reaches this line (BlockStatement mutant not executed). Add a test that exercises it.')).toBe('BlockStatement');
    expect(parseOperator('something else')).toBe('');
  });
});

describe('SonarApi requests', () => {
  it('encodes parameters and prefixes the base url', async () => {
    const { fn, calls } = fakeFetch(() => ({ pullRequests: [] }));
    await new SonarApi(fn, Date.now, '/sonar').loadProject({ key: 'a:b c', name: 'n' });
    expect(calls[0]).toBe('/sonar/api/project_pull_requests/list?project=a%3Ab%20c');
  });

  it('listProjects paginates', async () => {
    const page = (p: number) => ({ paging: { total: PAGE_SIZE + 2 }, components: Array.from({ length: p === 1 ? PAGE_SIZE : 2 }, (_, i) => ({ key: `k${p}-${i}`, name: `n${p}-${i}` })) });
    const { fn, calls } = fakeFetch((url) => page(url.includes('p=2') ? 2 : 1));
    const projects = await new SonarApi(fn).listProjects();
    expect(projects).toHaveLength(PAGE_SIZE + 2);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain('qualifiers=TRK');
  });
});

describe('loadProject dates and window', () => {
  it("normalizes Sonar's +0000 offset so every browser can parse the date", async () => {
    const { fn } = fakeFetch((url) => (url.includes('project_pull_requests')
      ? { pullRequests: [{ key: '1', title: 't', branch: 'b', base: 'main', analysisDate: new Date(Date.now() - 3_600_000).toISOString().replace('Z', '+0000').replace(/\.\d+/, '') }] }
      : { component: { measures: [] } }));
    const res = await new SonarApi(fn).loadProject({ key: 'p', name: 'p' });
    expect(res.prs[0].pr.analysisDate).toMatch(/\+00:00$/);
    expect(Number.isNaN(Date.parse(res.prs[0].pr.analysisDate))).toBe(false);
  });
  it('does not fetch measures for pull requests older than the 30 day window', async () => {
    const { fn, calls } = fakeFetch((url) => (url.includes('project_pull_requests')
      ? { pullRequests: [
        { key: '1', title: 'new', branch: 'b', base: 'main', analysisDate: hoursAgoIso(5) },
        { key: '2', title: 'old', branch: 'b', base: 'main', analysisDate: hoursAgoIso(24 * 60) }] }
      : { component: { measures: [] } }));
    const res = await new SonarApi(fn).loadProject({ key: 'p', name: 'p' });
    expect(res.prs.map((r) => r.pr.key)).toEqual(['1']);
    expect(calls.filter((c) => c.includes('measures/component'))).toHaveLength(1);
  });
});

describe('loadProject', () => {
  const measures = (score?: string) => ({
    component: { measures: score === undefined ? [] : [
      { metric: 'new_mutation_score', period: { value: score } },
      { metric: 'new_mutation_total', period: { value: '40' } },
      { metric: 'mutation_threshold', value: '85' },
    ] },
  });
  it('builds PrResults with data, threshold and score', async () => {
    const { fn } = fakeFetch((url) => (url.includes('project_pull_requests') ? prList(2) : measures(url.includes('pullRequest=1') ? '70.9' : undefined)));
    const res = await new SonarApi(fn).loadProject({ key: 'p', name: 'p' });
    expect(res.error).toBeNull();
    expect(res.prs[0]).toMatchObject({ hasData: true, score: 70.9, threshold: 85, thresholdAssumed: false });
    expect(res.prs[1]).toMatchObject({ hasData: false, score: null });
  });
  it('missing threshold falls back to 80 and is flagged', async () => {
    const { fn } = fakeFetch((url) => (url.includes('project_pull_requests') ? prList(1) : { component: { measures: [{ metric: 'new_mutation_score', value: '50' }] } }));
    const res = await new SonarApi(fn).loadProject({ key: 'p', name: 'p' });
    expect(res.prs[0]).toMatchObject({ threshold: 80, thresholdAssumed: true });
  });
  it('a failing request becomes an error result, never a rejection', async () => {
    const { fn } = fakeFetch(() => ({ status: 403 }));
    const res = await new SonarApi(fn).loadProject({ key: 'p', name: 'p' });
    expect(res.error).toContain('403');
    expect(res.prs).toEqual([]);
  });
  it('a PR that Sonar has no measures for (404) counts as no data', async () => {
    const { fn } = fakeFetch((url) => (url.includes('project_pull_requests') ? prList(1) : { status: 404 }));
    const res = await new SonarApi(fn).loadProject({ key: 'p', name: 'p' });
    expect(res.error).toBeNull();
    expect(res.prs[0].hasData).toBe(false);
  });
});

describe('limiter and cache', () => {
  it('never runs more than MAX_CONCURRENCY requests at once', async () => {
    let active = 0;
    let peak = 0;
    const { fn } = fakeFetch(async (url) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return url.includes('project_pull_requests') ? prList(30) : { component: { measures: [] } };
    });
    await new SonarApi(fn).loadProject({ key: 'p', name: 'p' });
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(MAX_CONCURRENCY);
  });
  it('serves repeated identical requests from cache until the TTL expires or it is cleared', async () => {
    let t = 0;
    const { fn, calls } = fakeFetch(() => ({ pullRequests: [] }));
    const api = new SonarApi(fn, () => t);
    await api.loadProject({ key: 'p', name: 'p' });
    await api.loadProject({ key: 'p', name: 'p' });
    expect(calls).toHaveLength(1);
    t = CACHE_TTL_MS + 1;
    await api.loadProject({ key: 'p', name: 'p' });
    expect(calls).toHaveLength(2);
    api.clearCache();
    await api.loadProject({ key: 'p', name: 'p' });
    expect(calls).toHaveLength(3);
  });
  it('failed requests are not cached', async () => {
    let fail = true;
    const { fn, calls } = fakeFetch(() => (fail ? { status: 500 } : { pullRequests: [] }));
    const api = new SonarApi(fn);
    expect((await api.loadProject({ key: 'p', name: 'p' })).error).not.toBeNull();
    fail = false;
    expect((await api.loadProject({ key: 'p', name: 'p' })).error).toBeNull();
    expect(calls).toHaveLength(2);
  });
});

describe('files, survivors, metrics', () => {
  it('loadFiles keeps only files with mutation data and maps the measures', async () => {
    const { fn } = fakeFetch(() => ({
      paging: { total: 2 },
      components: [
        { key: 'p:a.ts', path: 'a.ts', language: 'ts', measures: [
          { metric: 'new_mutation_score', period: { value: '50' } }, { metric: 'new_mutation_alive', period: { value: '4' } },
          { metric: 'new_mutation_lines', period: { value: '9' } }, { metric: 'mutation_score', value: '55' }] },
        { key: 'p:b.ts', path: 'b.ts', language: 'ts', measures: [] },
      ],
    }));
    expect(await new SonarApi(fn).loadFiles('p', '1')).toEqual([
      { fileKey: 'p:a.ts', path: 'a.ts', language: 'ts', score: 50, alive: 4, changedLines: 9, wholeFileScore: 55 },
    ]);
  });
  it('loadFiles paginates beyond 500 components', async () => {
    const comp = (i: number) => ({ key: `p:f${i}`, path: `f${i}`, language: 'ts', measures: [{ metric: 'new_mutation_score', period: { value: '1' } }] });
    const { fn, calls } = fakeFetch((url) => ({ paging: { total: PAGE_SIZE + 1 }, components: url.includes('p=2') ? [comp(PAGE_SIZE)] : Array.from({ length: PAGE_SIZE }, (_, i) => comp(i)) }));
    expect(await new SonarApi(fn).loadFiles('p', '1')).toHaveLength(PAGE_SIZE + 1);
    expect(calls).toHaveLength(2);
  });
  it('loadSurvivors maps rule to status, resolves paths and parses the operator', async () => {
    const { fn, calls } = fakeFetch(() => ({
      paging: { total: 2 },
      components: [{ key: 'p:a.ts', path: 'a.ts' }],
      issues: [
        { component: 'p:a.ts', line: 10, rule: 'external_mutation-report:survived', message: 'A test executes this line but does not detect the Eq mutation. x' },
        { component: 'p:a.ts', line: 3, rule: 'external_mutation-report:no-coverage', message: 'No test reaches this line (Block mutant not executed). y' },
      ],
    }));
    const rows = await new SonarApi(fn).loadSurvivors('p', 'feature/x');
    expect(rows).toEqual([
      { fileKey: 'p:a.ts', path: 'a.ts', line: 3, status: 'NO_COVERAGE', operator: 'Block' },
      { fileKey: 'p:a.ts', path: 'a.ts', line: 10, status: 'SURVIVED', operator: 'Eq' },
    ]);
    expect(calls[0]).toContain('pullRequest=feature%2Fx');
    expect(calls[0]).toContain('resolved=false');
    expect(calls[0]).toContain('components=p');
    expect(calls[0]).not.toContain('componentKeys');
  });
  it('loadSurvivors paginates beyond 500 issues', async () => {
    const issue = (i: number) => ({ component: 'p:a.ts', line: i + 1, rule: 'external_mutation-report:survived', message: 'detect the X mutation' });
    const { fn, calls } = fakeFetch((url) => ({ paging: { total: PAGE_SIZE + 1 }, components: [{ key: 'p:a.ts', path: 'a.ts' }],
      issues: url.includes('p=2') ? [issue(PAGE_SIZE)] : Array.from({ length: PAGE_SIZE }, (_, i) => issue(i)) }));
    expect(await new SonarApi(fn).loadSurvivors('p', '1')).toHaveLength(PAGE_SIZE + 1);
    expect(calls).toHaveLength(2);
  });
  it('a file without an alive measure has alive null, not 0', async () => {
    const { fn } = fakeFetch(() => ({ paging: { total: 1 }, components: [{ key: 'p:a.ts', path: 'a.ts', language: 'ts', measures: [{ metric: 'new_mutation_score', period: { value: '50' } }] }] }));
    expect((await new SonarApi(fn).loadFiles('p', '1'))[0].alive).toBeNull();
  });
  it('loadMetrics keeps only the Mutation Analysis domain', async () => {
    const { fn } = fakeFetch(() => ({ metrics: [
      { key: 'mutation_score', name: 'Mutation: Score', description: 'd', type: 'PERCENT', domain: 'Mutation Analysis' },
      { key: 'coverage', name: 'Coverage', description: '', type: 'PERCENT', domain: 'Coverage' },
    ] }));
    expect((await new SonarApi(fn).loadMetrics()).map((m) => m.key)).toEqual(['mutation_score']);
  });
  it('loadAllMeasures chunks long key lists and merges', async () => {
    const keys = Array.from({ length: 120 }, (_, i) => `m${i}`);
    const { fn, calls } = fakeFetch((url) => {
      const ks = decodeURIComponent(url.split('metricKeys=')[1]).split(',');
      return { component: { measures: ks.map((k) => ({ metric: k, value: '1' })) } };
    });
    const all = await new SonarApi(fn).loadAllMeasures('p', '1', keys);
    expect(Object.keys(all)).toHaveLength(120);
    expect(calls).toHaveLength(3);
  });
});

describe('loadPullRequest', () => {
  it('returns the PR result or null when the PR is not in the list', async () => {
    const { fn } = fakeFetch((url) => (url.includes('project_pull_requests') ? prList(2) : { component: { measures: [{ metric: 'new_mutation_score', value: '90' }] } }));
    const api = new SonarApi(fn);
    expect((await api.loadPullRequest('p', '2'))?.score).toBe(90);
    expect(await api.loadPullRequest('p', '99')).toBeNull();
  });
});
