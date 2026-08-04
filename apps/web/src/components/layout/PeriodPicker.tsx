import type { ReactElement } from 'react';
import { cn } from '@/lib/utils';
import type { Period } from '@traks/shared';

interface PeriodPickerProps {
  value: Period;
  onChange: (period: Period) => void;
}

const PERIOD_OPTIONS: { label: string; value: Period }[] = [
  { label: 'Today', value: 'today' },
  { label: 'Yesterday', value: 'yesterday' },
  { label: '7D', value: '7d' },
  { label: '30D', value: '30d' },
  { label: '90D', value: '90d' },
  { label: '6M', value: '6m' },
  { label: '1Y', value: '1y' },
  { label: 'All', value: 'all' },
];

/** Floating pill segmented control; the active segment fills with ink. */
export function PeriodPicker({ value, onChange }: PeriodPickerProps): ReactElement {
  return (
    <div className="inline-flex rounded-full bg-white p-1 gap-0.5 shadow-pill">
      {PERIOD_OPTIONS.map(option => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'rounded-full px-3.5 py-1.5 text-[12px] font-medium transition-all cursor-pointer',
            value === option.value
              ? 'bg-[#3D3B4F] text-white font-semibold'
              : 'text-[#9B9590] hover:text-[#6b6560]'
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
