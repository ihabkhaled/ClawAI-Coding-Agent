import JSZip from 'jszip';

import { PluginFailure } from '../core/plugin-failure';
import { MAX_PLUGIN_BYTES, MAX_PLUGIN_FILES } from '../core/plugin-manifest.constants';
import { isContainedRelativePath, stripSharedTopFolder } from '../core/plugin-path';

import type { PluginBundleFile } from '../core/plugin-manifest.types';

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
    const content = await entry.async('uint8array');
    total += content.byteLength;
    if (total > MAX_PLUGIN_BYTES) throw new PluginFailure('too-large');
    files.push({ path: paths[index] ?? entry.name, bytes: content });
  }
  return files;
}
