import Database from 'better-sqlite3';
import {
  createDb,
  getProtocolStats,
  getLPStats,
  getFreelancerStats,
  getTopLPs,
  getQueryStats,
} from './src/db';

const DB_PATH = ':memory:';
const NUM_INVOICES = 100_000;
const FUNDERS = ['GAaaaaaa1', 'GAaaaaaa2', 'GAaaaaaa3', 'GAaaaaaa4', 'GAaaaaaa5'];
const FREELANCERS = ['GBbbbbbb1', 'GBbbbbbb2', 'GBbbbbbb3', 'GBbbbbbb4', 'GBbbbbbb5'];
const STATUSES = ['Pending', 'Funded', 'Paid', 'Defaulted'] as const;

function seedData(db: Database.Database, count: number): void {
  const insert = db.prepare(`
    INSERT INTO invoices (id, freelancer, payer, amount, due_date, discount_rate, status, funder, funded_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction(() => {
    for (let i = 1; i <= count; i++) {
      const status = STATUSES[Math.floor(Math.random() * STATUSES.length)];
      const funder =
        status !== 'Pending' ? FUNDERS[Math.floor(Math.random() * FUNDERS.length)] : null;
      const fundedAt =
        status !== 'Pending' ? Date.now() - Math.floor(Math.random() * 90 * 86400000) : null;
      insert.run(
        i,
        FREELANCERS[Math.floor(Math.random() * FREELANCERS.length)],
        'GCcccccc1',
        String(Math.floor(Math.random() * 1_000_000_000_000_000)),
        Date.now() + Math.floor(Math.random() * 365 * 86400000),
        Math.floor(Math.random() * 5000),
        status,
        funder,
        fundedAt ? Math.floor(fundedAt / 1000) : null,
        Date.now() - Math.floor(Math.random() * 365 * 86400000),
        Date.now()
      );
    }
  });

  console.log(`Seeding ${count} invoices...`);
  const start = Date.now();
  insertMany();
  console.log(`Seeded ${count} invoices in ${Date.now() - start}ms\n`);
}

function benchmark(label: string, fn: () => unknown, iterations = 5): number {
  // warmup
  fn();

  const times: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = Date.now();
    fn();
    times.push(Date.now() - start);
  }
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const min = Math.min(...times);
  const max = Math.max(...times);
  console.log(`  ${label}: avg=${avg.toFixed(2)}ms min=${min}ms max=${max}ms`);
  return avg;
}

function main() {
  const db = createDb(DB_PATH);
  seedData(db, NUM_INVOICES);

  console.log('=== Benchmarking Statistics Queries ===\n');

  const results: { name: string; avgMs: number }[] = [];

  // Protocol stats
  const protocolTime = benchmark('getProtocolStats', () => getProtocolStats());
  results.push({ name: 'getProtocolStats', avgMs: protocolTime });

  // LP stats
  const lpTime = benchmark('getLPStats (funder=GAaaaaaa1)', () => getLPStats('GAaaaaaa1'));
  results.push({ name: 'getLPStats', avgMs: lpTime });

  // Freelancer stats
  const flTime = benchmark('getFreelancerStats (freelancer=GBbbbbbb1)', () =>
    getFreelancerStats('GBbbbbbb1')
  );
  results.push({ name: 'getFreelancerStats', avgMs: flTime });

  // Top LPs - all time
  const topAllTime = benchmark("getTopLPs(10, 'all')", () => getTopLPs(10, 'all'));
  results.push({ name: 'getTopLPs(all)', avgMs: topAllTime });

  // Top LPs - this month
  const topMonthTime = benchmark("getTopLPs(10, 'month')", () => getTopLPs(10, 'month'));
  results.push({ name: 'getTopLPs(month)', avgMs: topMonthTime });

  // Top LPs - this week
  const topWeekTime = benchmark("getTopLPs(10, 'week')", () => getTopLPs(10, 'week'));
  results.push({ name: 'getTopLPs(week)', avgMs: topWeekTime });

  console.log('\n=== Query Stats ===');
  const stats = getQueryStats();
  console.log(`  Total queries: ${stats.queryCount}`);
  console.log(`  Total query time: ${stats.totalQueryTime}ms`);
  console.log(`  Avg query time: ${stats.avgQueryTime.toFixed(2)}ms`);

  console.log('\n=== Summary ===');
  console.log('Query performance after optimization:');
  for (const r of results) {
    console.log(`  ${r.name}: ${r.avgMs.toFixed(2)}ms`);
  }

  db.close();
}

main();
