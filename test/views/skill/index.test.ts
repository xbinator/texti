/**
 * @file index.test.ts
 * @description 验证 Skill 详情页在顶部标签切换期间保留当前文件状态。
 * @vitest-environment jsdom
 */
import type { Ref } from 'vue';
import { defineComponent, nextTick, ref } from 'vue';
import { shallowMount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SkillDefinition } from '@/ai/skill/types';
import SkillPage from '@/views/skill/index.vue';

/** 路由测试状态，允许模拟顶部标签切换。 */
const routerMocks = vi.hoisted(() => ({
  route: { params: { name: 'weather' as string | undefined } }
}));

/** Skill 查询测试替身。 */
const getSkillMock = vi.hoisted(() => vi.fn<(name: string) => SkillDefinition | undefined>());

vi.mock('vue-router', async (): Promise<{ useRoute: () => typeof routerMocks.route }> => {
  const { reactive } = await import('vue');
  routerMocks.route = reactive(routerMocks.route);

  return { useRoute: () => routerMocks.route };
});

vi.mock('@/hooks/useClipboard', () => ({
  useClipboard: (): { clipboard: ReturnType<typeof vi.fn> } => ({ clipboard: vi.fn() })
}));

vi.mock('@/stores/ai/skill', () => ({
  useSkillStore: (): { getSkillByName: typeof getSkillMock } => ({ getSkillByName: getSkillMock })
}));

/** 测试用 Skill 定义。 */
const skill: SkillDefinition = {
  name: 'weather',
  description: 'Weather instructions',
  content: 'Use the weather service.',
  filePath: '/Users/test/.agents/skills/weather/SKILL.md',
  dirPath: '/Users/test/.agents/skills/weather',
  source: 'global',
  enabled: true,
  parsedAt: 1
};

/** 保存内部文件选择的 BSkill 测试替身。 */
const BSkillStub = defineComponent({
  name: 'BSkill',
  props: {
    initialFilePath: { type: String, default: '' }
  },
  setup(props): { selectedFilePath: Ref<string>; selectReference: () => void } {
    const selectedFilePath = ref(props.initialFilePath);

    /** 模拟用户在文件树中选择引用文件。 */
    function selectReference(): void {
      selectedFilePath.value = '/Users/test/.agents/skills/weather/references/runtime.md';
    }

    return { selectedFilePath, selectReference };
  },
  template: '<button class="selected-file" @click="selectReference">{{ selectedFilePath }}</button>'
});

describe('skill page tab lifecycle', (): void => {
  beforeEach((): void => {
    routerMocks.route.params.name = 'weather';
    getSkillMock.mockReset();
    getSkillMock.mockImplementation((name: string): SkillDefinition | undefined => (name === skill.name ? skill : undefined));
  });

  it('keeps the selected file when the global route switches away and back', async (): Promise<void> => {
    const wrapper = shallowMount(SkillPage, {
      global: {
        stubs: { BSkill: BSkillStub }
      }
    });
    const selectedFile = wrapper.get('.selected-file');

    await selectedFile.trigger('click');
    expect(selectedFile.text()).toContain('references/runtime.md');

    routerMocks.route.params.name = undefined;
    await nextTick();
    routerMocks.route.params.name = 'weather';
    await nextTick();

    expect(wrapper.get('.selected-file').text()).toContain('references/runtime.md');
  });
});
