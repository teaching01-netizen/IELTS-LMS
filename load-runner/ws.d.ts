declare module 'ws' {
  interface WebSocket {
    readonly OPEN: number;
    readonly readyState: number;
    send(data: string): void;
  }

  class WebSocketServer {
    readonly clients: Set<WebSocket>;
    constructor(options: { server: object });
    on(event: 'connection', listener: (socket: WebSocket) => void): this;
  }

  export { WebSocketServer };
}
