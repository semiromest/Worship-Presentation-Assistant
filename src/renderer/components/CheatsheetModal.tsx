import { useTranslation } from 'react-i18next';
import { useStore } from '../state/useStore';
import Dialog from './Dialog';

export default function CheatsheetModal() {
  const { t } = useTranslation();
  const { isCheatsheetOpen, setIsCheatsheetOpen } = useStore();

  return (
    <Dialog
      open={isCheatsheetOpen}
      onClose={() => setIsCheatsheetOpen(false)}
      labelledBy="cheatsheet-title"
      className="bg-surface-overlay border border-white/10 rounded-2xl p-6 max-w-2xl w-full mx-4 shadow-2xl max-h-[85vh] overflow-y-auto"
    >
      <div className="flex items-center justify-between mb-4">
        <h2 id="cheatsheet-title" className="text-lg font-bold">
          {t('common.cheatsheet.title')}
        </h2>
        <button
          onClick={() => setIsCheatsheetOpen(false)}
          aria-label={t('common.cheatsheet.close')}
          className="p-1 rounded hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
        >
          <span aria-hidden="true">✕</span>
        </button>
      </div>

      {/* Navigation */}
      <Section title={t('common.cheatsheet.navigation')}>
        <ShortcutRow keys="→ / Space / J" label={t('common.cheatsheet.next')} />
        <ShortcutRow keys="← / K" label={t('common.cheatsheet.previous')} />
        <ShortcutRow keys="Home" label={t('common.cheatsheet.firstSlide')} />
        <ShortcutRow keys="End" label={t('common.cheatsheet.lastSlide')} />
        <ShortcutRow keys="Enter" label={t('common.cheatsheet.goLive')} />
      </Section>

      {/* Tab Switching */}
      <Section title={t('common.cheatsheet.tabs')}>
        <ShortcutRow keys="?" label={t('common.cheatsheet.openCheatsheet')} />
        <ShortcutRow keys="Alt+1-8" label={t('common.cheatsheet.switchTab')} />
      </Section>

      {/* Editing */}
      <Section title={t('common.cheatsheet.editing')}>
        <ShortcutRow keys="Ctrl+Z" label={t('common.cheatsheet.undo')} />
        <ShortcutRow keys="Ctrl+Y / Ctrl+Shift+Z" label={t('common.cheatsheet.redo')} />
        <ShortcutRow keys="Ctrl++" label={t('common.cheatsheet.zoomIn')} />
        <ShortcutRow keys="Ctrl+-" label={t('common.cheatsheet.zoomOut')} />
        <ShortcutRow keys="Delete" label={t('common.cheatsheet.deleteSlide')} />
        <ShortcutRow keys="Ctrl+D" label={t('common.cheatsheet.duplicateSlide')} />
        <ShortcutRow keys="Escape" label={t('common.cheatsheet.clearSelection')} />
      </Section>

      {/* Slide Operations */}
      <Section title={t('common.cheatsheet.slideOperations')}>
        <ShortcutRow keys="Alt+Enter" label={t('common.cheatsheet.splitSlide')} />
        <ShortcutRow keys="Shift+Tık" label={t('common.cheatsheet.multiSelect')} />
        <ShortcutRow keys="Alt+↑" label={t('common.cheatsheet.moveUp')} />
        <ShortcutRow keys="Alt+↓" label={t('common.cheatsheet.moveDown')} />
      </Section>

      {/* Broadcast */}
      <Section title={t('common.cheatsheet.broadcast')}>
        <ShortcutRow keys="B" label={t('common.cheatsheet.blackScreen')} />
        <ShortcutRow keys="Esc" label={t('common.cheatsheet.closeBroadcast')} />
      </Section>

      {/* Tabs Introduction */}
      <div className="mt-4 pt-4 border-t border-white/10">
        <Section title={t('common.cheatsheet.tabIntro')}>
          <TabDescRow tab="Alt+1" name={t('nav.presentations')} desc={t('common.cheatsheet.tabPresentations')} />
          <TabDescRow tab="Alt+2" name={t('nav.slides')} desc={t('common.cheatsheet.tabSlides')} />
          <TabDescRow tab="Alt+3" name={t('nav.bible')} desc={t('common.cheatsheet.tabBible')} />
          <TabDescRow tab="Alt+4" name={t('nav.media')} desc={t('common.cheatsheet.tabMedia')} />
          <TabDescRow tab="Alt+5" name={t('nav.hymns')} desc={t('common.cheatsheet.tabHymns')} />
          <TabDescRow tab="Alt+6" name={t('nav.countdown')} desc={t('common.cheatsheet.tabCountdown')} />
          <TabDescRow tab="Alt+7" name={t('nav.screen')} desc={t('common.cheatsheet.tabScreen')} />
          <TabDescRow tab="Alt+8" name={t('nav.calendar')} desc={t('common.cheatsheet.tabCalendar')} />
        </Section>
      </div>

      <p className="mt-4 pt-4 border-t border-white/10 text-xs text-white/45 text-center">
        {t('common.cheatsheet.hint')}
      </p>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <p className="text-xs font-bold text-white/50 uppercase tracking-wider mb-2">{title}</p>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function ShortcutRow({ keys, label }: { keys: string; label: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <kbd className="kbd text-[11px]">{keys}</kbd>
      <span className="text-white/65 text-right text-[13px]">{label}</span>
    </div>
  );
}

function TabDescRow({ tab, name, desc }: { tab: string; name: string; desc: string }) {
  return (
    <div className="flex items-start gap-2 py-1">
      <kbd className="kbd text-[10px] mt-0.5 shrink-0">{tab}</kbd>
      <div className="min-w-0">
        <span className="text-white/80 text-xs font-semibold">{name}</span>
        <p className="text-white/45 text-[11px] leading-relaxed">{desc}</p>
      </div>
    </div>
  );
}
