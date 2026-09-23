import { useTranslation } from 'react-i18next';
import { useStore } from '../state/useStore';

export default function OutputStatus() {
  const { t } = useTranslation();
  const open = useStore(s => s.isProjectorWindowOpen);
  const assignments = useStore(s => s.outputAssignments);
  const blackout = useStore(s => s.isBlackout);
  const sessionError = useStore(s => s.sessionSaveStatus === 'error');
  const enabled = useStore(s => s.liveSaveEnabled);
  const stage = Object.values(assignments).some(a => a.isOpen && a.mode === 'stage');
  const live = open || Object.values(assignments).some(a => a.isOpen && a.mode !== 'stage');
  const black = blackout || Object.values(assignments).some(a => a.isOpen && a.isBlackout);
  return <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-6 py-1 bg-surface-raised border-b border-white/10 text-[10px] text-white/55" role="status">
    {([['presentation', live], ['stage', stage], ['blackout', black]] as const).map(([key, active]) =>
      <span key={key} className="inline-flex items-center gap-1.5"><span aria-hidden="true" className={`w-1.5 h-1.5 rounded-full ${active ? key === 'blackout' ? 'bg-amber-400' : 'bg-emerald-400' : 'bg-white/25'}`} />
        {t(`outputStatus.${key}`)}: {t(active ? 'outputStatus.on' : 'outputStatus.off')}
      </span>)}
    {!enabled && <span>{t('outputStatus.saveOff')}</span>}
    {enabled && sessionError && <span className="text-red-300">{t('outputStatus.sessionError')}</span>}
  </div>;
}
