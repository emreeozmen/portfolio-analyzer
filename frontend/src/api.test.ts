import { afterEach, describe, expect, it, vi } from 'vitest'
import { getAssets, login } from './api'

function mockFetchOnce(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('parseErrorDetail (via login/getAssets error paths)', () => {
  it('surfaces a plain string detail as-is', async () => {
    mockFetchOnce(401, { detail: 'Invalid credentials' })

    await expect(login('user@example.com', 'wrong-pass')).rejects.toThrow('Invalid credentials')
  })

  it('unwraps a Pydantic validation-error list and strips the "Value error, " prefix', async () => {
    mockFetchOnce(422, {
      detail: [
        { msg: 'Value error, Şifre en az 8 karakter olmalıdır', loc: ['body', 'password'], type: 'value_error' },
      ],
    })

    await expect(login('user@example.com', 'short')).rejects.toThrow('Şifre en az 8 karakter olmalıdır')
  })

  it('joins multiple validation messages with a comma', async () => {
    mockFetchOnce(422, {
      detail: [
        { msg: 'Value error, Şifre en az bir harf içermelidir' },
        { msg: 'Value error, Şifre en az bir rakam içermelidir' },
      ],
    })

    await expect(login('user@example.com', '12345678')).rejects.toThrow(
      'Şifre en az bir harf içermelidir, Şifre en az bir rakam içermelidir',
    )
  })

  it('falls back to the provided message when detail is missing', async () => {
    mockFetchOnce(500, {})

    await expect(login('user@example.com', 'x')).rejects.toThrow('Login failed')
  })

  it('falls back to the provided message when the error body is not valid JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => {
          throw new SyntaxError('Unexpected end of JSON input')
        },
      }),
    )

    await expect(getAssets()).rejects.toThrow('Failed to load assets: 500')
  })

  it('resolves normally on a successful response', async () => {
    mockFetchOnce(200, [{ id: 1, ticker: 'THYAO', name: 'Türk Hava Yolları', currency: 'TRY' }])

    await expect(getAssets()).resolves.toEqual([
      { id: 1, ticker: 'THYAO', name: 'Türk Hava Yolları', currency: 'TRY' },
    ])
  })
})
