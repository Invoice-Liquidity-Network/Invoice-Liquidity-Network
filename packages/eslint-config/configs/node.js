/** @type {import('eslint').Linter.Config} */
module.exports = {
  extends: ['./base.js', 'prettier'],
  env: {
    node: true,
    es2022: true
  },
  rules: {
    'no-process-exit': 'warn',
    'no-path-concat': 'error'
  }
};
