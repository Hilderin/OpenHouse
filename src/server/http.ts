import type { Context } from "hono"

export function fail(c: Context, status: number, code: string, message: string, details?: unknown) {
  return c.json({ error: { code, message, details } }, status as 400)
}

export function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
