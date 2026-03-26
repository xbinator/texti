export interface DropdownOption {
  value: string | number;
  label: string;
  icon?: string;
  iconSize?: number;
  class?: string;
  divider?: boolean;
  disabled?: boolean;
  danger?: boolean;
  color?: 'warn';
}
