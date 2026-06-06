export type OrbState = "idle" | "listening" | "thinking" | "speaking";
export type ScreenName = "landing" | "voice" | "summary" | "pin";

// Per-state config for the layered orb: state dot, label, sub-caption,
// listening waveform visibility, and the orb-stage modifier class.
const STATE_CFG: Record<OrbState, { dot: string; text: string; sub: string; wave: boolean; stage: string }> = {
  idle:      { dot: "",         text: "Idle",      sub: "Tap to speak", wave: false, stage: "" },
  listening: { dot: "active",   text: "Listening", sub: "Listening…",   wave: true,  stage: "listening" },
  thinking:  { dot: "thinking", text: "Thinking",  sub: "Thinking…",    wave: false, stage: "thinking" },
  speaking:  { dot: "speaking", text: "Speaking",  sub: "Speaking…",    wave: false, stage: "speaking" },
};

const LUMO_AVATAR_SVG = `<svg width="14" height="14" viewBox="0 0 26 26" aria-hidden="true"><defs><radialGradient id="lumoAvatarG" cx="38%" cy="32%"><stop offset="0%" stop-color="#FFFDF7"/><stop offset="100%" stop-color="#F4B24A"/></radialGradient></defs><circle cx="13" cy="13" r="10" fill="url(#lumoAvatarG)"/><circle cx="10" cy="10.5" r="1.6" fill="#1E1A14"/></svg>`;

// Child's chat avatar label — set from the age gate name; defaults to "You".
let childAvatarLabel = "You";
export function setChildName(name: string): void {
  const trimmed = (name ?? "").trim();
  childAvatarLabel = trimmed ? trimmed[0].toUpperCase() : "You";
}

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

/** Build a chat row (avatar + bubble) matching the Lumo design language. */
function buildMessage(role: "user" | "assistant"): { row: HTMLDivElement; bubble: HTMLDivElement } {
  const row = document.createElement("div");
  row.className = `msg ${role}`;
  const avatar = document.createElement("div");
  avatar.className = "msg-avatar";
  avatar.innerHTML = role === "user" ? childAvatarLabel : LUMO_AVATAR_SVG;
  const bubble = document.createElement("div");
  bubble.className = "msg-bubble";
  row.appendChild(avatar);
  row.appendChild(bubble);
  return { row, bubble };
}

export function appendMessage(role: "user" | "assistant", text: string): void {
  hideEmptyState();
  const timeline = $("timeline");
  const { row, bubble } = buildMessage(role);
  bubble.textContent = text;
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
    const { row, bubble } = buildMessage("assistant");
    row.id = "live-assistant-row";
    liveAssistantBubble = bubble;
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

/** Drop the partially-streamed assistant bubble — used on safe_redirect. */
export function discardStreamingAssistantMessage(): void {
  document.getElementById("live-assistant-row")?.remove();
  liveAssistantBubble = null;
}

/**
 * Keep the partial assistant bubble visible but mark it as interrupted.
 * Used on barge-in: the parent should still see what Lumo started to say,
 * just clearly indicated that it was cut off.
 */
export function markAssistantInterrupted(): void {
  const row = document.getElementById("live-assistant-row");
  if (!row || !liveAssistantBubble) return;
  const text = (liveAssistantBubble.textContent ?? "").replace(/\s+$/, "");
  liveAssistantBubble.textContent = text ? text + " …" : "…";
  const hint = document.createElement("span");
  hint.className = "msg-interrupted";
  hint.textContent = "interrupted";
  liveAssistantBubble.appendChild(hint);
  // Finalize so further deltas / cancel acks can't attach to or remove this row.
  row.removeAttribute("id");
  liveAssistantBubble = null;
}

// Live user transcript bubble — dashed "pending" style, in-timeline.
let liveTranscriptEl: HTMLDivElement | null = null;

export function updateLiveTranscript(delta: string): void {
  hideEmptyState();
  const timeline = $("timeline");
  if (!liveTranscriptEl) {
    const { row, bubble } = buildMessage("user");
    row.id = "live-transcript-row";
    bubble.classList.add("pending");
    liveTranscriptEl = bubble;
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
  const { row, bubble } = buildMessage("user");
  row.id = "placeholder-user-row";
  bubble.classList.add("pending");
  bubble.textContent = "…";
  timeline.appendChild(row);
  placeholderUserRow = row;
  scrollTimelineToBottom();
}

export function replacePlaceholderUserMessage(text: string): void {
  if (placeholderUserRow) {
    const bubble = placeholderUserRow.querySelector<HTMLDivElement>(".msg-bubble");
    if (bubble) {
      bubble.classList.remove("pending");
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

// Assistant thinking dots — rendered inside a Lumo bubble.
export function showThinkingIndicator(): void {
  hideEmptyState();
  if (document.getElementById("thinking-indicator")) return;
  const timeline = $("timeline");
  const { row, bubble } = buildMessage("assistant");
  row.id = "thinking-indicator";
  bubble.innerHTML = `
    <span style="display:inline-flex; gap:5px; align-items:center;">
      <span style="width:6px;height:6px;border-radius:50%;background:#8A8170;animation:dotPulse 1.2s ease-in-out 0s infinite;"></span>
      <span style="width:6px;height:6px;border-radius:50%;background:#8A8170;animation:dotPulse 1.2s ease-in-out 0.2s infinite;"></span>
      <span style="width:6px;height:6px;border-radius:50%;background:#8A8170;animation:dotPulse 1.2s ease-in-out 0.4s infinite;"></span>
    </span>`;
  timeline.appendChild(row);
  scrollTimelineToBottom();
}

export function hideThinkingIndicator(): void {
  document.getElementById("thinking-indicator")?.remove();
}

export function updateOrb(state: OrbState): void {
  const cfg = STATE_CFG[state];
  const stage = document.getElementById("orb-stage");
  if (stage) stage.className = "orb-stage " + cfg.stage;
  const dot = document.getElementById("state-dot");
  if (dot) dot.className = "state-dot " + cfg.dot;
  const text = document.getElementById("state-text");
  if (text) text.textContent = cfg.text;
  const wave = document.getElementById("orb-wave");
  if (wave) wave.classList.toggle("show", cfg.wave);
  const status = document.getElementById("status");
  if (status) status.textContent = cfg.sub;
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
