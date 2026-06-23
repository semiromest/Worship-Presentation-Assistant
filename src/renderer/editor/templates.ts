import type { SlideItem } from '../types';
import { normalizeItem } from './editorUtils';

export interface SlideTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  createItems: () => SlideItem[];
}

let tplCounter = 0;

function tplId(): string {
  return `tpl-${++tplCounter}-${Math.random().toString(36).slice(2, 6)}`;
}

const templates: SlideTemplate[] = [
  {
    id: 'title-only',
    name: 'Sadece Başlık',
    description: 'Büyük ve ortalanmış başlık',
    icon: 'T',
    createItems: () => [
      normalizeItem({
        id: tplId(),
        type: 'text',
        content: 'Başlık',
        x: 10, y: 30, width: 80, height: 25,
        zIndex: 0, visible: true, locked: false, rotation: 0,
        textStyles: {
          fontSize: 72, textColor: '#ffffff', textAlign: 'center',
          fontWeight: 'bold', fontStyle: 'normal',
          lineHeight: 1.2, letterSpacing: 2, textDecoration: '',
        },
        imageStyles: {
          objectFit: 'contain', opacity: 1, brightness: 1,
          contrast: 1, grayscale: 0, sepia: 0, blur: 0,
        },
        styles: undefined,
      }),
    ],
  },
  {
    id: 'title-content',
    name: 'Başlık + İçerik',
    description: 'Üstte başlık, altta içerik metni',
    icon: '¶',
    createItems: () => [
      normalizeItem({
        id: tplId(),
        type: 'text',
        content: 'Başlık',
        x: 10, y: 8, width: 80, height: 20,
        zIndex: 0, visible: true, locked: false, rotation: 0,
        textStyles: {
          fontSize: 56, textColor: '#ffffff', textAlign: 'center',
          fontWeight: 'bold', fontStyle: 'normal',
          lineHeight: 1.2, letterSpacing: 1, textDecoration: '',
        },
        imageStyles: {
          objectFit: 'contain', opacity: 1, brightness: 1,
          contrast: 1, grayscale: 0, sepia: 0, blur: 0,
        },
        styles: undefined,
      }),
      normalizeItem({
        id: tplId(),
        type: 'text',
        content: 'İçerik metnini buraya yazın...',
        x: 10, y: 38, width: 80, height: 40,
        zIndex: 1, visible: true, locked: false, rotation: 0,
        textStyles: {
          fontSize: 36, textColor: '#cccccc', textAlign: 'center',
          fontWeight: 'normal', fontStyle: 'normal',
          lineHeight: 1.5, letterSpacing: 0, textDecoration: '',
        },
        imageStyles: {
          objectFit: 'contain', opacity: 1, brightness: 1,
          contrast: 1, grayscale: 0, sepia: 0, blur: 0,
        },
        styles: undefined,
      }),
    ],
  },
  {
    id: 'two-column',
    name: 'İki Sütun',
    description: 'Sol ve sağ olmak üzere iki içerik alanı',
    icon: '‖',
    createItems: () => [
      normalizeItem({
        id: tplId(),
        type: 'text',
        content: 'Başlık',
        x: 10, y: 5, width: 80, height: 15,
        zIndex: 0, visible: true, locked: false, rotation: 0,
        textStyles: {
          fontSize: 48, textColor: '#ffffff', textAlign: 'center',
          fontWeight: 'bold', fontStyle: 'normal',
          lineHeight: 1.2, letterSpacing: 1, textDecoration: '',
        },
        imageStyles: {
          objectFit: 'contain', opacity: 1, brightness: 1,
          contrast: 1, grayscale: 0, sepia: 0, blur: 0,
        },
        styles: undefined,
      }),
      normalizeItem({
        id: tplId(),
        type: 'text',
        content: 'Sol sütun içeriği',
        x: 5, y: 30, width: 42, height: 55,
        zIndex: 1, visible: true, locked: false, rotation: 0,
        textStyles: {
          fontSize: 28, textColor: '#cccccc', textAlign: 'left',
          fontWeight: 'normal', fontStyle: 'normal',
          lineHeight: 1.4, letterSpacing: 0, textDecoration: '',
        },
        imageStyles: {
          objectFit: 'contain', opacity: 1, brightness: 1,
          contrast: 1, grayscale: 0, sepia: 0, blur: 0,
        },
        styles: undefined,
      }),
      normalizeItem({
        id: tplId(),
        type: 'text',
        content: 'Sağ sütun içeriği',
        x: 53, y: 30, width: 42, height: 55,
        zIndex: 2, visible: true, locked: false, rotation: 0,
        textStyles: {
          fontSize: 28, textColor: '#cccccc', textAlign: 'left',
          fontWeight: 'normal', fontStyle: 'normal',
          lineHeight: 1.4, letterSpacing: 0, textDecoration: '',
        },
        imageStyles: {
          objectFit: 'contain', opacity: 1, brightness: 1,
          contrast: 1, grayscale: 0, sepia: 0, blur: 0,
        },
        styles: undefined,
      }),
    ],
  },
  {
    id: 'image-text',
    name: 'Resim + Metin',
    description: 'Sağda resim, solda metin',
    icon: '▣',
    createItems: () => [
      normalizeItem({
        id: tplId(),
        type: 'text',
        content: 'Başlık metni',
        x: 5, y: 10, width: 50, height: 70,
        zIndex: 0, visible: true, locked: false, rotation: 0,
        textStyles: {
          fontSize: 32, textColor: '#ffffff', textAlign: 'left',
          fontWeight: 'bold', fontStyle: 'normal',
          lineHeight: 1.4, letterSpacing: 0, textDecoration: '',
        },
        imageStyles: {
          objectFit: 'contain', opacity: 1, brightness: 1,
          contrast: 1, grayscale: 0, sepia: 0, blur: 0,
        },
        styles: undefined,
      }),
      normalizeItem({
        id: tplId(),
        type: 'image',
        x: 55, y: 10, width: 40, height: 70,
        zIndex: 1, visible: true, locked: false, rotation: 0,
        imageStyles: {
          objectFit: 'cover', opacity: 1, brightness: 1,
          contrast: 1, grayscale: 0, sepia: 0, blur: 0,
        },
        styles: undefined,
      }),
    ],
  },
  {
    id: 'image-full',
    name: 'Tam Ekran Resim',
    description: 'Tam arka plan görseli',
    icon: '⊞',
    createItems: () => [
      normalizeItem({
        id: tplId(),
        type: 'image',
        x: 0, y: 0, width: 100, height: 100,
        zIndex: 0, visible: true, locked: false, rotation: 0,
        imageStyles: {
          objectFit: 'cover', opacity: 1, brightness: 0.6,
          contrast: 1, grayscale: 0, sepia: 0, blur: 0,
        },
        styles: undefined,
      }),
      normalizeItem({
        id: tplId(),
        type: 'text',
        content: 'Resim üstü metin',
        x: 10, y: 35, width: 80, height: 30,
        zIndex: 1, visible: true, locked: false, rotation: 0,
        textStyles: {
          fontSize: 56, textColor: '#ffffff', textAlign: 'center',
          fontWeight: 'bold', fontStyle: 'normal',
          lineHeight: 1.2, letterSpacing: 1, textDecoration: '',
          textShadow: { color: '#000000', blur: 8, offsetX: 2, offsetY: 2 },
        },
        imageStyles: {
          objectFit: 'contain', opacity: 1, brightness: 1,
          contrast: 1, grayscale: 0, sepia: 0, blur: 0,
        },
        styles: undefined,
      }),
    ],
  },
  {
    id: 'list',
    name: 'Liste',
    description: 'Maddeler halinde içerik',
    icon: '☰',
    createItems: () => [
      normalizeItem({
        id: tplId(),
        type: 'text',
        content: 'Ana Başlık',
        x: 10, y: 5, width: 80, height: 15,
        zIndex: 0, visible: true, locked: false, rotation: 0,
        textStyles: {
          fontSize: 44, textColor: '#ffffff', textAlign: 'left',
          fontWeight: 'bold', fontStyle: 'normal',
          lineHeight: 1.2, letterSpacing: 0, textDecoration: '',
        },
        imageStyles: {
          objectFit: 'contain', opacity: 1, brightness: 1,
          contrast: 1, grayscale: 0, sepia: 0, blur: 0,
        },
        styles: undefined,
      }),
      normalizeItem({
        id: tplId(),
        type: 'text',
        content: '• Birinci madde\n• İkinci madde\n• Üçüncü madde\n• Dördüncü madde',
        x: 10, y: 28, width: 80, height: 55,
        zIndex: 1, visible: true, locked: false, rotation: 0,
        textStyles: {
          fontSize: 30, textColor: '#cccccc', textAlign: 'left',
          fontWeight: 'normal', fontStyle: 'normal',
          lineHeight: 1.6, letterSpacing: 0, textDecoration: '',
        },
        imageStyles: {
          objectFit: 'contain', opacity: 1, brightness: 1,
          contrast: 1, grayscale: 0, sepia: 0, blur: 0,
        },
        styles: undefined,
      }),
    ],
  },
];

export function getTemplates(): SlideTemplate[] {
  return templates;
}

export function applyTemplate(templateId: string): SlideItem[] {
  const tpl = templates.find(t => t.id === templateId);
  if (!tpl) return [];
  return tpl.createItems();
}
