import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';

import { canonicalIp } from './http-address';
import { HttpTransportError } from './http-tool-failure';
import { HTTP_RESPONSE_MAX_BYTES } from './http-tool.constants';

import type { HttpHopRequest, HttpHopResponse, HttpHopSender } from './http-tool.types';
import type { IncomingMessage, RequestOptions } from 'node:http';
import type { LookupFunction } from 'node:net';
import type { Readable } from 'node:stream';

function pinnedLookup(address: string, family: 4 | 6): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all === true) callback(null, [{ address, family }]);
    else callback(null, address, family);
  };
}

function decoded(response: IncomingMessage): Readable {
  const encoding = (response.headers['content-encoding'] ?? '').toLowerCase();
  if (encoding === 'gzip' || encoding === 'x-gzip') return response.pipe(zlib.createGunzip());
  if (encoding === 'deflate') return response.pipe(zlib.createInflate());
  if (encoding === 'br') return response.pipe(zlib.createBrotliDecompress());
  return response;
}

function requestOptions(request: HttpHopRequest): RequestOptions {
  const { url, address } = request.target;
  const headers: Record<string, string> = {
    accept: 'application/json, text/plain, */*',
    'accept-encoding': 'identity',
    'user-agent': 'clawai-coding-agent',
    ...request.headers,
  };
  if (request.body !== undefined)
    headers['content-length'] = String(Buffer.byteLength(request.body));
  return {
    method: request.method,
    hostname: url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname,
    port: url.port === '' ? undefined : Number(url.port),
    path: `${url.pathname}${url.search}`,
    headers,
    lookup: pinnedLookup(address.address, address.family),
    signal: request.signal,
    agent: false,
  };
}

/**
 * Sends one hop to the address already approved for it.
 *
 * The connection goes to that address through a fixed lookup, so a second DNS
 * answer never gets a say, and the peer that actually answered is compared
 * with it. TLS verification stays on (the platform's CA store, plus
 * NODE_EXTRA_CA_CERTS and `--use-system-ca` when the process has them). The
 * body is read only up to the cap; past it the connection is closed.
 */
export const sendHop: HttpHopSender = (request) =>
  new Promise<HttpHopResponse>((resolve, reject) => {
    let settled = false;
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      action();
    };
    const transport = request.target.url.protocol === 'https:' ? https : http;
    const outgoing = transport.request(requestOptions(request), (response) => {
      const peer = response.socket.remoteAddress;
      if (peer !== undefined && canonicalIp(peer) !== canonicalIp(request.target.address.address)) {
        response.destroy();
        finish(() => {
          reject(
            new HttpTransportError('CONNECTION_FAILED', 'The peer is not the approved address.'),
          );
        });
        return;
      }
      const chunks: Buffer[] = [];
      let total = 0;
      const source = decoded(response);
      const done = (cut: boolean): void => {
        finish(() => {
          resolve({
            status: response.statusCode ?? 0,
            statusText: response.statusMessage ?? '',
            headers: response.headers,
            body: Buffer.concat(chunks).subarray(0, HTTP_RESPONSE_MAX_BYTES),
            cut,
          });
        });
        if (cut) outgoing.destroy();
      };
      source.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
        total += chunk.length;
        if (total >= HTTP_RESPONSE_MAX_BYTES) done(true);
      });
      source.on('end', () => {
        done(false);
      });
      source.on('error', (error: Error) => {
        finish(() => {
          reject(error);
        });
      });
      response.on('error', (error: Error) => {
        finish(() => {
          reject(error);
        });
      });
    });
    outgoing.on('error', (error: Error) => {
      finish(() => {
        reject(error);
      });
    });
    outgoing.end(request.body);
  });
