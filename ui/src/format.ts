import type { ModelRef, SessionStatus } from "./types"

export function relativeTime(ts?: number): string {
  if (!ts) return "—"
  const diff = Date.now() - ts
  if (diff < 0) return "now"
  const s = Math.round(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(ts).toLocaleDateString()
}

export function absoluteTime(ts?: number): string {
  return ts ? new Date(ts).toLocaleString() : "—"
}

export function formatNumber(n?: number): string {
  if (n === undefined || n === null || Number.isNaN(n)) return "0"
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(Math.round(n))
}

export function modelKey(ref?: ModelRef): string {
  if (!ref) return ""
  return ref.variant ? `${ref.providerID}/${ref.id}/${ref.variant}` : `${ref.providerID}/${ref.id}`
}

export function modelLabel(ref?: ModelRef): string {
  if (!ref) return "default"
  return `${ref.providerID}/${ref.id}${ref.variant ? ` (${ref.variant})` : ""}`
}

/**
 * v2 model `variants` is an array whose elements are either plain strings or
 * objects like `{ id: "low", settings: {...} }`. Return a display label for
 * one element, or `undefined` when nothing sensible can be shown.
 */
export function variantLabel(variant: unknown): string | undefined {
  if (variant === null || variant === undefined) return undefined
  if (typeof variant === "string") return variant.trim() || undefined
  if (typeof variant === "number" || typeof variant === "boolean") return String(variant)
  if (typeof variant === "object") {
    const obj = variant as Record<string, unknown>
    for (const key of ["name", "label", "title", "id"]) {
      const value = obj[key]
      if (typeof value === "string" && value.trim()) return value.trim()
      if (typeof value === "number") return String(value)
    }
  }
  return undefined
}

export function variantLabels(variants: unknown): string[] {
  if (!Array.isArray(variants)) return []
  const labels: string[] = []
  for (const v of variants) {
    const label = variantLabel(v)
    if (label && !labels.includes(label)) labels.push(label)
  }
  return labels
}

export function statusLabel(status?: SessionStatus): string {
  switch (status) {
    case "busy":
      return "busy"
    case "retry":
      return "retry"
    case "idle":
      return "idle"
    default:
      return "unknown"
  }
}

export function pct(used?: number, limit?: number): number {
  if (!limit || limit <= 0) return 0
  return Math.min(100, Math.round(((used ?? 0) / limit) * 100))
}

export function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}
