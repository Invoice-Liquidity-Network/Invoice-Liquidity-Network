import { afterEach, describe, expect, it, vi } from 'vitest';

describe('notification security audit regressions (#1460-#1463)', () => {
  afterEach(() => {
    delete process.env.NOTIFICATIONS_RECIPIENT_KEY;
    delete process.env.NOTIFICATIONS_RECIPIENT_KEY_PREVIOUS;
    vi.restoreAllMocks();
  });

  it('keeps template variables escaped in every output context (#1463)', async () => {
    const { TemplateEngine } = await import('../src/template-engine');
    const engine = new TemplateEngine();
    engine.upsertTemplate({
      id: 'audit-boundary',
      name: 'audit-boundary',
      version: '1',
      subject: '{{payer}}',
      body: '{{payer}}',
      triggers: ['invoice_funded'],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const value = '<script>alert(1)</script>\r\nX-Injected: yes';
    const html = engine.render('audit-boundary', { payer: value }, 'html');
    const sms = engine.render('audit-boundary', { payer: value }, 'sms');
    expect(html.body).not.toContain('<script>');
    expect(sms.body).not.toMatch(/[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]/);
  });

  it('rejects private, loopback, metadata, and non-http webhook targets (#1462)', async () => {
    const { assertWebhookTargetPublic, hasValidWebhookShape } = await import('../src/ssrf');
    expect(hasValidWebhookShape('file:///etc/passwd')).toBe(false);
    await expect(assertWebhookTargetPublic('http://127.0.0.1:8080/hook')).rejects.toThrow();
    await expect(assertWebhookTargetPublic('http://169.254.169.254/latest/meta-data')).rejects.toThrow();
  });

  it('supports decrypting during key rotation but not with an unrelated key (#1461)', async () => {
    const { encryptRecipientData, decryptRecipientData, assertRecipientKeyConfigured } = await import('../src/recipient-crypto');
    process.env.NOTIFICATIONS_RECIPIENT_KEY = 'a'.repeat(64);
    assertRecipientKeyConfigured();
    const sealed = encryptRecipientData('recipient@example.com');
    process.env.NOTIFICATIONS_RECIPIENT_KEY_PREVIOUS = process.env.NOTIFICATIONS_RECIPIENT_KEY;
    process.env.NOTIFICATIONS_RECIPIENT_KEY = 'b'.repeat(64);
    expect(decryptRecipientData(sealed)).toBe('recipient@example.com');
    delete process.env.NOTIFICATIONS_RECIPIENT_KEY_PREVIOUS;
    expect(() => decryptRecipientData(sealed)).toThrow(/Unable to decrypt/);
  });

  it('keeps preference records isolated by Stellar address (#1460)', async () => {
    const { preferencesService } = await import('../src/preferences');
    preferencesService.upsert('G' + 'A'.repeat(55), { enabledChannels: ['email'] });
    preferencesService.upsert('G' + 'B'.repeat(55), { enabledChannels: ['webhook'] });
    expect(preferencesService.get('G' + 'A'.repeat(55)).enabledChannels).toEqual(['email']);
    expect(preferencesService.get('G' + 'B'.repeat(55)).enabledChannels).toEqual(['webhook']);
  });
});
