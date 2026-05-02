# 语音录音呼吸灯设计

## 概述

将语音录音时的波形显示改为呼吸灯效果，呼吸灯的大小和亮度跟随声音强度实时变化。

## 需求

1. 删除 `VoiceWaveform.vue` 组件
2. 修改 `VoiceInput.vue` 组件：
   - 空闲时：显示麦克风按钮（保持原样）
   - 录音时：按钮变成圆点呼吸灯
   - 颜色：主题色（`var(--color-primary)`）
   - 效果：大小和亮度跟随声音强度变化
   - 交互：点击呼吸灯停止录音

## 设计方案

### 视觉效果

```
空闲状态：
┌─────────────────┐
│   [🎤 麦克风]    │  <- 可点击开始录音
└─────────────────┘

录音状态：
┌─────────────────┐
│     [● 呼吸灯]   │  <- 大小和亮度随声音变化，点击停止
└─────────────────┘
```

### 呼吸灯参数

| 参数 | 静音时 | 最大音量时 |
|------|--------|------------|
| 大小 | 8px | 16px |
| 透明度 | 0.4 | 1.0 |
| 过渡时间 | 100ms | 100ms |

### 技术实现

#### 1. 删除 VoiceWaveform.vue

- 删除文件：`src/components/BChatSidebar/components/InputToolbar/VoiceWaveform.vue`
- 从 `InputToolbar.vue` 中移除相关导入和使用

#### 2. 修改 VoiceInput.vue

**模板变更**：
```vue
<template>
  <div class="voice-input">
    <BButton v-if="isIdle" ...>
      <Icon icon="lucide:mic" ... />
    </BButton>
    <span
      v-else
      class="voice-breathing-light"
      :style="breathingLightStyle"
      @click="handleStop"
    ></span>
  </div>
</template>
```

**样式计算**：
- 从 `waveformSamples` 获取最新采样值
- 归一化采样值到 0-1 范围
- 计算大小：`8 + normalized * 8` (px)
- 计算透明度：`0.4 + normalized * 0.6`

**CSS 样式**：
```less
.voice-breathing-light {
  display: inline-block;
  width: var(--size, 8px);
  height: var(--size, 8px);
  background: var(--color-primary, #4080ff);
  border-radius: 50%;
  opacity: var(--opacity, 0.4);
  cursor: pointer;
  transition: width 0.1s ease-out, height 0.1s ease-out, opacity 0.1s ease-out;
}
```

#### 3. 修改 InputToolbar.vue

- 移除 `VoiceWaveform` 组件的导入
- 移除 `isVoiceRecording` 和 `voiceWaveformSamples` 计算属性
- 移除模板中的波形显示逻辑

## 文件变更清单

| 文件 | 操作 |
|------|------|
| `src/components/BChatSidebar/components/InputToolbar/VoiceWaveform.vue` | 删除 |
| `src/components/BChatSidebar/components/InputToolbar/VoiceInput.vue` | 修改 |
| `src/components/BChatSidebar/components/InputToolbar.vue` | 修改 |
| `test/components/BChatSidebar/components/VoiceInput.test.ts` | 可能需要更新测试 |

## 测试要点

1. 空闲时显示麦克风按钮
2. 点击麦克风开始录音，按钮变成呼吸灯
3. 呼吸灯大小和亮度随声音变化
4. 点击呼吸灯停止录音
5. 主题色正确应用
