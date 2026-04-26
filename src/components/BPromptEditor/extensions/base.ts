/**
 * @file base.ts
 * @description BPromptEditor 基础扩展组件集合
 */

import { Compartment, EditorState } from '@codemirror/state'
import { EditorView, keymap, placeholder } from '@codemirror/view'
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  insertNewline,
} from '@codemirror/commands'
import type { Ref } from 'vue'
import type { Extension } from '@codemirror/state'
import type { BPromptEditorProps } from '../types'

/**
 * 可编辑状态 Compartments
 */
export const editableCompartment = new Compartment()
export const readOnlyCompartment = new Compartment()
export const themeCompartment = new Compartment()

/**
 * 添加 CSS 单位辅助函数
 * @param value - 数值或字符串值
 * @returns 带单位的字符串或 undefined
 */
function addCssUnit(value: string | number | undefined): string | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'number') return `${value}px`
  return value
}

/**
 * 创建基础扩展集合
 * @description 包含历史记录、键映射、占位符等基础扩展
 * @param params - 扩展参数
 * @returns CodeMirror 扩展数组
 */
export function createBaseExtensions(params: {
  props: BPromptEditorProps
  resolvedMaxHeight: Ref<string | number | undefined>
  submitOnEnter: Ref<boolean>
  emit: (event: 'submit') => void
  modelSyncExtension: Extension
  variableChipField: Extension
  triggerStateField: Extension
  triggerPlugin: Extension
}): Extension[] {
  const { props, submitOnEnter, emit } = params

  // 自定义 Enter 键处理器
  const submitKeymap = keymap.of([
    {
      key: 'Enter',
      run: () => {
        if (submitOnEnter.value) {
          emit('submit')
          return true
        }
        return false
      },
    },
    {
      key: 'Shift-Enter',
      run: insertNewline,
    },
    indentWithTab,
  ])

  const extensions: Extension[] = [
    // 历史记录扩展
    history(),

    // 自定义键映射（Enter 提交、Shift-Enter 换行、Tab 缩进）
    submitKeymap,

    // 默认键映射和历史键映射
    keymap.of([...defaultKeymap, ...historyKeymap]),

    // 占位符扩展
    props.placeholder ? placeholder(props.placeholder) : [],
  ]

  return extensions
}
