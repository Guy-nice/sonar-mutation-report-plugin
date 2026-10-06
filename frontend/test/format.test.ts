import { afterEach, describe, expect, it } from 'vitest';
import { codeUrl, fmtAge, fmtInt, fmtPct, projectPageUrl, scoreColor, sonarBase } from '../src/format';
import { NOW, hoursAgo } from './fixtures';

afterEach(() => {
  delete (globalThis as { baseUrl?: string }).baseUrl;
});

describe('fmtPct / fmtInt', () => {
  it('formats numbers', () => {
    expect(fmtPct(70.94)).toBe('70.9%');
    expect(fmtPct(80, 0)).toBe('80%');
    expect(fmtInt(12.4)).toBe('12');
  });
  it('null, undefined and NaN are a dash, never 0', () => {
    expect(fmtPct(null)).toBe('-');
    expect(fmtPct(undefined)).toBe('-');
    expect(fmtPct(Number.NaN)).toBe('-');
    expect(fmtInt(null)).toBe('-');
    expect(fmtInt(Number.NaN)).toBe('-');
  });
});

describe('fmtAge', () => {
  it('minutes, hours, days', () => {
    expect(fmtAge(hoursAgo(0.5), NOW)).toBe('30m ago');
    expect(fmtAge(hoursAgo(3), NOW)).toBe('3h ago');
    expect(fmtAge(hoursAgo(50), NOW)).toBe('2d ago');
  });
  it('future dates do not go negative; invalid dates are a dash', () => {
    expect(fmtAge(hoursAgo(-1), NOW)).toBe('1m ago');
    expect(fmtAge('not a date', NOW)).toBe('-');
  });
});

describe('urls', () => {
  it('uses window.baseUrl and encodes keys', () => {
    (globalThis as { baseUrl?: string }).baseUrl = '/sonar/';
    expect(sonarBase()).toBe('/sonar');
    expect(projectPageUrl('a:b c')).toBe('/sonar/project/extension/mutationreport/project?id=a%3Ab%20c');
    expect(codeUrl('p', 'feature/x', 'p:src/a.ts', 7)).toBe(
      '/sonar/code?id=p&pullRequest=feature%2Fx&selected=p%3Asrc%2Fa.ts&line=7',
    );
  });
  it('no baseUrl and no line', () => {
    expect(codeUrl('p', '1', 'p:a.ts')).toBe('/code?id=p&pullRequest=1&selected=p%3Aa.ts');
  });
});

describe('scoreColor', () => {
  it('green at or above threshold, orange below, grey for null', () => {
    expect(scoreColor(80, 80)).toBe('#00aa00');
    expect(scoreColor(79, 80)).toBe('#ed7d20');
    expect(scoreColor(null, 80)).toBe('#8a95a5');
  });
});
