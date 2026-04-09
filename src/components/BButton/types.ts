export interface BButtonProps {
  type?: 'primary' | 'secondary' | 'outline' | 'text';
  size?: 'small' | 'middle' | 'large';
  disabled?: boolean;
  loading?: boolean;
  block?: boolean;
  rounded?: boolean;
  square?: boolean;
  icon?: string;
  text?: string;
  danger?: boolean;
}
