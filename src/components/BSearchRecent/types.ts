import type { StoredFile } from '@/shared/storage';

export interface BSearchRecentProps {
  maxHeight?: number;
}

export interface BSearchRecentEmits {
  (e: 'select', file: StoredFile): void;
  (e: 'remove', id: string): void;
}
