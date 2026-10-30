// @ts-check
import angular from 'angular-eslint';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', '.angular/', 'out-tsc/', 'node_modules/', 'del/', '*.js', '*.mjs'] },
  {
    files: ['**/*.ts'],
    extends: [...tseslint.configs.recommendedTypeChecked, ...angular.configs.tsRecommended],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    processor: angular.processInlineTemplates,
    rules: {
      // The project is signal-first: signal properties must be readonly.
      '@angular-eslint/prefer-signals': 'error',
      '@angular-eslint/prefer-signal-model': 'error',
      '@angular-eslint/prefer-output-readonly': 'error',
      '@angular-eslint/prefer-output-emitter-ref': 'error',
      '@angular-eslint/reactive-context-must-read-signal': 'error',
      '@angular-eslint/no-uncalled-signals': 'error',
      '@angular-eslint/computed-must-return': 'error',
      // The Angular team's direction: @Service, the host object, takeUntilDestroyed, no legacy metadata.
      '@angular-eslint/prefer-service-decorator': 'error',
      '@angular-eslint/use-injectable-provided-in': 'error',
      '@angular-eslint/prefer-host-metadata-property': 'error',
      '@angular-eslint/no-implicit-take-until-destroyed': 'error',
      '@angular-eslint/no-queries-metadata-property': 'error',
      '@angular-eslint/no-attribute-decorator': 'error',
      '@angular-eslint/no-forward-ref': 'error',
      '@angular-eslint/no-lifecycle-call': 'error',
      '@angular-eslint/no-async-lifecycle-method': 'error',
      '@angular-eslint/no-pipe-impure': 'error',
      '@angular-eslint/no-duplicates-in-metadata-arrays': 'error',
      '@angular-eslint/consistent-component-styles': 'error',
      '@angular-eslint/relative-url-prefix': 'error',
      // Going above the current folder uses the @app/* and @ui-kit/* aliases; './' stays for files of the same folder.
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['../*'], message: 'Use the @app/* or @ui-kit/* alias instead of a parent-relative import.' }] },
      ],
      '@typescript-eslint/prefer-readonly': 'error',
      '@typescript-eslint/explicit-member-accessibility': ['error', { accessibility: 'explicit' }],
      // [LOAD-BEARING] OnPush is the default since Angular 22 (Default was renamed to Eager); the team says not to set it explicitly.
      '@angular-eslint/prefer-on-push-component-change-detection': 'off',
      // [LOAD-BEARING] Many service methods are async by contract (callers await them and rely on thrown errors
      // becoming rejections) even where the body currently has nothing to await.
      '@typescript-eslint/require-await': 'off',
      // A leading underscore marks a deliberately unused parameter (used in specs).
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // [LOAD-BEARING] Test doubles and fakes are deliberately loosely typed.
    files: ['**/*.spec.ts', 'src/app/testing/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
  {
    files: ['**/*.html'],
    extends: [...angular.configs.templateRecommended],
    rules: {
      '@angular-eslint/template/prefer-at-empty': 'error',
      '@angular-eslint/template/prefer-at-else': 'error',
      '@angular-eslint/template/prefer-contextual-for-variables': 'error',
      '@angular-eslint/template/prefer-template-literal': 'error',
      '@angular-eslint/template/require-switch-default': 'error',
      '@angular-eslint/template/button-has-type': 'error',
    },
  },
);
