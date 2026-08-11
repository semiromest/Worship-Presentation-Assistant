interface ProgressBarProps {
  value: number;
  className?: string;
  ariaLabel?: string;
}

export default function ProgressBar({ value, className, ariaLabel }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-label={ariaLabel}
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={`w-full h-2 bg-white/10 rounded-full overflow-hidden ${className ?? ''}`}
    >
      <div
        className="h-full bg-blue-500 rounded-full transition-[width] duration-200 ease-out"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}