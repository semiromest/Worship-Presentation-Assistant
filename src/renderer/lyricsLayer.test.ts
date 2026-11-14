import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lyricsFontSize, lyricsKey, lyricsText } from './lyricsLayer';
import type { Slide } from './types';

const text = (extra: Partial<Slide> = {}): Slide => ({ id: 's', type: 'text', content: 'Amazing grace\nHow sweet the sound', ...extra } as Slide);

test('text slides show their lines; media and empty slides show nothing', () => {
  assert.equal(lyricsText(text()), 'Amazing grace\nHow sweet the sound');
  assert.equal(lyricsText(text({ content: '   ' })), '');
  for (const type of ['image', 'video', 'countdown', 'screen', 'loop', 'captions'] as const) {
    assert.equal(lyricsText({ id: type, type, content: 'x' } as Slide), '', type);
  }
  assert.equal(lyricsText(undefined), '');
});

test('hymn-part slides show only the active part and change key per part', () => {
  const slide = text({ partsMode: true, parts: ['Verse one', 'Verse two'], activePart: 1 });
  assert.equal(lyricsText(slide), 'Verse two');
  assert.equal(lyricsKey(slide), 's:1');
  assert.notEqual(lyricsKey({ ...slide, activePart: 0 }), lyricsKey(slide));
  assert.equal(lyricsKey(text()), 's');
});

test('designed slides use visible text items only, back to front', () => {
  const slide = text({
    items: [
      { id: 'b', type: 'text', content: 'Back', zIndex: 2, x: 0, y: 0, width: 1, height: 1 },
      { id: 'img', type: 'image', content: '', mediaUrl: 'x.png', zIndex: 1, x: 0, y: 0, width: 1, height: 1 },
      { id: 'a', type: 'text', content: 'Front title', zIndex: 1, x: 0, y: 0, width: 1, height: 1 },
      { id: 'h', type: 'text', content: 'Hidden', visible: false, zIndex: 0, x: 0, y: 0, width: 1, height: 1 },
    ] as unknown as Slide['items'],
  });
  assert.equal(lyricsText(slide), 'Front title\nBack');
});

test('long verses get a smaller font', () => {
  assert.equal(lyricsFontSize('One\nTwo'), 64);
  assert.ok(lyricsFontSize('1\n2\n3\n4\n5\n6') < lyricsFontSize('1\n2'));
  assert.ok(lyricsFontSize('x'.repeat(96)) < 64);
});
