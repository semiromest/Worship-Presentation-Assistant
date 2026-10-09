import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SlideItem } from './types';
import { slidePreviewGeometry } from './slidePreviewGeometry';
import { SlideTextItem as TextItem } from './components/SlideTextItem';

test('thumbnail pixels and text shrink by the same ratio as the complete slide', () => {
  for (const width of [108, 320, 640, 1920]) {
    const viewport = slidePreviewGeometry(width, (width * 9) / 16);
    assert.equal(viewport.scale, width / 1920);
    assert.equal(viewport.left, 0);
    assert.equal(viewport.top, 0);
    // A 64px caption remains the same fraction of the slide at every preview size.
    assert.equal((64 * viewport.scale) / width, 64 / 1920);
    assert.equal((8 * viewport.scale) / width, 8 / 1920);
  }
});

test('mismatched preview proportions fit and center the entire slide', () => {
  assert.deepEqual(slidePreviewGeometry(320, 240), { scale: 1 / 6, left: 0, top: 30 });
  assert.deepEqual(slidePreviewGeometry(400, 180), { scale: 1 / 6, left: 40, top: 0 });
});

test('hidden or invalid preview bounds cannot produce invalid transforms', () => {
  for (const [width, height] of [
    [0, 0],
    [108, 0],
    [-1, 100],
    [NaN, 100],
    [100, Infinity],
  ]) {
    assert.deepEqual(slidePreviewGeometry(width, height), { scale: 0, left: 0, top: 0 });
  }
});

test('caption paint belongs to its text line, with full reference typography and padding', () => {
  const item: SlideItem = {
    id: 'caption',
    type: 'text',
    content: 'Dikmen, Hürriyet Cd.',
    x: 2,
    y: 78,
    width: 56,
    height: 15,
    zIndex: 1,
    styles: {},
    textStyles: {
      textDecoration: 'none',
      fontSize: 64,
      backgroundColor: '#94719e',
      verticalAlign: 'bottom',
      letterSpacing: 2,
      textStroke: { width: 2, color: '#000' },
      textShadow: { offsetX: 3, offsetY: 4, blur: 5 },
    },
  };
  const html = renderToStaticMarkup(createElement(TextItem, { item }));
  const container = html.slice(0, html.indexOf('<span'));
  assert.ok(!container.includes('background-color'), 'the whole textbox must not become a colored banner');
  assert.match(container, /padding:8px/);
  assert.match(container, /align-items:flex-end/);
  assert.match(html, /font-size:64px/);
  assert.match(html, /<span[^>]*background-color:#94719e/);
  assert.match(html, /letter-spacing:2px/);
  assert.match(html, /text-shadow:#000 3px 4px 5px/);
  assert.match(html, /-webkit-text-stroke:2px #000/);
  assert.match(html, /Dikmen, Hürriyet Cd\./);
});
