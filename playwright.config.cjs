const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests/tour', testMatch: ['tour.spec.cjs', 'guided.spec.cjs'], timeout: 60000,
  workers: 1, retries: 0, reporter: 'list',
  outputDir: 'test-results/tour',
  webServer: {
    command: 'npx vite --config tests/tour/vite.config.ts --host 127.0.0.1 --port 5199 --strictPort',
    url: 'http://127.0.0.1:5199', reuseExistingServer: false, timeout: 30000,
  },
});
