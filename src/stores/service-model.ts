import { defineStore } from 'pinia';

const STORAGE_KEY = 'service_model_settings';

interface ServiceModelSettings {
  collapsedSections: Record<string, boolean>;
}

interface ServiceModelState {
  settings: ServiceModelSettings;
}

function loadSettings(): ServiceModelSettings {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch {
    // ignore
  }
  return { collapsedSections: {} };
}

function saveSettings(settings: ServiceModelSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export const useServiceModelStore = defineStore('serviceModel', {
  state: (): ServiceModelState => ({
    settings: loadSettings()
  }),

  actions: {
    isSectionCollapsed(serviceType: string, section: string): boolean {
      const key = `${serviceType}:${section}`;
      return this.settings.collapsedSections[key] ?? false;
    },

    toggleSectionCollapsed(serviceType: string, section: string): void {
      const key = `${serviceType}:${section}`;
      this.settings.collapsedSections[key] = !this.settings.collapsedSections[key];
      saveSettings(this.settings);
    },

    setSectionCollapsed(serviceType: string, section: string, collapsed: boolean): void {
      const key = `${serviceType}:${section}`;
      this.settings.collapsedSections[key] = collapsed;
      saveSettings(this.settings);
    }
  }
});
