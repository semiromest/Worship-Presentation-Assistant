import { Switch } from '@base-ui/react/switch';
import { cn } from '../utils';

interface SettingSwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  activeClassName?: string;
}

export default function SettingSwitch({
  checked,
  onCheckedChange,
  label,
  activeClassName = 'bg-emerald-500',
}: SettingSwitchProps) {
  return (
    <Switch.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      aria-label={label}
      nativeButton
      render={<button type="button" />}
      className={({ checked: isChecked }) => cn(
        'base-setting-switch relative inline-flex h-7 w-12 shrink-0 items-center rounded-full focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none',
        isChecked ? activeClassName : 'bg-white/15',
      )}
    >
      <Switch.Thumb className="base-setting-switch-thumb block h-5 w-5 rounded-full bg-white shadow" />
    </Switch.Root>
  );
}
