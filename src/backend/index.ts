import type { Backend } from './types'
import { localBackend } from './local'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

let cached: Promise<Backend> | null = null
/** Supabase when VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY are set, otherwise the local dev backend. */
export function getBackend(): Promise<Backend> {
  cached ??= url && key ? import('./supabase').then((m) => m.createSupabaseBackend(url, key)) : Promise.resolve(localBackend)
  return cached
}
export const backendMode: Backend['mode'] = url && key ? 'supabase' : 'local'
export * from './types'
