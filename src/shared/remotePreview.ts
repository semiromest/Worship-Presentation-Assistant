export interface PreviewSlot { id: string; version: number }
export interface PreviewDeck { token: string; slots: PreviewSlot[] }
export interface PreviewDemand { revision: number; clients: number }
export interface PreviewAssetRequest extends PreviewSlot { token: string }
export interface PreviewAssetResult extends PreviewAssetRequest { dataUrl: string }
