// ─── Transition Types ─────────────────────────────────────────────────────────

export type TransitionType =
  | 'none'
  | 'fade'
  | 'slideLeft'
  | 'slideRight'
  | 'slideUp'
  | 'slideDown'
  | 'zoom'
  | 'zoomOut'
  | 'blur'
  | 'flip';

// ─── Text Effects ─────────────────────────────────────────────────────────

export interface TextStyle {
  textDecoration: string;
  textTransform?: 'none' | 'uppercase' | 'lowercase';
  fontSize?: number;
  textColor?: string;
  backgroundColor?: string;
  objectFit?: 'cover' | 'contain';
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  fontWeight?: 'normal' | 'bold';
  fontStyle?: 'normal' | 'italic';
  verticalAlign?: 'top' | 'center' | 'bottom';
  fontFamily?: string;
  lineHeight?: number;
  letterSpacing?: number;
  textShadow?: {
    color?: string;
    blur?: number;
    offsetX?: number;
    offsetY?: number;
  };
  textStroke?: {
    color: string;
    width: number;
  };
}

export interface ImageStyle {
  objectFit?: 'cover' | 'contain' | 'fill';
  opacity?: number;
  blur?: number;
  brightness?: number;
  contrast?: number;
  grayscale?: number;
  sepia?: number;
  hueRotate?: number;
  dropShadow?: {
    color?: string;
    blur?: number;
    offsetX?: number;
    offsetY?: number;
  };
  flipX?: boolean;
  flipY?: boolean;
  crop?: { x: number; y: number; width: number; height: number };
}

export interface GradientStyle {
  type: 'linear' | 'radial';
  angle?: number;
  stops?: Array<{ color: string; position: number }>;
}

// ─── Loop Types ────────────────────────────────────────────────────────────────

export interface LoopItem {
  id: string;
  type: 'image' | 'video';
  mediaUrl: string;
  duration: number;
  fileName?: string;
}

export type MediaKind = 'image' | 'video';

export interface MediaItem {
  id: string;
  type: MediaKind;
  path: string;
  name: string;
  preview?: string;
}

// ─── Slide Types ──────────────────────────────────────────────────────────────

export interface SlideItem {
  styles: any;
  id: string;
  type: 'text' | 'image' | 'group' | 'shape';
  content?: string;
  mediaUrl?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  zIndex: number;
  locked?: boolean;
  visible?: boolean;
  textStyles?: TextStyle;
  imageStyles?: ImageStyle;
  gradient?: GradientStyle;
  borderWidth?: number;
  borderColor?: string;
  borderRadius?: number;
  groupItems?: SlideItem[];
  animation?: {
    type?: 'fade' | 'slide' | 'zoom' | 'bounce' | 'shake';
    duration?: number;
    delay?: number;
  };
}

export interface Slide {
  id: string;
  type: 'text' | 'image' | 'video' | 'countdown' | 'screen' | 'loop';
  content: string;
  loopTransition?: { type: TransitionType; duration: number };
  partsMode?: boolean;
  parts?: string[];
  activePart?: number;
  mediaUrl?: string;
  thumbnailUrl?: string;
  items?: SlideItem[];
  loopItems?: LoopItem[];
  group?: { id: string; title: string; part: number; parts: number; color?: string };
  gridEnabled?: boolean;
  gridSize?: number;
  gridColor?: string;
  snapEnabled?: boolean;
  styles?: {
    fontSize: number;
    textTransform?: 'none' | 'uppercase' | 'lowercase';
    backgroundColor: string;
    textColor: string;
    textAlign?: string;
    verticalAlign?: string;
    fontWeight?: string;
    fontStyle?: string;
    lineHeight?: number;
    letterSpacing?: number;
    textDecoration?: string;
    backgroundImage?: string;
    backgroundVideo?: string;
    backgroundGradient?: GradientStyle;
    backgroundBlur?: number;
    objectFit?: 'cover' | 'contain' | 'fill';
    fontFamily?: string;
    opacity?: number;
    imageBrightness?: number;
    imageContrast?: number;
    imageBlur?: number;
    imageGrayscale?: number;
    imageSepia?: number;
    imageFlipX?: boolean;
    imageFlipY?: boolean;
  };
}

export interface Presentation {
  name: string;
  slides: Slide[];
  transition?: {
    type: TransitionType;
    duration: number;
  };
}

export interface Preset {
  name: string;
  presentation: Presentation;
  createdAt: number;
}
