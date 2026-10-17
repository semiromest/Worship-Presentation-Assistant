import { useEffect } from 'react';
import { shallow } from 'zustand/shallow';
import { IS_PROJECTOR_MODE } from '../constants';
import { loadGoogleFont, slideFonts } from '../fontLoader';
import { runPreparationCheck } from '../preparationCheck';
import { createPreparationMonitor } from '../preparationMonitor';
import { measureSlideReadability } from '../readinessMeasurement';
import { useStore } from '../state/useStore';
import { usePreparationStore } from '../state/usePreparationStore';

export function usePreparationCheck() {
  useEffect(() => {
    if (IS_PROJECTOR_MODE) return;
    const monitor = createPreparationMonitor(
      (slides, cancelled) =>
        runPreparationCheck(
          slides,
          {
            checkMedia: (urls) => window.electronAPI?.checkMediaResources?.(urls) ?? Promise.resolve(undefined),
            fonts: slideFonts,
            loadFont: loadGoogleFont,
            measure: measureSlideReadability,
            yieldToUI: () => new Promise((resolve) => setTimeout(resolve, 0)),
          },
          cancelled
        ),
      (report) => usePreparationStore.setState(report)
    );
    monitor.update(useStore.getState().presentation);
    const unsubscribeDeck = useStore.subscribe(state => state.presentation, deck => monitor.update(deck));
    const unsubscribeOutputs = useStore.subscribe(
      state => ({ displays: state.displays, outputAssignments: state.outputAssignments }),
      (state, prev) => {
        const connected = new Set(state.displays.map((display) => display.id));
        const missing = new Set(usePreparationStore.getState().disconnectedOutputIds);
        for (const [id, output] of Object.entries(prev.outputAssignments)) {
          if (output.isOpen && !connected.has(id)) missing.add(id);
        }
        for (const [id, output] of Object.entries(state.outputAssignments)) {
          if (output.isOpen && !connected.has(id)) missing.add(id);
        }
        for (const id of missing) if (connected.has(id)) missing.delete(id);
        const ids = [...missing];
        if (!shallow(ids, usePreparationStore.getState().disconnectedOutputIds)) {
          usePreparationStore.setState({ disconnectedOutputIds: ids });
        }
      }, { equalityFn: shallow });
    const unsubscribeRetry = usePreparationStore.subscribe((state, prev) => {
      if (state.retry !== prev.retry) monitor.update(useStore.getState().presentation, true);
    });
    return () => {
      unsubscribeDeck();
      unsubscribeOutputs();
      unsubscribeRetry();
      monitor.stop();
    };
  }, []);
}
