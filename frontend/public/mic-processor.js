// AudioWorklet that forwards Float32 mic samples to the main thread.
// Lives in /public so Vite serves it at /mic-processor.js in both dev and prod.
class MicProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input[0] && input[0].length > 0) {
      // Copy because the buffer is reused by the audio thread.
      this.port.postMessage(new Float32Array(input[0]));
    }
    return true;
  }
}
registerProcessor("mic-processor", MicProcessor);
