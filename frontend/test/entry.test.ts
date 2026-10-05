import { describe, expect, it, beforeEach } from 'vitest';
import { vi } from 'vitest';

type Fn = (options: { el: HTMLElement; [k: string]: unknown }) => (() => void) | void;

describe('extension entry points', () => {
  let registered: Record<string, Fn>;
  beforeEach(() => {
    registered = {};
    vi.resetModules();
    vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, json: async () => ({ components: [], paging: { total: 0 }, pullRequests: [] }) }));
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

  it('mounting the overview twice reuses one API client, so the 5 minute cache survives navigation', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      calls.push(url);
      return { ok: true, status: 200, json: async () => ({ components: [], paging: { total: 0 } }) };
    });
    await import('../src/entry-overview');
    const mount = () => registered['mutationreport/overview']({ el: document.createElement('div') });
    mount();
    await vi.waitFor(() => expect(calls.length).toBeGreaterThan(0));
    mount();
    await new Promise((r) => setTimeout(r, 30));
    expect(calls.filter((c) => c.includes('/api/components/search'))).toHaveLength(1);
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
