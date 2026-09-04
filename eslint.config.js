import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';

/**
 * Flat ESLint config.
 *
 * Two things are being enforced here. The first is ordinary correctness
 * hygiene, using type-aware rules -- unhandled promises and unsafe `any` flow
 * are the failure modes that actually bite in this codebase. The second is the
 * dependency rule from ARCHITECTURE.md: `domain` depends on nothing. That claim
 * is worth a machine check rather than a code review habit.
 */
export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/coverage/**', 'data/**', '**/node_modules/**'],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        // Every linted .ts/.tsx file belongs to a tsconfig: the package ones,
        // plus the root tsconfig.json for repo-level config files.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      // Surfacing a rejected promise is not optional in a server process.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      // process.env is an index signature. Bracket access says so honestly.
      '@typescript-eslint/dot-notation': ['error', { allowIndexSignaturePropertyAccess: true }],
    },
  },

  // The flat config itself is JS and outside every package tsconfig, so
  // type-aware rules have nothing to work with there.
  {
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },

  // The dependency rule, enforced rather than documented.
  {
    files: ['packages/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@market-pulse/server',
                '@market-pulse/server/*',
                '@market-pulse/web',
                '@market-pulse/web/*',
              ],
              message:
                'domain depends on nothing. Move this logic to the package that needs it, or invert the dependency.',
            },
            {
              group: ['express', 'express/*', 'react', 'react/*', 'react-dom', 'react-dom/*'],
              message:
                'domain is framework-free: no HTTP and no React. Keep transport and rendering in server/web.',
            },
            {
              group: ['node:*'],
              message:
                'domain must run anywhere, including the browser. Take what you need as a parameter (see Clock) instead of reaching for a Node built-in.',
            },
          ],
        },
      ],
    },
  },

  // web depends on domain for contracts only, never on server internals.
  {
    files: ['packages/web/**/*.{ts,tsx}'],
    ...reactHooks.configs.flat['recommended-latest'],
    rules: {
      ...reactHooks.configs.flat['recommended-latest'].rules,
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@market-pulse/server', '@market-pulse/server/*'],
              message: 'web talks to server over HTTP, never by import.',
            },
          ],
        },
      ],
    },
  },

  {
    files: ['packages/server/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@market-pulse/web', '@market-pulse/web/*'],
              message: 'server must not import the client.',
            },
          ],
        },
      ],
    },
  },

  // Tests reach into fixtures and stub globals; the strictest type rules get in
  // the way there without catching real defects.
  {
    files: ['**/*.test.{ts,tsx}', '**/test/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },

  // Must stay last: turns off everything Prettier owns.
  prettier,
);
