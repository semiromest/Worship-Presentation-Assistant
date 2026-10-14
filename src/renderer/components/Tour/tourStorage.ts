import { TOUR_MAP, type TourPage } from './tourDefinition';
export type TourState = {
  schemaVersion: 2; welcomeSeen: boolean; status: 'notStarted' | 'dismissed' | 'completed';
  pageSuggestions: { eligible: boolean; enabled: boolean };
  pages: Partial<Record<TourPage, { suggested: boolean; completed: boolean }>>;
};
export type ProfileKind = 'new' | 'existing' | 'unknown';
export const TOUR_STORAGE_KEY = 'wpa.tour';
export const suppressedState: TourState = { schemaVersion: 2, welcomeSeen: true, status: 'notStarted',
  pageSuggestions: { eligible: false, enabled: false }, pages: {} };
const validStatus = (status: unknown): status is TourState['status'] => ['notStarted', 'dismissed', 'completed'].includes(String(status));
export function parseTourState(raw: string | null, profile: ProfileKind): TourState {
  const fallback = (): TourState => ({ ...suppressedState, pageSuggestions: { ...suppressedState.pageSuggestions }, pages: {} });
  if (raw === null) return { ...fallback(), welcomeSeen: profile !== 'new', pageSuggestions: { eligible: profile === 'new', enabled: profile === 'new' } };
  try {
    const value = JSON.parse(raw);
    if (typeof value?.welcomeSeen !== 'boolean' || !validStatus(value.status)) return fallback();
    // All v1 profiles predate page suggestions: migration never opts them in.
    if (value.schemaVersion === 1) return { ...fallback(), welcomeSeen: value.welcomeSeen, status: value.status };
    if (value.schemaVersion !== 2 || typeof value.pageSuggestions?.eligible !== 'boolean' ||
      typeof value.pageSuggestions?.enabled !== 'boolean' || !value.pages || typeof value.pages !== 'object' || Array.isArray(value.pages)) return fallback();
    const pages: TourState['pages'] = {};
    for (const { id } of TOUR_MAP) {
      const item = value.pages[id];
      if (item !== undefined) {
        if (typeof item?.suggested !== 'boolean' || typeof item?.completed !== 'boolean') return fallback();
        pages[id] = { suggested: item.suggested, completed: item.completed };
      }
    }
    return { schemaVersion: 2, welcomeSeen: value.welcomeSeen, status: value.status,
      pageSuggestions: { eligible: value.pageSuggestions.eligible, enabled: value.pageSuggestions.eligible && value.pageSuggestions.enabled }, pages };
  } catch { return fallback(); }
}
let memory: TourState | undefined;
export function readTourState(profile: ProfileKind = 'unknown'): TourState {
  if (memory) return memory;
  try { memory = parseTourState(localStorage.getItem(TOUR_STORAGE_KEY), profile); }
  catch { memory = parseTourState('{}', 'unknown'); }
  return memory;
}
export function writeTourState(state: TourState) {
  memory = state;
  try { localStorage.setItem(TOUR_STORAGE_KEY, JSON.stringify(state)); }
  catch { /* Session memory preserves the decision. */ }
}
export function endTourState(previous: TourState, status: 'dismissed' | 'completed'): TourState {
  return { ...previous, welcomeSeen: true, status: previous.status === 'completed' ? 'completed' : status };
}
export function recordTourEnd(status: 'dismissed' | 'completed') { writeTourState(endTourState(readTourState(), status)); }
export function recordPage(page: TourPage, field: 'suggested' | 'completed') {
  const previous = readTourState();
  writeTourState({ ...previous, pages: { ...previous.pages, [page]: {
    suggested: previous.pages[page]?.suggested ?? false, completed: previous.pages[page]?.completed ?? false, [field]: true,
  } } });
}
export function disablePageSuggestions() {
  const previous = readTourState();
  writeTourState({ ...previous, pageSuggestions: { ...previous.pageSuggestions, enabled: false } });
}
