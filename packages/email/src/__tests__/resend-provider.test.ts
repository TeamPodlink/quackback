import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const resendMock = vi.hoisted(() => ({
  send: vi.fn(),
}))

vi.mock('resend', () => ({
  Resend: class {
    emails = {
      send: resendMock.send,
    }
  },
}))

const ENV_KEYS = [
  'EMAIL_SMTP_HOST',
  'EMAIL_SMTP_PORT',
  'EMAIL_SMTP_USER',
  'EMAIL_SMTP_PASS',
  'EMAIL_RESEND_API_KEY',
  'RESEND_API_KEY',
  'EMAIL_RESEND_REQUESTS_PER_SECOND',
  'RESEND_REQUESTS_PER_SECOND',
  'EMAIL_FROM',
]

const savedEnv: Record<string, string | undefined> = {}

describe('Resend provider', () => {
  beforeEach(() => {
    vi.resetModules()
    resendMock.send.mockReset()
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key]
      delete process.env[key]
    }

    process.env.EMAIL_RESEND_API_KEY = 're_test_123'
    process.env.EMAIL_FROM = 'Podlink Feedback <noreply@mail.pod.link>'
    process.env.EMAIL_RESEND_REQUESTS_PER_SECOND = '1000'
  })

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] !== undefined) {
        process.env[key] = savedEnv[key]
      } else {
        delete process.env[key]
      }
    }
  })

  it('sends email through Resend when configured', async () => {
    resendMock.send.mockResolvedValueOnce({ data: { id: 'email_123' }, error: null })

    const { sendMagicLinkEmail } = await import('../index')
    await expect(
      sendMagicLinkEmail({
        to: 'test@example.com',
        signInUrl: 'https://example.com/verify-magic-link?token=abc',
        code: '123456',
      })
    ).resolves.toEqual({ sent: true })

    expect(resendMock.send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'Podlink Feedback <noreply@mail.pod.link>',
        to: 'test@example.com',
        subject: 'Your Quackback sign-in link',
      })
    )
  })

  it('preserves Resend rate-limit status for retry handling', async () => {
    resendMock.send.mockResolvedValueOnce({
      data: null,
      error: {
        name: 'rate_limit_exceeded',
        message: 'Too many requests. You can only make 5 requests per second.',
        statusCode: 429,
      },
    })

    const { sendMagicLinkEmail } = await import('../index')
    await expect(
      sendMagicLinkEmail({
        to: 'test@example.com',
        signInUrl: 'https://example.com/verify-magic-link?token=abc',
        code: '123456',
      })
    ).rejects.toMatchObject({
      name: 'rate_limit_exceeded',
      code: 'rate_limit_exceeded',
      status: 429,
      provider: 'resend',
    })
  })
})
