import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, Copy, Type } from 'lucide-react';
import type { VideoTextOverlay } from '../types';
import { TextStyleEditor } from './styleEditors/TextStyleEditor';

type GeometryKey = 'x' | 'y' | 'width' | 'height';

const MIN_SIZE = 4;
const GEOMETRY_FIELDS: ReadonlyArray<{ key: GeometryKey; label: string }> = [
  { key: 'x', label: 'common.videoTextX' },
  { key: 'y', label: 'common.videoTextY' },
  { key: 'width', label: 'common.videoTextWidth' },
  { key: 'height', label: 'common.videoTextHeight' },
];
const TIMING_FIELDS = [
  { id: 'from', label: 'common.videoTextShowAt' },
  { id: 'to', label: 'common.videoTextHideAt' },
] as const;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const minFor = (key: GeometryKey) => (key === 'width' || key === 'height' ? MIN_SIZE : 0);
const isValidTiming = (from: number, to: number, total: number) =>
  Number.isFinite(from) && Number.isFinite(to) && from >= 0 && from < to && to <= total;

/**
 * Number input that keeps a local text draft while focused, so the field can be
 * cleared and retyped ("1" → "10") without being clamped on every keystroke.
 * Valid values are still applied live; the draft is dropped on blur.
 */
function GeometryField({
  label,
  value,
  min,
  onValue,
  onDone,
}: {
  label: string;
  value: number;
  min: number;
  onValue: (value: number) => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <label className="ve-field">
      <span>{t(label)} (%)</span>
      <input
        type="number"
        min={min}
        max={100}
        step="1"
        value={draft ?? value}
        aria-label={t(label)}
        onChange={(event) => {
          const raw = event.target.value;
          setDraft(raw);
          const parsed = Number(raw);
          if (raw !== '' && Number.isFinite(parsed)) onValue(parsed);
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          event.currentTarget.blur();
        }}
        onBlur={() => {
          setDraft(null);
          onDone();
        }}
      />
    </label>
  );
}

export const VideoTextTools = memo(function VideoTextTools({
  overlays,
  selectedId,
  duration,
  onSelect,
  onAdd,
  onDuplicate,
  onRemove,
  onPatch,
  onGestureEnd,
  onValidityChange,
}: {
  overlays: VideoTextOverlay[];
  selectedId?: string;
  duration: number;
  onSelect: (id: string | undefined) => void;
  onAdd: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onPatch: (patch: Partial<VideoTextOverlay>, continuous?: boolean) => void;
  onGestureEnd: () => void;
  onValidityChange: (valid: boolean) => void;
}) {
  const { t } = useTranslation();
  const selected = overlays.find((item) => item.id === selectedId);
  const timed = selected?.startSeconds !== undefined || selected?.endSeconds !== undefined;
  const savedFrom = selected?.startSeconds ?? 0;
  const savedTo = selected?.endSeconds ?? duration;

  /* Timing drafts are keyed by the saved values. When the key changes (another layer is selected,
     the duration changes, a patch lands) the draft is derived fresh in the same render,
     so validity never flashes stale values from the previous layer. */
  const timingKey = `${selected?.id ?? ''}|${savedFrom}|${savedTo}|${duration}`;
  const [timing, setTiming] = useState({ key: timingKey, from: savedFrom, to: savedTo });
  const draft = timing.key === timingKey ? timing : { key: timingKey, from: savedFrom, to: savedTo };
  const { from, to } = draft;
  const invalid = !!selected && timed && duration > 0 && !isValidTiming(from, to, duration);

  /* Report validity through a ref so a changing callback identity never triggers
     a spurious `true` and the unmount cleanup runs exactly once. */
  const validityRef = useRef(onValidityChange);
  useLayoutEffect(() => {
    validityRef.current = onValidityChange;
  });
  useEffect(() => {
    validityRef.current(!invalid);
  }, [invalid]);
  useEffect(() => () => validityRef.current(true), []);

  const commitTiming = () => {
    if (!selected || invalid || !(duration > 0)) return;
    const unchanged =
      selected.startSeconds !== undefined &&
      selected.endSeconds !== undefined &&
      from === selected.startSeconds &&
      to === selected.endSeconds;
    if (!unchanged) onPatch({ startSeconds: from, endSeconds: to });
  };

  const onTimingKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    event.stopPropagation();
    commitTiming();
  };

  const patchGeometry = (key: GeometryKey, value: number) => {
    if (!selected) return;
    const next = { x: selected.x, y: selected.y, width: selected.width, height: selected.height };
    next[key] = clamp(value, minFor(key), 100);
    next.x = Math.min(next.x, 100 - next.width);
    next.y = Math.min(next.y, 100 - next.height);
    // Continuous: typing a value is a single undo step, closed on blur.
    onPatch(next, true);
  };

  const patchStyles = useCallback(
    (textStyles: VideoTextOverlay['textStyles']) => onPatch({ textStyles }),
    [onPatch]
  );

  return (
    <section className="ve-text-tools">
      <h4>
        <Type size={15} />
        {t('common.videoTextLayers')}
        <button
          type="button"
          className="ve-icon-button"
          onClick={onAdd}
          aria-label={t('common.videoAddText')}
          title={t('common.videoAddText')}
        >
          <Plus size={16} />
        </button>
      </h4>

      {overlays.length === 0 ? (
        <p className="ve-note">{t('common.videoTextHint')}</p>
      ) : (
        <div className="ve-layer-list">
          {overlays.map((item, index) => (
            <button
              type="button"
              key={item.id}
              onClick={() => onSelect(item.id)}
              aria-pressed={selectedId === item.id}
            >
              {index + 1}. {item.content || t('common.videoEmptyText')}
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div className="ve-text-properties">
          <label className="ve-field">
            <span>{t('common.videoTextContent')}</span>
            <textarea
              value={selected.content ?? ''}
              aria-label={t('common.videoTextContent')}
              rows={3}
              onChange={(event) => onPatch({ content: event.target.value }, true)}
              onBlur={onGestureEnd}
            />
          </label>

          <div className="ve-text-actions">
            <button type="button" onClick={onDuplicate}>
              <Copy size={13} />
              {t('common.videoDuplicateText')}
            </button>
            <button type="button" onClick={onRemove}>
              <Trash2 size={13} />
              {t('common.videoRemoveText')}
            </button>
          </div>

          <label className="ve-switch">
            <span>{t('common.videoTextEntireClip')}</span>
            <input
              type="checkbox"
              checked={!timed}
              disabled={!(duration > 0)}
              onChange={(event) =>
                onPatch(
                  event.target.checked
                    ? { startSeconds: undefined, endSeconds: undefined }
                    : { startSeconds: 0, endSeconds: duration }
                )
              }
            />
          </label>

          {timed && (
            <fieldset className="ve-text-timing" disabled={!(duration > 0)}>
              {TIMING_FIELDS.map((field) => (
                <label key={field.id} className="ve-field">
                  <span>{t(field.label)}</span>
                  <input
                    type="number"
                    aria-label={t(field.label)}
                    min="0"
                    max={duration || 1}
                    step="0.01"
                    value={Number.isFinite(draft[field.id]) ? draft[field.id] : ''}
                    onChange={(event) =>
                      setTiming({
                        ...draft,
                        [field.id]: event.target.value === '' ? NaN : Number(event.target.value),
                      })
                    }
                    onKeyDown={onTimingKeyDown}
                    onBlur={commitTiming}
                  />
                </label>
              ))}
              {invalid && (
                <p role="alert" className="ve-alert">
                  {t('common.videoInvalidRange')}
                </p>
              )}
            </fieldset>
          )}

          <details open>
            <summary>{t('common.videoTextAppearance')}</summary>
            <TextStyleEditor item={selected} onChange={patchStyles} />
          </details>

          <details>
            <summary>{t('common.videoTextPlacement')}</summary>
            <div className="ve-text-geometry">
              {GEOMETRY_FIELDS.map(({ key, label }) => (
                <GeometryField
                  key={key}
                  label={label}
                  value={selected[key]}
                  min={minFor(key)}
                  onValue={(value) => patchGeometry(key, value)}
                  onDone={onGestureEnd}
                />
              ))}
            </div>
          </details>
        </div>
      )}
    </section>
  );
});