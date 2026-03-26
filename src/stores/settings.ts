import { ref } from 'vue';
import { defineStore } from 'pinia';

export type Theme = 'light' | 'dark';

export const useSettingsStore = defineStore('settings', () => {
  const theme = ref<Theme>('light');
  const fontSize = ref(14);

  function setTheme(newTheme: Theme) {
    theme.value = newTheme;
    localStorage.setItem('theme', newTheme);
    document.documentElement.setAttribute('data-theme', newTheme);
  }

  function setFontSize(size: number) {
    fontSize.value = size;
    localStorage.setItem('fontSize', String(size));
  }

  function loadSettings() {
    const savedTheme = localStorage.getItem('theme') as Theme | null;
    const savedFontSize = localStorage.getItem('fontSize');

    if (savedTheme) {
      theme.value = savedTheme;
      document.documentElement.setAttribute('data-theme', savedTheme);
    }

    if (savedFontSize) {
      fontSize.value = parseInt(savedFontSize, 10);
    }
  }

  return {
    theme,
    fontSize,
    setTheme,
    setFontSize,
    loadSettings
  };
});
