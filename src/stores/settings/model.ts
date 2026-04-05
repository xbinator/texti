import { ref, computed } from 'vue';
import { defineStore } from 'pinia';
import * as modelService from '@/services/settings/modelService';
import type { Model, CreateModelInput, UpdateModelInput } from '@/services/settings/types';

export const useModelStore = defineStore('model', () => {
  const models = ref<Model[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  const defaultModel = computed(() => models.value.find((m) => m.isDefault && m.isEnabled));
  const enabledModels = computed(() => models.value.filter((m) => m.isEnabled));

  async function loadModels(): Promise<void> {
    isLoading.value = true;
    error.value = null;
    try {
      models.value = await modelService.listModels();
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load models';
    } finally {
      isLoading.value = false;
    }
  }

  async function createModel(input: CreateModelInput): Promise<Model> {
    isLoading.value = true;
    error.value = null;
    try {
      const model = await modelService.createModel(input);
      await loadModels();
      return model;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to create model';
      throw e;
    } finally {
      isLoading.value = false;
    }
  }

  async function updateModel(id: string, input: UpdateModelInput): Promise<Model> {
    isLoading.value = true;
    error.value = null;
    try {
      const model = await modelService.updateModel(id, input);
      await loadModels();
      return model;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to update model';
      throw e;
    } finally {
      isLoading.value = false;
    }
  }

  async function deleteModel(id: string): Promise<void> {
    isLoading.value = true;
    error.value = null;
    try {
      await modelService.deleteModel(id);
      await loadModels();
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to delete model';
      throw e;
    } finally {
      isLoading.value = false;
    }
  }

  async function setModelEnabled(id: string, enabled: boolean): Promise<Model> {
    return updateModel(id, { isEnabled: enabled });
  }

  async function setDefaultModel(id: string): Promise<Model> {
    return updateModel(id, { isDefault: true });
  }

  function getModelById(id: string): Model | undefined {
    return models.value.find((m) => m.id === id);
  }

  function getModelsByApiKeyProfile(apiKeyProfileId: string): Model[] {
    return models.value.filter((m) => m.apiKeyProfileId === apiKeyProfileId);
  }

  return {
    models,
    isLoading,
    error,
    defaultModel,
    enabledModels,
    loadModels,
    createModel,
    updateModel,
    deleteModel,
    setModelEnabled,
    setDefaultModel,
    getModelById,
    getModelsByApiKeyProfile
  };
});
