import { describe, expect, it } from 'vitest';
import { parseContext } from '../src/context';

describe('parseContext', () => {
  it('project without a branch-like is the project page', () => {
    expect(parseContext({ component: { key: 'p' } })).toEqual({ kind: 'project', project: 'p' });
  });
  it('a pull request branch-like', () => {
    expect(parseContext({ component: { key: 'p' }, branchLike: { key: '14', title: 't', branch: 'f', base: 'main' } })).toEqual({
      kind: 'pr', project: 'p', pr: '14',
    });
  });
  it('the main branch is the default landing view, so it is the plain project view', () => {
    expect(parseContext({ component: { key: 'p' }, branchLike: { name: 'main', isMain: true } })).toEqual({ kind: 'project', project: 'p' });
  });
  it('a non-main named branch', () => {
    expect(parseContext({ component: { key: 'p' }, branchLike: { name: 'release-1', isMain: false } })).toEqual({
      kind: 'branch', project: 'p', name: 'release-1',
    });
  });
  it('missing or odd options fall back to an empty project', () => {
    expect(parseContext(undefined)).toEqual({ kind: 'project', project: '' });
    expect(parseContext({ component: { key: 'p' }, branchLike: 'weird' })).toEqual({ kind: 'project', project: 'p' });
  });
});
