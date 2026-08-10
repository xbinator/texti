/**
 * @file shonen.ts
 * @description Shonen 热血红黑主题预设，浅色为漫画纸张风格，暗色为高对比红黑风格。
 */
import type { BasePalette } from '../core/factory';
import { createThemeTokens } from '../core/factory';
import { registerPreset } from '../core/registry';

/**
 * Shonen 亮色基础色板。
 * 以暖白纸张、墨黑文字、朱红主色和金黄点缀模拟热血漫画分镜。
 */
const shonenLight: BasePalette = {
  bg0: '#fff8e7',
  bg1: '#f7ecd2',
  bg2: '#f0dfbb',
  bg3: '#e5cfa1',
  bg4: '#d7bc83',
  fg0: '#111111',
  fg1: '#40342c',
  fg2: '#75685f',
  red: '#e60012',
  green: '#008f5a',
  yellow: '#f6b800',
  blue: '#0057ff',
  purple: '#a100ff',
  orange: '#ff6b00',
  cyan: '#00a5d8',
  syntaxComment: '#75685f',
  syntaxKeyword: '#e60012',
  syntaxString: '#008f5a',
  syntaxFunction: '#0057ff',
  syntaxNumber: '#ff6b00',
  syntaxType: '#00a5d8',
  syntaxVariable: '#111111',
  syntaxOperator: '#40342c',
  syntaxTag: '#e60012',
  syntaxAttribute: '#0057ff',
  accent: '#e60012',
  border: '#2b211c',
  selectionBg: '#ffd3d6'
};

/**
 * Shonen 暗色基础色板。
 * 以近黑背景、猩红主色、金色警示和冷蓝辅助构成高对比战斗氛围。
 */
const shonenDark: BasePalette = {
  bg0: '#07070a',
  bg1: '#101014',
  bg2: '#181820',
  bg3: '#24242f',
  bg4: '#343443',
  fg0: '#fff3e0',
  fg1: '#ffd6a3',
  fg2: '#a89782',
  red: '#ff1f3d',
  green: '#5cff9d',
  yellow: '#ffd166',
  blue: '#4ea1ff',
  purple: '#ff4dff',
  orange: '#ff8a00',
  cyan: '#00f5ff',
  syntaxComment: '#827a70',
  syntaxKeyword: '#ff1f3d',
  syntaxString: '#5cff9d',
  syntaxFunction: '#4ea1ff',
  syntaxNumber: '#ffd166',
  syntaxType: '#00f5ff',
  syntaxVariable: '#fff3e0',
  syntaxOperator: '#ff8a00',
  syntaxTag: '#ff1f3d',
  syntaxAttribute: '#ffd166',
  accent: '#ff1f3d',
  border: '#3a1f2b',
  selectionBg: '#5c1020'
};

registerPreset({
  id: 'shonen',
  label: '热血红黑「Shonen」',
  description: '暖白/朱红/金黄/红黑',
  light: createThemeTokens(shonenLight, 'light'),
  dark: createThemeTokens(shonenDark, 'dark')
});
