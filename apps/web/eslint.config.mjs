import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';

export default [
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      globals: { module: 'readonly', require: 'readonly', __dirname: 'readonly' },
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      'no-unused-vars': 'off',
      'no-undef': 'off',
    },
  },
  {
    ignores: ['.next/**', 'node_modules/**', 'dist/**'],
  },
];
