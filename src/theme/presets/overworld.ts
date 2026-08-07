/**
 * @file overworld.ts
 * @description Overworld 复古冒险主题预设，融合纸面、钴蓝天空、墨线像素边和苔藓绿语义色。
 */
import type { BasePalette, ThemeTokenOverrides } from '../core/factory';
import { createThemeTokens } from '../core/factory';
import { registerPreset } from '../core/registry';

/**
 * Overworld 输入框覆盖类型。
 */
type OverworldInputOverrides = NonNullable<ThemeTokenOverrides['input']>;

/**
 * Overworld 输入框共用 Token 覆盖。
 */
const overworldInputOverrides: OverworldInputOverrides = {
  radius: '0px',
  borderWidth: '2px',
  paddingInline: '12px',
  paddingBlock: '0px',
  gap: '10px',
  keycapSize: '28px',
  keycapRadius: '0px',
  keycapBorderWidth: '2px',
  keycapShadow: 'none'
};

/**
 * Overworld 设计 Token 覆盖。
 */
const overworldDesignOverrides: ThemeTokenOverrides = {
  radius: {
    none: '0',
    xs: '0px',
    sm: '0px',
    md: '0px',
    lg: '0px',
    xl: '0px',
    full: '0px'
  },
  borderWidth: {
    hairline: '1px',
    thin: '2px',
    strong: '2px'
  },
  font: {
    sans: '"Pixelify Sans", "VT323", ui-monospace, monospace',
    mono: '"VT323", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
  },
  motion: {
    durationFast: '90ms',
    durationBase: '140ms',
    durationSlow: '220ms',
    easingStandard: 'ease',
    easingPress: 'cubic-bezier(0.2, 0, 0, 1)'
  },
  control: {
    radius: '0px',
    borderWidth: '2px',
    focusRingWidth: '3px'
  },
  input: overworldInputOverrides,
  surface: {
    radius: '0px',
    borderWidth: '2px'
  },
  overlay: {
    radius: '0px',
    borderWidth: '2px'
  },
  interaction: {
    pressOffset: '2px',
    raisedShadow: '2px 2px 0 0 #161310',
    pressedShadow: 'none'
  },
  button: {
    border: '#161310',
    borderWidth: '2px',
    shadow: '2px 2px 0 0 #161310',
    activeShadow: '2px 2px 0 0 #2e5dd6',
    pressedShadow: 'none'
  }
};

/**
 * Overworld 亮色基础色板。
 */
const overworldLight: BasePalette = {
  bg0: '#fffaef',
  bg1: '#f1e6d2',
  bg2: '#eadcc3',
  bg3: '#fffaf0',
  bg4: '#d8c7a8',
  fg0: '#161310',
  fg1: '#3f382f',
  fg2: '#7a6e5c',
  red: '#e2522e',
  green: '#2f7554',
  yellow: '#c28b26',
  blue: '#2e5dd6',
  purple: '#6e57b7',
  orange: '#e2522e',
  cyan: '#2e9eb3',
  syntaxComment: '#8b806d',
  syntaxKeyword: '#2e5dd6',
  syntaxString: '#2f7554',
  syntaxFunction: '#161310',
  syntaxNumber: '#c28b26',
  syntaxType: '#2e9eb3',
  syntaxVariable: '#3f382f',
  syntaxOperator: '#161310',
  syntaxTag: '#e2522e',
  syntaxAttribute: '#2e5dd6',
  accent: '#2e5dd6',
  border: '#161310',
  selectionBg: '#c8d7ff'
};

/**
 * Overworld 暗色基础色板。
 */
const overworldDark: BasePalette = {
  bg0: '#10131f',
  bg1: '#171b2a',
  bg2: '#20263a',
  bg3: '#2b3248',
  bg4: '#39415d',
  fg0: '#fff4df',
  fg1: '#d9cdb7',
  fg2: '#9b8f7a',
  red: '#ff6a45',
  green: '#65b889',
  yellow: '#f0b24b',
  blue: '#5f8cff',
  purple: '#a890ff',
  orange: '#ff6a45',
  cyan: '#65d6e8',
  syntaxComment: '#9b8f7a',
  syntaxKeyword: '#5f8cff',
  syntaxString: '#65b889',
  syntaxFunction: '#fff4df',
  syntaxNumber: '#f0b24b',
  syntaxType: '#65d6e8',
  syntaxVariable: '#d9cdb7',
  syntaxOperator: '#fff4df',
  syntaxTag: '#ff6a45',
  syntaxAttribute: '#5f8cff',
  accent: '#5f8cff',
  border: '#fff4df',
  selectionBg: '#253f87'
};

registerPreset({
  id: 'overworld',
  label: '复古冒险「Overworld」',
  light: createThemeTokens(overworldLight, 'light', {
    ...overworldDesignOverrides,
    color: {
      warning: '#e2522e',
      warningBg: 'rgb(226 82 46 / 14%)',
      warningBorder: '#e2522e',
      orange: '#e2522e'
    },
    input: {
      ...overworldInputOverrides,
      bg: '#fffaef',
      border: '#161310',
      focusBorder: '#2e5dd6',
      placeholderColor: 'rgb(58 51 42 / 70%)',
      iconColor: '#161310',
      shadow: '2px 2px 0 0 #161310',
      activeShadow: '2px 2px 0 0 #2e5dd6',
      keycapBg: '#f2ead6',
      keycapColor: '#161310'
    }
  }),
  dark: createThemeTokens(overworldDark, 'dark', {
    ...overworldDesignOverrides,
    color: {
      warning: '#ff6a45',
      warningBg: 'rgb(255 106 69 / 20%)',
      warningBorder: '#ff6a45',
      orange: '#ff6a45'
    },
    interaction: {
      pressOffset: '2px',
      raisedShadow: '2px 2px 0 0 #fff4df',
      pressedShadow: 'none'
    },
    button: {
      border: '#fff4df',
      borderWidth: '2px',
      shadow: '2px 2px 0 0 #fff4df',
      activeShadow: '2px 2px 0 0 #5f8cff',
      pressedShadow: 'none'
    },
    input: {
      ...overworldInputOverrides,
      bg: '#10131f',
      border: '#fff4df',
      focusBorder: '#5f8cff',
      placeholderColor: 'rgb(155 143 122 / 70%)',
      iconColor: '#fff4df',
      shadow: '2px 2px 0 0 #fff4df',
      activeShadow: '2px 2px 0 0 #5f8cff',
      keycapBg: '#171b2a',
      keycapColor: '#fff4df'
    }
  })
});
