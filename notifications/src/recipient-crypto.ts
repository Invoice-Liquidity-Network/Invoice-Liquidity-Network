/**
 * Recipient data protection at rest (issue #1280).
 *
 * Notification destinations (email addresses, phone numbers, webhook URLs) are
 * personal data. The durable delivery tables used to persist them verbatim —
 * `dispatch_attempts.destination`, the serialised subscription blob, and
 * `sent_notifications.destination` — so anyone with read access to the SQLite
 * file or a backup could harvest every subscriber's contact details.
 *
 * Two primitives, both keyed by `NOTIFICATIONS_RECIPIENT_KEY`:
 *
 * - **Tokenize** (`rtok:v1:<hmac>`): a deterministic keyed HMAC. Used where
 *   the value only has to be *compared* (dedup keys, the sent-notification
 *   ledger), never read back. Equal destinations still produce equal tokens,
 *   so idempotency and replay protection keep working.
 * - **Encrypt** (`renc:v1:<iv>.<tag>.<ciphertext>`): AES-256-GCM. Used where
 *   the value must be recovered to retry a delivery (the subscription blob in
 *   `dispatch_attempts`).
 *
 * Like the compliance audit key, the recipient key fails closed: production
 * refuses to start without one. `NOTIFICATIONS_RECIPIENT_KEY_PREVIOUS` keeps
 * rows written under the previous key readable (and their tokens matchable)
 * during a rotation — see docs/runbooks/notifications-dispatch-outcomes.md.
 */
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'crypto';

const TOKEN_PREFIX = 'rtok:v1:';
const CIPHER_PREFIX = 'renc:v1:';
const DEV_RECIPIENT_KEY = 'dev-notifications-recipient-key-do-not-use-in-production';

interface DerivedKeys {
  encryption: Buffer;
  tokenization: Buffer;
}

const derivedCache = new Map<string, DerivedKeys>();

function decodeKeyMaterial(raw: string, name: string): Buffer {
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, 'hex');
  }
  const decoded = Buffer.from(raw, 'base64');
  if (
    decoded.length === 32 &&
    decoded.toString('base64').replace(/=+$/, '') === raw.replace(/=+$/, '')
  ) {
    return decoded;
  }
  throw new Error(`${name} must be 32 bytes encoded as 64 hex characters or base64`);
}

function derive(material: Buffer): DerivedKeys {
  const subkey = (info: string) =>
    Buffer.from(hkdfSync('sha256', material, Buffer.alloc(0), info, 32));
  return {
    encryption: subkey('iln-notifications/recipient/encrypt/v1'),
    tokenization: subkey('iln-notifications/recipient/tokenize/v1'),
  };
}

function keysFor(raw: string, name: string): DerivedKeys {
  const cacheKey = `${name}:${raw}`;
  let keys = derivedCache.get(cacheKey);
  if (!keys) {
    const material =
      raw === DEV_RECIPIENT_KEY ? Buffer.from(raw, 'utf8') : decodeKeyMaterial(raw, name);
    keys = derive(material);
    derivedCache.set(cacheKey, keys);
  }
  return keys;
}

function currentKeys(): DerivedKeys {
  const raw = process.env.NOTIFICATIONS_RECIPIENT_KEY;
  if (!raw) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('NOTIFICATIONS_RECIPIENT_KEY is required in production');
    }
    return keysFor(DEV_RECIPIENT_KEY, 'NOTIFICATIONS_RECIPIENT_KEY');
  }
  return keysFor(raw, 'NOTIFICATIONS_RECIPIENT_KEY');
}

function previousKeys(): DerivedKeys | undefined {
  const raw = process.env.NOTIFICATIONS_RECIPIENT_KEY_PREVIOUS;
  return raw ? keysFor(raw, 'NOTIFICATIONS_RECIPIENT_KEY_PREVIOUS') : undefined;
}

/**
 * Validate the key configuration up front so a misconfigured deployment fails
 * at boot rather than on the first notification.
 */
export function assertRecipientKeyConfigured(): void {
  currentKeys();
  previousKeys();
}

function tokenWith(keys: DerivedKeys, value: string): string {
  return TOKEN_PREFIX + createHmac('sha256', keys.tokenization).update(value).digest('hex');
}

export function isRecipientToken(value: string): boolean {
  return value.startsWith(TOKEN_PREFIX);
}

export function isEncryptedRecipientData(value: string): boolean {
  return value.startsWith(CIPHER_PREFIX);
}

/** Deterministic, non-reversible token for a destination. Idempotent on tokens. */
export function tokenizeRecipient(value: string): string {
  if (value === '' || isRecipientToken(value)) return value;
  return tokenWith(currentKeys(), value);
}

/**
 * Every stored form a destination may have: the current-key token, the
 * previous-key token during a rotation, and the legacy plaintext written
 * before tokenization shipped. Lookups match any of them so an upgrade or
 * rotation never re-sends a notification that was already delivered.
 */
export function recipientLookupForms(value: string): string[] {
  if (value === '' || isRecipientToken(value)) return [value];
  const forms = [tokenWith(currentKeys(), value)];
  const previous = previousKeys();
  if (previous) forms.push(tokenWith(previous, value));
  forms.push(value);
  return forms;
}

export function encryptRecipientData(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', currentKeys().encryption, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${CIPHER_PREFIX}${iv.toString('base64')}.${tag.toString('base64')}.${ciphertext.toString(
    'base64'
  )}`;
}

function decryptWith(keys: DerivedKeys, iv: Buffer, tag: Buffer, ciphertext: Buffer): string {
  const decipher = createDecipheriv('aes-256-gcm', keys.encryption, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/**
 * Reverse {@link encryptRecipientData}. Values without the cipher prefix are
 * legacy plaintext rows and are returned unchanged. A value that carries the
 * prefix but fails authentication under every configured key throws — it is
 * never silently treated as plaintext.
 */
export function decryptRecipientData(value: string): string {
  if (!isEncryptedRecipientData(value)) return value;
  const parts = value.slice(CIPHER_PREFIX.length).split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed encrypted recipient data');
  }
  const [iv, tag, ciphertext] = parts.map((part) => Buffer.from(part, 'base64'));
  const candidates = [currentKeys(), previousKeys()].filter(
    (keys): keys is DerivedKeys => keys !== undefined
  );
  for (const keys of candidates) {
    try {
      return decryptWith(keys, iv, tag, ciphertext);
    } catch {
      // try the next key
    }
  }
  throw new Error('Unable to decrypt recipient data with the configured recipient keys');
}
