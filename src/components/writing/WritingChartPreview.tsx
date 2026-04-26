import React from 'react';
import type { WritingChartData } from '../../types';

type WritingChartPreviewProps = {
  chart?: WritingChartData | undefined;
  variant?: 'builder' | 'student';
};

const CHART_HEIGHT = 176;
const BAR_MAX_HEIGHT = 144;
const COLORS = ['#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6'];

const getFiniteValues = (values: number[]) =>
  values.map((value) => (Number.isFinite(value) ? Math.max(0, value) : 0));

const getScale = (values: number[]) => Math.max(...values, 1);

const getLabel = (chart: WritingChartData, index: number) => chart.labels[index] || `Item ${index + 1}`;

const describePoint = (chart: WritingChartData, value: number, index: number) =>
  `${getLabel(chart, index)}: ${value}`;

export function WritingChartPreview({ chart, variant = 'builder' }: WritingChartPreviewProps) {
  if (!chart) {
    return null;
  }

  const values = getFiniteValues(chart.values);
  const scale = getScale(values);
  const shellClass =
    variant === 'builder'
      ? 'rounded-[28px] border border-gray-200 bg-white p-4 shadow-sm'
      : 'rounded-2xl border border-gray-200 bg-gray-50 p-4';
  const titleClass =
    variant === 'builder'
      ? 'text-xs font-black text-gray-400 uppercase tracking-[0.22em] mb-4'
      : 'text-[length:var(--student-meta-font-size)] font-black text-gray-400 uppercase tracking-[0.22em] mb-3';
  const labelClass =
    variant === 'builder'
      ? 'text-[11px] font-semibold text-gray-500 mt-2 truncate'
      : 'text-[length:var(--student-meta-font-size)] font-semibold text-gray-500 mt-2 truncate';

  if (chart.type === 'table') {
    return (
      <div className={shellClass} data-writing-chart-type="table">
        <p className={titleClass}>{chart.title}</p>
        <div className="max-h-72 overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-400 uppercase text-[10px] tracking-[0.2em]">
                <th className="pb-2">Label</th>
                <th className="pb-2">Value</th>
              </tr>
            </thead>
            <tbody>
              {values.map((value, index) => (
                <tr key={`${getLabel(chart, index)}-${index}`} className="border-t border-gray-100">
                  <td className="py-2 pr-3">{getLabel(chart, index)}</td>
                  <td className="py-2 font-semibold">{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (chart.type === 'pie') {
    const total = values.reduce((sum, value) => sum + value, 0);
    let cumulative = 0;
    const gradient =
      total > 0
        ? values
            .map((value, index) => {
              const start = (cumulative / total) * 100;
              cumulative += value;
              const end = (cumulative / total) * 100;
              return `${COLORS[index % COLORS.length]} ${start}% ${end}%`;
            })
            .join(', ')
        : '#e5e7eb 0% 100%';

    return (
      <div className={shellClass} data-writing-chart-type="pie">
        <p className={titleClass}>{chart.title}</p>
        <div className="grid gap-4 sm:grid-cols-[minmax(8rem,12rem)_minmax(0,1fr)] items-center">
          <div
            className="mx-auto aspect-square w-full max-w-44 rounded-full border border-gray-200 shadow-inner"
            role="img"
            aria-label={`${chart.title} pie chart`}
            style={{ background: `conic-gradient(${gradient})` }}
          />
          <div className="space-y-2 min-w-0">
            {values.map((value, index) => {
              const percent = total > 0 ? Math.round((value / total) * 100) : 0;
              return (
                <div key={`${getLabel(chart, index)}-${index}`} className="flex items-center gap-2 text-sm text-gray-600">
                  <span className="h-3 w-3 rounded-sm flex-shrink-0" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
                  <span className="min-w-0 flex-1 truncate">{getLabel(chart, index)}</span>
                  <span className="font-bold text-gray-900">{percent}%</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  if (chart.type === 'line') {
    const width = 320;
    const padding = 18;
    const usableWidth = width - padding * 2;
    const usableHeight = CHART_HEIGHT - padding * 2;
    const points = values.map((value, index) => {
      const x = values.length <= 1 ? width / 2 : padding + (index / (values.length - 1)) * usableWidth;
      const y = padding + usableHeight - (value / scale) * usableHeight;
      return { x, y, value };
    });
    const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');

    return (
      <div className={shellClass} data-writing-chart-type="line">
        <p className={titleClass}>{chart.title}</p>
        <svg className="h-44 w-full overflow-visible" viewBox={`0 0 ${width} ${CHART_HEIGHT}`} role="img" aria-label={`${chart.title} line chart`} preserveAspectRatio="none">
          <line x1={padding} y1={CHART_HEIGHT - padding} x2={width - padding} y2={CHART_HEIGHT - padding} stroke="#d1d5db" strokeWidth="1" />
          <line x1={padding} y1={padding} x2={padding} y2={CHART_HEIGHT - padding} stroke="#d1d5db" strokeWidth="1" />
          <path d={path} fill="none" stroke="#2563eb" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          {points.map((point, index) => (
            <circle key={`${getLabel(chart, index)}-${index}`} cx={point.x} cy={point.y} r="4" fill="#2563eb">
              <title>{describePoint(chart, point.value, index)}</title>
            </circle>
          ))}
        </svg>
        <div className="grid gap-2 mt-2" style={{ gridTemplateColumns: `repeat(${Math.max(values.length, 1)}, minmax(0, 1fr))` }}>
          {values.map((value, index) => (
            <div key={`${getLabel(chart, index)}-${index}`} className="min-w-0 text-center">
              <p className={labelClass}>{getLabel(chart, index)}</p>
              <p className="text-sm font-black text-gray-900">{value}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={shellClass} data-writing-chart-type="bar">
      <p className={titleClass}>{chart.title}</p>
      <div className="flex h-44 items-end gap-3 overflow-hidden">
        {values.map((value, index) => (
          <div key={`${getLabel(chart, index)}-${index}`} className="min-w-0 flex-1 text-center">
            <div
              className="mx-auto w-full max-w-14 rounded-t-2xl bg-blue-500"
              style={{ height: `${Math.max(12, (value / scale) * BAR_MAX_HEIGHT)}px` }}
              role="img"
              aria-label={describePoint(chart, value, index)}
            />
            <p className={labelClass}>{getLabel(chart, index)}</p>
            <p className="text-sm font-black text-gray-900">{value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
