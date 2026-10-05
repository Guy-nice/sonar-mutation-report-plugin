import { describe, expect, it, beforeEach } from 'vitest';
import { vi } from 'vitest';

type Fn = (options: { el: HTMLElement; [k: string]: unknown }) => (() => void) | void;

describe('extension entry points', () => {
  let registered: Record<string, Fn>;
  beforeEach(() => {
    registered = {};
    vi.resetModules();
    (window as unknown as { registerExtension: (k: string, f: Fn) => void }).registerExtension = (k, f) => {
      registered[k] = f;
    };
  });

  it('overview registers under mutationreport/overview and cleans up', async () => {
    await import('../src/entry-overview');
    expect(Object.keys(registered)).toEqual(['mutationreport/overview']);
    const el = document.createElement('div');
    const cleanup = registered['mutationreport/overview']({ el }) as () => void;
    expect(el.textContent).toContain('Mutation overview');
    cleanup();
    expect(el.innerHTML).toBe('');
  });

  it('project registers under mutationreport/project and cleans up', async () => {
    await import('../src/entry-project');
    expect(Object.keys(registered)).toEqual(['mutationreport/project']);
    const el = document.createElement('div');
    const cleanup = registered['mutationreport/project']({ el, component: { key: 'p' } }) as () => void;
    expect(el.textContent).toContain('Mutation');
    cleanup();
    expect(el.innerHTML).toBe('');
  });
});
