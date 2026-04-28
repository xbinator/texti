/**
 * @file slashCommands.ts
 * @description Chat sidebar slash command registry metadata.
 */
import type { SlashCommandOption } from '@/components/BPromptEditor/types';

/**
 * First-version chat slash commands exposed in trigger order.
 */
export const chatSlashCommands: readonly SlashCommandOption[] = [
  {
    id: 'model',
    trigger: '/model',
    title: 'Model',
    description: 'Switch the active model.',
    type: 'action'
  },
  {
    id: 'usage',
    trigger: '/usage',
    title: 'Usage',
    description: 'Show current session token usage.',
    type: 'action'
  },
  {
    id: 'new',
    trigger: '/new',
    title: 'New Chat',
    description: 'Start a new chat session.',
    type: 'action'
  },
  {
    id: 'clear',
    trigger: '/clear',
    title: 'Clear Draft',
    description: 'Clear the current chat input.',
    type: 'action'
  }
];
