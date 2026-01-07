import js from '@eslint/js'
import eslintConfigPrettier from 'eslint-config-prettier'
import tseslint from 'typescript-eslint'

export default [
  {
    ignores: ['**/worker-configuration.d.ts', 'node_modules/**', '.wrangler/**'],
  },
  js.configs.recommended,
  eslintConfigPrettier,
  ...tseslint.configs.recommended,
  {
    rules: {
      'no-undef': 'off',
    },
  },
]
