import { defineConfig, presetWind3, presetAttributify } from 'unocss';

export default defineConfig({
  presets: [presetWind3(), presetAttributify()],
  theme: {
    colors: {
      primary: '#409eff',
      dark: '#1a1a1a',
      'dark-bg': '#252526',
      'dark-text': '#d4d4d4'
    }
  },
  shortcuts: {
    btn: 'px-4 py-2 rounded cursor-pointer border-none outline-none transition-colors duration-200',
    'btn-primary': 'btn bg-primary text-white hover:bg-blue-600',
    'btn-ghost': 'btn bg-transparent hover:bg-gray-200 dark:hover:bg-gray-700'
  }
});
