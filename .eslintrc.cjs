module.exports = {
  root: true,
  env: {
    browser: true,
    es2021: true,
    //  The Follow config only works with eslint-plugin-vue v8.0.0+
    'vue/setup-compiler-macros': true
  },
  parser: 'vue-eslint-parser',
  parserOptions: {
    parser: '@typescript-eslint/parser',
    ecmaVersion: 2020,
    sourceType: 'module',
    jsxPragma: 'React',
    ecmaFeatures: {
      jsx: true
    }
  },
  plugins: ['vue', '@typescript-eslint'],
  extends: [
    'airbnb-base',
    'eslint:recommended',
    'plugin:vue/vue3-recommended',
    'plugin:prettier/recommended',
    '@vue/eslint-config-typescript/recommended',
    '@vue/eslint-config-prettier',
    '@vue/typescript/recommended'
  ],
  settings: {
    'import/core-modules': ['uno.css']
  },
  rules: {
    'no-console': 'off',
    'max-len': ['error', { code: 160 }],
    'no-underscore-dangle': 'off',
    // export 要有 default
    'import/prefer-default-export': 'off',
    // 不需要大括号内的换行符
    'object-curly-newline': 'off',
    // 引入文件结尾带上 扩展名
    'import/extensions': 'off',
    'import/no-unresolved': 'off',
    'import/order': [
      'error',
      {
        'newlines-between': 'never',
        groups: ['builtin', 'type', 'external', 'internal', 'parent', 'sibling', 'index'],
        pathGroups: [
          {
            pattern: 'vue',
            group: 'external',
            position: 'before'
          },
          {
            pattern: 'vue-router',
            group: 'external',
            position: 'before'
          },
          {
            pattern: 'pinia',
            group: 'external',
            position: 'before'
          },
          {
            pattern: '@/**',
            group: 'internal',
            position: 'before'
          }
        ],
        pathGroupsExcludedImportTypes: ['vue', 'vue-router', 'vuex', 'pinia'],
        alphabetize: {
          order: 'asc',
          caseInsensitive: true
        }
      }
    ],
    // 组件/实例的选项的顺序
    'vue/order-in-components': [
      'error',
      {
        order: [
          'el',
          'name',
          'key',
          'parent',
          'functional',
          ['delimiters', 'comments'],
          ['components', 'directives', 'filters'],
          'extends',
          'mixins',
          ['provide', 'inject'],
          'ROUTER_GUARDS',
          'layout',
          'middleware',
          'validate',
          'scrollToTop',
          'transition',
          'loading',
          'meta',
          'inheritAttrs',
          'model',
          ['props', 'propsData'],
          'emits',
          'setup',
          'asyncData',
          'data',
          'fetch',
          'head',
          'computed',
          'watch',
          'watchQuery',
          'LIFECYCLE_HOOKS',
          'methods',
          ['template', 'render'],
          'renderError'
        ]
      }
    ],
    // 旨在强制组件属性的排序
    'vue/attributes-order': [
      'error',
      {
        order: [
          'DEFINITION',
          'LIST_RENDERING',
          'CONDITIONALS',
          'RENDER_MODIFIERS',
          'GLOBAL',
          ['UNIQUE', 'SLOT'],
          'TWO_WAY_BINDING',
          'OTHER_DIRECTIVES',
          'OTHER_ATTR',
          'EVENTS',
          'CONTENT'
        ],
        alphabetical: false
      }
    ],
    // 强制将自动关闭标志作为配置样式
    'vue/html-self-closing': [
      'error',
      {
        html: {
          void: 'always',
          normal: 'never',
          component: 'always'
        },
        svg: 'never',
        math: 'never'
      }
    ],
    // 统一的行结尾
    'linebreak-style': 'off',
    // 不允许多个空格
    'vue/no-multi-spaces': [
      'error',
      {
        ignoreProperties: false
      }
    ],
    // 属性中的等号周围不允许有空格
    'vue/no-spaces-around-equal-signs-in-attribute': ['error'],
    // 强制执行统一间距
    'vue/mustache-interpolation-spacing': ['error', 'always'],
    // 在模板大小写中定义组件名称的样式
    'vue/component-name-in-template-casing': [
      'error',
      'PascalCase',
      {
        registeredComponentsOnly: false,
        ignores: []
      }
    ],
    '@typescript-eslint/no-explicit-any': 'off',
    'import/first': 'off',
    'no-bitwise': 'off',
    'import/no-extraneous-dependencies': ['error', { devDependencies: true }],
    '@typescript-eslint/ban-types': [
      'error',
      {
        extendDefaults: true,
        types: {
          '{}': false
        }
      }
    ],
    // 要求组件名称始终为多字
    'vue/multi-word-component-names': 'off',
    //
    'no-unused-expressions': ['error', { allowShortCircuit: true, allowTernary: true }],
    // 不允许在return语句中使用赋值运算符
    'no-return-assign': 'off',
    // 不允许重新分配function参数
    'no-param-reassign': ['error', { props: false }],
    // 驼峰命名约定
    camelcase: 'off',
    // 在模板中的自定义组件上强制执行属性命名样式
    'vue/attribute-hyphenation': ['error', 'always'],
    // 禁止使用 v-html 来防止 XSS 攻击
    'vue/no-v-html': 'off',
    'no-shadow': 'off',
    '@typescript-eslint/no-shadow': ['error'],
    // 该规则不允许continue声明
    'no-continue': 'off',
    // 不允许使用一元运算符++和--
    'no-plusplus': 'off',
    //
    '@typescript-eslint/ban-ts-comment': 'off',
    //
    'consistent-return': 'off',
    //
    '@typescript-eslint/no-non-null-assertion': 'off'
  },
  overrides: [
    {
      files: ['*.vue'],
      rules: {
        'no-undef': 'off'
      }
    }
  ]
};
