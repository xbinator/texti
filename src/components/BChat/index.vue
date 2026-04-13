<!-- 聊天组件模板 -->
<template>
  <div class="b-chat">
    <Container ref="containerRef" :loading="loading" class="b-chat__container">
      <div class="b-chat__messages">
        <MessageBubble
          v-for="msg in messages"
          :key="msg.id"
          :message="msg"
          @copy="handleCopy"
          @edit="handleEdit"
          @delete="handleDelete"
          @regenerate="handleRegenerate"
        />
      </div>
      <slot></slot>
    </Container>

    <div class="b-chat__input">
      <!-- 提示词编辑器组件 -->
      <BPromptEditor
        v-model:value="inputValue"
        placeholder="输入消息..."
        :max-height="200"
        :submit-on-enter="true"
        :disabled="loading"
        @submit="handleSubmit"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { BChatProps as Props, Message } from './types';
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useClipboard } from '@vueuse/core';
import { message } from 'ant-design-vue';
import { nanoid } from 'nanoid';
import { useAgent } from '@/hooks/useAgent';
import { useServiceModelStore } from '@/stores/service-model';
import { Modal } from '@/utils/modal';
import Container from './components/Container.vue';
import MessageBubble from './components/MessageBubble.vue';

defineOptions({ name: 'BChat' });

// 定义组件属性
const props = withDefaults(defineProps<Props>(), {});

// 路由实例
const router = useRouter();
// 剪贴板复制功能
const { copy } = useClipboard();

// 输入框内容
const inputValue = ref('');
// 消息列表，支持双向绑定
const messages = defineModel<Message[]>('messages', { default: () => [] });
// 加载状态
const loading = ref(false);
// 服务模型状态存储
const serviceModelStore = useServiceModelStore();
// 容器组件引用，用于滚动控制
const containerRef = ref<InstanceType<typeof Container>>();

// 初始化Agent，处理AI对话流的各种回调
const { agent } = useAgent({
  // 接收到流式数据块时的处理
  onChunk: (content: string) => {
    const lastMessage = messages.value[messages.value.length - 1];
    if (lastMessage && lastMessage.role === 'assistant') {
      // 追加内容到最后一条助手消息
      lastMessage.content += content;
      // 自动滚动到底部
      containerRef.value?.scrollToBottom();
    }
  },
  // 对话完成时的处理
  onComplete: () => {
    loading.value = false;
    const lastMessage = messages.value[messages.value.length - 1];
    if (lastMessage && lastMessage.role === 'assistant') {
      // 关闭加载状态
      lastMessage.loading = false;
    }
  },
  // 发生错误时的处理
  onError: (error) => {
    message.error(error.message);
    const lastMessage = messages.value[messages.value.length - 1];
    if (lastMessage && lastMessage.role === 'assistant') {
      lastMessage.loading = false;
      // 记录错误信息
      lastMessage.error = error.message;
    }
  }
});

/**
 * 获取服务配置
 * 如果未配置可用的大模型服务，会弹出提示框引导用户去设置
 * @returns 服务配置对象或null
 */
async function getServiceConfig() {
  // 检查是否指定了服务类型
  if (!props.serviceType) return null;

  // 获取可用的服务配置
  const config = await serviceModelStore.getAvailableServiceConfig(props.serviceType);

  // 如果配置有效，直接返回
  if (config?.providerId && config?.modelId) return config;

  // 未配置时弹出确认框，引导用户去设置页面
  const [, confirmed] = await Modal.confirm('提示', '当前未配置可用的大模型服务', { confirmText: '去填写', cancelText: '取消' });

  confirmed && router.push('/settings/service-model');
}

/**
 * 内部方法：执行大模型流式请求
 * @param config 服务配置
 */
async function _streamMessage(config: { providerId: string; modelId: string }) {
  loading.value = true;
  // 添加助手占位消息
  messages.value.push({ id: nanoid(), role: 'assistant', content: '', loading: true });
  // 构建传给大模型的上下文历史 (排除刚才加的占位消息)
  const chatMessages = messages.value.slice(0, -1).map((msg) => ({ role: msg.role, content: msg.content }));

  containerRef.value?.scrollToBottom();

  await agent.stream({ messages: chatMessages, modelId: config.modelId, providerId: config.providerId });
}

/**
 * 提交消息处理函数
 * 将用户消息添加到列表，并发送给AI获取回复
 */
async function handleSubmit(): Promise<void> {
  const prompt = inputValue.value.trim();
  if (!prompt || loading.value) return;

  const config = await getServiceConfig();
  if (!config) return;

  // 添加用户消息
  messages.value.push({ id: nanoid(), role: 'user', content: prompt });

  inputValue.value = '';

  await _streamMessage(config);
}

/**
 * 处理消息复制
 * @param msg 要复制的消息对象
 */
function handleCopy(msg: Message) {
  copy(msg.content);

  message.success('已复制到剪贴板');
}

/**
 * 处理消息编辑
 * 将消息内容填充到输入框中
 * @param msg 要编辑的消息对象
 */
function handleEdit(msg: Message) {
  inputValue.value = msg.content;
}

/**
 * 处理消息删除
 * @param msg 要删除的消息对象
 */
function handleDelete(msg: Message) {
  const index = messages.value.findIndex((m) => m.id === msg.id);
  if (index !== -1) {
    messages.value.splice(index, 1);
  }
}

async function handleRegenerate(msg: Message) {
  if (loading.value) return;

  const config = await getServiceConfig();
  if (!config) return;

  const index = messages.value.findIndex((m) => m.id === msg.id);
  if (index === -1) return;

  // 截断逻辑：如果是助手消息，则回退到上一条用户消息；如果是用户消息，则截断其后的所有消息
  const targetIndex = msg.role === 'assistant' ? index - 1 : index;

  if (msg.role === 'assistant') {
    messages.value.splice(index, 1);
  } else {
    messages.value.splice(index + 1);
  }

  const userMsg = messages.value[targetIndex];
  if (!userMsg || userMsg.role !== 'user') return;

  await _streamMessage(config);
}
</script>

<style lang="less">
/* 聊天组件主容器 */
.b-chat {
  display: flex;
  flex-direction: column;
  height: 100%;
}

/* 消息列表容器 */
.b-chat__container {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.b-chat__messages {
  display: flex;
  flex-direction: column;
  padding: 16px;
}

/* 输入区域样式 */
.b-chat__input {
  padding: 12px;
  border-top: 1px solid var(--border-color, rgb(0 0 0 / 6%));
  transition: opacity 0.2s ease;
}

/* 当输入框禁用时，降低透明度 */
.b-chat__input:has([disabled]) {
  opacity: 0.6;
}
</style>
