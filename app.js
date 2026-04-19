// Red-String Theory — corkboard conspiracy generator
// Flow: 5 inputs -> LLM call via ef-ai-proxy (decoder-shape JSON) -> corkboard render

const AI_ENDPOINT = 'https://uy3l6suz07.execute-api.us-east-1.amazonaws.com/ai';
const SLUG = 'red-string-theory';

const THREAT_BUCKETS = ['mauve', 'eggshell', 'brimstone', 'static', 'vinegar', 'crimson'];

const FALLBACK_TITLES = [
  "The Oat Milk Corvid Accord",
  "Operation: Ambient Coincidence",
  "The Lukewarm Tuesday Protocol",
  "The Linden Street Handoff",
  "Project: Soft Serve Mirror",
  "The Unmarked Envelope Hypothesis",
  "The Thermostat Cabal",
  "The Adjacent Footnote Incident",
  "The Fourth-Floor Courier Theorem",
  "The Borrowed Umbrella Doctrine",
  "The Pigeon Caucus Memorandum",
  "The Signal Laundry Affair"
];

const FALLBACK_LABELS = [
  "knows too much", "cover story", "timing off by 4min", "second occurrence",
  "financial trail", "recurring motif", "back channel", "wavelength match",
  "pigeon vector", "paperwork mismatch", "shared contact", "unofficial handoff"
];

/* ------------ seeded PRNG + hash ------------ */
function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}
function mulberry32(seed) {
  return function() {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = seed;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/* ------------ base64url ------------ */
function b64urlEncode(str) {
  const utf8 = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < utf8.length; i++) binary += String.fromCharCode(utf8[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s) {
  try {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    const binary = atob(s);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch (_) { return null; }
}

/* ------------ state elements ------------ */
const elInput = document.getElementById('input-screen');
const elLoading = document.getElementById('loading-screen');
const elResult = document.getElementById('result-screen');
const formEl = document.getElementById('input-form');
const errorEl = document.getElementById('form-error');
const titleEl = document.getElementById('theory-title');
const threatValEl = document.getElementById('threat-value');
const cardsLayer = document.getElementById('cards-layer');
const stringSvg = document.getElementById('string-svg');
const boardStage = document.getElementById('board-stage');
const resetBtn = document.getElementById('reset-btn');

let currentState = null; // { inputs, seed, payload }

function showScreen(name) {
  for (const el of [elInput, elLoading, elResult]) el.classList.add('hidden');
  ({ input: elInput, loading: elLoading, result: elResult })[name].classList.remove('hidden');
}

/* ------------ LLM call ------------ */
async function callLLM(inputs) {
  const system = [
    "You are a paranoid 1970s conspiracy theorist writing notes to yourself on a corkboard.",
    "Your voice: clipped, jittery, underlining half-truths, convinced everything connects.",
    "You are given 5 mundane things someone did this week. You MUST link them into a single grand-unified theory.",
    "Rules:",
    "1. Output STRICT JSON only — no prose outside JSON, no preamble, no follow-up questions, no 'here is your result'.",
    "2. Quote each of the 5 inputs VERBATIM inside that input's evidence annotation (the exact characters the user typed, in the same sentence).",
    "3. 'theory_title': Title Case, up to 60 chars, sounds like a classified operation or accord.",
    "4. 'threat_level': single lowercase word. Prefer one of: mauve, eggshell, brimstone, static, vinegar, crimson. If a 7th bucket genuinely fits better, you may invent one (single word, under 12 chars).",
    "5. 'evidence': exactly 5 items, one per input_index (0..4). Each annotation is ONE paranoid sentence, under 160 chars, and must echo the user's input text verbatim.",
    "6. 'connections': exactly 4 items. Each has 'a' and 'b' as distinct integers in 0..4 and a 'label' of max 20 chars — cryptic like 'pigeon vector', 'knows too much', 'timing off by 4min'. No two connections may share the same unordered pair.",
    "Return only this JSON shape:",
    '{"theory_title":"string","threat_level":"string","evidence":[{"input_index":0,"annotation":"string"}],"connections":[{"a":0,"b":1,"label":"string"}]}'
  ].join(' ');

  const userBody = inputs.map((t, i) => `${i}: ${t}`).join('\n');

  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: `The five mundane things this week:\n${userBody}\n\nLink them. Return JSON only.` }
  ];

  const res = await fetch(AI_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      slug: SLUG,
      messages,
      max_tokens: 500,
      temperature: 0.3,
      response_format: 'json_object'
    })
  });

  if (!res.ok) throw new Error('http_' + res.status);
  const data = await res.json();
  const parsed = JSON.parse(data.content);
  return normalizePayload(parsed, inputs);
}

function normalizePayload(raw, inputs) {
  const out = {
    theory_title: typeof raw?.theory_title === 'string' ? raw.theory_title.slice(0, 72).trim() : null,
    threat_level: typeof raw?.threat_level === 'string' ? raw.threat_level.toLowerCase().replace(/[^a-z]/g, '').slice(0, 14) : null,
    evidence: [],
    connections: []
  };
  if (!out.theory_title) throw new Error('bad_title');
  if (!out.threat_level) throw new Error('bad_threat');

  // Evidence must have 5 items, one per input index 0..4
  const evMap = new Map();
  if (Array.isArray(raw?.evidence)) {
    for (const e of raw.evidence) {
      const idx = Number(e?.input_index);
      if (Number.isInteger(idx) && idx >= 0 && idx <= 4 && typeof e.annotation === 'string') {
        if (!evMap.has(idx)) evMap.set(idx, e.annotation.slice(0, 220).trim());
      }
    }
  }
  for (let i = 0; i < 5; i++) {
    const ann = evMap.get(i) || `surveillance note — ${inputs[i]} — notable.`;
    out.evidence.push({ input_index: i, annotation: ann });
  }

  // Connections: exactly 4 unique unordered pairs within 0..4
  const seen = new Set();
  if (Array.isArray(raw?.connections)) {
    for (const c of raw.connections) {
      const a = Number(c?.a), b = Number(c?.b);
      if (!Number.isInteger(a) || !Number.isInteger(b)) continue;
      if (a < 0 || a > 4 || b < 0 || b > 4 || a === b) continue;
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      if (seen.has(key)) continue;
      const label = typeof c.label === 'string' ? c.label.slice(0, 24).trim() : 'link';
      out.connections.push({ a: Math.min(a,b), b: Math.max(a,b), label: label || 'link' });
      seen.add(key);
      if (out.connections.length === 4) break;
    }
  }
  // backfill if fewer than 4
  const pairs = [[0,1],[1,2],[2,3],[3,4],[0,4],[0,2],[1,3]];
  let pi = 0;
  while (out.connections.length < 4 && pi < pairs.length) {
    const [a, b] = pairs[pi++];
    const key = `${a}-${b}`;
    if (!seen.has(key)) {
      out.connections.push({ a, b, label: 'suspicious coincidence' });
      seen.add(key);
    }
  }
  return out;
}

/* ------------ deterministic local fallback ------------ */
function localFallback(inputs, seed) {
  const rnd = mulberry32(seed || hash(inputs.join('|')));
  const title = FALLBACK_TITLES[Math.floor(rnd() * FALLBACK_TITLES.length)];
  const threat = THREAT_BUCKETS[Math.floor(rnd() * THREAT_BUCKETS.length)];

  const textureLines = [
    (t) => `they want you to think "${t}" means nothing. it means everything.`,
    (t) => `"${t}" — same week as the others. NOT random.`,
    (t) => `"${t}" surfaces twice in the file. twice.`,
    (t) => `write this down: "${t}". witnessed. corroborated.`,
    (t) => `"${t}" appears in the margin notes. check the margins.`,
    (t) => `log entry: "${t}". timestamp withheld on purpose.`,
    (t) => `"${t}" — this is the wedge. this is how they get in.`
  ];

  const evidence = inputs.map((txt, i) => {
    const line = textureLines[(seed + i) % textureLines.length];
    return { input_index: i, annotation: line(txt) };
  });

  // pick 4 unique pairs deterministically
  const allPairs = [];
  for (let a = 0; a < 5; a++) for (let b = a + 1; b < 5; b++) allPairs.push([a, b]);
  // fisher-yates seeded
  for (let i = allPairs.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [allPairs[i], allPairs[j]] = [allPairs[j], allPairs[i]];
  }
  const connections = allPairs.slice(0, 4).map(([a, b]) => ({
    a, b,
    label: FALLBACK_LABELS[Math.floor(rnd() * FALLBACK_LABELS.length)]
  }));

  return { theory_title: title, threat_level: threat, evidence, connections };
}

/* ------------ rendering ------------ */
function renderBoard(inputs, payload, seed) {
  titleEl.textContent = (payload.theory_title || 'Untitled Theory').toUpperCase();
  threatValEl.textContent = (payload.threat_level || 'mauve').toUpperCase();

  // layout: 5 cards arranged in a pentagon around the stage
  const rnd = mulberry32(seed);
  const stage = boardStage.getBoundingClientRect();
  // we'll use percentage positions so the layout scales with the stage
  // Rough pentagon positions — these are card CENTERS as % of stage.
  // Keep x in [22, 78] and y in [18, 82] so cards don't clip.
  const basePositions = [
    { x: 50, y: 18 }, // top
    { x: 78, y: 42 }, // upper right
    { x: 68, y: 78 }, // lower right
    { x: 32, y: 78 }, // lower left
    { x: 22, y: 42 }  // upper left
  ];

  // jitter positions slightly for hand-made feel
  const positions = basePositions.map(p => ({
    x: Math.max(22, Math.min(78, p.x + (rnd() - 0.5) * 4)),
    y: Math.max(18, Math.min(82, p.y + (rnd() - 0.5) * 4))
  }));

  // Clear old
  cardsLayer.innerHTML = '';
  stringSvg.innerHTML = '';

  // SVG viewBox = percentages (0..100)
  stringSvg.setAttribute('viewBox', '0 0 100 100');

  // Draw strings first (so cards sit on top)
  const svgNS = 'http://www.w3.org/2000/svg';
  // subtle shadow offset group
  for (const conn of payload.connections) {
    const p1 = positions[conn.a];
    const p2 = positions[conn.b];
    if (!p1 || !p2) continue;
    // string line
    const line = document.createElementNS(svgNS, 'line');
    line.setAttribute('x1', p1.x);
    line.setAttribute('y1', p1.y);
    line.setAttribute('x2', p2.x);
    line.setAttribute('y2', p2.y);
    line.setAttribute('stroke', '#b5281d');
    line.setAttribute('stroke-width', '0.55');
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('opacity', '0.92');
    line.setAttribute('filter', 'drop-shadow(0 0.3px 0.3px rgba(0,0,0,0.5))');
    stringSvg.appendChild(line);

    // midpoint label
    const midX = (p1.x + p2.x) / 2;
    const midY = (p1.y + p2.y) / 2;
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    let angle = Math.atan2(dy, dx) * 180 / Math.PI;
    if (angle > 90) angle -= 180;
    if (angle < -90) angle += 180;

    const label = (conn.label || 'link').slice(0, 22);
    const charW = 1.5; // approx char width in viewbox units at font-size 2.4
    const w = Math.max(10, Math.min(40, label.length * charW + 4));
    const h = 4.2;

    const g = document.createElementNS(svgNS, 'g');
    g.setAttribute('transform', `translate(${midX} ${midY}) rotate(${angle})`);

    const rect = document.createElementNS(svgNS, 'rect');
    rect.setAttribute('x', (-w / 2).toString());
    rect.setAttribute('y', (-h / 2).toString());
    rect.setAttribute('width', w.toString());
    rect.setAttribute('height', h.toString());
    rect.setAttribute('fill', '#f1e7c6');
    rect.setAttribute('stroke', '#1d140a');
    rect.setAttribute('stroke-width', '0.2');
    rect.setAttribute('rx', '0.4');
    rect.setAttribute('opacity', '0.96');
    g.appendChild(rect);

    const txt = document.createElementNS(svgNS, 'text');
    txt.setAttribute('x', '0');
    txt.setAttribute('y', '0.3');
    txt.setAttribute('text-anchor', 'middle');
    txt.setAttribute('dominant-baseline', 'middle');
    txt.setAttribute('font-family', '"Special Elite", monospace');
    txt.setAttribute('font-size', '2.4');
    txt.setAttribute('fill', '#1d140a');
    txt.textContent = label;
    g.appendChild(txt);

    stringSvg.appendChild(g);
  }

  // Cards — use translate(-50%, -50%) so percent coords mark card centers
  for (let i = 0; i < 5; i++) {
    const div = document.createElement('div');
    div.className = 'card';
    const rot = (rnd() * 12 - 6).toFixed(2);
    const pos = positions[i];
    div.style.left = `${pos.x}%`;
    div.style.top = `${pos.y}%`;
    div.style.transform = `translate(-50%, -50%) rotate(${rot}deg)`;

    const head = document.createElement('div');
    head.className = 'card-head';
    head.textContent = `CASE #${i + 1}`;
    div.appendChild(head);

    const inp = document.createElement('div');
    inp.className = 'card-input';
    inp.textContent = inputs[i];
    div.appendChild(inp);

    const annot = document.createElement('div');
    annot.className = 'card-annot';
    const ev = payload.evidence.find(e => e.input_index === i);
    annot.textContent = ev ? ev.annotation : '';
    div.appendChild(annot);

    cardsLayer.appendChild(div);
  }
}

/* ------------ cache by input hash ------------ */
function cacheKey(inputs) {
  return 'rst_' + hash(inputs.join('\u0001'));
}
function readCache(inputs) {
  try {
    const raw = localStorage.getItem(cacheKey(inputs));
    return raw ? JSON.parse(raw) : null;
  } catch (_) { return null; }
}
function writeCache(inputs, payload) {
  try { localStorage.setItem(cacheKey(inputs), JSON.stringify(payload)); } catch (_) {}
}

/* ------------ main flow ------------ */
async function runTheory(inputs, seed) {
  currentState = { inputs, seed, payload: null };

  showScreen('loading');
  const startedAt = Date.now();

  let payload = readCache(inputs);
  if (!payload) {
    try {
      payload = await callLLM(inputs);
      writeCache(inputs, payload);
    } catch (err) {
      payload = localFallback(inputs, seed);
    }
  }

  // minimum loading time ~900ms for dramatic effect
  const elapsed = Date.now() - startedAt;
  if (elapsed < 900) await new Promise(r => setTimeout(r, 900 - elapsed));

  currentState.payload = payload;
  showScreen('result');
  // render after layout so getBoundingClientRect works
  requestAnimationFrame(() => renderBoard(inputs, payload, seed));
}

/* ------------ URL fragment share ------------ */
function encodeState(inputs, seed) {
  const json = JSON.stringify({ v: 1, i: inputs, s: seed });
  return 's=' + b64urlEncode(json);
}
function decodeStateFromHash() {
  const frag = location.hash.replace(/^#/, '');
  if (!frag.startsWith('s=')) return null;
  const raw = b64urlDecode(frag.slice(2));
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw);
    if (obj && Array.isArray(obj.i) && obj.i.length === 5 && typeof obj.s === 'number') {
      return { inputs: obj.i.map(x => String(x).slice(0, 200)), seed: obj.s | 0 };
    }
  } catch (_) {}
  return null;
}

function share() {
  if (!currentState) return;
  const frag = '#' + encodeState(currentState.inputs, currentState.seed);
  history.replaceState(null, '', frag);
  const shareUrl = location.origin + location.pathname + frag;

  const shareData = {
    title: 'Red-String Theory',
    text: `${(currentState.payload?.theory_title || 'A theory') } — threat level ${(currentState.payload?.threat_level || 'mauve').toUpperCase()}`,
    url: shareUrl
  };

  if (navigator.share) {
    navigator.share(shareData).catch(() => {
      try { navigator.clipboard.writeText(shareUrl); alert('Link copied.'); } catch (_) {}
    });
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(shareUrl).then(() => {
      alert('Link copied — paste it anywhere.');
    }).catch(() => {
      prompt('Copy this link:', shareUrl);
    });
  } else {
    prompt('Copy this link:', shareUrl);
  }
}
window.share = share;

/* ------------ event wiring ------------ */
formEl.addEventListener('submit', (e) => {
  e.preventDefault();
  const fields = Array.from(formEl.querySelectorAll('.field-input'));
  const values = fields.map(f => f.value.trim());
  if (values.some(v => v.length === 0)) {
    errorEl.textContent = 'hmm — the corkboard needs all 5 exhibits. fill them in.';
    return;
  }
  if (values.some(v => v.length > 120)) {
    errorEl.textContent = 'keep each one short — under 120 characters, please.';
    return;
  }
  errorEl.textContent = '';
  const seed = (hash(values.join('\u0001')) + Math.floor(Date.now() / 1) ) | 0;
  // Actually — for deterministic reproduction on shared URL, the seed should come from inputs alone
  const deterministicSeed = hash(values.join('\u0001'));
  runTheory(values, deterministicSeed);
});

resetBtn.addEventListener('click', () => {
  if (location.hash) history.replaceState(null, '', location.pathname);
  currentState = null;
  for (const f of formEl.querySelectorAll('.field-input')) f.value = '';
  errorEl.textContent = '';
  showScreen('input');
});

// Re-render on resize so card positions stay sensible
window.addEventListener('resize', () => {
  if (currentState && currentState.payload) {
    renderBoard(currentState.inputs, currentState.payload, currentState.seed);
  }
});

/* ------------ boot ------------ */
(function boot() {
  const shared = decodeStateFromHash();
  if (shared) {
    // pre-fill inputs (so reset takes them to the form with those items) and run
    const fields = Array.from(formEl.querySelectorAll('.field-input'));
    shared.inputs.forEach((v, i) => { if (fields[i]) fields[i].value = v; });
    runTheory(shared.inputs, shared.seed);
  } else {
    showScreen('input');
  }
})();
