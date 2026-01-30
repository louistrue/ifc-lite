/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * ECharts wrapper component for rendering various chart types
 *
 * Handles chart options generation, selection highlighting,
 * and interaction event delegation.
 */

import React, { useRef, useMemo, useEffect, useCallback } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import type {
  ChartConfig,
  AggregatedDataPoint,
  ChartInteractionEvent,
  COLOR_SCHEMES,
} from '@ifc-lite/bi';

interface ChartRendererProps {
  config: ChartConfig;
  data: AggregatedDataPoint[];
  selectedKeys: Set<string>;
  highlightedKeys: Set<string>;
  onInteraction: (event: ChartInteractionEvent) => void;
}

// Get color scheme
const getColorScheme = (scheme?: string): string[] => {
  const schemes: Record<string, string[]> = {
    default: [
      '#5470c6',
      '#91cc75',
      '#fac858',
      '#ee6666',
      '#73c0de',
      '#3ba272',
      '#fc8452',
      '#9a60b4',
      '#ea7ccc',
    ],
    warm: [
      '#ff6b6b',
      '#feca57',
      '#ff9ff3',
      '#ff9f43',
      '#ee5a24',
      '#f8b739',
      '#ff6348',
      '#eb3b5a',
    ],
    cool: [
      '#54a0ff',
      '#5f27cd',
      '#48dbfb',
      '#00d2d3',
      '#2e86de',
      '#341f97',
      '#0abde3',
      '#1dd1a1',
    ],
    categorical: [
      '#e41a1c',
      '#377eb8',
      '#4daf4a',
      '#984ea3',
      '#ff7f00',
      '#ffff33',
      '#a65628',
      '#f781bf',
    ],
  };
  return schemes[scheme ?? 'default'] ?? schemes.default;
};

export function ChartRenderer({
  config,
  data,
  selectedKeys,
  highlightedKeys,
  onInteraction,
}: ChartRendererProps) {
  const chartRef = useRef<ReactECharts>(null);

  // Build ECharts option based on chart type
  const option = useMemo((): EChartsOption => {
    const colors = getColorScheme(config.options?.colorScheme);

    switch (config.type) {
      case 'pie':
      case 'donut':
        return buildPieOption(config, data, selectedKeys, colors);
      case 'bar':
      case 'barHorizontal':
        return buildBarOption(config, data, selectedKeys, colors);
      case 'stackedBar':
        return buildStackedBarOption(config, data, selectedKeys, colors);
      case 'treemap':
        return buildTreemapOption(config, data, selectedKeys, colors);
      case 'sunburst':
        return buildSunburstOption(config, data, selectedKeys, colors);
      case 'scatter':
        return buildScatterOption(config, data, selectedKeys, colors);
      case 'histogram':
        return buildHistogramOption(config, data, selectedKeys, colors);
      default:
        return buildBarOption(config, data, selectedKeys, colors);
    }
  }, [config, data, selectedKeys]);

  // Handle click event
  const handleClick = useCallback(
    (params: { data?: { dataPoint?: AggregatedDataPoint }; event?: { event?: MouseEvent } }) => {
      const dataPoint = params.data?.dataPoint;
      if (!dataPoint) return;

      const mouseEvent = params.event?.event;
      onInteraction({
        type: 'select',
        chartId: config.id,
        dataPoint,
        modifiers: {
          shift: mouseEvent?.shiftKey ?? false,
          ctrl: mouseEvent?.ctrlKey ?? mouseEvent?.metaKey ?? false,
          alt: mouseEvent?.altKey ?? false,
        },
      });
    },
    [config.id, onInteraction]
  );

  // Handle mouseover event
  const handleMouseOver = useCallback(
    (params: { data?: { dataPoint?: AggregatedDataPoint } }) => {
      const dataPoint = params.data?.dataPoint;
      if (!dataPoint) return;

      onInteraction({
        type: 'hover',
        chartId: config.id,
        dataPoint,
        modifiers: { shift: false, ctrl: false, alt: false },
      });
    },
    [config.id, onInteraction]
  );

  // Handle mouseout event
  const handleMouseOut = useCallback(() => {
    onInteraction({
      type: 'hover',
      chartId: config.id,
      dataPoint: null,
      modifiers: { shift: false, ctrl: false, alt: false },
    });
  }, [config.id, onInteraction]);

  // Event handlers object
  const onEvents = useMemo(
    () => ({
      click: handleClick,
      mouseover: handleMouseOver,
      mouseout: handleMouseOut,
    }),
    [handleClick, handleMouseOver, handleMouseOut]
  );

  // Highlight selected items using dispatchAction
  useEffect(() => {
    const instance = chartRef.current?.getEchartsInstance();
    if (!instance) return;

    // Downplay all, then highlight selected
    instance.dispatchAction({ type: 'downplay', seriesIndex: 0 });

    if (selectedKeys.size > 0 || highlightedKeys.size > 0) {
      const allKeys = new Set([...selectedKeys, ...highlightedKeys]);
      const dataIndices = data
        .map((d, i) => (allKeys.has(d.key) ? i : -1))
        .filter((i) => i >= 0);

      dataIndices.forEach((dataIndex) => {
        instance.dispatchAction({ type: 'highlight', seriesIndex: 0, dataIndex });
      });
    }
  }, [selectedKeys, highlightedKeys, data]);

  return (
    <ReactECharts
      ref={chartRef}
      option={option}
      onEvents={onEvents}
      style={{ height: '100%', width: '100%' }}
      opts={{ renderer: 'canvas' }}
      lazyUpdate={true}
      notMerge={true}
    />
  );
}

// ============================================================================
// Chart Option Builders
// ============================================================================

function buildPieOption(
  config: ChartConfig,
  data: AggregatedDataPoint[],
  selectedKeys: Set<string>,
  colors: string[]
): EChartsOption {
  const isDonut = config.type === 'donut';
  const maxSlices = config.options?.maxSlices ?? 10;

  // Sort and optionally group into "Other"
  let chartData = [...data].sort((a, b) => b.value - a.value);
  if (chartData.length > maxSlices) {
    const topItems = chartData.slice(0, maxSlices - 1);
    const otherItems = chartData.slice(maxSlices - 1);
    const otherValue = otherItems.reduce((sum, d) => sum + d.value, 0);
    const otherRefs = otherItems.flatMap((d) => d.entityRefs);
    chartData = [
      ...topItems,
      {
        key: '__other__',
        label: 'Other',
        value: otherValue,
        entityRefs: otherRefs,
      },
    ];
  }

  return {
    color: colors,
    tooltip: {
      trigger: 'item',
      formatter: '{b}: {c} ({d}%)',
    },
    legend: {
      show: config.options?.showLegend ?? true,
      orient: 'vertical',
      right: 10,
      top: 'center',
      type: 'scroll',
    },
    series: [
      {
        type: 'pie',
        radius: isDonut ? ['40%', '70%'] : '70%',
        center: ['40%', '50%'],
        data: chartData.map((d) => ({
          name: d.label,
          value: d.value,
          dataPoint: d,
          itemStyle: selectedKeys.has(d.key)
            ? {
                shadowBlur: 10,
                shadowColor: 'rgba(0, 0, 0, 0.5)',
              }
            : undefined,
        })),
        label: {
          show: config.options?.showLabels ?? false,
        },
        emphasis: {
          itemStyle: {
            shadowBlur: 10,
            shadowOffsetX: 0,
            shadowColor: 'rgba(0, 0, 0, 0.5)',
          },
        },
      },
    ],
  };
}

function buildBarOption(
  config: ChartConfig,
  data: AggregatedDataPoint[],
  selectedKeys: Set<string>,
  colors: string[]
): EChartsOption {
  const isHorizontal = config.type === 'barHorizontal';

  // Sort data
  let sortedData = [...data];
  if (config.options?.sortBy === 'value') {
    sortedData.sort((a, b) =>
      config.options?.sortOrder === 'asc' ? a.value - b.value : b.value - a.value
    );
  } else if (config.options?.sortBy === 'key') {
    sortedData.sort((a, b) => a.key.localeCompare(b.key));
  }

  const categoryAxis = {
    type: 'category' as const,
    data: sortedData.map((d) => d.label),
    axisLabel: {
      rotate: isHorizontal ? 0 : 45,
      interval: 0,
      overflow: 'truncate' as const,
      width: isHorizontal ? 100 : 60,
    },
  };

  const valueAxis = {
    type: 'value' as const,
  };

  return {
    color: colors,
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
    },
    grid: {
      left: isHorizontal ? '25%' : '10%',
      right: '10%',
      bottom: isHorizontal ? '10%' : '25%',
      top: '10%',
      containLabel: true,
    },
    xAxis: isHorizontal ? valueAxis : categoryAxis,
    yAxis: isHorizontal ? categoryAxis : valueAxis,
    series: [
      {
        type: 'bar',
        data: sortedData.map((d) => ({
          value: d.value,
          dataPoint: d,
          itemStyle: selectedKeys.has(d.key)
            ? {
                borderColor: '#1890ff',
                borderWidth: 2,
              }
            : undefined,
        })),
        emphasis: {
          itemStyle: {
            shadowBlur: 10,
            shadowColor: 'rgba(0, 0, 0, 0.3)',
          },
        },
      },
    ],
  };
}

function buildStackedBarOption(
  config: ChartConfig,
  data: AggregatedDataPoint[],
  selectedKeys: Set<string>,
  colors: string[]
): EChartsOption {
  // For stacked bars, we'd need secondary grouping data
  // For now, fall back to regular bar
  return buildBarOption(config, data, selectedKeys, colors);
}

function buildTreemapOption(
  config: ChartConfig,
  data: AggregatedDataPoint[],
  selectedKeys: Set<string>,
  colors: string[]
): EChartsOption {
  return {
    color: colors,
    tooltip: {
      trigger: 'item',
      formatter: '{b}: {c}',
    },
    series: [
      {
        type: 'treemap',
        data: data.map((d) => ({
          name: d.label,
          value: d.value,
          dataPoint: d,
          itemStyle: selectedKeys.has(d.key)
            ? {
                borderColor: '#1890ff',
                borderWidth: 3,
              }
            : undefined,
        })),
        label: {
          show: true,
          formatter: '{b}',
        },
        breadcrumb: {
          show: false,
        },
        roam: false,
        emphasis: {
          itemStyle: {
            shadowBlur: 10,
            shadowColor: 'rgba(0, 0, 0, 0.5)',
          },
        },
      },
    ],
  };
}

function buildSunburstOption(
  config: ChartConfig,
  data: AggregatedDataPoint[],
  selectedKeys: Set<string>,
  colors: string[]
): EChartsOption {
  // Convert flat data to hierarchical for sunburst
  const sunburstData = data.map((d) => ({
    name: d.label,
    value: d.value,
    dataPoint: d,
    itemStyle: selectedKeys.has(d.key)
      ? {
          borderColor: '#1890ff',
          borderWidth: 2,
        }
      : undefined,
    children: d.children?.map((child) => ({
      name: child.label,
      value: child.value,
      dataPoint: child,
    })),
  }));

  return {
    color: colors,
    tooltip: {
      trigger: 'item',
      formatter: '{b}: {c}',
    },
    series: [
      {
        type: 'sunburst',
        data: sunburstData,
        radius: ['15%', '90%'],
        label: {
          rotate: 'radial',
        },
        emphasis: {
          focus: 'ancestor',
        },
      },
    ],
  };
}

function buildScatterOption(
  config: ChartConfig,
  data: AggregatedDataPoint[],
  selectedKeys: Set<string>,
  colors: string[]
): EChartsOption {
  return {
    color: colors,
    tooltip: {
      trigger: 'item',
      formatter: '{b}: {c}',
    },
    xAxis: {
      type: 'category',
      data: data.map((d) => d.label),
    },
    yAxis: {
      type: 'value',
    },
    series: [
      {
        type: 'scatter',
        symbolSize: 20,
        data: data.map((d, i) => ({
          name: d.label,
          value: [i, d.value],
          dataPoint: d,
          itemStyle: selectedKeys.has(d.key)
            ? {
                borderColor: '#1890ff',
                borderWidth: 2,
              }
            : undefined,
        })),
        emphasis: {
          itemStyle: {
            shadowBlur: 10,
            shadowColor: 'rgba(0, 0, 0, 0.5)',
          },
        },
      },
    ],
  };
}

function buildHistogramOption(
  config: ChartConfig,
  data: AggregatedDataPoint[],
  selectedKeys: Set<string>,
  colors: string[]
): EChartsOption {
  // Histogram is essentially a bar chart for distribution data
  return {
    color: colors,
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
    },
    xAxis: {
      type: 'category',
      data: data.map((d) => d.label),
    },
    yAxis: {
      type: 'value',
    },
    series: [
      {
        type: 'bar',
        barWidth: '90%',
        data: data.map((d) => ({
          value: d.value,
          dataPoint: d,
          itemStyle: selectedKeys.has(d.key)
            ? {
                borderColor: '#1890ff',
                borderWidth: 2,
              }
            : undefined,
        })),
      },
    ],
  };
}

export default ChartRenderer;
