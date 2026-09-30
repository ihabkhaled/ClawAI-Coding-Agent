import { encodeQr } from './qr-code';
import { qrToSvg } from './qr-svg';

import type { PairingPanelInput } from './pairing-panel.types';

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;');
}

function qrMarkup(input: PairingPanelInput): string {
  try {
    return qrToSvg(encodeQr(input.url), { label: input.labels.qrLabel });
  } catch (error: unknown) {
    if (error instanceof RangeError) return `<p>${escapeHtml(input.labels.noQr)}</p>`;
    throw error;
  }
}

/**
 * The pairing panel page. Strict CSP: nothing loads from anywhere, styles and
 * the one small script carry the nonce, and the QR code is inline SVG.
 */
export function pairingPanelHtml(input: PairingPanelInput): string {
  const { labels } = input;
  const nonce = escapeHtml(input.nonce);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(labels.title)}</title>
<style nonce="${nonce}">
body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:24px;max-width:480px;margin:0 auto}
svg{width:100%;max-width:320px;height:auto;display:block;margin:16px 0;border-radius:8px}
code{display:block;word-break:break-all;padding:8px;background:var(--vscode-textCodeBlock-background);border-radius:4px}
button{margin-top:12px;padding:6px 14px;color:var(--vscode-button-foreground);background:var(--vscode-button-background);border:0;border-radius:2px;cursor:pointer}
</style>
</head>
<body>
<h1>${escapeHtml(labels.title)}</h1>
<p>${escapeHtml(labels.instruction)}</p>
${qrMarkup(input)}
<h2>${escapeHtml(labels.linkHeading)}</h2>
<code>${escapeHtml(input.url)}</code>
<button id="copy" type="button">${escapeHtml(labels.copyLink)}</button>
<script nonce="${nonce}">
const vscodeApi = acquireVsCodeApi();
document.getElementById('copy').addEventListener('click', () => vscodeApi.postMessage({ type: 'copy' }));
</script>
</body>
</html>`;
}
