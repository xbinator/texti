<!--
  @file SkillCreatorModal.vue
  @description 技能创建模态框：上传 .skill/.zip → Worker 解压解析 → 预览确认安装。
-->
<template>
  <BModal v-model:open="visible" title="创建技能" :width="modalWidth" :closable="step !== 'parsing'" :mask-closable="step !== 'parsing'" @close="handleClose">
    <!-- 步骤 1：上传 -->
    <template v-if="step === 'upload'">
      <BUpload
        v-model:drag-over="isDragOver"
        accept=".skill,.zip"
        draggable
        class="skill-creator__dropzone"
        :class="{ 'skill-creator__dropzone--active': isDragOver }"
        @change="handleFileSelected"
      >
        <div class="skill-creator__dropzone-icon">
          <Icon icon="lucide:cloud-upload" :width="28" />
        </div>
        <div class="skill-creator__dropzone-title">拖拽文件到此处或点击添加</div>
        <div class="skill-creator__dropzone-badges">
          <span class="skill-creator__badge">.skill</span>
          <span class="skill-creator__badge">.zip</span>
        </div>
      </BUpload>

      <div class="skill-creator__requirements">
        <span class="skill-creator__requirements-title">文件要求</span>
        <div class="skill-creator__requirements-list">
          <div class="skill-creator__requirements-item">
            <Icon icon="lucide:file-text" :width="12" />
            <span>.skill 或 .zip 文件必须包含 SKILL.md 文件</span>
          </div>
          <div class="skill-creator__requirements-item">
            <Icon icon="lucide:hard-drive" :width="12" />
            <span>文件大小不超过 5MB</span>
          </div>
        </div>
      </div>
    </template>

    <!-- 步骤 2：解析中 -->
    <div v-else-if="step === 'parsing'" class="skill-creator__parsing">
      <ASpin size="large" />
      <span class="skill-creator__parsing-text">正在解析文件…</span>
    </div>

    <!-- 步骤 3：预览 -->
    <div v-else-if="step === 'preview'" class="skill-creator__preview">
      <!-- 基本信息 -->
      <div class="skill-creator__info-card">
        <div class="skill-creator__field">
          <span class="skill-creator__label">技能名称</span>
          <span class="skill-creator__value skill-creator__value--name">{{ parsedSkill?.name }}</span>
        </div>
        <div class="skill-creator__divider"></div>
        <div class="skill-creator__field">
          <span class="skill-creator__label">描述</span>
          <span class="skill-creator__value">{{ parsedSkill?.description }}</span>
        </div>
      </div>

      <!-- 文件预览 -->
      <BSkill :virtual-files="previewFiles" initial-file-path="SKILL.md" />

      <!-- 通知区域：截断警告 / 解析警告 / 冲突警告 统一渲染 -->
      <div v-if="notices.length > 0" class="skill-creator__notices">
        <div v-for="(notice, i) in notices" :key="i" class="skill-creator__notice" :class="`skill-creator__notice--${notice.type}`">
          <Icon icon="lucide:alert-triangle" :width="14" class="skill-creator__notice-icon" />
          <span>{{ notice.message }}</span>
        </div>
      </div>
    </div>

    <template v-if="step !== 'parsing'" #footer>
      <BButton type="secondary" @click="handleClose">取消</BButton>
      <BButton v-if="step === 'preview'" type="primary" :loading="installing" @click="handleInstall"> 确定 </BButton>
    </template>
  </BModal>
</template>

<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue';
import { Icon } from '@iconify/vue';
import { message } from 'ant-design-vue';
import type { SkillPackageResource } from '@/ai/skill/package';
import type { SkillDefinition } from '@/ai/skill/types';
import type { VirtualFile } from '@/components/BSkill/types';
import { logger } from '@/shared/logger';
import { createDirectoryInstallLogger } from '@/shared/logger/directoryInstall';
import { getElectronAPI } from '@/shared/platform/electron-api';
import { useSkillStore } from '@/stores/ai/skill';
import { asyncTo } from '@/utils/asyncTo';
import { formatDirectoryInstallError, installDirectory, type DirectoryInstallFile } from '@/utils/file/directory';
import { posix } from '@/utils/file/posix';

/** Worker 解析返回数据结构。 */
interface WorkerParseResult {
  skill: SkillDefinition;
  /** 原始 SKILL.md 完整内容（含 frontmatter），安装时直接写入保留所有字段 */
  rawSkillMd: string;
  resources: SkillPackageResource[];
  warnings: string[];
}

/** 通知条目。 */
interface Notice {
  type: 'warning' | 'conflict';
  message: string;
}

/** 模态框步骤。 */
type Step = 'upload' | 'parsing' | 'preview';

/** 文件大小上限：5MB。 */
const MAX_FILE_SIZE = 5 * 1024 * 1024;

const visible = defineModel<boolean>('open', { default: false });
const store = useSkillStore();

const step = ref<Step>('upload');
/** 拖拽悬停状态 */
const isDragOver = ref(false);
const parsedSkill = shallowRef<SkillDefinition | null>(null);
const parsedResources = ref<SkillPackageResource[]>([]);
const parsedWarnings = ref<string[]>([]);
const installing = ref(false);
/** 原始 SKILL.md 内容，安装时直接写入保留所有 frontmatter 字段。 */
const rawSkillMd = ref('');

/** Worker 实例。 */
let worker: Worker | null = null;

/** 根据步骤动态设置模态框宽度。 */
const modalWidth = computed(() => {
  return step.value === 'preview' ? '800px' : '500px';
});

/** 合并所有通知（截断、解析警告、冲突），统一渲染。 */
const notices = computed<Notice[]>(() => {
  const result: Notice[] = [];
  if (parsedSkill.value?.truncated) {
    result.push({ type: 'warning', message: 'SKILL.md 内容超过 10000 字符，已截断' });
  }
  for (const w of parsedWarnings.value) {
    result.push({ type: 'warning', message: w });
  }
  if (parsedSkill.value && store.skills.some((s) => s.name === parsedSkill.value!.name)) {
    result.push({ type: 'conflict', message: `"${parsedSkill.value.name}" 已存在，安装将覆盖原有内容` });
  }
  return result;
});

/** 组装预览用虚拟文件列表（SKILL.md + 资源文件）。 */
const previewFiles = computed<VirtualFile[]>(() => {
  const files: VirtualFile[] = rawSkillMd.value ? [{ path: 'SKILL.md', content: rawSkillMd.value }] : [];

  return files.concat(parsedResources.value.map((r: SkillPackageResource): VirtualFile => ({ path: r.relativePath, content: r.previewContent })));
});

/** 创建 Worker 实例。 */
function createWorker(): Worker {
  return new Worker(new URL('@/ai/skill/installer.worker.ts', import.meta.url), { type: 'module' });
}

/** 终止并清理 Worker。 */
function terminateWorker(): void {
  worker?.terminate();
  worker = null;
}

/** 重置内部状态。 */
function resetState(): void {
  step.value = 'upload';
  parsedSkill.value = null;
  parsedResources.value = [];
  parsedWarnings.value = [];
  rawSkillMd.value = '';
  installing.value = false;
}

/** 模态框打开/关闭时管理 Worker 生命周期。 */
watch(visible, (val) => {
  if (!val) {
    terminateWorker();
    resetState();
  }
});

/** 关闭模态框（watch 自动清理 Worker 并重置状态）。 */
function handleClose(): void {
  visible.value = false;
}

/** 文件选择后：大小校验 → 发给 Worker 解析。 */
async function handleFileSelected(files: FileList): Promise<void> {
  const file = files[0];
  if (!file) return;

  if (file.size > MAX_FILE_SIZE) {
    message.error(`文件过大（${(file.size / (1024 * 1024)).toFixed(1)}MB），超过 5MB 限制`);
    return;
  }

  // 终止旧 Worker，创建新实例
  terminateWorker();
  worker = createWorker();

  worker.onmessage = ({ data }: MessageEvent) => {
    if (data.type === 'error') {
      message.error(data.error);
      resetState();
      return;
    }
    if (data.type === 'success') {
      const result = data as WorkerParseResult;
      parsedSkill.value = result.skill;
      rawSkillMd.value = result.rawSkillMd;
      parsedResources.value = result.resources;
      parsedWarnings.value = result.warnings;
      step.value = 'preview';
    }
  };

  worker.onerror = ({ message: msg }: ErrorEvent) => {
    message.error(`解析异常：${msg}`);
    resetState();
  };

  step.value = 'parsing';
  const buffer = await file.arrayBuffer();
  worker.postMessage({ type: 'parse', buffer }, [buffer]);
}

/**
 * 获取 skills 目录路径。
 * 格式：<homeDir>/.agents/skills
 * @param api - Electron 文件系统 API
 * @returns skills 目录绝对路径
 */
async function getSkillDir(api: ReturnType<typeof getElectronAPI>): Promise<string> {
  const homeDir = await api.getHomeDir();
  return posix.join(homeDir, '.agents', 'skills');
}

/**
 * 将已解析 Skill 内容转换为通用目录安装文件。
 * @returns SKILL.md 与资源文件列表
 */
function createSkillInstallFiles(): DirectoryInstallFile[] {
  return [
    { kind: 'text', relativePath: 'SKILL.md', content: rawSkillMd.value },
    ...parsedResources.value.map(
      (resource: SkillPackageResource): DirectoryInstallFile => ({ kind: 'binary', relativePath: resource.relativePath, content: resource.content })
    )
  ];
}

/** 确认安装：备份 → 替换 → 清理或回滚（消除 TOCTOU 竞态）。 */
async function handleInstall(): Promise<void> {
  if (installing.value || !parsedSkill.value) return;

  const api = getElectronAPI();
  installing.value = true;
  const skillName = parsedSkill.value.name;
  const installLogger = createDirectoryInstallLogger('skill', skillName);

  try {
    await installLogger.start();
    const baseDir = await getSkillDir(api);
    const targetDir = posix.join(baseDir, skillName);

    await installDirectory({
      api,
      targetDir,
      conflictStrategy: 'replace',
      files: createSkillInstallFiles(),
      onEvent: installLogger.onEvent
    });
    await installLogger.success();

    // 磁盘安装完成后刷新 Store；扫描失败不回滚已安装目录。
    const [rescanErr] = await asyncTo(store.rescan());
    if (rescanErr) {
      console.error('Skill rescan after install failed:', rescanErr);
      await logger.warn(`[skill-install] rescan-failed resource=${skillName} error=${formatDirectoryInstallError(rescanErr)}`);
      message.warning(`技能 "${skillName}" 安装成功，但刷新列表失败，请稍后重试`);
    } else {
      message.success(`技能 "${skillName}" 安装成功`);
    }
    handleClose();
  } catch (err: unknown) {
    const errorMessage = formatDirectoryInstallError(err);
    await installLogger.failure(err);
    message.error(`安装失败：${errorMessage}`);
  } finally {
    installing.value = false;
  }
}
</script>

<style scoped lang="less">
/* ── 上传区 ── */
.skill-creator__dropzone {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 160px;
  color: var(--text-secondary);
  cursor: pointer;
  background: var(--bg-secondary);
  border: var(--surface-border-width) dashed var(--border-secondary);
  border-radius: var(--surface-radius);
  transition: border-color var(--motion-duration-base) var(--motion-easing-standard), background var(--motion-duration-base) var(--motion-easing-standard);

  &:hover,
  &--active {
    background: var(--bg-hover);
    border-color: var(--color-primary);

    .skill-creator__dropzone-icon {
      color: var(--color-primary);
    }
  }
}

.skill-creator__dropzone-icon {
  color: var(--text-tertiary);
  transition: color var(--motion-duration-base) var(--motion-easing-standard), transform var(--motion-duration-base) var(--motion-easing-standard);
}

.skill-creator__dropzone-title {
  font-size: 13px;
  color: var(--text-secondary);
}

.skill-creator__dropzone-badges {
  display: flex;
  gap: 6px;
  margin-top: 2px;
}

.skill-creator__badge {
  padding: 2px 8px;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-primary);
  background: var(--color-primary-bg, rgb(var(--color-primary-rgb) / 8%));
  border-radius: var(--control-radius);
}

/* ── 文件要求 ── */
.skill-creator__requirements {
  margin-top: 14px;
}

.skill-creator__requirements-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
}

.skill-creator__requirements-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 6px;
}

.skill-creator__requirements-item {
  display: flex;
  gap: 6px;
  align-items: center;
  font-size: 12px;
  color: var(--text-tertiary);
}

/* ── 解析中 ── */
.skill-creator__parsing {
  display: flex;
  flex-direction: column;
  gap: 16px;
  align-items: center;
  padding: 40px 0;
}

.skill-creator__parsing-text {
  font-size: 13px;
  color: var(--text-secondary);
}

/* ── 预览 ── */
.skill-creator__preview {
  display: flex;
  flex-direction: column;
  gap: 14px;
  height: 70vh;
}

.skill-creator__info-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px;
  background: var(--bg-secondary);
  border: var(--surface-border-width) solid var(--border-tertiary);
  border-radius: var(--surface-radius);
}

.skill-creator__divider {
  height: 1px;
  background: var(--border-tertiary);
}

.skill-creator__field {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.skill-creator__label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.skill-creator__value {
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-primary);
}

/* ── 通知区域（警告 / 冲突统一样式）── */
.skill-creator__notices {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.skill-creator__notice {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  padding: 8px 12px;
  font-size: 12px;
  border-left: 3px solid transparent;
  border-radius: var(--surface-radius);

  &--warning {
    color: var(--color-warning, #faad14);
    background: var(--bg-warning, rgb(250 173 20 / 10%));
    border-left-color: var(--color-warning, #faad14);
  }

  &--conflict {
    color: var(--color-warning, #faad14);
    background: var(--bg-warning, rgb(250 173 20 / 10%));
    border-left-color: var(--color-warning-strong, #d48806);
  }
}

.skill-creator__notice-icon {
  flex-shrink: 0;
  margin-top: 1px;
}
</style>
