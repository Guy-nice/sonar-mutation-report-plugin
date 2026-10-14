export function fmtPct(n: number | null | undefined, digits = 1): string {
  return n === null || n === undefined || Number.isNaN(n) ? '-' : `${n.toFixed(digits)}%`;
}

export function fmtInt(n: number | null | undefined): string {
  return n === null || n === undefined || Number.isNaN(n) ? '-' : String(Math.round(n));
}

export function fmtAge(iso: string, now: Date): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '-';
  const s = Math.max(0, (now.getTime() - t) / 1000);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Date part (YYYY-MM-DD, UTC) of an ISO timestamp. */
export function fmtDate(iso: string | null | undefined): string {
  const t = iso ? new Date(iso).getTime() : Number.NaN;
  return Number.isNaN(t) ? '-' : new Date(t).toISOString().slice(0, 10);
}

/** 45s, 14m, 2h 04m. Seconds are dropped from one minute up. */
export function fmtDuration(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || Number.isNaN(sec) || sec < 0) return '-';
  const s = Math.round(sec);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/** Signed points: +9.0, -2.5, +0.0. */
export function fmtPts(n: number | null | undefined): string {
  return n === null || n === undefined || Number.isNaN(n) ? '-' : `${n >= 0 ? '+' : '-'}${Math.abs(n).toFixed(1)}`;
}

export function sonarBase(): string {
  return ((globalThis as { baseUrl?: string }).baseUrl ?? '').replace(/\/$/, '');
}

export function projectPageUrl(projectKey: string): string {
  return `${sonarBase()}/project/extension/mutationreport/project?id=${encodeURIComponent(projectKey)}`;
}

export function codeUrl(projectKey: string, prKey: string, fileKey: string, line?: number): string {
  const base = `${sonarBase()}/code?id=${encodeURIComponent(projectKey)}&pullRequest=${encodeURIComponent(prKey)}&selected=${encodeURIComponent(fileKey)}`;
  return line ? `${base}&line=${line}` : base;
}
