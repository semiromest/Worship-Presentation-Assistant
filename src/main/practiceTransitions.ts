import type { GuideObservation, GuideStep, GuideUi, PracticeSession } from '../shared/practice';
import type { Presentation } from '../shared/presentation';

interface Observation {
  task: PracticeSession | null;
  ui: GuideUi;
  input: GuideObservation;
  deck: Presentation;
}
type Transition = (observation: Observation) => GuideStep | null;
const selectedTarget = ({ task, input }: Observation) =>
  !!task?.target && input.selected.length === 1 && input.selected[0] === task.target;
const editorTarget = ({ task, ui }: Observation) =>
  task?.exercise === 'canvas-edit' && ui.editorSlideId === task.target;
const editorSelection = (value: Observation) =>
  editorTarget(value) && value.ui.editorSelected && value.ui.editorItemId === value.task?.peer;
const bibleImported = ({ task, ui }: Observation) => task?.importedBible && ui.bibleReady;

/** Observation-only steps never create samples or commit exercise results. */
const transitions: Partial<Record<GuideStep, Transition>> = {
  select: (value) => (selectedTarget(value) ? 'delete' : null),
  'editor-select': (value) => (editorSelection(value) && value.input.tab === 'editor' ? 'editor-rotate' : null),
  'editor-rotate': (value) => {
    if (!editorTarget(value)) return null;
    if (value.ui.editorItemId === value.task?.peer && value.ui.editorRotation === 15) return 'editor-save';
    if (!editorSelection(value)) return 'editor-select';
    return null;
  },
  'editor-save': (value) => {
    if (!editorTarget(value)) return null;
    if (!editorSelection(value)) return 'editor-select';
    return value.ui.editorRotation !== 15 ? 'editor-rotate' : null;
  },
  'image-select': (value) => (selectedTarget(value) ? 'image-tools' : null),
  'image-fit': ({ task, deck }) =>
    task?.target && deck.slides.find((slide) => slide.id === task.target)?.styles?.objectFit === 'contain'
      ? 'image-grayscale'
      : null,
  'bible-source': (value) => (bibleImported(value) ? 'bible-book' : value.ui.sourceMenu ? 'bible-import' : null),
  'bible-import': (value) => (bibleImported(value) ? 'bible-book' : null),
  'bible-book': ({ ui }) => (ui.book === 1 ? 'bible-chapter' : null),
  'bible-chapter': ({ ui }) => (ui.chapter === 1 && ui.chapterChosen ? 'bible-verse' : null),
  'bible-verse': ({ ui }) => (ui.verse ? 'bible-add' : null),
  'media-menu': ({ ui }) => (ui.mediaMenu ? 'media-import' : null),
  'media-import': ({ task, ui }) => (task?.importedMedia && ui.imageReady && ui.imageImported ? 'media-add' : null),
  'countdown-duration': ({ ui }) => (ui.minutes === 2 ? 'countdown-add' : null),
};

export function nextObservedGuideStep(
  step: GuideStep,
  task: PracticeSession | null,
  ui: GuideUi,
  input: GuideObservation,
  deck: Presentation
): GuideStep | null {
  return transitions[step]?.({ task, ui, input, deck }) ?? null;
}
