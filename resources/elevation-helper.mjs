import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';

const [requestPath, receiptPath, keyPath] = process.argv.slice(2);
if (!requestPath || !receiptPath || !keyPath) process.exit(64);

const digest = (value) =>
  `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
const fileDigest = async (file) =>
  `sha256:${createHash('sha256')
    .update(await readFile(file))
    .digest('hex')}`;
const signature = (key, value) =>
  createHmac('sha256', key).update(JSON.stringify(value)).digest('base64url');
const equal = (left, right) => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};

const envelope = JSON.parse(await readFile(requestPath, 'utf8'));
const key = await readFile(keyPath);
const { signature: requestSignature, ...unsigned } = envelope;
if (!equal(requestSignature, signature(key, unsigned)))
  throw new Error('Request signature invalid');
if (Date.parse(envelope.expiresAt) <= Date.now()) throw new Error('Request expired');
if (Date.parse(envelope.issuedAt) > Date.now() + 5_000) throw new Error('Request issued in future');
try {
  process.kill(envelope.parentPid, 0);
} catch (error) {
  if (error?.code !== 'EPERM') throw new Error('Bound parent process is unavailable');
}
const executablePath = await realpath(envelope.executablePath);
if (executablePath !== envelope.executablePath) throw new Error('Executable path changed');
if ((await fileDigest(executablePath)) !== envelope.executableHash)
  throw new Error('Executable changed');
if (digest(envelope.arguments) !== envelope.argumentsHash) throw new Error('Arguments changed');
const cwd = await realpath(envelope.cwd);
if (cwd !== envelope.cwd || digest(cwd) !== envelope.cwdHash)
  throw new Error('Working directory changed');
if (digest({}) !== envelope.environmentHash) throw new Error('Elevated environment must be empty');

const startedAt = new Date().toISOString();
let status = 'failed';
let exitCode = null;
await new Promise((resolve, reject) => {
  const child = spawn(executablePath, envelope.arguments, {
    cwd,
    shell: false,
    stdio: 'ignore',
    windowsHide: true,
    env: Object.fromEntries(
      ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'HOME', 'USERPROFILE', 'LANG', 'LC_ALL']
        .filter((name) => process.env[name] !== undefined)
        .map((name) => [name, process.env[name]]),
    ),
  });
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, envelope.timeoutMs);
  child.once('error', reject);
  child.once('close', (code, signal) => {
    clearTimeout(timeout);
    exitCode = code;
    status = timedOut ? 'timed-out' : signal ? 'cancelled' : code === 0 ? 'succeeded' : 'failed';
    resolve();
  });
});
const unsignedReceipt = {
  schemaVersion: '1',
  receiptId: `receipt:elevation:${randomUUID()}`,
  requestId: envelope.requestId,
  nonce: envelope.nonce,
  executableHash: envelope.executableHash,
  argumentsHash: envelope.argumentsHash,
  targetId: envelope.targetId,
  exitCode,
  startedAt,
  completedAt: new Date().toISOString(),
  status,
  helperIdentity: `clawai-elevation-helper:${process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux'}`,
};
await writeFile(
  receiptPath,
  JSON.stringify({ ...unsignedReceipt, helperSignature: signature(key, unsignedReceipt) }),
  { encoding: 'utf8', mode: 0o600 },
);
