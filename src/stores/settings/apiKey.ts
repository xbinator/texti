import { ref, computed } from 'vue';
import { defineStore } from 'pinia';
import * as apiKeyService from '@/services/settings/apiKeyService';
import type { ApiKeyProfile, CreateApiKeyProfileInput, UpdateApiKeyProfileInput, ConnectionTestResult } from '@/services/settings/types';

export const useApiKeyStore = defineStore('apiKey', () => {
  const profiles = ref<ApiKeyProfile[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  const defaultProfile = computed(() => profiles.value.find((p) => p.isDefault));

  async function loadProfiles(): Promise<void> {
    isLoading.value = true;
    error.value = null;
    try {
      profiles.value = await apiKeyService.listApiKeyProfiles();
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load API key profiles';
    } finally {
      isLoading.value = false;
    }
  }

  async function createProfile(input: CreateApiKeyProfileInput): Promise<ApiKeyProfile> {
    isLoading.value = true;
    error.value = null;
    try {
      const profile = await apiKeyService.createApiKeyProfile(input);
      await loadProfiles();
      return profile;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to create API key profile';
      throw e;
    } finally {
      isLoading.value = false;
    }
  }

  async function updateProfile(id: string, input: UpdateApiKeyProfileInput): Promise<ApiKeyProfile> {
    isLoading.value = true;
    error.value = null;
    try {
      const profile = await apiKeyService.updateApiKeyProfile(id, input);
      await loadProfiles();
      return profile;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to update API key profile';
      throw e;
    } finally {
      isLoading.value = false;
    }
  }

  async function deleteProfile(id: string): Promise<void> {
    isLoading.value = true;
    error.value = null;
    try {
      await apiKeyService.deleteApiKeyProfile(id);
      await loadProfiles();
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to delete API key profile';
      throw e;
    } finally {
      isLoading.value = false;
    }
  }

  async function testConnection(id: string): Promise<ConnectionTestResult> {
    const result = await apiKeyService.testConnection(id);
    await loadProfiles();
    return result;
  }

  function getProfileById(id: string): ApiKeyProfile | undefined {
    return profiles.value.find((p) => p.id === id);
  }

  return {
    profiles,
    isLoading,
    error,
    defaultProfile,
    loadProfiles,
    createProfile,
    updateProfile,
    deleteProfile,
    testConnection,
    getProfileById
  };
});
