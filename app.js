/* habisberapa — tampilan & interaksi aplikasi. */
(function () {
  const L = window.HBLogic;
  const API_URL = (window.HB_CONFIG && window.HB_CONFIG.API_URL || '').trim();
  const DEMO = !API_URL;
  const PIN_KEY = 'hb_pin';
  const MAX_REC_SEC = 60;

  const S = { wallets: [], categories: [], transactions: [], newIds: new Set(), transkrip: '',
    tab: 'home', reportMonth: thisMonth(), filter: { q: '', month: thisMonth(), wallet: '', cat: '' } };

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rp = (n) => (n < 0 ? '-' : '') + 'Rp' + Math.abs(Math.round(n)).toLocaleString('id-ID');
  const digits = (s) => Number(String(s).replace(/\D/g, '')) || 0;

  function thisMonth() { return todayStr().slice(0, 7); }
  function todayStr() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function fmtMonth(ym) {
    const [y, m] = ym.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
  }
  function fmtDay(ymd) {
    const [y, m, d] = ymd.split('-').map(Number);
    if (ymd === todayStr()) return 'Hari ini';
    const kemarin = new Date(); kemarin.setDate(kemarin.getDate() - 1);
    const dt = new Date(y, m - 1, d);
    if (dt.toDateString() === kemarin.toDateString()) return 'Kemarin';
    return dt.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });
  }
  function shiftMonth(ym, delta) {
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  // ---------- Komunikasi dengan server ----------

  async function api(action, req) {
    if (DEMO) return window.HBMock.call(action, req);
    let res;
    try {
      res = await fetch(API_URL, {
        method: 'POST',
        // text/plain supaya tidak memicu pemeriksaan CORS tambahan dari Apps Script
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action, pin: localStorage.getItem(PIN_KEY) || '', ...(req || {}) }),
      });
    } catch (e) {
      throw new Error('Tidak bisa terhubung. Periksa koneksi internet.');
    }
    let body;
    try { body = await res.json(); } catch (e) { throw new Error('Jawaban server tidak terbaca (' + res.status + ').'); }
    if (!body.ok) {
      const err = new Error(body.error || 'Terjadi kesalahan');
      err.code = body.code;
      if (body.code === 'pin' && action !== 'ping') lock('PIN berubah atau salah. Masukkan lagi.');
      throw err;
    }
    return body.data;
  }

  async function refresh(silent) {
    try {
      const st = await api('state');
      S.wallets = st.wallets;
      S.categories = st.categories;
      S.transactions = st.transactions;
      render();
    } catch (e) {
      if (!silent) toast(e.message);
    }
  }

  // ---------- Toast ----------

  let toastTimer;
  function toast(msg, ms) {
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, ms || 3000);
  }

  // ---------- Data turunan ----------

  const activeWallets = () => S.wallets.filter((w) => !w.arsip)
    .sort((a, b) => (a.id === L.UTAMA_ID ? -1 : b.id === L.UTAMA_ID ? 1 : Number(a.urutan) - Number(b.urutan)));
  const walletName = (id) => (S.wallets.find((w) => w.id === id) || { nama: '(dompet terhapus)' }).nama;
  const catsOf = (jenis) => S.categories.filter((c) => c.jenis === jenis);
  const ICON = { 'Makan & Minum': '🍜', Transportasi: '🛵', Belanja: '🛍️', Tagihan: '🧾', Kesehatan: '💊',
    Hiburan: '🎬', Keluarga: '👨‍👩‍👧', Gaji: '💼', Bonus: '🎁', 'Pindah dana': '🔁' };

  function computed() { return L.computeWallets(S.wallets, S.transactions); }

  // ---------- Render ----------

  function render() {
    const cw = computed();
    const aktif = cw.filter((w) => !w.arsip);
    $('total-saldo').textContent = rp(aktif.reduce((s, w) => s + w.saldo, 0));
    renderHome(cw);
    if (S.tab === 'history') renderHistory();
    if (S.tab === 'report') renderReport();
    if (S.tab === 'settings') renderSettings(cw);
  }

  function statsHtml(sum) {
    return '<div class="stat"><div class="stat-label">Masuk</div><div class="stat-value c-in">' + rp(sum.masuk) + '</div></div>' +
      '<div class="stat"><div class="stat-label">Keluar</div><div class="stat-value c-out">' + rp(sum.keluar) + '</div></div>' +
      '<div class="stat"><div class="stat-label">Selisih</div><div class="stat-value">' + rp(sum.selisih) + '</div></div>';
  }

  function renderHome(cw) {
    $('home-summary').innerHTML = statsHtml(L.monthSummary(S.transactions, thisMonth()));
    const byId = Object.fromEntries(cw.map((w) => [w.id, w]));
    $('wallet-grid').innerHTML = activeWallets().map((w0) => {
      const w = byId[w0.id];
      const note = { menipis: 'Hampir habis', habis: w.saldo < 0 ? 'Minus!' : 'Habis', kosong: 'Belum diisi', aman: '' }[w.status];
      return '<button class="wallet" data-status="' + w.status + '" data-wallet="' + esc(w.id) + '">' +
        '<div class="wallet-name">' + esc(w.nama) + '</div>' +
        '<div class="wallet-saldo">' + rp(w.saldo) + '</div>' +
        '<div class="bar"><i style="width:' + Math.round(w.persen * 100) + '%"></i></div>' +
        '<div class="wallet-note">' + note + '</div></button>';
    }).join('');

    const recent = S.transactions.slice().sort((a, b) => String(b.dibuat).localeCompare(String(a.dibuat))).slice(0, 6);
    $('recent-head').hidden = !recent.length;
    $('home-hint').hidden = !!recent.length && !S.newIds.size;
    $('recent').innerHTML = (S.transkrip ? '<div class="transcript">“' + esc(S.transkrip) + '”</div>' : '') +
      recent.map(txHtml).join('');
  }

  function txHtml(t) {
    let sub, amt, cls;
    if (t.jenis === 'pindah') {
      sub = walletName(t.dompet_id) + ' → ' + walletName(t.dompet_tujuan_id);
      amt = rp(t.nominal); cls = 'c-move';
    } else {
      sub = t.kategori + ' · ' + walletName(t.dompet_id);
      amt = (t.jenis === 'masuk' ? '+' : '-') + rp(t.nominal); cls = t.jenis === 'masuk' ? 'c-in' : 'c-out';
    }
    if (S.tab === 'home' && t.tanggal !== todayStr()) sub += ' · ' + fmtDay(t.tanggal);
    return '<button class="tx' + (S.newIds.has(t.id) ? ' new' : '') + '" data-tx="' + esc(t.id) + '">' +
      '<span class="tx-icon">' + (ICON[t.kategori] || (t.jenis === 'masuk' ? '💰' : '💸')) + '</span>' +
      '<span class="tx-main"><div class="tx-title">' + esc(t.keterangan || t.kategori) + '</div>' +
      '<div class="tx-sub">' + esc(sub) + '</div></span>' +
      '<span class="tx-amt ' + cls + '">' + amt + '</span></button>';
  }

  function renderHistory() {
    const f = S.filter;
    const months = Array.from(new Set(S.transactions.map((t) => L.monthOf(t.tanggal)).concat([thisMonth()]))).sort().reverse();
    $('f-month').innerHTML = '<option value="">Semua bulan</option>' +
      months.map((m) => '<option value="' + m + '"' + (m === f.month ? ' selected' : '') + '>' + fmtMonth(m) + '</option>').join('');
    $('f-wallet').innerHTML = '<option value="">Semua dompet</option>' +
      S.wallets.map((w) => '<option value="' + esc(w.id) + '"' + (w.id === f.wallet ? ' selected' : '') + '>' +
        esc(w.nama) + (w.arsip ? ' (dihapus)' : '') + '</option>').join('');
    const catNames = Array.from(new Set(S.categories.map((c) => c.nama).concat(['Pindah dana'])));
    $('f-cat').innerHTML = '<option value="">Semua kategori</option>' +
      catNames.map((c) => '<option' + (c === f.cat ? ' selected' : '') + '>' + esc(c) + '</option>').join('');

    const q = f.q.trim().toLowerCase();
    const list = L.sortTx(S.transactions).reverse().filter((t) =>
      (!f.month || L.monthOf(t.tanggal) === f.month) &&
      (!f.wallet || t.dompet_id === f.wallet || t.dompet_tujuan_id === f.wallet) &&
      (!f.cat || t.kategori === f.cat) &&
      (!q || (t.keterangan + ' ' + t.kategori + ' ' + t.transkrip + ' ' + t.nominal).toLowerCase().indexOf(q) >= 0));

    if (!list.length) { $('history-list').innerHTML = '<div class="empty">Belum ada transaksi.</div>'; return; }
    let html = '', day = '';
    list.forEach((t) => {
      if (t.tanggal !== day) {
        day = t.tanggal;
        const keluar = list.filter((x) => x.tanggal === day && x.jenis === 'keluar').reduce((s, x) => s + x.nominal, 0);
        html += '<div class="day-head"><span>' + fmtDay(day) + '</span><span>' + (keluar ? '-' + rp(keluar) : '') + '</span></div>';
      }
      html += txHtml(t);
    });
    $('history-list').innerHTML = html;
  }

  function renderReport() {
    const m = S.reportMonth;
    $('r-month').textContent = fmtMonth(m);
    $('r-summary').innerHTML = statsHtml(L.monthSummary(S.transactions, m));
    const rep = L.categoryReport(S.transactions, m);
    $('r-cats').innerHTML = rep.rows.length ? rep.rows.map((r) =>
      '<button class="cat-row tx" style="display:block" data-cat-report="' + esc(r.kategori) + '">' +
      '<div class="cat-top"><span>' + (ICON[r.kategori] || '💸') + ' ' + esc(r.kategori) + '</span><span>' + rp(r.total) + '</span></div>' +
      '<div class="bar"><i style="width:' + Math.round(r.persen * 100) + '%;background:var(--out)"></i></div>' +
      '<div class="cat-pct">' + Math.round(r.persen * 100) + '% dari total pengeluaran</div></button>').join('')
      : '<div class="empty">Belum ada pengeluaran di bulan ini.</div>';
  }

  function renderSettings(cw) {
    const byId = Object.fromEntries(cw.map((w) => [w.id, w]));
    $('s-wallets').innerHTML = activeWallets().map((w) =>
      '<button class="list-item" data-edit-wallet="' + esc(w.id) + '"><span>' + esc(w.nama) +
      (w.id === L.UTAMA_ID ? ' <small>(utama)</small>' : '') + '</span><small>' + rp(byId[w.id].saldo) + ' ›</small></button>').join('');
    ['keluar', 'masuk'].forEach((j) => {
      $('s-cats-' + j).innerHTML = catsOf(j).map((c) =>
        '<button class="list-item" data-edit-cat="' + esc(c.nama) + '" data-jenis="' + j + '"><span>' +
        (ICON[c.nama] || '•') + ' ' + esc(c.nama) + '</span><small>›</small></button>').join('');
    });
    $('s-conn').innerHTML = DEMO ? '🟡 Mode demo (belum tersambung ke Google Sheets)' : '🟢 Tersambung ke Google Sheets';
    $('btn-reset-demo').hidden = !DEMO;
    $('btn-lock').hidden = DEMO;
  }

  // ---------- Tab ----------

  function setTab(tab) {
    S.tab = tab;
    ['home', 'history', 'report', 'settings'].forEach((t) => { $('view-' + t).hidden = t !== tab; });
    document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    $('voice-bar').hidden = tab === 'settings';
    render();
    window.scrollTo(0, 0);
  }

  // ---------- Lembar bawah (modal) ----------

  function openSheet(html, onMount) {
    $('sheet').innerHTML = html;
    $('sheet-backdrop').hidden = false;
    if (onMount) onMount($('sheet'));
  }
  function closeSheet() { $('sheet-backdrop').hidden = true; $('sheet').innerHTML = ''; }

  function askText(title, value, placeholder) {
    return new Promise((resolve) => {
      openSheet('<h3>' + esc(title) + '</h3><div class="field"><input id="ask-input" value="' + esc(value || '') +
        '" placeholder="' + esc(placeholder || '') + '"></div><div class="btn-row"><button class="btn" id="ask-no">Batal</button>' +
        '<button class="btn primary" id="ask-yes">Simpan</button></div>', (el) => {
        const inp = el.querySelector('#ask-input');
        setTimeout(() => inp.focus(), 50);
        el.querySelector('#ask-no').onclick = () => { closeSheet(); resolve(null); };
        el.querySelector('#ask-yes').onclick = () => { closeSheet(); resolve(inp.value.trim() || null); };
        inp.onkeydown = (e) => { if (e.key === 'Enter') el.querySelector('#ask-yes').click(); };
      });
    });
  }

  function confirmBox(msg, yesLabel) {
    return new Promise((resolve) => {
      openSheet('<h3>' + esc(msg) + '</h3><div class="btn-row"><button class="btn" id="c-no">Batal</button>' +
        '<button class="btn primary" id="c-yes">' + esc(yesLabel || 'Ya') + '</button></div>', (el) => {
        el.querySelector('#c-no').onclick = () => { closeSheet(); resolve(false); };
        el.querySelector('#c-yes').onclick = () => { closeSheet(); resolve(true); };
      });
    });
  }

  function moneyInput(inp) {
    inp.addEventListener('input', () => {
      const n = digits(inp.value);
      inp.value = n ? n.toLocaleString('id-ID') : '';
    });
  }

  // ---------- Form transaksi (tambah/edit) ----------

  function openTxForm(tx) {
    const isNew = !tx.id;
    let jenis = tx.jenis || 'keluar';
    const walletOpts = (sel) => activeWallets().concat(S.wallets.filter((w) => w.arsip && w.id === sel))
      .map((w) => '<option value="' + esc(w.id) + '"' + (w.id === sel ? ' selected' : '') + '>' + esc(w.nama) + '</option>').join('');

    openSheet(
      '<h3>' + (isNew ? 'Tambah transaksi' : 'Ubah transaksi') + '</h3>' +
      '<div class="field seg" id="tf-jenis"><button data-j="keluar">Keluar</button><button data-j="masuk">Masuk</button><button data-j="pindah">Pindah</button></div>' +
      '<div class="field"><label>Nominal</label><input id="tf-nominal" inputmode="numeric" placeholder="0" value="' +
        (tx.nominal ? Number(tx.nominal).toLocaleString('id-ID') : '') + '"></div>' +
      '<div class="field"><label>Keterangan</label><input id="tf-ket" value="' + esc(tx.keterangan || '') + '"></div>' +
      '<div class="field" id="tf-cat-field"><label>Kategori</label><select id="tf-cat"></select></div>' +
      '<div class="field"><label id="tf-wallet-label">Dompet</label><select id="tf-wallet">' + walletOpts(tx.dompet_id || L.UTAMA_ID) + '</select></div>' +
      '<div class="field" id="tf-to-field"><label>Ke dompet</label><select id="tf-to">' + walletOpts(tx.dompet_tujuan_id || '') + '</select></div>' +
      '<div class="field"><label>Tanggal</label><input type="date" id="tf-date" value="' + esc(tx.tanggal || todayStr()) + '"></div>' +
      (tx.transkrip ? '<p class="transcript">Dari ucapan: “' + esc(tx.transkrip) + '”</p>' : '') +
      '<div class="btn-row">' + (isNew ? '' : '<button class="btn danger" id="tf-del">Hapus</button>') +
      '<button class="btn" id="tf-cancel">Batal</button><button class="btn primary" id="tf-save">Simpan</button></div>',
      (el) => {
        moneyInput(el.querySelector('#tf-nominal'));
        const sync = () => {
          el.querySelectorAll('#tf-jenis button').forEach((b) => b.classList.toggle('on', b.dataset.j === jenis));
          el.querySelector('#tf-cat-field').hidden = jenis === 'pindah';
          el.querySelector('#tf-to-field').hidden = jenis !== 'pindah';
          el.querySelector('#tf-wallet-label').textContent = jenis === 'masuk' ? 'Masuk ke dompet' : 'Dari dompet';
          const cur = el.querySelector('#tf-cat').value || tx.kategori;
          el.querySelector('#tf-cat').innerHTML = catsOf(jenis === 'pindah' ? 'keluar' : jenis).map((c) =>
            '<option' + (c.nama === cur ? ' selected' : '') + '>' + esc(c.nama) + '</option>').join('');
        };
        el.querySelectorAll('#tf-jenis button').forEach((b) => { b.onclick = () => { jenis = b.dataset.j; sync(); }; });
        sync();
        el.querySelector('#tf-cancel').onclick = closeSheet;
        if (!isNew) {
          el.querySelector('#tf-del').onclick = async () => {
            if (!(await confirmBox('Hapus transaksi ini?', 'Hapus'))) { openTxForm(tx); return; }
            await run(() => api('deleteTx', { id: tx.id }), 'Transaksi dihapus');
          };
        }
        el.querySelector('#tf-save').onclick = async () => {
          const data = {
            id: tx.id, jenis,
            nominal: digits(el.querySelector('#tf-nominal').value),
            keterangan: el.querySelector('#tf-ket').value.trim(),
            kategori: el.querySelector('#tf-cat').value,
            dompet_id: el.querySelector('#tf-wallet').value,
            dompet_tujuan_id: jenis === 'pindah' ? el.querySelector('#tf-to').value : '',
            tanggal: el.querySelector('#tf-date').value || todayStr(),
          };
          if (!data.nominal) { toast('Isi nominalnya dulu'); return; }
          if (jenis === 'pindah' && data.dompet_id === data.dompet_tujuan_id) { toast('Dompet asal dan tujuan harus berbeda'); return; }
          closeSheet();
          await run(() => api(isNew ? 'addTx' : 'updateTx', { tx: data }), isNew ? 'Tersimpan' : 'Perubahan disimpan');
        };
      });
  }

  /** Jalankan aksi ke server lalu muat ulang data. */
  async function run(fn, okMsg) {
    try {
      const out = await fn();
      await refresh();
      if (okMsg) toast(okMsg);
      return out;
    } catch (e) {
      toast(e.message, 4000);
      return null;
    }
  }

  // ---------- Bagi uang ----------

  function openSplit() {
    const cw = computed();
    const saldo = Object.fromEntries(cw.map((w) => [w.id, w.saldo]));
    const ws = activeWallets();
    if (ws.length < 2) {
      toast('Buat dompet lain dulu di menu Atur');
      return;
    }
    openSheet(
      '<h3>Bagi uang ke dompet</h3>' +
      '<div class="field"><label>Ambil dari</label><select id="sp-from">' +
        ws.map((w) => '<option value="' + esc(w.id) + '">' + esc(w.nama) + ' (' + rp(saldo[w.id]) + ')</option>').join('') + '</select></div>' +
      '<div id="sp-rows"></div>' +
      '<div class="split-total"><span>Total dibagi</span><strong id="sp-total">Rp0</strong></div>' +
      '<div class="split-total" style="border:0;padding-top:4px"><span>Sisa di dompet asal</span><strong id="sp-sisa"></strong></div>' +
      '<div class="btn-row"><button class="btn" id="sp-cancel">Batal</button><button class="btn primary" id="sp-save">Bagi</button></div>',
      (el) => {
        const from = el.querySelector('#sp-from');
        const drawRows = () => {
          el.querySelector('#sp-rows').innerHTML = ws.filter((w) => w.id !== from.value).map((w) =>
            '<div class="split-row field"><label style="margin:0">' + esc(w.nama) + '<br><small>' + rp(saldo[w.id]) + '</small></label>' +
            '<input inputmode="numeric" placeholder="0" data-to="' + esc(w.id) + '"></div>').join('');
          el.querySelectorAll('[data-to]').forEach((inp) => { moneyInput(inp); inp.addEventListener('input', total); });
          total();
        };
        const total = () => {
          const t = Array.from(el.querySelectorAll('[data-to]')).reduce((s, i) => s + digits(i.value), 0);
          el.querySelector('#sp-total').textContent = rp(t);
          const sisa = saldo[from.value] - t;
          const sisaEl = el.querySelector('#sp-sisa');
          sisaEl.textContent = rp(sisa);
          sisaEl.className = sisa < 0 ? 'c-out' : '';
        };
        from.onchange = drawRows;
        drawRows();
        el.querySelector('#sp-cancel').onclick = closeSheet;
        el.querySelector('#sp-save').onclick = async () => {
          const txs = Array.from(el.querySelectorAll('[data-to]')).filter((i) => digits(i.value) > 0).map((i) => ({
            jenis: 'pindah', nominal: digits(i.value), dompet_id: from.value, dompet_tujuan_id: i.dataset.to,
            keterangan: 'Isi dompet ' + walletName(i.dataset.to), tanggal: todayStr(),
          }));
          if (!txs.length) { toast('Isi jumlah untuk minimal satu dompet'); return; }
          closeSheet();
          await run(() => api('addTxs', { txs }), 'Uang sudah dibagi ke ' + txs.length + ' dompet');
        };
      });
  }

  // ---------- Pengaturan dompet & kategori ----------

  async function editWallet(id) {
    const w = S.wallets.find((x) => x.id === id);
    const saldo = computed().find((x) => x.id === id).saldo;
    openSheet('<h3>' + esc(w.nama) + '</h3><p>Saldo: <strong>' + rp(saldo) + '</strong></p>' +
      '<div class="list"><button class="list-item" id="ew-rename">Ganti nama</button>' +
      '<button class="list-item" id="ew-history">Lihat riwayat dompet ini</button>' +
      (id === L.UTAMA_ID ? '' : '<button class="list-item danger-text" id="ew-del">Hapus dompet</button>') + '</div>' +
      '<div class="btn-row"><button class="btn" id="ew-close">Tutup</button></div>', (el) => {
      el.querySelector('#ew-close').onclick = closeSheet;
      el.querySelector('#ew-history').onclick = () => { closeSheet(); showWalletHistory(id); };
      el.querySelector('#ew-rename').onclick = async () => {
        const nama = await askText('Nama dompet', w.nama);
        if (nama && nama !== w.nama) await run(() => api('renameWallet', { id, nama }), 'Nama dompet diganti');
      };
      if (id !== L.UTAMA_ID) {
        el.querySelector('#ew-del').onclick = async () => {
          if (saldo !== 0) {
            closeSheet();
            toast('Saldo dompet masih ' + rp(saldo) + '. Pindahkan dulu sisanya ke dompet lain.', 5000);
            return;
          }
          if (await confirmBox('Hapus dompet "' + w.nama + '"? Riwayat transaksinya tetap tersimpan.', 'Hapus')) {
            await run(() => api('deleteWallet', { id }), 'Dompet dihapus');
          }
        };
      }
    });
  }

  function showWalletHistory(id) {
    S.filter = { q: '', month: '', wallet: id, cat: '' };
    $('f-search').value = '';
    setTab('history');
  }

  async function editCategory(nama, jenis) {
    openSheet('<h3>' + esc(nama) + '</h3><div class="list">' +
      '<button class="list-item" id="ec-rename">Ganti nama</button>' +
      (nama === 'Lainnya' ? '' : '<button class="list-item danger-text" id="ec-del">Hapus kategori</button>') + '</div>' +
      '<div class="btn-row"><button class="btn" id="ec-close">Tutup</button></div>', (el) => {
      el.querySelector('#ec-close').onclick = closeSheet;
      el.querySelector('#ec-rename').onclick = async () => {
        const baru = await askText('Nama kategori', nama);
        if (baru && baru !== nama) await run(() => api('renameCategory', { lama: nama, baru, jenis }), 'Kategori diganti');
      };
      if (nama !== 'Lainnya') {
        el.querySelector('#ec-del').onclick = async () => {
          if (await confirmBox('Hapus kategori "' + nama + '"? Transaksi lama tetap memakai nama ini.', 'Hapus')) {
            await run(() => api('deleteCategory', { nama, jenis }), 'Kategori dihapus');
          }
        };
      }
    });
  }

  // ---------- Suara & ketik ----------

  let recording = false, busy = false, recTimer = null, recStart = 0;

  function setVoiceStatus(text) { $('voice-status').textContent = text || ''; }

  async function onMic() {
    if (busy) return;
    if (!recording) {
      try {
        await window.HBRecorder.start();
      } catch (e) {
        toast(e.name === 'NotAllowedError' ? 'Izin mikrofon ditolak. Aktifkan di pengaturan Safari.' : e.message, 5000);
        return;
      }
      recording = true;
      recStart = Date.now();
      $('btn-mic').classList.add('recording');
      setVoiceStatus('Mendengarkan… 0 dtk');
      recTimer = setInterval(() => {
        const sec = Math.floor((Date.now() - recStart) / 1000);
        setVoiceStatus('Mendengarkan… ' + sec + ' dtk\nTekan lagi untuk selesai');
        if (sec >= MAX_REC_SEC) onMic();
      }, 500);
      return;
    }
    recording = false;
    clearInterval(recTimer);
    $('btn-mic').classList.remove('recording');
    const blob = await window.HBRecorder.stop();
    if (!blob || Date.now() - recStart < 700) { setVoiceStatus(''); toast('Rekaman terlalu pendek'); return; }
    const payload = await window.HBRecorder.toPayload(blob);
    await processAi({ audio: payload.data, mime: payload.mime });
  }

  async function processAi(req) {
    busy = true;
    $('btn-mic').classList.add('busy');
    setVoiceStatus('Memproses…');
    try {
      const out = await api('ai', req);
      S.transkrip = out.transkrip || '';
      S.newIds = new Set(out.saved.map((t) => t.id));
      await refresh(true);
      if (S.tab !== 'home') setTab('home');
      if (out.saved.length) {
        const total = out.saved.reduce((s, t) => s + t.nominal, 0);
        toast(out.saved.length + ' transaksi tersimpan (' + rp(total) + '). Ketuk untuk koreksi.');
        warnWallets(out.saved);
      } else {
        toast('Tidak ada transaksi yang dikenali. Coba ulangi dengan menyebut nominalnya.', 4000);
      }
    } catch (e) {
      toast(e.message, 5000);
    } finally {
      busy = false;
      $('btn-mic').classList.remove('busy');
      setVoiceStatus('');
    }
  }

  /** Beri tahu kalau dompet yang baru dipakai jadi menipis/habis. */
  function warnWallets(saved) {
    const ids = new Set(saved.filter((t) => t.jenis !== 'masuk').map((t) => t.dompet_id));
    const bad = computed().filter((w) => ids.has(w.id) && (w.status === 'menipis' || w.status === 'habis'));
    if (bad.length) {
      setTimeout(() => toast(bad.map((w) => '⚠️ ' + w.nama + (w.status === 'habis' ? ' habis' : ' hampir habis') +
        ' (' + rp(w.saldo) + ')').join('\n'), 5000), 3200);
    }
  }

  function openTyping() {
    openSheet('<h3>Ketik transaksi</h3><div class="field"><input id="ty-text" placeholder="mis. bakso 25rb, parkir 2rb dari uang makan" autocomplete="off"></div>' +
      '<div class="btn-row"><button class="btn" id="ty-manual">Isi formulir</button><button class="btn primary" id="ty-go">Catat</button></div>', (el) => {
      const inp = el.querySelector('#ty-text');
      setTimeout(() => inp.focus(), 50);
      el.querySelector('#ty-manual').onclick = () => openTxForm({});
      const go = () => {
        const text = inp.value.trim();
        if (!text) return;
        closeSheet();
        processAi({ text });
      };
      el.querySelector('#ty-go').onclick = go;
      inp.onkeydown = (e) => { if (e.key === 'Enter') go(); };
    });
  }

  // ---------- PIN ----------

  let pinBuf = '';
  function lock(msg) {
    localStorage.removeItem(PIN_KEY);
    $('app').hidden = true;
    $('pin-screen').hidden = false;
    pinBuf = '';
    drawPin();
    $('pin-error').textContent = msg || '';
  }
  function drawPin() {
    $('pin-dots').innerHTML = Array.from({ length: Math.max(4, pinBuf.length) }, (_, i) => '<i class="' + (i < pinBuf.length ? 'on' : '') + '"></i>').join('');
  }
  function buildPinPad() {
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'hapus', '0', 'OK'];
    $('pin-pad').innerHTML = keys.map((k) => '<button class="' + (k.length > 1 ? 'plain' : '') + '" data-k="' + k + '">' +
      (k === 'hapus' ? '⌫' : k) + '</button>').join('');
    $('pin-pad').onclick = async (e) => {
      const k = e.target.closest('button') && e.target.closest('button').dataset.k;
      if (!k) return;
      if (k === 'hapus') pinBuf = pinBuf.slice(0, -1);
      else if (k === 'OK') { await tryPin(); return; }
      else if (pinBuf.length < 12) pinBuf += k;
      drawPin();
    };
  }
  async function tryPin() {
    if (pinBuf.length < 4) { $('pin-error').textContent = 'PIN minimal 4 angka'; return; }
    localStorage.setItem(PIN_KEY, pinBuf);
    $('pin-error').textContent = 'Memeriksa…';
    try {
      await api('ping');
      showApp();
    } catch (e) {
      localStorage.removeItem(PIN_KEY);
      pinBuf = '';
      drawPin();
      $('pin-error').textContent = e.message;
    }
  }

  function showApp() {
    $('pin-screen').hidden = true;
    $('app').hidden = false;
    $('demo-banner').hidden = !DEMO;
    setTab('home');
    refresh();
  }

  // ---------- Event ----------

  function bind() {
    document.querySelector('.tabbar').onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.tab === 'history') S.filter.wallet = S.filter.wallet || '';
      setTab(b.dataset.tab);
    };
    $('btn-refresh').onclick = () => refresh().then(() => toast('Data diperbarui'));
    $('btn-mic').onclick = onMic;
    $('btn-type').onclick = openTyping;
    $('btn-split').onclick = openSplit;
    $('btn-add-manual').onclick = () => openTxForm({});
    $('btn-add-wallet').onclick = async () => {
      const nama = await askText('Nama dompet baru', '', 'mis. Uang Makan');
      if (nama) await run(() => api('addWallet', { nama }), 'Dompet "' + nama + '" dibuat');
    };
    document.querySelectorAll('[data-add-cat]').forEach((b) => {
      b.onclick = async () => {
        const nama = await askText('Kategori ' + (b.dataset.addCat === 'masuk' ? 'pemasukan' : 'pengeluaran') + ' baru', '');
        if (nama) await run(() => api('addCategory', { nama, jenis: b.dataset.addCat }), 'Kategori dibuat');
      };
    });
    $('btn-lock').onclick = () => lock();
    $('btn-reset-demo').onclick = async () => {
      if (await confirmBox('Hapus semua data demo di browser ini?', 'Hapus')) {
        window.HBMock.reset(); S.newIds.clear(); S.transkrip = ''; refresh();
      }
    };

    // Klik di daftar (delegasi)
    document.body.addEventListener('click', (e) => {
      const txBtn = e.target.closest('[data-tx]');
      if (txBtn) { const t = S.transactions.find((x) => x.id === txBtn.dataset.tx); if (t) openTxForm(t); return; }
      const wBtn = e.target.closest('[data-wallet]');
      if (wBtn) { showWalletHistory(wBtn.dataset.wallet); return; }
      const ew = e.target.closest('[data-edit-wallet]');
      if (ew) { editWallet(ew.dataset.editWallet); return; }
      const ec = e.target.closest('[data-edit-cat]');
      if (ec) { editCategory(ec.dataset.editCat, ec.dataset.jenis); return; }
      const cr = e.target.closest('[data-cat-report]');
      if (cr) {
        S.filter = { q: '', month: S.reportMonth, wallet: '', cat: cr.dataset.catReport };
        $('f-search').value = '';
        setTab('history');
      }
    });
    $('sheet-backdrop').addEventListener('click', (e) => { if (e.target === $('sheet-backdrop')) closeSheet(); });

    // Filter riwayat
    $('f-search').oninput = (e) => { S.filter.q = e.target.value; renderHistory(); };
    $('f-month').onchange = (e) => { S.filter.month = e.target.value; renderHistory(); };
    $('f-wallet').onchange = (e) => { S.filter.wallet = e.target.value; renderHistory(); };
    $('f-cat').onchange = (e) => { S.filter.cat = e.target.value; renderHistory(); };

    // Laporan
    $('r-prev').onclick = () => { S.reportMonth = shiftMonth(S.reportMonth, -1); renderReport(); };
    $('r-next').onclick = () => { S.reportMonth = shiftMonth(S.reportMonth, 1); renderReport(); };

    // Muat ulang data saat aplikasi dibuka kembali
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !$('app').hidden) refresh(true);
    });
  }

  // ---------- Mulai ----------

  bind();
  buildPinPad();
  if (DEMO || localStorage.getItem(PIN_KEY)) showApp();
  else lock();

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
