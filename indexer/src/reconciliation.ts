import { getDb, queryInvoices, upsertInvoice } from './db';
import { fetchInvoice } from './rpc';
import { pubsub, INVOICE_UPDATED } from './graphql/pubsub';
import { invalidateInvoiceCache } from './cache';

export async function runReconciliation() {
  console.log('[reconciliation] Starting state reconciliation job...');
  const invoices = queryInvoices({});
  let mismatches = 0;

  for (const inv of invoices) {
    try {
      const live = await fetchInvoice(inv.id);
      if (live) {
        if (live.status !== inv.status || live.funder !== (inv.funder ?? null)) {
          console.warn(`[reconciliation] Mismatch found for invoice ${inv.id}. Correcting...`);
          upsertInvoice(live);
          await invalidateInvoiceCache(inv.id);
          pubsub.publish(INVOICE_UPDATED, { invoiceUpdated: live, triggeringEvent: null });
          mismatches++;
        }
      }
    } catch (e) {
      console.error(`[reconciliation] Error fetching invoice ${inv.id}:`, e);
    }
  }

  console.log(`[reconciliation] Job complete. Found ${mismatches} mismatches.`);
}

export function startReconciliationScheduler(intervalMs = 3600000) {
  // Run once immediately, then on interval
  setTimeout(() => {
    runReconciliation().catch(e => console.error('[reconciliation] Job failed:', e));
  }, 10000);

  setInterval(() => {
    runReconciliation().catch(e => console.error('[reconciliation] Job failed:', e));
  }, intervalMs);
}
