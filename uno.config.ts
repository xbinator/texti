import { defineConfig, presetAttributify, presetWind3 } from 'unocss';

const remRE = /(-?[.\d]+)rem/g;

export default defineConfig({
  presets: [presetWind3(), presetAttributify()],
  shortcuts: {
    'flex-center': 'flex justify-center items-center',
    'flex-between': 'flex justify-between',
    'flex-x-center': 'flex justify-center',
    'flex-y-center': 'flex items-center',
    'flex-between-center': 'flex justify-between items-center'
  },
  rules: [
    [/^fs-(\d+)$/, ([, v]) => ({ 'font-size': `${v}px` })],
    [/^c([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, ([, d]) => ({ color: `#${d}` })]
  ],
  theme: {
    colors: {
      primary: 'var(--primary-color)',
      error: 'var(--error-color)'
    },
    fontSize: {
      base: '16px',
      sm: '14px',
      lg: '18px',
      xl: '20px',
      '1xl': '16px',
      '2xl': '24px',
      '3xl': '32px'
    }
  },
  postprocess: (util) => {
    util.entries.forEach((i) => {
      const value = i[1];

      if (value && typeof value === 'string' && remRE.test(value)) {
        // eslint-disable-next-line no-param-reassign
        i[1] = value.replace(remRE, (_, p1) => `${p1 * 4}px`);
      }
    });
  }
});
