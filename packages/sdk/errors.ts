export function mapError(err: any): Error {
  const code = err?.code

  switch (code) {
    case 'InvalidAmount':
      return new Error('Invalid amount')
    case 'AlreadyFunded':
      return new Error('Already funded')
    case 'NotFunded':
      return new Error('Not funded')
    case 'InvoiceNotFound':
      return new Error('Invoice not found')
    case 'NotYetDefaulted':
      return new Error('Not yet defaulted')
    default:
      return new Error(err?.message || 'Unknown error')
  }
}