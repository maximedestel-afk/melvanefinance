"use client";

import { useId, useState } from "react";

export interface BarChartDatum {
  label: string;
  value: number;
}

/** Graphique en barres à série unique (bleu, jeton --viz-series-1) — utilisé
 * pour le revenu mensuel du portefeuille et les tendances annuelles. Barres
 * fines ancrées à la ligne de base, coins arrondis, infobulle au survol,
 * repère en pointillés optionnel (ex. loyer fixe cumulé). */
export function BarChart({
  data,
  formatValue,
  referenceLine,
  referenceLabel,
  height = 220,
}: {
  data: BarChartDatum[];
  formatValue: (value: number) => string;
  referenceLine?: number;
  referenceLabel?: string;
  height?: number;
}) {
  const gradientId = useId();
  const [hovered, setHovered] = useState<number | null>(null);

  const maxValue = Math.max(1, ...data.map((d) => d.value), referenceLine ?? 0);
  const width = Math.max(360, data.length * 56);
  const paddingTop = 16;
  const paddingBottom = 28;
  const plotHeight = height - paddingTop - paddingBottom;
  const barSlot = width / data.length;
  const barWidth = Math.min(28, barSlot * 0.55);

  const yFor = (value: number) => paddingTop + plotHeight - (value / maxValue) * plotHeight;
  const gridLines = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div className="viz-root overflow-x-auto">
      <svg
        role="img"
        aria-label="Graphique en barres"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="min-w-full"
      >
        {gridLines.map((fraction) => {
          const y = paddingTop + plotHeight - fraction * plotHeight;
          return (
            <line
              key={fraction}
              x1={0}
              x2={width}
              y1={y}
              y2={y}
              stroke="var(--viz-gridline)"
              strokeWidth={1}
            />
          );
        })}

        {referenceLine != null && referenceLine > 0 && (
          <line
            x1={0}
            x2={width}
            y1={yFor(referenceLine)}
            y2={yFor(referenceLine)}
            stroke="var(--viz-muted)"
            strokeWidth={1.5}
            strokeDasharray="4 4"
          />
        )}

        {data.map((d, i) => {
          const barHeight = Math.max(0, (d.value / maxValue) * plotHeight);
          const x = i * barSlot + (barSlot - barWidth) / 2;
          const y = paddingTop + plotHeight - barHeight;
          const isHovered = hovered === i;
          return (
            <g key={d.label}>
              <rect
                x={i * barSlot}
                y={paddingTop}
                width={barSlot}
                height={plotHeight}
                fill="transparent"
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
              />
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={Math.max(barHeight, 2)}
                rx={4}
                fill={`url(#${gradientId})`}
                opacity={isHovered ? 1 : 0.88}
                className="pointer-events-none transition-opacity"
              />
              <text
                x={i * barSlot + barSlot / 2}
                y={height - 10}
                textAnchor="middle"
                fontSize={11}
                fill="var(--viz-muted)"
              >
                {d.label}
              </text>
              {isHovered && (
                <g className="pointer-events-none">
                  <rect
                    x={Math.min(Math.max(x - 30, 4), width - 108)}
                    y={Math.max(y - 30, 2)}
                    width={104}
                    height={24}
                    rx={6}
                    fill="var(--viz-text-primary)"
                  />
                  <text
                    x={Math.min(Math.max(x - 30, 4), width - 108) + 52}
                    y={Math.max(y - 30, 2) + 16}
                    textAnchor="middle"
                    fontSize={12}
                    fontWeight={600}
                    fill="var(--viz-surface)"
                  >
                    {formatValue(d.value)}
                  </text>
                </g>
              )}
            </g>
          );
        })}

        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--viz-series-1)" />
            <stop offset="100%" stopColor="var(--viz-series-1)" stopOpacity={0.75} />
          </linearGradient>
        </defs>
      </svg>
      {referenceLine != null && referenceLine > 0 && referenceLabel && (
        <p className="mt-1 text-[12px] text-[#6e6e73]">
          <span className="mr-1 inline-block w-3 border-t-2 border-dashed border-[#c3c2b7] align-middle" />
          {referenceLabel}
        </p>
      )}
    </div>
  );
}
