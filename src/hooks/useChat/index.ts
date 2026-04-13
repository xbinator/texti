import type { ChatMessage, SendMessageOptions, UseChatOptions } from './types';
import type { ModelMessage } from 'ai';
import type { AIRequestOptions } from 'types/ai';
import { ref, computed, type MaybeRefOrGetter } from 'vue';
import { useAgent } from '../useAgent';
import { createAssistantMessage, createUserMessage, MessageAction } from './message';

export * from './types';
export * from './constant';

export function useChat(options: UseChatOptions) {
  const messages = ref<ChatMessage[]>([]);
  const inputText = ref('');
  const isLoading = ref(false);

  const providerId = computed(() => options.providerId);

  const { agent } = useAgent({
    providerId: providerId as MaybeRefOrGetter<string | undefined>,
    onChunk: (chunk: string) => {
      const lastMessage = messages.value.at(-1);
      if (lastMessage && lastMessage.role === 'assistant') {
        MessageAction.appendText(lastMessage, chunk);
        MessageAction.updateState(lastMessage, 'output');
        options.onReceive?.(chunk);
      }
    },
    onComplete: () => {
      const lastMessage = messages.value.at(-1);
      if (lastMessage && lastMessage.role === 'assistant') {
        MessageAction.updateState(lastMessage, 'complete');
      }
      isLoading.value = false;
      options.onComplete?.();
    },
    onError: (error) => {
      const lastMessage = messages.value.at(-1);
      if (lastMessage && lastMessage.role === 'assistant') {
        MessageAction.setError(lastMessage, { message: error.message });
        MessageAction.updateState(lastMessage, 'complete');
      }
      isLoading.value = false;
      options.onError?.(error);
    }
  });

  function buildRequestOptions(content: string, opts?: SendMessageOptions): AIRequestOptions {
    const requestMessages: ModelMessage[] = [];

    if (opts?.systemPrompt) {
      requestMessages.push({ role: 'system', content: opts.systemPrompt });
    }

    messages.value.forEach((msg) => {
      if (msg.text) {
        requestMessages.push({ role: msg.role, content: msg.text });
      }
    });

    requestMessages.push({ role: 'user', content });

    return {
      modelId: opts?.model || '',
      messages: requestMessages,
      temperature: opts?.temperature
    };
  }

  async function sendMessage(content: string, opts?: SendMessageOptions): Promise<void> {
    if (!content.trim() || isLoading.value) return;

    options.onBeforeSend?.();

    const userMessage = createUserMessage(content);
    messages.value.push(userMessage);

    const assistantMessage = createAssistantMessage();
    messages.value.push(assistantMessage);

    inputText.value = '';
    isLoading.value = true;

    const requestOptions = buildRequestOptions(content, opts);

    await agent.stream(requestOptions);
  }

  function abort(): void {
    if (isLoading.value) {
      agent.abort();
      isLoading.value = false;

      const lastMessage = messages.value.at(-1);
      if (lastMessage && lastMessage.role === 'assistant') {
        MessageAction.updateState(lastMessage, 'complete');
      }
    }
  }

  function clearMessages(): void {
    messages.value = [];
  }

  function getLastMessage(): ChatMessage | undefined {
    return messages.value.at(-1);
  }

  return {
    messages,
    inputText,
    isLoading,
    sendMessage,
    abort,
    clearMessages,
    getLastMessage
  };
}
