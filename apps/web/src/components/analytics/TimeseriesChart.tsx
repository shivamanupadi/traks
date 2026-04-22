import type { ReactElement } from 'react';
import { TrendingUp, AlertCircle } from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import type { TimeseriesPoint } from '@traks/shared';

interface TimeseriesChartProps {
  data: TimeseriesPoint[] | undefined;
  isLoading: boolean;
  isError?: boolean;
  metric?: 'visitors' | 'pageviews' | 'sessions';
}

/**
 * Bucket keys are pre-computed at ingest in the *site's* IANA timezone
 * (see packages/shared/src/queries.ts → computeBucketKeys). The chart must
 * therefore render them as local wall-clock values without any Date-parsing
 * translation, so an IST site's "11 AM bucket" shows as "11 AM" — not as
 * whatever the viewer's browser would convert UTC 11:00 to.
 *
 * Shapes produced by the server:
 *   - day   "YYYY-MM-DD"       (7d / 30d / 90d / 6m)
 *   - hour  "YYYY-MM-DDTHH"    (today)
 *   - week  "YYYY-Www"         (1y / all)
 */
type Granularity = 'hour' | 'week' | 'day';

function keyGranularity(key: string): Granularity {
  if (/^\d{4}-\d{2}-\d{2}T\d{2}$/.test(key)) return 'hour';
  if (/^\d{4}-W\d{2}$/.test(key)) return 'week';
  return 'day';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function hourLabel(hour: number): string {
  if (hour === 0) return '12 AM';
  if (hour === 12) return '12 PM';
  return hour < 12 ? `${hour} AM` : `${hour - 12} PM`;
}

function monthDayLabel(year: number, month: number, day: number): string {
  return `${MONTHS[month - 1]} ${day}`;
}

/**
 * Compute the Monday of a given ISO-8601 week number. Used purely for display,
 * so UTC arithmetic is fine — we only need the Y/M/D components out.
 */
function mondayOfIsoWeek(year: number, week: number): { year: number; month: number; day: number } {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - jan4Day + 1);
  const monday = new Date(week1Monday);
  monday.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7);
  return {
    year: monday.getUTCFullYear(),
    month: monday.getUTCMonth() + 1,
    day: monday.getUTCDate(),
  };
}

/** Short x-axis tick label. */
function formatAxis(key: string): string {
  switch (keyGranularity(key)) {
    case 'hour':
      return hourLabel(Number(key.slice(11, 13)));
    case 'week': {
      const [yearStr, weekStr] = key.split('-W');
      const { month, day } = mondayOfIsoWeek(Number(yearStr), Number(weekStr));
      return monthDayLabel(0, month, day);
    }
    case 'day':
    default:
      return monthDayLabel(
        Number(key.slice(0, 4)),
        Number(key.slice(5, 7)),
        Number(key.slice(8, 10))
      );
  }
}

/** Richer tooltip label. */
function formatTooltip(key: string): string {
  switch (keyGranularity(key)) {
    case 'hour': {
      const month = Number(key.slice(5, 7));
      const day = Number(key.slice(8, 10));
      return `${monthDayLabel(0, month, day)}, ${hourLabel(Number(key.slice(11, 13)))}`;
    }
    case 'week': {
      const [yearStr, weekStr] = key.split('-W');
      const m = mondayOfIsoWeek(Number(yearStr), Number(weekStr));
      return `Week of ${monthDayLabel(0, m.month, m.day)}`;
    }
    case 'day':
    default: {
      const year = Number(key.slice(0, 4));
      const month = Number(key.slice(5, 7));
      const day = Number(key.slice(8, 10));
      return `${monthDayLabel(0, month, day)}, ${year}`;
    }
  }
}

export function TimeseriesChart({
  data,
  isLoading,
  isError,
  metric = 'visitors',
}: TimeseriesChartProps): ReactElement {
  if (isError) {
    return (
      <div className="flex h-[300px] flex-col items-center justify-center rounded-2xl border border-[#e8e3ed]/80 bg-white">
        <AlertCircle className="w-5 h-5 text-[#e07a5f]/60 mb-2" strokeWidth={1.5} />
        <p className="text-[13px] text-[#e07a5f]">Failed to load chart data</p>
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="h-[300px] animate-pulse rounded-2xl border border-[#e8e3ed]/80 bg-white" />
    );
  }

  if (data.length === 0) {
    return (
      <div className="flex h-[300px] flex-col items-center justify-center rounded-2xl border border-[#e8e3ed]/80 bg-white">
        <TrendingUp className="w-5 h-5 text-[#B5B0AA] mb-2" strokeWidth={1.5} />
        <p className="text-[13px] font-medium text-[#9B9590]">No data yet</p>
        <p className="text-[12px] text-[#B5B0AA] mt-1">
          Embed the tracking script to start collecting data
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-[#e8e3ed]/80 bg-white p-5">
      <h3 className="mb-4 text-[15px] font-semibold text-[#2D3436]">
        {metric === 'visitors' ? 'Visitors' : metric === 'pageviews' ? 'Pageviews' : 'Sessions'}
      </h3>
      <ResponsiveContainer width="100%" height={260}>
        <AreaChart data={data}>
          <defs>
            <linearGradient id="colorMetric" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#9b72cf" stopOpacity={0.15} />
              <stop offset="95%" stopColor="#9b72cf" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#e8e3ed" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={formatAxis}
            stroke="#6b6560"
            fontSize={12}
            tickLine={false}
            axisLine={false}
          />
          <YAxis stroke="#6b6560" fontSize={12} tickLine={false} axisLine={false} width={40} />
          <Tooltip
            contentStyle={{
              backgroundColor: '#fff',
              border: '1px solid #e8e3ed',
              borderRadius: '8px',
              fontSize: '13px',
              boxShadow: '0 4px 8px rgba(0,0,0,0.06)',
            }}
            labelFormatter={formatTooltip}
          />
          <Area
            type="monotone"
            dataKey={metric}
            stroke="#9b72cf"
            strokeWidth={2}
            fillOpacity={1}
            fill="url(#colorMetric)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
