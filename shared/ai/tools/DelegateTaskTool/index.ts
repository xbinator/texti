/**
 * @file index.ts
 * @description 受控 Child Agent 委派工具的内部 Schema 定义。
 */
import type { ToolRegistryEntry } from '../types.js';

/** 受控任务委派工具名称。 */
export const DELEGATE_TASK_TOOL_NAME = 'delegate_task';

/** 仅供协调器识别的延迟委派工具 registry 条目。 */
export const delegateTaskToolRegistryEntry = {
  runtime: 'coordinator',
  group: 'agent',
  exposure: 'internal',
  executionClass: 'deferred-coordination',
  effect: {
    effect: 'pure_read',
    resourceScopeResolver: 'delegate-contract',
    reversible: true
  },
  definition: {
    name: DELEGATE_TASK_TOOL_NAME,
    description: '提交一个有边界的任务契约，交由受控 Child Agent 执行。',
    source: 'builtin',
    riskLevel: 'read',
    requiresActiveDocument: false,
    permissionCategory: 'system',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['task', 'acceptanceCriteria', 'mode', 'resources', 'requestedTools', 'required', 'priority'],
      properties: {
        task: { type: 'string', minLength: 1 },
        acceptanceCriteria: {
          type: 'array',
          minItems: 1,
          items: { type: 'string', minLength: 1 }
        },
        mode: { type: 'string', enum: ['read', 'write'] },
        resources: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'reference'],
            properties: {
              kind: { type: 'string', enum: ['file', 'directory', 'document', 'webview', 'resource'] },
              reference: { type: 'string', minLength: 1 },
              revision: { type: 'string', minLength: 1 }
            }
          }
        },
        requestedTools: {
          type: 'array',
          uniqueItems: true,
          items: { type: 'string', minLength: 1 }
        },
        required: { type: 'boolean' },
        priority: { type: 'string', enum: ['low', 'normal', 'high'] },
        deadlineAt: { type: 'string', format: 'date-time' }
      }
    }
  }
} satisfies ToolRegistryEntry;
