export type OrbState = "idle" | "listening" | "thinking" | "speaking";
export type ScreenName = "landing" | "voice" | "summary" | "pin";

const STATUS_TEXT: Record<OrbState, string> = {
  idle: "Tap to speak",
  listening: "Listening…",
  thinking: "Thinking…",
  speaking: "Speaking…",
};

function $<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element: ${id}`);
  return node as T;
}

export function showScreen(name: ScreenName): void {
  const map: Record<ScreenName, string> = {
    landing: "landing",
    voice: "voice-screen",
    summary: "summary-screen",
    pin: "pin-screen",
  };
  const targetId = map[name];
  for (const id of Object.values(map)) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.classList.toggle("active", id === targetId);
  }
  window.scrollTo(0, 0);
}

export function showAgeGate(): void {
  const gate = $("age-gate");
  gate.style.display = "flex";
  requestAnimationFrame(() => gate.classList.add("shown"));
}

export function hideAgeGate(): void {
  const gate = $("age-gate");
  gate.classList.remove("shown");
  setTimeout(() => { gate.style.display = "none"; }, 200);
}

function hideEmptyState(): void {
  document.getElementById("chat-empty-state")?.remove();
}

function scrollTimelineToBottom(): void {
  const t = $("timeline");
  t.scrollTop = t.scrollHeight;
}

function makeRow(role: "user" | "assistant"): HTMLDivElement {
  const row = document.createElement("div");
  row.style.cssText = `display:flex; justify-content:${role === "user" ? "flex-end" : "flex-start"}; margin-bottom:12px; padding:0 16px;`;
  return row;
}

function makeBubble(role: "user" | "assistant"): HTMLDivElement {
  const bubble = document.createElement("div");
  bubble.style.cssText = `
    max-width: 72%;
    padding: 10px 14px;
    border-radius: ${role === "user" ? "18px 18px 4px 18px" : "18px 18px 18px 4px"};
    background: ${role === "user" ? "#F4ECDC" : "transparent"};
    border: ${role === "user" ? "1px solid #E3D7BE" : "none"};
    color: #1E1A14;
    font-size: 15px;
    line-height: 1.6;
    text-align: left;
    white-space: pre-wrap;
    word-wrap: break-word;
  `;
  return bubble;
}

export function appendMessage(role: "user" | "assistant", text: string): void {
  hideEmptyState();
  const timeline = $("timeline");
  const row = makeRow(role);
  const bubble = makeBubble(role);
  bubble.textContent = text;
  row.appendChild(bubble);
  timeline.appendChild(row);
  scrollTimelineToBottom();
}

// Streaming assistant message (delta-by-delta)
let liveAssistantBubble: HTMLDivElement | null = null;

export function appendAssistantDelta(text: string): void {
  hideEmptyState();
  hideThinkingIndicator();
  const timeline = $("timeline");
  if (!liveAssistantBubble) {
    const row = makeRow("assistant");
    row.id = "live-assistant-row";
    liveAssistantBubble = makeBubble("assistant");
    row.appendChild(liveAssistantBubble);
    timeline.appendChild(row);
  }
  liveAssistantBubble.textContent = (liveAssistantBubble.textContent ?? "") + text;
  scrollTimelineToBottom();
}

export function finalizeAssistantMessage(): void {
  const row = document.getElementById("live-assistant-row");
  if (row) row.removeAttribute("id");
  liveAssistantBubble = null;
}

/** Drop the partially-streamed assistant bubble — used on barge-in / cancel. */
export function discardStreamingAssistantMessage(): void {
  document.getElementById("live-assistant-row")?.remove();
  liveAssistantBubble = null;
}

// Live user transcript bubble — greyed, italic, right-aligned, in-timeline
let liveTranscriptEl: HTMLDivElement | null = null;

export function updateLiveTranscript(delta: string): void {
  hideEmptyState();
  const timeline = $("timeline");
  if (!liveTranscriptEl) {
    const row = document.createElement("div");
    row.id = "live-transcript-row";
    row.style.cssText = "display:flex; justify-content:flex-end; margin-bottom:12px; padding:0 16px;";
    liveTranscriptEl = document.createElement("div");
    liveTranscriptEl.style.cssText = `
      max-width: 72%;
      padding: 10px 14px;
      border-radius: 18px 18px 4px 18px;
      background: #FFFBF2;
      border: 1px dashed #E3D7BE;
      color: #8A8170;
      font-size: 15px;
      line-height: 1.6;
      font-style: italic;
      white-space: pre-wrap;
      word-wrap: break-word;
    `;
    row.appendChild(liveTranscriptEl);
    timeline.appendChild(row);
  }
  liveTranscriptEl.textContent = (liveTranscriptEl.textContent ?? "") + delta;
  scrollTimelineToBottom();
}

export function clearLiveTranscript(): void {
  document.getElementById("live-transcript-row")?.remove();
  liveTranscriptEl = null;
}

// Placeholder user bubble — shown immediately on speech_stopped, then
// replaced when the committed transcript arrives (which may be AFTER the
// assistant response in the GA API).
let placeholderUserRow: HTMLDivElement | null = null;

export function appendPlaceholderUserMessage(): void {
  if (document.getElementById("placeholder-user-row")) return;
  hideEmptyState();
  const timeline = $("timeline");
  const row = document.createElement("div");
  row.id = "placeholder-user-row";
  row.style.cssText = "display:flex; justify-content:flex-end; margin-bottom:12px; padding:0 16px;";
  const bubble = document.createElement("div");
  bubble.style.cssText = `
    max-width: 72%;
    padding: 10px 14px;
    border-radius: 18px 18px 4px 18px;
    background: #FFFBF2;
    border: 1px dashed #E3D7BE;
    color: #8A8170;
    font-size: 15px;
    line-height: 1.6;
    font-style: italic;
    white-space: pre-wrap;
    word-wrap: break-word;
  `;
  bubble.textContent = "…";
  row.appendChild(bubble);
  timeline.appendChild(row);
  placeholderUserRow = row;
  scrollTimelineToBottom();
}

export function replacePlaceholderUserMessage(text: string): void {
  if (placeholderUserRow) {
    const bubble = placeholderUserRow.querySelector("div") as HTMLDivElement | null;
    if (bubble) {
      bubble.style.background = "#F4ECDC";
      bubble.style.border = "1px solid #E3D7BE";
      bubble.style.color = "#1E1A14";
      bubble.style.fontStyle = "normal";
      bubble.textContent = text;
    }
    placeholderUserRow.removeAttribute("id");
    placeholderUserRow = null;
  } else {
    appendMessage("user", text);
  }
  scrollTimelineToBottom();
}

// Safety warning banner with 5s countdown
export function showSafetyWarning(reasonCode: string, onComplete: () => void): void {
  const banner = $("safety-warning");
  $("safety-reason").textContent = `Content flagged — ${reasonCode}`;

  banner.style.display = "block";

  let count = 5;
  $("safety-countdown").textContent = String(count);
  $("safety-countdown-num").textContent = String(count);

  const interval = window.setInterval(() => {
    count -= 1;
    $("safety-countdown").textContent = String(count);
    $("safety-countdown-num").textContent = String(count);
    if (count <= 0) {
      clearInterval(interval);
      banner.style.display = "none";
      onComplete();
    }
  }, 1000);
}

export function hideSafetyWarning(): void {
  const banner = document.getElementById("safety-warning");
  if (banner) banner.style.display = "none";
}

// Assistant thinking dots
export function showThinkingIndicator(): void {
  hideEmptyState();
  if (document.getElementById("thinking-indicator")) return;
  const timeline = $("timeline");
  const row = document.createElement("div");
  row.id = "thinking-indicator";
  row.style.cssText = "display:flex; justify-content:flex-start; margin-bottom:12px; padding:0 16px;";
  row.innerHTML = `
    <div style="padding:12px 16px; border-radius:18px 18px 18px 4px; background:transparent;">
      <div style="display:flex; gap:5px; align-items:center;">
        <span style="width:6px;height:6px;border-radius:50%;background:#8A8170;animation:dotPulse 1.2s ease-in-out 0s infinite;"></span>
        <span style="width:6px;height:6px;border-radius:50%;background:#8A8170;animation:dotPulse 1.2s ease-in-out 0.2s infinite;"></span>
        <span style="width:6px;height:6px;border-radius:50%;background:#8A8170;animation:dotPulse 1.2s ease-in-out 0.4s infinite;"></span>
      </div>
    </div>`;
  timeline.appendChild(row);
  scrollTimelineToBottom();
}

export function hideThinkingIndicator(): void {
  document.getElementById("thinking-indicator")?.remove();
}

export function updateOrb(state: OrbState): void {
  const orb = $("orb");
  orb.classList.remove("listening", "thinking", "speaking");
  if (state !== "idle") orb.classList.add(state);
  $("status").textContent = STATUS_TEXT[state];
}

export function showError(msg: string): void {
  $("error").textContent = msg;
}

export function updateTimer(seconds: number): void {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const r = (s % 60).toString().padStart(2, "0");
  $("timer").textContent = `${m}:${r}`;
}

// Fatal error overlay
export interface FatalErrorOpts {
  title: string;
  message: string;
  detail?: string;
  canRetry?: boolean;
  onRetry?: () => void;
}

export function showFatalError(opts: FatalErrorOpts): void {
  const banner = document.getElementById("fatal-error");
  if (!banner) return;
  (document.getElementById("fatal-title") as HTMLElement).textContent = opts.title;
  (document.getElementById("fatal-message") as HTMLElement).textContent = opts.message;
  const detailEl = document.getElementById("fatal-detail") as HTMLElement;
  if (opts.detail) {
    detailEl.textContent = opts.detail;
    detailEl.style.display = "block";
  } else {
    detailEl.style.display = "none";
  }
  const retry = document.getElementById("fatal-retry") as HTMLButtonElement;
  if (opts.canRetry && opts.onRetry) {
    retry.style.display = "inline-flex";
    retry.onclick = () => {
      hideFatalError();
      opts.onRetry!();
    };
  } else {
    retry.style.display = "none";
  }
  const home = document.getElementById("fatal-home") as HTMLButtonElement;
  home.onclick = () => {
    window.location.href = "/";
  };
  banner.style.display = "flex";
}

export function hideFatalError(): void {
  const banner = document.getElementById("fatal-error");
  if (banner) banner.style.display = "none";
}

// Restore the empty state on reset.
export function resetTimeline(): void {
  const timeline = $("timeline");
  timeline.innerHTML = `
    <div id="chat-empty-state">
      <div class="dot">◎</div>
      <span>Start speaking to begin</span>
    </div>`;
  liveAssistantBubble = null;
  liveTranscriptEl = null;
  placeholderUserRow = null;
  hideSafetyWarning();
}
