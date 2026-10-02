'use client';

import { LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import { type ECharts, init, use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { useEffect, useRef } from 'react';

use([LineChart, GridComponent, TooltipComponent, CanvasRenderer]);

interface Props {
  /** [seconds, value] points. */
  points: Array<[number, number]>;
  format: (v: number) => string;
  label: string;
}

const LINE = '#7c8cff';

/**
 * One-series sparkline with a hover crosshair. Single series, so no legend:
 * the tile's title names it. Color is identity, not status.
 */
export function Sparkline({ points, format, label }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<ECharts | undefined>(undefined);

  useEffect(() => {
    if (!ref.current) return;
    const c = init(ref.current, undefined, { renderer: 'canvas' });
    chart.current = c;
    const observer = new ResizeObserver(() => c.resize());
    observer.observe(ref.current);
    return () => {
      observer.disconnect();
      c.dispose();
    };
  }, []);

  useEffect(() => {
    chart.current?.setOption(
      {
        animation: false,
        grid: { left: 4, right: 4, top: 6, bottom: 4 },
        xAxis: { type: 'value', show: false, min: 'dataMin', max: 'dataMax' },
        yAxis: { type: 'value', show: false, min: 0 },
        tooltip: {
          trigger: 'axis',
          backgroundColor: '#12161f',
          borderColor: '#2c3343',
          textStyle: { color: '#e6e8ee', fontSize: 12 },
          axisPointer: { type: 'line', lineStyle: { color: '#3a4560' } },
          formatter: (params: unknown) => {
            const p = (params as Array<{ value: [number, number] }>)[0];
            return p ? `${label} at ${p.value[0]}s: <b>${format(p.value[1])}</b>` : '';
          },
        },
        series: [
          {
            type: 'line',
            data: points,
            showSymbol: false,
            smooth: 0.2,
            lineStyle: { width: 2, color: LINE },
            areaStyle: { color: 'rgba(124,140,255,0.10)' },
          },
        ],
      },
      { notMerge: false },
    );
  }, [points, format, label]);

  return <div ref={ref} className="h-full w-full" aria-label={`${label} over time`} role="img" />;
}
