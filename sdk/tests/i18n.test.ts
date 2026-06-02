import { describe, it, expect, afterEach } from 'vitest'
import { setLocale, mapError } from '../errors'
import enMessages from '../locales/en.json'
import frMessages from '../locales/fr.json'

// Reset to English after each test to avoid state leakage
afterEach(() => {
  setLocale('en', enMessages)
})

describe('locale switching', () => {
  it('defaults to English messages', () => {
    expect(mapError({ code: 'InvalidAmount' }).message).toBe('Invalid amount')
    expect(mapError({ code: 'AlreadyFunded' }).message).toBe('Already funded')
    expect(mapError({ code: 'NotFunded' }).message).toBe('Not funded')
    expect(mapError({ code: 'InvoiceNotFound' }).message).toBe('Invoice not found')
    expect(mapError({ code: 'NotYetDefaulted' }).message).toBe('Not yet defaulted')
  })

  it('switches to French messages', () => {
    setLocale('fr', frMessages)

    expect(mapError({ code: 'InvalidAmount' }).message).toBe('Montant invalide')
    expect(mapError({ code: 'AlreadyFunded' }).message).toBe('Déjà financé')
    expect(mapError({ code: 'NotFunded' }).message).toBe('Non financé')
    expect(mapError({ code: 'InvoiceNotFound' }).message).toBe('Facture introuvable')
    expect(mapError({ code: 'NotYetDefaulted' }).message).toBe('Pas encore en défaut')
  })

  it('falls back to Unknown message for unrecognised code', () => {
    expect(mapError({ code: 'WeirdCode' }).message).toBe('Unknown error')

    setLocale('fr', frMessages)
    expect(mapError({ code: 'WeirdCode' }).message).toBe('Erreur inconnue')
  })

  it('preserves error code on returned Error', () => {
    const err = mapError({ code: 'NotFunded' })
    expect((err as any).code).toBe('NotFunded')
  })

  it('can register and use a custom locale', () => {
    setLocale('es', {
      InvalidAmount: 'Cantidad inválida',
      AlreadyFunded: 'Ya financiado',
      NotFunded: 'No financiado',
      InvoiceNotFound: 'Factura no encontrada',
      NotYetDefaulted: 'Aún no en mora',
      Unknown: 'Error desconocido',
    })

    expect(mapError({ code: 'InvalidAmount' }).message).toBe('Cantidad inválida')
    expect(mapError({ code: 'NotFunded' }).message).toBe('No financiado')
  })

  it('reverts to English after reset', () => {
    setLocale('fr', frMessages)
    expect(mapError({ code: 'NotFunded' }).message).toBe('Non financé')

    setLocale('en', enMessages)
    expect(mapError({ code: 'NotFunded' }).message).toBe('Not funded')
  })
})
