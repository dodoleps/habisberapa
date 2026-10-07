/**
 * Habis Berapa — server di Cloudflare Workers (menggantikan Google Apps Script).
 *
 * Tugasnya:
 *  - POST /login     tukar ID token Google dengan sesi aplikasi (30 hari). Terbuka untuk semua akun Google.
 *  - POST /parse     ubah suara/teks menjadi transaksi lewat Gemini. TIDAK menyimpan data keuangan.
 *  - POST /feedback  simpan masukan pengguna.
 *  - POST /stats     statistik pemakaian + masukan (khusus pemilik, OWNER_EMAIL).
 *
 * Pengaturan di dasbor Cloudflare (Worker → Settings):
 *  - Variables:  GOOGLE_CLIENT_ID, OWNER_EMAIL, ALLOWED_ORIGINS (dipisah koma), GEMINI_MODELS (opsional)
 *  - Secret:     GEMINI_API_KEY
 *  - Binding D1: nama variabel DB
 * Panduan: PANDUAN-CLOUDFLARE.md
 */

const SESSION_DAYS = 30;
const UTAMA_ID = 'utama';
const KATEGORI_PINDAH = 'Pindah dana';
const DEFAULT_MODELS = 'gemini-3.1-flash-lite,gemini-3.6-flash,gemini-3.8-flash';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/';
const THINK_LEVELS = ['minimal', 'low', 'none'];
const DEFAULT_CATS = [
  ['Makan & Minum', 'keluar'], ['Transportasi', 'keluar'], ['Belanja', 'keluar'], ['Tagihan', 'keluar'],
  ['Kesehatan', 'keluar'], ['Hiburan', 'keluar'], ['Keluarga', 'keluar'], ['Lainnya', 'keluar'],
  ['Gaji', 'masuk'], ['Bonus', 'masuk'], ['Lainnya', 'masuk'],
].map(([nama, jenis]) => ({ nama, jenis }));

// Diingat selama Worker hidup (bukan data pengguna): model yang terakhir berhasil & level "thinking" per model.
const memo = { modelOk: '', think: {} };

class HttpError extends Error {
  constructor(message, code, status) { super(message); this.code = code || 'error'; this.status = status || 400; }
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const url = new URL(request.url);
    // "lokasi" = kode pusat data Cloudflare yang menjalankan Worker (mis. IAD = Amerika), untuk memastikan Placement bekerja.
    if (request.method === 'GET' && url.pathname === '/') {
      return json({ ok: true, data: 'habisberapa worker aktif', lokasi: request.cf && request.cf.colo || '' }, cors);
    }
    try {
      if (request.method !== 'POST') throw new HttpError('Metode tidak didukung', 'error', 405);
      const req = await request.json().catch(() => { throw new HttpError('Permintaan tidak valid'); });
      await ensureSchema(env);
      let data;
      switch (url.pathname) {
        case '/login': data = await login(req, env); break;
        case '/parse': data = await parse(req, env, await auth(req, env)); break;
        case '/feedback': data = await feedback(req, env, await auth(req, env)); break;
        case '/stats': data = await stats(env, await auth(req, env)); break;
        case '/me': { const u = await auth(req, env); data = { email: u.email, owner: u.owner }; break; }
        default: throw new HttpError('Alamat tidak dikenal', 'error', 404);
      }
      return json({ ok: true, data }, cors);
    } catch (err) {
      const e = err instanceof HttpError ? err : new HttpError(String(err && err.message || err), 'error', 500);
      return json({ ok: false, error: e.message, code: e.code }, cors, e.status === 500 ? 500 : 200);
    }
  },
};

function json(obj, headers, status) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: { ...headers, 'Content-Type': 'application/json' } });
}

function corsHeaders(request, env) {
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const origin = request.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : (allowed[0] || '*'),
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

// ---------- Database (D1) ----------

let schemaReady = false;
async function ensureSchema(env) {
  if (schemaReady) return;
  if (!env.DB) throw new HttpError('Database D1 belum disambungkan (binding "DB").', 'config', 500);
  await env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS config (k TEXT PRIMARY KEY, v TEXT)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS users (user TEXT PRIMARY KEY, first_day TEXT, last_day TEXT)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS usage (day TEXT, user TEXT, parses INTEGER, PRIMARY KEY (day, user))'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, email TEXT, text TEXT)'),
  ]);
  schemaReady = true;
}

async function secret(env) {
  const row = await env.DB.prepare("SELECT v FROM config WHERE k = 'session_secret'").first();
  if (row) return row.v;
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const v = btoa(String.fromCharCode(...bytes));
  await env.DB.prepare("INSERT OR IGNORE INTO config (k, v) VALUES ('session_secret', ?)").bind(v).run();
  return (await env.DB.prepare("SELECT v FROM config WHERE k = 'session_secret'").first()).v;
}

// ---------- Login & sesi ----------

function b64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function hmac(key, text) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(text)));
}
async function sha(text) {
  return b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))).slice(0, 22);
}
function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
}

async function login(req, env) {
  if (!env.GOOGLE_CLIENT_ID) throw new HttpError('GOOGLE_CLIENT_ID belum diatur di Worker.', 'config');
  const res = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(req.idToken || ''));
  if (!res.ok) throw new HttpError('Login Google tidak valid. Coba masuk lagi.', 'auth');
  const c = await res.json();
  const issOk = c.iss === 'https://accounts.google.com' || c.iss === 'accounts.google.com';
  if (c.aud !== env.GOOGLE_CLIENT_ID || !issOk || Number(c.exp) * 1000 < Date.now() || !req.nonce || c.nonce !== req.nonce) {
    throw new HttpError('Login Google tidak valid. Coba masuk lagi.', 'auth');
  }
  if (String(c.email_verified) !== 'true') throw new HttpError('Email Google belum terverifikasi.', 'auth');
  const email = String(c.email).toLowerCase();
  const exp = Date.now() + SESSION_DAYS * 86400000;
  const payload = email + '|' + exp;
  const user = await sha(email);
  await env.DB.prepare('INSERT INTO users (user, first_day, last_day) VALUES (?, ?, ?) ON CONFLICT(user) DO UPDATE SET last_day = excluded.last_day')
    .bind(user, today(), today()).run();
  return { token: payload + '|' + await hmac(await secret(env), payload), email, nama: c.name || '', owner: isOwner(email, env) };
}

function isOwner(email, env) {
  return !!env.OWNER_EMAIL && email === String(env.OWNER_EMAIL).trim().toLowerCase();
}

async function auth(req, env) {
  const parts = String(req.token || '').split('|');
  if (parts.length !== 3) throw new HttpError('Silakan masuk dengan akun Google.', 'auth');
  const payload = parts[0] + '|' + parts[1];
  if (await hmac(await secret(env), payload) !== parts[2] || Number(parts[1]) < Date.now()) {
    throw new HttpError('Sesi login sudah berakhir. Silakan masuk lagi.', 'auth');
  }
  return { email: parts[0], owner: isOwner(parts[0], env) };
}

// ---------- AI ----------

async function parse(req, env, u) {
  if (!env.GEMINI_API_KEY) throw new HttpError('GEMINI_API_KEY belum diatur di Worker.', 'config');
  const str = (v, max) => String(v == null ? '' : v).slice(0, max);
  const wallets = (Array.isArray(req.wallets) ? req.wallets : []).slice(0, 50)
    .map((w) => ({ id: str(w.id, 40), nama: str(w.nama, 60) })).filter((w) => w.nama);
  if (!wallets.some((w) => w.id === UTAMA_ID)) wallets.unshift({ id: UTAMA_ID, nama: 'Utama' });
  let cats = (Array.isArray(req.categories) ? req.categories : []).slice(0, 80)
    .map((c) => ({ nama: str(c.nama, 60), jenis: c.jenis })).filter((c) => c.nama && (c.jenis === 'masuk' || c.jenis === 'keluar'));
  if (!cats.length) cats = DEFAULT_CATS;

  const parts = [{ text: buildPrompt(wallets, cats, !!req.audio) }];
  if (req.audio) {
    if (String(req.audio).length > 8000000) throw new HttpError('Rekaman terlalu panjang');
    parts.push({ inlineData: { mimeType: str(req.mime, 40) || 'audio/wav', data: req.audio } });
  } else {
    const text = str(req.text, 1000).trim();
    if (!text) throw new HttpError('Teks kosong');
    parts.push({ text: 'Ucapan pengguna: "' + text + '"' });
  }
  const lane = Number(req.lane) || 0;
  const t0 = Date.now();
  const ai = await callGemini(parts, lane, env);
  await env.DB.prepare('INSERT INTO usage (day, user, parses) VALUES (?, ?, 1) ON CONFLICT(day, user) DO UPDATE SET parses = parses + 1')
    .bind(today(), await sha(u.email)).run();
  return {
    transkrip: req.audio ? String(ai.result.transkrip || '') : str(req.text, 1000),
    transaksi: Array.isArray(ai.result.transaksi) ? ai.result.transaksi : [],
    timing: { model: ai.model, ai_ms: Date.now() - t0, attempts: ai.log.length, log: ai.log, lane },
  };
}

function buildPrompt(wallets, cats, isAudio) {
  const now = new Date();
  const hari = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', weekday: 'long' }).format(now);
  const utama = (wallets.find((w) => w.id === UTAMA_ID) || { nama: 'Utama' }).nama;
  const list = (j) => cats.filter((c) => c.jenis === j).map((c) => '"' + c.nama + '"').join(', ');
  return [
    'Kamu adalah asisten pencatat keuangan pribadi berbahasa Indonesia.',
    'Hari ini ' + hari + ', ' + today() + '.',
    isAudio ? 'Dengarkan rekaman suara terlampir, tulis apa yang diucapkan di "transkrip", lalu ubah menjadi daftar transaksi.'
      : 'Ubah ucapan pengguna di bawah menjadi daftar transaksi.',
    '',
    'Daftar dompet: ' + wallets.map((w) => '"' + w.nama + '"').join(', ') + '. Dompet utama: "' + utama + '".',
    'Kategori pengeluaran (keluar): ' + list('keluar') + '.',
    'Kategori pemasukan (masuk): ' + list('masuk') + '.',
    '',
    'Aturan:',
    '- Satu ucapan bisa berisi beberapa transaksi; buat satu item untuk masing-masing.',
    '- nominal dalam rupiah, bilangan bulat. Contoh: "25 ribu"/"25rb"/"25k" = 25000, "1,5 juta"/"1.5jt" = 1500000,',
    '  "gopek" = 500, "seceng" = 1000, "goceng" = 5000, "ceban" = 10000, "gocap" = 50000, "cepek" = 100000.',
    '- jenis: "keluar" untuk pengeluaran, "masuk" untuk pemasukan (gaji, bonus, dikasih, dibayar, terima),',
    '  "pindah" untuk memindahkan/mengisi/menyisihkan/menabung uang dari satu dompet ke dompet lain.',
    '- Untuk "pindah": dompet = asal (jika tidak disebut, pakai dompet utama), dompet_tujuan = tujuan, kategori = "' + KATEGORI_PINDAH + '".',
    '- dompet dan dompet_tujuan HARUS persis salah satu nama dari daftar dompet (pilih yang paling mirip dengan yang diucapkan).',
    '- Jika pengguna menyebut sumber dompet (mis. "ambil dari dompet uang makan", "pakai uang bensin"),',
    '  pakai dompet itu untuk semua pengeluaran dalam kalimat tersebut.',
    '- Jika dompet tidak disebut: pemasukan masuk ke dompet utama; pengeluaran diambil dari dompet yang namanya',
    '  paling sesuai dengan keperluannya (mis. makan -> dompet berisi kata "makan", bensin -> dompet berisi kata "bensin");',
    '  jika tidak ada yang sesuai, pakai dompet utama.',
    '- kategori HARUS persis salah satu dari daftar sesuai jenisnya; jika ragu pakai "Lainnya".',
    '- tanggal format YYYY-MM-DD. Default hari ini; pahami "kemarin", "tadi pagi", "hari Senin", dll.',
    '- keterangan singkat dan jelas, huruf awal kapital (mis. "Makan siang bakso", "Parkir").',
    '- dompet_tujuan diisi string kosong jika jenis bukan "pindah".',
    '- Jika tidak ada transaksi yang bisa dikenali, kembalikan transaksi kosong.',
  ].join('\n');
}

const AI_SCHEMA = {
  type: 'OBJECT',
  properties: {
    transkrip: { type: 'STRING' },
    transaksi: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          jenis: { type: 'STRING', enum: ['keluar', 'masuk', 'pindah'] },
          nominal: { type: 'INTEGER' },
          kategori: { type: 'STRING' },
          dompet: { type: 'STRING' },
          dompet_tujuan: { type: 'STRING' },
          keterangan: { type: 'STRING' },
          tanggal: { type: 'STRING' },
        },
        required: ['jenis', 'nominal', 'kategori', 'dompet', 'dompet_tujuan', 'keterangan', 'tanggal'],
      },
    },
  },
  required: ['transkrip', 'transaksi'],
};

/** Satu permintaan ke satu model; kalau level "thinking" ditolak, turun ke level berikutnya. */
async function geminiRequest(model, parts, env, log) {
  let idx = Math.max(0, THINK_LEVELS.indexOf(memo.think[model] || THINK_LEVELS[0]));
  for (;;) {
    const level = THINK_LEVELS[idx];
    const cfg = { responseMimeType: 'application/json', responseSchema: AI_SCHEMA, temperature: 0 };
    if (level !== 'none') cfg.thinkingConfig = { thinkingLevel: level };
    const t0 = Date.now();
    const res = await fetch(GEMINI_BASE + 'models/' + model + ':generateContent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: cfg }),
    });
    const out = { status: res.status, text: await res.text(), ms: Date.now() - t0 };
    log.push({ m: model, s: out.status, ms: out.ms, t: level });
    if (out.status === 400 && level !== 'none' && /think/i.test(out.text)) {
      idx++;
      memo.think[model] = THINK_LEVELS[idx];
      continue;
    }
    return out;
  }
}

function parseGemini(text) {
  const out = JSON.parse(text);
  const cand = out.candidates && out.candidates[0];
  const answer = cand && cand.content && cand.content.parts && cand.content.parts.map((p) => p.text || '').join('');
  if (!answer) throw new HttpError('AI tidak memberi jawaban. Coba ulangi.');
  return JSON.parse(answer);
}
function geminiMessage(text) {
  try { return JSON.parse(text).error.message.slice(0, 200); } catch (e) { return String(text || '').slice(0, 200); }
}

async function callGemini(parts, lane, env) {
  const models = String(env.GEMINI_MODELS || DEFAULT_MODELS).split(',').map((s) => s.trim()).filter(Boolean);
  // Jalur cadangan (lane 1) mulai dari model kedua, supaya tidak antre di model yang sama.
  const base = lane === 1 ? models.slice(1).concat(models.slice(0, 1)) : [memo.modelOk].concat(models);
  const order = base.filter((m, i) => m && base.indexOf(m) === i);
  const log = [];
  let last = null;
  for (const model of order) {
    for (let k = 0; k < 2; k++) {
      last = await geminiRequest(model, parts, env, log);
      if (last.status === 200) {
        if (lane === 0) memo.modelOk = model;
        return { result: parseGemini(last.text), model, log };
      }
      if (last.status < 500 || last.ms > 5000) break;   // sibuk tapi lama menolak -> langsung model lain
      if (k === 0) await new Promise((r) => setTimeout(r, 800));
    }
    // Gemini menolak lokasi pusat data ini; model lain juga akan ditolak, jadi langsung berhenti.
    if (last.status === 400 && /location is not supported/i.test(last.text)) break;
    if (!(last.status === 404 || last.status === 429 || last.status >= 500)) break;
  }
  const st = last ? last.status : 0;
  if (st === 429) throw new HttpError('Kuota AI gratis sedang habis. Coba lagi nanti atau isi lewat formulir.');
  if (st === 400 && /location is not supported/i.test(last.text)) {
    throw new HttpError('AI sedang tidak bisa dihubungi dari lokasi server saat ini. Coba lagi sebentar lagi, atau catat lewat formulir.');
  }
  if (st >= 500) throw new HttpError('Server AI Google sedang sibuk. Tunggu sebentar lalu coba lagi.');
  throw new HttpError('Gagal menghubungi AI (' + st + '): ' + geminiMessage(last && last.text));
}

// ---------- Masukan & statistik ----------

async function feedback(req, env, u) {
  const text = String(req.text || '').trim().slice(0, 2000);
  if (!text) throw new HttpError('Masukan masih kosong');
  await env.DB.prepare('INSERT INTO feedback (ts, email, text) VALUES (?, ?, ?)').bind(new Date().toISOString(), u.email, text).run();
  return 'ok';
}

async function stats(env, u) {
  if (!u.owner) throw new HttpError('Hanya pemilik aplikasi yang bisa melihat statistik.', 'forbidden');
  const since = new Date(Date.now() - 13 * 86400000);
  const sinceDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(since);
  const days = await env.DB.prepare('SELECT day, COUNT(*) AS aktif, SUM(parses) AS catatan FROM usage WHERE day >= ? GROUP BY day ORDER BY day')
    .bind(sinceDay).all();
  const total = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first();
  const baru = await env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE first_day >= ?').bind(sinceDay).first();
  const fb = await env.DB.prepare('SELECT ts, email, text FROM feedback ORDER BY id DESC LIMIT 50').all();
  return { hari: days.results, totalPengguna: total.n, penggunaBaru14: baru.n, masukan: fb.results };
}
