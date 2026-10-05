/* MODE DEMO: meniru server Apps Script, data disimpan di browser ini saja (localStorage). */
(function (root) {
  const KEY = 'hb_demo_db';
  const L = root.HBLogic;
  const DEFAULT_CATS = [
    ['Makan & Minum', 'keluar'], ['Transportasi', 'keluar'], ['Belanja', 'keluar'], ['Tagihan', 'keluar'],
    ['Kesehatan', 'keluar'], ['Hiburan', 'keluar'], ['Keluarga', 'keluar'], ['Lainnya', 'keluar'],
    ['Gaji', 'masuk'], ['Bonus', 'masuk'], ['Lainnya', 'masuk'],
  ].map(([nama, jenis]) => ({ nama, jenis }));

  function now() { return new Date().toISOString().slice(0, 19); }
  function today() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function newId() { return Math.random().toString(36).slice(2, 14); }

  function load() {
    let db = null;
    try { db = JSON.parse(localStorage.getItem(KEY)); } catch (e) { /* data rusak -> mulai baru */ }
    if (!db) {
      db = { wallets: [{ id: L.UTAMA_ID, nama: 'Utama', urutan: '0', arsip: '', dibuat: now() }],
        categories: DEFAULT_CATS.slice(), transactions: [] };
    }
    return db;
  }
  function save(db) { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* abaikan */ } }

  function clean(tx) {
    const t = { ...tx, nominal: Math.round(Number(tx.nominal)) };
    if (!(t.nominal > 0)) throw new Error('Nominal harus lebih dari 0');
    if (t.jenis === 'pindah') {
      t.kategori = 'Pindah dana';
      if (!t.dompet_tujuan_id || t.dompet_tujuan_id === t.dompet_id) throw new Error('Dompet asal dan tujuan harus berbeda');
    } else t.dompet_tujuan_id = '';
    t.tanggal = t.tanggal || today();
    return t;
  }

  function add(db, txs) {
    const stamp = now();
    txs.forEach((t) => { t.id = newId(); t.dibuat = stamp; db.transactions.push(t); });
    return txs;
  }

  const actions = {
    ping: () => 'ok',
    state: (db) => db,
    ai: (db, req) => {
      if (req.audio) throw new Error('Mode demo belum bisa memproses suara. Coba fitur ketik, atau sambungkan ke server.');
      const txs = L.parseDemo(req.text, db.wallets, db.categories, today())
        .map((t) => clean({ ...t, sumber: 'ketik', transkrip: req.text }));
      return { transkrip: req.text, saved: add(db, txs) };
    },
    addTx: (db, req) => add(db, [clean({ ...req.tx, sumber: 'manual' })])[0],
    addTxs: (db, req) => add(db, req.txs.map((t) => clean({ ...t, sumber: 'manual' }))),
    updateTx: (db, req) => {
      const i = db.transactions.findIndex((t) => t.id === req.tx.id);
      if (i < 0) throw new Error('Transaksi tidak ditemukan');
      db.transactions[i] = { ...db.transactions[i], ...clean(req.tx) };
      return db.transactions[i];
    },
    deleteTx: (db, req) => { db.transactions = db.transactions.filter((t) => t.id !== req.id); return req.id; },
    addWallet: (db, req) => {
      const nama = String(req.nama || '').trim();
      if (!nama) throw new Error('Nama dompet kosong');
      if (db.wallets.some((w) => !w.arsip && w.nama.toLowerCase() === nama.toLowerCase())) throw new Error('Dompet "' + nama + '" sudah ada');
      const w = { id: newId(), nama, urutan: String(db.wallets.length), arsip: '', dibuat: now() };
      db.wallets.push(w);
      return w;
    },
    renameWallet: (db, req) => { db.wallets.find((w) => w.id === req.id).nama = req.nama.trim(); return req.id; },
    deleteWallet: (db, req) => {
      if (req.id === L.UTAMA_ID) throw new Error('Dompet Utama tidak bisa dihapus');
      db.wallets.find((w) => w.id === req.id).arsip = '1';
      return req.id;
    },
    addCategory: (db, req) => {
      const nama = String(req.nama || '').trim();
      if (!nama) throw new Error('Nama kategori kosong');
      if (db.categories.some((c) => c.jenis === req.jenis && c.nama.toLowerCase() === nama.toLowerCase())) throw new Error('Kategori sudah ada');
      db.categories.push({ nama, jenis: req.jenis });
      return { nama, jenis: req.jenis };
    },
    renameCategory: (db, req) => {
      const c = db.categories.find((x) => x.nama === req.lama && x.jenis === req.jenis);
      c.nama = req.baru.trim();
      db.transactions.forEach((t) => { if (t.kategori === req.lama && t.jenis === req.jenis) t.kategori = c.nama; });
      return c.nama;
    },
    deleteCategory: (db, req) => {
      db.categories = db.categories.filter((c) => !(c.nama === req.nama && c.jenis === req.jenis));
      return req.nama;
    },
  };

  root.HBMock = {
    call(action, req) {
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          try {
            const db = load();
            const fn = actions[action];
            if (!fn) throw new Error('Aksi tidak dikenal: ' + action);
            const data = fn(db, req || {});
            save(db);
            resolve(JSON.parse(JSON.stringify(data)));
          } catch (e) { reject(e); }
        }, 150);
      });
    },
    reset() { localStorage.removeItem(KEY); },
  };
})(this);
