import { describe, expect, it } from 'vitest';
import { DEFAULT_ENDPOINTS } from './probes';
import { renderMarkdown } from './report';
import { runSuite } from './runner';
import { SCENARIOS } from './scenarios';
import { ToxiproxyClient } from './toxiproxy-client';

/**
 * Live chaos suite. Needs the stack from tests/chaos/docker-compose.chaos.yml
 * and is skipped unless CHAOS_TOXIPROXY_URL is set, so `pnpm test` never
 * depends on containers. `pnpm chaos:run` gives the same run with a report.
 */
const TOXIPROXY_URL = process.env.CHAOS_TOXIPROXY_URL;
const live = TOXIPROXY_URL ? describe : describe.skip;
const filter = process.env.CHAOS_SCENARIOS?.split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const scenarios = filter?.length ? SCENARIOS.filter((s) => filter.includes(s.name)) : SCENARIOS;
const timeScale = Number(process.env.CHAOS_TIME_SCALE ?? 1);
const budgetMs =
  scenarios.reduce((sum, s) => sum + (s.durationMs + s.recoveryTimeoutMs) * timeScale, 0) + 60_000;

live('chaos suite against the running stack', () => {
  it(
    'every resilience scenario passes',
    async () => {
      const results = await runSuite(scenarios, {
        toxiproxy: new ToxiproxyClient(TOXIPROXY_URL!),
        endpoints: DEFAULT_ENDPOINTS,
        timeScale,
        log: (line) => console.log(line),
      });
      console.log(renderMarkdown(results));
      expect(
        results
          .filter((r) => !r.ok)
          .map((r) => `${r.scenario}: ${r.error ?? 'expectations failed'}`)
      ).toEqual([]);
    },
    budgetMs
  );
});
