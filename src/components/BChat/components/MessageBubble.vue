<template>
  <div class="b-message-bubble">
    <BBubbleText
      :content="message.content"
      :placement="message.role === 'assistant' ? 'left' : 'right'"
      :loading="message.loading"
      :avatar="{ title: message.role === 'assistant' ? 'A' : 'U' }"
      size="auto"
    >
      <template v-if="message.role === 'user' && message.images?.length" #header>
        <div class="b-message-bubble__images">
          <img v-for="(img, idx) in message.images" :key="idx" :src="img" alt="Uploaded Image" class="b-message-bubble__image" />
        </div>
      </template>
      <template #toolbar>
        <div class="b-message-bubble__toolbar" :class="{ 'b-message-bubble__toolbar--right': message.role === 'user' }">
          <BButton type="text" size="small" icon="lucide:copy" @click="$emit('copy', message)" />
          <BButton v-if="message.role === 'user'" type="text" size="small" icon="lucide:edit-2" @click="$emit('edit', message)" />
          <BButton v-if="message.role === 'assistant'" type="text" size="small" icon="lucide:refresh-cw" @click="$emit('regenerate', message)" />
          <BButton type="text" size="small" danger icon="lucide:trash-2" @click="$emit('delete', message)" />
        </div>
      </template>
    </BBubbleText>
  </div>
</template>

<script setup lang="ts">
import type { Message } from '../types';
import BBubbleText from '@/components/BBubbleText/index.vue';
import BButton from '@/components/BButton/index.vue';

defineOptions({ name: 'BMessageBubble' });

defineProps<{
  message: Message;
}>();

defineEmits<{
  (e: 'copy', message: Message): void;
  (e: 'edit', message: Message): void;
  (e: 'delete', message: Message): void;
  (e: 'regenerate', message: Message): void;
}>();
</script>

<style scoped lang="less">
.b-message-bubble {
  display: flex;
  flex-direction: column;
  margin-bottom: 16px;
}

.b-message-bubble:last-child {
  margin-bottom: 0;
}

.b-message-bubble__images {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.b-message-bubble__image {
  max-width: 200px;
  max-height: 200px;
  object-fit: cover;
  border-radius: 8px;
}

.b-message-bubble__toolbar {
  display: flex;
  gap: 4px;
  padding: 0 8px;
}

.b-message-bubble__toolbar--right {
  justify-content: flex-end;
}
</style>
