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
  ReferenceDot,
} from 'recharts';
import type { TimeseriesPoint } from '@traks/shared';

interface TimeseriesChartProps {
  data: TimeseriesPoint[] | undefined;
  isLoading: boolean;
  isError?: boolean;
  metric?: 'visitors' | 'pageviews' | 'sessions';
  /** Render only the chart (no card frame / title) for embedding in a parent card. */
  bare?: boolean;
  /** Line color; defaults to the metric's stroke. */
  color?: string;
}

/* All metrics share the same treatment: ink stroke over a whisper of fill —
 * the metric rail above carries the "which metric" signal. */
const STROKE = '#3D3B4F';
const WASH = '#3D3B4F';

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
  bare = false,
  color,
}: TimeseriesChartProps): ReactElement {
  const stroke = color ?? STROKE;
  const fill = color ?? WASH;
  const frame = bare ? '' : 'rounded-[20px] bg-white shadow-float';

  if (isError) {
    return (
      <div className={`flex h-[300px] flex-col items-center justify-center ${frame}`}>
        <AlertCircle className="w-5 h-5 text-[#e07a5f]/60 mb-2" strokeWidth={1.5} />
        <p className="text-[13px] text-[#e07a5f]">Failed to load chart data</p>
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className={`h-[300px] p-5 ${frame}`}>
        {!bare && <div className="h-4 w-24 rounded bg-muted animate-pulse" />}
        <div className="mt-5 flex h-[210px] items-end gap-2">
          {[40, 65, 50, 80, 55, 90, 70, 60, 85, 45, 75, 95].map((h, i) => (
            <div
              key={i}
              className="flex-1 rounded-t bg-muted animate-pulse"
              style={{ height: `${h}%` }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className={`flex h-[300px] flex-col items-center justify-center ${frame}`}>
        <TrendingUp className="w-5 h-5 text-[#B5B0AA] mb-2" strokeWidth={1.5} />
        <p className="text-[13px] font-medium text-[#9B9590]">No data yet</p>
        <p className="text-[12px] text-[#B5B0AA] mt-1">
          Embed the tracking script to start collecting data
        </p>
      </div>
    );
  }

  const gradientId = `colorMetric-${metric}`;
  const last = data[data.length - 1];

  const chart = (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={fill} stopOpacity={0.09} />
            <stop offset="100%" stopColor={fill} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#F1EFEA" vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={formatAxis}
          stroke="#B5B0AA"
          fontSize={11.5}
          tickLine={false}
          axisLine={false}
        />
        <YAxis stroke="#B5B0AA" fontSize={11.5} tickLine={false} axisLine={false} width={40} />
        <Tooltip
          contentStyle={{
            backgroundColor: '#3D3B4F',
            border: 'none',
            borderRadius: '10px',
            fontSize: '12px',
            color: '#F9F8F6',
            boxShadow: '0 8px 20px rgba(61,59,79,0.25)',
          }}
          labelStyle={{ color: '#C9C3BC', marginBottom: 2 }}
          itemStyle={{ color: '#F9F8F6', fontWeight: 700 }}
          cursor={{ stroke: '#3D3B4F', strokeOpacity: 0.35, strokeDasharray: '3 3' }}
          labelFormatter={formatTooltip}
        />
        <Area
          type="monotone"
          dataKey={metric}
          stroke={stroke}
          strokeWidth={2}
          fillOpacity={1}
          fill={`url(#${gradientId})`}
          activeDot={{ r: 4.5, strokeWidth: 2, stroke: '#fff' }}
        />
        {/* Always-visible endpoint dot anchoring "now" */}
        <ReferenceDot
          x={last.date}
          y={last[metric]}
          r={4}
          fill={stroke}
          stroke="#fff"
          strokeWidth={2}
          isFront
        />
      </AreaChart>
    </ResponsiveContainer>
  );

  if (bare) return chart;

  return (
    <div className="rounded-[20px] bg-white p-6 shadow-float">
      <h3 className="mb-4 text-[15px] font-bold tracking-[-0.01em] text-[#3D3B4F]">
        {metric === 'visitors' ? 'Visitors' : metric === 'pageviews' ? 'Pageviews' : 'Sessions'}
      </h3>
      {chart}
    </div>
  );
}
