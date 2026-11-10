import { useEffect, useMemo, useRef, useState } from 'react';
import { Popover } from '@base-ui/react/popover';
import { LayoutTemplate, Save, Trash2, Video, Check, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import ControlTooltip from './ControlTooltip';
import MotionIcon from './MotionIcon';
import { SlidePreviewAny } from './SlidePreview';
import { useGradientLibrary } from './GradientLibraryGallery';
import { useStore } from '../state/useStore';
import { DEFAULT_STYLES } from '../defaultSlideStyles';
import { backgroundPatch } from '../gradientBackground';
import { requestGradientEditor } from '../gradientEditorRequest';
import { playSfx } from '../sfx';
import { toFileUrl } from '../utils';
import { gallerySlide, instantiateLibraryMedia, instantiateTemplate, listSlideLibrary, removeSlideLibrary, saveSlideLibrary, snapshotTemplate } from '../slideLibrary';
import type { LibraryKind, SlideLibraryEntry } from '../slideLibrary';
import type { Slide } from '../types';

function mediaKind(slide: Slide) {
  return slide.styles?.backgroundVideo ? 'video'
    : slide.styles?.generatedBackground || slide.styles?.backgroundGradient ? 'gradient' : 'image';
}

export default function SlideLibraryPopover({ kind }: { kind: LibraryKind }) {
  const { t } = useTranslation();
  const presentation = useStore(s => s.presentation);
  const selectedId = useStore(s => s.selectedSlideId);
  const selectedIds = useStore(s => s.selectedSlideIds);
  const liveSlideId = useStore(s => s.liveSlideId);
  const liveOpen = useStore(s => s.isProjectorWindowOpen);
  const [open, setOpen] = useState(false);
  // Opening lands on the dialog title, not the first button: otherwise that button's focus
  // hint pops up over the list the moment the popover opens. Tab still reaches every action.
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [entries, setEntries] = useState<SlideLibraryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [name, setName] = useState('');
  const [filter, setFilter] = useState('all');
  const base = useRef({ presentation, selectedId, selectedIds });
  const gradients = useGradientLibrary(open && kind === 'gallery');
  const source = presentation.slides.find(slide => slide.id === selectedId);
  const snapshots = useMemo(() => {
    if (kind === 'gallery') {
      const background = source && gallerySlide(source);
      return background ? [background] : [];
    }
    const selected = presentation.slides.filter(slide => selectedIds.has(slide.id));
    return selected.length ? selected : source ? [source] : [];
  }, [kind, source, presentation.slides, selectedIds]);
  const targets = presentation.slides.filter(slide => selectedIds.has(slide.id) && slide.type === 'text');
  const label = t(`slideLibrary.${kind}`);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(false);
    listSlideLibrary(kind).then(list => { if (!cancelled) setEntries(list); })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, kind]);

  useEffect(() => {
    if (open && (presentation !== base.current.presentation || selectedId !== base.current.selectedId || selectedIds !== base.current.selectedIds)) setOpen(false);
  }, [open, presentation, selectedId, selectedIds]);

  const legacy: SlideLibraryEntry[] = kind === 'gallery' ? gradients.entries.map(entry => ({
    id: `gradient:${entry.id}`, name: entry.name, createdAt: entry.createdAt,
    slide: { id: entry.id, type: 'text', content: '', styles: { ...DEFAULT_STYLES, backgroundImage: entry.image, generatedBackground: entry.recipe } },
  })) : [];
  const visible = [...entries.filter(entry => kind === 'templates' || !!gallerySlide(entry.slide)), ...legacy]
    .filter(entry => kind !== 'gallery' || filter === 'all' || mediaKind(entry.slide) === filter);

  function current() {
    const state = useStore.getState();
    return state.presentation === base.current.presentation && state.selectedSlideId === base.current.selectedId
      && state.selectedSlideIds === base.current.selectedIds ? state : null;
  }

  function choose(entry: SlideLibraryEntry) {
    const state = current();
    if (!state) { setOpen(false); return; }
    if (kind === 'gallery') {
      const ids = new Set(targets.map(slide => slide.id));
      if (!ids.size) return;
      const background = entry.slide.styles!;
      state.dispatchUndo({ type: 'SET', payload: { ...state.presentation, slides: state.presentation.slides.map(slide => ids.has(slide.id) ? {
        ...slide, styles: backgroundPatch(slide.styles ?? DEFAULT_STYLES, {
          backgroundColor: background.backgroundColor,
          backgroundImage: background.backgroundImage,
          backgroundVideo: background.backgroundVideo,
          backgroundGradient: background.backgroundGradient,
          generatedBackground: background.generatedBackground,
          generatedGroupBackground: undefined,
          backgroundBlur: background.backgroundBlur ?? 0,
          backgroundDim: background.backgroundDim ?? 0,
        }) as Slide['styles'],
      } : slide) } });
    } else {
      const index = state.presentation.slides.findIndex(slide => slide.id === state.selectedSlideId);
      const anchor = state.presentation.slides[index];
      const additions = instantiateTemplate(entry.slides ?? [entry.slide], anchor?.sectionId);
      if (!additions.length) return;
      const slides = [...state.presentation.slides];
      const insertionIndex = index < 0 ? slides.length : index + 1;
      slides.splice(insertionIndex, 0, ...additions);
      state.dispatchUndo({ type: 'SET', payload: { ...state.presentation, slides } });
      useStore.getState().selectSlides({ activeId: additions[0].id, ids: new Set(additions.map(slide => slide.id)), anchorIndex: insertionIndex });
    }
    setOpen(false);
    playSfx('success');
  }

  async function save() {
    if (!snapshots.length || busy || !current()) return;
    setBusy(true);
    setError(false);
    const savedSlides = kind === 'templates' ? snapshotTemplate(snapshots) : snapshots;
    const entry: SlideLibraryEntry = {
      id: crypto.randomUUID(), name: name.trim() || source?.group?.title || source?.content.split('\n').find(line => line.trim())?.slice(0, 60) || t('slideLibrary.untitled'),
      slide: savedSlides[0], ...(kind === 'templates' ? { slides: savedSlides } : {}), createdAt: Date.now(),
    };
    try {
      await saveSlideLibrary(kind, entry);
      setEntries(previous => [entry, ...previous]);
      setSaved(true);
      setName('');
      playSfx('success');
    } catch { setError(true); playSfx('error'); }
    finally { setBusy(false); }
  }

  async function remove(entry: SlideLibraryEntry) {
    if (busy) return;
    setBusy(true);
    setError(false);
    try {
      if (kind === 'gallery' && entry.id.startsWith('gradient:')) {
        await window.electronAPI.deleteGradientLibrary(entry.id.slice('gradient:'.length));
        gradients.reload();
      } else {
        await removeSlideLibrary(kind, entry.id);
        setEntries(previous => previous.filter(item => item.id !== entry.id));
      }
      playSfx('delete');
    } catch { setError(true); playSfx('error'); }
    finally { setBusy(false); }
  }

  async function importMedia() {
    if (busy || !window.electronAPI.selectMediaFilesAll) return;
    setBusy(true);
    setError(false);
    try {
      const paths = await window.electronAPI.selectMediaFilesAll();
      const existing = await listSlideLibrary(kind);
      const known = new Set(existing.flatMap(entry => (entry.slides ?? [entry.slide]).map(slide => slide.mediaUrl || slide.styles?.backgroundVideo || slide.styles?.backgroundImage)));
      for (const path of paths ?? []) {
        const url = toFileUrl(path);
        if (known.has(url)) continue;
        const video = /\.(mp4|webm|mov|mkv|avi|m4v|wmv|flv|mpeg|mpg|ogg)$/i.test(path);
        const background: Slide = { id: crypto.randomUUID(), type: 'text', content: '', styles: {
          ...DEFAULT_STYLES, objectFit: 'cover', backgroundExplicit: true,
          ...(video ? { backgroundVideo: url } : { backgroundImage: url }),
        } };
        const slide = kind === 'templates' ? instantiateLibraryMedia(background) : background;
        const entry: SlideLibraryEntry = {
          id: crypto.randomUUID(), name: path.split(/[\\/]/).pop() || t('slideLibrary.untitled'), createdAt: Date.now(),
          slide, ...(kind === 'templates' ? { slides: [slide] } : {}),
        };
        await saveSlideLibrary(kind, entry);
        known.add(url);
        setEntries(previous => [entry, ...previous]);
      }
      if (paths?.length) playSfx('success');
    } catch { setError(true); playSfx('error'); }
    finally { setBusy(false); }
  }

  return <Popover.Root open={open} onOpenChange={next => {
    if (next) { base.current = { presentation, selectedId, selectedIds }; setSaved(false); setName(''); }
    setOpen(next);
  }}>
    <ControlTooltip suppress={open} description={t(kind === 'gallery' ? 'controlHints.gallery' : 'controlHints.templates')}><Popover.Trigger className="design-library-trigger" data-testid={kind === 'gallery' ? 'gradient-quick-apply' : 'slide-templates'} aria-label={label} title={label}>
      {kind === 'gallery' ? <MotionIcon name="images" active={open} /> : <LayoutTemplate size={16} aria-hidden="true" />}
      <span>{label}</span>
    </Popover.Trigger></ControlTooltip>
    <Popover.Portal><Popover.Positioner side="bottom" align="end" sideOffset={8} className="z-[80]">
      <Popover.Popup aria-label={label} initialFocus={titleRef} onKeyDown={event => event.stopPropagation()}
        className="base-popover-popup w-[360px] max-w-[calc(100vw-24px)] rounded-xl border border-white/15 bg-[#202128] p-3 text-white shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 ref={titleRef} tabIndex={-1} className="text-sm font-semibold outline-none">{label}</h2>
          <ControlTooltip descriptionKey={'slideLibrary.importMedia'}><button type="button" onClick={() => void importMedia()} disabled={busy} aria-label={t('slideLibrary.importMedia')} title={t('slideLibrary.importMedia')}
            className="flex h-7 w-7 items-center justify-center rounded-md text-white/60 hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-blue-400 disabled:opacity-30"><Plus size={16} aria-hidden="true" /></button></ControlTooltip>
        </div>
        <p className="mt-1 text-xs text-white/50">{t(kind === 'gallery' ? targets.length ? 'slideLibrary.applyHint' : 'slideLibrary.selectText' : 'slideLibrary.templateHint')}</p>
        {kind === 'gallery' && selectedIds.size > targets.length && <p className="mt-1 text-xs text-white/50">{t('gradientLibrary.skipped', { count: selectedIds.size - targets.length })}</p>}
        {kind === 'gallery' && liveOpen && targets.some(slide => slide.id === liveSlideId) && <p className="mt-1 text-xs text-amber-300">{t('gradientLibrary.liveIncluded')}</p>}
        {kind === 'gallery' && <div className="mt-3 flex gap-1" role="group" aria-label={t('slideLibrary.filter')}>
          {['all', 'image', 'video', 'gradient'].map(value => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}
            className={`rounded-md px-2 py-1 text-xs focus-visible:ring-2 focus-visible:ring-blue-400 ${filter === value ? 'bg-white/10 text-white' : 'text-white/50 hover:bg-white/5'}`}>
            {t(`slideLibrary.${value}`)}
          </button>)}
        </div>}
        {(error || (kind === 'gallery' && gradients.error)) && <p role="alert" className="mt-2 text-xs text-red-300">{t('slideLibrary.error')}</p>}
        <div className="my-3 max-h-[40vh] overflow-y-auto">
          {loading || (kind === 'gallery' && gradients.loading) ? <p role="status" className="py-3 text-xs text-white/50">{t('common.loading')}</p>
            : !visible.length ? <p className="py-3 text-xs leading-5 text-white/50">{t(kind === 'gallery' ? 'slideLibrary.empty' : 'slideLibrary.templatesEmpty')}</p>
            : <ul className="grid grid-cols-2 gap-2">
              {visible.map(entry => <li key={entry.id} className="group relative min-w-0 rounded-lg border border-white/10 bg-black/20">
                <ControlTooltip description={t(kind === 'gallery' ? 'tooltipText.applyBackground' : 'tooltipText.insertTemplate', { name: entry.name })}><button type="button" disabled={busy || (kind === 'gallery' && !targets.length)} onClick={() => choose(entry)} title={entry.name}
                  data-gradient-entry={entry.id.startsWith('gradient:') ? entry.slide.id : undefined}
                  className="block w-full rounded-lg p-1.5 text-left hover:bg-white/5 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400">
                  <div className="pointer-events-none relative aspect-video w-full overflow-hidden rounded">
                    {kind === 'gallery' && entry.slide.styles?.backgroundVideo
                      ? <div className="flex h-full items-center justify-center bg-black/30">{entry.slide.thumbnailUrl && <img src={entry.slide.thumbnailUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />}<Video className="relative h-6 w-6 text-white/70" /></div>
                      : <SlidePreviewAny slide={entry.slide} cardWidth={150} />}
                    {kind === 'templates' && (entry.slides?.length ?? 1) > 1 && <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 text-[11px] text-white">{t('slideLibrary.slideCount', { count: entry.slides!.length })}</span>}
                  </div>
                  <span className="mt-1 block truncate pr-5 text-xs text-white/80">{entry.name}</span>
                </button></ControlTooltip>
                <ControlTooltip descriptionKey={'gradientLibrary.deleteNamed'}><button type="button" disabled={busy} onClick={() => void remove(entry)}
                  title={t('gradientLibrary.deleteNamed', { name: entry.name })} aria-label={t('gradientLibrary.deleteNamed', { name: entry.name })}
                  className="absolute bottom-0.5 right-0.5 flex h-7 w-7 items-center justify-center rounded text-white/55 hover:bg-red-500/10 hover:text-red-300 focus-visible:ring-2 focus-visible:ring-blue-400 disabled:opacity-30">
                  <Trash2 size={12} aria-hidden="true" />
                </button></ControlTooltip>
              </li>)}
            </ul>}
        </div>
        <form className="flex gap-2 border-t border-white/10 pt-3" onSubmit={event => { event.preventDefault(); void save(); }}>
          <input aria-label={t('slideLibrary.name')} placeholder={t('slideLibrary.name')} maxLength={80} value={name} onChange={event => { setName(event.target.value); setSaved(false); }}
            disabled={!snapshots.length || busy} className="min-w-0 flex-1 rounded-md border border-white/10 bg-black/20 px-2 py-1.5 text-xs text-white outline-none placeholder:text-white/30 focus-visible:ring-1 focus-visible:ring-blue-400 disabled:opacity-30" />
          <ControlTooltip descriptionKey={kind === 'gallery' ? 'slideLibrary.saveGallery' : 'slideLibrary.saveTemplate'}><button type="submit" disabled={!snapshots.length || busy || saved} title={t(kind === 'gallery' ? 'slideLibrary.saveGallery' : 'slideLibrary.saveTemplate')}
            className="flex items-center gap-1.5 rounded-md border border-white/10 px-2 py-1.5 text-xs text-white/70 hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-blue-400 disabled:opacity-30">
            {saved ? <Check size={14} aria-hidden="true" /> : <Save size={14} aria-hidden="true" />}{t('slideLibrary.saveSelected')}
          </button></ControlTooltip>
        </form>
        {kind === 'gallery' && <button type="button" disabled={!targets.length} onClick={() => {
          const state = current();
          const target = targets.find(slide => slide.id === selectedId) ?? targets[0];
          if (!state || !target) return;
          setOpen(false); requestGradientEditor(target.id); state.openEditor(target.id);
        }} className="mt-2 text-xs text-white/50 hover:text-white disabled:opacity-30">{t('gradientLibrary.openEditor')}</button>}
      </Popover.Popup>
    </Popover.Positioner></Popover.Portal>
  </Popover.Root>;
}
