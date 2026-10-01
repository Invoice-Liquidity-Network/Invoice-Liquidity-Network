import { Command } from 'commander';
import { ILNEventIndexer } from '@iln/indexer';
import { parse as json2csv } from 'json2csv';
import { xdr } from '@stellar/stellar-sdk';

const program = new Command();

program
  .name('portfolio-report')
  .description('Generate a portfolio report for LPs and freelancers using ILN')
  .requiredOption('-w, --wallet <address>', 'Wallet address (Stellar public key)')
  .option('-n, --network <url>', 'Horizon network URL', 'https://horizon-testnet.stellar.org')
  .option('-c, --contract <id>', 'ILN contract ID', 'CC7Q5X...') // Placeholder for testnet contract
  .option('-f, --format <type>', 'Output format: json or csv', 'json')
  .option('--start-date <date>', 'Start date (ISO format, e.g. 2024-01-01)')
  .option('--end-date <date>', 'End date (ISO format, e.g. 2024-12-31)')
  .parse(process.argv);

const options = program.opts();

/**
 * Attempts to decode a base64 XDR value into a usable JS value.
 */
function decodeXdrValue(value: unknown): any {
  if (typeof value === 'string') {
    try {
      const scVal = xdr.ScVal.fromXDR(value, 'base64');
      return scVal.value();
    } catch {
      return value;
    }
  }
  return value;
}

async function main() {
  const { wallet, network, contract, format, startDate, endDate } = options;

  console.error(`Fetching events for wallet ${wallet} on ${network}...`);
  const indexer = new ILNEventIndexer(contract, { horizonUrl: network });

  // Fetch all events for the wallet
  const allEvents = await indexer.getEventsForAddress(wallet);

  // Filter by date range if provided
  const start = startDate ? new Date(startDate) : new Date(0);
  const end = endDate ? new Date(endDate) : new Date();

  const events = allEvents.filter((e: any) => {
    const d = new Date(e.ledgerClosedAt);
    return d >= start && d <= end;
  });

  console.error(`Found ${events.length} events in the specified date range.`);

  // Data structures for the report
  const submitterInvoices: any[] = [];
  const fundedPositions: any[] = [];
  let totalEarnings = 0;
  let totalVolume = 0;
  const tokenBreakdown: Record<string, number> = {};

  for (const event of events) {
    const decodedValue = decodeXdrValue(event.value);

    // In soroban, topics often encode the actor or the ID.
    // We make best-effort assumptions based on standard ILN event types.
    if (event.type === 'InvoiceCreated') {
      submitterInvoices.push({
        txHash: event.txHash,
        ledgerClosedAt: event.ledgerClosedAt,
        type: event.type,
        topics: event.topics,
        value: decodedValue,
      });
      // Rough volume estimation based on value if it's a number
      if (typeof decodedValue === 'number' || typeof decodedValue === 'bigint') {
        totalVolume += Number(decodedValue);
      }
    }

    if (event.type === 'InvoiceFunded' || event.type === 'LiquidityAdded') {
      fundedPositions.push({
        txHash: event.txHash,
        ledgerClosedAt: event.ledgerClosedAt,
        type: event.type,
        topics: event.topics,
        value: decodedValue,
      });
    }

    if (event.type === 'InvoiceRepaid') {
      // Assuming earnings or repaid amounts are stored in value
      if (typeof decodedValue === 'number' || typeof decodedValue === 'bigint') {
        totalEarnings += Number(decodedValue);
      }
    }

    // Track per-token interactions if token address is in topics
    // For simplicity, we just count the events in this example
    const tokenStr = 'default_token';
    tokenBreakdown[tokenStr] = (tokenBreakdown[tokenStr] || 0) + 1;
  }

  const report = {
    wallet,
    network,
    dateRange: { start: start.toISOString(), end: end.toISOString() },
    summary: {
      totalEarnings,
      totalVolume,
      tokenBreakdown,
    },
    submitterInvoices,
    fundedPositions,
  };

  if (format.toLowerCase() === 'csv') {
    // Generate CSV for invoices
    try {
      const csvInvoices =
        submitterInvoices.length > 0
          ? json2csv(submitterInvoices.map((i) => ({ role: 'Submitter', ...i })))
          : 'No submitter invoices';

      const csvFunded =
        fundedPositions.length > 0
          ? json2csv(fundedPositions.map((i) => ({ role: 'LP', ...i })))
          : 'No funded positions';

      console.log('=== Submitter Invoices ===');
      console.log(csvInvoices);
      console.log('\n=== Funded Positions ===');
      console.log(csvFunded);
      console.log('\n=== Summary ===');
      console.log(`Total Earnings,Total Volume`);
      console.log(`${totalEarnings},${totalVolume}`);
    } catch (err) {
      console.error('Error generating CSV:', err);
    }
  } else {
    console.log(JSON.stringify(report, null, 2));
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
