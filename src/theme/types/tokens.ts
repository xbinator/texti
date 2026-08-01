/**
 * @file types/tokens.ts
 * @description 主题 Token 结构定义，与消费方（CSS 变量、Ant Design、Monaco）一一对应。
 */

/**
 * 主题 Token 结构定义。
 * 按语义分组，与现有 CSS 变量一一对应。
 */
export interface ThemeTokens {
  bg: {
    primary: string;
    secondary: string;
    tertiary: string;
    elevated: string;
    hover: string;
    active: string;
    selected: string;
    input: string;
    disabled: string;
  };
  text: {
    primary: string;
    secondary: string;
    tertiary: string;
    quaternary: string;
    disabled: string;
    placeholder: string;
  };
  border: {
    primary: string;
    secondary: string;
    tertiary: string;
    hover: string;
  };
  color: {
    primary: string;
    primaryHover: string;
    primaryActive: string;
    primaryBg: string;
    primaryBgHover: string;
    primaryBorder: string;
    controlOutline: string;
    success: string;
    successBg: string;
    warning: string;
    warningBg: string;
    warningBorder: string;
    error: string;
    errorBg: string;
    danger: string;
    dangerHover: string;
    dangerActive: string;
    info: string;
    orange: string;
    purple: string;
    purpleBg: string;
    purpleBorder: string;
    purpleHover: string;
  };
  /** 用量面板进度条语义色 */
  usagePanel: {
    input: string;
    output: string;
  };
  scrollbar: {
    bg: string;
    hover: string;
    active: string;
    lightBg: string;
    lightHover: string;
    lightActive: string;
  };
  shadow: {
    sm: string;
    md: string;
    lg: string;
    dropdown: string;
  };
  code: {
    bg: string;
    border: string;
    headerBg: string;
    lineBg: string;
    lineHoverBg: string;
    lineNumber: string;
    text: string;
    keyword: string;
    string: string;
    comment: string;
    function: string;
    number: string;
    operator: string;
    punctuation: string;
    property: string;
    tag: string;
    attrName: string;
    attrValue: string;
    builtin: string;
    boolean: string;
    class: string;
    constant: string;
    deleted: string;
    inserted: string;
    regex: string;
    symbol: string;
    variable: string;
  };
  /** TipTap 富文本编辑器 */
  richEditor: {
    text: string;
    placeholder: string;
    caret: string;
    headingBorder: string;
    blockquoteText: string;
    blockquoteBg: string;
    blockquoteBorder: string;
    link: string;
    hr: string;
    tableHeaderBg: string;
    tableBorder: string;
    tableEvenBg: string;
    searchHighlight: string;
    searchActive: string;
    searchActiveBorder: string;
  };
  /** Monaco 源码编辑器 Markdown token 高亮 */
  sourceEditor: {
    markdownBackground: string;
    markdownForeground: string;
    markdownCaret: string;
    markdownSelection: string;
    markdownSelectionMatch: string;
    markdownLineHighlight: string;
    markdownGutterForeground: string;
    markdownHeading1: string;
    markdownHeading2: string;
    markdownHeading3: string;
    markdownCode: string;
    markdownLink: string;
    markdownQuote: string;
    markdownStrikethrough: string;
    markdownBold: string;
    markdownItalic: string;
    markdownListMarker: string;
    markdownBlockquoteMarker: string;
    markdownHr: string;
    markdownLinkBracket: string;
    markdownLinkParen: string;
    markdownImageMarker: string;
    markdownCodeMarker: string;
    markdownCodeFence: string;
    markdownCodeInfo: string;
    markdownTablePipe: string;
    markdownTableAlign: string;
    markdownTaskBracket: string;
    markdownTaskUnchecked: string;
    markdownTaskChecked: string;
    markdownEscape: string;
  };
  /** Monaco 源码编辑器专有色值（与 richEditor 独立） */
  monaco: {
    foreground: string;
    lineHighlightBg: string;
    selectionBg: string;
    inactiveSelectionBg: string;
    lineNumber: string;
    lineNumberActive: string;
    cursor: string;
    gutterBg: string;
    indentGuide: string;
    indentGuideActive: string;
  };
  anchor: {
    text: string;
    hoverText: string;
    hoverBg: string;
  };
  dropdown: {
    bg: string;
    border: string;
    itemHoverBg: string;
    divider: string;
  };
  modal: {
    text: string;
    headerBg: string;
  };
  input: {
    radius: string;
    borderWidth: string;
    paddingInline: string;
    paddingBlock: string;
    gap: string;
    fontFamily: string;
    bg: string;
    border: string;
    focusBorder: string;
    focusShadow: string;
    placeholderColor: string;
    iconColor: string;
    shadow: string;
    activeShadow: string;
    keycapSize: string;
    keycapRadius: string;
    keycapBorderWidth: string;
    keycapBg: string;
    keycapColor: string;
    keycapShadow: string;
    errorText: string;
    errorBorder: string;
    errorShadow: string;
  };
  /** 按钮级语义 Token */
  button: {
    border: string;
    borderWidth: string;
    shadow: string;
    activeShadow: string;
    pressedShadow: string;
  };
  tag: {
    bg: string;
    hoverBg: string;
    text: string;
    secondaryText: string;
    placeholder: string;
  };
  hoverIndicator: {
    bg: string;
    border: string;
    text: string;
    hoverText: string;
    hoverBorder: string;
  };
  frontmatter: {
    bg: string;
    border: string;
    divider: string;
    keyText: string;
    valueText: string;
  };
  jsonViewer: {
    nodeBg: string;
    nodeBorder: string;
    rowDivider: string;
    key: string;
    value: string;
    number: string;
    boolean: string;
    null: string;
    edge: string;
    edgeLabel: string;
  };
  /** 基础圆角刻度 */
  radius: {
    none: string;
    xs: string;
    sm: string;
    md: string;
    lg: string;
    xl: string;
    full: string;
  };
  /** 基础边框宽度刻度 */
  borderWidth: {
    hairline: string;
    thin: string;
    strong: string;
  };
  /** 字体栈 */
  font: {
    sans: string;
    mono: string;
    display: string;
  };
  /** 动效时长和缓动 */
  motion: {
    durationFast: string;
    durationBase: string;
    durationSlow: string;
    easingStandard: string;
    easingPress: string;
  };
  /** 控件级语义 Token */
  control: {
    radius: string;
    borderWidth: string;
    focusRingWidth: string;
  };
  /** 表面级语义 Token */
  surface: {
    radius: string;
    borderWidth: string;
  };
  /** 弹层级语义 Token */
  overlay: {
    radius: string;
    borderWidth: string;
  };
  /** 交互效果语义 Token */
  interaction: {
    pressOffset: string;
    raisedShadow: string;
    pressedShadow: string;
  };
}
