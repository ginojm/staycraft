type ApiError = { error?: string; details?: Array<{ field: string; message: string }> }

export const apiBaseUrl = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')

export async function apiRequest<T>(
  path: string,
  token?: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers)
  headers.set('Accept', 'application/json')
  if (options.body) headers.set('Content-Type', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const response = await fetch(`${apiBaseUrl}/api${path}`, { ...options, headers })
  if (response.status === 204) return undefined as T

  const payload = await response.json() as ApiError & T
  if (!response.ok) {
    const detail = payload.details?.[0]?.message
    throw new Error(detail ? `${payload.error ?? 'Erreur API'} ${detail}` : payload.error ?? 'Une erreur est survenue.')
  }
  return payload
}
