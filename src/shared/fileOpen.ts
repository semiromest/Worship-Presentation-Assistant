export interface OpenFileConfirmation {
  title: string;
  message: string;
  detail: string;
  cancelLabel: string;
  openLabel: string;
}
export type PptxImportMode = 'new' | 'append';
export type PptxImportSource = string | { googleSlidesId: string; name: string } | { canvaId: string; name: string };
