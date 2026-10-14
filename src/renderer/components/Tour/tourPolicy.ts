export type BlockReason = 'output-active' | 'session-active' | 'editor-active' | 'modal-open' | 'interaction-active' | 'not-ready';
export type TourConditions = { ready: boolean; output: boolean; session: boolean; editor: boolean; modal: boolean; interaction: boolean };
export function tourBlockReason(c: TourConditions): BlockReason | null {
  if (c.output) return 'output-active';
  if (c.session) return 'session-active';
  if (c.editor) return 'editor-active';
  if (c.modal) return 'modal-open';
  if (c.interaction) return 'interaction-active';
  return c.ready ? null : 'not-ready';
}
