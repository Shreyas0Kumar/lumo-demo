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

// ─────────────────────────── View model ───────────────────────────
// Both the real (backend) session and the canned showcase sessions are
// normalized to this shape so the same renderer draws either one.

type DotColor = "sun" | "teal" | "coral" | "mute";
type BarColor = "" | "teal" | "coral";

interface Exchange { q: string; a: string }
interface ViewTopic { label: string; count: number; pct: number; colorClass: BarColor; exchanges: Exchange[] }
interface ViewTLItem { time: string; dot: DotColor; label: string; desc: string }
interface ViewSafety { label: string; time: string; q: string; how: string }
interface SidebarTag { label: string; cls?: "flag" | "live" }

interface ViewSession {
  real: boolean;
  childInitial: string;
  useOrbAvatar: boolean;
  metaLine: string;
  title: string;
  duration: string;
  exchanges: number;
  topicCount: number;
  flags: number;
  topics: ViewTopic[];
  timeline: ViewTLItem[];
  safetyEvents: ViewSafety[];
  ctaText: string;
  sidebar: { date: string; meta: string; tags: SidebarTag[] };
  raw?: SessionSummary;
}

// ─────────────────────────── Topic extraction ───────────────────────────

/**
 * Topic extractor with a higher bar: a word counts as a topic only if it's
 * (a) directly named in a curiosity phrase, OR (b) repeated at least twice.
 */
export function extractTopics(
  turns: TurnRecord[],
  topN = 6
): Array<{ word: string; count: number }> {
  const freq: Record<string, number> = {};
  const namedAsTopic = new Set<string>();

  const CURIOSITY_PATTERNS = [
    /\b(?:about|regarding)\s+(?:the\s+|a\s+|an\s+)?([a-z']{4,})/g,
    /\bwhat\s+(?:is|are|was|were)\s+(?:a\s+|an\s+|the\s+)?([a-z']{4,})/g,
    /\btell\s+me\s+(?:about\s+)?(?:the\s+|a\s+|an\s+)?([a-z']{4,})/g,
    /\b(?:know|learn|hear|study)\s+(?:about\s+|more\s+about\s+)(?:the\s+|a\s+|an\s+)?([a-z']{4,})/g,
    /\bwhy\s+(?:do|does|are|is)\s+(?:[a-z']+\s+){0,2}([a-z']{4,})/g,
  ];

  for (const turn of turns) {
    const text = turn.transcript.toLowerCase();
    for (const pattern of CURIOSITY_PATTERNS) {
      pattern.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(text)) !== null) {
        const w = m[1].replace(/[^a-z']/g, "");
        if (w.length < 4) continue;
        if (STRICT_STOP_WORDS.has(w)) continue;
        namedAsTopic.add(w);
        freq[w] = (freq[w] || 0) + 2;
      }
    }
    const words = text.replace(/[^a-z\s']/g, "").split(/\s+/);
    for (const word of words) {
      if (word.length < 6) continue;
      if (STRICT_STOP_WORDS.has(word)) continue;
      if (/^\d+$/.test(word)) continue;
      freq[word] = (freq[word] || 0) + 1;
    }
  }

  return Object.entries(freq)
    .filter(([word, n]) => namedAsTopic.has(word) || n >= 2)
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, topN);
}

const STRICT_STOP_WORDS = new Set([
  "the","a","an","and","or","but","in","on","at","to","for","of","with","by",
  "from","up","about","into","through","is","are","was","were","be","been",
  "being","have","has","had","do","does","did","will","would","could","should",
  "may","might","shall","can","need","dare","ought","used",
  "that","this","these","those","there","their","they","them","theirs","themselves",
  "what","which","who","when","where","whose","whom",
  "just","also","very","really","quite","rather","pretty","fairly",
  "some","any","each","every","both","another","other","others","such",
  "than","then","now","only","even","still","still","yet","always","never",
  "back","here","there","over","under","again","once","twice","further",
  "yeah","yes","okay","right","actually","actually","anyway",
  "hello","goodbye","please","thanks","thank","welcome",
  "like","know","think","said","tell","make","want","good","going","come",
  "sure","need","needs","needed","feel","feels","felt","seem","seems",
  "look","looks","looking","find","found","take","took","taking","give",
  "gave","given","said","says","getting","gets","work","works","working",
  "would","could","should","might",
  "things","thing","something","anything","everything","because","while",
  "lumo","hello","goodbye","because","maybe","perhaps",
  "your","yours","yourself","yourselves","ours","ourselves","myself","himself",
  "herself","itself","theirs","ourself","oneself",
  "great","awesome","amazing","cool","nice","fine","kind","sort",
  "little","small","tall","short","large","huge","tiny","fast","slow",
  "dark","light","heavy","clean","dirty","empty","full",
  "doing","going","coming","saying","telling","asking","getting","having",
  "making","taking","giving","trying","starting","stopping","keeping",
  "feeling","listening","reading","writing","seeing","hearing","talking",
  "thinking","looking","wondering","wanting","needing","hoping",
  "really","simply","mostly","usually","often","sometimes","always","never",
  "again","today","tomorrow","yesterday","later","earlier","soon","ever",
  "ready","simple","complex","normal","special","particular","certain",
  "important","possible","available","basic","common","popular","recent",
  "current","actual","correct","wrong","right","whole",
  "you're","i'm","we're","they're","it's","that's","what's","here's",
]);

// ─────────────────────────── Formatting helpers ───────────────────────────

function fmtDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return "0m";
  const m = Math.round(seconds / 60);
  return m >= 1 ? `${m}m` : "<1m";
}

function fmtClock(iso: string): string {
  const d = new Date(iso);
  let h = d.getHours();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${d.getMinutes().toString().padStart(2, "0")} ${ampm}`;
}

function fmtTimeShort(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours() % 12 || 12;
  return `${h}:${d.getMinutes().toString().padStart(2, "0")}`;
}

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function dayLabel(d: Date): string {
  const today = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(today) - startOf(d)) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

function fmtDateLine(iso: string): string {
  const d = new Date(iso);
  return `${dayLabel(d)} · ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} · ${fmtClock(iso)}`;
}

function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

const REASON_LABELS: Record<string, string> = {
  SAFE_ESCALATE_PARENT: "Escalated to parent",
  SAFE_REFUSED_HARM: "Refused — harmful",
  SAFE_REDIRECTED_GENERAL: "Redirected",
  SAFE_BOUNDARY_DEPENDENCY_LANGUAGE: "Boundary set",
  SAFE_MINIMIZED_SENSITIVE_DISCLOSURE: "Sensitive topic",
  SAFE_AGE_ADAPTED: "Age-adapted",
};

function humanizeReason(code: string): string {
  return REASON_LABELS[code] ?? "Flagged topic";
}

// ─────────────────────────── Real → ViewSession ───────────────────────────

function toViewSession(data: SessionSummary, childName?: string): ViewSession {
  const name = (childName ?? "").trim();
  const turns = data.turns ?? [];
  const reasonByTurn = new Map(data.safety_events.map((e) => [e.turn_id, e]));

  // Pair each user turn with the next assistant turn (its answer).
  const pairs: Array<{ id: string; q: string; a: string; ts: string; flagged?: SafetyEventRecord }> = [];
  for (let i = 0; i < turns.length; i++) {
    if (turns[i].role !== "user") continue;
    let a = "";
    for (let j = i + 1; j < turns.length; j++) {
      if (turns[j].role === "assistant") { a = turns[j].transcript; break; }
    }
    const ev = reasonByTurn.get(turns[i].turn_id);
    pairs.push({
      id: turns[i].turn_id,
      q: turns[i].transcript,
      a,
      ts: turns[i].timestamp,
      flagged: ev && ev.reason_code !== "SAFE_OK" ? ev : undefined,
    });
  }

  // Topics → ViewTopic with relative pct and a few exchanges each.
  const extracted = extractTopics(turns, 5);
  const totalCount = extracted.reduce((s, t) => s + t.count, 0) || 1;
  const barColors: BarColor[] = ["", "teal", "coral", "", "teal"];
  const topics: ViewTopic[] = extracted.map((t, i) => {
    const exchanges = pairs
      .filter((p) => p.q.toLowerCase().includes(t.word))
      .slice(0, 3)
      .map((p) => ({ q: p.q, a: p.a || "(no response captured)" }));
    return {
      label: cap(t.word),
      count: t.count,
      pct: Math.max(4, Math.round((t.count / totalCount) * 100)),
      colorClass: barColors[i % barColors.length],
      exchanges: exchanges.length ? exchanges : [{ q: `Mentions of "${t.word}"`, a: "Discussed across the session." }],
    };
  });

  const flagged = data.safety_events.filter((e) => e.reason_code !== "SAFE_OK");
  const durationStr = fmtDuration(data.duration_seconds);
  const endIso = data.ended_at ?? (turns.length ? turns[turns.length - 1].timestamp : data.started_at);

  // Timeline: start → up to 8 user turns → end.
  const timeline: ViewTLItem[] = [];
  timeline.push({
    time: fmtTimeShort(data.started_at),
    dot: "sun",
    label: "Session started",
    desc: `Age band ${data.age_band} · set by parent`,
  });
  pairs.slice(0, 8).forEach((p, i) => {
    const snip = p.q.length > 70 ? p.q.slice(0, 70) + "…" : p.q;
    if (p.flagged) {
      timeline.push({
        time: fmtTimeShort(p.ts),
        dot: "coral",
        label: "Topic flagged",
        desc: `"${snip}" — ${humanizeReason(p.flagged.reason_code)}`,
      });
    } else {
      timeline.push({
        time: fmtTimeShort(p.ts),
        dot: i === 0 ? "mute" : "teal",
        label: i === 0 ? "First question" : "Question",
        desc: `"${snip}"`,
      });
    }
  });
  timeline.push({
    time: fmtTimeShort(endIso),
    dot: "sun",
    label: "Session ended",
    desc: `${durationStr} · ${flagged.length} flag${flagged.length === 1 ? "" : "s"} raised`,
  });

  const safetyEvents: ViewSafety[] = flagged.map((ev) => {
    const turn = turns.find((t) => t.turn_id === ev.turn_id);
    const q = turn?.transcript ? `"${turn.transcript}"` : "(flagged content withheld)";
    return {
      label: humanizeReason(ev.reason_code),
      time: fmtClock(ev.timestamp),
      q,
      how: ev.action_taken || "Lumo handled this within its guardrails and logged it for you.",
    };
  });

  const sidebarTags: SidebarTag[] = [{ label: "Live", cls: "live" }];
  if (topics[0]) sidebarTags.push({ label: topics[0].label });
  if (flagged.length) sidebarTags.push({ label: `⚑ ${flagged.length} flag`, cls: "flag" });

  return {
    real: true,
    childInitial: name ? name[0].toUpperCase() : "",
    useOrbAvatar: !name,
    metaLine: fmtDateLine(data.started_at),
    title: name ? `${name}'s session` : "This session",
    duration: durationStr,
    exchanges: data.parent_summary?.total_turns ?? pairs.length,
    topicCount: topics.length,
    flags: flagged.length,
    topics,
    timeline,
    safetyEvents,
    ctaText: `Age band ${data.age_band} · 2 min sessions`,
    sidebar: {
      date: dayLabel(new Date(data.started_at)) + `, ${MONTHS[new Date(data.started_at).getMonth()]} ${new Date(data.started_at).getDate()}`,
      meta: `${durationStr} · ${pairs.length} turn${pairs.length === 1 ? "" : "s"}`,
      tags: sidebarTags,
    },
    raw: data,
  };
}

// ─────────────────────────── Canned showcase sessions ───────────────────────────
// Illustrative history so a parent can see what past summaries look like.

const SAMPLE_SESSIONS: ViewSession[] = [
  {
    real: false, childInitial: "M", useOrbAvatar: false,
    metaLine: "Yesterday · Jun 5, 2026 · 4:30 PM", title: "Mia's session",
    duration: "15m", exchanges: 12, topicCount: 2, flags: 1,
    topics: [
      { label: "Animals", count: 8, pct: 70, colorClass: "", exchanges: [
        { q: "How do sharks breathe?", a: "Sharks breathe through gills — as water flows over them, the gills pull out oxygen. Most sharks keep swimming to push water across their gills." },
        { q: "Can sharks smell blood from far away?", a: "Yes! Sharks have an incredible sense of smell and can detect tiny amounts of blood in the water from a long way off." },
      ]},
      { label: "Feelings", count: 4, pct: 30, colorClass: "teal", exchanges: [
        { q: "Why do people get sad?", a: "Feeling sad is a natural emotion. People feel sad for lots of reasons, and talking to someone you trust always helps." },
      ]},
    ],
    timeline: [
      { time: "4:30", dot: "sun", label: "Session started", desc: "Age band 7–9 · 15 min maximum" },
      { time: "4:31", dot: "mute", label: "First question", desc: '"How do sharks breathe?"' },
      { time: "4:38", dot: "coral", label: "Topic flagged", desc: '"Why does mum cry sometimes?" — parent notified' },
      { time: "4:42", dot: "teal", label: "Redirected", desc: "Lumo gently suggested talking to a parent" },
      { time: "4:45", dot: "sun", label: "Session ended", desc: "15 min limit reached · 1 flag raised" },
    ],
    safetyEvents: [
      { label: "Sensitive topic", time: "4:38 PM", q: '"Why does mum cry sometimes?"', how: "Lumo acknowledged the feeling warmly, did not speculate about the parent, and encouraged Mia to talk to her mum directly. Topic logged and redirected." },
    ],
    ctaText: "Age band 7–9 · 15 min max",
    sidebar: { date: "Yesterday, Jun 5", meta: "15 min · 12 turns", tags: [{ label: "Animals" }, { label: "⚑ 1 flag", cls: "flag" }] },
  },
  {
    real: false, childInitial: "M", useOrbAvatar: false,
    metaLine: "Jun 3, 2026 · 3:00 PM", title: "Mia's session",
    duration: "9m", exchanges: 6, topicCount: 2, flags: 0,
    topics: [
      { label: "Ancient Egypt", count: 4, pct: 60, colorClass: "", exchanges: [
        { q: "Who built the pyramids?", a: "The pyramids were built by ancient Egyptians — thousands of skilled workers. The Great Pyramid took decades to build." },
      ]},
      { label: "Science", count: 2, pct: 40, colorClass: "teal", exchanges: [
        { q: "How do magnets work?", a: "Magnets have invisible fields from moving charges inside atoms. Like poles repel, opposite poles attract!" },
      ]},
    ],
    timeline: [
      { time: "3:00", dot: "sun", label: "Session started", desc: "Age band 7–9 · 15 min maximum" },
      { time: "3:01", dot: "mute", label: "First question", desc: '"Who built the pyramids?"' },
      { time: "3:07", dot: "teal", label: "Topic shift", desc: 'Science — "How do magnets work?"' },
      { time: "3:09", dot: "sun", label: "Session ended", desc: "9 min 12 sec · 0 flags" },
    ],
    safetyEvents: [],
    ctaText: "Age band 7–9 · 15 min max",
    sidebar: { date: "Jun 3", meta: "9 min · 6 turns", tags: [{ label: "History" }, { label: "Science" }] },
  },
  {
    real: false, childInitial: "M", useOrbAvatar: false,
    metaLine: "Jun 1, 2026 · 10:15 AM", title: "Mia's session",
    duration: "13m", exchanges: 10, topicCount: 1, flags: 0,
    topics: [
      { label: "Oceans & sea life", count: 10, pct: 100, colorClass: "teal", exchanges: [
        { q: "How deep is the ocean?", a: "The deepest point is the Mariana Trench — about 11 kilometres down. Mount Everest would still be a mile underwater there." },
        { q: "Do fish sleep?", a: "Yes, though differently to us — most fish rest in a quiet, still state while their brain activity slows down." },
      ]},
    ],
    timeline: [
      { time: "10:15", dot: "sun", label: "Session started", desc: "Age band 7–9 · 15 min maximum" },
      { time: "10:16", dot: "teal", label: "Topic: Oceans", desc: '"How deep is the ocean?"' },
      { time: "10:20", dot: "mute", label: "Continued", desc: '"Do fish sleep?"' },
      { time: "10:28", dot: "sun", label: "Session ended", desc: "13 min 40 sec · 0 flags" },
    ],
    safetyEvents: [],
    ctaText: "Age band 7–9 · 15 min max",
    sidebar: { date: "Jun 1", meta: "13 min · 10 turns", tags: [{ label: "Oceans" }] },
  },
];

// ─────────────────────────── Icons ───────────────────────────

const IC_DURATION = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="13" r="8" stroke="#8a5a15" stroke-width="1.6"/><path d="M12 9v4l2.5 2.5" stroke="#8a5a15" stroke-width="1.6" stroke-linecap="round"/></svg>`;
const IC_EXCH = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M8 12h8M8 8h5M5 5h14a1 1 0 011 1v8a1 1 0 01-1 1H8l-4 4V6a1 1 0 011-1z" stroke="#2a5f5a" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const IC_STAR = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2z" stroke="#8a5a15" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const IC_FLAG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M5 21V4l14 3-14 5" stroke="#993a2c" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const IC_SHIELD = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 3L4 7v6c0 5.25 3.5 9 8 10 4.5-1 8-4.75 8-10V7L12 3z" stroke="#993a2c" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
const IC_STAR_SOFT = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2z" fill="#8a5a15" opacity=".2" stroke="#8a5a15" stroke-width="1.4"/></svg>`;
const IC_CLOCK_TEAL = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="13" r="8" stroke="#2a5f5a" stroke-width="1.6"/><path d="M12 9v4l2.5 2.5" stroke="#2a5f5a" stroke-width="1.6" stroke-linecap="round"/></svg>`;
const IC_CHEVRON = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M19 9l-7 7-7-7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
const IC_PRINT = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M6 9V3h12v6M6 18H4a1 1 0 01-1-1v-6a1 1 0 011-1h16a1 1 0 011 1v6a1 1 0 01-1 1h-2M6 14h12v7H6z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const IC_PLUS = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M12 4v16M4 12h16" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>`;
const IC_HOME = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M3 12L12 3l9 9M5 10v9a1 1 0 001 1h4v-5h4v5h4a1 1 0 001-1v-9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const IC_ARROW = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 8h10m0 0L9 4m4 4L9 12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// ─────────────────────────── Rendering ───────────────────────────

let sessions: ViewSession[] = [];
let activeIndex = 0;
let activeTopic: number | null = null;

export function renderSkeleton(root: HTMLElement): void {
  root.innerHTML = `
    <div style="padding:64px 24px; display:flex; flex-direction:column; align-items:center; gap:16px; color:var(--ink-mute);">
      <div class="skeleton" style="height:64px; width:64px; border-radius:50%;"></div>
      <div class="skeleton" style="height:18px; width:220px;"></div>
      <div class="skeleton" style="height:12px; width:300px;"></div>
      <div style="font-size:13px; margin-top:8px;">Preparing your session summary…</div>
    </div>`;
}

export function renderSummary(data: SessionSummary, root: HTMLElement, childName?: string): void {
  sessions = [toViewSession(data, childName), ...SAMPLE_SESSIONS];
  activeIndex = 0;
  activeTopic = null;

  root.innerHTML = `
    <header class="sum-topbar">
      <div class="sum-topbar-left">
        <span class="sum-topbar-name">Lumo<span>.</span></span>
        <span style="color:var(--ink-mute)">›</span>
        <span class="sum-crumb">Parent space</span>
      </div>
      <div class="sum-topbar-right">
        <button class="btn-sm btn-ink js-new-session" id="new-session-btn">${IC_PLUS} New session</button>
      </div>
    </header>
    <div class="sum-page">
      <aside class="sum-sidebar">
        <p class="sidebar-head">Recent sessions</p>
        <div id="sum-session-list"></div>
        <p class="sidebar-head" style="margin-top:16px;">Quick links</p>
        <button class="sum-quicklink js-new-session" id="sum-start-link">${IC_PLUS} Start session</button>
        <button class="sum-quicklink" id="sum-home-link">${IC_HOME} Home</button>
      </aside>
      <main class="sum-main"><div class="sum-content" id="sum-content"></div></main>
    </div>
  `;

  renderSidebar(root);
  renderContent(root);

  root.querySelector<HTMLButtonElement>("#sum-home-link")?.addEventListener("click", () => {
    window.location.href = "/";
  });
  root.querySelector<HTMLButtonElement>("#sum-start-link")?.addEventListener("click", () => {
    window.location.href = "/";
  });
}

function renderSidebar(root: HTMLElement): void {
  const list = root.querySelector<HTMLElement>("#sum-session-list");
  if (!list) return;
  list.innerHTML = sessions
    .map((s, i) => {
      const tags = s.sidebar.tags
        .map((t) => `<span class="si-tag${t.cls ? " " + t.cls : ""}">${escapeHtml(t.label)}</span>`)
        .join("");
      return `
        <div class="session-item${i === activeIndex ? " active" : ""}" data-idx="${i}" role="button" tabindex="0">
          <span class="session-item-date">${escapeHtml(s.sidebar.date)}</span>
          <span class="session-item-meta">${escapeHtml(s.sidebar.meta)}</span>
          <div class="session-item-tags">${tags}</div>
        </div>`;
    })
    .join("");
  list.querySelectorAll<HTMLElement>(".session-item").forEach((el) => {
    el.addEventListener("click", () => {
      activeIndex = parseInt(el.dataset.idx ?? "0", 10);
      activeTopic = null;
      renderSidebar(root);
      renderContent(root);
    });
  });
}

function renderContent(root: HTMLElement): void {
  const host = root.querySelector<HTMLElement>("#sum-content");
  if (!host) return;
  const s = sessions[activeIndex];
  const flagColor = s.flags > 0 ? "var(--coral)" : "var(--teal)";

  const headerActions = s.real
    ? `<button class="btn-sm btn-outline" id="sum-copy">Copy link</button>
       <button class="btn-sm btn-outline" id="sum-download">Download JSON ↓</button>
       <button class="btn-sm btn-outline" id="sum-export">${IC_PRINT} Export</button>`
    : `<button class="btn-sm btn-outline" id="sum-export">${IC_PRINT} Export</button>`;

  host.innerHTML = `
    <div class="session-header">
      <div class="session-header-top">
        <div class="session-child">
          <div class="child-avatar${s.useOrbAvatar ? " orb" : ""}">${s.useOrbAvatar ? "" : escapeHtml(s.childInitial)}</div>
          <div>
            <p class="eyebrow">${escapeHtml(s.metaLine)}</p>
            <h1 class="session-h1">${escapeHtml(s.title)}</h1>
          </div>
        </div>
        <div class="header-actions">${headerActions}</div>
      </div>
    </div>

    <div class="stats-row">
      <div class="stat-card">
        <div class="stat-icon" style="background:var(--sun-soft);">${IC_DURATION}</div>
        <div class="stat-val">${escapeHtml(s.duration)}</div>
        <p class="stat-label">Duration</p>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:#D9EDEB;">${IC_EXCH}</div>
        <div class="stat-val">${s.exchanges}</div>
        <p class="stat-label">Exchanges</p>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:var(--sun-soft);">${IC_STAR}</div>
        <div class="stat-val">${s.topicCount}</div>
        <p class="stat-label">Topics</p>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:#FADAD5;">${IC_FLAG}</div>
        <div class="stat-val" style="color:${flagColor};">${s.flags}</div>
        <p class="stat-label">Flags</p>
      </div>
    </div>

    <div class="section-card open" data-section="topics">
      <div class="section-head js-section-toggle">
        <div class="section-head-left">
          <div class="section-icon" style="background:var(--sun-soft);">${IC_STAR_SOFT}</div>
          <div>
            <div class="section-head-title">Topics covered</div>
            <div class="section-head-meta">${s.topicCount} topic${s.topicCount === 1 ? "" : "s"} · click to explore exchanges</div>
          </div>
        </div>
        <div class="section-chevron">${IC_CHEVRON}</div>
      </div>
      <div class="section-body"><div class="section-body-inner">
        ${s.topics.length
          ? `<div class="topic-chips" id="sum-topic-chips"></div>
             <div class="topic-detail" id="sum-topic-detail"></div>
             <p class="eyebrow" style="margin:16px 0 10px;">Share of conversation</p>
             <div class="bar-chart" id="sum-bar-chart"></div>`
          : `<p style="font-size:13px; color:var(--ink-mute);">No distinct topics surfaced in this session.</p>`}
      </div></div>
    </div>

    <div class="section-card open" data-section="timeline">
      <div class="section-head js-section-toggle">
        <div class="section-head-left">
          <div class="section-icon" style="background:#D9EDEB;">${IC_CLOCK_TEAL}</div>
          <div>
            <div class="section-head-title">Session timeline</div>
            <div class="section-head-meta">How the conversation unfolded</div>
          </div>
        </div>
        <div class="section-chevron">${IC_CHEVRON}</div>
      </div>
      <div class="section-body"><div class="section-body-inner">
        <div class="sum-timeline">
          ${s.timeline.map((t) => `
            <div class="tl-item">
              <div class="tl-time">${escapeHtml(t.time)}</div>
              <div class="tl-spine"><div class="tl-dot ${t.dot}"></div><div class="tl-line"></div></div>
              <div class="tl-content">
                <div class="tl-label">${escapeHtml(t.label)}</div>
                <div class="tl-desc">${escapeHtml(t.desc)}</div>
              </div>
            </div>`).join("")}
        </div>
      </div></div>
    </div>

    <div class="section-card open" data-section="safety">
      <div class="section-head js-section-toggle">
        <div class="section-head-left">
          <div class="section-icon" style="background:#FADAD5;">${IC_SHIELD}</div>
          <div>
            <div class="section-head-title">Safety events</div>
            <div class="section-head-meta">${s.flags} flagged moment${s.flags === 1 ? "" : "s"}</div>
          </div>
        </div>
        <div class="section-chevron">${IC_CHEVRON}</div>
      </div>
      <div class="section-body"><div class="section-body-inner">${renderSafety(s)}</div></div>
    </div>

    <div class="summary-cta">
      <div class="cta-text">
        <h3>Start another session</h3>
        <p>${escapeHtml(s.ctaText)}</p>
      </div>
      <div class="cta-actions">
        <button class="btn-sm btn-ink js-new-session">Start session ${IC_ARROW}</button>
      </div>
    </div>
  `;

  // Section collapse/expand.
  host.querySelectorAll<HTMLElement>(".js-section-toggle").forEach((head) => {
    head.addEventListener("click", () => head.closest(".section-card")?.classList.toggle("open"));
  });

  if (s.topics.length) {
    renderTopics(host, s);
    requestAnimationFrame(() => {
      host.querySelectorAll<HTMLElement>(".bar-fill").forEach((el) => {
        el.style.width = (el.dataset.pct ?? "0") + "%";
      });
    });
  }

  // Header actions (real session only).
  if (s.real && s.raw) {
    host.querySelector<HTMLButtonElement>("#sum-download")?.addEventListener("click", () => downloadSummary(s.raw!));
    const copyBtn = host.querySelector<HTMLButtonElement>("#sum-copy");
    if (copyBtn) {
      copyBtn.onclick = async () => {
        const url = `${window.location.origin}/summary/${s.raw!.session_id}`;
        try {
          await navigator.clipboard.writeText(url);
          const orig = copyBtn.textContent;
          copyBtn.textContent = "Copied ✓";
          setTimeout(() => { copyBtn.textContent = orig ?? "Copy link"; }, 2000);
        } catch {
          prompt("Copy this link:", url);
        }
      };
    }
  }
  host.querySelector<HTMLButtonElement>("#sum-export")?.addEventListener("click", () => window.print());

  // Re-bind new-session buttons that were just (re)rendered into the content.
  host.querySelectorAll<HTMLElement>(".js-new-session").forEach((el) => {
    el.addEventListener("click", () => { window.location.href = "/"; });
  });
}

function renderTopics(host: HTMLElement, s: ViewSession): void {
  const chips = host.querySelector<HTMLElement>("#sum-topic-chips");
  const bar = host.querySelector<HTMLElement>("#sum-bar-chart");
  const detail = host.querySelector<HTMLElement>("#sum-topic-detail");
  if (!chips || !bar || !detail) return;

  chips.innerHTML = s.topics
    .map((t, i) => `<button class="topic-chip" data-i="${i}">${escapeHtml(t.label)} <span class="chip-count">×${t.count}</span></button>`)
    .join("");
  bar.innerHTML = s.topics
    .map((t) => `
      <div class="bar-row">
        <span class="bar-label">${escapeHtml(t.label)}</span>
        <div class="bar-track"><div class="bar-fill ${t.colorClass}" data-pct="${t.pct}"></div></div>
        <span class="bar-pct">${t.pct}%</span>
      </div>`)
    .join("");

  chips.querySelectorAll<HTMLElement>(".topic-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const i = parseInt(chip.dataset.i ?? "0", 10);
      if (activeTopic === i) {
        activeTopic = null;
        chips.querySelectorAll(".topic-chip").forEach((c) => c.classList.remove("active"));
        detail.classList.remove("show");
        detail.innerHTML = "";
        return;
      }
      activeTopic = i;
      chips.querySelectorAll(".topic-chip").forEach((c, ci) => c.classList.toggle("active", ci === i));
      const t = s.topics[i];
      detail.innerHTML = `<p class="topic-detail-head">${escapeHtml(t.label)}</p>` +
        t.exchanges.map((ex) => `
          <div class="topic-exchange">
            <div class="te-q">${escapeHtml(ex.q)}</div>
            <div class="te-a">${escapeHtml(ex.a)}</div>
          </div>`).join("");
      detail.classList.add("show");
    });
  });
}

function renderSafety(s: ViewSession): string {
  if (!s.safetyEvents.length) {
    return `
      <div class="no-flags">
        <div class="no-flags-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 3L4 7v6c0 5.25 3.5 9 8 10 4.5-1 8-4.75 8-10V7L12 3z" stroke="#2a5f5a" stroke-width="1.5" stroke-linejoin="round"/><path d="M9 12l2 2 4-4" stroke="#2a5f5a" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
        <p class="no-flags-text">No flags raised</p>
        <p class="no-flags-sub">All topics in this session were handled within normal guardrails.</p>
      </div>`;
  }
  return s.safetyEvents
    .map((ev) => `
      <div class="flag-item">
        <div class="flag-head">
          <span class="flag-label">${IC_FLAG} ${escapeHtml(ev.label)}</span>
          <span class="flag-time">${escapeHtml(ev.time)}</span>
        </div>
        <div class="flag-q">${escapeHtml(ev.q)}</div>
        <div class="flag-how">How it was handled: ${escapeHtml(ev.how)}</div>
      </div>`)
    .join("");
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
