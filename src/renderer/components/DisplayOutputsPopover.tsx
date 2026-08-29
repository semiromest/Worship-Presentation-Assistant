import { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, Monitor, Radio, Settings2, Tv } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../state/useStore';
import { chooseDefaultOutputDisplay, type DisplayMode } from '../../shared/displays';

interface DisplayOutputsPopoverProps {
  openOutput: (displayId: string) => Promise<void>;
  closeOutput: (displayId: string) => Promise<void>;
}

function shortSlideLabel(content: string, index: number): string {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (!normalized) return `Slide ${index + 1}`;
  return `${index + 1}. ${normalized.slice(0, 42)}${normalized.length > 42 ? '…' : ''}`;
}

export default function DisplayOutputsPopover({ openOutput, closeOutput }: DisplayOutputsPopoverProps) {
  const { t } = useTranslation();
  const displays = useStore((s) => s.displays);
  const presentation = useStore((s) => s.presentation);
  const liveIndex = useStore((s) => s.liveIndex);
  const isBlackout = useStore((s) => s.isBlackout);
  const outputAssignments = useStore((s) => s.outputAssignments);
  const setOutputMode = useStore((s) => s.setOutputMode);
  const setOutputSlide = useStore((s) => s.setOutputSlide);
  const setOutputBlackout = useStore((s) => s.setOutputBlackout);
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const outputDisplays = displays.filter((display) => !display.isPrimary);
  const defaultDisplayId = chooseDefaultOutputDisplay(displays)?.id;

  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [isOpen]);

  if (outputDisplays.length === 0) return null;

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setIsOpen((value) => !value)}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        title={t('common.displayOutputs')}
        aria-label={t('common.displayOutputs')}
        className="flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 hover:text-white transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none active:scale-[0.96]"
      >
        <Monitor className="w-4 h-4" aria-hidden="true" />
        <span className="hidden xl:inline text-xs font-semibold">{outputDisplays.length}</span>
      </button>

      {isOpen && (
        <div
          role="dialog"
          aria-label={t('common.displayOutputs')}
          className="absolute right-0 top-full mt-2 z-[80] w-[330px] max-w-[calc(100vw-24px)] rounded-xl border border-white/10 bg-surface-overlay shadow-2xl p-3 space-y-3"
        >
          <div className="flex items-center gap-2 px-1">
            <Settings2 className="w-4 h-4 text-blue-400" aria-hidden="true" />
            <div className="min-w-0">
              <h2 className="text-xs font-bold text-white">{t('common.displayOutputs')}</h2>
              <p className="text-[10px] text-white/45 truncate">{t('common.displayOutputsHint')}</p>
            </div>
          </div>

          <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-0.5">
            {outputDisplays.map((display) => {
              const assignment = outputAssignments[display.id] ?? {
                mode: 'follow' as const,
                slideIndex: liveIndex,
                isOpen: false,
                isBlackout: false,
              };
              const outputBlackout = display.id === defaultDisplayId ? isBlackout : assignment.isBlackout;

              return (
                <section
                  key={display.id}
                  className="rounded-lg border border-white/10 bg-white/[0.03] p-2.5 space-y-2"
                  aria-label={display.label}
                >
                  <div className="flex items-center gap-2">
                    <Monitor className="w-4 h-4 shrink-0 text-white/55" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold truncate">{display.label}</p>
                      <p className="text-[10px] text-white/40 font-mono">
                        {display.bounds.width}×{display.bounds.height} · {display.bounds.x},{display.bounds.y}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        if (assignment.isOpen) void closeOutput(display.id);
                        else void openOutput(display.id);
                      }}
                      className={assignment.isOpen
                        ? 'px-2 py-1 rounded-md bg-red-600/20 border border-red-500/30 text-red-300 text-[10px] font-bold hover:bg-red-600/30'
                        : 'px-2 py-1 rounded-md bg-green-600/20 border border-green-500/30 text-green-300 text-[10px] font-bold hover:bg-green-600/30'}
                      aria-label={assignment.isOpen ? t('common.displayClose') : t('common.displayOpen')}
                    >
                      {assignment.isOpen ? t('common.displayClose') : t('common.displayOpen')}
                    </button>
                  </div>

                  {assignment.isOpen && (
                    <div className="grid grid-cols-[1fr_auto] gap-2 items-center">
                      <label className="min-w-0">
                        <span className="sr-only">{t('common.displayMode')}</span>
                        <select
                          value={assignment.mode}
                          onChange={(event) => setOutputMode(display.id, event.target.value as DisplayMode)}
                          className="w-full min-w-0 bg-black/25 border border-white/10 rounded-md px-2 py-1.5 text-[11px] text-white outline-none focus:border-blue-500/60"
                        >
                          <option value="follow">{t('common.displayFollowLive')}</option>
                          <option value="manual">{t('common.displayManual')}</option>
                          <option value="stage">{t('common.displayStage')}</option>
                        </select>
                      </label>

                      <button
                        type="button"
                        onClick={() => setOutputBlackout(display.id, (value) => !value)}
                        title={outputBlackout ? t('common.openBroadcast') : t('common.blackScreen')}
                        aria-label={outputBlackout ? t('common.openBroadcast') : t('common.blackScreen')}
                        className={outputBlackout
                          ? 'p-1.5 rounded-md bg-red-600/25 text-red-200 border border-red-500/35'
                          : 'p-1.5 rounded-md bg-white/5 text-white/55 border border-white/10 hover:text-white hover:bg-white/10'}
                      >
                        {outputBlackout
                          ? <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                          : <EyeOff className="w-3.5 h-3.5" aria-hidden="true" />}
                      </button>

                      {assignment.mode === 'manual' ? (
                        <label className="col-span-2 min-w-0">
                          <span className="sr-only">{t('common.displaySlide')}</span>
                          <select
                            value={Math.min(Math.max(0, assignment.slideIndex), Math.max(0, presentation.slides.length - 1))}
                            onChange={(event) => setOutputSlide(display.id, Number(event.target.value))}
                            className="w-full min-w-0 bg-black/25 border border-white/10 rounded-md px-2 py-1.5 text-[11px] text-white outline-none focus:border-blue-500/60"
                          >
                            {presentation.slides.map((slide, index) => (
                              <option key={slide.id} value={index}>
                                {shortSlideLabel(slide.content, index)}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : assignment.mode === 'stage' ? (
                        <span className="col-span-2 inline-flex items-center gap-1 text-[10px] text-purple-300/80">
                          <Tv className="w-3 h-3 shrink-0" aria-hidden="true" />
                          {t('common.displayStageHint')}
                        </span>
                      ) : (
                        <span className="col-span-2 inline-flex items-center gap-1 text-[10px] text-emerald-300/80">
                          <Radio className="w-3 h-3" aria-hidden="true" />
                          {t('common.displayFollowingLive', { index: liveIndex + 1 })}
                        </span>
                      )}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
