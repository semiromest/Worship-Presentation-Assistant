export const practiceTasks = ['presentations', 'slides', 'bible', 'media', 'hymns', 'countdown', 'screen', 'calendar', 'editor', 'settings'] as const;
export type PracticeTask = typeof practiceTasks[number];
export type PracticeStatus = 'notStarted' | 'inProgress' | 'completed' | 'skipped';
/** Original lyrics created only for the isolated practice guide. */
export const practiceHymns = {
  tr: { id: 'practice-hymn-tr', title: 'Alıştırma ilahisi', lyrics: 'Sevginle yolumu aydınlat\nYüreğimde umut yeşersin\n\nBirlikte sevgiyle yürüyelim\nHer gün şükranla söyleyelim' },
  en: { id: 'practice-hymn-en', title: 'Practice hymn', lyrics: 'Light my path with your love\nLet hope grow in my heart\n\nTogether we walk in love\nEach day we sing with thankful hearts' },
  de: { id: 'practice-hymn-de', title: 'Übungslied', lyrics: 'Erhelle meinen Weg mit deiner Liebe\nLass Hoffnung in meinem Herzen wachsen\n\nGemeinsam gehen wir in Liebe\nJeden Tag singen wir voller Dank' },
  es: { id: 'practice-hymn-es', title: 'Himno de práctica', lyrics: 'Ilumina mi camino con tu amor\nQue crezca la esperanza en mi corazón\n\nCaminemos juntos con amor\nCantemos cada día con gratitud' },
  ko: { id: 'practice-hymn-ko', title: '연습 찬송', lyrics: '당신의 사랑으로 내 길을 밝혀 주세요\n내 마음에 희망이 자라게 해 주세요\n\n함께 사랑으로 걸어가요\n날마다 감사하며 노래해요' },
} as const;
export const practiceExercises = ['slide-add', 'slide-reorder', 'slide-delete', 'media', 'image-edit', 'canvas-edit', 'bible', 'hymns', 'countdown', 'presentations'] as const;
export type PracticeExercise = typeof practiceExercises[number];
export const exercisePage: Record<PracticeExercise, PracticeTask> = { 'slide-add': 'slides', 'slide-reorder': 'slides', 'slide-delete': 'slides', media: 'media', 'image-edit': 'editor', 'canvas-edit': 'editor', bible: 'bible', hymns: 'hymns', countdown: 'countdown', presentations: 'presentations' };
export interface PracticeProgress { schemaVersion: 2; runId?: string; revision: number; tasks: Partial<Record<PracticeTask, PracticeStatus>>; exercises: Partial<Record<PracticeExercise, PracticeStatus>> }
export interface PracticeSession { id: string; exercise: PracticeExercise; baseline: string[]; target?: string; peer?: string; fingerprint?: string; importedBible?: boolean; importedMedia?: boolean; paused?: boolean; deckId?: string; saveIntent?: { sessionId: string; name: string; requestedAt: number; deck: import('./presentation').Presentation } }
export const guideSteps = ['welcome', 'presentations', 'sidebar', 'nav-slides', 'add', 'add-result', 'reorder', 'select', 'delete', 'delete-result',
  'nav-bible','bible-intro','bible-source','bible-import','bible-book','bible-chapter','bible-verse','bible-add',
  'bible-result','nav-media','media-intro','media-menu','media-import','media-add','media-result','image-select','image-tools','image-fit','image-grayscale','image-edit-result','nav-hymns','hymns-intro','hymns-online','hymns-author','hymns-mode','hymns-add','hymns-result','hymns-parts','hymns-font',
  'nav-countdown','countdown-intro','countdown-duration','countdown-add','countdown-result','nav-screen','screen-intro',
  'nav-calendar','calendar-intro','nav-editor','editor-intro','editor-select','editor-rotate','editor-save','editor-result','nav-settings','settings-intro','phone-controls','nav-save','save','save-result','done'] as const;
export type GuideStep = typeof guideSteps[number];
/** Legacy deletion results remain readable but are no longer presented. */
export const visibleGuideSteps = guideSteps.filter(step => step !== 'delete-result');
export const guideChapters: Record<PracticeTask, GuideStep> = { presentations:'presentations',slides:'add',bible:'bible-intro',media:'media-intro',hymns:'hymns-intro',countdown:'countdown-intro',screen:'screen-intro',calendar:'calendar-intro',editor:'editor-intro',settings:'settings-intro' };
export const guideResultSteps = { 'add-result': 'slide-add', 'delete-result': 'slide-delete', 'bible-result': 'bible', 'media-result': 'media', 'image-edit-result': 'image-edit', 'editor-result': 'canvas-edit', 'hymns-result': 'hymns', 'countdown-result': 'countdown', 'save-result': 'presentations' } as const;
export type GuideResultStep = keyof typeof guideResultSteps;
export function isGuideResultStep(step: GuideStep): step is GuideResultStep { return Object.hasOwn(guideResultSteps, step); }
/** Immutable evidence produced only after main validates the actual operation. */
export interface GuideResult extends ExerciseResult {
  runId: string; deckId: string; resourceIds: string[];
  slides: import('./presentation').Slide[];
  beforeCount: number; afterCount: number;
  remaining?: import('./presentation').Slide[];
  savedName?: string; savedAt?: number;
}
export interface PracticeGuide { version: 3; id: string; step: GuideStep; paused: boolean; skipped: GuideStep[]; ui?: GuideUi; result?: GuideResult; focusSlideId?: string }
export interface GuideUi { bibleReady?: boolean; book?: number; chapter?: number; chapterChosen?: boolean; verse?: boolean; sourceMenu?: boolean; mediaMenu?: boolean; imageReady?: boolean; imageImported?: boolean; minutes?: number; editorSlideId?: string; editorItemId?: string; editorRotation?: number; editorSelected?: boolean }
export interface GuideObservation { deck: unknown; tab: string; selected: string[]; ui?: GuideUi }
export function guideTab(step: GuideStep): PracticeTask {
  if (['welcome','presentations','sidebar','nav-slides','save','save-result','done'].includes(step)) return 'presentations';
  if (['hymns-parts','hymns-font'].includes(step) || step.startsWith('image-')) return 'slides';
  if (step === 'phone-controls') return 'settings';
  if (step === 'nav-save') return 'settings';
  if (step.startsWith('nav-')) { const index = guideSteps.indexOf(step); return guideTab(guideSteps[index - 1]); }
  for (const page of ['bible','media','hymns','countdown','screen','calendar','editor','settings'] as const) if (step.startsWith(page + '-')) return page;
  return 'slides';
}
export function guideNarrative(step: GuideStep) { return ['welcome','presentations','sidebar','hymns-parts','hymns-font','image-tools','hymns-online','hymns-author','hymns-mode','phone-controls'].includes(step) || step.endsWith('-intro'); }
export interface PracticeWorkspace { schemaVersion: 2; runId?: string; deck: import('./presentation').Presentation; active: PracticeSession | null; checkpoints?: Partial<Record<PracticeExercise, PracticeSession>>; guide: PracticeGuide }
export interface PracticeResult { task: PracticeTask; operation: 'preset-saved'; resourceId: string }
export const exerciseOperation = { 'slide-add': 'slide-added', 'slide-reorder': 'slides-reordered', 'slide-delete': 'owned-slide-deleted', media: 'media-added', 'image-edit': 'practice-image-edited', 'canvas-edit': 'canvas-image-edited', bible: 'bible-imported-and-added', hymns: 'hymn-added', countdown: 'countdown-added', presentations: 'preset-saved' } as const;
export interface ExerciseResult { exercise: PracticeExercise; operation: typeof exerciseOperation[PracticeExercise]; sessionId: string; resourceId: string }
export type ProgressRead = { ok: true; progress: PracticeProgress; guide?: PracticeGuide } | { ok: false; error: 'unreadable' };
