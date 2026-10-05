/**
 * habisberapa — server kecil di Google Apps Script.
 *
 * Tugasnya:
 *  1. Menyimpan & membaca data di Google Sheets ini (lembar Transaksi, Dompet, Kategori).
 *  2. Mengirim rekaman suara / teks ke Gemini lalu menyimpan transaksi hasilnya.
 *  3. Memeriksa PIN di setiap permintaan.
 *
 * Cara pasang: lihat PANDUAN-PASANG.md di folder projek.
 */

// ============ KONFIGURASI — isi bagian ini ============
const PIN = '123456';                 // ganti dengan PIN pilihan Anda (angka)
const GEMINI_API_KEY = 'ISI_KUNCI_GEMINI_DI_SINI';
// Model dicoba berurutan; kalau yang pertama gagal/penuh, pakai berikutnya.
const GEMINI_MODELS = ['gemini-3.5-flash', 'gemini-2.5-flash'];
const ZONA_WAKTU = 'Asia/Jakarta';
// =======================================================

const SHEET_TX = 'Transaksi';
const SHEET_WALLET = 'Dompet';
const SHEET_CAT = 'Kategori';
const TX_COLS = ['id', 'tanggal', 'jenis', 'nominal', 'kategori', 'dompet_id', 'dompet_tujuan_id',
  'keterangan', 'sumber', 'transkrip', 'dibuat'];
const WALLET_COLS = ['id', 'nama', 'urutan', 'arsip', 'dibuat'];
const CAT_COLS = ['nama', 'jenis'];
const UTAMA_ID = 'utama';
const KATEGORI_PINDAH = 'Pindah dana';

const DEFAULT_CATS = [
  ['Makan & Minum', 'keluar'], ['Transportasi', 'keluar'], ['Belanja', 'keluar'],
  ['Tagihan', 'keluar'], ['Kesehatan', 'keluar'], ['Hiburan', 'keluar'],
  ['Keluarga', 'keluar'], ['Lainnya', 'keluar'],
  ['Gaji', 'masuk'], ['Bonus', 'masuk'], ['Lainnya', 'masuk'],
];

// ---------- Pintu masuk web ----------

function doGet() {
  return json_({ ok: true, data: 'habisberapa server aktif' });
}

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents || '{}');
    checkPin_(req.pin);
    ensureSetup_();
    const handler = ACTIONS[req.action];
    if (!handler) throw new Error('Aksi tidak dikenal: ' + req.action);
    return json_({ ok: true, data: handler(req) });
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err), code: err.code || 'error' });
  }
}

const ACTIONS = {
  ping: () => 'ok',
  state: () => getState_(),
  ai: (req) => withLock_(() => processAi_(req)),
  addTx: (req) => withLock_(() => addTxs_([cleanTx_(req.tx)])[0]),
  addTxs: (req) => withLock_(() => addTxs_(req.txs.map(cleanTx_))),
  updateTx: (req) => withLock_(() => updateTx_(cleanTx_(req.tx))),
  deleteTx: (req) => withLock_(() => deleteTx_(req.id)),
  addWallet: (req) => withLock_(() => addWallet_(req.nama)),
  renameWallet: (req) => withLock_(() => renameWallet_(req.id, req.nama)),
  deleteWallet: (req) => withLock_(() => archiveWallet_(req.id)),
  addCategory: (req) => withLock_(() => addCategory_(req.nama, req.jenis)),
  renameCategory: (req) => withLock_(() => renameCategory_(req.lama, req.baru, req.jenis)),
  deleteCategory: (req) => withLock_(() => deleteCategory_(req.nama, req.jenis)),
};

// ---------- Keamanan ----------

function checkPin_(pin) {
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get('pin_fails') || 0);
  if (fails >= 10) throw codeErr_('Terlalu banyak PIN salah. Coba lagi 10 menit lagi.', 'locked');
  if (String(pin) !== String(PIN)) {
    cache.put('pin_fails', String(fails + 1), 600);
    throw codeErr_('PIN salah', 'pin');
  }
}

function codeErr_(msg, code) {
  const e = new Error(msg);
  e.code = code;
  return e;
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ---------- Penyiapan lembar ----------

/** Bisa dijalankan manual sekali dari editor Apps Script untuk membuat lembar. */
function setup() {
  ensureSetup_();
  Logger.log('Lembar siap.');
}

function ensureSetup_() {
  const ss = SpreadsheetApp.getActive();
  if (!ss.getSheetByName(SHEET_TX)) {
    const sh = ss.insertSheet(SHEET_TX);
    sh.appendRow(TX_COLS);
    sh.getRange('A:K').setNumberFormat('@');
    sh.setFrozenRows(1);
  }
  if (!ss.getSheetByName(SHEET_WALLET)) {
    const sh = ss.insertSheet(SHEET_WALLET);
    sh.appendRow(WALLET_COLS);
    sh.getRange('A:E').setNumberFormat('@');
    sh.appendRow([UTAMA_ID, 'Utama', '0', '', now_()]);
    sh.setFrozenRows(1);
  }
  if (!ss.getSheetByName(SHEET_CAT)) {
    const sh = ss.insertSheet(SHEET_CAT);
    sh.appendRow(CAT_COLS);
    sh.getRange(2, 1, DEFAULT_CATS.length, 2).setValues(DEFAULT_CATS);
    sh.setFrozenRows(1);
  }
}

function sheet_(name) {
  return SpreadsheetApp.getActive().getSheetByName(name);
}

function readRows_(name, cols) {
  const sh = sheet_(name);
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, cols.length).getDisplayValues().map((r, i) => {
    const o = { _row: i + 2 };
    cols.forEach((c, j) => { o[c] = r[j]; });
    return o;
  });
}

function strip_(o) {
  const c = Object.assign({}, o);
  delete c._row;
  return c;
}

function now_() {
  return Utilities.formatDate(new Date(), ZONA_WAKTU, "yyyy-MM-dd'T'HH:mm:ss");
}

function today_() {
  return Utilities.formatDate(new Date(), ZONA_WAKTU, 'yyyy-MM-dd');
}

function newId_() {
  return Utilities.getUuid().replace(/-/g, '').slice(0, 12);
}

// ---------- Data ----------

function getState_() {
  return {
    wallets: readRows_(SHEET_WALLET, WALLET_COLS).map(strip_),
    categories: readRows_(SHEET_CAT, CAT_COLS).map(strip_),
    transactions: readRows_(SHEET_TX, TX_COLS).map((t) => {
      const o = strip_(t);
      o.nominal = Number(o.nominal) || 0;
      return o;
    }),
  };
}

function cleanTx_(tx) {
  const jenis = ['keluar', 'masuk', 'pindah'].indexOf(tx.jenis) >= 0 ? tx.jenis : 'keluar';
  const nominal = Math.round(Number(tx.nominal));
  if (!(nominal > 0)) throw new Error('Nominal harus lebih dari 0');
  const tanggal = /^\d{4}-\d{2}-\d{2}$/.test(tx.tanggal || '') ? tx.tanggal : today_();
  const out = {
    id: tx.id || '',
    tanggal: tanggal,
    jenis: jenis,
    nominal: nominal,
    kategori: jenis === 'pindah' ? KATEGORI_PINDAH : String(tx.kategori || 'Lainnya'),
    dompet_id: String(tx.dompet_id || UTAMA_ID),
    dompet_tujuan_id: jenis === 'pindah' ? String(tx.dompet_tujuan_id || '') : '',
    keterangan: String(tx.keterangan || '').slice(0, 200),
    sumber: String(tx.sumber || 'manual'),
    transkrip: String(tx.transkrip || '').slice(0, 1000),
  };
  if (jenis === 'pindah' && (!out.dompet_tujuan_id || out.dompet_tujuan_id === out.dompet_id)) {
    throw new Error('Dompet asal dan tujuan harus berbeda');
  }
  return out;
}

function txRow_(t) {
  return TX_COLS.map((c) => (c === 'nominal' ? String(t[c]) : t[c] || ''));
}

function addTxs_(txs) {
  if (!txs.length) return [];
  const stamp = now_();
  const rows = txs.map((t) => {
    t.id = newId_();
    t.dibuat = stamp;
    return txRow_(t);
  });
  const sh = sheet_(SHEET_TX);
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, TX_COLS.length).setValues(rows);
  return txs;
}

function findTx_(id) {
  const t = readRows_(SHEET_TX, TX_COLS).find((r) => r.id === id);
  if (!t) throw new Error('Transaksi tidak ditemukan');
  return t;
}

function updateTx_(tx) {
  const old = findTx_(tx.id);
  tx.dibuat = old.dibuat;
  tx.sumber = old.sumber;
  tx.transkrip = old.transkrip;
  sheet_(SHEET_TX).getRange(old._row, 1, 1, TX_COLS.length).setValues([txRow_(tx)]);
  return tx;
}

function deleteTx_(id) {
  sheet_(SHEET_TX).deleteRow(findTx_(id)._row);
  return id;
}

function addWallet_(nama) {
  nama = String(nama || '').trim();
  if (!nama) throw new Error('Nama dompet kosong');
  const all = readRows_(SHEET_WALLET, WALLET_COLS);
  if (all.some((w) => !w.arsip && w.nama.toLowerCase() === nama.toLowerCase())) {
    throw new Error('Dompet "' + nama + '" sudah ada');
  }
  const w = { id: newId_(), nama: nama, urutan: String(all.length), arsip: '', dibuat: now_() };
  sheet_(SHEET_WALLET).appendRow(WALLET_COLS.map((c) => w[c]));
  return w;
}

function renameWallet_(id, nama) {
  nama = String(nama || '').trim();
  if (!nama) throw new Error('Nama dompet kosong');
  const w = readRows_(SHEET_WALLET, WALLET_COLS).find((r) => r.id === id);
  if (!w) throw new Error('Dompet tidak ditemukan');
  sheet_(SHEET_WALLET).getRange(w._row, 2).setValue(nama);
  return id;
}

/** Dompet tidak benar-benar dihapus supaya riwayat transaksi lama tetap terbaca. */
function archiveWallet_(id) {
  if (id === UTAMA_ID) throw new Error('Dompet Utama tidak bisa dihapus');
  const w = readRows_(SHEET_WALLET, WALLET_COLS).find((r) => r.id === id);
  if (!w) throw new Error('Dompet tidak ditemukan');
  sheet_(SHEET_WALLET).getRange(w._row, 4).setValue('1');
  return id;
}

function addCategory_(nama, jenis) {
  nama = String(nama || '').trim();
  if (!nama) throw new Error('Nama kategori kosong');
  if (jenis !== 'masuk' && jenis !== 'keluar') throw new Error('Jenis kategori tidak valid');
  const all = readRows_(SHEET_CAT, CAT_COLS);
  if (all.some((c) => c.jenis === jenis && c.nama.toLowerCase() === nama.toLowerCase())) {
    throw new Error('Kategori sudah ada');
  }
  sheet_(SHEET_CAT).appendRow([nama, jenis]);
  return { nama: nama, jenis: jenis };
}

function renameCategory_(lama, baru, jenis) {
  baru = String(baru || '').trim();
  if (!baru) throw new Error('Nama kategori kosong');
  const c = readRows_(SHEET_CAT, CAT_COLS).find((r) => r.nama === lama && r.jenis === jenis);
  if (!c) throw new Error('Kategori tidak ditemukan');
  sheet_(SHEET_CAT).getRange(c._row, 1).setValue(baru);
  // Ikut ganti nama kategori di transaksi lama.
  const sh = sheet_(SHEET_TX);
  readRows_(SHEET_TX, TX_COLS).forEach((t) => {
    if (t.kategori === lama && t.jenis === jenis) sh.getRange(t._row, 5).setValue(baru);
  });
  return baru;
}

function deleteCategory_(nama, jenis) {
  const c = readRows_(SHEET_CAT, CAT_COLS).find((r) => r.nama === nama && r.jenis === jenis);
  if (!c) throw new Error('Kategori tidak ditemukan');
  sheet_(SHEET_CAT).deleteRow(c._row);
  return nama;
}

// ---------- AI (Gemini) ----------

function processAi_(req) {
  const wallets = readRows_(SHEET_WALLET, WALLET_COLS).filter((w) => !w.arsip);
  const cats = readRows_(SHEET_CAT, CAT_COLS);
  const parts = [{ text: buildPrompt_(wallets, cats, !!req.audio) }];
  if (req.audio) {
    parts.push({ inlineData: { mimeType: req.mime || 'audio/wav', data: req.audio } });
  } else {
    const text = String(req.text || '').trim();
    if (!text) throw new Error('Teks kosong');
    parts.push({ text: 'Ucapan pengguna: "' + text + '"' });
  }

  const result = callGemini_(parts);
  const transkrip = req.audio ? String(result.transkrip || '') : String(req.text);
  const txs = (result.transaksi || []).map((t) => {
    try {
      return cleanTx_(mapAiTx_(t, wallets, cats, transkrip, req.audio ? 'suara' : 'ketik'));
    } catch (err) {
      return null;
    }
  }).filter(Boolean);

  return { transkrip: transkrip, saved: addTxs_(txs) };
}

function mapAiTx_(t, wallets, cats, transkrip, sumber) {
  const findWallet = (nama) => {
    const n = String(nama || '').trim().toLowerCase();
    const w = wallets.find((x) => x.nama.toLowerCase() === n);
    return w ? w.id : '';
  };
  const jenis = t.jenis;
  let kategori = String(t.kategori || '');
  if (jenis !== 'pindah') {
    const match = cats.find((c) => c.jenis === jenis && c.nama.toLowerCase() === kategori.toLowerCase());
    kategori = match ? match.nama : 'Lainnya';
  }
  return {
    tanggal: t.tanggal,
    jenis: jenis,
    nominal: t.nominal,
    kategori: kategori,
    dompet_id: findWallet(t.dompet) || UTAMA_ID,
    dompet_tujuan_id: jenis === 'pindah' ? findWallet(t.dompet_tujuan) : '',
    keterangan: t.keterangan,
    sumber: sumber,
    transkrip: transkrip,
  };
}

function buildPrompt_(wallets, cats, isAudio) {
  const today = new Date();
  const hari = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'][
    Number(Utilities.formatDate(today, ZONA_WAKTU, 'u')) % 7];
  const utama = (wallets.find((w) => w.id === UTAMA_ID) || { nama: 'Utama' }).nama;
  const list = (j) => cats.filter((c) => c.jenis === j).map((c) => '"' + c.nama + '"').join(', ');
  return [
    'Kamu adalah asisten pencatat keuangan pribadi berbahasa Indonesia.',
    'Hari ini ' + hari + ', ' + today_() + '.',
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

function callGemini_(parts) {
  if (!GEMINI_API_KEY || GEMINI_API_KEY.indexOf('ISI_') === 0) {
    throw new Error('Kunci Gemini belum diisi di Code.gs');
  }
  const body = {
    contents: [{ role: 'user', parts: parts }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: AI_SCHEMA, temperature: 0 },
  };
  let lastErr = '';
  for (let i = 0; i < GEMINI_MODELS.length; i++) {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_MODELS[i] + ':generateContent';
    const res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-goog-api-key': GEMINI_API_KEY },
      payload: JSON.stringify(body),
      muteHttpExceptions: true,
    });
    const status = res.getResponseCode();
    if (status === 200) {
      const out = JSON.parse(res.getContentText());
      const text = out.candidates && out.candidates[0] && out.candidates[0].content &&
        out.candidates[0].content.parts.map((p) => p.text || '').join('');
      if (!text) throw new Error('AI tidak memberi jawaban. Coba ulangi.');
      return JSON.parse(text);
    }
    lastErr = status + ' ' + res.getContentText().slice(0, 300);
    // 404 = model tidak ada, 429 = kuota, 5xx = server sibuk -> coba model berikutnya.
    if (status !== 404 && status !== 429 && status < 500) break;
  }
  if (lastErr.indexOf('429') === 0) throw new Error('Kuota AI gratis hari ini habis. Coba lagi nanti atau ketik manual.');
  throw new Error('Gagal menghubungi AI: ' + lastErr);
}
