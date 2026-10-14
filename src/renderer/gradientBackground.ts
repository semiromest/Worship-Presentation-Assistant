import type { Slide, Presentation } from './types';
import type { GeneratedBackground } from '../shared/generatedBackground';
export type GradientScope = 'slide' | 'group' | 'selection';
export type BackgroundStyle = NonNullable<Slide['styles']>;
export function backgroundPatch(
  base: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const changesBackground = ['backgroundImage', 'backgroundVideo', 'backgroundGradient', 'backgroundColor'].some(
    (key) => key in patch
  );
  return {
    ...base,
    ...(changesBackground ? { backgroundExplicit: true } : {}),
    ...(changesBackground && !('generatedBackground' in patch)
      ? {
          generatedBackground: undefined,
          ...(base.generatedBackground && !('backgroundImage' in patch)
            ? { backgroundImage: undefined, backgroundBlur: 0 }
            : {}),
        }
      : {}),
    ...patch,
  };
}
export function gradientTargets(slides: Slide[], activeId: string, selected: string[], scope: GradientScope): Slide[] {
  const active = slides.find((s) => s.id === activeId);
  return slides.filter(
    (s) =>
      s.type === 'text' &&
      (scope === 'group'
        ? !!active?.group && s.group?.id === active.group.id
        : scope === 'selection'
          ? selected.includes(s.id)
          : s.id === activeId)
  );
}
export function generatedStyles(
  image: string,
  recipe: GeneratedBackground,
  groupDefault = false
): Partial<BackgroundStyle> {
  return {
    backgroundImage: image,
    generatedBackground: recipe,
    backgroundVideo: undefined,
    backgroundGradient: undefined,
    backgroundBlur: 0,
    ...(groupDefault ? { generatedGroupBackground: { image, recipe } } : {}),
  };
}
export function applyGeneratedBackground(
  deck: Presentation,
  ids: string[],
  image: string,
  recipe: GeneratedBackground,
  groupDefault: boolean
): Presentation {
  const targets = new Set(ids);
  return {
    ...deck,
    slides: deck.slides.map((s) =>
      targets.has(s.id)
        ? { ...s, styles: { ...s.styles, ...generatedStyles(image, recipe, groupDefault) } as BackgroundStyle }
        : s
    ),
  };
}
/** Only freshly created slides inherit. Moving an existing slide never triggers inheritance. */
export function inheritGeneratedBackgrounds(existing: Slide[], additions: Slide[]): Slide[] {
  const known = new Set(existing.map((s) => s.id));
  return additions.map((s) => {
    if (
      known.has(s.id) ||
      !s.group ||
      s.type !== 'text' ||
      s.styles?.backgroundImage ||
      s.styles?.backgroundVideo ||
      s.styles?.backgroundGradient ||
      (s.styles?.backgroundColor && s.styles?.backgroundExplicit !== false)
    )
      return s;
    const inherited = existing.find(
      (other) => other.group?.id === s.group?.id && other.styles?.generatedGroupBackground
    )?.styles?.generatedGroupBackground;
    return inherited
      ? {
          ...s,
          styles: { ...s.styles, ...generatedStyles(inherited.image, inherited.recipe, true) } as BackgroundStyle,
        }
      : s;
  });
}
