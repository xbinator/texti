import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const componentPath = resolve(process.cwd(), 'src/views/settings/service-model/components/ServiceConfig.vue');

function readComponent(): string {
  return readFileSync(componentPath, 'utf-8');
}

describe('ServiceConfig layout', () => {
  test('edits prompt from a dialog instead of inline collapsed editor', () => {
    const source = readComponent();

    expect(source).toContain('class="config-row prompt-row"');
    expect(source).toContain('@click="openPromptModal"');
    expect(source).toContain('<BModal v-model:open="promptModalVisible"');
    expect(source).not.toContain('togglePromptCollapsed');
  });

  test('keeps prompt edits as a draft until user confirms', () => {
    const source = readComponent();

    expect(source).toContain('const draftPrompt = ref<string>');
    expect(source).toContain('v-model:value="draftPrompt"');
    expect(source).toContain('@click="confirmPromptEdit"');
    expect(source).toContain('@click="cancelPromptEdit"');
    expect(source).toContain('customPrompt.value = draftPrompt.value');
    expect(source).not.toContain('v-model:value="customPrompt" :placeholder="placeholder"');
  });
});
