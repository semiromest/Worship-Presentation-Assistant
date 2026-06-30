import type { CSSProperties } from 'react';
import { cn } from '../utils';

export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <div
      className={cn('animate-pulse rounded-lg bg-white/10', className)}
      style={style}
      aria-hidden="true"
    />
  );
}

export function SkeletonLine({ width }: { width?: string }) {
  return <Skeleton className={cn('h-3.5', !width && 'w-full')} style={width ? { width } : undefined} />;
}

export function SkeletonLines({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-2.5" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonLine key={i} width={`${70 + Math.random() * 30}%`} />
      ))}
    </div>
  );
}
