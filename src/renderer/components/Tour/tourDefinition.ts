export const TOUR_STEPS = [
  { id: 'navigation', targetId: 'sidebar' },
  { id: 'slides', targetId: 'slides', tab: 'slides' },
  { id: 'content', targetId: 'bible', tab: 'bible' },
  { id: 'output', targetId: 'toolbar', tab: 'slides' },
  { id: 'help', targetId: 'help', tab: 'settings' },
] as const;
export const TOUR_MAP = [
  { id: 'presentations', shortcut: 'Alt+1', description: 'common.cheatsheet.tabPresentations' },
  { id: 'slides', shortcut: 'Alt+2', description: 'common.cheatsheet.tabSlides' },
  { id: 'bible', shortcut: 'Alt+3', description: 'common.cheatsheet.tabBible' },
  { id: 'media', shortcut: 'Alt+4', description: 'common.cheatsheet.tabMedia' },
  { id: 'hymns', shortcut: 'Alt+5', description: 'common.cheatsheet.tabHymns' },
  { id: 'countdown', shortcut: 'Alt+6', description: 'common.cheatsheet.tabCountdown' },
  { id: 'screen', shortcut: 'Alt+7', description: 'common.cheatsheet.tabScreen' },
  { id: 'calendar', shortcut: 'Alt+8', description: 'common.cheatsheet.tabCalendar' },
  { id: 'editor', shortcut: 'Alt+0', description: 'tour.editorDescription' },
  { id: 'settings', shortcut: 'Alt+9', description: 'common.cheatsheet.tabSettings' },
] as const;

export type TourPage = typeof TOUR_MAP[number]['id'];
export const PAGE_INTROS = Object.fromEntries(TOUR_MAP.map(page => [page.id, [
  { id: `page-${page.id}`, targetId: `page-${page.id}`, tab: page.id },
]])) as Record<TourPage, Array<{ id: string; targetId: string; tab: TourPage }>>;
