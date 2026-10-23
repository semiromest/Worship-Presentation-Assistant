import { test } from 'node:test';
import { canAttachSlideMusic, slideMusicAutoPlay } from '../shared/youtubeMusic';
import assert from 'node:assert/strict';
import { activeMusicSlide, musicPreparationIds } from './musicSlides';
import { computePatch, applyProjectorPatch } from './state/undoReducer';
import { isYouTubeMusicResult } from '../shared/youtubeMusic';
import { backgroundDim, musicGain, musicPresetStyles } from './musicCustomization';

function fixture(): Parameters<typeof activeMusicSlide>[0] {
  return {
    displays: [{ id: 'tv', label: 'TV', isPrimary: true, scaleFactor: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1080 } }],
    outputAssignments: { tv: { mode: 'follow', isOpen: false, isBlackout: false, slideIndex: 0 } },
    isProjectorWindowOpen: false,
    liveIndex: 0,
    presentation: { name: 'Test', slides: [
      { id: 'normal', type: 'text', content: 'Hello' },
      { id: 'music', type: 'text', content: 'Song', youtubeMusic: { id: 'KI33ItOO_M4', title: 'Song', duration: 60 } },
    ] },
  };
}

test('preparation skips repeated live sources to find the next distinct track', () => {
  const slides = fixture().presentation.slides;
  slides.push({ ...slides[1], id: 'same-source' }, {
    ...slides[1], id: 'next-source', youtubeMusic: { id: 'SIfMHRHdTAI', title: 'Next', duration: 60 },
  });
  assert.deepEqual(musicPreparationIds(slides, 'same-source', 1, 'KI33ItOO_M4'), ['SIfMHRHdTAI']);
  assert.deepEqual(musicPreparationIds(slides, 'music', 0), ['KI33ItOO_M4']);
});

test('music requires a real audience output and the live slide, not selection', () => {
  const state = fixture();
  assert.equal(activeMusicSlide(state), null);
  state.liveIndex = 1;
  assert.equal(activeMusicSlide(state), null);
  state.outputAssignments.tv.isOpen = true;
  assert.equal(activeMusicSlide(state)?.id, 'music');
  state.liveIndex = 0;
  assert.equal(activeMusicSlide(state), null);
  state.outputAssignments.tv = { ...state.outputAssignments.tv, mode: 'manual', slideIndex: 1 };
  assert.equal(activeMusicSlide(state)?.id, 'music');
  state.outputAssignments.tv.mode = 'stage';
  assert.equal(activeMusicSlide(state), null);
});

test('one audience output owns audio; blackout retains audio and invalid references cannot play', () => {
  const state = fixture();
  state.outputAssignments.tv.isOpen = true;
  state.outputAssignments.other = { mode: 'manual', isOpen: true, slideIndex: 1, isBlackout: false };
  assert.equal(activeMusicSlide(state), null);
  state.liveIndex = 1;
  state.outputAssignments.tv.isBlackout = true;
  assert.equal(activeMusicSlide(state)?.id, 'music');
  state.presentation.slides[1].youtubeMusic!.id = 'invalid';
  assert.equal(activeMusicSlide(state), null);
  assert.equal(isYouTubeMusicResult({ id: 'KI33ItOO_M4', title: 'Song', duration: Infinity }), false);
});

test('music reference survives save/load and a metadata-only projector delta', () => {
  const previous = fixture().presentation;
  const next = JSON.parse(JSON.stringify(previous));
  next.slides[1].youtubeMusic.id = 'SIfMHRHdTAI';
  const patch = computePatch(previous, next);
  assert.equal(patch.slidesPatch.length, 1);
  const actual = applyProjectorPatch(previous, { slidesPatch: patch.slidesPatch.map(({ id, nextSlide }) => ({ id, nextSlide })) });
  assert.deepEqual(actual.slides[1].youtubeMusic, next.slides[1].youtubeMusic);
});

test('gain-only changes survive projector deltas and JSON persistence', () => {
  const previous = fixture().presentation;
  const next = structuredClone(previous);
  next.slides[1].musicSettings = { volume: 0.35 };
  const patch = computePatch(previous, next);
  assert.equal(patch.slidesPatch.length, 1);
  const actual = applyProjectorPatch(previous, { slidesPatch: patch.slidesPatch.map(({ id, nextSlide }) => ({ id, nextSlide })) });
  assert.equal(JSON.parse(JSON.stringify(actual)).slides[1].musicSettings.volume, 0.35);
  assert.equal(previous.slides[1].musicSettings, undefined);
});

test('presets retain typography and clamp optional legacy settings safely', () => {
  const styles = { fontSize: 90, textColor: '#abc', backgroundColor: '#000', backgroundVideo: 'old.mp4', backgroundImage: 'old.png' };
  const photo = musicPresetStyles(styles, 'new.png');
  assert.equal(photo.fontSize, 90);
  assert.equal(photo.textColor, '#abc');
  assert.equal(photo.backgroundVideo, undefined);
  assert.equal(photo.backgroundImage, 'new.png');
  assert.equal(photo.backgroundDim, 0.45);
  assert.equal(musicPresetStyles(photo).backgroundImage, undefined);
  assert.equal(styles.backgroundImage, 'old.png');
  assert.equal(backgroundDim(undefined), 0);
  assert.equal(backgroundDim(1), 0.8);
  assert.equal(musicGain(undefined), 1);
  assert.equal(musicGain(-1), 0);
});

test('attachments support visual slides but exclude all hymn variants, video and screen sources', () => {
  const base = fixture().presentation.slides[0];
  for (const type of ['text', 'image', 'countdown', 'captions', 'loop'] as const)
    assert.equal(canAttachSlideMusic({ ...base, type }), true);
  assert.equal(canAttachSlideMusic({ ...base, group: { id: 'bible', title: 'Genesis', part: 1, parts: 2 } }), true);
  for (const slide of [
    { ...base, type: 'video' as const }, { ...base, type: 'screen' as const },
    { ...base, partsMode: true }, { ...base, parts: ['a', 'b'] },
    { ...base, group: { id: 'h', title: 'Hymn', part: 1, parts: 1, kind: 'hymn' as const } },
    { ...base, group: { id: 'h', title: 'Hymn', part: 1, parts: 1, color: '#abc' } },
    { ...base, styles: { fontSize: 48, textColor: '#fff', backgroundColor: '#000', backgroundVideo: 'video.mp4' } },
    { ...base, type: 'loop' as const, loopItems: [{ id: 'v', type: 'video' as const, mediaUrl: 'v.mp4', duration: 10 }] },
  ]) {
    assert.equal(canAttachSlideMusic(slide), false);
    const state = fixture();state.outputAssignments.tv.isOpen = true;state.presentation.slides[0] = { ...slide, youtubeMusic: state.presentation.slides[1].youtubeMusic };
    assert.equal(activeMusicSlide(state), null);
  }
});

test('autoplay is opt-in for attachments, preserves legacy music, and persists through deltas', () => {
  const slide = fixture().presentation.slides[1];
  assert.equal(slideMusicAutoPlay(slide), true);
  assert.equal(slideMusicAutoPlay({ ...slide, musicSettings: { attachment: true } }), false);
  for (const autoPlay of [true, false]) {
    const previous = fixture().presentation;
    const next = structuredClone(previous);next.slides[1].musicSettings = { attachment: true, autoPlay, volume: 0.4 };
    assert.equal(slideMusicAutoPlay(next.slides[1]), autoPlay);
    const patch = computePatch(previous, next);
    const actual = applyProjectorPatch(previous, { slidesPatch: patch.slidesPatch.map(({ id, nextSlide }) => ({ id, nextSlide })) });
    assert.deepEqual(JSON.parse(JSON.stringify(actual)).slides[1].musicSettings, { attachment: true, autoPlay, volume: 0.4 });
  }
});
