type Handler = (data: any) => void;

const BACKEND_WS = (import.meta.env.VITE_BACKEND_WS as string | undefined) ?? "";

export class LumoSocket {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<Handler>>();
  private ageBand: string;
  private duration: number;

  constructor(ageBand: string, duration: number = 300) {
    this.ageBand = ageBand;
    this.duration = duration;
  }

  connect(timeoutMs: number = 5000): Promise<void> {
    return new Promise((resolve, reject) => {
      const path = `/session/ws?age_band=${encodeURIComponent(this.ageBand)}&duration=${this.duration}`;
      let url: string;
      if (BACKEND_WS) {
        url = `${BACKEND_WS}${path}`;
      } else {
        const proto = location.protocol === "https:" ? "wss" : "ws";
        url = `${proto}://${location.host}${path}`;
      }
      this.ws = new WebSocket(url);

      let settled = false;
      const timeout = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        const err = new Error("connection_timeout");
        (err as any).code = "connection_timeout";
        this.emit("error", { message: "Backend unreachable", code: "connection_timeout" });
        try { this.ws?.close(); } catch { /* ignore */ }
        reject(err);
      }, timeoutMs);

      this.ws.onopen = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.emit("connected", {});
        resolve();
      };
      this.ws.onerror = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        const err = new Error("connection_failed");
        (err as any).code = "connection_failed";
        this.emit("error", { message: "Connection failed", code: "connection_failed" });
        reject(err);
      };
      this.ws.onclose = (ev) => {
        this.emit("disconnected", { code: ev.code, reason: ev.reason });
        this.emit("close", { code: ev.code, reason: ev.reason });
      };
      this.ws.onmessage = (msg) => {
        if (typeof msg.data !== "string") return;
        let event: any;
        try {
          event = JSON.parse(msg.data);
        } catch {
          return;
        }
        const type: string = event.type ?? "message";
        this.emit(type, event);
        this.emit("*", event);
      };
    });
  }

  sendAudioChunk(pcm16Buffer: ArrayBuffer): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const bytes = new Uint8Array(pcm16Buffer);
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(
        null,
        Array.from(bytes.subarray(i, i + chunk))
      );
    }
    const audio = btoa(binary);
    this.ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio }));
  }

  sendRaw(obj: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(obj));
  }

  sendEvent(event: Record<string, unknown>): void {
    this.sendRaw(event);
  }

  onEvent(type: string, handler: Handler): void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(handler);
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
  }

  private emit(type: string, data: any): void {
    this.handlers.get(type)?.forEach((h) => h(data));
  }
}
