// Server tiruan: menjalankan Code.gs di komputer dengan tiruan SpreadsheetApp / UrlFetchApp (tanpa Google sungguhan).
const fs = require('fs'), vm = require('vm');
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
let geminiReply = () => ({ getResponseCode: () => 503, getContentText: () => 'AI tidak tersedia di server lokal' }), geminiCalls = [];
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
module.exports = (body) => ctx.doPost({ postData: { contents: body } });
