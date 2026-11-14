import { test } from 'node:test';
import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';
import PptxGenJS from 'pptxgenjs';
import sharp from 'sharp';
import { analyzeMediaNeeds, shrinkSlideMedia } from './pptxMedia';

/** 13.333in-wide slide with one 4in × 2in picture of a 3000 × 1500 photo. */
async function deck(edit?: (slideXml: string) => string): Promise<AdmZip> {
  const ppt = new PptxGenJS();
  ppt.layout = 'LAYOUT_WIDE';
  const photo = await sharp({ create: { width: 3000, height: 1500, channels: 3, background: '#3a7' } }).jpeg().toBuffer();
  ppt.addSlide().addImage({ data: 'data:image/jpeg;base64,' + photo.toString('base64'), x: 1, y: 1, w: 4, h: 2 });
  const zip = new AdmZip(await ppt.write({ outputType: 'nodebuffer' }) as Buffer);
  if (edit) zip.updateFile('ppt/slides/slide1.xml', Buffer.from(edit(zip.readAsText('ppt/slides/slide1.xml'))));
  return zip;
}

const mediaName = (zip: AdmZip) => zip.getEntries().map(e => e.entryName).find(n => /^ppt\/media\/.+\.jpe?g$/.test(n))!;

test('displayed size is measured from the frame and grows with cropping', async () => {
  const zip = await deck();
  const need = analyzeMediaNeeds(zip, 1024).get(mediaName(zip));
  assert.ok(need);
  assert.ok(Math.abs(need.needW - (4 / 13.333) * 1024) < 1);
  assert.ok(Math.abs(need.needH - (2 / 13.333) * 1024) < 1);

  const cropped = await deck(xml => xml.replace(/(<a:blip\b[^>]*?(?:\/>|>[\s\S]*?<\/a:blip>))/, '$1<a:srcRect l="25000" r="25000"/>'));
  const croppedNeed = analyzeMediaNeeds(cropped, 1024).get(mediaName(cropped));
  assert.ok(croppedNeed && Math.abs(croppedNeed.needW - 2 * need.needW) < 1);
});

test('pictures inside groups, tiles or unmeasurable frames are never shrunk', async () => {
  const grouped = await deck(xml => xml.replace(/<p:pic>[\s\S]*<\/p:pic>/, m => `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="9" name="g"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${m}</p:grpSp>`));
  assert.equal(analyzeMediaNeeds(grouped, 1024).get(mediaName(grouped)), null);
  const tiled = await deck(xml => xml.replace(/<a:stretch>[\s\S]*?<\/a:stretch>/, '<a:tile/>'));
  assert.equal(analyzeMediaNeeds(tiled, 1024).get(mediaName(tiled)), null);
  const noFrame = await deck(xml => xml.replace(/<p:pic>[\s\S]*<\/p:pic>/, pic => pic.replace(/<a:xfrm[\s\S]*?<\/a:xfrm>/, '')));
  assert.equal(analyzeMediaNeeds(noFrame, 1024).get(mediaName(noFrame)), null);
  assert.equal(await shrinkSlideMedia(grouped, 1024), 0);
});

test('oversized photos are downscaled to the needed resolution with headroom', async () => {
  const zip = await deck();
  assert.equal(await shrinkSlideMedia(zip, 1024), 1);
  const meta = await sharp(zip.getEntry(mediaName(zip))!.getData()).metadata();
  const expected = Math.round(3000 * ((4 / 13.333) * 1024 * 1.5) / 3000);
  assert.ok(Math.abs(meta.width! - expected) <= 2, `width ${meta.width} vs ${expected}`);
  assert.equal(meta.format, 'jpeg');
  // Already small enough: a second pass changes nothing.
  assert.equal(await shrinkSlideMedia(zip, 1024), 0);
});
