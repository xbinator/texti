import type { DropdownOptionDivider, DropdownOptionItem } from '../BDropdown/type';

export interface ToolbarOption extends DropdownOptionItem {
  selected?: boolean;
  active?: boolean;
  shortcut?: string;
  enableShortcut?: boolean;
}

export type ToolbarOptions = Array<ToolbarOption | DropdownOptionDivider>;
