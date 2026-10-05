import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderProjectPage } from '../src/ui/projectPage';
import type { PrResult } from '../src/types';
import { FakeData, NOW, makePr, project } from './fixtures';

let root: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = '<div id="r"></div>';
  root = document.getElementById('r')!;
});
const data = () => new FakeData([project('p', [makePr('14', { score: 70 }), makePr('13', { score: 90 })])]);

describe('project page routing', () => {
  it('project context shows the PR list', async () => {
    await renderProjectPage(root, data(), { kind: 'project', project: 'p' }, () => NOW);
    expect(root.querySelectorAll('tr[data-pr]')).toHaveLength(2);
  });

  it('pr context shows the detail of that PR with a back link', async () => {
    const detail = vi.fn((r: HTMLElement, _d: unknown, _p: string, _pr: PrResult) => { r.textContent = 'DETAIL'; });
    await renderProjectPage(root, data(), { kind: 'pr', project: 'p', pr: '14' }, () => NOW, detail);
    expect(root.textContent).toContain('DETAIL');
    expect(detail.mock.calls[0][3].pr.key).toBe('14');
    expect(root.querySelector('[data-action="back"]')).not.toBeNull();
  });

  it('clicking a row opens the detail, back returns to the list', async () => {
    const detail = vi.fn((r: HTMLElement, _d, _p, _pr, onBack: () => void) => {
      r.replaceChildren();
      r.textContent = 'DETAIL';
      const b = document.createElement('button');
      b.setAttribute('data-action', 'back');
      b.onclick = onBack;
      r.append(b);
    });
    await renderProjectPage(root, data(), { kind: 'project', project: 'p' }, () => NOW, detail);
    root.querySelector<HTMLButtonElement>('tr[data-pr="13"] [data-action="open"]')!.click();
    await vi.waitFor(() => expect(root.textContent).toContain('DETAIL'));
    root.querySelector<HTMLButtonElement>('[data-action="back"]')!.click();
    await vi.waitFor(() => expect(root.querySelectorAll('tr[data-pr]')).toHaveLength(2));
  });

  it('pr context for a PR Sonar no longer has: message and the list', async () => {
    await renderProjectPage(root, data(), { kind: 'pr', project: 'p', pr: '999' }, () => NOW);
    expect(root.textContent).toContain('Pull request 999 was not found');
    expect(root.querySelectorAll('tr[data-pr]')).toHaveLength(2);
  });

  it('branch context shows a note about main and still lists the PRs', async () => {
    await renderProjectPage(root, data(), { kind: 'branch', project: 'p', name: 'main' }, () => NOW);
    expect(root.querySelector('.md-note')?.textContent).toContain('pull requests');
    expect(root.querySelectorAll('tr[data-pr]')).toHaveLength(2);
  });
});
