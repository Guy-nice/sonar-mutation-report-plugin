export type PageContext =
  | { kind: 'project'; project: string }
  | { kind: 'pr'; project: string; pr: string }
  | { kind: 'branch'; project: string; name: string };

/** Sonar passes the project as options.component and, when a branch or PR is selected, options.branchLike. */
export function parseContext(options: unknown): PageContext {
  const o = (options ?? {}) as { component?: { key?: string }; branchLike?: unknown };
  const project = o.component?.key ?? '';
  const bl = o.branchLike;
  if (bl && typeof bl === 'object') {
    const b = bl as Record<string, unknown>;
    if ('key' in b && ('base' in b || 'branch' in b || 'target' in b)) {
      return { kind: 'pr', project, pr: String(b.key) };
    }
    if ('name' in b) return { kind: 'branch', project, name: String(b.name) };
  }
  return { kind: 'project', project };
}
