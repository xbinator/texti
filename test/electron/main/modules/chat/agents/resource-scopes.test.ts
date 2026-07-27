/**
 * @file resource-scopes.test.ts
 * @description 验证 Child 只读资源引用只能解析为工作区内的真实路径范围。
 */
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentResourceReference } from 'types/chat-agent';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveAgentScopes, scopesOverlap } from '../../../../../../electron/main/modules/chat/agents/resource-scopes.mjs';

describe('agent resource scopes', (): void => {
  let fixtureRoot: string;
  let workspaceRoot: string;
  let outsideRoot: string;

  beforeEach((): void => {
    fixtureRoot = mkdtempSync(join(tmpdir(), 'tibis-agent-scopes-'));
    workspaceRoot = join(fixtureRoot, 'workspace');
    outsideRoot = join(fixtureRoot, 'outside');
    mkdirSync(join(workspaceRoot, 'src'), { recursive: true });
    mkdirSync(outsideRoot, { recursive: true });
    writeFileSync(join(workspaceRoot, 'CONTEXT.md'), '# Tibis\n');
    writeFileSync(join(workspaceRoot, 'src', 'index.ts'), 'export const name = "tibis"\n');
    writeFileSync(join(outsideRoot, 'secret.txt'), 'secret\n');
  });

  afterEach((): void => {
    rmSync(fixtureRoot, { recursive: true, force: true });
  });

  it('canonicalizes file and directory references into sorted unique realpath scopes', (): void => {
    const resources: AgentResourceReference[] = [
      { kind: 'directory', reference: 'src' },
      { kind: 'file', reference: 'CONTEXT.md' },
      { kind: 'file', reference: './CONTEXT.md' }
    ];

    const result = resolveAgentScopes(resources, workspaceRoot);

    expect(result).toEqual({
      ok: true,
      workspaceRealRoot: realpathSync(workspaceRoot),
      resourceScopes: [`directory:${realpathSync(join(workspaceRoot, 'src'))}/**`, `file:${realpathSync(join(workspaceRoot, 'CONTEXT.md'))}`]
    });
  });

  it.each([
    ['missing target', { kind: 'file', reference: 'missing.md' }],
    ['unsaved target', { kind: 'file', reference: 'unsaved://draft/CONTEXT.md' }],
    ['relative escape', { kind: 'file', reference: '../outside/secret.txt' }],
    ['absolute escape', { kind: 'file', reference: 'OUTSIDE_PATH' }],
    ['absolute internal target', { kind: 'file', reference: 'WORKSPACE_PATH' }],
    ['kind mismatch', { kind: 'directory', reference: 'CONTEXT.md' }],
    ['unsupported resource', { kind: 'document', reference: 'document-1' }]
  ] as const)('rejects %s without returning a partial scope set', (_caseName, resource): void => {
    let { reference }: { reference: string } = resource;
    if (resource.reference === 'OUTSIDE_PATH') reference = join(outsideRoot, 'secret.txt');
    if (resource.reference === 'WORKSPACE_PATH') reference = join(workspaceRoot, 'CONTEXT.md');

    const result = resolveAgentScopes([{ kind: resource.kind, reference }], workspaceRoot);

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'resource_scope_invalid',
        phase: 'resource_validation',
        category: 'resource'
      }
    });
  });

  it('allows internal symlinks after canonicalization and rejects symlink escapes', (): void => {
    symlinkSync(join(workspaceRoot, 'CONTEXT.md'), join(workspaceRoot, 'context-link.md'));
    symlinkSync(join(outsideRoot, 'secret.txt'), join(workspaceRoot, 'secret-link.txt'));

    expect(resolveAgentScopes([{ kind: 'file', reference: 'context-link.md' }], workspaceRoot)).toEqual({
      ok: true,
      workspaceRealRoot: realpathSync(workspaceRoot),
      resourceScopes: [`file:${realpathSync(join(workspaceRoot, 'CONTEXT.md'))}`]
    });
    expect(resolveAgentScopes([{ kind: 'file', reference: 'secret-link.txt' }], workspaceRoot)).toMatchObject({
      ok: false,
      error: {
        code: 'resource_scope_invalid',
        details: { reason: 'resource_outside_workspace' }
      }
    });
  });

  it.each([
    ['same file', 'file:/repo/a.md', 'file:/repo/a.md', true],
    ['different files', 'file:/repo/a.md', 'file:/repo/b.md', false],
    ['directory contains file', 'directory:/repo/**', 'file:/repo/a.md', true],
    ['file is outside sibling directory', 'directory:/repo/a/**', 'file:/repo/b.md', false],
    ['parent and child directories', 'directory:/repo/**', 'directory:/repo/src/**', true],
    ['sibling directories', 'directory:/repo/a/**', 'directory:/repo/b/**', false]
  ] as const)('detects overlap for %s', (_caseName, left, right, expected): void => {
    expect(scopesOverlap(left, right)).toBe(expected);
    expect(scopesOverlap(right, left)).toBe(expected);
  });

  it.each(['file:relative.md', 'directory:/repo/*', 'directory:relative/**', 'unknown:/repo/a.md', ' file:/repo/a.md'])(
    'fails closed for invalid canonical scope %s',
    (scope): void => {
      expect((): boolean => scopesOverlap(scope, 'file:/repo/a.md')).toThrow(
        expect.objectContaining({
          code: 'protocol_error',
          reason: 'canonical_resource_scope_invalid'
        })
      );
    }
  );
});
