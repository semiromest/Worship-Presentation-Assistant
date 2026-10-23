import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import PptxGenJS from 'pptxgenjs';
import sharp from 'sharp';
import { convertPptxToSvg, getWarningEntries, type SlideImage } from 'pptx-glimpse';
import { embeddedFontPayload, renderPptx, sourceSlideCount, validateSlideImages } from './pptxRender';
import { runPptxImportWorker } from './pptxImportWorkerClient';

async function fixture(custom = false, layout = 'LAYOUT_WIDE', imageBytes?: Buffer): Promise<Buffer> {
  const ppt = new PptxGenJS();
  ppt.layout = layout;
  const slide = ppt.addSlide();
  const image = imageBytes ?? await sharp({ create: { width: 64, height: 32, channels: 3, background: '#d52a37' } }).png().toBuffer();
  slide.addImage({ data: 'data:image/png;base64,' + image.toString('base64'), x: 1, y: 1, w: 4, h: 2 });
  if (custom) {
    const zip = new AdmZip(await ppt.write({ outputType: 'nodebuffer' }) as Buffer);
    let xml = zip.readAsText('ppt/slides/slide1.xml');
    const pic = xml.match(/<p:pic>.*?<\/p:pic>/s)![0];
    const fill = pic.match(/<p:blipFill>(.*?)<\/p:blipFill>/s)![1];
    xml = xml.replace(pic, `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Synthetic image fill"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="914400" y="914400"/><a:ext cx="3657600" cy="1828800"/></a:xfrm><a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="l" t="t" r="r" b="b"/><a:pathLst><a:path w="3657600" h="1828800"><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="3000000" y="0"/></a:lnTo><a:cubicBezTo><a:pt x="3657600" y="0"/><a:pt x="3657600" y="500000"/><a:pt x="3657600" y="914400"/></a:cubicBezTo><a:lnTo><a:pt x="3657600" y="1828800"/></a:lnTo><a:lnTo><a:pt x="0" y="1828800"/></a:lnTo><a:close/></a:path></a:pathLst></a:custGeom><a:blipFill>${fill}</a:blipFill></p:spPr></p:sp>`);
    zip.updateFile('ppt/slides/slide1.xml', Buffer.from(xml));
    return zip.toBuffer();
  }
  return await ppt.write({ outputType: 'nodebuffer' }) as Buffer;
}

test('EOT extraction rejects short, compressed, obfuscated and invalid font payloads', () => {
  assert.equal(embeddedFontPayload(Buffer.alloc(20)), null);
  const eot = Buffer.alloc(100);
  eot.writeUInt16LE(0x504c, 34); eot.writeUInt32LE(12, 4); eot.writeUInt32BE(0x00010000, 88);
  assert.equal(embeddedFontPayload(eot)?.length, 12);
  eot.writeUInt32LE(4, 12); assert.equal(embeddedFontPayload(eot), null);
  eot.writeUInt32LE(0x10000000, 12); assert.equal(embeddedFontPayload(eot), null);
  eot.writeUInt32LE(0, 12); eot.writeUInt32BE(0x12345678, 88); assert.equal(embeddedFontPayload(eot), null);
});

test('incomplete, duplicate, invalid and out-of-order conversion results', () => {
  const slide = (n: number): SlideImage => ({ slideNumber: n, width: 1024, height: 576, png: Buffer.from([1]) });
  assert.throws(() => validateSlideImages([slide(1)], 2), /incomplete/);
  assert.throws(() => validateSlideImages([slide(1), slide(1)], 2), /invalid/);
  assert.throws(() => validateSlideImages([{ ...slide(1), height: 0 }], 1), /invalid/);
  const slides = [slide(2), slide(1)]; validateSlideImages(slides, 2);
  assert.deepEqual(slides.map(s => s.slideNumber), [1, 2]);
});

test('custom geometry preserves mixed line/curve order and uses pixel bounds', async () => {
  const input = await fixture(true);
  const slides = await convertPptxToSvg(input, { logLevel: 'off' });
  const geometry = slides[0].svg.match(/<path[^>]+d="([^"]+)"/s)![1];
  assert.match(geometry, /M.*L.*C.*L.*L.*Z/);
  assert.doesNotMatch(slides[0].svg, /transform="scale\(0\.00010/);
  assert.ok(Math.max(...(geometry.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number)) < 1000);
});

test('both normal pictures and large-coordinate bitmap fills retain visible image pixels', async () => {
  for (const custom of [false, true]) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pptx-test-'));
    try {
      const input = await fixture(custom);
      assert.equal(sourceSlideCount(new AdmZip(input)), 1);
      const result = await renderPptx(input, dir);
      assert.equal(result.slides.length, 1);
      const stats = await sharp(result.slides[0].png).stats();
      assert.ok(stats.channels[1].min < 100, 'red picture must not disappear into white');
      assert.ok(!result.warnings.some(w => w.includes('output is blank')));
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  }
});

test('4:3 and 16:9 slides preserve aspect ratio', async () => {
  for (const [layout, height] of [['LAYOUT_4x3', 768], ['LAYOUT_WIDE', 576]] as const) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pptx-ratio-'));
    try {
      const result = await renderPptx(await fixture(false, layout), dir);
      assert.equal(result.slides[0].width, 1024); assert.equal(result.slides[0].height, height);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  }
});

test('font warnings remain readable without mutating console logging', async () => {
  const ppt = new PptxGenJS();
  ppt.addSlide().addText('Missing font test', { x: 1, y: 1, w: 4, h: 1, fontFace: 'PPTX-Test-Font-Not-Installed' });
  await convertPptxToSvg(await ppt.write({ outputType: 'nodebuffer' }) as Buffer, { logLevel: 'off' });
  assert.ok(getWarningEntries().some(w => w.feature === 'font.notFound' && w.message.includes('PPTX-Test-Font-Not-Installed')));
});

test('tracking participates in long-word wrapping rather than overflowing the frame', async () => {
  const lineCounts: number[] = [];
  for (const charSpacing of [0, 8]) {
    const ppt = new PptxGenJS();
    ppt.addSlide().addText('AAAAAAAAAAAAAAAAAAAA', { x: 1, y: 1, w: 1, h: 5, fontFace: 'Arial', fontSize: 20, charSpacing, margin: 0 });
    const [rendered] = await convertPptxToSvg(await ppt.write({ outputType: 'nodebuffer' }) as Buffer, { logLevel: 'off' });
    // Each line becomes one glyph-path segment. Tracking must create more lines.
    lineCounts.push((rendered.svg.match(/<path d=/g) ?? []).length);
  }
  assert.ok(lineCounts[1] > lineCounts[0], `tracked word must wrap earlier (${lineCounts})`);
});

test('upright CJK tracking changes advances without moving the first rotation center', async () => {
  const centers: number[][][] = [];
  for (const charSpacing of [0, 8]) {
    const ppt = new PptxGenJS();
    ppt.addSlide().addText('日本語', { x: 1, y: 1, w: 4, h: 4, vert: 'eaVert', fontFace: 'Yu Gothic', fontSize: 20, charSpacing, margin: 0 });
    const [rendered] = await convertPptxToSvg(await ppt.write({ outputType: 'nodebuffer' }) as Buffer, { logLevel: 'off' });
    centers.push([...rendered.svg.matchAll(/rotate\(-90, ([\d.-]+), ([\d.-]+)\)/g)].map(m => [Number(m[1]), Number(m[2])]));
  }
  assert.equal(centers[0].length, 3);
  assert.deepEqual(centers[1][0], centers[0][0]);
  assert.ok(centers[1][1][0] > centers[0][1][0], 'subsequent upright glyphs receive tracking');
});

test('bitmap-fill source cropping is retained', async () => {
  const pixels = Buffer.alloc(64 * 32 * 3);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) pixels[(y * 64 + x) * 3 + (x < 32 ? 0 : 2)] = 255;
  const image = await sharp(pixels, { raw: { width: 64, height: 32, channels: 3 } }).png().toBuffer();
  const zip = new AdmZip(await fixture(true, 'LAYOUT_WIDE', image));
  zip.updateFile('ppt/slides/slide1.xml', Buffer.from(zip.readAsText('ppt/slides/slide1.xml').replace('</a:blipFill>', '<a:srcRect l="50000" t="0" r="0" b="0"/></a:blipFill>')));
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pptx-crop-'));
  try {
    const { slides } = await renderPptx(zip.toBuffer(), dir);
    const sample = await sharp(slides[0].png).extract({ left: 230, top: 153, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
    assert.ok(sample[2] > 200 && sample[0] < 50, 'cropped image must show its blue half');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('bitmap fills retain group offsets and scaling', async () => {
  const zip = new AdmZip(await fixture(true));
  let xml = zip.readAsText('ppt/slides/slide1.xml');
  const shape = xml.match(/<p:sp>.*?<\/p:sp>/s)![0];
  const child = shape.replace('<a:off x="914400" y="914400"/>', '<a:off x="0" y="0"/>');
  xml = xml.replace(shape, `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="8" name="Scaled fixture"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="1828800" y="914400"/><a:ext cx="5486400" cy="2743200"/><a:chOff x="0" y="0"/><a:chExt cx="3657600" cy="1828800"/></a:xfrm></p:grpSpPr>${child}</p:grpSp>`);
  zip.updateFile('ppt/slides/slide1.xml', Buffer.from(xml));
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pptx-group-'));
  try {
    const { slides } = await renderPptx(zip.toBuffer(), dir);
    const inside = await sharp(slides[0].png).extract({ left: 300, top: 200, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
    const outside = await sharp(slides[0].png).extract({ left: 100, top: 100, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
    assert.ok(inside[0] > 150 && inside[1] < 100);
    assert.ok(outside.every(c => c === 255));
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('intentionally blank slide is retained and flagged for review', async () => {
  const ppt = new PptxGenJS(); ppt.addSlide();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pptx-blank-'));
  try {
    const result = await renderPptx(await ppt.write({ outputType: 'nodebuffer' }) as Buffer, dir);
    assert.equal(result.slides.length, 1);
    assert.ok(result.warnings.some(w => w.includes('output is blank')));
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('a CPU-bound renderer is terminated and its temporary resources are removed on timeout', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pptx-timeout-test-'));
  try {
    const workerFile = path.join(dir, 'busy.cjs');
    const marker = path.join(dir, 'temp-location.txt');
    await fs.writeFile(workerFile, `const fs=require('fs');const {workerData}=require('worker_threads');fs.writeFileSync(${JSON.stringify(marker)},workerData.tempDir);while(true){}`);
    const started = Date.now();
    await assert.rejects(runPptxImportWorker(Buffer.from('test'), 1000, workerFile), /timed out/);
    assert.ok(Date.now() - started < 5000, 'timeout must stop synchronous CPU work');
    const tempDir = await fs.readFile(marker, 'utf8');
    await assert.rejects(fs.access(tempDir), /ENOENT/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
