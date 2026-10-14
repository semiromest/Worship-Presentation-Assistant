const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: __dirname, testMatch: 'music.spec.cjs', timeout: 180000,
  workers: 1, retries: 0, reporter: 'list',
  outputDir: '../../test-results/youtube',
});
