import { useTranslation } from 'react-i18next';
import {
  Undo2, Redo2, ChevronUp, ChevronDown, Copy, Trash2, HelpCircle, Monitor, Play, Smartphone, PanelRightClose, PanelRightOpen, Captions
} from 'lucide-react';
import { useStore } from '../state/useStore';
import { cn } from '../utils';
import DisplayOutputsPopover from './DisplayOutputsPopover';
import { useState, useRef, useCallback } from 'react';

interface ToolbarProps {
  moveSelectedSlides: (direction: -1 | 1) => void;
  deleteSelectedSlides: () => void;
  duplicateSelectedSlides: () => void;
  openLive: () => Promise<void>;
  closeLive: () => Promise<void>;
  openOutput: (displayId: string) => Promise<void>;
  closeOutput: (displayId: string) => Promise<void>;
}

export default function Toolbar({
  moveSelectedSlides,
  deleteSelectedSlides,
  duplicateSelectedSlides,
  openLive,
  closeLive,
  openOutput,
  closeOutput,
}: ToolbarProps) {
  const { t } = useTranslation();

  const presentation = useStore((s) => s.presentation);
  const undoState = useStore((s) => s.undoState);
  const dispatchUndo = useStore((s) => s.dispatchUndo);
  const selectedSlideIds = useStore((s) => s.selectedSlideIds);
  const setIsCheatsheetOpen = useStore((s) => s.setIsCheatsheetOpen);
  const isProjectorWindowOpen = useStore((s) => s.isProjectorWindowOpen);
  const setPresentationName = useStore((s) => s.setPresentationName);
  const isRightPanelOpen = useStore((s) => s.isRightPanelOpen);
  const setIsRightPanelOpen = useStore((s) => s.setIsRightPanelOpen);
  const setIsRemoteOpen = useStore((s) => s.setIsRemoteOpen);
  const isSttPanelOpen = useStore((s) => s.isSttPanelOpen);
  const setIsSttPanelOpen = useStore((s) => s.setIsSttPanelOpen);
  const activeTab = useStore((s) => s.activeTab);
  const setActiveTab = useStore((s) => s.setActiveTab);

  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const startEditing = useCallback(() => {
    setDraftName(presentation.name);
    setEditingName(true);
    requestAnimationFrame(() => inputRef.current?.select());
  }, [presentation.name]);

  const commitName = useCallback(() => {
    const trimmed = draftName.trim();
    if (trimmed && trimmed !== presentation.name) {
      setPresentationName(trimmed);
    }
    setEditingName(false);
  }, [draftName, presentation.name, setPresentationName]);

  const cancelEditing = useCallback(() => {
    setEditingName(false);
  }, []);

  const startLive = async () => {
    if (isProjectorWindowOpen) {
      await closeLive();
    } else {
      await openLive();
    }
  };

  return (
    <header className="h-14 bg-surface-raised border-b border-white/10 flex items-center justify-between px-6 flex-shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        {editingName ? (
          <input
            ref={inputRef}
            type="text"
            value={draftName}
            onChange={e => setDraftName(e.target.value)}
            onBlur={commitName}
            onKeyDown={e => {
              if (e.key === 'Enter') commitName();
              if (e.key === 'Escape') cancelEditing();
            }}
            aria-label={t('common.presetName')}
            className="font-semibold text-blue-400 bg-transparent border-b border-blue-400/50 outline-none max-w-[300px]"
          />
        ) : (
          <button
            onClick={startEditing}
            className="group flex items-center gap-1.5 font-semibold text-blue-400 truncate max-w-[300px] hover:text-blue-300 transition-colors text-left cursor-pointer focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none rounded px-2 py-0.5 -ml-2 hover:bg-white/5 active:scale-[0.98]"
            title={t('common.clickToRename')}
            aria-label={t('common.clickToRename')}
          >
            <span className="truncate">{presentation.name}</span>
            <svg className="w-3.5 h-3.5 text-white/20 group-hover:text-white/40 transition-colors shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
            </svg>
            </button>
          )}
      </div>        <div className="flex items-center gap-2">
        <div className="w-px h-6 bg-white/10 mx-1" />

        {/* Live Captions (STT) Panel */}
        <button
          onClick={() => {
            const next = !isSttPanelOpen;
            setIsSttPanelOpen(next);
            if (next && activeTab !== 'slides') setActiveTab('slides');
          }}
          aria-pressed={isSttPanelOpen}
          title={t('common.sttPanelTitle')}
          aria-label={t('common.sttPanelTitle')}
          className={cn(
            'p-2.5 rounded-md border transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none active:scale-[0.92]',
            isSttPanelOpen
              ? 'bg-blue-600/20 hover:bg-blue-600/30 border-blue-500/40 text-blue-300'
              : 'bg-white/5 hover:bg-white/10 border-white/10 text-white/60 hover:text-white'
          )}
        >
          <Captions className="w-4 h-4" aria-hidden="true" />
        </button>

        {/* Multi-display output selector — hidden automatically on one-display machines. */}
        <DisplayOutputsPopover openOutput={openOutput} closeOutput={closeOutput} />

        {/* Remote Panel */}
        <div className="relative shrink-0">
          <button
            onClick={() => setIsRemoteOpen(true)}
            aria-haspopup="dialog"
            className="flex items-center justify-center w-[150px] py-1.5 rounded-md transition-colors text-sm font-medium focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none active:scale-[0.97] bg-white/5 hover:bg-white/10 text-white"
          >
            <Smartphone className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{t('common.remoteControl')}</span>
          </button>
        </div>

        <div className="w-px h-6 bg-white/10 mx-1" />

        <button
          onClick={() => dispatchUndo({ type: 'UNDO' })}
          disabled={undoState.past.length === 0}
          title={t('common.undo')}
          aria-label={t('common.undo')}
          className="p-2.5 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 disabled:opacity-30 disabled:hover:bg-white/5 transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none active:scale-[0.92] disabled:active:scale-100"
        >
          <Undo2 className="w-4 h-4" aria-hidden="true" />
        </button>
        <button
          onClick={() => dispatchUndo({ type: 'REDO' })}
          disabled={undoState.future.length === 0}
          title={t('common.redo')}
          aria-label={t('common.redo')}
          className="p-2.5 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 disabled:opacity-30 disabled:hover:bg-white/5 transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none active:scale-[0.92] disabled:active:scale-100"
        >
          <Redo2 className="w-4 h-4" aria-hidden="true" />
        </button>

        {selectedSlideIds.size > 1 && (
          <>
            <div className="w-px h-6 bg-white/10 mx-1" aria-hidden="true" />
            <span className="text-xs text-white/55 font-medium" aria-live="polite">
              {selectedSlideIds.size} {t('common.selected')}
            </span>
            <button
              onClick={() => moveSelectedSlides(-1)}
              title={t('common.moveSelectedUp')}
              aria-label={t('common.moveSelectedUp')}
              className="p-2.5 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none active:scale-[0.92]"
            >
              <ChevronUp className="w-4 h-4" aria-hidden="true" />
            </button>
            <button
              onClick={() => moveSelectedSlides(1)}
              title={t('common.moveSelectedDown')}
              aria-label={t('common.moveSelectedDown')}
              className="p-2.5 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none active:scale-[0.92]"
            >
              <ChevronDown className="w-4 h-4" aria-hidden="true" />
            </button>
            <button
              onClick={duplicateSelectedSlides}
              title={`${t('common.duplicateSelected')} (Ctrl+D)`}
              aria-label={t('common.duplicateSelected')}
              className="p-2.5 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none active:scale-[0.92]"
            >
              <Copy className="w-4 h-4" aria-hidden="true" />
            </button>
            <button
              onClick={deleteSelectedSlides}
              title={`${t('common.deleteSelected')} (Del)`}
              aria-label={t('common.deleteSelected')}
              className="p-2.5 rounded-md bg-red-600/20 hover:bg-red-600/30 border border-red-500/30 text-red-400 transition-colors focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:outline-none active:scale-[0.92]"
            >
              <Trash2 className="w-4 h-4" aria-hidden="true" />
            </button>
          </>
        )}

        <div className="w-px h-6 bg-white/10 mx-1" />

        <button
          onClick={() => setIsCheatsheetOpen(true)}
          title={t('common.keyboardShortcuts')}
          aria-label={t('common.keyboardShortcuts')}
          className="p-2.5 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none active:scale-[0.92]"
        >
          <HelpCircle className="w-4 h-4" aria-hidden="true" />
        </button>

        {/* Background Music section removed */}

        <div className="w-px h-6 bg-white/10 mx-1" />

        <button
          onClick={startLive}
          aria-label={isProjectorWindowOpen ? t('common.stopBroadcast') : t('common.startBroadcast')}
            className={cn(
              'flex items-center justify-center w-[190px] py-1.5 rounded-md transition-colors text-sm font-bold shadow-lg focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[#1e1e1e] focus-visible:outline-none active:scale-[0.97]',
            isProjectorWindowOpen
              ? 'bg-red-600 hover:bg-red-700 shadow-red-900/20 focus-visible:ring-red-400'
              : 'bg-green-600 hover:bg-green-700 shadow-green-900/20 focus-visible:ring-green-400'
          )}
        >
          {isProjectorWindowOpen ? (
            <>
              <Monitor className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{t('common.stopBroadcast').toUpperCase()}</span>
            </>
          ) : (
            <>
              <Play className="w-4 h-4 shrink-0 fill-current" aria-hidden="true" />
              <span className="truncate">{t('common.startBroadcast').toUpperCase()}</span>
            </>
          )}
        </button>

        <div className="w-px h-6 bg-white/10 mx-1" />

        <button
          onClick={() => setIsRightPanelOpen(!isRightPanelOpen)}
          title={isRightPanelOpen ? t('common.panelClose') : t('common.panelOpen')}
          aria-label={isRightPanelOpen ? t('common.panelClose') : t('common.panelOpen')}
          aria-pressed={isRightPanelOpen}
          className={cn(
            'p-2.5 rounded-md transition-colors border focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none active:scale-[0.92]',
            isRightPanelOpen
              ? 'bg-white/10 hover:bg-white/15 border-white/15 text-white'
              : 'bg-white/5 hover:bg-white/10 border-white/10 text-white/60'
          )}
        >
          {isRightPanelOpen ? <PanelRightClose className="w-4 h-4" /> : <PanelRightOpen className="w-4 h-4" />}
        </button>
      </div>
    </header>
  );
}
