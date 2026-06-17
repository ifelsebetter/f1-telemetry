import { useMemo, useId } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { useTheme } from '../hooks/useTheme';
import './TelemetryChart.css';

const MAX_CHART_POINTS = 500;

/**
 * Reusable telemetry chart component.
 *
 * @param {{ title: string, dataKey: string, color: string, unit: string, data: Array, id: string, isLive?: boolean }} props
 */
export default function TelemetryChart({ title, dataKey, color, unit, data, id, isLive = false }) {
  const { theme } = useTheme();

  // Unique gradient ID per component instance to avoid SVG ID collisions
  // Sanitise useId() colons to satisfy HTML/CSS specification compatibility
  const instanceId = useId();
  const gradientId = `gradient-${instanceId.replace(/:/g, '-')}`;

  // Memoise theme-derived chart colours
  const chartColors = useMemo(() => {
    const isDark = theme === 'dark';
    return {
      gridColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
      axisColor: isDark ? '#64748B' : '#94A3B8',
      tooltipBg: isDark ? '#1E293B' : '#FFFFFF',
      tooltipBorder: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
      tooltipTextColor: isDark ? '#F1F5F9' : '#0F172A',
    };
  }, [theme]);

  // Down-sample data for performance if over threshold
  const chartData = useMemo(() => {
    if (!Array.isArray(data) || data.length === 0) return [];
    if (data.length <= MAX_CHART_POINTS) return data;

    const step = Math.ceil(data.length / MAX_CHART_POINTS);
    const result = [];
    for (let i = 0; i < data.length; i += step) {
      result.push(data[i]);
    }
    return result;
  }, [data]);

  const isEmpty = chartData.length === 0;

  // Memoise tooltip style object to avoid recreating on each render
  const tooltipStyle = useMemo(() => ({
    background: chartColors.tooltipBg,
    border: `1px solid ${chartColors.tooltipBorder}`,
    borderRadius: '8px',
    fontSize: '13px',
    fontFamily: "'JetBrains Mono', monospace",
    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
    color: chartColors.tooltipTextColor,
  }), [chartColors]);

  return (
    <div className="telemetry-chart card" id={id}>
      <div className="telemetry-chart__header">
        <h3 className="telemetry-chart__title">{title}</h3>
        <span className="telemetry-chart__unit font-mono">{unit}</span>
      </div>

      <div className="telemetry-chart__body">
        {isEmpty ? (
          <div className="telemetry-chart__empty">
            <p>No data available</p>
            <span>Select a session to view telemetry</span>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={color} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke={chartColors.gridColor}
                vertical={false}
              />
              <XAxis
                dataKey="timestamp"
                tick={{ fontSize: 11, fill: chartColors.axisColor }}
                axisLine={{ stroke: chartColors.gridColor }}
                tickLine={false}
                tickFormatter={formatTimestamp}
              />
              <YAxis
                tick={{ fontSize: 11, fill: chartColors.axisColor, fontFamily: "'JetBrains Mono', monospace" }}
                axisLine={false}
                tickLine={false}
                width={50}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                labelFormatter={formatTooltipLabel}
                formatter={formatTooltipValue}
              />
              <Area
                type="monotone"
                dataKey={dataKey}
                stroke={color}
                strokeWidth={2}
                fill={`url(#${gradientId})`}
                dot={false}
                animationDuration={300}
                isAnimationActive={!isLive && chartData.length < 200}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

// Stable formatter references to avoid prop identity changes
function formatTimestamp(v) {
  return `${Number(v).toFixed(0)}s`;
}

// Format the label (X axis value / timestamp) in tooltip
function formatTooltipLabel(v) {
  return `Time: ${Number(v).toFixed(1)}s`;
}

// Format the value of tooltip item
function formatTooltipValue(value) {
  return [Number(value).toFixed(1)];
}
