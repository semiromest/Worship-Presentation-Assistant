const base = require('./playwright.config.cjs');

// Explicit opt-in: SCROLL_AFTER=1 measures the implemented fix using original
// sources. SCROLL_FIXTURE supplies local status JSON without an open user app.
module.exports = {
  ...base,
  testMatch: ['scroll-diagnosis.spec.cjs'],
  timeout: 120000,
  outputDir: 'test-results/scroll-performance',
};
