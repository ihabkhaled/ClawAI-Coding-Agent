import { Readable } from 'node:stream';

import JSZip from 'jszip';

import { PluginFailure } from '../core/plugin-failure';
import { MAX_PLUGIN_BYTES, MAX_PLUGIN_FILES } from '../core/plugin-manifest.constants';
import { isContainedRelativePath, stripSharedTopFolder } from '../core/plugin-path';

import type { PluginBundleFile } from '../core/plugin-manifest.types';

/**
 * One entry's bytes, inflated as a stream and cut off the moment the plugin's
 * remaining budget is spent. Inflating the whole entry first would let a few
 * kilobytes of zip allocate gigabytes before any size check ran.
 */
function inflateWithin(entry: JSZip.JSZipObject, budget: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const stream = entry.nodeStream('nodebuffer');
    const chunks: Buffer[] = [];
    let size = 0;
    stream.on('data', (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > budget) {
        if (stream instanceof Readable) stream.destroy();
        else stream.pause();
        reject(new PluginFailure('too-large'));
        return;
      }
      chunks.push(chunk);
    });
    stream.once('end', () => {
      resolve(new Uint8Array(Buffer.concat(chunks)));
    });
    stream.once('error', () => {
      reject(new PluginFailure('invalid-source', 'unreadable archive entry'));
    });
  });
}

/**
 * The files of a plugin `.zip`, checked before a byte of it reaches the disk.
 *
 * Every entry path must stay inside the plugin (no zip-slip), and the count and
 * the unpacked size are bounded, so a small archive cannot expand into a disk
 * full of nothing. One wrapping folder, as GitHub archives have, is removed.
 */
export async function unzipPlugin(bytes: Uint8Array): Promise<PluginBundleFile[]> {
  let archive: JSZip;
  try {
    archive = await JSZip.loadAsync(bytes);
  } catch {
    throw new PluginFailure('invalid-source', 'not a zip archive');
  }
  const entries = Object.values(archive.files).filter((entry) => !entry.dir);
  if (entries.length > MAX_PLUGIN_FILES) throw new PluginFailure('too-large');
  for (const entry of entries) {
    if (!isContainedRelativePath(entry.name)) throw new PluginFailure('unsafe-path', entry.name);
  }
  const paths = stripSharedTopFolder(entries.map((entry) => entry.name));
  const files: PluginBundleFile[] = [];
  let total = 0;
  for (const [index, entry] of entries.entries()) {
    const content = await inflateWithin(entry, MAX_PLUGIN_BYTES - total);
    total += content.byteLength;
    files.push({ path: paths[index] ?? entry.name, bytes: content });
  }
  return files;
}
