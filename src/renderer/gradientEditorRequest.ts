let requestedSlide: string | null = null;
export function requestGradientEditor(id: string) {
  requestedSlide = id;
}
export function consumeGradientEditorRequest(id: string) {
  if (requestedSlide !== id) return false;
  requestedSlide = null;
  return true;
}
