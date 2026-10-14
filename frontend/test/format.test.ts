import { afterEach, describe, expect, it } from 'vitest';
import { codeUrl, fmtAge, fmtDate, fmtDuration, fmtInt, fmtPct, fmtPts, projectPageUrl, sonarBase } from '../src/format';
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

describe('fmtDate / fmtDuration / fmtPts', () => {
  it('date is the UTC day; unparseable is a dash', () => {
    expect(fmtDate('2026-10-13T23:59:59Z')).toBe('2026-10-13');
    expect(fmtDate('2026-10-13T09:00:00+00:00')).toBe('2026-10-13');
    expect(fmtDate('garbage')).toBe('-');
    expect(fmtDate(null)).toBe('-');
    expect(fmtDate(undefined)).toBe('-');
  });
  it('duration: seconds, minutes, hours with two digit minutes', () => {
    expect(fmtDuration(0)).toBe('0s');
    expect(fmtDuration(45)).toBe('45s');
    expect(fmtDuration(59.6)).toBe('1m');
    expect(fmtDuration(14 * 60)).toBe('14m');
    expect(fmtDuration(3599)).toBe('59m');
    expect(fmtDuration(3600)).toBe('1h 00m');
    expect(fmtDuration(2 * 3600 + 4 * 60)).toBe('2h 04m');
  });
  it('duration: unknown or negative is a dash, never 0', () => {
    expect(fmtDuration(null)).toBe('-');
    expect(fmtDuration(undefined)).toBe('-');
    expect(fmtDuration(Number.NaN)).toBe('-');
    expect(fmtDuration(-1)).toBe('-');
  });
  it('points are signed with one decimal', () => {
    expect(fmtPts(9)).toBe('+9.0');
    expect(fmtPts(-2.5)).toBe('-2.5');
    expect(fmtPts(0)).toBe('+0.0');
    expect(fmtPts(null)).toBe('-');
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
