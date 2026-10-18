import { randomBytes } from 'node:crypto';

/**
 * Evidence subsystem: redaction, bounded log buffering, and SSE fan-out with
 * per-client backpressure. Frames and logs are derived data; the durable run
 * manifest is authoritative after reconnection.
 */

const REDACTION = '[REDACTED]';

export class Redactor {
  private readonly secrets: string[];
  private readonly maxSecretLength: number;
  private pending = '';
  private readonly patterns: RegExp[] = [
    /("(?:password|passwd|secret|token|apiKey|api_key|authorization|dsn)"\s*:\s*")[^"]*(")/gi,
    /(password|passwd|token|secret|api[_-]?key)\s*[=:]\s*[^\s,;&"']+/gi,
    /(mysql|mariadb):\/\/[^@\s"']+@/gi,
  ];

  constructor(secrets: readonly string[]) {
    this.secrets = secrets.filter((secret) => secret.length >= 4);
    this.maxSecretLength = this.secrets.reduce((max, secret) => Math.max(max, secret.length), 0);
  }

  push(chunk: string): string {
    let text = this.pending + chunk;
    this.pending = '';
    for (const secret of this.secrets) {
      text = text.split(secret).join(REDACTION);
    }
    if (this.maxSecretLength > 1) {
      const holdBack = Math.min(this.maxSecretLength - 1, text.length);
      this.pending = text.slice(text.length - holdBack);
      text = text.slice(0, text.length - holdBack);
    }
    for (const pattern of this.patterns) {
      text = text.replace(pattern, (match, prefix: string, suffix?: string) =>
        suffix === undefined ? `${prefix}${REDACTION}` : `${prefix}${REDACTION}${suffix}`,
      );
    }
    return text;
  }

  flush(): string {
    let text = this.pending;
    this.pending = '';
    for (const secret of this.secrets) {
      text = text.split(secret).join(REDACTION);
    }
    return text;
  }
}

export class LineSplitter {
  private buffer = '';
  private readonly maxLineLength: number;

  constructor(maxLineLength = 8_000) {
    this.maxLineLength = maxLineLength;
  }

  push(chunk: string): string[] {
    this.buffer += chunk;
    const lines: string[] = [];
    let index = this.buffer.indexOf('\n');
    while (index >= 0) {
      const line = this.buffer.slice(0, index).replace(/\r$/, '');
      this.buffer = this.buffer.slice(index + 1);
      lines.push(line.length > this.maxLineLength ? `${line.slice(0, this.maxLineLength)}…[truncated]` : line);
      index = this.buffer.indexOf('\n');
    }
    if (this.buffer.length > this.maxLineLength * 4) {
      lines.push(`${this.buffer.slice(0, this.maxLineLength * 4)}…[truncated]`);
      this.buffer = '';
    }
    return lines;
  }

  flush(): string[] {
    if (!this.buffer) return [];
    const line = this.buffer;
    this.buffer = '';
    return [line.length > this.maxLineLength ? `${line.slice(0, this.maxLineLength)}…[truncated]` : line];
  }
}

export const MAX_BUFFERED_LOG_LINES = 5_000;

export class LogBuffer {
  private readonly lines: string[] = [];
  private truncated = false;

  append(line: string): void {
    const entry = `[${new Date().toISOString()}] ${line}`;
    this.lines.push(entry);
    if (this.lines.length > MAX_BUFFERED_LOG_LINES) {
      this.lines.shift();
      this.truncated = true;
    }
  }

  tail(limit: number): string[] {
    return this.lines.slice(Math.max(0, this.lines.length - limit));
  }

  wasTruncated(): boolean {
    return this.truncated;
  }
}

export interface PortalEvent {
  type: 'state' | 'log' | 'preview' | 'notice';
  runId: string;
  revision: number;
  at: string;
  data: unknown;
}

export interface SseWriter {
  write(chunk: string): void;
  end(): void;
  onClose(listener: () => void): void;
}

interface Subscriber {
  id: string;
  runId: string;
  writer: SseWriter;
  queue: PortalEvent[];
  sending: boolean;
  closed: boolean;
  lagged: boolean;
}

const MAX_QUEUE_DEPTH = 200;
const COALESCE_TYPES = new Set(['preview']);

function eventKey(event: PortalEvent): string | null {
  if (!COALESCE_TYPES.has(event.type)) return null;
  const data = event.data as { userId?: unknown } | null;
  const userId = data && typeof data.userId === 'string' ? data.userId : '*';
  return `${event.type}:${userId}`;
}

export class EventHub {
  private readonly subscribers = new Map<string, Subscriber>();

  subscribe(runId: string, writer: SseWriter): { id: string; unsubscribe: () => void } {
    const id = randomBytes(8).toString('hex');
    const subscriber: Subscriber = {
      id,
      runId,
      writer,
      queue: [],
      sending: false,
      closed: false,
      lagged: false,
    };
    this.subscribers.set(id, subscriber);
    writer.onClose(() => this.unsubscribe(id));
    return { id, unsubscribe: () => this.unsubscribe(id) };
  }

  unsubscribe(id: string): void {
    const subscriber = this.subscribers.get(id);
    if (!subscriber) return;
    subscriber.closed = true;
    this.subscribers.delete(id);
  }

  publish(event: PortalEvent): void {
    for (const subscriber of this.subscribers.values()) {
      if (subscriber.closed || subscriber.runId !== event.runId) continue;
      this.enqueue(subscriber, event);
    }
  }

  private enqueue(subscriber: Subscriber, event: PortalEvent): void {
    if (subscriber.closed) return;
    const key = eventKey(event);
    if (key) {
      const existing = subscriber.queue.findIndex((candidate) => eventKey(candidate) === key);
      if (existing >= 0) {
        subscriber.queue[existing] = event;
        this.flush(subscriber);
        return;
      }
    }
    if (subscriber.queue.length >= MAX_QUEUE_DEPTH) {
      // Drop the oldest queued event and tell the client the stream has gaps.
      subscriber.queue.shift();
      subscriber.lagged = true;
    }
    subscriber.queue.push(event);
    this.flush(subscriber);
  }

  private flush(subscriber: Subscriber): void {
    if (subscriber.sending || subscriber.closed) return;
    subscriber.sending = true;
    try {
      while (subscriber.queue.length > 0) {
        const event = subscriber.queue.shift();
        if (!event) break;
        if (subscriber.lagged) {
          subscriber.lagged = false;
          subscriber.writer.write(
            `event: notice\ndata: ${JSON.stringify({ type: 'notice', runId: event.runId, message: 'log stream gap; reconnect for authoritative state' })}\n\n`,
          );
        }
        subscriber.writer.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      }
    } catch {
      subscriber.closed = true;
      this.subscribers.delete(subscriber.id);
      try {
        subscriber.writer.end();
      } catch {
        // ignore
      }
    } finally {
      subscriber.sending = false;
    }
  }

  subscriberCount(): number {
    return this.subscribers.size;
  }

  closeAll(): void {
    for (const subscriber of this.subscribers.values()) {
      subscriber.closed = true;
      try {
        subscriber.writer.end();
      } catch {
        // ignore
      }
    }
    this.subscribers.clear();
  }
}

export function contentDispositionAttachment(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export function safeMediaType(mediaType: string): string {
  const normalized = mediaType.split(';')[0]?.trim().toLowerCase() ?? '';
  const allowed = ['application/json', 'text/plain', 'text/csv', 'application/zip', 'application/pdf', 'image/png', 'image/jpeg', 'application/octet-stream'];
  return allowed.includes(normalized) ? normalized : 'application/octet-stream';
}
