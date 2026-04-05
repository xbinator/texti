import { ref, computed } from 'vue';
import { defineStore } from 'pinia';
import * as assistantService from '@/services/settings/assistantService';
import type { Assistant, CreateAssistantInput, UpdateAssistantInput } from '@/services/settings/types';

export const useAssistantStore = defineStore('assistant', () => {
  const assistants = ref<Assistant[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  const defaultAssistant = computed(() => assistants.value.find((a) => a.isDefault));

  async function loadAssistants(): Promise<void> {
    isLoading.value = true;
    error.value = null;
    try {
      assistants.value = await assistantService.listAssistants();
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load assistants';
    } finally {
      isLoading.value = false;
    }
  }

  async function createAssistant(input: CreateAssistantInput): Promise<Assistant> {
    isLoading.value = true;
    error.value = null;
    try {
      const assistant = await assistantService.createAssistant(input);
      await loadAssistants();
      return assistant;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to create assistant';
      throw e;
    } finally {
      isLoading.value = false;
    }
  }

  async function updateAssistant(id: string, input: UpdateAssistantInput): Promise<Assistant> {
    isLoading.value = true;
    error.value = null;
    try {
      const assistant = await assistantService.updateAssistant(id, input);
      await loadAssistants();
      return assistant;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to update assistant';
      throw e;
    } finally {
      isLoading.value = false;
    }
  }

  async function deleteAssistant(id: string): Promise<void> {
    isLoading.value = true;
    error.value = null;
    try {
      await assistantService.deleteAssistant(id);
      await loadAssistants();
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to delete assistant';
      throw e;
    } finally {
      isLoading.value = false;
    }
  }

  async function setDefaultAssistant(id: string): Promise<Assistant> {
    return updateAssistant(id, { isDefault: true });
  }

  function getAssistantById(id: string): Assistant | undefined {
    return assistants.value.find((a) => a.id === id);
  }

  function getAssistantsByModel(modelId: string): Assistant[] {
    return assistants.value.filter((a) => a.modelId === modelId);
  }

  return {
    assistants,
    isLoading,
    error,
    defaultAssistant,
    loadAssistants,
    createAssistant,
    updateAssistant,
    deleteAssistant,
    setDefaultAssistant,
    getAssistantById,
    getAssistantsByModel
  };
});
