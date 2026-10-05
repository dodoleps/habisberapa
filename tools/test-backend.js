// Uji Code.gs di komputer dengan tiruan SpreadsheetApp / UrlFetchApp (tanpa Google sungguhan).
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const sheets = {};
function makeSheet(name) {
  const rows = [];
  return sheets[name] = { rows,
    appendRow: (r) => rows.push(r.map(String)), getLastRow: () => rows.length, setFrozenRows() {},
    getRange(a, b, c, d) {
      if (typeof a === 'string') return { setNumberFormat() {} };
      const r0 = a - 1, c0 = b - 1, nr = c || 1, nc = d || 1;
      return {
        setNumberFormat() {},
        getDisplayValues: () => rows.slice(r0, r0 + nr).map((r) => Array.from({ length: nc }, (_, j) => r[c0 + j] ?? '')),
        setValues: (vals) => vals.forEach((v, i) => { rows[r0 + i] = rows[r0 + i] || []; v.forEach((x, j) => { rows[r0 + i][c0 + j] = String(x); }); }),
        setValue: (v) => { rows[r0][c0] = String(v); },
      };
    },
    deleteRow: (i) => rows.splice(i - 1, 1),
  };
}
let geminiReply = null, geminiCalls = [];
const ctx = {
  SpreadsheetApp: { getActive: () => ({ getSheetByName: (n) => sheets[n] || null, insertSheet: makeSheet }) },
  CacheService: { getScriptCache: () => ({ get: () => null, put() {} }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ setMimeType: () => JSON.parse(s) }) },
  Utilities: { formatDate: (d, tz, f) => f === 'u' ? '7' : f === 'yyyy-MM-dd' ? '2026-10-04' : '2026-10-04T10:00:00',
    getUuid: () => Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2) },
  UrlFetchApp: { fetch: (url, opt) => { geminiCalls.push({ url, body: JSON.parse(opt.payload) }); return geminiReply(url); } },
  Logger: { log() {} },
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(__dirname + '/../apps-script/Code.gs', 'utf8').replace("ISI_KUNCI_GEMINI_DI_SINI", 'test-key'), ctx);
const call = (o) => ctx.doPost({ postData: { contents: JSON.stringify({ pin: '123456', ...o }) } });

assert.strictEqual(call({ action: 'ping', pin: '0000' }).code, 'pin');
let st = call({ action: 'state' }).data;
assert.strictEqual(st.wallets[0].nama, 'Utama');
assert.strictEqual(st.categories.length, 11);
const makan = call({ action: 'addWallet', nama: 'Uang Makan' }).data;
assert.strictEqual(call({ action: 'addWallet', nama: 'uang makan' }).ok, false);

// AI: model pertama 404 -> pakai cadangan
geminiReply = (url) => url.includes('3.5') ? { getResponseCode: () => 404, getContentText: () => 'not found' } : {
  getResponseCode: () => 200,
  getContentText: () => JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ transkrip: 'makan 25 ribu parkir 2 ribu dari uang makan', transaksi: [
    { jenis: 'keluar', nominal: 25000, kategori: 'makan & minum', dompet: 'Uang Makan', dompet_tujuan: '', keterangan: 'Makan', tanggal: '2026-10-04' },
    { jenis: 'keluar', nominal: 2000, kategori: 'Ngawur', dompet: 'Tidak Ada', dompet_tujuan: '', keterangan: 'Parkir', tanggal: 'kemarin' },
    { jenis: 'keluar', nominal: 0, kategori: 'Lainnya', dompet: 'Utama', dompet_tujuan: '', keterangan: 'nol', tanggal: '2026-10-04' },
    { jenis: 'pindah', nominal: 100000, kategori: 'x', dompet: 'Utama', dompet_tujuan: 'uang makan', keterangan: 'Isi', tanggal: '2026-10-04' },
  ] }) }] } }] }),
};
const ai = call({ action: 'ai', audio: 'AAAA', mime: 'audio/wav' });
assert.ok(ai.ok, ai.error);
assert.strictEqual(geminiCalls.length, 2);
assert.ok(geminiCalls[0].body.contents[0].parts[0].text.includes('"Uang Makan"'));
const saved = ai.data.saved;
assert.strictEqual(saved.length, 3, 'nominal 0 dibuang');
assert.strictEqual(saved[0].kategori, 'Makan & Minum');
assert.strictEqual(saved[0].dompet_id, makan.id);
assert.strictEqual(saved[1].kategori, 'Lainnya');
assert.strictEqual(saved[1].dompet_id, 'utama');
assert.strictEqual(saved[1].tanggal, '2026-10-04');
assert.strictEqual(saved[2].jenis, 'pindah');
assert.strictEqual(saved[2].dompet_tujuan_id, makan.id);
assert.strictEqual(saved[2].kategori, 'Pindah dana');

// Edit, hapus, kategori
const t = { ...saved[0], nominal: 30000 };
assert.ok(call({ action: 'updateTx', tx: t }).ok);
st = call({ action: 'state' }).data;
assert.strictEqual(st.transactions.find((x) => x.id === t.id).nominal, 30000);
assert.strictEqual(st.transactions.find((x) => x.id === t.id).sumber, 'suara');
assert.ok(call({ action: 'renameCategory', lama: 'Makan & Minum', baru: 'Makan', jenis: 'keluar' }).ok);
st = call({ action: 'state' }).data;
assert.strictEqual(st.transactions.find((x) => x.id === t.id).kategori, 'Makan');
assert.ok(call({ action: 'deleteTx', id: saved[1].id }).ok);
assert.strictEqual(call({ action: 'state' }).data.transactions.length, 2);
assert.strictEqual(call({ action: 'deleteWallet', id: 'utama' }).ok, false);
assert.ok(call({ action: 'deleteWallet', id: makan.id }).ok);
assert.strictEqual(call({ action: 'addTx', tx: { jenis: 'pindah', nominal: 5, dompet_id: 'utama', dompet_tujuan_id: 'utama' } }).ok, false);

// Kuota habis
geminiReply = () => ({ getResponseCode: () => 429, getContentText: () => 'quota' });
const q = call({ action: 'ai', text: 'kopi 10rb' });
assert.ok(/Kuota/.test(q.error), q.error);
console.log('Semua uji server LULUS');
