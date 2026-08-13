/**
 * @file validate-widget.d.ts
 * @description Developing Widget 校验器的 TypeScript 调用契约。
 */

/** 单条 Widget 校验诊断。 */
export interface WidgetValidationDiagnostic {
  /** 诊断严重级别。 */
  severity: 'error' | 'warning';
  /** 诊断对应的 Widget JSON 路径。 */
  path: string;
  /** 可读诊断信息。 */
  message: string;
}

/** Widget 校验结果。 */
export interface WidgetValidationResult {
  /** 阻止 Widget 使用的错误。 */
  errors: WidgetValidationDiagnostic[];
  /** 不阻止 Widget 使用的提示。 */
  warnings: WidgetValidationDiagnostic[];
}

/**
 * 校验 Widget 包目录。
 * @param widgetDirectory - 包含 widget.json 的目录
 * @returns 聚合后的校验结果
 */
export function validateWidgetDirectory(widgetDirectory: string): Promise<WidgetValidationResult>;
