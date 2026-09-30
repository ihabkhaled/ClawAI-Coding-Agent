import { describe, expect, it } from 'vitest';

import { pairingPanelHtml } from '../../src/core/pairing-panel-html';

const labels = {
  title: 'Pair <this>',
  instruction: 'Scan it',
  qrLabel: 'QR code',
  linkHeading: 'Or open',
  copyLink: 'Copy Link',
  noQr: 'Too long',
};

describe('pairing panel html', () => {
  it('embeds an inline QR, the link, a copy button and a strict CSP', () => {
    const html = pairingPanelHtml({ url: 'https://claw.local/pair?c=1&d=2', nonce: 'abc', labels });
    expect(html).toContain('<svg');
    expect(html).toContain('https://claw.local/pair?c=1&amp;d=2');
    expect(html).toContain('id="copy"');
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("script-src 'nonce-abc'");
    expect(html).not.toMatch(/https?:\/\/[^"' <]*\.(js|css|png)/u);
    expect(html).toContain('Pair &lt;this&gt;');
  });

  it('falls back to the link alone when the text is too long for a QR code', () => {
    const html = pairingPanelHtml({ url: `https://x.io/${'a'.repeat(300)}`, nonce: 'n', labels });
    expect(html).not.toContain('<svg');
    expect(html).toContain('Too long');
    expect(html).toContain('id="copy"');
  });
});
