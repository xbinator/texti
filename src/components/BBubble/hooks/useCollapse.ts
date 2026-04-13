import type { BBubbleCollapseOptions, BBubbleProps } from '../types';
import { computed, nextTick, reactive, toValue, watch, type MaybeRefOrGetter, type Ref } from 'vue';

type CollapseState = MaybeRefOrGetter<Pick<BBubbleProps, 'isCollapse' | 'state'>>;

export function useCollapse(el: Ref<HTMLElement | undefined>, state: CollapseState, options?: BBubbleCollapseOptions) {
  const { maxHeight = 200, defaultValue = false } = options || {};

  const collapse = reactive({ value: false, visible: defaultValue });

  const _state = computed(() => toValue(state).state);
  const _isCollapse = computed(() => toValue(state).isCollapse);

  function toggleCollapse(): void {
    if (!el.value) return;
    collapse.value = !collapse.value;
  }

  function updateShowCollapse(): void {
    if (!el.value || _state.value !== 'complete' || !_isCollapse.value) return;
    collapse.visible = el.value.scrollHeight > maxHeight;
  }

  function updateElementStyle(): void {
    if (!el.value) return;
    el.value.style.overflow = collapse.value ? 'hidden' : '';
    el.value.style.maxHeight = collapse.value ? `${maxHeight}px` : '';
  }

  watch(
    () => _state.value,
    () => nextTick(updateShowCollapse),
    { immediate: true }
  );

  watch(
    () => collapse.value,
    () => nextTick(updateElementStyle),
    { immediate: true }
  );

  return { collapse, toggleCollapse, updateShowCollapse };
}
