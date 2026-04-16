import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import storybook from 'eslint-plugin-storybook';
import tseslint from 'typescript-eslint';

const sharedTypeScriptFiles = ['**/*.{ts,tsx}'];
const jsxA11yRecommendedWarnings = Object.fromEntries(
  Object.keys(jsxA11y.configs.recommended.rules).map((ruleName) => [ruleName, 'warn']),
);

export default tseslint.config(
  {
    ignores: [
      'dist',
      'build',
      'coverage',
      'node_modules',
      'playwright-report',
      'storybook-static',
      'test-results',
      '.storybook',
      '.tsbuildinfo',
      '*.config.js',
      '*.min.js',
      '*.min.css',
    ],
  },
  {
    files: sharedTypeScriptFiles,
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'jsx-a11y': jsxA11y,
    },
    rules: {
      ...jsxA11yRecommendedWarnings,
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      'no-case-declarations': 'warn',
    },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/__tests__/**/*'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
  {
    files: ['*.config.ts', '*.config.js', 'vitest.config.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: ['src/features/**/*.ts', 'src/features/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../features/*'],
              message: 'Features should not import directly from other features. Use shared/ or app/ for shared code.',
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      'src/features/**/routes/**/*.ts',
      'src/features/**/routes/**/*.tsx',
      'src/features/**/hooks/**/*.ts',
      'src/features/**/hooks/**/*.tsx',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../../../app/*'],
              message: 'Use @app/* imports from feature routes and hooks.',
            },
            {
              group: ['../../../services/*'],
              message: 'Use @services/* imports from feature routes and hooks.',
            },
            {
              group: ['../../../components/*'],
              message: 'Use @components/* imports from feature routes and hooks.',
            },
            {
              group: ['../../../features/*', '../../features/*', '../features/*'],
              message: 'Do not cross feature boundaries with relative feature imports.',
            },
          ],
        },
      ],
    },
  },
  ...storybook.configs['flat/recommended'],
);
