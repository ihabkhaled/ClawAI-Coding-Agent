import { QR_QUIET_ZONE } from './qr-code.constants';

import type { QrMatrix, QrSvgOptions } from './qr-code.types';

function escapeAttribute(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;');
}

/**
 * Renders the symbol as one inline SVG path on a white square with the
 * four-module quiet zone scanners need. No remote resource, no script.
 */
export function qrToSvg(matrix: QrMatrix, options: QrSvgOptions): string {
  const extent = matrix.size + QR_QUIET_ZONE * 2;
  const commands: string[] = [];
  matrix.modules.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) commands.push(`M${String(x + QR_QUIET_ZONE)},${String(y + QR_QUIET_ZONE)}h1v1h-1z`);
    });
  });
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${String(extent)} ${String(extent)}" ` +
    `shape-rendering="crispEdges" role="img" aria-label="${escapeAttribute(options.label)}">` +
    `<rect width="${String(extent)}" height="${String(extent)}" fill="#ffffff"/>` +
    `<path d="${commands.join('')}" fill="#000000"/></svg>`
  );
}
