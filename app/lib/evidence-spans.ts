// ============================================================
// EVIDENCE SPANS
//
// Client-safe helpers that locate a verified quotation inside the
// original notes so the UI can show exactly which words support
// which invoice field. No Node-only imports: this module is used
// by both the browser (Evidence Lens) and the server (Proof Gate).
// ============================================================

export type QuoteSpan = {
  start: number;
  end: number;
};

export type HighlightRange = QuoteSpan & {
  key: string;
};

export type HighlightSegment = {
  text: string;
  start: number;
  end: number;
  keys: string[];
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Finds where `quote` appears in `source`.
 *
 * 1. Exact match.
 * 2. Case-insensitive match that tolerates whitespace differences
 *    (the same tolerance the Proof Ledger applies when verifying).
 *
 * Returns null when the quote cannot be located, e.g. when the only
 * difference is Unicode compatibility normalization.
 */
export function locateQuote(
  source: string,
  quote: string | null | undefined
): QuoteSpan | null {
  if (!quote) return null;

  const trimmed = quote.trim();

  if (!trimmed) return null;

  const direct = source.indexOf(trimmed);

  if (direct >= 0) {
    return { start: direct, end: direct + trimmed.length };
  }

  const pattern = trimmed
    .split(/\s+/)
    .map(escapeRegExp)
    .join("\\s+");

  try {
    const match = new RegExp(pattern, "iu").exec(source);

    if (match) {
      return {
        start: match.index,
        end: match.index + match[0].length,
      };
    }
  } catch {
    // An unusual quotation that cannot compile is simply not located.
  }

  return null;
}

export function spansOverlap(a: QuoteSpan, b: QuoteSpan): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * Splits `source` into contiguous segments. Each segment records which
 * ranges (by key) cover it, so overlapping quotations are rendered
 * correctly instead of being dropped.
 */
export function buildHighlightSegments(
  source: string,
  ranges: HighlightRange[]
): HighlightSegment[] {
  const valid = ranges.filter(
    (range) =>
      Number.isInteger(range.start) &&
      Number.isInteger(range.end) &&
      range.start >= 0 &&
      range.end <= source.length &&
      range.start < range.end
  );

  const boundaries = new Set<number>([0, source.length]);

  for (const range of valid) {
    boundaries.add(range.start);
    boundaries.add(range.end);
  }

  const points = [...boundaries].sort((a, b) => a - b);
  const segments: HighlightSegment[] = [];

  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];

    if (start === end) continue;

    segments.push({
      text: source.slice(start, end),
      start,
      end,
      keys: valid
        .filter((range) => range.start <= start && range.end >= end)
        .map((range) => range.key),
    });
  }

  return segments;
}
