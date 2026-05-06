/**
 * @file fileSelectionIntent.ts
 * @description 存储一次性的文件选区定位意图，供 editor 页面消费。
 */

import { defineStore } from 'pinia';

/**
 * 文件选区意图。
 */
export interface FileSelectionIntent {
  /** 本次意图唯一标识 */
  intentId: string;
  /** 目标文件 ID */
  fileId: string;
  /** 起始行号（1-based） */
  startLine: number;
  /** 结束行号（1-based） */
  endLine: number;
}

/**
 * 文件选区意图 Store 状态。
 */
interface FileSelectionIntentState {
  /** 待 editor 页面消费的一次性选区意图 */
  intent: FileSelectionIntent | null;
}

/**
 * editor 页面消费的一次性文件选区意图状态。
 */
export const useFileSelectionIntentStore = defineStore('fileSelectionIntent', {
  state: (): FileSelectionIntentState => ({
    intent: null
  }),

  actions: {
    /**
     * 写入新的文件选区意图。
     * @param nextIntent - 待消费的文件选区意图
     */
    setIntent(nextIntent: FileSelectionIntent): void {
      this.intent = nextIntent;
    },

    /**
     * 仅当 intentId 匹配时清除当前意图，避免误清后续点击生成的新状态。
     * @param intentId - 待清除的意图 ID
     */
    clearIntent(intentId: string): void {
      if (this.intent?.intentId === intentId) {
        this.intent = null;
      }
    }
  }
});
