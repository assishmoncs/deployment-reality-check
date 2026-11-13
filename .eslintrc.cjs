module.exports = {
  root: true,
  env: {
    node: true,
    es2022: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  ignorePatterns: ['node_modules/', 'dist/', 'coverage/', 'examples/', 'tests/fixtures/', 'scripts/', 'bin/'],
  rules: {
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-var-requires': 'off',
    // The source intentionally uses CommonJS requires for runtime-loaded modules.
    '@typescript-eslint/no-require-imports': 'off',
    'no-eval': 'error',
    'no-implied-eval': 'error',
    'prefer-const': 'error',
    'eqeqeq': ['error', 'always'],
  },
};
