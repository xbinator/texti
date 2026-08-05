/**
 * @file modal.test.ts
 * @description 命令式确认弹窗关闭语义测试。
 * @vitest-environment jsdom
 */
import { nextTick } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Modal } from '@/utils/modal';

vi.mock('@/components/BModal/index.vue', () => ({
  default: {
    name: 'BModal',
    props: {
      open: { type: Boolean, default: false }
    },
    emits: ['close', 'update:open'],
    template: '<div v-if="open"><button type="button" class="modal-dismiss" @click="$emit(\'close\')">关闭</button><slot /><slot name="footer" /></div>'
  }
}));

vi.mock('@/components/BButton/index.vue', () => ({
  default: {
    name: 'BButton',
    emits: ['click'],
    template: '<button type="button" @click="$emit(\'click\')"><slot /></button>'
  }
}));

describe('Modal', (): void => {
  beforeEach((): void => {
    vi.useFakeTimers();
  });

  afterEach((): void => {
    vi.runAllTimers();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('resolves delete as cancelled when the modal is dismissed', async (): Promise<void> => {
    let result: [boolean, boolean] | undefined;
    const deletion = Modal.delete('确认删除');
    deletion.then((value: [boolean, boolean]): void => {
      result = value;
    });
    await nextTick();

    document.querySelector<HTMLButtonElement>('.modal-dismiss')?.click();
    await nextTick();

    expect(result).toEqual([true, false]);
  });

  it('resolves alert when the modal is dismissed', async (): Promise<void> => {
    let resolved = false;
    const alert = Modal.alert('提示', '无法继续');
    alert.then((): void => {
      resolved = true;
    });
    await nextTick();

    document.querySelector<HTMLButtonElement>('.modal-dismiss')?.click();
    await nextTick();

    expect(resolved).toBe(true);
  });

  it('resolves input as cancelled when the modal is dismissed', async (): Promise<void> => {
    let result: [false, string] | [true] | undefined;
    const input = Modal.input('重命名', { defaultValue: '旧文件名' });
    input.then((value: [false, string] | [true]): void => {
      result = value;
    });
    await nextTick();

    document.querySelector<HTMLButtonElement>('.modal-dismiss')?.click();
    await nextTick();

    expect(result).toEqual([true]);
  });
});
