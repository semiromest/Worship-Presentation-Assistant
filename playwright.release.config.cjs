const { defineConfig } = require('@playwright/test');
const base = require('./playwright.config.cjs');
module.exports = defineConfig({
  ...base,
  testMatch: '**/*.spec.cjs',
  // Packaged checks need an installed artifact; the scroll probe is a benchmark.
  testIgnore: ['**/packaged.spec.cjs', '**/scroll-diagnosis.spec.cjs'],
  outputDir: 'test-results/release-e2e',
  reporter: [['list'], ['html', { outputFolder: 'test-results/release-report', open: 'never' }], ['json', { outputFile: 'test-results/release-e2e.json' }]],
  use: { ...base.use, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
});
