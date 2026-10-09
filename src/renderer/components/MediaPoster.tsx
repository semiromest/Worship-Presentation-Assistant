import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Video } from 'lucide-react';
import { extractVideoFrameDataUrl } from './videoFrame';
import { createPosterQueue } from './mediaPosterQueue';

const THUMBNAIL_SIZE = 400;
const VALIDATE_TIMEOUT_MS = 5000;
/** Posters start loading slightly before they scroll into view. */
const VISIBILITY_MARGIN = '150px';
/** file:, local-resource: URLs and bare Windows paths are served by the main process thumbnailer. */
const LOCAL_SOURCE = /^(?:file:|local-resource:|[A-Za-z]:[\\/])/;

/* -------------------------------------------------------------------------- */
/* Shared visibility observer (one IntersectionObserver for every poster)      */
/* -------------------------------------------------------------------------- */

const visibilityCallbacks = new WeakMap<Element, (visible: boolean) => void>();
let sharedObserver: IntersectionObserver | undefined;

function observeVisibility(element: Element, callback: (visible: boolean) => void): () => void {
  if (typeof IntersectionObserver === 'undefined') {
    callback(true); // no observer available (tests, very old shells): never block loading
    return () => {};
  }
  if (!sharedObserver) {
    sharedObserver = new IntersectionObserver(
      (entries) => {
        // A batch may hold several entries for the same element; the last one is its current state.
        const latest = new Map<Element, boolean>();
        for (const entry of entries) latest.set(entry.target, entry.isIntersecting);
        latest.forEach((visible, target) => visibilityCallbacks.get(target)?.(visible));
      },
      { rootMargin: VISIBILITY_MARGIN }
    );
  }
  visibilityCallbacks.set(element, callback);
  sharedObserver.observe(element);
  return () => {
    visibilityCallbacks.delete(element);
    sharedObserver?.unobserve(element);
  };
}

/* -------------------------------------------------------------------------- */
/* Poster generation                                                           */
/* -------------------------------------------------------------------------- */

/** Resolves true if the browser can decode the image; settles exactly once and cancels a stalled load. */
function validImage(source: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const image = new Image();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (ok: boolean) => {
      clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      if (!ok) image.src = ''; // stop a load that timed out or failed
      resolve(ok);
    };
    timer = setTimeout(() => finish(false), VALIDATE_TIMEOUT_MS);
    image.onload = () => finish(true);
    image.onerror = () => finish(false);
    image.src = source;
  });
}

const posters = createPosterQueue(async (source, eligible) => {
  if (LOCAL_SOURCE.test(source)) {
    try {
      const result = await window.electronAPI?.getMediaThumbnail?.(source, THUMBNAIL_SIZE);
      if (result && (await validImage(result))) return result;
    } catch {
      /* Fall back to the renderer's decoder. */
    }
  }
  if (!eligible()) return null;
  return extractVideoFrameDataUrl(source);
});

/* -------------------------------------------------------------------------- */
/* Component                                                                   */
/* -------------------------------------------------------------------------- */

/** Static media preview. Visibility gates extraction; source changes discard stale responses. */
export function MediaPoster({
  mediaUrl,
  thumbnailUrl,
  objectFit,
  enabled = true,
}: {
  mediaUrl?: string;
  thumbnailUrl?: string;
  objectFit?: string;
  enabled?: boolean;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ source: string; url: string | null } | null>(null);
  const [broken, setBroken] = useState<string | null>(null);

  // Read by the queue (possibly long after this render), so it is kept in a ref. Layout effect: it is
  // updated before the request effect below runs in the same commit.
  const eligibility = useRef(false);
  useLayoutEffect(() => {
    eligibility.current = enabled && visible;
  }, [enabled, visible]);

  useEffect(() => {
    const element = ref.current;
    return element ? observeVisibility(element, setVisible) : undefined;
  }, []);

  const supplied = thumbnailUrl && broken !== thumbnailUrl ? thumbnailUrl : undefined;
  // `undefined` = nothing generated yet for this source, `null` = generation failed.
  const generated = result && result.source === mediaUrl ? result.url : undefined;
  const url = supplied || generated;
  const failed = !supplied && (generated === null || !mediaUrl);
  // Once a poster exists (or failed), toggling visibility must not trigger another request.
  const needsPoster = !supplied && !!mediaUrl && enabled && visible && generated === undefined;

  useEffect(() => {
    if (!needsPoster || !mediaUrl) return;
    let cancelled = false;
    posters
      .request(mediaUrl, () => eligibility.current && !cancelled)
      .catch(() => null) // a rejected request must end in the failed state, not hang on "loading"
      .then((generatedUrl) => {
        if (!cancelled) setResult({ source: mediaUrl, url: generatedUrl });
      });
    return () => {
      cancelled = true;
    };
  }, [needsPoster, mediaUrl, revision]);

  return (
    <div ref={ref} className="relative flex h-full w-full items-center justify-center overflow-hidden bg-black">
      {url ? (
        <img
          src={url}
          alt={t('common.slideVideo')}
          // Generated posters are data URLs and already gated by visibility; lazy loading only helps supplied ones.
          loading={supplied ? 'lazy' : undefined}
          decoding="async"
          className={`h-full w-full ${objectFit === 'cover' ? 'object-cover' : 'object-contain'}`}
          onError={() => {
            if (supplied) {
              setBroken(supplied);
            } else {
              if (mediaUrl) posters.invalidate(mediaUrl);
              setResult({ source: mediaUrl ?? '', url: null });
            }
          }}
        />
      ) : (
        <div className="flex flex-col items-center gap-1 px-2 text-center text-white/60">
          <Video className="h-5 w-5" aria-hidden="true" />
          <span className="text-[9px]">{t(failed ? 'common.editorPreviewFailed' : 'common.editorPreviewLoading')}</span>
          {failed && mediaUrl && (
            <button
              type="button"
              className="rounded bg-white/10 px-2 py-1 text-[9px] hover:bg-white/20"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                posters.invalidate(mediaUrl);
                setResult(null);
                setRevision((value) => value + 1);
              }}
            >
              {t('common.editorPreviewRetry')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}