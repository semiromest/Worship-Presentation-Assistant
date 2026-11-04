import './bridge';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { demoMessage, demoMedia, noop } from './bridge';
import { language, sampleBible, sampleDeck, tr } from './samples';
import '../src/renderer/index.css';
import '../src/renderer/slides-workspace.css';
import './sandbox.css';
import UiMotionProvider from '../src/renderer/components/UiMotionProvider';
import { useStore } from '../src/renderer/state/useStore';
import { bibleRepository } from '../src/renderer/bibleRepository';
import type { UndoAction } from '../src/renderer/state/undoReducer';
import i18n from '../src/renderer/i18n';

await i18n.changeLanguage(language);
bibleRepository.remember(sampleBible, { type: 'local', id: 'browser-demo-bible', format: 'zefania', description: sampleBible.name });
const original = useStore.getState();
const dispatch = original.dispatchUndo;
const availableTabs = new Set(['slides', 'bible', 'hymns', 'media', 'editor', 'settings']);
const allowedDeck = (action: UndoAction) => {
  if (action.type !== 'SET' && action.type !== 'RESET') return true;
  return action.payload.slides.every(slide => ['text', 'image', 'video'].includes(slide.type) && !slide.youtubeMusic);
};
useStore.setState({
  dispatchUndo: action => { if (allowedDeck(action)) dispatch(action); },
  // Creation commands set the active ID alone; keep the browser demo's edit targets in sync.
  setSelectedSlideId: id => original.selectSlides({ activeId: id, ids: new Set([id]), anchorIndex: useStore.getState().presentation.slides.findIndex(slide => slide.id === id) }),
  setActiveTab: tab => { if (availableTabs.has(tab)) original.setActiveTab(tab); },
  setIsRemoteOpen: noop, setIsLiveShareOpen: noop, setIsSttPanelOpen: noop, setIsPrepCheckOpen: noop,
  liveSaveEnabled: false, uiSfxEnabled: false,
  mediaItems: [demoMedia], activeTab: 'slides',
});
useStore.getState().dispatchUndo({ type: 'RESET', payload: sampleDeck });
useStore.getState().selectSlides({ activeId: sampleDeck.slides[0].id, ids: new Set([sampleDeck.slides[0].id]), anchorIndex: 0 });

const App = (await import('../src/renderer/App')).default;
const desktopActions = ['common.hymnsOnline', 'common.hymnsImport', 'common.setImportTitle', 'common.startBroadcast', 'common.stopBroadcast', 'common.remoteControl', 'common.liveShareButton', 'common.sttPanelTitle', 'prepCheck.title', 'gradientLibrary.openEditor', 'gradient.regenerate'];
function BrowserDemo() {
  return <UiMotionProvider><div className="browser-demo-root">
    <div className="browser-demo-banner"><span>{demoMessage}</span><div><a href="../">{tr ? 'Tanıtım sitesi' : 'Website'}</a><a href="https://github.com/semiromest/Worship-Presentation-Assistant/releases/latest">{tr ? 'Uygulamayı indir' : 'Download app'} ↗</a></div></div>
    <div className="browser-demo-app" onClickCapture={event => {
      const node = event.target instanceof Element ? event.target : null;
      const control = node?.closest('button,[role="menuitem"]');
      const label = control?.getAttribute('aria-label') ?? control?.textContent?.trim();
      if (node?.closest('[data-guide-anchor="nav-screen"], [data-guide-anchor="nav-presentations"], [data-guide-anchor="nav-countdown"], [data-guide-anchor="nav-calendar"], [data-testid="background-music-toggle"], [data-testid="slide-music-attachment"], [data-testid="gradient-designer"], [data-saved-output]') || (label && desktopActions.some(key => i18n.t(key) === label))) {
        event.preventDefault(); event.stopPropagation();
      }
    }}><App /></div>
  </div></UiMotionProvider>;
}
ReactDOM.createRoot(document.getElementById('root')!).render(<BrowserDemo />);
