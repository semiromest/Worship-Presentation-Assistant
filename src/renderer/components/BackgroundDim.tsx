import { backgroundDim } from '../musicCustomization';

/** Insert after background media and before foreground text/items in every renderer. */
export default function BackgroundDim({ value }: { value: unknown }) {
  const opacity = backgroundDim(value);
  return opacity > 0 ? <div data-background-dim="" aria-hidden="true" className="absolute inset-0 pointer-events-none" style={{ backgroundColor: '#000', opacity }} /> : null;
}
