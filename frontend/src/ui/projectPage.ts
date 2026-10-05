import type { PageContext } from '../context';
import { injectStyles } from '../styles';
import type { DataSource, PrResult } from '../types';
import { h } from './dom';
import { renderPrList } from './prList';

export type DetailRenderer = (
  root: HTMLElement, data: DataSource, projectKey: string, pr: PrResult, onBack: () => void, now?: () => Date,
) => Promise<void> | void;

export async function renderProjectPage(
  root: HTMLElement, data: DataSource, ctx: PageContext, now: () => Date = () => new Date(), detail?: DetailRenderer,
): Promise<void> {
  injectStyles();
  const project = { key: ctx.project, name: ctx.project };

  async function showList(prefix?: HTMLElement): Promise<void> {
    await renderPrList(root, data, project, (pr) => void showDetail(pr), now);
    if (prefix) root.querySelector('.md')?.prepend(prefix);
  }

  async function showDetail(pr: PrResult): Promise<void> {
    if (detail) await detail(root, data, ctx.project, pr, () => void showList(), now);
    else root.textContent = `Pull request ${pr.pr.key}`;
    if (!root.querySelector('[data-action="back"]')) {
      const back = h('button', { class: 'md-link', 'data-action': 'back', onclick: () => void showList() }, 'All pull requests');
      root.querySelector('.md')?.prepend(back) ?? root.prepend(back);
    }
  }

  if (ctx.kind === 'pr') {
    const pr = await data.loadPullRequest(ctx.project, ctx.pr);
    if (pr) {
      await showDetail(pr);
      return;
    }
    await showList(h('div', { class: 'md-note' }, `Pull request ${ctx.pr} was not found. It may have been deleted by Sonar housekeeping. Showing all pull requests.`));
    return;
  }
  if (ctx.kind === 'branch') {
    await showList(h('div', { class: 'md-note' }, `This page shows pull requests only. The "${ctx.name}" branch is not summarized.`));
    return;
  }
  await showList();
}
