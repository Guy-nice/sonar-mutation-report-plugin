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

export function scoreColor(score: number | null, threshold: number): string {
  if (score === null) return '#8a95a5';
  return score >= threshold ? '#00aa00' : '#ed7d20';
}
