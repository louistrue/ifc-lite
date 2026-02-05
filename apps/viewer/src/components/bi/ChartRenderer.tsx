/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * ECharts wrapper component for rendering various chart types
 *
 * Handles chart options generation, selection highlighting,
 * and interaction event delegation.
 */

import React, { useRef, useMemo, useEffect, useLayoutEffect, useCallback } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import type {
  ChartConfig,
  AggregatedDataPoint,
  ChartInteractionEvent,
  COLOR_SCHEMES,
} from '@ifc-lite/bi';
import type { ChartDimensions } from './ChartCard.js';

interface ChartRendererProps {
  config: ChartConfig;
  data: AggregatedDataPoint[];
  selectedKeys: Set<string>;
  highlightedKeys: Set<string>;
  onInteraction: (event: ChartInteractionEvent) => void;
  dimensions: ChartDimensions;
  /** Whether this chart has already animated (tracked at parent level) */
  hasAnimated: boolean;
  /** Callback to mark this chart as having animated */
  onAnimated: () => void;
}

/**
 * Size breakpoints for responsive chart configuration
 * - compact: Very small charts, minimal UI
 * - medium: Standard size, balanced layout
 * - large: Plenty of room, full features
 */
type SizeClass = 'compact' | 'medium' | 'large';

interface SizeInfo {
  widthClass: SizeClass;
  heightClass: SizeClass;
  width: number;
  height: number;
  /** Whether to show legend at all */
  showLegend: boolean;
  /** Whether legend should be horizontal (below) or vertical (side) */
  legendHorizontal: boolean;
  /** Maximum items to show before grouping into "Other" */
  maxItems: number;
  /** Whether to show axis labels */
  showAxisLabels: boolean;
  /** Label truncation width */
  labelWidth: number;
}

function getSizeInfo(dimensions: ChartDimensions): SizeInfo {
  const { width, height } = dimensions;

  const widthClass: SizeClass = width < 250 ? 'compact' : width < 400 ? 'medium' : 'large';
  const heightClass: SizeClass = height < 180 ? 'compact' : height < 280 ? 'medium' : 'large';

  // Calculate responsive values
  const showLegend = width >= 200 && height >= 150;
  const legendHorizontal = width < 350 || height < 200;

  // More items for larger charts
  const maxItems =
    widthClass === 'compact' ? 5 : widthClass === 'medium' ? 8 : 12;

  // Hide axis labels in very small charts
  const showAxisLabels = width >= 150 && height >= 120;

  // Label width based on available space
  const labelWidth =
    widthClass === 'compact' ? 40 : widthClass === 'medium' ? 60 : 100;

  return {
    widthClass,
    heightClass,
    width,
    height,
    showLegend,
    legendHorizontal,
    maxItems,
    showAxisLabels,
    labelWidth,
  };
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
  dimensions,
  hasAnimated,
  onAnimated,
}: ChartRendererProps) {
  const chartRef = useRef<ReactECharts>(null);
  const prevDataRef = useRef<AggregatedDataPoint[]>([]);
  // Local ref to track animation state within this component instance
  // This handles rapid re-renders before the parent's onAnimated callback completes
  const localAnimatedRef = useRef(hasAnimated);

  // Sync local ref with parent prop (handles remount scenarios)
  if (hasAnimated && !localAnimatedRef.current) {
    localAnimatedRef.current = true;
  }

  // Stabilize data reference - only update if actual values changed
  // This prevents ECharts from re-animating when data reference changes but values are same
  const stableData = useMemo(() => {
    const prev = prevDataRef.current;
    // Quick length check
    if (data.length === prev.length) {
      // Check if all keys and values match
      const isSame = data.every((d, i) =>
        d.key === prev[i]?.key && d.value === prev[i]?.value
      );
      if (isSame) {
        return prev; // Return previous reference to prevent re-render
      }
    }
    prevDataRef.current = data;
    return data;
  }, [data]);

  // Determine if animation should be enabled (only on first render with data)
  // Check both parent state (hasAnimated) and local state (localAnimatedRef)
  // Local state handles rapid re-renders, parent state handles remounts
  const shouldAnimate = useMemo(() => {
    if (stableData.length === 0) return false;
    if (hasAnimated) return false;
    if (localAnimatedRef.current) return false;
    return true;
  }, [stableData.length, hasAnimated]);

  // Mark as animated IMMEDIATELY using useLayoutEffect (synchronous, before paint)
  // This prevents double animation during rapid re-renders
  useLayoutEffect(() => {
    if (shouldAnimate && stableData.length > 0 && !localAnimatedRef.current) {
      // Mark locally first (immediate)
      localAnimatedRef.current = true;
      // Then notify parent for persistence across remounts
      onAnimated();
    }
  }, [shouldAnimate, stableData.length, onAnimated]);

  // Get responsive size info
  const sizeInfo = useMemo(() => getSizeInfo(dimensions), [dimensions]);

  // Build ECharts option based on chart type
  const option = useMemo((): EChartsOption => {
    const colors = getColorScheme(config.options?.colorScheme);

    let chartOption: EChartsOption;
    switch (config.type) {
      case 'pie':
      case 'donut':
        chartOption = buildPieOption(config, stableData, selectedKeys, colors, sizeInfo);
        break;
      case 'bar':
      case 'barHorizontal':
        chartOption = buildBarOption(config, stableData, selectedKeys, colors, sizeInfo);
        break;
      case 'stackedBar':
        chartOption = buildStackedBarOption(config, stableData, selectedKeys, colors, sizeInfo);
        break;
      case 'treemap':
        chartOption = buildTreemapOption(config, stableData, selectedKeys, colors, sizeInfo);
        break;
      case 'sunburst':
        chartOption = buildSunburstOption(config, stableData, selectedKeys, colors, sizeInfo);
        break;
      case 'scatter':
        chartOption = buildScatterOption(config, stableData, selectedKeys, colors, sizeInfo);
        break;
      case 'histogram':
        chartOption = buildHistogramOption(config, stableData, selectedKeys, colors, sizeInfo);
        break;
      default:
        chartOption = buildBarOption(config, stableData, selectedKeys, colors, sizeInfo);
    }

    // Only animate on first render with data - prevents jarring double-animation
    return {
      ...chartOption,
      animation: shouldAnimate,
      animationDuration: shouldAnimate ? 300 : 0,
      animationDurationUpdate: 0,
      animationEasing: 'cubicOut',
    };
  }, [config, stableData, selectedKeys, sizeInfo, shouldAnimate]);

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

    try {
      // Downplay all, then highlight selected
      instance.dispatchAction({ type: 'downplay', seriesIndex: 0 });

      if (selectedKeys.size > 0 || highlightedKeys.size > 0) {
        const allKeys = new Set([...selectedKeys, ...highlightedKeys]);
        const dataIndices = stableData
          .map((d, i) => (allKeys.has(d.key) ? i : -1))
          .filter((i) => i >= 0);

        dataIndices.forEach((dataIndex) => {
          instance.dispatchAction({
            type: 'highlight',
            seriesIndex: 0,
            dataIndex,
            // Don't show tooltip on programmatic highlight to avoid null DOM errors
            notShowPointer: true,
          });
        });
      }
    } catch (err) {
      // Ignore errors during highlight - chart may be re-rendering or unmounted
      console.debug('[ChartRenderer] Highlight error (safe to ignore):', err);
    }
  }, [selectedKeys, highlightedKeys, stableData]);

  return (
    <ReactECharts
      ref={chartRef}
      option={option}
      onEvents={onEvents}
      style={{ height: '100%', width: '100%' }}
      opts={{ renderer: 'canvas' }}
      lazyUpdate={true}
      notMerge={false} // Merge mode so updates use animationDurationUpdate (0) not animationDuration
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
  colors: string[],
  sizeInfo: SizeInfo
): EChartsOption {
  const isDonut = config.type === 'donut';
  // Use responsive max slices, but allow config override
  const maxSlices = config.options?.maxSlices ?? sizeInfo.maxItems;

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

  // Responsive legend configuration
  const showLegend = (config.options?.showLegend ?? true) && sizeInfo.showLegend;
  const legendHorizontal = sizeInfo.legendHorizontal;

  // Calculate pie center and radius based on legend position
  let pieCenter: [string, string];
  let pieRadius: string | [string, string];

  if (!showLegend) {
    // No legend: center the pie
    pieCenter = ['50%', '50%'];
    pieRadius = isDonut ? ['35%', '65%'] : '65%';
  } else if (legendHorizontal) {
    // Legend below: pie in upper portion
    pieCenter = ['50%', '42%'];
    pieRadius = isDonut ? ['25%', '50%'] : '50%';
  } else {
    // Legend on right: pie shifted left
    pieCenter = ['35%', '50%'];
    pieRadius = isDonut ? ['30%', '60%'] : '60%';
  }

  // Truncate long labels for legend
  const truncateLabel = (label: string, maxLen: number): string => {
    if (label.length <= maxLen) return label;
    return label.slice(0, maxLen - 1) + '…';
  };

  const legendMaxLen = sizeInfo.widthClass === 'compact' ? 12 : sizeInfo.widthClass === 'medium' ? 18 : 25;

  return {
    color: colors,
    tooltip: {
      trigger: 'item',
      formatter: '{b}: {c} ({d}%)',
      confine: true, // Keep tooltip within chart bounds
    },
    legend: showLegend
      ? {
          show: true,
          orient: legendHorizontal ? 'horizontal' : 'vertical',
          ...(legendHorizontal
            ? { bottom: 5, left: 'center' }
            : { right: 10, top: 'center' }),
          type: 'scroll',
          pageIconSize: 10,
          pageTextStyle: { fontSize: 10 },
          formatter: (name: string) => truncateLabel(name, legendMaxLen),
          textStyle: {
            fontSize: sizeInfo.widthClass === 'compact' ? 10 : 11,
          },
        }
      : { show: false },
    series: [
      {
        type: 'pie',
        radius: pieRadius,
        center: pieCenter,
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
          show: false, // Always hide pie labels - they overlap. Use legend + tooltip
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
  colors: string[],
  sizeInfo: SizeInfo
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

  // Limit number of bars based on available space
  const maxBars = isHorizontal
    ? Math.max(3, Math.floor(sizeInfo.height / 25))
    : Math.max(3, Math.floor(sizeInfo.width / 35));

  if (sortedData.length > maxBars) {
    // Group excess items into "Other"
    const topItems = sortedData.slice(0, maxBars - 1);
    const otherItems = sortedData.slice(maxBars - 1);
    const otherValue = otherItems.reduce((sum, d) => sum + d.value, 0);
    const otherRefs = otherItems.flatMap((d) => d.entityRefs);
    sortedData = [
      ...topItems,
      {
        key: '__other__',
        label: `Other (${otherItems.length})`,
        value: otherValue,
        entityRefs: otherRefs,
      },
    ];
  }

  // Truncate labels based on available space
  const truncateLabel = (label: string): string => {
    const maxLen = sizeInfo.labelWidth / 6; // Rough char width estimate
    if (label.length <= maxLen) return label;
    return label.slice(0, Math.max(3, maxLen - 1)) + '…';
  };

  // Responsive label configuration
  const labelRotate = isHorizontal ? 0 : sizeInfo.widthClass === 'compact' ? 90 : 45;
  const showLabels = sizeInfo.showAxisLabels;

  const categoryAxis = {
    type: 'category' as const,
    data: sortedData.map((d) => truncateLabel(d.label)),
    axisLabel: {
      show: showLabels,
      rotate: labelRotate,
      interval: 0,
      overflow: 'truncate' as const,
      width: sizeInfo.labelWidth,
      fontSize: sizeInfo.widthClass === 'compact' ? 9 : 10,
    },
    axisTick: { show: showLabels },
  };

  const valueAxis = {
    type: 'value' as const,
    axisLabel: {
      show: showLabels,
      fontSize: sizeInfo.widthClass === 'compact' ? 9 : 10,
      formatter: (value: number) => {
        if (value >= 1000000) return (value / 1000000).toFixed(1) + 'M';
        if (value >= 1000) return (value / 1000).toFixed(1) + 'K';
        return value.toFixed(value % 1 === 0 ? 0 : 1);
      },
    },
  };

  // Responsive grid padding
  const gridPadding = {
    left: isHorizontal
      ? sizeInfo.widthClass === 'compact' ? 5 : 10
      : sizeInfo.widthClass === 'compact' ? 5 : 10,
    right: sizeInfo.widthClass === 'compact' ? 5 : 15,
    bottom: isHorizontal
      ? sizeInfo.heightClass === 'compact' ? 5 : 10
      : sizeInfo.heightClass === 'compact' ? 20 : 40,
    top: sizeInfo.heightClass === 'compact' ? 5 : 15,
  };

  return {
    color: colors,
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      confine: true,
    },
    grid: {
      ...gridPadding,
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
        barMaxWidth: sizeInfo.widthClass === 'compact' ? 20 : 40,
      },
    ],
  };
}

function buildStackedBarOption(
  config: ChartConfig,
  data: AggregatedDataPoint[],
  selectedKeys: Set<string>,
  colors: string[],
  sizeInfo: SizeInfo
): EChartsOption {
  // For stacked bars, we'd need secondary grouping data
  // For now, fall back to regular bar
  return buildBarOption(config, data, selectedKeys, colors, sizeInfo);
}

function buildTreemapOption(
  config: ChartConfig,
  data: AggregatedDataPoint[],
  selectedKeys: Set<string>,
  colors: string[],
  sizeInfo: SizeInfo
): EChartsOption {
  // Calculate minimum area for showing labels
  const totalValue = data.reduce((sum, d) => sum + d.value, 0);
  const chartArea = sizeInfo.width * sizeInfo.height;

  // Only show labels on segments that are large enough
  const minLabelArea = sizeInfo.widthClass === 'compact' ? 2500 : 1600;

  return {
    color: colors,
    tooltip: {
      trigger: 'item',
      formatter: '{b}: {c}',
      confine: true,
    },
    series: [
      {
        type: 'treemap',
        width: '100%',
        height: '100%',
        data: data.map((d) => {
          // Estimate this segment's area
          const segmentArea = (d.value / totalValue) * chartArea;
          const showLabel = segmentArea >= minLabelArea;

          return {
            name: d.label,
            value: d.value,
            dataPoint: d,
            label: {
              show: showLabel,
              formatter: (params: { name: string }) => {
                // Truncate label based on estimated width
                const maxChars = Math.max(3, Math.floor(Math.sqrt(segmentArea) / 8));
                const name = params.name;
                return name.length > maxChars ? name.slice(0, maxChars - 1) + '…' : name;
              },
              fontSize: sizeInfo.widthClass === 'compact' ? 9 : 11,
            },
            itemStyle: selectedKeys.has(d.key)
              ? {
                  borderColor: '#1890ff',
                  borderWidth: 3,
                }
              : undefined,
          };
        }),
        breadcrumb: {
          show: false,
        },
        roam: false,
        nodeClick: false, // Disable drill-down to prevent confusion
        levels: [
          {
            itemStyle: {
              borderWidth: 1,
              borderColor: '#fff',
              gapWidth: 1,
            },
          },
        ],
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
  colors: string[],
  sizeInfo: SizeInfo
): EChartsOption {
  // Calculate whether to show labels based on size
  const showLabels = sizeInfo.widthClass !== 'compact' && sizeInfo.heightClass !== 'compact';
  const minDimension = Math.min(sizeInfo.width, sizeInfo.height);

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
      confine: true,
    },
    series: [
      {
        type: 'sunburst',
        data: sunburstData,
        radius: ['10%', '85%'],
        label: {
          show: showLabels,
          rotate: 'radial',
          fontSize: sizeInfo.widthClass === 'medium' ? 9 : 10,
          minAngle: 15, // Hide labels for very small slices
          formatter: (params: { name: string }) => {
            // Truncate based on available space
            const maxLen = Math.max(5, Math.floor(minDimension / 25));
            const name = params.name;
            return name.length > maxLen ? name.slice(0, maxLen - 1) + '…' : name;
          },
        },
        emphasis: {
          focus: 'ancestor',
        },
        levels: [
          {},
          {
            r0: '10%',
            r: '45%',
            label: { show: showLabels },
          },
          {
            r0: '45%',
            r: '85%',
            label: {
              show: showLabels && sizeInfo.widthClass === 'large',
              fontSize: 9,
            },
          },
        ],
      },
    ],
  };
}

function buildScatterOption(
  config: ChartConfig,
  data: AggregatedDataPoint[],
  selectedKeys: Set<string>,
  colors: string[],
  sizeInfo: SizeInfo
): EChartsOption {
  const showLabels = sizeInfo.showAxisLabels;
  const symbolSize = sizeInfo.widthClass === 'compact' ? 12 : sizeInfo.widthClass === 'medium' ? 16 : 20;

  return {
    color: colors,
    tooltip: {
      trigger: 'item',
      formatter: '{b}: {c}',
      confine: true,
    },
    grid: {
      left: 10,
      right: 10,
      bottom: 10,
      top: 10,
      containLabel: true,
    },
    xAxis: {
      type: 'category',
      data: data.map((d) => d.label),
      axisLabel: {
        show: showLabels,
        rotate: 45,
        fontSize: 9,
        overflow: 'truncate',
        width: sizeInfo.labelWidth,
      },
    },
    yAxis: {
      type: 'value',
      axisLabel: {
        show: showLabels,
        fontSize: 9,
      },
    },
    series: [
      {
        type: 'scatter',
        symbolSize,
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
  colors: string[],
  sizeInfo: SizeInfo
): EChartsOption {
  const showLabels = sizeInfo.showAxisLabels;

  // Histogram is essentially a bar chart for distribution data
  return {
    color: colors,
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      confine: true,
    },
    grid: {
      left: 10,
      right: 10,
      bottom: 10,
      top: 10,
      containLabel: true,
    },
    xAxis: {
      type: 'category',
      data: data.map((d) => d.label),
      axisLabel: {
        show: showLabels,
        rotate: 45,
        fontSize: 9,
        overflow: 'truncate',
        width: sizeInfo.labelWidth,
      },
    },
    yAxis: {
      type: 'value',
      axisLabel: {
        show: showLabels,
        fontSize: 9,
      },
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
