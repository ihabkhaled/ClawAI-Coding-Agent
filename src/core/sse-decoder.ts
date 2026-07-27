export class SseDecoder {
  private buffer = '';

  constructor(private readonly maxEventBytes = 1_000_000) {}

  push(chunk: string): Record<string, unknown>[] {
    this.buffer += chunk.replaceAll('\r\n', '\n');
    if (Buffer.byteLength(this.buffer, 'utf8') > this.maxEventBytes) {
      this.buffer = '';
      throw new Error('ClawAI stream event exceeded the configured safety limit.');
    }

    const events: Record<string, unknown>[] = [];
    let boundary = this.buffer.indexOf('\n\n');
    while (boundary >= 0) {
      const block = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + 2);
      const data = block
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice('data:'.length).trimStart())
        .join('\n');
      if (data.length > 0) {
        const parsed: unknown = JSON.parse(data);
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('ClawAI stream returned an invalid event.');
        }
        events.push(parsed as Record<string, unknown>);
      }
      boundary = this.buffer.indexOf('\n\n');
    }
    return events;
  }
}
