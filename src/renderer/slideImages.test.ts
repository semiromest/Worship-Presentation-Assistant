import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectSlideImages, translatedPhoneImages, withReplacedImages } from './slideImages';
import type { Slide, SlideItem } from './types';

const slide = (extra: Partial<Slide>): Slide => ({ id: 's', type: 'text', content: '', ...extra } as Slide);

test('collectSlideImages finds image slides, backgrounds and visible image items, largest first', () => {
  const images = collectSlideImages(slide({
    styles: { backgroundImage: 'local-resource://media/bg.jpg' } as Slide['styles'],
    items: [
      { id: 'a', type: 'image', mediaUrl: 'file:///C:/pics/small.png', x: 0, y: 0, width: 20, height: 20, zIndex: 1, styles: {} as SlideItem['styles'] },
      { id: 'b', type: 'image', mediaUrl: 'https://example.com/remote.png', x: 0, y: 0, width: 50, height: 50, zIndex: 2, styles: {} as SlideItem['styles'] },
      { id: 'c', type: 'image', mediaUrl: 'file:///C:/pics/hidden.png', x: 0, y: 0, width: 50, height: 50, zIndex: 3, visible: false, styles: {} as SlideItem['styles'] },
      { id: 'd', type: 'text', content: 'x', x: 0, y: 0, width: 50, height: 50, zIndex: 4, styles: {} as SlideItem['styles'] },
    ],
  }));
  assert.deepEqual(images.map((i) => i.url), ['local-resource://media/bg.jpg', 'file:///C:/pics/small.png']);
  assert.deepEqual(collectSlideImages(slide({ type: 'image', mediaUrl: 'local-resource://media/p.png' })).map((i) => i.url), ['local-resource://media/p.png']);
  assert.deepEqual(collectSlideImages(null), []);
});

test('withReplacedImages swaps only the translated pictures', () => {
  const source = slide({
    styles: { backgroundImage: 'local-resource://media/bg.jpg' } as Slide['styles'],
    items: [
      { id: 'a', type: 'image', mediaUrl: 'file:///C:/pics/a.png', x: 0, y: 0, width: 20, height: 20, zIndex: 1, styles: {} as SlideItem['styles'] },
      { id: 'b', type: 'image', mediaUrl: 'file:///C:/pics/b.png', x: 0, y: 0, width: 20, height: 20, zIndex: 2, styles: {} as SlideItem['styles'] },
    ],
  });
  const out = withReplacedImages(source, new Map([['file:///C:/pics/a.png', 'local-resource://media/a-tr.jpg']]));
  assert.equal(out.items![0].mediaUrl, 'local-resource://media/a-tr.jpg');
  assert.equal(out.items![1].mediaUrl, 'file:///C:/pics/b.png');
  assert.equal(out.styles!.backgroundImage, 'local-resource://media/bg.jpg');
  assert.equal(source.items![0].mediaUrl, 'file:///C:/pics/a.png', 'input untouched');
});

test('phones get only pictures that have a translated copy, in slide order', () => {
  const found = new Map<string, Record<string, string>>([['b', { tr: 'b-tr' }], ['a', {}]]);
  assert.deepEqual(translatedPhoneImages(['a', 'b', 'c'], found), [{ original: 'b', translations: { tr: 'b-tr' } }]);
  assert.deepEqual(translatedPhoneImages(['a'], new Map()), []);
});
