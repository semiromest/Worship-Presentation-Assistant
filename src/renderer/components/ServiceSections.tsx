import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../state/useStore';
import { assignSection, moveSection, sectionGroups } from '../../shared/serviceSections';
import type { Slide } from '../types';

export const SERVICE_SECTIONS = ['welcome', 'worship', 'prayer', 'sermon', 'announcements'] as const;

export function SectionAssignment() {
  const { t } = useTranslation();
  const enabled = useStore(s => s.serviceSectionsEnabled);
  if (!enabled) return null;
  return <select aria-label={t('sections.assign')} value="" className="max-w-40 bg-surface-overlay border border-white/10 rounded-lg p-2 text-xs"
    onChange={e => {
      const state = useStore.getState();
      const id = e.target.value;
      const selected = state.selectedSlideIds.size ? state.selectedSlideIds : new Set([state.selectedSlideId]);
      state.dispatchUndo({ type: 'SET', payload: { ...state.presentation, slides: assignSection(state.presentation.slides, selected,
        id === 'none' ? undefined : { id, title: t(`sections.${id}`) }) } });
    }}>
    <option value="" disabled>{t('sections.assign')}</option>
    {SERVICE_SECTIONS.map(id => <option key={id} value={id}>{t(`sections.${id}`)}</option>)}
    <option value="none">{t('sections.none')}</option>
  </select>;
}

export default function ServiceSections({ slides, columns, renderSlide }: {
  slides: Slide[]; columns: number; renderSlide: (slide: Slide) => ReactNode;
}) {
  const { t } = useTranslation();
  const selected = useStore(s => s.selectedSlideId);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const groups = sectionGroups(slides);
  useEffect(() => {
    const id = slides.find(s => s.id === selected)?.section?.id ?? '';
    setCollapsed(old => { if (!old.has(id)) return old; const next = new Set(old); next.delete(id); return next; });
  }, [selected, slides]);
  return <div className="space-y-4">
    {groups.map((group, index) => <section key={`${group.id}-${group.slides[0].id}`} className="rounded-xl border border-white/10 overflow-hidden">
      <div className="flex items-center gap-2 bg-white/5 p-2">
        <button className="flex-1 text-left text-sm p-1" aria-expanded={!collapsed.has(group.id)}
          onClick={() => setCollapsed(old => { const next = new Set(old); if (next.has(group.id)) next.delete(group.id); else next.add(group.id); return next; })}>
          {collapsed.has(group.id) ? '▸' : '▾'} {group.id ? t(`sections.${group.id}`, { defaultValue: group.title }) : t('sections.none')} <span className="text-white/40">({group.slides.length})</span>
        </button>
        <button className="text-xs p-2 hover:bg-white/10 rounded" onClick={() => {
          const state = useStore.getState(); const first = group.slides[0];
          state.setSelectedSlideId(first.id); state.setSelectedSlideIds(new Set([first.id]));
          setCollapsed(old => { const next = new Set(old); next.delete(group.id); return next; });
          requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-slide-id="${CSS.escape(first.id)}"]`)?.scrollIntoView({ block: 'nearest' }));
        }}>{t('sections.first')}</button>
        {([-1, 1] as const).map(direction => <button key={direction} className="p-2 rounded hover:bg-white/10 disabled:opacity-25"
          aria-label={t(direction === -1 ? 'common.moveUp' : 'common.moveDown')}
          disabled={direction === -1 ? index === 0 : index === groups.length - 1}
          onClick={() => { const state = useStore.getState(); const fullGroups = sectionGroups(state.presentation.slides);
            const source = fullGroups.findIndex(g => g.slides.some(s => s.id === group.slides[0].id));
            state.dispatchUndo({ type: 'SET', payload: { ...state.presentation, slides: moveSection(state.presentation.slides, source, direction) } });
          }}>{direction === -1 ? '↑' : '↓'}</button>)}
      </div>
      {!collapsed.has(group.id) && <div className="grid gap-3 p-3" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>{group.slides.map(renderSlide)}</div>}
    </section>)}
  </div>;
}
