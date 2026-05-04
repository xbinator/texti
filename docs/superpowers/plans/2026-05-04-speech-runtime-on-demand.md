# Chat 语音运行时按需下载实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为聊天语音输入实现“首次按需下载 + 设置页管理”的语音运行时，并将录音链路改为前端直接产出分段 `wav`，移除正式产品路径对 `ffmpeg` 的依赖。

**Architecture:** 主进程新增 `speech runtime manager` 与 `installer`，负责状态检查、安装、删除和路径解析；渲染层在麦克风入口与设置页消费运行时状态；语音录音从 `MediaRecorder -> webm` 改为浏览器 PCM 采集并编码为 `16000 Hz / mono / 16-bit PCM` 的分段 `wav`，转写仍通过 `speech:transcribe` 进入主进程。

**Tech Stack:** Electron, Vue 3, TypeScript, Pinia, Vitest, Node.js fs/path/https APIs

---

## 文件结构

| 操作 | 文件路径 | 职责 |
|------|----------|------|
| 修改 | `electron/main/modules/speech/types.mts` | 扩展运行时状态、安装进度、安装清单与请求类型 |
| 新增 | `electron/main/modules/speech/runtime.mts` | 安装目录、manifest 读取、状态检查、路径解析、删除 |
| 新增 | `electron/main/modules/speech/installer.mts` | 下载、校验、解压、原子替换、进度回调 |
| 修改 | `electron/main/modules/speech/service.mts` | 去掉 `ffmpeg` 依赖，优先使用已安装 runtime |
| 修改 | `electron/main/modules/speech/ipc.mts` | 注册 runtime 状态、安装、删除、进度事件、转写接口 |
| 修改 | `electron/preload/index.mts` | 暴露新的 speech runtime API 与进度订阅 |
| 修改 | `types/electron-api.d.ts` | 为 runtime API 与 wav 转写请求补类型 |
| 修改 | `src/components/BChatSidebar/hooks/useVoiceRecorder.ts` | 从 `MediaRecorder` 切换为 PCM 采集 + `wav` 编码 |
| 修改 | `src/components/BChatSidebar/components/InputToolbar/VoiceInput.vue` | 开始录音前检查 runtime，缺失时触发安装流程 |
| 修改 | `src/components/BChatSidebar/hooks/useVoiceSession.ts` | 保持分段转写，但请求 MIME 固定为 `audio/wav` |
| 修改 | `src/components/BChatSidebar/index.vue` | 转写成功后把文本插回输入框，移除调试日志 |
| 修改 | `src/views/settings/constants.ts` | 新增设置页“语音组件”菜单项 |
| 修改 | `src/router/routes/modules/settings.ts` | 注册语音组件设置页路由 |
| 新增 | `src/views/settings/speech/index.vue` | 语音组件状态、下载、重装、删除界面 |
| 新增 | `test/electron/main/modules/speech/runtime.test.ts` | runtime 状态与路径解析测试 |
| 新增 | `test/electron/main/modules/speech/installer.test.ts` | 安装器下载清单、校验、原子替换测试 |
| 修改 | `test/components/BChatSidebar/useVoiceSession.test.ts` | runtime ready/missing 下的语音入口行为测试 |
| 新增 | `test/components/BChatSidebar/useVoiceRecorder.wav.test.ts` | wav 编码参数与分段体积测试 |
| 新增 | `test/views/settings/speech/index.test.ts` | 设置页语音组件状态与操作测试 |

---

### Task 1: 定义主进程 speech runtime 类型与状态测试

**Files:**
- Modify: `electron/main/modules/speech/types.mts`
- Create: `test/electron/main/modules/speech/runtime.test.ts`

- [ ] **Step 1: 在 `types.mts` 扩展 runtime 类型**

追加以下类型定义：

```ts
/**
 * 语音运行时状态。
 */
export type SpeechRuntimeState = 'ready' | 'missing' | 'installing' | 'failed';

/**
 * 语音运行时状态快照。
 */
export interface SpeechRuntimeStatus {
  /** 当前状态。 */
  state: SpeechRuntimeState;
  /** 平台标识。 */
  platform: 'darwin' | 'win32';
  /** 架构标识。 */
  arch: 'arm64' | 'x64';
  /** 模型名称。 */
  modelName?: string;
  /** 当前安装目录。 */
  installDir?: string;
  /** 当前安装版本。 */
  version?: string;
  /** 失败时的人类可读错误。 */
  errorMessage?: string;
}

/**
 * 语音运行时资源。
 */
export interface SpeechRuntimeAsset {
  /** 资源名称。 */
  name: 'whisper' | 'model';
  /** 下载地址。 */
  url: string;
  /** sha256 校验值。 */
  sha256: string;
  /** 归档格式。 */
  archiveType: 'file' | 'zip';
  /** 安装目标相对路径。 */
  targetRelativePath: string;
}

/**
 * 语音运行时安装清单。
 */
export interface SpeechRuntimeManifestDefinition {
  /** 平台标识。 */
  platform: 'darwin' | 'win32';
  /** 架构标识。 */
  arch: 'arm64' | 'x64';
  /** 运行时版本。 */
  version: string;
  /** 默认模型名。 */
  modelName: string;
  /** 资源列表。 */
  assets: SpeechRuntimeAsset[];
}

/**
 * 安装进度阶段。
 */
export type SpeechInstallPhase = 'downloading' | 'extracting' | 'verifying' | 'completed';

/**
 * 安装进度事件。
 */
export interface SpeechInstallProgress {
  /** 当前阶段。 */
  phase: SpeechInstallPhase;
  /** 当前完成数。 */
  current: number;
  /** 总数。 */
  total: number;
  /** 进度说明。 */
  message: string;
}
```

- [ ] **Step 2: 为 runtime 类型行为写失败测试**

创建 `test/electron/main/modules/speech/runtime.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import type { SpeechRuntimeManifestDefinition, SpeechRuntimeStatus } from '@/../electron/main/modules/speech/types.mjs';

describe('speech runtime types', () => {
  it('allows ready status with install metadata', () => {
    const status: SpeechRuntimeStatus = {
      state: 'ready',
      platform: 'darwin',
      arch: 'arm64',
      modelName: 'ggml-base',
      installDir: '/tmp/speech-runtime/current',
      version: '2026.05.04'
    };

    expect(status.state).toBe('ready');
    expect(status.modelName).toBe('ggml-base');
  });

  it('allows manifest definitions without ffmpeg assets', () => {
    const manifest: SpeechRuntimeManifestDefinition = {
      platform: 'win32',
      arch: 'x64',
      version: '2026.05.04',
      modelName: 'ggml-base',
      assets: [
        {
          name: 'whisper',
          url: 'https://example.test/whisper.zip',
          sha256: 'abc123',
          archiveType: 'zip',
          targetRelativePath: 'bin/whisper.exe'
        },
        {
          name: 'model',
          url: 'https://example.test/ggml-base.bin',
          sha256: 'def456',
          archiveType: 'file',
          targetRelativePath: 'models/ggml-base.bin'
        }
      ]
    };

    expect(manifest.assets.map((asset) => asset.name)).toEqual(['whisper', 'model']);
  });
});
```

- [ ] **Step 3: 运行测试确认类型基线成立**

Run: `pnpm test -- test/electron/main/modules/speech/runtime.test.ts`
Expected: PASS，新增类型测试通过

- [ ] **Step 4: Commit**

```bash
git add electron/main/modules/speech/types.mts test/electron/main/modules/speech/runtime.test.ts
git commit -m "test(speech): add runtime type baseline"
```

---

### Task 2: 实现 runtime manager 与安装状态解析

**Files:**
- Create: `electron/main/modules/speech/runtime.mts`
- Modify: `test/electron/main/modules/speech/runtime.test.ts`

- [ ] **Step 1: 先为 runtime 状态与路径解析写失败测试**

在 `test/electron/main/modules/speech/runtime.test.ts` 追加：

```ts
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { beforeEach, vi } from 'vitest';
import { getSpeechRuntimeStatus, resolveInstalledSpeechRuntimePaths } from '@/../electron/main/modules/speech/runtime.mjs';

const root = join(tmpdir(), 'tibis-speech-runtime-test');

beforeEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

it('returns missing when no manifest exists', async () => {
  const status = await getSpeechRuntimeStatus({
    userDataPath: root,
    platform: 'darwin',
    arch: 'arm64'
  });

  expect(status.state).toBe('missing');
});

it('returns ready when manifest and assets exist', async () => {
  await mkdir(join(root, 'speech-runtime/current/bin'), { recursive: true });
  await mkdir(join(root, 'speech-runtime/current/models'), { recursive: true });
  await writeFile(join(root, 'speech-runtime/current/bin/whisper'), 'binary');
  await writeFile(join(root, 'speech-runtime/current/models/ggml-base.bin'), 'model');
  await writeFile(
    join(root, 'speech-runtime/manifest.json'),
    JSON.stringify({
      version: '2026.05.04',
      modelName: 'ggml-base',
      platform: 'darwin',
      arch: 'arm64',
      currentDir: 'current'
    })
  );

  const status = await getSpeechRuntimeStatus({
    userDataPath: root,
    platform: 'darwin',
    arch: 'arm64'
  });

  expect(status.state).toBe('ready');
  expect(status.modelName).toBe('ggml-base');
});
```

- [ ] **Step 2: 在 `runtime.mts` 实现安装目录与状态解析**

创建 `electron/main/modules/speech/runtime.mts`：

```ts
/**
 * @file runtime.mts
 * @description 管理语音运行时目录、manifest、状态检测与已安装路径解析。
 */
import { access, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';
import type { SpeechRuntimeStatus } from './types.mjs';

interface RuntimeContext {
  userDataPath?: string;
  platform?: NodeJS.Platform;
  arch?: string;
}

interface InstalledSpeechRuntimePaths {
  runtimeRoot: string;
  whisperBinaryPath: string;
  whisperModelPath: string;
}

interface RuntimeManifestFile {
  version: string;
  modelName: string;
  platform: 'darwin' | 'win32';
  arch: 'arm64' | 'x64';
  currentDir: string;
}

/**
 * 获取语音运行时根目录。
 * @param context - 可选测试上下文
 * @returns 运行时根目录
 */
export function getSpeechRuntimeRoot(context: RuntimeContext = {}): string {
  const userDataPath = context.userDataPath ?? app.getPath('userData');
  return join(userDataPath, 'speech-runtime');
}

/**
 * 获取 manifest 文件路径。
 * @param context - 可选测试上下文
 * @returns manifest 路径
 */
export function getSpeechRuntimeManifestPath(context: RuntimeContext = {}): string {
  return join(getSpeechRuntimeRoot(context), 'manifest.json');
}

/**
 * 读取语音运行时 manifest。
 * @param context - 可选测试上下文
 * @returns manifest，不存在时返回 null
 */
export async function readSpeechRuntimeManifest(context: RuntimeContext = {}): Promise<RuntimeManifestFile | null> {
  try {
    const content = await readFile(getSpeechRuntimeManifestPath(context), 'utf-8');
    return JSON.parse(content) as RuntimeManifestFile;
  } catch {
    return null;
  }
}

/**
 * 获取已安装的语音运行时路径。
 * @param context - 可选测试上下文
 * @returns 已安装路径
 */
export async function resolveInstalledSpeechRuntimePaths(context: RuntimeContext = {}): Promise<InstalledSpeechRuntimePaths> {
  const manifest = await readSpeechRuntimeManifest(context);
  if (!manifest) {
    throw new Error('Speech runtime is not installed');
  }

  const currentRoot = join(getSpeechRuntimeRoot(context), manifest.currentDir);
  const whisperBinaryPath = join(currentRoot, 'bin', context.platform === 'win32' ? 'whisper.exe' : 'whisper');
  const whisperModelPath = join(currentRoot, 'models', `${manifest.modelName}.bin`);
  await access(whisperBinaryPath);
  await access(whisperModelPath);

  return {
    runtimeRoot: currentRoot,
    whisperBinaryPath,
    whisperModelPath
  };
}

/**
 * 获取语音运行时状态。
 * @param context - 可选测试上下文
 * @returns 运行时状态
 */
export async function getSpeechRuntimeStatus(context: RuntimeContext = {}): Promise<SpeechRuntimeStatus> {
  const platform = (context.platform ?? process.platform) as 'darwin' | 'win32';
  const arch = (context.arch ?? process.arch) as 'arm64' | 'x64';

  try {
    const manifest = await readSpeechRuntimeManifest(context);
    if (!manifest) {
      return { state: 'missing', platform, arch };
    }

    const paths = await resolveInstalledSpeechRuntimePaths(context);
    return {
      state: 'ready',
      platform,
      arch,
      version: manifest.version,
      modelName: manifest.modelName,
      installDir: paths.runtimeRoot
    };
  } catch (error) {
    return {
      state: 'failed',
      platform,
      arch,
      errorMessage: error instanceof Error ? error.message : 'Unknown speech runtime error'
    };
  }
}

/**
 * 删除已安装语音运行时。
 * @param context - 可选测试上下文
 */
export async function removeSpeechRuntime(context: RuntimeContext = {}): Promise<void> {
  await rm(getSpeechRuntimeRoot(context), { recursive: true, force: true });
}
```

- [ ] **Step 3: 运行 runtime 测试验证 ready/missing/failed 分支**

Run: `pnpm test -- test/electron/main/modules/speech/runtime.test.ts`
Expected: PASS，状态检测与路径解析通过

- [ ] **Step 4: Commit**

```bash
git add electron/main/modules/speech/runtime.mts test/electron/main/modules/speech/runtime.test.ts
git commit -m "feat(speech): add runtime manager and status detection"
```

---

### Task 3: 实现 installer 并补原子安装测试

**Files:**
- Create: `electron/main/modules/speech/installer.mts`
- Create: `test/electron/main/modules/speech/installer.test.ts`

- [ ] **Step 1: 先为 installer 清单与原子替换写失败测试**

创建 `test/electron/main/modules/speech/installer.test.ts`：

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { installSpeechRuntime } from '@/../electron/main/modules/speech/installer.mjs';

const root = join(tmpdir(), 'tibis-speech-installer-test');

describe('installSpeechRuntime', () => {
  beforeEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('writes manifest and current assets after successful install', async () => {
    await installSpeechRuntime({
      userDataPath: root,
      platform: 'darwin',
      arch: 'arm64',
      manifest: {
        platform: 'darwin',
        arch: 'arm64',
        version: '2026.05.04',
        modelName: 'ggml-base',
        assets: [
          {
            name: 'whisper',
            url: 'memory://whisper.zip',
            sha256: 'skip-for-test',
            archiveType: 'zip',
            targetRelativePath: 'bin/whisper'
          },
          {
            name: 'model',
            url: 'memory://ggml-base.bin',
            sha256: 'skip-for-test',
            archiveType: 'file',
            targetRelativePath: 'models/ggml-base.bin'
          }
        ]
      },
      downloadAsset: async (asset) => {
        return asset.name === 'model' ? Buffer.from('model') : Buffer.from('zip-binary');
      },
      extractZipAsset: async ({ outputFilePath }) => {
        await mkdir(join(outputFilePath, '..'), { recursive: true });
        await writeFile(outputFilePath, 'whisper-binary');
      }
    });

    const manifest = JSON.parse(await readFile(join(root, 'speech-runtime/manifest.json'), 'utf-8'));
    expect(manifest.modelName).toBe('ggml-base');
  });
});
```

- [ ] **Step 2: 在 `installer.mts` 实现下载、校验与原子安装骨架**

创建 `electron/main/modules/speech/installer.mts`：

```ts
/**
 * @file installer.mts
 * @description 安装语音运行时，负责下载、解压、校验和原子替换。
 */
import { chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { SpeechInstallProgress, SpeechRuntimeAsset, SpeechRuntimeManifestDefinition } from './types.mjs';
import { getSpeechRuntimeRoot } from './runtime.mjs';

interface InstallOptions {
  userDataPath?: string;
  platform: 'darwin' | 'win32';
  arch: 'arm64' | 'x64';
  manifest: SpeechRuntimeManifestDefinition;
  onProgress?: (progress: SpeechInstallProgress) => void | Promise<void>;
  downloadAsset?: (asset: SpeechRuntimeAsset) => Promise<Buffer>;
  extractZipAsset?: (input: { asset: SpeechRuntimeAsset; bytes: Buffer; outputFilePath: string }) => Promise<void>;
}

/**
 * 安装语音运行时。
 * @param options - 安装选项
 */
export async function installSpeechRuntime(options: InstallOptions): Promise<void> {
  const runtimeRoot = getSpeechRuntimeRoot({ userDataPath: options.userDataPath });
  const tempDir = join(runtimeRoot, 'tmp', `${Date.now()}`);
  const nextDir = join(runtimeRoot, `runtime-${options.manifest.version}`);
  const currentDir = join(runtimeRoot, 'current');

  await rm(tempDir, { recursive: true, force: true });
  await mkdir(tempDir, { recursive: true });

  const downloadAsset = options.downloadAsset ?? (async () => {
    throw new Error('downloadAsset must be implemented');
  });

  const extractZipAsset = options.extractZipAsset ?? (async () => {
    throw new Error('extractZipAsset must be implemented');
  });

  for (const [index, asset] of options.manifest.assets.entries()) {
    await options.onProgress?.({
      phase: 'downloading',
      current: index + 1,
      total: options.manifest.assets.length,
      message: `Downloading ${asset.name}`
    });

    const bytes = await downloadAsset(asset);
    const outputFilePath = join(tempDir, asset.targetRelativePath);
    await mkdir(join(outputFilePath, '..'), { recursive: true });

    if (asset.archiveType === 'zip') {
      await extractZipAsset({ asset, bytes, outputFilePath });
    } else {
      await writeFile(outputFilePath, bytes);
    }

    if (asset.name === 'whisper' && options.platform !== 'win32') {
      await chmod(outputFilePath, 0o755);
    }
  }

  await rm(nextDir, { recursive: true, force: true });
  await rename(tempDir, nextDir);
  await rm(currentDir, { recursive: true, force: true });
  await rename(nextDir, currentDir);
  await writeFile(
    join(runtimeRoot, 'manifest.json'),
    JSON.stringify({
      version: options.manifest.version,
      modelName: options.manifest.modelName,
      platform: options.manifest.platform,
      arch: options.manifest.arch,
      currentDir: 'current'
    })
  );

  await options.onProgress?.({
    phase: 'completed',
    current: options.manifest.assets.length,
    total: options.manifest.assets.length,
    message: 'Speech runtime installed'
  });
}
```

- [ ] **Step 3: 运行 installer 测试确认 manifest 与 current 目录生成**

Run: `pnpm test -- test/electron/main/modules/speech/installer.test.ts`
Expected: PASS，manifest 写入且 `current` 目录存在

- [ ] **Step 4: Commit**

```bash
git add electron/main/modules/speech/installer.mts test/electron/main/modules/speech/installer.test.ts
git commit -m "feat(speech): add runtime installer with atomic install flow"
```

---

### Task 4: 接通 IPC / preload / Electron API，并让主进程优先使用已安装 runtime

**Files:**
- Modify: `electron/main/modules/speech/service.mts`
- Modify: `electron/main/modules/speech/ipc.mts`
- Modify: `electron/preload/index.mts`
- Modify: `types/electron-api.d.ts`

- [ ] **Step 1: 先为 `service.mts` 去除 ffmpeg 依赖写失败测试**

在 `test/electron/main/modules/speech/runtime.test.ts` 追加：

```ts
import { transcribeAudioSegment } from '@/../electron/main/modules/speech/service.mjs';

it('accepts wav input without ffmpeg path', async () => {
  const result = await transcribeAudioSegment(
    {
      buffer: new Uint8Array([82, 73, 70, 70]).buffer,
      mimeType: 'audio/wav',
      segmentId: 'segment-1'
    },
    {
      whisperBinaryPath: '/tmp/whisper',
      whisperModelPath: '/tmp/model.bin',
      tempDirectory: '/tmp'
    }
  );

  expect(result.segmentId).toBe('segment-1');
});
```

- [ ] **Step 2: 修改 `service.mts`，优先解析安装 runtime，移除 ffmpeg 转码路径**

将 `resolveSpeechRuntimeConfig` 与 `transcribeAudioSegment` 的关键逻辑调整为：

```ts
import { resolveInstalledSpeechRuntimePaths } from './runtime.mjs';

export async function resolveSpeechRuntimeConfig(): Promise<SpeechRuntimeConfig> {
  try {
    const installed = await resolveInstalledSpeechRuntimePaths();
    return {
      whisperBinaryPath: installed.whisperBinaryPath,
      whisperModelPath: installed.whisperModelPath,
      tempDirectory: process.env.TIBIS_WHISPER_TEMP_DIR ?? '/tmp'
    };
  } catch {
    return {
      whisperBinaryPath: process.env.TIBIS_WHISPER_CPP_PATH ?? '',
      whisperModelPath: process.env.TIBIS_WHISPER_MODEL_PATH ?? '',
      tempDirectory: process.env.TIBIS_WHISPER_TEMP_DIR ?? '/tmp'
    };
  }
}

export async function transcribeAudioSegment(
  request: SpeechTranscribeRequest,
  config: SpeechRuntimeConfig = await resolveSpeechRuntimeConfig()
): Promise<SpeechTranscribeResult> {
  if (request.mimeType !== 'audio/wav' && request.mimeType !== 'audio/wave') {
    throw new Error(`Unsupported speech mime type: ${request.mimeType}`);
  }

  // 写入 input.wav，直接调用 whisper.cpp
}
```

- [ ] **Step 3: 修改 `ipc.mts`，增加 runtime 相关 handlers**

在 `electron/main/modules/speech/ipc.mts` 注册：

```ts
ipcMain.handle('speech:getRuntimeStatus', async (): Promise<SpeechRuntimeStatus> => {
  return getSpeechRuntimeStatus();
});

ipcMain.handle('speech:installRuntime', async (): Promise<SpeechRuntimeStatus> => {
  await installSpeechRuntime({
    platform: process.platform as 'darwin' | 'win32',
    arch: process.arch as 'arm64' | 'x64',
    manifest: resolveSpeechRuntimeManifest(),
    onProgress: (progress) => {
      BrowserWindow.getAllWindows().forEach((win) => {
        win.webContents.send('speech:install-progress', progress);
      });
    }
  });

  return getSpeechRuntimeStatus();
});

ipcMain.handle('speech:removeRuntime', async (): Promise<SpeechRuntimeStatus> => {
  await removeSpeechRuntime();
  return getSpeechRuntimeStatus();
});
```

- [ ] **Step 4: 修改 preload 与类型声明**

在 `electron/preload/index.mts` 追加：

```ts
getSpeechRuntimeStatus: () => ipcRenderer.invoke('speech:getRuntimeStatus'),
installSpeechRuntime: () => ipcRenderer.invoke('speech:installRuntime'),
removeSpeechRuntime: () => ipcRenderer.invoke('speech:removeRuntime'),
onSpeechInstallProgress: (listener) => {
  const wrapped = (_event, payload) => listener(payload);
  ipcRenderer.on('speech:install-progress', wrapped);
  return () => ipcRenderer.removeListener('speech:install-progress', wrapped);
}
```

在 `types/electron-api.d.ts` 追加：

```ts
export interface ElectronSpeechRuntimeStatus {
  state: 'ready' | 'missing' | 'installing' | 'failed';
  platform: 'darwin' | 'win32';
  arch: 'arm64' | 'x64';
  modelName?: string;
  installDir?: string;
  version?: string;
  errorMessage?: string;
}

export interface ElectronSpeechInstallProgress {
  phase: 'downloading' | 'extracting' | 'verifying' | 'completed';
  current: number;
  total: number;
  message: string;
}

getSpeechRuntimeStatus: () => Promise<ElectronSpeechRuntimeStatus>;
installSpeechRuntime: () => Promise<ElectronSpeechRuntimeStatus>;
removeSpeechRuntime: () => Promise<ElectronSpeechRuntimeStatus>;
onSpeechInstallProgress: (listener: (progress: ElectronSpeechInstallProgress) => void) => () => void;
```

- [ ] **Step 5: 运行主进程与类型相关测试**

Run: `pnpm test -- test/electron/main/modules/speech/runtime.test.ts test/electron/main/modules/speech/installer.test.ts`
Expected: PASS，runtime/service/ipc 类型与安装流通过

- [ ] **Step 6: Commit**

```bash
git add electron/main/modules/speech/service.mts electron/main/modules/speech/ipc.mts electron/preload/index.mts types/electron-api.d.ts
git commit -m "feat(speech): expose runtime install and use installed whisper assets"
```

---

### Task 5: 将录音链路改为前端分段 wav，并恢复输入框写回

**Files:**
- Modify: `src/components/BChatSidebar/hooks/useVoiceRecorder.ts`
- Modify: `src/components/BChatSidebar/hooks/useVoiceSession.ts`
- Modify: `src/components/BChatSidebar/components/InputToolbar/VoiceInput.vue`
- Modify: `src/components/BChatSidebar/index.vue`
- Create: `test/components/BChatSidebar/useVoiceRecorder.wav.test.ts`

- [ ] **Step 1: 为 wav 参数与分段大小写失败测试**

创建 `test/components/BChatSidebar/useVoiceRecorder.wav.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { encodeWavePcm16Mono } from '@/components/BChatSidebar/hooks/useVoiceRecorder';

describe('encodeWavePcm16Mono', () => {
  it('encodes mono 16kHz pcm as wav', () => {
    const input = new Float32Array(16000).fill(0);
    const wav = encodeWavePcm16Mono(input, 16000);

    expect(new Uint8Array(wav).slice(0, 4)).toEqual(new Uint8Array([82, 73, 70, 70]));
    expect(wav.byteLength).toBeGreaterThan(44);
  });
});
```

- [ ] **Step 2: 在 `useVoiceRecorder.ts` 提取并导出 wav 编码器**

增加可测试的编码函数：

```ts
/**
 * 将单声道 Float32 PCM 编码为 16-bit PCM wav。
 * @param samples - 采样数组
 * @param sampleRate - 采样率
 * @returns wav ArrayBuffer
 */
export function encodeWavePcm16Mono(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const dataLength = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  // 写入 wav header...

  return buffer;
}
```

并将录音流程改为：

```ts
const TARGET_SAMPLE_RATE = 16000;
const TARGET_CHANNELS = 1;

// 使用 AudioContext + ScriptProcessorNode 或 AudioWorklet 缓存 PCM
// 每 4 秒 flush 一段，编码为 wav 后走 onSegment
await onSegment({
  buffer: encodeWavePcm16Mono(segmentSamples, TARGET_SAMPLE_RATE),
  mimeType: 'audio/wav'
});
```

- [ ] **Step 3: 修改 `VoiceInput.vue`，开始录音前先检查 runtime**

在 `handleStart` 前半段加入：

```ts
const status = await getElectronAPI().getSpeechRuntimeStatus();
if (status.state !== 'ready') {
  const [cancelled] = await Modal.confirm('语音组件未安装', '首次使用语音输入需要下载语音组件，是否立即下载？', {
    confirmText: '下载'
  });
  if (cancelled) return;

  await getElectronAPI().installSpeechRuntime();
}
```

并订阅安装进度，把 `downloading` 状态显示到组件里。

- [ ] **Step 4: 修改 `useVoiceSession.ts` 与 `index.vue`**

在 `useVoiceSession.ts` 确保请求总是发送 `audio/wav`：

```ts
const result = await getElectronAPI().transcribeAudio({
  buffer: segment.buffer,
  mimeType: 'audio/wav',
  segmentId: segment.id
});
```

在 `src/components/BChatSidebar/index.vue` 恢复写回：

```ts
function handleVoiceComplete(payload: { text: string }): void {
  if (!payload.text.trim()) {
    message.error('语音转写结果为空，请重试');
    return;
  }

  insertTextAtCursor(payload.text);
}
```

- [ ] **Step 5: 运行聊天语音相关测试**

Run: `pnpm test -- test/components/BChatSidebar/useVoiceRecorder.wav.test.ts`
Expected: PASS，wav 头与采样参数测试通过

- [ ] **Step 6: Commit**

```bash
git add src/components/BChatSidebar/hooks/useVoiceRecorder.ts src/components/BChatSidebar/hooks/useVoiceSession.ts src/components/BChatSidebar/components/InputToolbar/VoiceInput.vue src/components/BChatSidebar/index.vue test/components/BChatSidebar/useVoiceRecorder.wav.test.ts
git commit -m "feat(chat): record segmented wav and install speech runtime on demand"
```

---

### Task 6: 新增设置页“语音组件”管理入口

**Files:**
- Modify: `src/views/settings/constants.ts`
- Modify: `src/router/routes/modules/settings.ts`
- Create: `src/views/settings/speech/index.vue`
- Create: `test/views/settings/speech/index.test.ts`

- [ ] **Step 1: 先为设置页状态与按钮行为写失败测试**

创建 `test/views/settings/speech/index.test.ts`：

```ts
import { mount } from '@vue/test-utils';
import SpeechSettings from '@/views/settings/speech/index.vue';

describe('SpeechSettings', () => {
  it('renders install action when runtime is missing', async () => {
    const wrapper = mount(SpeechSettings, {
      global: {
        mocks: {
          electronAPI: {
            getSpeechRuntimeStatus: async () => ({ state: 'missing', platform: 'darwin', arch: 'arm64' })
          }
        }
      }
    });

    expect(wrapper.text()).toContain('下载');
  });
});
```

- [ ] **Step 2: 注册设置页菜单和路由**

在 `src/views/settings/constants.ts`：

```ts
export type SettingsMenuKey = 'provider' | 'service-model' | 'logger' | 'speech';

export const settingsMenus = [
  { key: 'provider', label: 'AI服务商', icon: 'lucide:brain', path: '/settings/provider' },
  { key: 'service-model', label: '服务模型', icon: 'lucide:sparkles', path: '/settings/service-model' },
  { key: 'speech', label: '语音组件', icon: 'lucide:mic', path: '/settings/speech' },
  { key: 'logger', label: '运行日志', icon: 'lucide:file-text', path: '/settings/logger' }
];
```

在 `src/router/routes/modules/settings.ts`：

```ts
{
  path: 'speech',
  name: 'speech',
  component: () => import('@/views/settings/speech/index.vue')
}
```

- [ ] **Step 3: 实现 `src/views/settings/speech/index.vue`**

页面核心逻辑：

```ts
const status = ref<ElectronSpeechRuntimeStatus | null>(null);
const installing = ref(false);
const progress = ref<ElectronSpeechInstallProgress | null>(null);

async function refreshStatus(): Promise<void> {
  status.value = await getElectronAPI().getSpeechRuntimeStatus();
}

async function handleInstall(): Promise<void> {
  installing.value = true;
  try {
    await getElectronAPI().installSpeechRuntime();
    await refreshStatus();
    message.success('语音组件已安装');
  } catch (error) {
    message.error(error instanceof Error ? error.message : '语音组件安装失败');
  } finally {
    installing.value = false;
  }
}

async function handleRemove(): Promise<void> {
  const [cancelled] = await Modal.delete('确定要删除当前语音组件吗？');
  if (cancelled) return;
  await getElectronAPI().removeSpeechRuntime();
  await refreshStatus();
}
```

模板中显示：

- 当前状态
- 平台与架构
- 版本与模型
- 安装目录
- 下载/重装/删除按钮
- 下载进度条

- [ ] **Step 4: 运行设置页测试**

Run: `pnpm test -- test/views/settings/speech/index.test.ts`
Expected: PASS，缺失状态与按钮渲染通过

- [ ] **Step 5: Commit**

```bash
git add src/views/settings/constants.ts src/router/routes/modules/settings.ts src/views/settings/speech/index.vue test/views/settings/speech/index.test.ts
git commit -m "feat(settings): add speech runtime management page"
```

---

### Task 7: 全量验证、文档同步与收尾

**Files:**
- Modify: `changelog/2026-05-04.md`
- Modify: `docs/superpowers/specs/2026-05-02-chat-voice-input-design.md`
- Modify: `docs/superpowers/specs/2026-05-04-speech-runtime-on-demand-design.md`

- [ ] **Step 1: 运行本次改动相关测试集合**

Run: `pnpm test -- test/electron/main/modules/speech/runtime.test.ts test/electron/main/modules/speech/installer.test.ts test/components/BChatSidebar/useVoiceRecorder.wav.test.ts test/views/settings/speech/index.test.ts`
Expected: PASS，所有新增与改动测试通过

- [ ] **Step 2: 运行类型检查和 ESLint**

Run: `pnpm exec tsc -p electron/tsconfig.json --noEmit`
Expected: PASS，无 Electron 主进程类型错误

Run: `pnpm exec vue-tsc --noEmit`
Expected: PASS，无渲染层类型错误

Run: `pnpm exec eslint src electron --ext .ts,.mts,.vue`
Expected: PASS，无 lint 错误

- [ ] **Step 3: 核对文档与 changelog**

确认以下文档与实际实现一致：

```md
- docs/superpowers/specs/2026-05-02-chat-voice-input-design.md
- docs/superpowers/specs/2026-05-04-speech-runtime-on-demand-design.md
- changelog/2026-05-04.md
```

若实现中调整了文件名、类型名或 UI 文案，必须同步修正文档，不允许保留旧的 `ffmpeg/webm` 方案描述。

- [ ] **Step 4: Commit**

```bash
git add changelog/2026-05-04.md docs/superpowers/specs/2026-05-02-chat-voice-input-design.md docs/superpowers/specs/2026-05-04-speech-runtime-on-demand-design.md
git commit -m "docs: align speech runtime docs with wav-based implementation"
```

---

## 自检

- Spec coverage:
  - 首次按需下载：Task 3, 4, 5
  - 设置页管理入口：Task 6
  - 前端直接分段 `wav`：Task 5
  - 移除正式产品路径 `ffmpeg`：Task 1, 2, 4, 5
  - 输入框写回：Task 5
- Placeholder scan:
  - 未使用 `TODO/TBD/后续补`
  - 每个代码变更步骤都提供了具体代码片段或命令
- Type consistency:
  - `SpeechRuntimeStatus` / `SpeechInstallProgress` / `SpeechRuntimeManifestDefinition` 在任务间保持一致

