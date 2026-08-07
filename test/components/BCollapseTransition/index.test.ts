/**
 * @file index.test.ts
 * @description BCollapseTransition 折叠动画行为测试。
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs';
import type { ComponentPublicInstance } from 'vue';
import { defineComponent, h, nextTick } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import BCollapseTransition from '@/components/BCollapseTransition/index.vue';

/** 折叠动画组件源码。 */
const COLLAPSE_SOURCE = readFileSync('src/components/BCollapseTransition/index.vue', 'utf8');

/** Transition 组件透传给测试替身的钩子集合。 */
interface TransitionHookAttrs {
  /** 进入前钩子 */
  onBeforeEnter: (el: HTMLElement) => void;
  /** 进入钩子 */
  onEnter: (el: HTMLElement) => void;
  /** 进入后钩子 */
  onAfterEnter: (el: HTMLElement) => void;
  /** 离开前钩子 */
  onBeforeLeave: (el: HTMLElement) => void;
  /** 离开钩子 */
  onLeave: (el: HTMLElement) => void;
  /** 离开后钩子 */
  onAfterLeave: (el: HTMLElement) => void;
}

/** 捕获 Transition 钩子的组件实例。 */
interface TransitionProbeInstance extends ComponentPublicInstance {
  /** 获取当前 Transition 钩子 */
  getHooks: () => TransitionHookAttrs;
}

/** Transition 测试替身，暴露动画钩子便于断言。 */
const TransitionProbe = defineComponent({
  name: 'Transition',
  setup(_props, context): () => ReturnType<typeof h> {
    /**
     * 暴露当前渲染收到的过渡钩子。
     * @returns 过渡钩子集合
     */
    function getHooks(): TransitionHookAttrs {
      return context.attrs as unknown as TransitionHookAttrs;
    }

    context.expose({ getHooks });

    return (): ReturnType<typeof h> => h('div', { 'data-test': 'transition-probe' }, context.slots.default?.());
  }
});

/**
 * 挂载折叠动画组件。
 * @returns 已挂载的组件包装器
 */
function mountTransition(): VueWrapper {
  return mount(BCollapseTransition, {
    slots: {
      default: '<div data-test="collapse-body">内容</div>'
    },
    global: {
      stubs: {
        transition: TransitionProbe,
        Transition: TransitionProbe
      }
    }
  });
}

/**
 * 获取测试替身捕获到的 Transition 钩子。
 * @param wrapper - 折叠动画组件包装器
 * @returns Transition 钩子集合
 */
function getTransitionHooks(wrapper: VueWrapper): TransitionHookAttrs {
  const probe = wrapper.getComponent<TransitionProbeInstance>(TransitionProbe);
  const exposed = probe.vm.$.exposed as { getHooks?: () => TransitionHookAttrs } | null;

  if (!exposed?.getHooks) {
    throw new Error('Transition hooks were not exposed by the probe component.');
  }

  return exposed.getHooks();
}

describe('BCollapseTransition', (): void => {
  it('uses border-box sizing during active height transitions', (): void => {
    expect(COLLAPSE_SOURCE).toContain('box-sizing: border-box;');
  });

  it('keeps the expanded height for one frame before collapsing', async (): Promise<void> => {
    const wrapper = mountTransition();
    const hooks = getTransitionHooks(wrapper);
    const el = wrapper.get('[data-test="collapse-body"]').element as HTMLElement;

    Object.defineProperty(el, 'scrollHeight', {
      configurable: true,
      value: 80
    });

    hooks.onBeforeLeave(el);
    hooks.onLeave(el);

    expect(el.style.height).toBe('80px');

    await nextTick();
    await new Promise<void>((resolve: () => void): void => {
      requestAnimationFrame((): void => resolve());
    });

    expect(el.style.height).toBe('0px');
  });

  it('measures enter height after restoring vertical padding', async (): Promise<void> => {
    const wrapper = mountTransition();
    const hooks = getTransitionHooks(wrapper);
    const el = wrapper.get('[data-test="collapse-body"]').element as HTMLElement;

    Object.defineProperty(el, 'scrollHeight', {
      configurable: true,
      get: (): number => (el.style.paddingBottom === '0px' ? 80 : 90)
    });

    hooks.onBeforeEnter(el);
    hooks.onEnter(el);

    await nextTick();
    await new Promise<void>((resolve: () => void): void => {
      requestAnimationFrame((): void => resolve());
    });

    expect(el.style.paddingBottom).toBe('');
    expect(el.style.height).toBe('90px');
  });
});
