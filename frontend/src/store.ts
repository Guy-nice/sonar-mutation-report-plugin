import { sonarBase } from './format';

/** What this browser remembers between visits, per Sonar server. Only a speed-up: every function swallows storage errors. */
const ADOPTERS_KEY = 'mutation-dashboard-adopters:';
const DORMANT_KEY = 'mutation-dashboard-dormant:';
/** A component with no pull request in the window is not checked again for this long (Refresh checks all). */
export const DORMANT_TTL_MS = 24 * 3_600_000;

function read(key: string): unknown {
  try {
    const raw = globalThis.localStorage?.getItem(key + sonarBase());
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    globalThis.localStorage?.setItem(key + sonarBase(), JSON.stringify(value));
  } catch {
    // storage full or disabled
  }
}

/** Keys of the projects that had mutation data on an earlier visit: they load first, so the page fills in at once. */
export function knownAdopters(): Set<string> {
  const list = read(ADOPTERS_KEY);
  return new Set(Array.isArray(list) ? list.filter((k): k is string => typeof k === 'string') : []);
}

export function rememberAdopter(key: string): void {
  const known = knownAdopters();
  if (known.has(key)) return;
  known.add(key);
  write(ADOPTERS_KEY, [...known]);
}

function dormantMap(): Record<string, number> {
  const raw = read(DORMANT_KEY);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter((e): e is [string, number] => typeof e[1] === 'number'));
}

/** Projects checked less than DORMANT_TTL_MS ago that had no pull request in the window. */
export function dormantProjects(nowMs: number): Set<string> {
  return new Set(Object.entries(dormantMap()).filter(([, at]) => nowMs - at < DORMANT_TTL_MS).map(([k]) => k));
}

/** Records the projects found without a pull request in the window, dropping expired entries. */
export function rememberDormant(keys: string[], nowMs: number): void {
  const map = Object.fromEntries(Object.entries(dormantMap()).filter(([, at]) => nowMs - at < DORMANT_TTL_MS));
  for (const k of keys) map[k] = nowMs;
  write(DORMANT_KEY, map);
}

export function forgetDormant(): void {
  write(DORMANT_KEY, {});
}
