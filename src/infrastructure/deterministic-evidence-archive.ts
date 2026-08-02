import JSZip from 'jszip';

import type { EvidenceArchivePort } from '../services/evidence-bundle-service';

/** ZIP timestamps and ordering are fixed so identical evidence produces identical bytes. */
export class DeterministicEvidenceArchive implements EvidenceArchivePort {
  async create(
    files: readonly { readonly path: string; readonly bytes: Uint8Array }[],
  ): Promise<Uint8Array> {
    const archive = new JSZip();
    const timestamp = new Date('1980-01-01T00:00:00.000Z');
    for (const file of [...files].sort((left, right) => left.path.localeCompare(right.path))) {
      archive.file(file.path, file.bytes, {
        binary: true,
        createFolders: false,
        date: timestamp,
        unixPermissions: 0o644,
      });
    }
    return archive.generateAsync({
      type: 'uint8array',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 },
      platform: 'UNIX',
    });
  }
}
