/**
 * @file index.test.ts
 * @description 验证 BSkill 文件预览头部的编辑器入口。
 * @vitest-environment jsdom
 */
import { flushPromises, shallowMount, type VueWrapper } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FileTree from '@/components/BSkill/components/FileTree.vue';
import BSkill from '@/components/BSkill/index.vue';
import type { BSkillProps } from '@/components/BSkill/types';

const openFileByPathMock = vi.hoisted(() => vi.fn());
const readFileMock = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useClipboard', () => ({
  useClipboard: () => ({ clipboard: vi.fn() })
}));

vi.mock('@/hooks/useNavigate', () => ({
  useNavigate: () => ({ openFileByPath: openFileByPathMock })
}));

vi.mock('@/shared/platform', () => ({
  native: { readFile: readFileMock }
}));

/**
 * 挂载 BSkill 并完成初始文件加载。
 * @param props - BSkill 属性
 * @returns 已完成文件加载的组件包装器
 */
async function mountSkill(props: BSkillProps): Promise<VueWrapper> {
  const wrapper = shallowMount(BSkill, {
    props,
    global: {
      stubs: {
        BPanelSplitter: { template: '<div><slot /></div>' },
        BScrollbar: { template: '<div><slot /></div>' },
        BButton: {
          name: 'BButton',
          props: ['tooltip', 'loading'],
          emits: ['click'],
          template: '<button :data-tooltip="tooltip" :data-loading="loading" @click="$emit(\'click\')"><slot /></button>'
        }
      }
    }
  });

  wrapper.findComponent(FileTree).vm.$emit('loaded', 1);
  await flushPromises();

  return wrapper;
}

describe('BSkill editor entry', (): void => {
  beforeEach((): void => {
    openFileByPathMock.mockReset();
    readFileMock.mockReset();
    openFileByPathMock.mockResolvedValue({ id: 'file-1' });
    readFileMock.mockResolvedValue({ content: '# Demo' });
  });

  it('opens the selected real file in the editor', async (): Promise<void> => {
    const filePath = '/skills/demo/SKILL.md';
    const wrapper = await mountSkill({ rootPath: '/skills/demo', initialFilePath: filePath, editable: true });
    const editIcon = wrapper.find('[icon="lucide:pencil"]');

    expect(editIcon.exists()).toBe(true);
    await editIcon.trigger('click');
    await flushPromises();

    expect(openFileByPathMock).toHaveBeenCalledWith(filePath);
  });

  it('keeps the editor entry disabled unless explicitly enabled', async (): Promise<void> => {
    const wrapper = await mountSkill({ rootPath: '/skills/demo', initialFilePath: '/skills/demo/SKILL.md' });

    expect(wrapper.find('[icon="lucide:pencil"]').exists()).toBe(false);
    expect(openFileByPathMock).not.toHaveBeenCalled();
  });

  it('does not show the editor entry for virtual preview files', async (): Promise<void> => {
    const wrapper = await mountSkill({ virtualFiles: [{ path: 'SKILL.md', content: '# Demo' }], initialFilePath: 'SKILL.md', editable: true });
    const editIcon = wrapper.find('[icon="lucide:pencil"]');

    expect(editIcon.exists()).toBe(false);
    expect(openFileByPathMock).not.toHaveBeenCalled();
  });

  it('keeps the user selected file when the tree reloads', async (): Promise<void> => {
    const initialFilePath = '/skills/demo/SKILL.md';
    const selectedFilePath = '/skills/demo/references/runtime.md';
    const wrapper = await mountSkill({ rootPath: '/skills/demo', initialFilePath, editable: true });
    const fileTree = wrapper.findComponent(FileTree);

    readFileMock.mockClear();
    fileTree.vm.$emit('select-file', selectedFilePath);
    await flushPromises();

    fileTree.vm.$emit('loaded', 2);
    await flushPromises();

    expect(readFileMock).toHaveBeenLastCalledWith(selectedFilePath);
    expect(readFileMock).not.toHaveBeenCalledWith(initialFilePath);
  });
});
