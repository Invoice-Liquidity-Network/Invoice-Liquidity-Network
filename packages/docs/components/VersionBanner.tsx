import {
  CONTRACT_ID,
  CONTRACT_VERSION,
  NETWORK,
  SDK_VERSION,
  shortContractId,
} from '../lib/docs-version';

/**
 * Contents of the site-wide version banner.
 *
 * The docs site is single-track — it always describes the latest development
 * version of the protocol — so every page needs to say, up front, which
 * contract and SDK release the prose was written against. Readers can then
 * compare that against whatever they have deployed instead of guessing.
 *
 * The wrapping `<Banner>` (and its dismissal storage key) lives in
 * `app/layout.tsx`; this component only renders the message.
 */
export function VersionBanner() {
  return (
    <span>
      These docs track the <strong>latest</strong> release on Stellar {NETWORK} — contract{' '}
      <code title={CONTRACT_ID}>
        v{CONTRACT_VERSION} ({shortContractId()})
      </code>{' '}
      and SDK <code>v{SDK_VERSION}</code>.{' '}
      <a href="/versioning" style={{ textDecoration: 'underline' }}>
        Check your versions
      </a>
    </span>
  );
}
