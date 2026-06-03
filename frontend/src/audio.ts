const SAMPLE_RATE = 24000;

let micCtx: AudioContext | null = null;
let micStream: MediaStream | null = null;
let micSource: MediaStreamAudioSourceNode | null = null;
let micWorklet: AudioWorkletNode | null = null;

export async function startMic(
  onChunk: (pcm16: ArrayBuffer) => void
): Promise<void> {
  micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  micCtx = new AudioContext({ sampleRate: SAMPLE_RATE });

  await micCtx.audioWorklet.addModule("/mic-processor.js");

  micSource = micCtx.createMediaStreamSource(micStream);
  micWorklet = new AudioWorkletNode(micCtx, "mic-processor");

  micWorklet.port.onmessage = (e: MessageEvent<Float32Array>) => {
    const pcm16 = float32ToPcm16(e.data);
    onChunk(pcm16.buffer as ArrayBuffer);
  };

  micSource.connect(micWorklet);
  // Intentionally NOT connected to destination — no mic monitoring.
}

export function stopMic(): void {
  micWorklet?.disconnect();
  micSource?.disconnect();
  micStream?.getTracks().forEach((t) => t.stop());
  void micCtx?.close();
  micWorklet = null;
  micSource = null;
  micStream = null;
  micCtx = null;
}

function float32ToPcm16(float32: Float32Array): Int16Array {
  const pcm = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const clamped = Math.max(-1, Math.min(1, float32[i]));
    pcm[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  return pcm;
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export class AudioPlayer {
  private ctx: AudioContext;
  private nextTime = 0;

  constructor() {
    this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
  }

  enqueue(base64: string): void {
    const bytes = base64ToArrayBuffer(base64);
    const pcm16 = new Int16Array(bytes);
    if (pcm16.length === 0) return;
    const float32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) {
      float32[i] = pcm16[i] / 0x8000;
    }

    const buffer = this.ctx.createBuffer(1, float32.length, SAMPLE_RATE);
    buffer.copyToChannel(float32, 0);

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.ctx.destination);

    const startAt = Math.max(this.ctx.currentTime, this.nextTime);
    source.start(startAt);
    this.nextTime = startAt + buffer.duration;
  }

  /** Stop any in-flight playback. Used when safety blocks a response mid-stream. */
  flush(): void {
    this.nextTime = 0;
    void this.ctx.close();
    this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
  }

  async resume(): Promise<void> {
    if (this.ctx.state === "suspended") {
      await this.ctx.resume();
    }
  }

  close(): void {
    void this.ctx.close();
  }
}
