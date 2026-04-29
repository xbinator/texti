/**
 * @file slashCommands.ts
 * @description 聊天侧边栏斜杠命令注册元数据。
 */
import type { SlashCommandOption } from '@/components/BPromptEditor/types';

/**
 * 第一版聊天斜杠命令（按触发顺序）。
 */
export const chatSlashCommands: SlashCommandOption[] = [
  {
    id: 'model',
    trigger: '/model',
    title: '模型',
    description: '切换当前使用的模型。',
    type: 'action'
  },
  {
    id: 'usage',
    trigger: '/usage',
    title: '使用情况',
    description: '显示当前会话的 token 使用情况。',
    type: 'action'
  },
  {
    id: 'new',
    trigger: '/new',
    title: '新建聊天',
    description: '开始一个新的聊天会话。',
    type: 'action'
  },
  {
    id: 'clear',
    trigger: '/clear',
    title: '清空输入',
    description: '清除当前聊天输入内容。',
    type: 'action'
  }
];
