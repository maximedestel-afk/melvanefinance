"use client";

import { useState } from "react";
import type { CalendarDay } from "./CalendarGrid";

const SOLD_COLOR = "var(--viz-series-1)";
const FREE_COLOR = "var(--viz-good)";

/** Prix par nuit du mois, une barre par jour — bleu pour une nuit vendue
 * (prix réellement facturé, voir CalendarGrid), vert pour une nuit encore
 * libre (prix affiché sur le calendrier). Les nuits bloquées n'ont pas de
 * barre. Complète le calendrier de l'onglet Analyse. */
export function DailyPriceChart({ days, height = 240 }: { days: CalendarDay[]; height?: number }) {
  const [hovered, setHovered] = useState<number | null>(null);

  const bars = days.map((day) => {
    const value = day.priceCents != null ? day.priceCents / 100 : 0;
    const color = day.status === "occupied" ? SOLD_COLOR : day.status === "available" ? FREE_COLOR : null;
    return { day, value, color };
  });

  const maxValue = Math.max(1, ...bars.map((b) => b.value));
  const width = Math.max(320, bars.length * 20);
  const paddingTop = 16;
  const paddingBottom = 24;
  const plotHeight = height - paddingTop - paddingBottom;
  const barSlot = width / bars.length;
  const barWidth = Math.min(14, barSlot * 0.6);

  const yFor = (value: number) => paddingTop + plotHeight - (value / maxValue) * plotHeight;
  const gridLines = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div className="viz-root overflow-x-auto">
      <div className="mb-2 flex flex-wrap gap-3 text-[12px] text-[#1d1d1f]">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-[3px]" style={{ backgroundColor: SOLD_COLOR }} />
          Nuit vendue
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-[3px]" style={{ backgroundColor: FREE_COLOR }} />
          Nuit libre
        </span>
      </div>
      <svg
        role="img"
        aria-label="Prix par nuit du mois"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="min-w-full"
      >
        {gridLines.map((fraction) => {
          const y = paddingTop + plotHeight - fraction * plotHeight;
          return <line key={fraction} x1={0} x2={width} y1={y} y2={y} stroke="var(--viz-gridline)" strokeWidth={1} />;
        })}

        {bars.map((b, i) => {
          const barHeight = Math.max(0, (b.value / maxValue) * plotHeight);
          const x = i * barSlot + (barSlot - barWidth) / 2;
          const y = yFor(b.value);
          const isHovered = hovered === i;
          const dayNumber = Number.parseInt(b.day.date.slice(8, 10), 10);
          return (
            <g key={b.day.date}>
              <rect
                x={i * barSlot}
                y={paddingTop}
                width={barSlot}
                height={plotHeight}
                fill="transparent"
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
              />
              {b.color && (
                <rect
                  x={x}
                  y={y}
                  width={barWidth}
                  height={Math.max(barHeight, b.value > 0 ? 2 : 0)}
                  rx={2}
                  fill={b.color}
                  opacity={isHovered ? 1 : 0.85}
                  className="pointer-events-none transition-opacity"
                />
              )}
              {(dayNumber === 1 || dayNumber % 5 === 0) && (
                <text x={i * barSlot + barSlot / 2} y={height - 8} textAnchor="middle" fontSize={9} fill="var(--viz-muted)">
                  {dayNumber}
                </text>
              )}
              {isHovered && b.value > 0 && (
                <g className="pointer-events-none">
                  <rect
                    x={Math.min(Math.max(x - 24, 2), width - 72)}
                    y={Math.max(y - 26, 2)}
                    width={68}
                    height={20}
                    rx={5}
                    fill="var(--viz-text-primary)"
                  />
                  <text
                    x={Math.min(Math.max(x - 24, 2), width - 72) + 34}
                    y={Math.max(y - 26, 2) + 14}
                    textAnchor="middle"
                    fontSize={11}
                    fontWeight={600}
                    fill="var(--viz-surface)"
                  >
                    {dayNumber} · {Math.round(b.value)}€
                  </text>
                </g>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
