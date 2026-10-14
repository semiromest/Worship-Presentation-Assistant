/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS Node/Playwright entrypoint. */
const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({ testDir: './tests/tour', testMatch: 'packaged.spec.cjs', timeout: 90000,
  workers: 1, retries: 0, reporter: 'list', outputDir: 'test-results/packaged-tour' });
