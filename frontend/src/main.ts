import { AudioPlayer, startMic, stopMic } from "./audio";
import {
  appendAssistantDelta,
  appendMessage,
  appendPlaceholderUserMessage,
  clearLiveTranscript,
  discardStreamingAssistantMessage,
  finalizeAssistantMessage,
  hideAgeGate,
  hideFatalError,
  hideThinkingIndicator,
  replacePlaceholderUserMessage,
  resetTimeline,
  showAgeGate,
  showError,
  showFatalError,
  showSafetyWarning,
  showScreen,
  showThinkingIndicator,
  updateLiveTranscript,
  updateOrb,
  updateTimer,
} from "./ui";
import { fetchSummary, renderSkeleton, renderSummary } from "./summary";
import { LumoSocket } from "./ws";

const DEFAULT_DURATION_S = 300;

// ---------------- Error mapping ----------------

interface FriendlyError {
  title: string;
  message: string;
  detail?: string;
  canRetry: boolean;
}

function mapMicError(e: unknown): FriendlyError {
  const err = e as DOMException & { message?: string };
  switch (err?.name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return {
        title: "Microphone access needed",
        message: "Lumo listens through your microphone. Please allow microphone access in your browser and try again.",
        canRetry: false,
      };
    case "NotFoundError":
    case "DevicesNotFoundError":
      return {
        title: "No microphone found",
        message: "Lumo couldn't find a microphone. Plug one in and try again.",
        canRetry: true,
      };
    case "NotReadableError":
    case "TrackStartError":
      return {
        title: "Microphone is in use",
        message: "Another app is using your microphone. Close it and try again.",
        canRetry: true,
      };
    case "SecurityError":
      return {
        title: "Insecure context",
        message: "Lumo needs a secure (HTTPS) connection to access your microphone.",
        canRetry: false,
      };
    default:
      return {
        title: "Microphone error",
        message: err?.message || "Something went wrong with your microphone.",
        canRetry: true,
      };
  }
}

function mapBackendError(ev: { code?: string; message?: string; source?: string }): FriendlyError {
  const code = (ev.code || "").toLowerCase();
  const m = (ev.message || "").toLowerCase();

  if (code === "connection_timeout" || code === "connection_failed") {
    return {
      title: "Can't reach Lumo",
      message: "Lumo's backend isn't responding. It may be offline or starting up. Try again in a moment.",
      detail: ev.message,
      canRetry: true,
    };
  }
  if (code === "missing_api_key" || code === "invalid_api_key" || m.includes("api key") || m.includes("authentication") || m.includes("unauthorized")) {
    return {
      title: "Lumo is misconfigured",
      message: "Lumo can't reach its voice service. The admin has been notified — please try again later.",
      detail: ev.message,
      canRetry: false,
    };
  }
  if (code === "insufficient_quota" || m.includes("quota") || m.includes("billing")) {
    return {
      title: "Lumo is taking a break",
      message: "Lumo's daily conversation limit has been reached. Please try again tomorrow.",
      detail: ev.message,
      canRetry: false,
    };
  }
  if (code === "rate_limit_exceeded" || m.includes("rate limit") || m.includes("too many requests")) {
    return {
      title: "Lumo is popular right now",
      message: "Lots of people are talking with Lumo at the same time. Wait a minute and try again.",
      detail: ev.message,
      canRetry: true,
    };
  }
  if (code === "upstream_unreachable" || m.includes("upstream")) {
    return {
      title: "Lumo's voice service is down",
      message: "Lumo can't connect to its voice service right now. Try again in a moment.",
      detail: ev.message,
      canRetry: true,
    };
  }
  if (code === "server_error" || code === "internal_error" || m.includes("server error")) {
    return {
      title: "Lumo had a hiccup",
      message: "Something went wrong on Lumo's side. Try again in a moment.",
      detail: ev.message,
      canRetry: true,
    };
  }
  return {
    title: "Something went wrong",
    message: "Lumo ran into an unexpected error.",
    detail: ev.message,
    canRetry: true,
  };
}
const PARTIAL_TRANSCRIPT_EVENTS = [
  "conversation.item.input_audio_transcription.delta",
  "conversation.item.audio_transcription.delta",
  "input_audio_transcription.delta",
];

let socket: LumoSocket | null = null;
let player: AudioPlayer | null = null;
let timerInterval: number | null = null;
let micActive = false;
let currentSessionId: string | null = null;
let lumoIsSpeaking = false;
let bargeInUntil = 0;
let selectedDuration = DEFAULT_DURATION_S;

// ---------------- DOM bindings ----------------

document.getElementById("cta-hero")?.addEventListener("click", () => showAgeGate());
document.getElementById("cta-nav")?.addEventListener("click", () => showAgeGate());
document.getElementById("age-close")?.addEventListener("click", () => hideAgeGate());

document.querySelectorAll<HTMLButtonElement>(".dur-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".dur-btn").forEach((b) => b.classList.remove("selected"));
    btn.classList.add("selected");
    selectedDuration = parseInt(btn.dataset.seconds ?? `${DEFAULT_DURATION_S}`, 10);
  });
});

document.querySelectorAll<HTMLButtonElement>(".age-card").forEach((card) => {
  card.addEventListener("click", () => {
    document.querySelectorAll(".age-card").forEach((c) => c.classList.remove("selected"));
    card.classList.add("selected");
    const age = card.dataset.age!;
    setTimeout(() => {
      hideAgeGate();
      void startSession(age);
    }, 400);
  });
});

document.getElementById("end-btn")?.addEventListener("click", () => void endSession());

window.addEventListener("popstate", () => init());

// ---------------- Init / routing ----------------

function init(): void {
  initPinGate();

  const m = window.location.pathname.match(/^\/summary\/([a-f0-9-]+)$/i);
  if (m) {
    // Shared summary URL — bypass the PIN (parent should be able to open it).
    const sid = m[1];
    showScreen("summary");
    const root = document.getElementById("summary-inner")!;
    renderSkeleton(root);
    fetchSummary(sid)
      .then((data) => {
        renderSummary(data, root);
        bindNewSessionButton();
      })
      .catch(() => {
        window.location.href = "/";
      });
    return;
  }

  // demo.html default: show PIN gate first. On success → age gate.
  showScreen("pin");
}

// ---------------- PIN gate ----------------

const CORRECT_PIN = (import.meta.env.VITE_DEMO_PIN as string | undefined) ?? "";
if (!CORRECT_PIN) {
  console.warn(
    "[Lumo] VITE_DEMO_PIN is not set. The PIN gate will reject every entry. " +
      "Set VITE_DEMO_PIN in frontend/.env (dev) or in the Cloudflare Pages dashboard (prod)."
  );
}
let pinEntry = "";

function initPinGate(): void {
  document.querySelectorAll<HTMLButtonElement>(".pin-key[data-digit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      addPinDigit(btn.dataset.digit ?? "");
    });
  });
  document.getElementById("pin-del")?.addEventListener("click", deletePinDigit);

  document.addEventListener("keydown", (e) => {
    const pinScreen = document.getElementById("pin-screen");
    if (!pinScreen?.classList.contains("active")) return;
    if (e.key >= "0" && e.key <= "9") {
      addPinDigit(e.key);
      e.preventDefault();
    } else if (e.key === "Backspace" || e.key === "Delete") {
      deletePinDigit();
      e.preventDefault();
    }
  });
}

function addPinDigit(digit: string): void {
  if (!digit || pinEntry.length >= 4) return;
  pinEntry += digit;
  updatePinDots();
  if (pinEntry.length === 4) {
    setTimeout(checkPin, 150);
  }
}

function deletePinDigit(): void {
  if (pinEntry.length === 0) return;
  pinEntry = pinEntry.slice(0, -1);
  updatePinDots();
  clearPinError();
}

function updatePinDots(): void {
  for (let i = 0; i < 4; i++) {
    const dot = document.getElementById(`dot-${i}`);
    if (!dot) continue;
    dot.classList.toggle("filled", i < pinEntry.length);
    dot.classList.remove("error");
  }
}

function checkPin(): void {
  if (CORRECT_PIN && pinEntry === CORRECT_PIN) {
    showScreen("landing"); // hides pin-screen; landing div doesn't exist on demo.html, harmless
    showAgeGate();
    pinEntry = "";
    return;
  }
  for (let i = 0; i < 4; i++) {
    document.getElementById(`dot-${i}`)?.classList.add("error");
  }
  document.getElementById("pin-error")?.classList.add("visible");
  setTimeout(() => {
    pinEntry = "";
    updatePinDots();
    clearPinError();
  }, 1000);
}

function clearPinError(): void {
  document.getElementById("pin-error")?.classList.remove("visible");
}

init();

// ---------------- Helpers ----------------

function flashOrb(): void {
  const orb = document.getElementById("orb");
  if (!orb) return;
  orb.classList.add("barge-in");
  orb.addEventListener(
    "animationend",
    () => orb.classList.remove("barge-in"),
    { once: true }
  );
}

function bindNewSessionButton(): void {
  document.getElementById("new-session-btn")?.addEventListener("click", resetSession);
}

function stopTimer(): void {
  if (timerInterval !== null) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function startTimer(seconds: number): void {
  stopTimer();
  let remaining = seconds;
  updateTimer(remaining);
  timerInterval = window.setInterval(() => {
    remaining -= 1;
    updateTimer(remaining);
    if (remaining <= 0) {
      stopTimer();
      void endSession();
    }
  }, 1000);
}

// ---------------- Session lifecycle ----------------

async function startSession(ageBand: string): Promise<void> {
  showScreen("voice");
  updateOrb("idle");

  resetTimeline();
  showError("");
  hideFatalError();
  currentSessionId = null;
  lumoIsSpeaking = false;
  bargeInUntil = 0;

  try {
    player = new AudioPlayer();
    await player.resume();

    socket = new LumoSocket(ageBand, selectedDuration);

    socket.onEvent("session.created", (ev) => {
      if (ev.session_id) currentSessionId = ev.session_id;
    });

    socket.onEvent("disconnected", (ev) => {
      updateOrb("idle");
      stopTimer();
      // Clean shutdowns: 1000 = normal, 1005 = no status, 1001 = going away
      if (ev.code !== 1000 && ev.code !== 1005 && ev.code !== 1001) {
        showFatalError({
          title: "Connection lost",
          message: "Lumo's connection dropped. Try starting a new session.",
          detail: `code ${ev.code}${ev.reason ? ` · ${ev.reason}` : ""}`,
          canRetry: true,
          onRetry: () => void startSession(ageBand),
        });
      }
    });

    socket.onEvent("input_audio_buffer.speech_started", () => {
      if (lumoIsSpeaking) {
        // ── BARGE-IN ──
        lumoIsSpeaking = false;
        bargeInUntil = Date.now() + 300;
        player?.flush();
        socket?.sendEvent({ type: "response.cancel" });
        discardStreamingAssistantMessage();
        hideThinkingIndicator();
        flashOrb();
        updateOrb("listening");
        appendPlaceholderUserMessage();
      } else {
        updateOrb("listening");
      }
    });

    socket.onEvent("input_audio_buffer.speech_stopped", () => {
      updateOrb("thinking");
      clearLiveTranscript();
      appendPlaceholderUserMessage();
      showThinkingIndicator();
    });

    // Wire partial-transcript events speculatively — if the API ever streams
    // them, the grey italic placeholder will fill in. No-op otherwise.
    for (const name of PARTIAL_TRANSCRIPT_EVENTS) {
      socket.onEvent(name, (ev) => {
        const delta = ev?.delta ?? ev?.transcript ?? "";
        if (delta) updateLiveTranscript(delta);
      });
    }

    const onTranscript = (ev: any) => {
      const text =
        ev?.transcript ??
        ev?.item?.content?.[0]?.transcript ??
        "";
      if (!text.trim()) return;
      replacePlaceholderUserMessage(text.trim());
    };
    socket.onEvent("conversation.item.input_audio_transcription.completed", onTranscript);
    socket.onEvent("conversation.item.audio_transcription.completed", onTranscript);

    socket.onEvent("response.output_audio_transcript.delta", (ev) => {
      if (ev.delta) {
        hideThinkingIndicator();
        appendAssistantDelta(ev.delta);
      }
    });

    socket.onEvent("response.output_audio.delta", (ev) => {
      if (Date.now() < bargeInUntil) return; // drop bleed after barge-in
      if (!player || !ev.delta) return;
      if (!lumoIsSpeaking) {
        lumoIsSpeaking = true;
        hideThinkingIndicator();
      }
      player.enqueue(ev.delta);
      updateOrb("speaking");
    });

    socket.onEvent("response.output_audio_transcript.done", () => {
      finalizeAssistantMessage();
    });

    socket.onEvent("response.cancelled", () => {
      lumoIsSpeaking = false;
      hideThinkingIndicator();
      discardStreamingAssistantMessage();
    });

    socket.onEvent("response.done", (ev) => {
      lumoIsSpeaking = false;
      const status = ev?.response?.status;
      if (status === "cancelled") {
        hideThinkingIndicator();
        discardStreamingAssistantMessage();
        return;
      }
      hideThinkingIndicator();
      finalizeAssistantMessage();
      updateOrb("idle");
    });

    socket.onEvent("safe_redirect", (ev) => {
      player?.flush();
      lumoIsSpeaking = false;
      hideThinkingIndicator();
      clearLiveTranscript();
      discardStreamingAssistantMessage();
      finalizeAssistantMessage();
      updateOrb("idle");

      const blocked = (ev.blocked_transcript ?? "").trim();
      if (blocked) replacePlaceholderUserMessage(blocked);
      appendMessage("assistant", ev.text);

      showSafetyWarning(ev.reason_code ?? "SAFE_REFUSED_HARM", () => {
        void endSession();
      });
    });

    socket.onEvent("error", (ev) => {
      console.error("Lumo error event:", ev);
      const friendly = mapBackendError(ev);
      stopTimer();
      if (micActive) { stopMic(); micActive = false; }
      socket?.disconnect();
      showFatalError({
        ...friendly,
        onRetry: friendly.canRetry ? () => void startSession(ageBand) : undefined,
      });
    });

    try {
      await socket.connect(5000);
    } catch (e) {
      console.error("Connect failed:", e);
      const code = (e as { code?: string })?.code ?? "connection_failed";
      const friendly = mapBackendError({ code, message: (e as Error).message });
      showFatalError({
        ...friendly,
        onRetry: friendly.canRetry ? () => void startSession(ageBand) : undefined,
      });
      return;
    }

    try {
      await startMic((chunk: ArrayBuffer) => socket?.sendAudioChunk(chunk));
      micActive = true;
    } catch (e) {
      console.error("Mic failed:", e);
      socket?.disconnect();
      const friendly = mapMicError(e);
      showFatalError({
        ...friendly,
        onRetry: friendly.canRetry ? () => void startSession(ageBand) : undefined,
      });
      return;
    }

    startTimer(selectedDuration);
  } catch (e) {
    console.error(e);
    showFatalError({
      title: "Couldn't start session",
      message: "Something went wrong setting up your conversation.",
      detail: (e as Error).message,
      canRetry: true,
      onRetry: () => void startSession(ageBand),
    });
  }
}

async function endSession(): Promise<void> {
  stopTimer();
  if (micActive) {
    stopMic();
    micActive = false;
  }
  updateOrb("idle");
  socket?.disconnect();
  player?.close();
  socket = null;
  player = null;
  lumoIsSpeaking = false;
  bargeInUntil = 0;

  const sid = currentSessionId;
  if (sid) {
    window.history.pushState({ sessionId: sid }, "", `/summary/${sid}`);
  }

  showScreen("summary");
  const root = document.getElementById("summary-inner")!;
  renderSkeleton(root);

  if (!sid) {
    root.innerHTML = `
      <h1>Session ended</h1>
      <p style="color: var(--muted-light)">No session ID was captured, so there's no summary to show.</p>
      <button class="btn-primary" id="new-session-btn">Start new session</button>
    `;
    bindNewSessionButton();
    return;
  }

  try {
    const data = await fetchSummary(sid);
    renderSummary(data, root);
    bindNewSessionButton();
  } catch (err) {
    console.error(err);
    root.innerHTML = `
      <h1>Could not load summary</h1>
      <p style="color: var(--muted-light)">${(err as Error).message}</p>
      <button class="btn-primary" id="new-session-btn">Back</button>
    `;
    bindNewSessionButton();
  }
}

function resetSession(): void {
  stopTimer();
  if (micActive) {
    stopMic();
    micActive = false;
  }
  socket?.disconnect();
  player?.close();
  socket = null;
  player = null;
  currentSessionId = null;
  lumoIsSpeaking = false;
  bargeInUntil = 0;

  resetTimeline();
  updateOrb("idle");
  updateTimer(selectedDuration);
  showError("");

  document.querySelectorAll(".age-card").forEach((c) => c.classList.remove("selected"));

  // Two-page app: landing lives at /index.html (rendered at /),
  // demo lives at /demo.html. "Start new session" goes back to landing.
  window.location.href = "/";
}
