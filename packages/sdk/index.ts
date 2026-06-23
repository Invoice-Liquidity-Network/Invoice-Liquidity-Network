// sdk/index.ts

import { mapError } from './errors'

export async function submitInvoice(invoke: any, params: {
  freelancer: string
  payer: string
  amount: number
  dueDate: number
  discountRate: number
}) {
  if (!params.amount || params.amount <= 0) {
    throw new Error('Invalid amount')
  }

  try {
    const res = await invoke('submit_invoice', params)
    return res.result
  } catch (err: any) {
    throw mapError(err)
  }
}

export async function fundInvoice(invoke: any, params: {
  funder: string
  invoiceId: number
}) {
  if (!params.invoiceId) {
    throw new Error('Invalid invoiceId')
  }

  try {
    await invoke('fund_invoice', params)
  } catch (err: any) {
    throw mapError(err)
  }
}

export async function markPaid(invoke: any, params: {
  invoiceId: number
}) {
  if (!params.invoiceId) {
    throw new Error('Invalid invoiceId')
  }

  try {
    await invoke('mark_paid', params)
  } catch (err: any) {
    throw mapError(err)
  }
}

export async function claimDefault(invoke: any, params: {
  invoiceId: number
}) {
  if (!params.invoiceId) {
    throw new Error('Invalid invoiceId')
  }

  try {
    await invoke('claim_default', params)
  } catch (err: any) {
    throw mapError(err)
  }
}

export async function getInvoice(invoke: any, params: {
  invoiceId: number
}) {
  if (!params.invoiceId) {
    throw new Error('Invalid invoiceId')
  }

  try {
    const res = await invoke('get_invoice', params)
    return res
  } catch (err: any) {
    throw mapError(err)
  }
}