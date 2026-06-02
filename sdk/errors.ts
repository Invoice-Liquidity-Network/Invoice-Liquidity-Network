import enMessages from './locales/en.json'

export type ErrorMessages = typeof enMessages

// Registry: locale name -> messages map
const locales: Record<string, ErrorMessages> = { en: enMessages }
let activeLocale = 'en'

/** Register a locale and switch to it. */
export function setLocale(locale: string, messages: ErrorMessages): void {
  locales[locale] = messages
  activeLocale = locale
}

function getMessage(code: string): string {
  const msgs = locales[activeLocale] ?? locales['en']
  return (msgs as Record<string, string>)[code] ?? msgs['Unknown']
}

export function mapError(err: any): Error {
  const code: string | undefined = err?.code
  // If no code, pass through the original error/message unchanged
  if (!code) {
    return err instanceof Error ? err : new Error(err?.message ?? getMessage('Unknown'))
  }
  const message = getMessage(code)
  const error = new Error(message)
  ;(error as any).code = code
  return error
}
