import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { PracticeContext, usePractice } from '../hooks/usePractice';
import { disableStandaloneHelp } from './Tour/tourController';
const PracticeRunner = lazy(() => import('./PracticeRunner'));
export function PracticeFrame({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<string | null>(null);
  const [generation,setGeneration]=useState(0);
  useEffect(() => { let live = true;
    window.electronAPI.getPracticeInfo().then((info: { mode: string }) => { if (live) setMode(info.mode); });
    return () => { live = false; };
  }, []);
  if (mode === null) return null;
  if (mode === 'practice') disableStandaloneHelp();
  return <PracticeContext.Provider value={mode === 'practice'}><div className="h-screen flex flex-col">
    {mode === 'practice' && <div data-testid="practice-banner" className="shrink-0 bg-amber-800 px-4 py-2 font-semibold">{t('practice.banner')}</div>}
    <div className="flex-1 min-h-0"><div key={generation} className="h-full min-h-0 min-w-0">{children}</div>{mode === 'practice' && <Suspense fallback={<p role="status">{t('common.loading')}</p>}><PracticeRunner resetView={()=>setGeneration(value=>value+1)} /></Suspense>}</div>
  </div></PracticeContext.Provider>;
}
export function PracticePanel() {
  const { t } = useTranslation();
  const practice = usePractice();
  const [launchError, setLaunchError] = useState(false);
  return <div className="space-y-2">
    {launchError && <p role="alert">{t('practice.launchError')}</p>}
    {!practice && <button data-testid="practice-open" className="rounded-lg bg-white/10 px-4 py-2 hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500" onClick={async () => {
      try { await window.electronAPI.openPractice(); setLaunchError(false); } catch { setLaunchError(true); }
    }}>{t('guide.open')}</button>}
  </div>;
}
