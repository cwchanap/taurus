import js from '@eslint/js'
import eslintConfigPrettier from 'eslint-config-prettier'
import tseslint from 'typescript-eslint'

/** @type {import("eslint").Linter.Config} */
export default [js.configs.recommended, eslintConfigPrettier, ...tseslint.configs.recommended]
