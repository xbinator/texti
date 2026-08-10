/**
 * @file custom.ts
 * @description Custom theme configuration schema for persisted user themes.
 */
import type { ThemeTokenOverrides } from '../core/factory';

/**
 * Persisted custom theme configuration.
 */
export interface CustomThemeConfig {
  /** Schema version for future migrations. */
  schemaVersion: 1;
  /** Theme preset ID. */
  id: string;
  /** Theme preset display label. */
  label: string;
  /** Theme atmosphere description shown to users and AI tools. */
  description?: string;
  /** Light mode token overrides. */
  light: ThemeTokenOverrides;
  /** Dark mode token overrides. */
  dark: ThemeTokenOverrides;
}
