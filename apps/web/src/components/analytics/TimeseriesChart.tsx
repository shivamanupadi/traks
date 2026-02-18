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

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
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
        <p className="text-[12px] text-[#B5B0AA] mt-1">Embed the tracking script to start collecting data</p>
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
            tickFormatter={formatDate}
            stroke="#6b6560"
            fontSize={12}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            stroke="#6b6560"
            fontSize={12}
            tickLine={false}
            axisLine={false}
            width={40}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#fff',
              border: '1px solid #e8e3ed',
              borderRadius: '8px',
              fontSize: '13px',
              boxShadow: '0 4px 8px rgba(0,0,0,0.06)',
            }}
            labelFormatter={formatDate}
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
