# Chat Voice Input Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为聊天输入栏增加独立语音输入组件，支持录音波形、边录边转写、多段拼接，并在完成后把文本插入到 `BPromptEditor` 当前光标位置。

**Architecture:** 录音和波形运行在渲染进程，由 `VoiceInput.vue`、`useVoiceRecorder.ts`、`useVoiceTranscriptionSession.ts` 协调。单段转写通过新的 `electronAPI.transcribeAudio` IPC 调用主进程 `speech` 模块，前端使用占位块把最终文本一次性替换进输入框，避免在录音过程中持续改写 CodeMirror 正文。

**Tech Stack:** Vue 3 Composition API、TypeScript、CodeMirror 6、Vitest、Electron IPC、Node `child_process`

---

## File Map

- Create: `src/components/BChatSidebar/components/VoiceInput.vue`
- Create: `src/components/BChatSidebar/components/VoiceWaveform.vue`
- Create: `src/components/BChatSidebar/hooks/useVoiceRecorder.ts`
- Create: `src/components/BChatSidebar/hooks/useVoiceTranscriptionSession.ts`
- Create: `electron/main/modules/speech/ipc.mts`
- Create: `electron/main/modules/speech/service.mts`
- Create: `electron/main/modules/speech/types.mts`
- Create: `test/components/BChatSidebar/voice-transcription-session.test.ts`
- Create: `test/components/BChatSidebar/components/VoiceInput.test.ts`
- Create: `test/electron/speech-service.test.ts`
- Modify: `src/components/BChatSidebar/components/InputToolbar.vue`
- Modify: `src/components/BChatSidebar/index.vue`
- Modify: `src/components/BPromptEditor/index.vue`
- Modify: `types/electron-api.d.ts`
- Modify: `electron/preload/index.mts`
- Modify: `electron/main/modules/index.mts`
- Modify: `changelog/2026-05-02.md`

### Task 1: Extend Electron Audio Transcription Boundary

**Files:**
- Create: `electron/main/modules/speech/ipc.mts`
- Create: `electron/main/modules/speech/service.mts`
- Create: `electron/main/modules/speech/types.mts`
- Modify: `types/electron-api.d.ts`
- Modify: `electron/preload/index.mts`
- Modify: `electron/main/modules/index.mts`
- Test: `test/electron/speech-service.test.ts`

- [ ] **Step 1: Write the failing speech service tests**

```ts
import { describe, expect, it, vi } from 'vitest';

describe('speechService', () => {
  it('builds a single-segment transcription result', async () => {
    const result = await transcribeAudioSegment({
      buffer: new ArrayBuffer(8),
      mimeType: 'audio/webm',
      segmentId: 'seg-1'
    });

    expect(result.segmentId).toBe('seg-1');
    expect(typeof result.text).toBe('string');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('throws when whisper binary config is missing', async () => {
    await expect(
      transcribeAudioSegment({
        buffer: new ArrayBuffer(8),
        mimeType: 'audio/webm',
        segmentId: 'seg-1'
      }, {
        whisperBinaryPath: '',
        whisperModelPath: '/tmp/model.bin'
      })
    ).rejects.toThrow('whisper binary path');
  });
});
```

- [ ] **Step 2: Run the speech service test and verify RED**

Run: `pnpm vitest run test/electron/speech-service.test.ts`

Expected: FAIL because `transcribeAudioSegment` and the `speech` module do not exist yet.

- [ ] **Step 3: Implement minimal speech types, service, and IPC**

```ts
export interface ElectronAudioTranscribeRequest {
  buffer: ArrayBuffer;
  mimeType: string;
  segmentId: string;
  language?: string;
  prompt?: string;
}

export interface ElectronAudioTranscribeResult {
  segmentId: string;
  text: string;
  language?: string;
  durationMs: number;
}
```

```ts
export async function transcribeAudioSegment(
  request: ElectronAudioTranscribeRequest,
  config = defaultSpeechConfig
): Promise<ElectronAudioTranscribeResult> {
  assertSpeechConfig(config);
  return {
    segmentId: request.segmentId,
    text: '',
    language: request.language,
    durationMs: 0
  };
}
```

```ts
ipcMain.handle('speech:transcribe', async (_event, request) => {
  return transcribeAudioSegment(request);
});
```

- [ ] **Step 4: Run the speech service test and verify GREEN**

Run: `pnpm vitest run test/electron/speech-service.test.ts`

Expected: PASS with both assertions green.

- [ ] **Step 5: Commit the IPC boundary**

```bash
git add types/electron-api.d.ts electron/preload/index.mts electron/main/modules/index.mts electron/main/modules/speech test/electron/speech-service.test.ts
git commit -m "feat(chat): add speech transcription ipc boundary"
```

### Task 2: Add Prompt Placeholder Operations

**Files:**
- Modify: `src/components/BPromptEditor/index.vue`
- Test: `test/components/BPromptEditor/BPromptEditorRegression.test.ts`

- [ ] **Step 1: Write the failing placeholder behavior test**

```ts
it('replaces a voice placeholder with final text at the current cursor anchor', async () => {
  const wrapper = mountPromptEditor({ value: 'hello ' });

  const placeholderId = wrapper.vm.insertVoicePlaceholder('正在语音转写…');
  wrapper.vm.replaceVoicePlaceholder(placeholderId, '语音结果');

  expect(wrapper.emitted('change')?.at(-1)).toEqual(['hello 语音结果']);
});
```

- [ ] **Step 2: Run the prompt editor regression test and verify RED**

Run: `pnpm vitest run test/components/BPromptEditor/BPromptEditorRegression.test.ts`

Expected: FAIL because the placeholder insert/replace/remove API does not exist.

- [ ] **Step 3: Implement minimal placeholder API in `BPromptEditor`**

```ts
function insertVoicePlaceholder(label: string): string {
  const id = `voice-${Date.now()}`;
  insertTextAtCursor(`[[voice:${id}:${label}]]`);
  return id;
}

function replaceVoicePlaceholder(id: string, text: string): void {
  replaceTokenById(id, text);
}

function removeVoicePlaceholder(id: string): void {
  replaceTokenById(id, '');
}
```

Expose the methods through `defineExpose`.

- [ ] **Step 4: Run the prompt editor regression test and verify GREEN**

Run: `pnpm vitest run test/components/BPromptEditor/BPromptEditorRegression.test.ts`

Expected: PASS with the new placeholder workflow covered.

- [ ] **Step 5: Commit the prompt placeholder support**

```bash
git add src/components/BPromptEditor/index.vue test/components/BPromptEditor/BPromptEditorRegression.test.ts
git commit -m "feat(chat): add prompt voice placeholder operations"
```

### Task 3: Build the Voice Session Hook with TDD

**Files:**
- Create: `src/components/BChatSidebar/hooks/useVoiceTranscriptionSession.ts`
- Create: `test/components/BChatSidebar/voice-transcription-session.test.ts`

- [ ] **Step 1: Write the failing session tests**

```ts
describe('useVoiceTranscriptionSession', () => {
  it('appends automatic segments in order and joins them without newlines', async () => {
    const session = createVoiceTranscriptionSession(mockTranscriber);

    await session.enqueueSegment({ id: '1', separator: '', buffer: new ArrayBuffer(4), mimeType: 'audio/webm' });
    await session.enqueueSegment({ id: '2', separator: '', buffer: new ArrayBuffer(4), mimeType: 'audio/webm' });

    expect(session.finalText.value).toBe('第一段第二段');
  });

  it('inserts a newline separator for manual paragraph breaks', async () => {
    const session = createVoiceTranscriptionSession(mockTranscriber);

    await session.enqueueSegment({ id: '1', separator: '', buffer: new ArrayBuffer(4), mimeType: 'audio/webm' });
    await session.enqueueSegment({ id: '2', separator: '\n', buffer: new ArrayBuffer(4), mimeType: 'audio/webm' });

    expect(session.finalText.value).toBe('第一段\n第二段');
  });
});
```

- [ ] **Step 2: Run the voice session test and verify RED**

Run: `pnpm vitest run test/components/BChatSidebar/voice-transcription-session.test.ts`

Expected: FAIL because the hook does not exist yet.

- [ ] **Step 3: Implement the minimal serial transcription session**

```ts
export function useVoiceTranscriptionSession(transcribe: TranscribeSegment) {
  const segments = ref<VoiceSegment[]>([]);
  const finalText = computed(() => segments.value
    .filter((segment) => segment.status === 'final')
    .sort((a, b) => a.index - b.index)
    .map((segment) => `${segment.separator}${segment.text}`)
    .join(''));

  async function enqueueSegment(input: PendingVoiceSegment): Promise<void> {
    const segment = createSegment(input);
    segments.value.push(segment);
    segment.status = 'transcribing';
    const result = await transcribe(input);
    segment.text = result.text;
    segment.status = 'final';
  }

  return { segments, finalText, enqueueSegment };
}
```

- [ ] **Step 4: Run the voice session test and verify GREEN**

Run: `pnpm vitest run test/components/BChatSidebar/voice-transcription-session.test.ts`

Expected: PASS with ordered concatenation and newline handling.

- [ ] **Step 5: Commit the voice session hook**

```bash
git add src/components/BChatSidebar/hooks/useVoiceTranscriptionSession.ts test/components/BChatSidebar/voice-transcription-session.test.ts
git commit -m "feat(chat): add voice transcription session hook"
```

### Task 4: Build the Voice Input UI and Recorder Integration

**Files:**
- Create: `src/components/BChatSidebar/components/VoiceInput.vue`
- Create: `src/components/BChatSidebar/components/VoiceWaveform.vue`
- Create: `src/components/BChatSidebar/hooks/useVoiceRecorder.ts`
- Create: `test/components/BChatSidebar/components/VoiceInput.test.ts`
- Modify: `src/components/BChatSidebar/components/InputToolbar.vue`

- [ ] **Step 1: Write the failing `VoiceInput` component test**

```ts
it('emits complete with the final transcript after stopping a recording session', async () => {
  const wrapper = mount(VoiceInput, {
    props: {
      disabled: false
    }
  });

  await wrapper.get('[data-testid="voice-start"]').trigger('click');
  await wrapper.get('[data-testid="voice-stop"]').trigger('click');

  expect(wrapper.emitted('complete')?.[0]?.[0].text).toBe('第一段');
});
```

- [ ] **Step 2: Run the `VoiceInput` test and verify RED**

Run: `pnpm vitest run test/components/BChatSidebar/components/VoiceInput.test.ts`

Expected: FAIL because the component and recorder hook do not exist.

- [ ] **Step 3: Implement `useVoiceRecorder`, `VoiceWaveform`, and `VoiceInput` minimally**

```ts
const status = ref<'idle' | 'recording' | 'stopping'>('idle');
const waveformSamples = ref<number[]>([]);

async function start(): Promise<void> {
  status.value = 'recording';
}

async function stop(): Promise<void> {
  status.value = 'stopping';
}
```

```vue
<BButton data-testid="voice-start" v-if="status === 'idle'" @click="handleStart" />
<BButton data-testid="voice-stop" v-else @click="handleStop" />
<VoiceWaveform :samples="waveformSamples" />
```

Integrate `VoiceInput` into `InputToolbar.vue` ahead of the submit button group and forward a `voice-complete` event.

- [ ] **Step 4: Run the `VoiceInput` test and verify GREEN**

Run: `pnpm vitest run test/components/BChatSidebar/components/VoiceInput.test.ts`

Expected: PASS with the `complete` event emitted after stop.

- [ ] **Step 5: Commit the voice input UI**

```bash
git add src/components/BChatSidebar/components/VoiceInput.vue src/components/BChatSidebar/components/VoiceWaveform.vue src/components/BChatSidebar/hooks/useVoiceRecorder.ts src/components/BChatSidebar/components/InputToolbar.vue test/components/BChatSidebar/components/VoiceInput.test.ts
git commit -m "feat(chat): add voice input toolbar controls"
```

### Task 5: Integrate Placeholder Replacement, Real IPC Calls, and Changelog

**Files:**
- Modify: `src/components/BChatSidebar/index.vue`
- Modify: `src/components/BChatSidebar/components/InputToolbar.vue`
- Modify: `src/components/BChatSidebar/hooks/useVoiceTranscriptionSession.ts`
- Modify: `electron/main/modules/speech/service.mts`
- Modify: `changelog/2026-05-02.md`
- Test: `test/components/BChatSidebar/components/VoiceInput.test.ts`
- Test: `test/components/BChatSidebar/voice-transcription-session.test.ts`
- Test: `test/electron/speech-service.test.ts`

- [ ] **Step 1: Write the failing integration assertions**

```ts
it('replaces the active prompt placeholder when voice input completes', async () => {
  const wrapper = mountChatSidebar();

  await wrapper.get('[data-testid="voice-start"]').trigger('click');
  await wrapper.get('[data-testid="voice-stop"]').trigger('click');

  expect(wrapper.findComponent(BPromptEditor).vm.value).toContain('第一段');
});
```

- [ ] **Step 2: Run the targeted integration tests and verify RED**

Run: `pnpm vitest run test/components/BChatSidebar/components/VoiceInput.test.ts test/components/BChatSidebar/voice-transcription-session.test.ts test/electron/speech-service.test.ts`

Expected: FAIL because `BChatSidebar` does not yet create or replace voice placeholders and `speech/service.mts` still returns a stub result.

- [ ] **Step 3: Implement the real integration and final behavior**

```ts
function handleVoiceSessionStart(): void {
  activeVoicePlaceholderId.value = promptEditorRef.value?.insertVoicePlaceholder('正在语音转写…');
}

function handleVoiceSessionComplete(payload: { text: string }): void {
  if (!activeVoicePlaceholderId.value) return;
  promptEditorRef.value?.replaceVoicePlaceholder(activeVoicePlaceholderId.value, payload.text);
  activeVoicePlaceholderId.value = null;
}
```

Replace the speech stub with temp-file handling, command execution, result parsing, and cleanup, then append the changelog entry.

- [ ] **Step 4: Run the targeted tests plus shared verification and verify GREEN**

Run: `pnpm vitest run test/components/BChatSidebar/components/VoiceInput.test.ts test/components/BChatSidebar/voice-transcription-session.test.ts test/electron/speech-service.test.ts test/components/BPromptEditor/BPromptEditorRegression.test.ts`

Expected: PASS across all targeted voice-input tests.

- [ ] **Step 5: Commit the end-to-end voice input integration**

```bash
git add src/components/BChatSidebar/index.vue src/components/BChatSidebar/components/InputToolbar.vue src/components/BChatSidebar/hooks/useVoiceTranscriptionSession.ts electron/main/modules/speech/service.mts changelog/2026-05-02.md test/components/BChatSidebar/components/VoiceInput.test.ts test/components/BChatSidebar/voice-transcription-session.test.ts test/electron/speech-service.test.ts
git commit -m "feat(chat): wire voice transcription into prompt input"
```

## Self-Review

- Spec coverage: plan covers独立组件、波形、会话状态、串行分段转写、占位块替换、主进程 `speech` IPC、`whisper.cpp` 集成和 changelog。
- Placeholder scan: no `TODO`/`TBD`/“similar to” placeholders remain; each task names exact files and concrete commands.
- Type consistency: `ElectronAudioTranscribeRequest` / `ElectronAudioTranscribeResult` naming is consistent across IPC, session hook, and tests; `insertVoicePlaceholder` / `replaceVoicePlaceholder` / `removeVoicePlaceholder` stay consistent throughout.
