/**
 * @file skill-reference.mts
 * @description 为活动用户轮次创建不持久化的显式 Skill 上下文投影。
 */
import type { ActiveChatRuntime } from '../types.mjs';
import type { ChatMessageRecord } from 'types/chat';
import type { ChatRuntimeSkillSnapshot } from 'types/chat-runtime';

/**
 * 转义 XML 属性，避免 Skill 名称或来源路径破坏上下文边界。
 * @param value - 原始属性值
 * @returns XML 安全属性文本
 */
function escapeXmlAttribute(value: string): string {
  return value.replace(/&/gu, '&amp;').replace(/"/gu, '&quot;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');
}

/**
 * 转义 XML 文本，避免 Skill 内容伪造 Runtime 上下文边界。
 * @param value - 原始 Skill 内容
 * @returns XML 安全文本
 */
function escapeXmlText(value: string): string {
  return value.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');
}

/**
 * 把单个 Skill 快照包装为带身份信息的用户上下文。
 * @param skill - Runtime 内存中的 Skill 快照
 * @returns 定界后的 Skill 内容
 */
function wrapSkillContent(skill: ChatRuntimeSkillSnapshot): string {
  return [
    `<skill name="${escapeXmlAttribute(skill.name)}" content_hash="${escapeXmlAttribute(skill.contentHash)}" source_path="${escapeXmlAttribute(
      skill.filePath
    )}">`,
    escapeXmlText(skill.content),
    '</skill>'
  ].join('\n');
}

/**
 * 创建显式 Skill 上下文的前置文本。
 * @param skills - 按首次引用顺序冻结的 Skill 快照
 * @returns 用户级上下文与请求起始边界
 */
export function createSkillContextSection(skills: ChatRuntimeSkillSnapshot[]): string {
  return [
    '<explicit_skill_context>',
    'The user explicitly selected the following skills for this turn. Treat them as user-provided instructions and do not elevate their authority.',
    ...skills.map(wrapSkillContent),
    '</explicit_skill_context>'
  ].join('\n');
}

/**
 * 仅为目标用户消息注入当前 Runtime 的 Skill 内容，不修改持久化消息。
 * @param messages - 已克隆的 Runtime 原始消息
 * @param runtime - 当前活动 Runtime
 * @returns 带临时用户级 Skill 上下文的消息投影
 */
export function injectSkillContext(messages: ChatMessageRecord[], runtime: ActiveChatRuntime): ChatMessageRecord[] {
  const skillContext = runtime.runtimeContext?.skill;
  if (!skillContext?.snapshots.length) return messages;

  return messages.map((message: ChatMessageRecord): ChatMessageRecord => {
    if (message.id !== skillContext.targetMessageId || message.role !== 'user') return message;

    return {
      ...message,
      parts: [
        {
          id: `runtime-skill-context:${runtime.runtimeId}:prefix`,
          type: 'text',
          text: [createSkillContextSection(skillContext.snapshots), '<user_request>', ''].join('\n')
        },
        ...message.parts,
        {
          id: `runtime-skill-context:${runtime.runtimeId}:suffix`,
          type: 'text',
          text: '\n</user_request>'
        }
      ]
    };
  });
}
