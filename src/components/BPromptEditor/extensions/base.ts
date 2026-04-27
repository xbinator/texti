/**
 * @file base.ts
 * @description BPromptEditor 可动态配置的 Compartment 实例
 */

import { Compartment } from '@codemirror/state';

/**
 * 编辑状态 Compartment（控制是否可编辑）
 */
export const editableCompartment = new Compartment();

/**
 * 只读状态 Compartment（控制是否只读）
 */
export const readOnlyCompartment = new Compartment();

/**
 * 主题 Compartment（动态 maxHeight 等样式配置）
 */
export const themeCompartment = new Compartment();
