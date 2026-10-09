import { useEffect, useState } from 'react';

export function useImageSize(src?: string, retry = 0) {
  const [result, setResult] = useState<{ src?: string; width: number; height: number; error: boolean }>({
    width: 0,
    height: 0,
    error: false,
  });
  useEffect(() => {
    if (!src) return;
    setResult({ src, width: 0, height: 0, error: false });
    let alive = true;
    const image = new Image();
    image.onload = () => {
      if (alive) setResult({ src, width: image.naturalWidth, height: image.naturalHeight, error: false });
    };
    image.onerror = () => {
      if (alive) setResult({ src, width: 0, height: 0, error: true });
    };
    image.src = src;
    return () => {
      alive = false;
    };
  }, [src, retry]);
  return result.src === src ? result : { width: 0, height: 0, error: false };
}
