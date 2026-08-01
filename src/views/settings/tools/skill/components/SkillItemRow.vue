<!--
  @file SkillItemRow.vue
  @description Skill 列表项行组件，展示单个 Skill 的图标、名称、描述及启用开关。
-->
<template>
  <div class="skill-settings__item-row" role="button" tabindex="0" @click="handleOpen">
    <div class="skill-settings__item-icon">{{ initial }}</div>
    <div class="skill-settings__item-info">
      <div class="skill-settings__item-name">
        {{ skill.name }}
        <span v-if="skill.parseError" class="skill-settings__item-error-badge" :title="skill.parseError">
          <Icon icon="lucide:alert-triangle" :width="12" />
        </span>
      </div>
      <div class="skill-settings__desc">{{ description }}</div>
      <!-- 解析错误详情 -->
      <div v-if="skill.parseError" class="skill-settings__item-parse-error">{{ skill.parseError }}</div>
    </div>
    <div class="skill-settings__item-actions" @click.stop>
      <ASwitch :checked="skill.enabled" size="small" :disabled="!!skill.parseError" @change="handleToggle" />
      <BDropdown placement="bottomRight" :disabled="deleting">
        <BButton type="ghost" size="small" square icon="lucide:settings" title="技能设置" aria-label="技能设置" :disabled="deleting" />
        <template #overlay>
          <BDropdownMenu :options="dropdownOptions" :width="120" />
        </template>
      </BDropdown>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { Icon } from '@iconify/vue';
import { message } from 'ant-design-vue';
import type { SkillDefinition } from '@/ai/skill/types';
import type { DropdownOption } from '@/components/BDropdown/type';
import { useNavigate } from '@/hooks/useNavigate';
import { native } from '@/shared/platform';
import { useSkillStore } from '@/stores/ai/skill';
import { asyncTo } from '@/utils/asyncTo';
import { Modal } from '@/utils/modal';

/**
 * Skill 列表项属性。
 */
interface Props {
  /** Skill 定义对象 */
  skill: SkillDefinition;
}

const props = defineProps<Props>();
const store = useSkillStore();
const { openFileByPath, openSkill } = useNavigate();
/** 当前 Skill 是否正在执行删除流程。 */
const deleting = ref(false);

/** Skill 名称首字母大写，用于图标展示。 */
const initial = computed(() => props.skill.name.charAt(0).toUpperCase());

/** 展示用描述，移除开头的双引号。 */
const description = computed<string>(() => {
  const desc = props.skill.description;
  return desc.startsWith('"') ? desc.slice(1) : desc;
});

/**
 * 打开 Skill 独立详情页。
 */
function handleOpen(): void {
  openSkill(props.skill.name);
}

/**
 * 切换 Skill 启用状态。
 */
function handleToggle(): void {
  store.toggleSkill(props.skill.name);
}

/**
 * 在 Markdown 编辑器中打开当前 Skill 的入口文件。
 */
async function handleEditSkill(): Promise<void> {
  if (deleting.value) {
    return;
  }

  // 使用 asyncTo 归一化错误：失败时 error.message 已包含原始错误原因，且 asyncTo 内部已记录日志。
  const [error, openedFile] = await asyncTo(openFileByPath(props.skill.filePath));

  if (error || !openedFile) {
    // 失败原因可能来自异常（带 message）或空结果（无 message 后缀），统一通过单条提示告知用户。
    const reason = error ? `：${error.message}` : '';
    message.error(`无法打开技能 "${props.skill.name}" 的 SKILL.md${reason}`);
  }
}

/**
 * 将当前 Skill 的整个资源目录移入系统回收站，并刷新 Store。
 */
async function handleDeleteSkill(): Promise<void> {
  if (deleting.value) {
    return;
  }

  // 删除锁覆盖确认弹窗和文件操作，避免快速重复点击生成多个确认流程。
  deleting.value = true;

  try {
    // Modal.delete 通过 Promise 决议不会 reject，直接解构取消 / 确认标记即可。
    const [, confirmed] = await Modal.delete(`确定要删除技能 "${props.skill.name}" 吗？整个目录及其中的附属文件都会移入系统回收站。`);

    if (!confirmed) {
      return;
    }

    // 移入回收站失败时直接退出，无需进入刷新阶段。
    const [trashError] = await asyncTo(native.trashFile(props.skill.dirPath));

    if (trashError) {
      message.error(`删除技能 "${props.skill.name}" 失败：${trashError.message}`);
      return;
    }

    // 目录已成功移入回收站时即便刷新失败也仅做警告，避免误导用户重复删除。
    const [rescanError] = await asyncTo(store.rescan());

    if (rescanError) {
      message.warning(`技能 "${props.skill.name}" 已移入回收站，但列表刷新失败`);
      return;
    }

    message.success(`技能 "${props.skill.name}" 已删除`);
  } finally {
    deleting.value = false;
  }
}

/** Skill 设置菜单。 */
const dropdownOptions = computed<DropdownOption[]>(() => [
  {
    type: 'item',
    value: 'edit',
    label: '编辑',
    disabled: deleting.value,
    onClick: handleEditSkill
  },
  { type: 'divider' },
  {
    type: 'item',
    value: 'delete',
    label: '删除',
    danger: true,
    disabled: deleting.value,
    onClick: handleDeleteSkill
  }
]);
</script>

<style scoped lang="less">
.skill-settings__item-row {
  display: flex;
  gap: 12px;
  align-items: center;
  cursor: pointer;
  outline: none;
}

.skill-settings__item-icon {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  background: var(--bg-tertiary);
  border-radius: var(--control-radius);
}

.skill-settings__item-info {
  flex: 1;
  min-width: 0;
}

.skill-settings__item-name {
  display: flex;
  gap: 6px;
  align-items: center;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  user-select: text;
}

.skill-settings__item-error-badge {
  display: inline-flex;
  align-items: center;
  color: var(--color-warning, #faad14);
}

.skill-settings__desc {
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 11px;
  color: var(--text-secondary);
  white-space: nowrap;
  user-select: text;
}

.skill-settings__item-parse-error {
  margin-top: 4px;
  font-size: 11px;
  color: var(--color-danger, #ff4d4f);
  user-select: text;
}

.skill-settings__item-actions {
  display: flex;
  flex-shrink: 0;
  gap: 4px;
  align-items: center;
}
</style>
