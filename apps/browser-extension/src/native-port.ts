interface NativeMessageEvent {
  addListener(listener: (message: unknown) => void): void;
}

interface NativeDisconnectEvent {
  addListener(listener: () => void): void;
}

export interface NativePort {
  readonly onMessage: NativeMessageEvent;
  readonly onDisconnect: NativeDisconnectEvent;
  postMessage(message: unknown): void;
  disconnect(): void;
}

export interface NativeRuntime {
  connect(hostName: string): NativePort;
}
