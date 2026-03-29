import { ref } from 'vue';
import { defineStore } from 'pinia';

export type Theme = 'light' | 'dark';

export const useSettingsStore = defineStore('settings', () => {
  const theme = ref<Theme>('light');
  const fontSize = ref(14);
  const autoSaveEnabled = ref(true);
  const autoSaveDelay = ref(2000);

  function setTheme(newTheme: Theme) {
    theme.value = newTheme;
    localStorage.setItem('theme', newTheme);
    document.documentElement.setAttribute('data-theme', newTheme);
  }

  function setFontSize(size: number) {
    fontSize.value = size;
    localStorage.setItem('fontSize', String(size));
  }

  function setAutoSaveEnabled(enabled: boolean) {
    autoSaveEnabled.value = enabled;
    localStorage.setItem('autoSaveEnabled', String(enabled));
  }

  function setAutoSaveDelay(delay: number) {
    autoSaveDelay.value = delay;
    localStorage.setItem('autoSaveDelay', String(delay));
  }

  function loadSettings() {
    const savedTheme = localStorage.getItem('theme') as Theme | null;
    const savedFontSize = localStorage.getItem('fontSize');
    const savedAutoSaveEnabled = localStorage.getItem('autoSaveEnabled');
    const savedAutoSaveDelay = localStorage.getItem('autoSaveDelay');

    if (savedTheme) {
      theme.value = savedTheme;
      document.documentElement.setAttribute('data-theme', savedTheme);
    }

    if (savedFontSize) {
      fontSize.value = parseInt(savedFontSize, 10);
    }

    if (savedAutoSaveEnabled !== null) {
      autoSaveEnabled.value = savedAutoSaveEnabled === 'true';
    }

    if (savedAutoSaveDelay !== null) {
      autoSaveDelay.value = parseInt(savedAutoSaveDelay, 10);
    }
  }

  return {
    theme,
    fontSize,
    autoSaveEnabled,
    autoSaveDelay,
    setTheme,
    setFontSize,
    setAutoSaveEnabled,
    setAutoSaveDelay,
    loadSettings
  };
});
