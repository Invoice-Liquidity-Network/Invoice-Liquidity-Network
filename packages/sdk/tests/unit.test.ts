import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  submitInvoice,
  fundInvoice,
  markPaid,
  claimDefault,
} from '../index'

/**
 * Mock contract invocation layer
 * This simulates the Stellar contract call function
 */
let mockInvoke: ReturnType<typeof vi.fn>

beforeEach(() => {
  mockInvoke = vi.fn()
})

/* -----------------------------
   submitInvoice
------------------------------*/
describe('submitInvoice', () => {
  it('returns invoice ID on success', async () => {
    mockInvoke.mockResolvedValue({ result: 1 })

    const result = await submitInvoice(mockInvoke, {
      freelancer: 'A',
      payer: 'B',
      amount: 100,
      dueDate: 123,
      discountRate: 300,
    })

    expect(result).toBe(1)
  })

  it('throws validation error for invalid amount', async () => {
    await expect(
      submitInvoice(mockInvoke, {
        freelancer: 'A',
        payer: 'B',
        amount: 0,
        dueDate: 123,
        discountRate: 300,
      } as any)
    ).rejects.toThrow('Invalid amount')
  })

  it('handles network error', async () => {
    mockInvoke.mockRejectedValue(new Error('network fail'))

    await expect(
      submitInvoice(mockInvoke, {
        freelancer: 'A',
        payer: 'B',
        amount: 100,
        dueDate: 123,
        discountRate: 300,
      })
    ).rejects.toThrow('network fail')
  })

  it('maps contract error', async () => {
    mockInvoke.mockRejectedValue({ code: 'InvalidAmount' })

    await expect(
      submitInvoice(mockInvoke, {
        freelancer: 'A',
        payer: 'B',
        amount: 100,
        dueDate: 123,
        discountRate: 300,
      })
    ).rejects.toThrow('Invalid amount')
  })
})

/* -----------------------------
   fundInvoice
------------------------------*/
describe('fundInvoice', () => {
  it('succeeds', async () => {
    mockInvoke.mockResolvedValue({})

    await expect(
      fundInvoice(mockInvoke, { funder: 'A', invoiceId: 1 })
    ).resolves.toBeUndefined()
  })

  it('rejects invalid params', async () => {
    await expect(
      fundInvoice(mockInvoke, { invoiceId: 0 } as any)
    ).rejects.toThrow('Invalid invoiceId')
  })

  it('handles network error', async () => {
    mockInvoke.mockRejectedValue(new Error('fail'))

    await expect(
      fundInvoice(mockInvoke, { funder: 'A', invoiceId: 1 })
    ).rejects.toThrow('fail')
  })

  it('maps contract error: already funded', async () => {
    mockInvoke.mockRejectedValue({ code: 'AlreadyFunded' })

    await expect(
      fundInvoice(mockInvoke, { funder: 'A', invoiceId: 1 })
    ).rejects.toThrow('Already funded')
  })
})

/* -----------------------------
   markPaid
------------------------------*/
describe('markPaid', () => {
  it('succeeds', async () => {
    mockInvoke.mockResolvedValue({})

    await expect(
      markPaid(mockInvoke, { invoiceId: 1 })
    ).resolves.toBeUndefined()
  })

  it('rejects invalid params', async () => {
    await expect(
      markPaid(mockInvoke, { invoiceId: 0 } as any)
    ).rejects.toThrow('Invalid invoiceId')
  })

  it('handles network error', async () => {
    mockInvoke.mockRejectedValue(new Error('fail'))

    await expect(
      markPaid(mockInvoke, { invoiceId: 1 })
    ).rejects.toThrow('fail')
  })

  it('maps contract error: not funded', async () => {
    mockInvoke.mockRejectedValue({ code: 'NotFunded' })

    await expect(
      markPaid(mockInvoke, { invoiceId: 1 })
    ).rejects.toThrow('Not funded')
  })
})

/* -----------------------------
   claimDefault
------------------------------*/
describe('claimDefault', () => {
  it('succeeds', async () => {
    mockInvoke.mockResolvedValue({})

    await expect(
      claimDefault(mockInvoke, { invoiceId: 1 })
    ).resolves.toBeUndefined()
  })

  it('rejects invalid params', async () => {
    await expect(
      claimDefault(mockInvoke, { invoiceId: 0 } as any)
    ).rejects.toThrow('Invalid invoiceId')
  })

  it('handles network error', async () => {
    mockInvoke.mockRejectedValue(new Error('fail'))

    await expect(
      claimDefault(mockInvoke, { invoiceId: 1 })
    ).rejects.toThrow('fail')
  })

  it('maps contract error: not yet defaulted', async () => {
    mockInvoke.mockRejectedValue({ code: 'NotYetDefaulted' })

    await expect(
      claimDefault(mockInvoke, { invoiceId: 1 })
    ).rejects.toThrow('Not yet defaulted')
  })
})