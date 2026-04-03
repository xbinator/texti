import { computed, ref, watch, type ComputedRef, type Ref } from 'vue';
import yaml from 'js-yaml';

export interface FrontMatterData {
  [key: string]: unknown;
}

interface UseFrontMatterResult {
  bodyContent: Ref<string>;
  frontMatterData: Ref<FrontMatterData>;
  frontMatterRaw: Ref<string>;
  hasFrontMatter: ComputedRef<boolean>;
  updateFrontMatter: (data: FrontMatterData) => void;
  updateFrontMatterField: (key: string, value: unknown) => void;
  removeFrontMatterField: (key: string) => void;
  addFrontMatterField: (key: string, value: unknown) => void;
  reconstructContent: () => string;
  setBodyContent: (content: string) => void;
}

const FRONT_MATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function useFrontMatter(content: Ref<string | undefined>): UseFrontMatterResult {
  const frontMatterRaw = ref<string>('');
  const frontMatterData = ref<FrontMatterData>({});
  const bodyContent = ref<string>('');
  let isInternalUpdate = false;

  const hasFrontMatter = computed(() => Object.keys(frontMatterData.value).length > 0);

  function parseContent(rawContent: string): { frontMatter: string; body: string } {
    const match = rawContent.match(FRONT_MATTER_REGEX);

    if (match) {
      return {
        frontMatter: match[1],
        body: rawContent.slice(match[0].length)
      };
    }

    return {
      frontMatter: '',
      body: rawContent
    };
  }

  function parseFrontMatter(raw: string): FrontMatterData {
    if (!raw.trim()) {
      return {};
    }

    try {
      const result = yaml.load(raw);
      if (result && typeof result === 'object' && !Array.isArray(result)) {
        return result as FrontMatterData;
      }
      return {};
    } catch {
      return {};
    }
  }

  function reconstructContent(): string {
    if (!hasFrontMatter.value) {
      return bodyContent.value;
    }

    const yamlStr = yaml.dump(frontMatterData.value, {
      indent: 2,
      lineWidth: -1,
      noRefs: true,
      sortKeys: false
    });

    return `---\n${yamlStr}---\n${bodyContent.value}`;
  }

  function updateFrontMatter(data: FrontMatterData): void {
    frontMatterData.value = { ...data };
  }

  function updateFrontMatterField(key: string, value: unknown): void {
    frontMatterData.value = {
      ...frontMatterData.value,
      [key]: value
    };
  }

  function removeFrontMatterField(key: string): void {
    const newData = { ...frontMatterData.value };
    delete newData[key];
    frontMatterData.value = newData;
  }

  function addFrontMatterField(key: string, value: unknown): void {
    if (frontMatterData.value[key] !== undefined) {
      return;
    }
    frontMatterData.value = {
      ...frontMatterData.value,
      [key]: value
    };
  }

  function setBodyContent(newContent: string): void {
    isInternalUpdate = true;
    bodyContent.value = newContent;
  }

  watch(
    content,
    (newContent) => {
      if (isInternalUpdate) {
        isInternalUpdate = false;
        return;
      }

      const rawContent = newContent ?? '';
      const { frontMatter, body } = parseContent(rawContent);

      frontMatterRaw.value = frontMatter;
      frontMatterData.value = parseFrontMatter(frontMatter);
      bodyContent.value = body;
    },
    { immediate: true }
  );

  return {
    bodyContent,
    frontMatterData,
    frontMatterRaw,
    hasFrontMatter,
    updateFrontMatter,
    updateFrontMatterField,
    removeFrontMatterField,
    addFrontMatterField,
    reconstructContent,
    setBodyContent
  };
}
