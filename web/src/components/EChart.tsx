import { BarChart, HeatmapChart, LineChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { useEffect, useRef } from "react";
import { useI18n } from "../i18n";

echarts.use([BarChart, LineChart, HeatmapChart, GridComponent, TooltipComponent, VisualMapComponent, CanvasRenderer]);

export type EChartsOption = echarts.EChartsCoreOption;

/** Design tokens resolved from CSS variables so charts follow the theme. */
export function chartTokens() {
  const style = getComputedStyle(document.documentElement);
  const get = (name: string) => style.getPropertyValue(name).trim();
  return {
    ink: get("--ink"),
    muted: get("--muted"),
    line: get("--line"),
    accent: get("--accent"),
    accentStrong: get("--accent-strong"),
    hover: get("--hover"),
    panel: get("--panel"),
  };
}

export function EChart({ option, height = 280 }: { option: EChartsOption; height?: number }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    chartRef.current = chart;
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(ref.current);
    return () => {
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(option, { notMerge: true });
  }, [option]);

  return <div ref={ref} style={{ height }} className="w-full" />;
}

