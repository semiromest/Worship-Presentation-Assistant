/**
 * Shared thumbnail constants used by both the renderer (browser canvas)
 * and the heavy worker (node-canvas via @napi-rs/canvas).
 */

export const THUMB_W = 320;
export const THUMB_H = 180;
export const PLACEHOLDER_BG = '#1a1a2e';
export const EMPTY_BG = '#111111';

/**
 * Minimal slide data needed for thumbnail rendering.
 * Stripped of large fields — just enough to paint a preview.
 */
export interface ThumbSlideData {
  id: string;
  type: string;
  content: string;
  mediaUrl?: string;
  thumbnailUrl?: string;
  styles?: Record<string, any>;
  items?: Array<{
    type: string;
    x: number;
    y: number;
    width: number;
    height: number;
    rotation?: number;
    zIndex?: number;
    borderWidth?: number;
    borderColor?: string;
    borderRadius?: number;
    content?: string;
    mediaUrl?: string;
    mediaData?: string; // base64 data URI for worker
    textStyles?: Record<string, any>;
    imageStyles?: Record<string, any>;
  }>;
  loopItems?: Array<{
    type: string;
    mediaUrl?: string;
    mediaData?: string;
  }>;
  partsMode?: boolean;
  parts?: string[];
  activePart?: number;
  group?: { title?: string };
}
