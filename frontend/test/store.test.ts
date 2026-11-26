import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DORMANT_TTL_MS, dormantProjects, forgetDormant, knownAdopters, rememberAdopter, rememberDormant } from '../src/store';

beforeEach(() => localStorage.clear());

describe('adopters', () => {
  it('are remembered once and read back', () => {
    rememberAdopter('a');
    rememberAdopter('a');
    rememberAdopter('b');
    expect([...knownAdopters()].sort()).toEqual(['a', 'b']);
  });
  it('garbage in storage reads as empty', () => {
    localStorage.setItem('mutation-dashboard-adopters:', '{"not":"a list"}');
    expect(knownAdopters().size).toBe(0);
    localStorage.setItem('mutation-dashboard-adopters:', 'not json');
    expect(knownAdopters().size).toBe(0);
  });
});

describe('dormant components', () => {
  const T = 1_000_000_000_000;
  it('are skipped for a day, then checked again', () => {
    rememberDormant(['a', 'b'], T);
    expect([...dormantProjects(T + DORMANT_TTL_MS - 1)].sort()).toEqual(['a', 'b']);
    expect(dormantProjects(T + DORMANT_TTL_MS).size).toBe(0);
  });
  it('expired entries are dropped when new ones are recorded', () => {
    rememberDormant(['old'], T);
    rememberDormant(['new'], T + DORMANT_TTL_MS + 5);
    expect(Object.keys(JSON.parse(localStorage.getItem('mutation-dashboard-dormant:') ?? '{}'))).toEqual(['new']);
  });
  it('forgetDormant clears them all', () => {
    rememberDormant(['a'], T);
    forgetDormant();
    expect(dormantProjects(T).size).toBe(0);
  });
  it('garbage in storage reads as empty', () => {
    localStorage.setItem('mutation-dashboard-dormant:', '[1,2]');
    expect(dormantProjects(T).size).toBe(0);
    localStorage.setItem('mutation-dashboard-dormant:', '{"a":"x"}');
    expect(dormantProjects(T).size).toBe(0);
  });
  it('unusable storage never throws', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
    expect(() => { rememberDormant(['a'], T); rememberAdopter('a'); forgetDormant(); }).not.toThrow();
    expect(dormantProjects(T).size).toBe(0);
    get.mockRestore();
    set.mockRestore();
  });
});
