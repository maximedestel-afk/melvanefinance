"use client";

import { useState } from "react";
import type { CalendarDay } from "./CalendarGrid";

// Reprennent exactement les couleurs du calendrier (CalendarGrid) — vendue =
// bleu "occupée", libre = vert "libre" (jetons --viz-sold/--viz-free,
// définis dans globals.css et validés colorblind-safe par
// dataviz/scripts/validate_palette.js en mode clair et sombre).
const SOLD_COLOR = "var(--viz-sold)";
const FREE_COLOR = "var(--viz-free)";

/** Pas d'axe "rond" (1/2/5 × 10^n) le plus proche de maxValue/targetTicks,
 * pour des graduations lisibles (0, 50, 100...) plutôt que des valeurs
 * arbitraires. */
function niceStep(maxValue: number, targetTicks = 4): number {
  const rawStep = maxValue / targetTicks;
  if (rawStep <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const residual = rawStep / magnitude;
  if (residual > 5) return 10 * magnitude;
  if (residual > 2) return 5 * magnitude;
  if (residual > 1) return 2 * magnitude;
  return magnitude;
}

/** Rectangle à coins arrondis en haut seulement, carré à la ligne de base
 * (mark spec dataviz : "4px rounded data-end, square at the baseline"). */
function roundedTopRectPath(x: number, y: number, width: number, height: number, radius: number): string {
  if (height <= 0 || width <= 0) return "";
  const r = Math.min(radius, width / 2, height);
  return `M${x},${y + height} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + width - r},${y} Q${x + width},${y} ${x + width},${y + r} L${x + width},${y + height} Z`;
}

/** Prix par nuit du mois, une barre par jour — bleu pour une nuit vendue
 * (prix réellement facturé, voir CalendarGrid), vert pour une nuit encore
 * libre (prix affiché sur le calendrier), mêmes couleurs que le calendrier.
 * Les nuits bloquées n'ont pas de barre. Complète le calendrier de l'onglet
 * Analyse. */
export function DailyPriceChart({ days, height = 240 }: { days: CalendarDay[]; height?: number }) {
  const [hovered, setHovered] = useState<number | null>(null);

  const bars = days.map((day) => {
    const value = day.priceCents != null ? day.priceCents / 100 : 0;
    const color = day.status === "occupied" ? SOLD_COLOR : day.status === "available" ? FREE_COLOR : null;
    return { day, value, color };
  });

  const rawMax = Math.max(1, ...bars.map((b) => b.value));
  const step = niceStep(rawMax);
  const maxValue = Math.ceil(rawMax / step) * step;
  const tickCount = Math.round(maxValue / step);
  const ticks = Array.from({ length: tickCount + 1 }, (_, i) => i * step);

  const width = Math.max(360, bars.length * 20);
  const paddingTop = 14;
  const paddingBottom = 22;
  const paddingLeft = 34;
  const plotHeight = height - paddingTop - paddingBottom;
  const plotWidth = width - paddingLeft;
  const barSlot = plotWidth / bars.length;
  const barWidth = Math.min(16, barSlot * 0.62);

  const yFor = (value: number) => paddingTop + plotHeight - (value / maxValue) * plotHeight;

  return (
    <div className="viz-root overflow-x-auto">
      <div className="mb-2 flex flex-wrap gap-3 text-[12px] text-[#1d1d1f]">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: SOLD_COLOR }} />
          Nuit vendue
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: FREE_COLOR }} />
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
        {ticks.map((tick) => {
          const y = yFor(tick);
          return (
            <g key={tick}>
              <line
                x1={paddingLeft}
                x2={width}
                y1={y}
                y2={y}
                stroke={tick === 0 ? "var(--viz-baseline)" : "var(--viz-gridline)"}
                strokeWidth={1}
              />
              <text x={paddingLeft - 6} y={y + 3} textAnchor="end" fontSize={9} fill="var(--viz-muted)">
                {tick}
              </text>
            </g>
          );
        })}

        {bars.map((b, i) => {
          const barHeight = Math.max(0, (b.value / maxValue) * plotHeight);
          const x = paddingLeft + i * barSlot + (barSlot - barWidth) / 2;
          const y = yFor(b.value);
          const isHovered = hovered === i;
          const dayNumber = Number.parseInt(b.day.date.slice(8, 10), 10);
          return (
            <g key={b.day.date}>
              <rect
                x={paddingLeft + i * barSlot}
                y={paddingTop}
                width={barSlot}
                height={plotHeight}
                fill="transparent"
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
              />
              {b.color && (
                <path
                  d={roundedTopRectPath(x, y, barWidth, Math.max(barHeight, b.value > 0 ? 2 : 0), 4)}
                  fill={b.color}
                  opacity={isHovered ? 1 : 0.9}
                  className="pointer-events-none transition-opacity"
                />
              )}
              {(dayNumber === 1 || dayNumber % 5 === 0) && (
                <text
                  x={paddingLeft + i * barSlot + barSlot / 2}
                  y={height - 6}
                  textAnchor="middle"
                  fontSize={9}
                  fill="var(--viz-muted)"
                >
                  {dayNumber}
                </text>
              )}
              {isHovered && b.value > 0 && (
                <g className="pointer-events-none">
                  <rect
                    x={Math.min(Math.max(x - 24, paddingLeft), width - 72)}
                    y={Math.max(y - 26, 2)}
                    width={68}
                    height={20}
                    rx={5}
                    fill="var(--viz-text-primary)"
                  />
                  <text
                    x={Math.min(Math.max(x - 24, paddingLeft), width - 72) + 34}
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
