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

/** Strict topic extractor: min length 5, drops stop words and digits. */
export function extractTopics(
  turns: TurnRecord[],
  topN = 8
): Array<{ word: string; count: number }> {
  const freq: Record<string, number> = {};
  for (const turn of turns) {
    const words = turn.transcript
      .toLowerCase()
      .replace(/[^a-z\s']/g, "")
      .split(/\s+/);
    for (const word of words) {
      if (word.length < 5) continue;
      if (STRICT_STOP_WORDS.has(word)) continue;
      if (/^\d+$/.test(word)) continue;
      freq[word] = (freq[word] || 0) + 1;
    }
  }
  return Object.entries(freq)
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

export function renderSummary(data: SessionSummary, root: HTMLElement): void {
  const safePct = data.parent_summary.safe_turns_pct;
  const total = data.parent_summary.total_turns;
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

    <div class="summary-section">
      <h2>Safety distribution</h2>
      <div class="card">
        <div class="donut-row">
          <div class="donut-wrap">
            <div class="donut" id="donut"></div>
            <div class="donut-center-label">
              <span class="num">${total}</span>
              <span class="lbl">turns</span>
            </div>
          </div>
          <div class="legend" id="legend"></div>
        </div>
      </div>
    </div>

    <div class="summary-section">
      <h2>Activity over time</h2>
      <div class="card"><div id="activity-chart"></div></div>
    </div>

    <div class="summary-section">
      <h2>Topics discussed</h2>
      <div class="card"><div class="topics" id="topics"></div></div>
    </div>

    <div class="summary-section">
      <h2>Safety events</h2>
      <div class="card">
        ${renderEventsTable(data)}
      </div>
    </div>
  `;

  renderDonut(data, root.querySelector<HTMLDivElement>("#donut")!);
  renderLegend(data, root.querySelector<HTMLDivElement>("#legend")!);
  renderActivityChart(data, root.querySelector<HTMLDivElement>("#activity-chart")!);
  renderTopics(data, root.querySelector<HTMLDivElement>("#topics")!);

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

function renderEventsTable(data: SessionSummary): string {
  if (!data.safety_events.length) {
    return `<p style="color: var(--muted-light); margin: 0">No safety events recorded.</p>`;
  }
  const turnMap = new Map(data.turns.map((t) => [t.turn_id, t]));
  const rows = data.safety_events.map((e, i) => {
    const turn = turnMap.get(e.turn_id);
    const transcript = turn?.transcript ?? "(no transcript)";
    const truncated = transcript.length > 120 ? transcript.slice(0, 120) + "…" : transcript;
    const color = REASON_COLORS[e.reason_code] ?? "var(--muted-light)";
    return `
      <tr>
        <td>${i + 1}</td>
        <td class="transcript">${escapeHtml(truncated)}</td>
        <td><span class="badge" style="color:${color}"><span class="dot"></span>${e.reason_code}</span></td>
        <td><span class="mono" style="font-size:12px;color:var(--muted-light)">${escapeHtml(e.action_taken)}</span></td>
      </tr>
    `;
  }).join("");
  return `
    <table class="events-table">
      <thead><tr><th>#</th><th>Transcript</th><th>Reason</th><th>Action</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderDonut(data: SessionSummary, host: HTMLDivElement): void {
  const counts = data.reason_code_counts ?? {};
  const entries = Object.entries(counts).filter(([, n]) => n > 0);
  const total = entries.reduce((s, [, n]) => s + n, 0);

  const r = 80;
  const C = 2 * Math.PI * r;

  if (total === 0) {
    host.innerHTML = `
      <svg viewBox="0 0 200 200" width="200" height="200" role="img" aria-label="No safety events">
        <circle cx="100" cy="100" r="${r}" fill="none" stroke="#e5e5e5" stroke-width="32" />
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
    return `<circle cx="100" cy="100" r="${r}" fill="none"
              stroke="${REASON_COLORS[code] ?? "var(--muted-light)"}"
              stroke-width="32"
              stroke-dasharray="${dasharray}"
              stroke-dashoffset="${dashoffset}"
              stroke-linecap="butt"
              transform="rotate(-90 100 100)" />`;
  }).join("");

  host.innerHTML = `
    <svg viewBox="0 0 200 200" width="200" height="200" role="img" aria-label="Safety reason code distribution">
      ${segments}
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
  host.innerHTML = entries.map(([code, n]) => `
    <div class="legend-row">
      <span class="swatch" style="background:${REASON_COLORS[code] ?? "var(--muted-light)"}"></span>
      <span class="name">${code}</span>
      <span class="count">${n}</span>
    </div>
  `).join("");
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
  const W = 720;
  const H = 180;
  const padL = 32, padR = 16, padT = 16, padB = 28;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const barW = innerW / BUCKETS - 6;

  const bars = buckets.map((b, i) => {
    const h = (b.count / maxCount) * innerH;
    const x = padL + i * (innerW / BUCKETS) + 3;
    const y = padT + innerH - h;
    let dominant = "SAFE_OK";
    let max = 0;
    b.reasons.forEach((n, code) => {
      if (n > max) { max = n; dominant = code; }
    });
    const color = b.count === 0 ? "#e5e5e5" : (REASON_COLORS[dominant] ?? "var(--muted-light)");
    return `<rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="3" fill="${color}">
      <title>${b.count} turn${b.count === 1 ? "" : "s"}</title>
    </rect>`;
  }).join("");

  const labels = Array.from({ length: BUCKETS + 1 }, (_, i) => {
    const tSec = Math.round((i * total) / BUCKETS / 1000);
    const m = Math.floor(tSec / 60);
    const s = (tSec % 60).toString().padStart(2, "0");
    const x = padL + i * (innerW / BUCKETS);
    return `<text x="${x}" y="${H - 8}" font-size="10" fill="#9ca3af" text-anchor="middle" font-family="JetBrains Mono, monospace">${m}:${s}</text>`;
  }).join("");

  host.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Activity over time">
      <line x1="${padL}" y1="${padT + innerH}" x2="${W - padR}" y2="${padT + innerH}" stroke="#e5e5e5" stroke-width="1" />
      ${bars}
      ${labels}
    </svg>
  `;
}

function renderTopics(data: SessionSummary, host: HTMLDivElement): void {
  const top = extractTopics(data.turns, 8);
  if (!top.length) {
    host.innerHTML = `<span style="color: var(--muted-light); font-size: 13px">No topics extracted.</span>`;
    return;
  }
  host.innerHTML = top
    .map((t) => `<span class="topic-pill">${escapeHtml(t.word)}<span class="count">${t.count}</span></span>`)
    .join("");
}
