import React, { createContext, useContext, useMemo, useState } from 'react';

export const SUPPORTED_LOCALES = ['en', 'es', 'fr'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const RTL_LOCALES: readonly string[] = ['ar', 'he', 'fa', 'ur'];

export interface TranslationParams {
  count?: number;
  [key: string]: string | number | undefined;
}

type PluralTranslation = { one: string; other: string };
type TranslationValue = string | PluralTranslation;
type TranslationTree = { [key: string]: TranslationValue | TranslationTree };

const translations: Record<Locale, TranslationTree> = {
  en: {
    common: {
      cancel: 'Cancel', confirm: 'Confirm', close: 'Close', loading: 'Loading…',
      retry: 'Retry', save: 'Save', submit: 'Submit', continue: 'Continue',
      language: 'Language', languageEnglish: 'English', languageSpanish: 'Spanish',
      languageFrench: 'French', switchLanguage: 'Switch language',
    },
    invoice: {
      invoice: 'Invoice', invoices: { one: '1 invoice', other: '{{count}} invoices' },
      invoiceNumber: 'Invoice #{{id}}', payer: 'Payer', payerPlaceholder: 'Payer address (G…)',
      amount: 'Amount', amountPlaceholder: 'Enter amount', discountRate: 'Discount rate',
      discountRatePlaceholder: 'Enter discount rate', dueDate: 'Due date',
      dueDatePlaceholder: 'Select a due date', token: 'Payment token', status: 'Status',
      submitted: 'Submitted', pending: 'Pending', funded: 'Funded', paid: 'Paid',
      defaulted: 'Defaulted', cancelled: 'Cancelled', expired: 'Expired',
    },
    submit: {
      title: 'Submit an invoice', description: 'Turn an unpaid invoice into instant liquidity.',
      freelancer: 'Freelancer address', freelancerPlaceholder: 'Your Stellar address (G…)',
      submitInvoice: 'Submit invoice', submitting: 'Submitting…',
      success: 'Invoice #{{id}} was submitted successfully.', confirmation: 'Submit this invoice?',
      confirmationDescription: 'Please review the invoice details before submitting.',
      required: 'This field is required.', invalidAddress: 'Enter a valid Stellar address.',
      invalidAmount: 'Enter an amount greater than zero.', invalidDueDate: 'Choose a future due date.',
      invalidDiscountRate: 'Enter a valid discount rate.', submissionFailed: 'Invoice submission failed.',
    },
    funding: {
      title: 'Fund invoices', description: 'Provide liquidity and earn yield from invoice payments.',
      fund: 'Fund invoice', funding: 'Funding…', fundNow: 'Fund now', expectedReturn: 'Expected return',
      fundingAmount: 'Funding amount', confirmation: 'Fund this invoice?',
      confirmationDescription: 'Your liquidity will be locked until the invoice is settled.',
      success: 'Invoice #{{id}} was funded successfully.', alreadyFunded: 'This invoice has already been funded.',
      fundingFailed: 'Invoice funding failed.',
    },
    payment: {
      title: 'Pay invoice', description: 'Settle this invoice securely on Stellar.', invoiceDetails: 'Invoice details',
      amountDue: 'Amount due', pay: 'Pay invoice', paying: 'Processing payment…', confirmation: 'Pay this invoice?',
      confirmationDescription: 'The payment will settle the outstanding invoice.', success: 'Payment completed successfully.',
      alreadyPaid: 'This invoice has already been paid.', paymentFailed: 'Payment failed.', invoiceNotFound: 'Invoice not found.',
    },
    dashboard: {
      title: 'Freelancer dashboard', overview: 'Overview', totalInvoices: 'Total invoices',
      pendingInvoices: 'Pending invoices', fundedInvoices: 'Funded invoices', paidInvoices: 'Paid invoices',
      totalValue: 'Total value', recentInvoices: 'Recent invoices', noInvoices: 'No invoices yet.',
    },
    lp: {
      title: 'Liquidity provider dashboard', portfolio: 'Portfolio', totalInvested: 'Total invested',
      totalYield: 'Total yield', activePositions: 'Active positions', completedPositions: 'Completed positions',
      defaultedPositions: 'Defaulted positions', risk: 'Risk analytics', concentrationRisk: 'Concentration risk',
      herdRisk: 'Herd risk', positions: { one: '1 position', other: '{{count}} positions' },
    },
    errors: {
      generic: 'Something went wrong.', network: 'Network request failed.', timeout: 'The request timed out.',
      insufficientBalance: 'Insufficient balance to complete the transaction.', invoiceNotFound: 'Invoice #{{id}} not found.',
      invoiceAlreadyFunded: 'Invoice #{{id}} has already been funded.', invoiceAlreadyPaid: 'Invoice #{{id}} has already been paid.',
      invoiceNotFunded: 'Invoice #{{id}} is not funded yet.', unauthorized: 'You are not authorized to perform this operation.',
      transactionFailed: 'The transaction failed.',
    },
  },
  es: {
    common: {
      cancel: 'Cancelar', confirm: 'Confirmar', close: 'Cerrar', loading: 'Cargando…', retry: 'Reintentar',
      save: 'Guardar', submit: 'Enviar', continue: 'Continuar', language: 'Idioma', languageEnglish: 'Inglés',
      languageSpanish: 'Español', languageFrench: 'Francés', switchLanguage: 'Cambiar idioma',
    },
    invoice: {
      invoice: 'Factura', invoices: { one: '1 factura', other: '{{count}} facturas' }, invoiceNumber: 'Factura n.º {{id}}',
      payer: 'Pagador', payerPlaceholder: 'Dirección del pagador (G…)', amount: 'Importe', amountPlaceholder: 'Introduce el importe',
      discountRate: 'Tasa de descuento', discountRatePlaceholder: 'Introduce la tasa de descuento', dueDate: 'Fecha de vencimiento',
      dueDatePlaceholder: 'Selecciona una fecha de vencimiento', token: 'Token de pago', status: 'Estado', submitted: 'Enviada',
      pending: 'Pendiente', funded: 'Financiada', paid: 'Pagada', defaulted: 'Incumplida', cancelled: 'Cancelada', expired: 'Caducada',
    },
    submit: {
      title: 'Enviar una factura', description: 'Convierte una factura impagada en liquidez inmediata.', freelancer: 'Dirección del profesional',
      freelancerPlaceholder: 'Tu dirección de Stellar (G…)', submitInvoice: 'Enviar factura', submitting: 'Enviando…',
      success: 'La factura n.º {{id}} se ha enviado correctamente.', confirmation: '¿Enviar esta factura?', confirmationDescription: 'Revisa los datos antes de enviarla.',
      required: 'Este campo es obligatorio.', invalidAddress: 'Introduce una dirección de Stellar válida.', invalidAmount: 'Introduce un importe mayor que cero.',
      invalidDueDate: 'Elige una fecha de vencimiento futura.', invalidDiscountRate: 'Introduce una tasa de descuento válida.', submissionFailed: 'No se pudo enviar la factura.',
    },
    funding: {
      title: 'Financiar facturas', description: 'Proporciona liquidez y obtén rendimiento de los pagos.', fund: 'Financiar factura', funding: 'Financiando…',
      fundNow: 'Financiar ahora', expectedReturn: 'Rendimiento esperado', fundingAmount: 'Importe de financiación', confirmation: '¿Financiar esta factura?',
      confirmationDescription: 'Tu liquidez permanecerá bloqueada hasta la liquidación.', success: 'La factura n.º {{id}} se ha financiado correctamente.',
      alreadyFunded: 'Esta factura ya ha sido financiada.', fundingFailed: 'No se pudo financiar la factura.',
    },
    payment: {
      title: 'Pagar factura', description: 'Liquida esta factura de forma segura en Stellar.', invoiceDetails: 'Datos de la factura', amountDue: 'Importe pendiente',
      pay: 'Pagar factura', paying: 'Procesando el pago…', confirmation: '¿Pagar esta factura?', confirmationDescription: 'El pago liquidará la factura pendiente.',
      success: 'El pago se ha completado correctamente.', alreadyPaid: 'Esta factura ya ha sido pagada.', paymentFailed: 'El pago ha fallado.', invoiceNotFound: 'Factura no encontrada.',
    },
    dashboard: {
      title: 'Panel del profesional', overview: 'Resumen', totalInvoices: 'Facturas totales', pendingInvoices: 'Facturas pendientes',
      fundedInvoices: 'Facturas financiadas', paidInvoices: 'Facturas pagadas', totalValue: 'Valor total', recentInvoices: 'Facturas recientes', noInvoices: 'Aún no hay facturas.',
    },
    lp: {
      title: 'Panel del proveedor de liquidez', portfolio: 'Cartera', totalInvested: 'Total invertido', totalYield: 'Rendimiento total',
      activePositions: 'Posiciones activas', completedPositions: 'Posiciones completadas', defaultedPositions: 'Posiciones incumplidas', risk: 'Análisis de riesgo',
      concentrationRisk: 'Riesgo de concentración', herdRisk: 'Riesgo de comportamiento gregario', positions: { one: '1 posición', other: '{{count}} posiciones' },
    },
    errors: {
      generic: 'Algo ha salido mal.', network: 'La solicitud de red ha fallado.', timeout: 'La solicitud ha agotado el tiempo de espera.',
      insufficientBalance: 'Saldo insuficiente para completar la transacción.', invoiceNotFound: 'No se ha encontrado la factura n.º {{id}}.',
      invoiceAlreadyFunded: 'La factura n.º {{id}} ya ha sido financiada.', invoiceAlreadyPaid: 'La factura n.º {{id}} ya ha sido pagada.',
      invoiceNotFunded: 'La factura n.º {{id}} aún no está financiada.', unauthorized: 'No tienes autorización para realizar esta operación.', transactionFailed: 'La transacción ha fallado.',
    },
  },
  fr: {
    common: {
      cancel: 'Annuler', confirm: 'Confirmer', close: 'Fermer', loading: 'Chargement…', retry: 'Réessayer', save: 'Enregistrer',
      submit: 'Envoyer', continue: 'Continuer', language: 'Langue', languageEnglish: 'Anglais', languageSpanish: 'Espagnol', languageFrench: 'Français', switchLanguage: 'Changer de langue',
    },
    invoice: {
      invoice: 'Facture', invoices: { one: '1 facture', other: '{{count}} factures' }, invoiceNumber: 'Facture n° {{id}}', payer: 'Payeur', payerPlaceholder: 'Adresse du payeur (G…)', amount: 'Montant', amountPlaceholder: 'Saisissez le montant',
      discountRate: 'Taux de remise', discountRatePlaceholder: 'Saisissez le taux de remise', dueDate: 'Date d’échéance', dueDatePlaceholder: 'Sélectionnez une date d’échéance', token: 'Jeton de paiement', status: 'Statut', submitted: 'Soumise', pending: 'En attente', funded: 'Financée', paid: 'Payée', defaulted: 'En défaut', cancelled: 'Annulée', expired: 'Expirée',
    },
    submit: {
      title: 'Soumettre une facture', description: 'Transformez une facture impayée en liquidité immédiate.', freelancer: 'Adresse du freelance', freelancerPlaceholder: 'Votre adresse Stellar (G…)', submitInvoice: 'Soumettre la facture', submitting: 'Envoi…', success: 'La facture n° {{id}} a été soumise avec succès.', confirmation: 'Soumettre cette facture ?', confirmationDescription: 'Vérifiez les détails avant de la soumettre.', required: 'Ce champ est obligatoire.', invalidAddress: 'Saisissez une adresse Stellar valide.', invalidAmount: 'Saisissez un montant supérieur à zéro.', invalidDueDate: 'Choisissez une date d’échéance future.', invalidDiscountRate: 'Saisissez un taux de remise valide.', submissionFailed: 'Échec de l’envoi de la facture.',
    },
    funding: {
      title: 'Financer des factures', description: 'Fournissez de la liquidité et gagnez un rendement sur les paiements.', fund: 'Financer la facture', funding: 'Financement…', fundNow: 'Financer maintenant', expectedReturn: 'Rendement attendu', fundingAmount: 'Montant du financement', confirmation: 'Financer cette facture ?', confirmationDescription: 'Votre liquidité sera bloquée jusqu’au règlement.', success: 'La facture n° {{id}} a été financée avec succès.', alreadyFunded: 'Cette facture est déjà financée.', fundingFailed: 'Échec du financement de la facture.',
    },
    payment: {
      title: 'Payer la facture', description: 'Réglez cette facture en toute sécurité sur Stellar.', invoiceDetails: 'Détails de la facture', amountDue: 'Montant dû', pay: 'Payer la facture', paying: 'Traitement du paiement…', confirmation: 'Payer cette facture ?', confirmationDescription: 'Le paiement réglera la facture impayée.', success: 'Le paiement a été effectué avec succès.', alreadyPaid: 'Cette facture a déjà été payée.', paymentFailed: 'Échec du paiement.', invoiceNotFound: 'Facture introuvable.',
    },
    dashboard: {
      title: 'Tableau de bord du freelance', overview: 'Vue d’ensemble', totalInvoices: 'Total des factures', pendingInvoices: 'Factures en attente', fundedInvoices: 'Factures financées', paidInvoices: 'Factures payées', totalValue: 'Valeur totale', recentInvoices: 'Factures récentes', noInvoices: 'Aucune facture pour le moment.',
    },
    lp: {
      title: 'Tableau de bord du fournisseur de liquidité', portfolio: 'Portefeuille', totalInvested: 'Total investi', totalYield: 'Rendement total', activePositions: 'Positions actives', completedPositions: 'Positions terminées', defaultedPositions: 'Positions en défaut', risk: 'Analyse des risques', concentrationRisk: 'Risque de concentration', herdRisk: 'Risque de comportement grégaire', positions: { one: '1 position', other: '{{count}} positions' },
    },
    errors: {
      generic: 'Une erreur s’est produite.', network: 'La requête réseau a échoué.', timeout: 'La requête a dépassé le délai d’attente.', insufficientBalance: 'Solde insuffisant pour terminer la transaction.', invoiceNotFound: 'Facture n° {{id}} introuvable.', invoiceAlreadyFunded: 'La facture n° {{id}} est déjà financée.', invoiceAlreadyPaid: 'La facture n° {{id}} est déjà payée.', invoiceNotFunded: 'La facture n° {{id}} n’est pas encore financée.', unauthorized: 'Vous n’êtes pas autorisé à effectuer cette opération.', transactionFailed: 'La transaction a échoué.',
    },
  },
};

function isPlural(value: TranslationValue | TranslationTree): value is PluralTranslation {
  return typeof value === 'object' && value !== null && 'one' in value && 'other' in value;
}

function getValue(tree: TranslationTree, key: string): TranslationValue | undefined {
  let value: TranslationValue | TranslationTree = tree;
  for (const part of key.split('.')) {
    if (typeof value === 'string' || isPlural(value)) return undefined;
    value = value[part];
    if (value === undefined) return undefined;
  }
  return value as TranslationValue;
}

function interpolate(value: string, params: TranslationParams): string {
  return value.replace(/{{\s*([^}\s]+)\s*}}/g, (_, name: string) => {
    const replacement = params[name];
    return replacement === undefined ? `{{${name}}}` : String(replacement);
  });
}

export function translate(locale: Locale, key: string, params: TranslationParams = {}): string {
  const value = getValue(translations[locale], key) ?? getValue(translations.en, key);
  if (value === undefined) return key;
  if (typeof value === 'string') return interpolate(value, params);
  return interpolate(params.count === 1 ? value.one : value.other, params);
}

export function formatNumber(value: number, locale: Locale, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(locale, options).format(value);
}

export function formatDate(value: Date | number, locale: Locale, options?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(locale, options).format(value);
}

export interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, params?: TranslationParams) => string;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  formatDate: (value: Date | number, options?: Intl.DateTimeFormatOptions) => string;
  direction: 'ltr' | 'rtl';
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children, initialLocale = 'en' }: { children: React.ReactNode; initialLocale?: Locale }): React.ReactElement {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const value = useMemo<I18nContextValue>(() => ({
    locale,
    setLocale,
    t: (key, params) => translate(locale, key, params),
    formatNumber: (number, options) => formatNumber(number, locale, options),
    formatDate: (date, options) => formatDate(date, locale, options),
    direction: RTL_LOCALES.includes(locale) ? 'rtl' : 'ltr',
  }), [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n must be used within an I18nProvider');
  return context;
}

export function LanguageSwitcher(): React.ReactElement {
  const { locale, setLocale, t } = useI18n();
  return (
    <label>
      <span className="sr-only">{t('common.switchLanguage')}</span>
      <select aria-label={t('common.switchLanguage')} value={locale} onChange={(event) => setLocale(event.target.value as Locale)}>
        <option value="en">{t('common.languageEnglish')}</option>
        <option value="es">{t('common.languageSpanish')}</option>
        <option value="fr">{t('common.languageFrench')}</option>
      </select>
    </label>
  );
}

export { translations };
