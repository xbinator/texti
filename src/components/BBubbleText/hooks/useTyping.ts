import type { BBubbleTextProps } from '../types';
import type { ComputedRef, MaybeRefOrGetter, Ref } from 'vue';
import { computed, ref, toValue, unref, watch } from 'vue';
import { isString } from 'lodash-es';

type TypingConfig = Required<BBubbleTextProps['typing']> & object;

function useTyping(typing: MaybeRefOrGetter<BBubbleTextProps['typing']>, content: Ref<string>): [ComputedRef<string>, ComputedRef<boolean>] {
  const typingEnabled = computed(() => !!toValue(typing));

  const baseConfig: TypingConfig = { step: 5, interval: 50 };

  const config = computed(() => {
    const typingRaw = toValue(typing);
    return { ...baseConfig, ...(typeof typingRaw === 'object' ? typingRaw : {}) };
  });

  const typingStep = computed(() => config.value.step);
  const typingInterval = computed(() => config.value.interval);

  const prevContent = ref(content.value);
  const typingIndex = ref(1);

  const isEnabled = computed(() => typingEnabled.value && isString(content.value));

  let timer: ReturnType<typeof setTimeout> | null = null;

  function startTypingTimer(): void {
    typingIndex.value = unref(typingIndex) + typingStep.value;
    timer = null;
  }

  function closeTypingTimer(): void {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  watch(content, () => {
    const prevContentValue = unref(prevContent);
    prevContent.value = content.value;

    if (!isEnabled.value && isString(content.value)) {
      typingIndex.value = content.value.length;
    } else if (isString(content.value) && isString(prevContentValue) && content.value.indexOf(prevContentValue) !== 0) {
      typingIndex.value = 1;
      closeTypingTimer();
    }
  });

  watch(
    [typingIndex, typingEnabled, content],
    () => {
      if (isEnabled.value && isString(content.value) && unref(typingIndex) < content.value.length) {
        if (!timer) {
          timer = setTimeout(startTypingTimer, typingInterval.value);
        }
      }
    },
    { immediate: true }
  );

  const mergedContent = computed(() => (isEnabled.value ? content.value.slice(0, typingIndex.value) : content.value));

  const isTyping = computed(() => isEnabled.value && unref(typingIndex) < content.value.length);

  return [mergedContent, isTyping];
}

export default useTyping;
