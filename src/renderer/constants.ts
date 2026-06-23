import type { TransitionType } from './types';

// ─── Defaults ─────────────────────────────────────────────────────────────────

export const DEFAULT_STYLES = {
  fontSize: 48,
  textTransform: 'none',
  backgroundColor: '#000000',
  textColor: '#ffffff',
  textAlign: 'center',
  verticalAlign: 'center',
  fontWeight: 'bold',
  fontStyle: 'normal',
  lineHeight: 1.3,
  opacity: 1,
  imageBrightness: 1,
  imageContrast: 1,
  imageBlur: 0,
  imageGrayscale: 0,
  imageSepia: 0,
  imageFlipX: false,
  imageFlipY: false,
} as const;

export const DEFAULT__TRANSITION: { type: TransitionType; duration: number } = {
  type: 'fade',
  duration: 400,
};

export const SLIDE_REFERENCE_WIDTH  = 1920;
export const SLIDE_REFERENCE_HEIGHT = 1080;

export const IS_PROJECTOR_MODE =
  new URLSearchParams(window.location.search).get('mode') === 'projector';

// ─── Transition CSS Injection ─────────────────────────────────────────────────

export const injectTransitionStyles = (): void => {
  if (typeof document === 'undefined') return;
  if (document.getElementById('slide-tr-styles')) return;
  const s = document.createElement('style');
  s.id = 'slide-tr-styles';
  s.textContent = `
    @media (prefers-reduced-motion: no-preference) {
    @keyframes tr-fadeIn        { from{opacity:0}                                          to{opacity:1} }
    @keyframes tr-fadeOut       { from{opacity:1}                                          to{opacity:0} }
    @keyframes tr-slideInL      { from{transform:translateX(100%)}                         to{transform:translateX(0)} }
    @keyframes tr-slideOutL     { from{transform:translateX(0)}                            to{transform:translateX(-100%)} }
    @keyframes tr-slideInR      { from{transform:translateX(-100%)}                        to{transform:translateX(0)} }
    @keyframes tr-slideOutR     { from{transform:translateX(0)}                            to{transform:translateX(100%)} }
    @keyframes tr-slideInU      { from{transform:translateY(100%)}                         to{transform:translateY(0)} }
    @keyframes tr-slideOutU     { from{transform:translateY(0)}                            to{transform:translateY(-100%)} }
    @keyframes tr-slideInD      { from{transform:translateY(-100%)}                        to{transform:translateY(0)} }
    @keyframes tr-slideOutD     { from{transform:translateY(0)}                            to{transform:translateY(100%)} }
    @keyframes tr-zoomIn        { from{transform:scale(.82);opacity:0}                     to{transform:scale(1);opacity:1} }
    @keyframes tr-zoomOut2      { from{transform:scale(1);opacity:1}                       to{transform:scale(1.12);opacity:0} }
    @keyframes tr-zoomOutIn     { from{transform:scale(1.15);opacity:0}                    to{transform:scale(1);opacity:1} }
    @keyframes tr-zoomOutOut    { from{transform:scale(1);opacity:1}                       to{transform:scale(.82);opacity:0} }
    @keyframes tr-blurIn        { from{filter:blur(18px);opacity:0}                        to{filter:blur(0px);opacity:1} }
    @keyframes tr-blurOut       { from{filter:blur(0px);opacity:1}                         to{filter:blur(18px);opacity:0} }
    @keyframes tr-flipIn        { from{transform:perspective(700px) rotateY(-90deg);opacity:0} to{transform:perspective(700px) rotateY(0);opacity:1} }
    @keyframes tr-flipOut       { from{transform:perspective(700px) rotateY(0);opacity:1}  to{transform:perspective(700px) rotateY(90deg);opacity:0} }
    }
  `;
  document.head.appendChild(s);
};

injectTransitionStyles();

// ─── Animation Map ────────────────────────────────────────────────────────────

export const ANIM_MAP: Record<TransitionType, { in: string; out: string }> = {
  none:       { in: '',              out: '' },
  fade:       { in: 'tr-fadeIn',    out: 'tr-fadeOut' },
  slideLeft:  { in: 'tr-slideInL',  out: 'tr-slideOutL' },
  slideRight: { in: 'tr-slideInR',  out: 'tr-slideOutR' },
  slideUp:    { in: 'tr-slideInU',  out: 'tr-slideOutU' },
  slideDown:  { in: 'tr-slideInD',  out: 'tr-slideOutD' },
  zoom:       { in: 'tr-zoomIn',    out: 'tr-zoomOut2' },
  zoomOut:    { in: 'tr-zoomOutIn', out: 'tr-zoomOutOut' },
  blur:       { in: 'tr-blurIn',    out: 'tr-blurOut' },
  flip:       { in: 'tr-flipIn',    out: 'tr-flipOut' },
};

// ─── Transition UI Options ────────────────────────────────────────────────────

export const TRANSITION_OPTIONS: { type: TransitionType; label: string; icon: string }[] = [
  { type: 'none',       label: 'transition.none',       icon: '✕' },
  { type: 'fade',       label: 'transition.fade',       icon: '◐' },
  { type: 'slideLeft',  label: 'transition.slideLeft',  icon: '←' },
  { type: 'slideRight', label: 'transition.slideRight', icon: '→' },
  { type: 'slideUp',    label: 'transition.slideUp',    icon: '↑' },
  { type: 'slideDown',  label: 'transition.slideDown',  icon: '↓' },
  { type: 'zoom',       label: 'transition.zoom',       icon: '⊕' },
  { type: 'zoomOut',    label: 'transition.zoomOut',    icon: '⊖' },
  { type: 'blur',       label: 'transition.blur',       icon: '⬡' },
  { type: 'flip',       label: 'transition.flip',       icon: '⟳' },
];

export const DURATION_OPTIONS = [150, 250, 400, 600, 800];

// ─── Loop Defaults ────────────────────────────────────────────────────────────

export const LOOP_DEFAULT_DURATION = 5000;
