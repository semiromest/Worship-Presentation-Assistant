import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { GradientButton } from '../../src/renderer/components/GradientGenerator';
import { LivePreview } from '../../src/renderer/LivePreview';
import { applyGeneratedBackground, generatedStyles } from '../../src/renderer/gradientBackground';
import { useEditorDeck } from '../../src/renderer/editor/useEditorDeck';
import { useStore } from '../../src/renderer/state/useStore';
import i18n from '../../src/renderer/i18n';
import type { Presentation } from '../../src/renderer/types';
import { undoReducer } from '../../src/renderer/state/undoReducer';

export function mount(deck: Presentation, advanced = false) {
  void i18n.changeLanguage('en');
  document.body.innerHTML = '<div id="gradient-harness"></div>';
  document.body.style.background = '#111827';
  useStore.setState({ presentation: deck, undoState: { past: [], present: deck, future: [] }, selectedSlideId: 'a' });
  function Harness() {
    const [history, setHistory] = useState({ past: [] as any[], present: deck, future: [] as any[] });
    const editor = useEditorDeck({ deck, initialSlide: deck.slides[0], editableOnly: false });
    const current = advanced ? (editor.buildSavePayload() ?? deck) : history.present;
    useEffect(() => {
      (window as any).gradientHarness = {
        read: () => current,
        undo: () => (advanced ? editor.undo() : setHistory((h) => undoReducer(h, { type: 'UNDO' }))),
        past: advanced ? Number(editor.canUndo) : history.past.length,
      };
    });
    return (
      <div style={{ width: 1000, padding: 20, color: 'white' }}>
        <h1>Gradient integration</h1>
        <GradientButton
          slides={current.slides}
          activeId="a"
          selectedIds={['a', 'b']}
          onApply={(ids, image, recipe, group) =>
            advanced
              ? editor.applyBackground(generatedStyles(image, recipe, group), ids)
              : setHistory((h) =>
                  undoReducer(h, {
                    type: 'SET',
                    payload: applyGeneratedBackground(h.present, ids, image, recipe, group),
                  })
                )
          }
        />
        <div data-testid="regression-item-background" style={{ width: 640, height: 360 }}>
          <LivePreview slide={current.slides[2]} muted isActive={false} />
        </div>
      </div>
    );
  }
  createRoot(document.getElementById('gradient-harness')!).render(<Harness />);
}
