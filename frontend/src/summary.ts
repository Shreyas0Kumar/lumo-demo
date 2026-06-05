export interface TurnRecord {
  turn_id: string;
  role: "user" | "assistant";
  transcript: string;
  timestamp: string;
}

export interface SafetyEventRecord {
  turn_id: string;
  reason_code: string;
  action_taken: string;
  timestamp: string;
}

export interface SessionSummary {
  session_id: string;
  age_band: string;
  started_at: string;
  ended_at: string | null;
  turns: TurnRecord[];
  safety_events: SafetyEventRecord[];
  reason_code_counts: Record<string, number>;
  duration_seconds: number | null;
  parent_summary: {
    highlights: Array<{ turn_id: string; snippet: string; timestamp: string }>;
    escalations: Array<{ turn_id: string; transcript: string | null; timestamp: string }>;
    safe_turns_pct: number;
    total_turns: number;
    safe_ok_count: number;
  };
}

const REASON_COLORS: Record<string, string> = {
  SAFE_OK: "var(--c-ok)",
  SAFE_REDIRECTED_GENERAL: "var(--c-redirect)",
  SAFE_ESCALATE_PARENT: "var(--c-escalate)",
  SAFE_REFUSED_HARM: "var(--c-harm)",
  SAFE_BOUNDARY_DEPENDENCY_LANGUAGE: "var(--c-dependency)",
  SAFE_MINIMIZED_SENSITIVE_DISCLOSURE: "var(--c-sensitive)",
  SAFE_AGE_ADAPTED: "var(--c-age)",
};

const BACKEND_HTTP = (import.meta.env.VITE_BACKEND_HTTP as string | undefined) ?? "";

export async function fetchSummary(sessionId: string): Promise<SessionSummary> {
  // End the session first so ended_at + duration_seconds are populated.
  await fetch(`${BACKEND_HTTP}/session/${sessionId}/end`, { method: "POST" }).catch(
    () => undefined
  );
  const res = await fetch(`${BACKEND_HTTP}/session/${sessionId}/summary`);
  if (!res.ok) throw new Error(`summary fetch failed: ${res.status}`);
  return res.json();
}

/**
 * Topic extractor with a higher bar: a word counts as a topic only if it's
 * (a) directly named in a curiosity phrase ("tell me about X", "what is X",
 *     "know about X", "learn about X"), OR
 * (b) repeated at least twice.
 *
 * Filler verbs / adverbs / generic adjectives are dropped via the stop-word
 * list below regardless. Min length 6.
 */
export function extractTopics(
  turns: TurnRecord[],
  topN = 6
): Array<{ word: string; count: number }> {
  const freq: Record<string, number> = {};
  const namedAsTopic = new Set<string>();

  // Curiosity-phrase patterns. We grab the next 1-2 alphabetic words after each.
  const CURIOSITY_PATTERNS = [
    /\b(?:about|regarding)\s+(?:the\s+|a\s+|an\s+)?([a-z']{4,})/g,
    /\bwhat\s+(?:is|are|was|were)\s+(?:a\s+|an\s+|the\s+)?([a-z']{4,})/g,
    /\btell\s+me\s+(?:about\s+)?(?:the\s+|a\s+|an\s+)?([a-z']{4,})/g,
    /\b(?:know|learn|hear|study)\s+(?:about\s+|more\s+about\s+)(?:the\s+|a\s+|an\s+)?([a-z']{4,})/g,
    /\bwhy\s+(?:do|does|are|is)\s+(?:[a-z']+\s+){0,2}([a-z']{4,})/g,
  ];

  for (const turn of turns) {
    const text = turn.transcript.toLowerCase();

    // (a) phrase-driven extraction
    for (const pattern of CURIOSITY_PATTERNS) {
      pattern.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(text)) !== null) {
        const w = m[1].replace(/[^a-z']/g, "");
        if (w.length < 4) continue;
        if (STRICT_STOP_WORDS.has(w)) continue;
        namedAsTopic.add(w);
        freq[w] = (freq[w] || 0) + 2; // weight phrase-named topics higher
      }
    }

    // (b) frequency-driven extraction
    const words = text.replace(/[^a-z\s']/g, "").split(/\s+/);
    for (const word of words) {
      if (word.length < 6) continue;
      if (STRICT_STOP_WORDS.has(word)) continue;
      if (/^\d+$/.test(word)) continue;
      freq[word] = (freq[word] || 0) + 1;
    }
  }

  // Keep only words that are either named-as-topic OR repeated (count >= 2).
  return Object.entries(freq)
    .filter(([word, n]) => namedAsTopic.has(word) || n >= 2)
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, topN);
}

const STRICT_STOP_WORDS = new Set([
  // articles / prepositions / conjunctions
  "the","a","an","and","or","but","in","on","at","to","for","of","with","by",
  "from","up","about","into","through","is","are","was","were","be","been",
  "being","have","has","had","do","does","did","will","would","could","should",
  "may","might","shall","can","need","dare","ought","used",
  // pronouns / determiners / common fillers
  "that","this","these","those","there","their","they","them","theirs","themselves",
  "what","which","who","when","where","whose","whom",
  "just","also","very","really","quite","rather","pretty","fairly",
  "some","any","each","every","both","another","other","others","such",
  "than","then","now","only","even","still","still","yet","always","never",
  "back","here","there","over","under","again","once","twice","further",
  // affirmatives / negatives / interjections
  "yeah","yes","okay","right","actually","actually","anyway",
  "hello","goodbye","please","thanks","thank","welcome",
  // common verbs / hedges that aren't topical
  "like","know","think","said","tell","make","want","good","going","come",
  "sure","need","needs","needed","feel","feels","felt","seem","seems",
  "look","looks","looking","find","found","take","took","taking","give",
  "gave","given","said","says","getting","gets","work","works","working",
  "would","could","should","might",
  // empty content
  "things","thing","something","anything","everything","because","while",
  "lumo","hello","goodbye","because","maybe","perhaps",
  // pronouns (length filter catches most but list explicitly)
  "your","yours","yourself","yourselves","ours","ourselves","myself","himself",
  "herself","itself","theirs","ourself","oneself",
  // common adjectives that aren't topical
  "great","awesome","amazing","cool","nice","fine","kind","sort",
  "little","small","tall","short","large","huge","tiny","fast","slow",
  "dark","light","heavy","clean","dirty","empty","full",
  // gerunds and present participles that are usually filler
  "doing","going","coming","saying","telling","asking","getting","having",
  "making","taking","giving","trying","starting","stopping","keeping",
  "feeling","listening","reading","writing","seeing","hearing","talking",
  "thinking","looking","wondering","wanting","needing","hoping",
  // common adverbs
  "really","simply","mostly","usually","often","sometimes","always","never",
  "again","today","tomorrow","yesterday","later","earlier","soon","ever",
  // generic time / state words
  "ready","simple","complex","normal","special","particular","certain",
  "important","possible","available","basic","common","popular","recent",
  "current","actual","correct","wrong","right","whole",
  // common social filler that slips through length=6+ filter
  "you're","i'm","we're","they're","it's","that's","what's","here's",
]);

export function renderSkeleton(root: HTMLElement): void {
  root.innerHTML = `
    <div style="margin-bottom: 32px">
      <div class="skeleton" style="height: 32px; width: 240px; margin-bottom: 12px"></div>
      <div class="skeleton" style="height: 16px; width: 320px"></div>
    </div>
    <div class="stat-cards">
      <div class="skeleton" style="height: 100px"></div>
      <div class="skeleton" style="height: 100px"></div>
      <div class="skeleton" style="height: 100px"></div>
    </div>
    <div class="skeleton" style="height: 280px; margin-bottom: 24px"></div>
    <div class="skeleton" style="height: 200px"></div>
  `;
}

function fmtDuration(seconds: number | null | undefined): string {
  if (!seconds) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function fmtTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString();
}

// Single source of truth for the active table filter; null means "show all".
type FilterState =
  | { kind: "reason"; value: string }
  | { kind: "topic"; value: string }
  | null;

let activeFilter: FilterState = null;
let summaryRoot: HTMLElement | null = null;
let cachedData: SessionSummary | null = null;

export function renderSummary(data: SessionSummary, root: HTMLElement): void {
  summaryRoot = root;
  cachedData = data;
  activeFilter = null;

  const safePct = data.parent_summary.safe_turns_pct;
  const total = data.parent_summary.total_turns;
  const totalEvents = data.safety_events.length;
  const duration = data.duration_seconds ?? 0;

  const escalations = data.parent_summary.escalations;
  const escalateBanner = escalations.length
    ? `<div class="escalate-banner">
         <h3>Lumo flagged some topics for your attention</h3>
         <ul>
           ${escalations.map((e) => `<li>${escapeHtml(e.transcript ?? "(no transcript)")}</li>`).join("")}
         </ul>
       </div>`
    : "";

  root.innerHTML = `
    <div class="summary-header">
      <div>
        <h1>Session complete</h1>
        <div class="summary-meta">
          <span class="badge">Age ${escapeHtml(data.age_band)}</span>
          <span>${fmtDuration(duration)} total</span>
          <span>·</span>
          <span>${fmtTimestamp(data.started_at)}</span>
        </div>
      </div>
      <div style="display:flex; gap:12px; flex-wrap:wrap">
        <button class="btn-ghost" id="copy-link-btn">Copy link</button>
        <button class="btn-ghost" id="download-json-btn">Download JSON ↓</button>
        <button class="btn-primary" id="new-session-btn">Start new session</button>
      </div>
    </div>

    ${escalateBanner}

    <div class="stat-cards">
      <div class="stat-card">
        <div class="stat-label">Total turns</div>
        <div class="stat-value">${total}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Safe turns</div>
        <div class="stat-value">${safePct}%</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Duration</div>
        <div class="stat-value">${fmtDuration(duration)}</div>
      </div>
    </div>

    <div class="summary-row">
      <div class="summary-section section-half">
        <h2>Safety distribution</h2>
        <div class="card">
          <div class="donut-row">
            <div class="donut-wrap">
              <div class="donut" id="donut" data-total="${totalEvents}"></div>
            </div>
            <div class="legend" id="legend"></div>
          </div>
        </div>
      </div>

      <div class="summary-section section-half">
        <h2>Activity over time</h2>
        <div class="card"><div id="activity-chart"></div></div>
      </div>
    </div>

    <div class="summary-section">
      <h2>Topics discussed</h2>
      <div class="card card-tight"><div class="topics" id="topics"></div></div>
    </div>

    <div class="summary-section">
      <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom: 20px;">
        <h2 style="margin:0">Conversation</h2>
        <div id="filter-chip" style="display:none; align-items:center; gap:8px; font-size:13px; color:var(--ink-soft);">
          <span>Filtered by</span>
          <span id="filter-chip-label" class="badge" style="cursor:pointer"></span>
          <button id="filter-chip-clear" style="border:none; background:transparent; cursor:pointer; color:var(--ink-mute); font-size:18px; line-height:1; padding:2px 6px;" aria-label="Clear filter">×</button>
        </div>
      </div>
      <div class="card" id="events-card">
        ${renderConversation(data)}
      </div>
    </div>
  `;

  renderDonut(data, root.querySelector<HTMLDivElement>("#donut")!);
  renderLegend(data, root.querySelector<HTMLDivElement>("#legend")!);
  renderActivityChart(data, root.querySelector<HTMLDivElement>("#activity-chart")!);
  renderTopics(data, root.querySelector<HTMLDivElement>("#topics")!);
  wireInteractions(data, root);

  root.querySelector<HTMLButtonElement>("#download-json-btn")?.addEventListener(
    "click",
    () => downloadSummary(data)
  );

  const copyBtn = root.querySelector<HTMLButtonElement>("#copy-link-btn");
  if (copyBtn) {
    copyBtn.onclick = async () => {
      const url = `${window.location.origin}/summary/${data.session_id}`;
      try {
        await navigator.clipboard.writeText(url);
        const original = copyBtn.textContent;
        copyBtn.textContent = "Copied ✓";
        setTimeout(() => { copyBtn.textContent = original ?? "Copy link"; }, 2000);
      } catch {
        prompt("Copy this link:", url);
      }
    };
  }
}

// ─────────── Interactions ───────────

function wireInteractions(data: SessionSummary, root: HTMLElement): void {
  // Click reason code in donut OR legend → filter table to that reason.
  root.querySelectorAll<SVGElement>("[data-reason-code]").forEach((el) => {
    el.addEventListener("click", () => {
      const code = el.getAttribute("data-reason-code")!;
      setFilter(activeFilter?.kind === "reason" && activeFilter.value === code ? null : { kind: "reason", value: code });
    });
  });

  // Click topic pill → filter table to turns containing that word.
  root.querySelectorAll<HTMLElement>(".topic-pill[data-word]").forEach((pill) => {
    pill.addEventListener("click", () => {
      const word = pill.getAttribute("data-word")!;
      setFilter(activeFilter?.kind === "topic" && activeFilter.value === word ? null : { kind: "topic", value: word });
    });
  });

  // Click activity bar → scroll to + briefly flash the matching conversation turns.
  root.querySelectorAll<SVGElement>("[data-bucket-turns]").forEach((bar) => {
    bar.addEventListener("click", () => {
      const ids = (bar.getAttribute("data-bucket-turns") ?? "").split(",").filter(Boolean);
      if (!ids.length) return;
      const first = root.querySelector<HTMLElement>(`.conv-turn[data-turn-id="${CSS.escape(ids[0])}"]`);
      first?.scrollIntoView({ behavior: "smooth", block: "center" });
      ids.forEach((id) => {
        const t = root.querySelector<HTMLElement>(`.conv-turn[data-turn-id="${CSS.escape(id)}"]`);
        if (!t) return;
        t.classList.add("conv-flash");
        setTimeout(() => t.classList.remove("conv-flash"), 1600);
      });
    });
  });

  // Click any conversation turn → toggle expanded detail.
  root.querySelectorAll<HTMLElement>(".conv-turn").forEach((turn) => {
    turn.addEventListener("click", () => toggleConvExpanded(turn, data));
  });

  // Clear filter chip.
  root.querySelector<HTMLButtonElement>("#filter-chip-clear")?.addEventListener("click", () => setFilter(null));
}

function setFilter(next: FilterState): void {
  activeFilter = next;
  if (!summaryRoot) return;
  applyFilterToDOM(summaryRoot);
}

function applyFilterToDOM(root: HTMLElement): void {
  // Update legend selected state.
  root.querySelectorAll<HTMLElement>(".legend-row").forEach((row) => {
    const code = row.getAttribute("data-reason-code");
    const active = activeFilter?.kind === "reason" && activeFilter.value === code;
    row.classList.toggle("selected", !!active);
  });
  // Update topic pill selected state.
  root.querySelectorAll<HTMLElement>(".topic-pill").forEach((pill) => {
    const word = pill.getAttribute("data-word");
    const active = activeFilter?.kind === "topic" && activeFilter.value === word;
    pill.classList.toggle("selected", !!active);
  });
  // Update donut segment selected state (dim others).
  const segments = root.querySelectorAll<SVGCircleElement>("circle[data-reason-code]");
  segments.forEach((seg) => {
    if (activeFilter?.kind !== "reason") {
      seg.style.opacity = "1";
      return;
    }
    seg.style.opacity = seg.getAttribute("data-reason-code") === activeFilter.value ? "1" : "0.25";
  });
  // Fade non-matching conversation turns.
  root.querySelectorAll<HTMLElement>(".conv-turn").forEach((turn) => {
    const reason = turn.getAttribute("data-reason-code") ?? "";
    const transcript = (turn.getAttribute("data-transcript") ?? "").toLowerCase();
    let match = true;
    if (activeFilter?.kind === "reason") {
      // For reason filtering, only USER turns can match (only they have reason codes).
      // Assistant turns also fade since they don't carry a reason.
      match = reason === activeFilter.value;
    } else if (activeFilter?.kind === "topic") {
      match = transcript.includes(activeFilter.value);
    }
    turn.classList.toggle("filtered-out", !match);
  });
  // Filter chip visibility.
  const chip = root.querySelector<HTMLElement>("#filter-chip");
  const label = root.querySelector<HTMLElement>("#filter-chip-label");
  if (!chip || !label) return;
  if (activeFilter) {
    chip.style.display = "flex";
    label.textContent = activeFilter.kind === "reason"
      ? activeFilter.value
      : `topic: ${activeFilter.value}`;
    if (activeFilter.kind === "reason") {
      label.style.color = REASON_COLORS[activeFilter.value] ?? "var(--ink)";
    } else {
      label.style.color = "var(--ink)";
    }
  } else {
    chip.style.display = "none";
  }
}

function toggleConvExpanded(turnEl: HTMLElement, data: SessionSummary): void {
  const turnId = turnEl.getAttribute("data-turn-id")!;
  const existing = turnEl.nextElementSibling as HTMLElement | null;
  if (existing?.classList.contains("conv-expanded")) {
    existing.remove();
    turnEl.classList.remove("expanded");
    return;
  }
  const turn = data.turns.find((t) => t.turn_id === turnId);
  if (!turn) return;
  const eventForTurn = data.safety_events.find((e) => e.turn_id === turnId);
  const role = turn.role === "user" ? "Child" : "Lumo";
  const isUser = turn.role === "user";
  const detail = document.createElement("div");
  detail.className = "conv-expanded";
  detail.style.cssText = `display:flex; ${isUser ? "justify-content:flex-end;" : "justify-content:flex-start;"} margin: -8px 0 16px;`;
  detail.innerHTML = `
    <div style="max-width:85%; background:var(--paper); border:1px dashed var(--rule); border-radius:10px; padding:12px 14px;">
      <div style="display:flex; gap:20px; flex-wrap:wrap; font-size:11px; color:var(--ink-mute); text-transform:uppercase; letter-spacing:0.06em; margin-bottom:10px;">
        <div><span style="display:block; font-size:13px; text-transform:none; letter-spacing:0; color:var(--ink-soft); margin-top:2px;">${role}</span>Role</div>
        <div><span style="display:block; font-size:13px; text-transform:none; letter-spacing:0; color:var(--ink-soft); margin-top:2px;">${fmtTimestamp(turn.timestamp)}</span>Time</div>
        ${eventForTurn ? `<div><span style="display:block; font-size:13px; text-transform:none; letter-spacing:0; color:var(--ink-soft); margin-top:2px;">${escapeHtml(eventForTurn.action_taken)}</span>Action</div>` : ""}
      </div>
      <div style="font-size:14px; line-height:1.55; color:var(--ink); white-space:pre-wrap;">${escapeHtml(turn.transcript || "(no transcript)")}</div>
    </div>
  `;
  turnEl.classList.add("expanded");
  turnEl.after(detail);
}

export function downloadSummary(data: SessionSummary): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `lumo-session-${data.session_id.slice(0, 8)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]!);
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function renderConversation(data: SessionSummary): string {
  if (!data.turns.length) {
    return `<p style="color: var(--ink-mute); margin: 0">No turns recorded for this session.</p>`;
  }

  const reasonByTurn = new Map(data.safety_events.map((e) => [e.turn_id, e]));
  const userTurns = data.turns.filter((t) => t.role === "user");
  const flaggedUserTurns = userTurns.filter((t) => {
    const ev = reasonByTurn.get(t.turn_id);
    return ev && ev.reason_code !== "SAFE_OK";
  });

  // Banner above the conversation.
  let banner = "";
  if (flaggedUserTurns.length === 0) {
    banner = `
      <div style="display:flex; align-items:center; gap:10px; padding:10px 14px; background:#EEF6EE; border:1px solid #CFE3D0; border-radius:10px; margin-bottom:18px; font-size:13px; color:#386A4A;">
        <span style="font-size:14px;">✓</span>
        <span>All ${userTurns.length} user turn${userTurns.length === 1 ? "" : "s"} passed safety checks. Tap any turn to expand.</span>
      </div>`;
  } else {
    const flaggedItems = flaggedUserTurns.slice(0, 3).map((t) => {
      const ev = reasonByTurn.get(t.turn_id)!;
      const color = REASON_COLORS[ev.reason_code] ?? "var(--ink-mute)";
      const snip = t.transcript.length > 80 ? t.transcript.slice(0, 80) + "…" : t.transcript;
      return `<li><span class="badge" style="color:${color}; padding:1px 6px; font-size:10px;"><span class="dot"></span>${ev.reason_code}</span> <span style="color:var(--ink-soft);">${escapeHtml(snip)}</span></li>`;
    }).join("");
    const moreCount = flaggedUserTurns.length - 3;
    const more = moreCount > 0 ? `<li style="color:var(--ink-mute); list-style:none; margin-left:-20px;">+ ${moreCount} more flagged</li>` : "";
    banner = `
      <div style="padding:12px 14px; background:#FFF6E0; border:1px solid #F3D89B; border-radius:10px; margin-bottom:18px; font-size:13px; color:#7A5410;">
        <div style="display:flex; align-items:center; gap:10px; margin-bottom:8px;"><span style="font-size:14px;">⚠</span><strong>${flaggedUserTurns.length} of ${userTurns.length} user turns flagged for review</strong></div>
        <ul style="margin:6px 0 0; padding-left:20px; line-height:1.7;">${flaggedItems}${more}</ul>
      </div>`;
  }

  // Conversation turns (chronological, both roles).
  const items = data.turns.map((t, i) => {
    const ev = reasonByTurn.get(t.turn_id);
    const isUser = t.role === "user";
    const reasonCode = ev?.reason_code ?? "";
    const isFlagged = isUser && reasonCode && reasonCode !== "SAFE_OK";
    const color = isFlagged ? (REASON_COLORS[reasonCode] ?? "var(--ink-mute)") : "var(--c-ok)";
    const transcriptAttr = escapeAttr(t.transcript.toLowerCase());
    const snippet = t.transcript.length > 140 ? t.transcript.slice(0, 140) + "…" : t.transcript;
    const sideStyle = isUser
      ? "justify-content:flex-end;"
      : "justify-content:flex-start;";
    const bubbleStyle = isUser
      ? `background:var(--paper-2); border:1px solid var(--rule); border-radius:14px 14px 4px 14px; max-width:75%;`
      : `background:transparent; border-left:2px solid var(--rule); padding-left:12px; border-radius:0; max-width:80%;`;
    const flaggedBubbleExtra = isFlagged
      ? `box-shadow: 0 0 0 2px ${color}33; border-color:${color};`
      : "";
    const badgeHtml = isUser
      ? `<span class="conv-badge" style="display:inline-flex; align-items:center; gap:4px; margin-top:6px; font-size:11px; color:${color}; font-family:'JetBrains Mono', monospace;">
           <span style="width:6px; height:6px; border-radius:50%; background:${color};"></span>
           ${isFlagged ? reasonCode : "SAFE_OK"}
         </span>`
      : `<span style="font-size:11px; color:var(--ink-mute); font-family:'JetBrains Mono', monospace; display:block; margin-bottom:4px; letter-spacing:0.04em;">LUMO</span>`;
    return `
      <div class="conv-turn" data-turn-id="${escapeAttr(t.turn_id)}" data-reason-code="${escapeAttr(reasonCode || "")}" data-transcript="${transcriptAttr}" style="display:flex; ${sideStyle} margin-bottom:14px;">
        <div style="${bubbleStyle} ${flaggedBubbleExtra} padding:10px 14px; cursor:pointer; transition: opacity 0.2s, transform 0.12s;">
          ${!isUser ? badgeHtml : ""}
          <div style="font-size:14px; line-height:1.55; color:var(--ink);">${escapeHtml(snippet) || "<em style='color:var(--ink-mute)'>(empty)</em>"}</div>
          ${isUser ? badgeHtml : ""}
        </div>
      </div>
    `;
  }).join("");

  return `${banner}<div id="conv-list" style="display:flex; flex-direction:column;">${items}</div>`;
}

function renderDonut(data: SessionSummary, host: HTMLDivElement): void {
  const counts = data.reason_code_counts ?? {};
  const entries = Object.entries(counts).filter(([, n]) => n > 0);
  const total = entries.reduce((s, [, n]) => s + n, 0);

  const r = 80;
  const C = 2 * Math.PI * r;

  const centerLabel = `
    <text x="100" y="98" text-anchor="middle" dominant-baseline="middle"
          font-size="28" font-weight="600" font-family="Fraunces, ui-serif, serif"
          fill="var(--ink)" style="font-variation-settings: 'opsz' 144;">${total}</text>
    <text x="100" y="120" text-anchor="middle" dominant-baseline="middle"
          font-size="9" letter-spacing="0.12em" fill="var(--ink-mute)"
          font-family="JetBrains Mono, monospace">EVENTS</text>
  `;

  if (total === 0) {
    host.innerHTML = `
      <svg viewBox="0 0 200 200" width="200" height="200" role="img" aria-label="No safety events">
        <circle cx="100" cy="100" r="${r}" fill="none" stroke="#e5e5e5" stroke-width="32" />
        ${centerLabel}
      </svg>
    `;
    return;
  }

  let offset = 0;
  const segments = entries.map(([code, n]) => {
    const seg = (n / total) * C;
    const dasharray = `${seg} ${C - seg}`;
    const dashoffset = -offset;
    offset += seg;
    const pct = Math.round((n / total) * 100);
    return `<circle cx="100" cy="100" r="${r}" fill="none"
              stroke="${REASON_COLORS[code] ?? "var(--muted-light)"}"
              stroke-width="32"
              stroke-dasharray="${dasharray}"
              stroke-dashoffset="${dashoffset}"
              stroke-linecap="butt"
              transform="rotate(-90 100 100)"
              data-reason-code="${escapeAttr(code)}"
              style="cursor:pointer; transition: opacity 0.15s, stroke-width 0.15s;"
              onmouseover="this.style.strokeWidth='36'"
              onmouseout="this.style.strokeWidth='32'"
            ><title>${code} — ${n} (${pct}%)</title></circle>`;
  }).join("");

  host.innerHTML = `
    <svg viewBox="0 0 200 200" width="200" height="200" role="img" aria-label="Safety reason code distribution">
      ${segments}
      ${centerLabel}
    </svg>
  `;
}

function renderLegend(data: SessionSummary, host: HTMLDivElement): void {
  const counts = data.reason_code_counts ?? {};
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!entries.length) {
    host.innerHTML = `<div style="color: var(--muted-light); font-size: 13px">No events recorded.</div>`;
    return;
  }
  const total = entries.reduce((s, [, n]) => s + n, 0);
  host.innerHTML = entries.map(([code, n]) => {
    const pct = Math.round((n / total) * 100);
    return `
      <div class="legend-row" data-reason-code="${escapeAttr(code)}" role="button" tabindex="0">
        <span class="swatch" style="background:${REASON_COLORS[code] ?? "var(--muted-light)"}"></span>
        <span class="name">${code}</span>
        <span class="count">${n} · ${pct}%</span>
      </div>
    `;
  }).join("");
}

function renderActivityChart(data: SessionSummary, host: HTMLDivElement): void {
  const turns = data.turns;
  if (!turns.length) {
    host.innerHTML = `<p style="color: var(--muted-light); margin: 0">No activity to chart.</p>`;
    return;
  }
  const startMs = new Date(data.started_at).getTime();
  const endMs = data.ended_at
    ? new Date(data.ended_at).getTime()
    : new Date(turns[turns.length - 1].timestamp).getTime();
  const total = Math.max(endMs - startMs, 1);

  const BUCKETS = 10;
  const bucketSize = total / BUCKETS;
  const buckets: Array<{ count: number; reasons: Map<string, number> }> = Array.from(
    { length: BUCKETS },
    () => ({ count: 0, reasons: new Map() })
  );

  const reasonByTurn = new Map(data.safety_events.map((e) => [e.turn_id, e.reason_code]));

  for (const t of turns) {
    const ts = new Date(t.timestamp).getTime();
    let idx = Math.floor((ts - startMs) / bucketSize);
    if (idx < 0) idx = 0;
    if (idx >= BUCKETS) idx = BUCKETS - 1;
    buckets[idx].count++;
    const reason = reasonByTurn.get(t.turn_id) ?? "SAFE_OK";
    buckets[idx].reasons.set(reason, (buckets[idx].reasons.get(reason) ?? 0) + 1);
  }

  const maxCount = Math.max(1, ...buckets.map((b) => b.count));
  // Designed for a half-width card. SVG uses width="100%" with no fixed height
  // so it scales to the container while preserving aspect ratio (viewBox-driven).
  const W = 480;
  const H = 220;
  const padL = 22, padR = 12, padT = 18, padB = 30;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const barW = innerW / BUCKETS - 2; // tighter gap, fatter bars

  // Track which turn IDs fell in each bucket so we can highlight them on click.
  const bucketTurnIds: string[][] = Array.from({ length: BUCKETS }, () => []);
  for (const t of turns) {
    const ts = new Date(t.timestamp).getTime();
    let idx = Math.floor((ts - startMs) / bucketSize);
    if (idx < 0) idx = 0;
    if (idx >= BUCKETS) idx = BUCKETS - 1;
    bucketTurnIds[idx].push(t.turn_id);
  }

  const fmtBucketRange = (i: number): string => {
    const a = Math.round((i * total) / BUCKETS / 1000);
    const b = Math.round(((i + 1) * total) / BUCKETS / 1000);
    const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
    return `${fmt(a)}–${fmt(b)}`;
  };

  const bars = buckets.map((b, i) => {
    const h = (b.count / maxCount) * innerH;
    const x = padL + i * (innerW / BUCKETS) + 1;
    const y = padT + innerH - h;
    let dominant = "SAFE_OK";
    let max = 0;
    b.reasons.forEach((n, code) => {
      if (n > max) { max = n; dominant = code; }
    });
    const empty = b.count === 0;
    // For all-safe sessions every bar would be SAFE_OK-green. Use the
    // horizontal gradient (teal → sun) instead for visual interest;
    // ONLY override with a reason-code color when something non-OK happened.
    const useGradient = !empty && dominant === "SAFE_OK";
    const fill = empty
      ? "#E3D7BE"
      : useGradient
      ? "url(#activityGradient)"
      : (REASON_COLORS[dominant] ?? "var(--muted-light)");
    const ids = bucketTurnIds[i].join(",");
    const tip = empty
      ? `${fmtBucketRange(i)} — no turns`
      : `${b.count} turn${b.count === 1 ? "" : "s"} · ${fmtBucketRange(i)}`;
    return `<rect x="${x}" y="${y}" width="${barW}" height="${empty ? 3 : h}" rx="4" fill="${fill}"
      data-bucket-turns="${escapeAttr(ids)}"
      style="${empty ? "" : "cursor:pointer; transition: opacity 0.15s;"}"
      ${empty ? "" : `onmouseover="this.style.opacity='0.78'" onmouseout="this.style.opacity='1'"`}
    ><title>${tip}</title></rect>`;
  }).join("");

  // Show labels only at every other tick if BUCKETS is dense, so they don't crowd.
  const labelStep = BUCKETS > 8 ? 2 : 1;
  const labels = Array.from({ length: BUCKETS + 1 }, (_, i) => {
    if (i % labelStep !== 0 && i !== BUCKETS) return "";
    const tSec = Math.round((i * total) / BUCKETS / 1000);
    const m = Math.floor(tSec / 60);
    const s = (tSec % 60).toString().padStart(2, "0");
    const x = padL + i * (innerW / BUCKETS);
    return `<text x="${x}" y="${H - 10}" font-size="11" fill="var(--ink-mute)" text-anchor="middle" font-family="JetBrains Mono, monospace">${m}:${s}</text>`;
  }).join("");

  host.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Activity over time" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="activityGradient" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"   stop-color="#3F8C85" />
          <stop offset="50%"  stop-color="#6FA8A1" />
          <stop offset="100%" stop-color="#F4B24A" />
        </linearGradient>
      </defs>
      <line x1="${padL}" y1="${padT + innerH}" x2="${W - padR}" y2="${padT + innerH}" stroke="var(--rule)" stroke-width="1" />
      ${bars}
      ${labels}
    </svg>
  `;
}

function renderTopics(data: SessionSummary, host: HTMLDivElement): void {
  const top = extractTopics(data.turns, 6);
  // Hide the entire section if nothing notable surfaced — better than
  // showing a sad "No topics extracted" message.
  const section = host.closest(".summary-section") as HTMLElement | null;
  if (!top.length) {
    if (section) section.style.display = "none";
    return;
  }
  if (section) section.style.display = "";
  host.innerHTML = top
    .map((t) => `<span class="topic-pill" data-word="${escapeAttr(t.word)}" role="button" tabindex="0">${escapeHtml(t.word)}<span class="count">${t.count}</span></span>`)
    .join("");
}
