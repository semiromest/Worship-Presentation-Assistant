/* Run after `vite build`: node scripts/pptx-import-check.cjs <file.pptx> ... */
const { _electron: electron, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const AdmZip = require('adm-zip');
const sharp = require('sharp');

const SLIDE_ID_RE = /<(?:[\w-]+:)?sldId(?=[\s/>])/g;
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

/** Ana süreçte belleği örnekler: dönüşüm worker'ı her aktarımda kapandığı için sonradan ölçmek tepe değeri kaçırır. */
const startMemorySampler = app => app.evaluate(({ app }) => {
  const peaks = new Map();
  globalThis.__wpaPeaks = peaks;
  globalThis.__wpaSampler = setInterval(() => {
    for (const m of app.getAppMetrics()) {
      const key = `${m.type}|${m.serviceName ?? m.name ?? ''}|${m.pid}`;
      const kb = Math.max(m.memory.workingSetSize ?? 0, m.memory.peakWorkingSetSize ?? 0);
      if (kb > (peaks.get(key) ?? 0)) peaks.set(key, kb);
    }
  }, 200);
});
const takePeaks = app => app.evaluate(() => {
  const out = [...globalThis.__wpaPeaks];
  globalThis.__wpaPeaks.clear();
  return out;
});
const stopMemorySampler = app => app.evaluate(() => clearInterval(globalThis.__wpaSampler)).catch(() => {});

async function main() {
  const inputs = process.argv.slice(2).map(p => path.resolve(p));
  if (!inputs.length) throw new Error('Pass local PPTX paths; no private files are bundled with this test.');
  for (const file of inputs) {
    assert.match(file, /\.(pptx|pptm)$/i, `Unsupported test file type: ${file}`);
  }
  const runCount = Number(process.env.PPTX_CHECK_RUNS ?? 3);
  assert.ok(Number.isInteger(runCount) && runCount >= 1 && runCount <= 3);
  const maxUtilityKb = process.env.PPTX_CHECK_MAX_UTILITY_MB ? Number(process.env.PPTX_CHECK_MAX_UTILITY_MB) * 1024 : null;

  const root = path.resolve('.tmp/pptx-import-check', crypto.randomUUID());
  await fs.mkdir(root, { recursive: true });
  const sources = await Promise.all(inputs.map(async file => {
    const bytes = await fs.readFile(file);
    const xml = new AdmZip(bytes).readAsText('ppt/presentation.xml');
    return { file, hash: sha256(bytes), count: [...xml.matchAll(SLIDE_ID_RE)].length };
  }));
  const report = { ok: false, sources, runs: [], output: root, ui: {}, error: null };
  const writeReport = () => fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2));
  /** Kaynak başına ilk aktarımın medya referansları: tekrar aktarımın aynı çıktıyı verdiğini karşılaştırmak için. */
  const firstRefs = new Map();

  async function checkRun(run) {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL;
    const executablePath = process.env.PPTX_CHECK_EXECUTABLE;
    const app = await electron.launch({
      ...(executablePath ? { executablePath } : {}),
      args: [...(executablePath ? [] : [path.resolve('dist-electron/main.js')]), '--wpa-smoke'],
      env,
      timeout: 40000,
    });
    try {
      const page = await app.firstWindow();
      page.setDefaultTimeout(30000);
      await page.waitForFunction(() => !!window.electronAPI);
      await page.evaluate(() => localStorage.setItem('i18nextLng', 'en'));
      await page.reload();
      await page.waitForFunction(() => !!window.electronAPI);
      await startMemorySampler(app);
      const profile = await app.evaluate(({ app }) => app.getPath('userData'));
      console.log('Isolated Electron run', run + 1);

      for (const [index, source] of sources.entries()) {
        for (const phase of ['first', 'repeat']) {
          await takePeaks(app); // önceki aktarımın değerlerini at
          const start = performance.now();
          const result = await page.evaluate(file => window.electronAPI.importPptx(file), source.file);
          const ms = Math.round(performance.now() - start);
          const peaks = await takePeaks(app);
          assert.equal(result.success, true, result.error);
          assert.equal(result.slides.length, source.count);
          assert.deepEqual(
            result.slides.map(s => s.slideNumber),
            Array.from({ length: source.count }, (_, i) => i + 1),
            'Slide numbers must be 1..n in order',
          );
          assert.equal(new Set(result.slides.map(s => `${s.width}x${s.height}`)).size, 1, 'All slides of a deck share one size');

          const output = path.join(root, `run-${run}-${index}-${phase}`);
          await fs.mkdir(output);
          const blanks = [];
          for (const slide of result.slides) {
            assert.ok(slide.width > 0 && slide.height > 0);
            assert.match(slide.imageData, /^local-resource:\/\/media\//);
            const file = path.join(profile, 'media', slide.imageData.split('/').pop());
            const stats = await sharp(file).stats();
            if (stats.channels.slice(0, 3).every(c => c.min === 255)) blanks.push(slide.slideNumber);
            if (run === 0 && phase === 'first') await fs.copyFile(file, path.join(output, `${slide.slideNumber}.png`));
          }
          assert.deepEqual(blanks, [], 'These reference decks have no intentionally blank slides');
          const decoded = await page.evaluate(async refs => Promise.all(refs.map(async ref => {
            const image = new Image(); image.src = ref; await image.decode(); return [image.naturalWidth, image.naturalHeight];
          })), result.slides.map(s => s.imageData));
          assert.ok(decoded.every(([w, h]) => w > 0 && h > 0));

          // Medya içerik adreslidir: aynı çıktı aynı referansı verir. Fark yalnızca bildirilir, test düşmez.
          const refs = result.slides.map(s => s.imageData);
          let deterministic = null;
          if (phase === 'first' && run === 0) firstRefs.set(index, refs);
          else if (firstRefs.has(index)) {
            deterministic = JSON.stringify(firstRefs.get(index)) === JSON.stringify(refs);
            if (!deterministic) console.warn(`Warning: source ${index} ${phase} import differs from the first import`);
          }

          const utilityPeakKb = Math.max(0, ...peaks.filter(([key]) => key.startsWith('Utility|')).map(([, kb]) => kb));
          if (maxUtilityKb !== null && utilityPeakKb > 0) {
            assert.ok(utilityPeakKb <= maxUtilityKb, `Utility process peak ${Math.round(utilityPeakKb / 1024)} MiB exceeds limit`);
          }
          report.runs.push({ run, source: index, phase, ms, count: result.slides.length, warnings: result.warnings ?? [], blanks, deterministic, utilityPeakKb, peaks });
          await writeReport();
          console.log(index, phase, result.slides.length, 'slides', ms, 'ms', utilityPeakKb ? `${Math.round(utilityPeakKb / 1024)} MiB peak` : '');

          if (run === 0 && phase === 'first') {
            const deck = { name: 'PPTX isolated round trip', slides: result.slides.map((s, n) => ({ id: String(n), type: 'image', mediaUrl: s.imageData, thumbnailUrl: s.imageData, styles: { objectFit: 'contain' } })) };
            const destination = path.join(output, 'roundtrip.gpres');
            await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ filePath: file, canceled: false }); }, destination);
            await page.evaluate(content => window.electronAPI.saveFile(content), JSON.stringify(deck));
            await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ filePaths: [file], canceled: false }); }, destination);
            const reopened = await page.evaluate(() => window.electronAPI.openFile());
            assert.equal(JSON.parse(reopened.content).slides.length, source.count);
          }
        }
      }

      if (run === 0) {
        // Use the actual toolbar/menu/dialog/handler flow, then ensure warnings survive navigation.
        const file = sources.at(-1).file;
        await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ filePaths: [file], canceled: false }); }, file);
        await page.getByRole('button', { name: 'PowerPoint', exact: true }).click();
        await page.getByRole('menuitem', { name: /Import PowerPoint|PowerPoint Import|Import.*PowerPoint|PowerPoint.*Import/i }).click();
        await expect(page.locator('[data-slide-id]').first()).toBeVisible({ timeout: 90000 });
        const notice = page.getByRole('status').filter({ hasText: 'Imported with warnings' });
        await expect(notice).toBeVisible();
        await page.screenshot({ path: path.join(root, 'warnings-after-navigation.png') });
        await notice.getByRole('button', { name: 'Close', exact: true }).click();
        await expect(notice).toHaveCount(0);
        report.ui.warningAfterNavigation = true;
        const bad = await page.evaluate(() => window.electronAPI.importPptx('does-not-exist.pptx'));
        assert.equal(bad.success, false);
        report.ui.invalidFileRejected = true;
      }
      report.runs.at(-1).processMemory = await app.evaluate(({ app }) => app.getAppMetrics().map(m => ({ type: m.type, serviceName: m.serviceName, memory: m.memory })));
    } finally {
      await stopMemorySampler(app);
      await app.evaluate(({ app }) => setTimeout(() => app.exit(0), 0)).catch(() => {});
      await app.close().catch(() => {});
    }
    await writeReport();
  }

  try {
    for (let run = 0; run < runCount; run++) await checkRun(run);
    for (const source of sources) assert.equal(sha256(await fs.readFile(source.file)), source.hash, `Source modified: ${source.file}`);
    report.ok = true;
    console.log('PPTX integration checks passed:', path.join(root, 'report.json'));
  } catch (error) {
    report.error = String(error?.stack ?? error);
    throw error;
  } finally {
    await writeReport().catch(() => {});
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });