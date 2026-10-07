/* habisberapa — tampilan & interaksi aplikasi. */
(function () {
  const L = window.HBLogic;
  const API_URL = (window.HB_CONFIG && window.HB_CONFIG.API_URL || '').trim();
  const DEMO = !API_URL;
  const CLIENT_ID = (window.HB_CONFIG && window.HB_CONFIG.GOOGLE_CLIENT_ID || '').trim();
  const SESSION_KEY = 'hb_session';   // { token, email, nama, owner }
  const LOGIN_KEY = 'hb_login';       // { state, nonce } selama proses login Google
  const MAX_REC_SEC = 60;
  const BACKUP_AFTER_MS = 9000; // jalur cadangan dikirim kalau 9 detik belum ada jawaban

  const S = { wallets: [], categories: [], transactions: [], newIds: new Set(), transkrip: '',
    tab: 'home', reportMonth: thisMonth(), filter: { q: '', month: thisMonth(), wallet: '', cat: '' } };

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rp = (n) => (n < 0 ? '-' : '') + 'Rp' + Math.abs(Math.round(n)).toLocaleString('id-ID');
  const secs = (ms) => (ms / 1000).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + ' dtk';
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

  /** Aksi yang dikirim ke server. Semua aksi lain (data) disimpan di HP lewat HBStore. */
  const SERVER_ACTIONS = { login: 1, parse: 1, legacyState: 1, feedback: 1, stats: 1, me: 1 };
  // Server lama (Google Apps Script) memakai satu alamat + nama aksi di isi permintaan;
  // server baru (Cloudflare Worker) memakai alamat per aksi, mis. https://…workers.dev/parse
  const LEGACY_SERVER = /script\.google\.com/.test(API_URL);

  async function api(action, req) {
    if (!SERVER_ACTIONS[action]) return window.HBStore.call(action, req);
    if (DEMO) throw new Error('Mode demo: fitur ini butuh server.');
    let res;
    try {
      res = await fetch(LEGACY_SERVER ? API_URL : API_URL.replace(/\/+$/, '') + '/' + action, {
        method: 'POST',
        // text/plain supaya tidak memicu pemeriksaan CORS tambahan dari Apps Script
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action, token: session() ? session().token : '', ...(req || {}) }),
      });
    } catch (e) {
      throw new Error('Tidak bisa terhubung. Periksa koneksi internet.');
    }
    let body;
    try { body = await res.json(); } catch (e) { throw new Error('Jawaban server tidak terbaca (' + res.status + ').'); }
    if (!body.ok) {
      const err = new Error(body.error || 'Terjadi kesalahan');
      err.code = body.code;
      if (body.code === 'auth' && action !== 'login') logout(body.error);
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

  /** Warna pastel tiap dompet: tetap sama selama dompet ada (berdasarkan urutan dibuat). */
  const WALLET_COLORS = 8;   // warna otomatis bergilir di 8 warna pertama
  const PICK_COLORS = 12;    // pilihan warna yang bisa dipilih sendiri
  const COLOR_NAMES = ['Mint', 'Peach', 'Lavender', 'Biru langit', 'Kuning', 'Pink', 'Sage', 'Aqua',
    'Periwinkle', 'Aprikot', 'Ungu muda', 'Abu biru'];
  function walletColorIndex(id) {
    const w = S.wallets.find((x) => x.id === id);
    if (!w) return 0;
    if (w.warna !== undefined && w.warna !== '') return Number(w.warna) % PICK_COLORS;
    return (Number(w.urutan) || 0) % WALLET_COLORS;
  }
  function walletColor(id) { return 'wc-' + walletColorIndex(id); }
  function walletEmoji(nama) {
    const n = String(nama).toLowerCase();
    const rules = [[/utama|harian|dompet/, '💳'], [/makan|jajan|kopi|food|dapur/, '🍜'], [/bensin|motor|mobil|transport|ojek|bbm/, '⛽'],
      [/tabung|nabung|saving|invest/, '🐷'], [/darurat|cadangan/, '🛟'], [/belanja|bulanan|groceries/, '🛒'],
      [/tagihan|listrik|air|internet|pulsa|cicilan|kos|sewa/, '🧾'], [/sekolah|kuliah|pendidikan|anak|spp/, '🎓'],
      [/liburan|jalan|travel|hiburan|nonton/, '🏖️'], [/sehat|obat|dokter/, '💊'], [/zakat|sedekah|amal|infak/, '🤲'],
      [/hadiah|kado|arisan/, '🎁'], [/rumah|renov/, '🏠'], [/pet|kucing|anjing/, '🐾']];
    const hit = rules.find(([re]) => re.test(n));
    return hit ? hit[1] : '👛';
  }

  function computed() { return L.computeWallets(S.wallets, S.transactions); }

  // ---------- Render ----------

  function render() {
    const cw = computed();
    const aktif = cw.filter((w) => !w.arsip);
    $('total-saldo').textContent = rp(aktif.reduce((s, w) => s + w.saldo, 0));
    const me = DEMO ? null : session();
    const first = me && (me.nama || me.email || '').split(/[\s@]/)[0];
    $('hello').textContent = 'Halo' + (first ? ', ' + first : '') + ' 👋';
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
    renderBackupBanner();
    $('home-summary').innerHTML = statsHtml(L.monthSummary(S.transactions, thisMonth()));
    const byId = Object.fromEntries(cw.map((w) => [w.id, w]));
    $('wallet-grid').innerHTML = activeWallets().map((w0) => {
      const w = byId[w0.id];
      const note = { menipis: 'Hampir habis', habis: w.saldo < 0 ? 'Minus' : 'Habis', kosong: 'Belum diisi', aman: '' }[w.status];
      return '<button class="wallet ' + walletColor(w.id) + '" data-status="' + w.status + '" data-wallet="' + esc(w.id) + '">' +
        '<div class="wallet-top"><span class="wallet-emoji">' + walletEmoji(w.nama) + '</span>' +
        (note ? '<span class="badge">' + note + '</span>' : '') + '</div>' +
        '<div class="wallet-name">' + esc(w.nama) + '</div>' +
        '<div class="wallet-saldo">' + rp(w.saldo) + '</div>' +
        '<div class="bar"><i style="width:' + Math.round(w.persen * 100) + '%"></i></div></button>';
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
      '<span class="tx-icon ' + walletColor(t.jenis === 'pindah' ? t.dompet_tujuan_id : t.dompet_id) + '">' +
        (ICON[t.kategori] || (t.jenis === 'masuk' ? '💰' : '💸')) + '</span>' +
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

  // ---------- Grafik posisi kas ----------

  const ZONES = {
    hijau: { icon: '☁️', label: 'Lagi di atas awan king, saatnya investasi' },
    kuning: { icon: '😎', label: 'Nikmati hidup dengan lowkey' },
    oranye: { icon: '👀', label: 'Waspada king, tetap jaga pengeluaran' },
    merah: { icon: '🆘', label: 'Lagi mode survival, jangan banyak gaya' },
  };
  const pct = (p) => Math.round(p * 100) + '%';

  function renderCash() {
    const m = S.reportMonth;
    const box = $('r-cash'), head = $('r-cash-head'), tip = $('r-cash-tip');
    tip.hidden = true;
    const cp = L.cashPosition(S.transactions, m, m === thisMonth() ? todayStr() : null);
    const pts = m > thisMonth() ? [] : cp.days.map((d, i) => ({ ...d, i })).filter((d) => d.persen !== null);
    if (!pts.length) {
      head.innerHTML = '';
      box.innerHTML = '<div class="empty">Belum ada pemasukan atau saldo di bulan ini.</div>';
      return;
    }
    const last = pts[pts.length - 1];
    const z = ZONES[L.cashZone(last.persen)];
    head.innerHTML = '<span class="cash-zone zone-' + L.cashZone(last.persen) + '">' + z.icon + ' ' + pct(last.persen) + '</span>' +
      '<span class="cash-zone-text"><b>' + esc(z.label) + '</b><br><small>' +
      (m === thisMonth() ? 'Posisi hari ini' : 'Posisi akhir bulan') + ' · saldo ' + rp(last.saldo) + '</small></span>';

    const [yy, mm] = m.split('-').map(Number);
    const daysInMonth = new Date(yy, mm, 0).getDate();
    const W = Math.max(280, box.clientWidth || 320), H = 220;
    const L0 = 38, R0 = 10, T0 = 8, B0 = 24;
    const pw = W - L0 - R0, ph = H - T0 - B0;
    const x = (i) => L0 + (daysInMonth > 1 ? (i / (daysInMonth - 1)) * pw : 0);
    const y = (p) => T0 + (1 - p) * ph;
    const band = (key, top, bottom) =>
      '<rect x="' + L0 + '" y="' + y(top) + '" width="' + pw + '" height="' + (y(bottom) - y(top)) + '" fill="url(#g-' + key + ')"/>';
    const grad = (key) => '<linearGradient id="g-' + key + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="var(--zone-' + key + ')" stop-opacity=".75"/>' +
      '<stop offset="1" stop-color="var(--zone-' + key + ')" stop-opacity=".25"/></linearGradient>';
    const ticksY = [1].concat(L.CASH_LEVELS, [0]).map((p) =>
      '<text class="axis" x="' + (L0 - 6) + '" y="' + (y(p) + 4) + '" text-anchor="end">' + pct(p) + '</text>').join('');
    const ticksX = [1, 8, 15, 22, daysInMonth].map((d) =>
      '<text class="axis" x="' + x(d - 1) + '" y="' + (H - 6) + '" text-anchor="middle">' + d + '</text>').join('');
    const line = pts.map((d, k) => (k ? 'L' : 'M') + x(d.i).toFixed(1) + ' ' + y(d.persen).toFixed(1)).join(' ');
    box.innerHTML = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Grafik posisi kas ' +
      esc(fmtMonth(m)) + ', terakhir ' + pct(last.persen) + '">' +
      '<defs>' + Object.keys(ZONES).map(grad).join('') + '</defs>' +
      band('hijau', 1, 0.75) + band('kuning', 0.75, 0.5) + band('oranye', 0.5, 0.25) + band('merah', 0.25, 0) +
      ticksY + ticksX +
      '<path class="cash-line" d="' + line + '"/>' +
      '<line class="cross" id="cash-cross" x1="0" x2="0" y1="' + T0 + '" y2="' + (T0 + ph) + '" visibility="hidden"/>' +
      '<circle class="cash-dot" id="cash-dot" r="5" cx="' + x(last.i) + '" cy="' + y(last.persen) + '"/>' +
      '<rect id="cash-hit" x="' + L0 + '" y="0" width="' + pw + '" height="' + (H - B0) + '" fill="transparent"/>' +
      '</svg>';

    // Ketuk / geser di grafik untuk melihat rincian hari itu.
    const hit = box.querySelector('#cash-hit'), cross = box.querySelector('#cash-cross'), dot = box.querySelector('#cash-dot');
    const show = (ev) => {
      const r = box.querySelector('svg').getBoundingClientRect();
      const px = ev.clientX - r.left;
      let best = pts[0];
      pts.forEach((d) => { if (Math.abs(x(d.i) - px) < Math.abs(x(best.i) - px)) best = d; });
      cross.setAttribute('x1', x(best.i)); cross.setAttribute('x2', x(best.i)); cross.setAttribute('visibility', 'visible');
      dot.setAttribute('cx', x(best.i)); dot.setAttribute('cy', y(best.persen));
      tip.replaceChildren();
      const add = (tag, text, cls) => { const e = document.createElement(tag); e.textContent = text; if (cls) e.className = cls; tip.appendChild(e); };
      const bz = ZONES[L.cashZone(best.persen)];
      add('strong', bz.icon + ' ' + pct(best.persen));
      add('div', bz.label, 'tip-zone');
      add('div', fmtDay(best.tanggal), 'tip-date');
      add('div', 'Saldo ' + rp(best.saldo));
      add('div', 'Pengeluaran hari itu ' + rp(best.keluar));
      if (best.masuk) add('div', 'Pemasukan ' + rp(best.masuk));
      tip.hidden = false;
      const tx = Math.min(Math.max(x(best.i) - tip.offsetWidth / 2, 4), W - tip.offsetWidth - 4);
      tip.style.left = tx + 'px';
    };
    hit.addEventListener('pointerdown', show);
    hit.addEventListener('pointermove', show);
    hit.addEventListener('pointerleave', (ev) => {
      if (ev.pointerType !== 'mouse') return; // di HP rincian tetap tampil setelah diketuk
      tip.hidden = true;
      cross.setAttribute('visibility', 'hidden');
      dot.setAttribute('cx', x(last.i)); dot.setAttribute('cy', y(last.persen));
    });
  }

  function renderReport() {
    const m = S.reportMonth;
    $('r-month').textContent = fmtMonth(m);
    $('r-summary').innerHTML = statsHtml(L.monthSummary(S.transactions, m));
    renderCash();
    renderCompare();
    const rep = L.categoryReport(S.transactions, m);
    $('r-cats').innerHTML = rep.rows.length ? rep.rows.map((r, i) =>
      '<button class="cat-row tx wc-' + (i % WALLET_COLORS) + '" style="display:block" data-cat-report="' + esc(r.kategori) + '">' +
      '<div class="cat-top"><span>' + (ICON[r.kategori] || '💸') + ' ' + esc(r.kategori) + '</span><span>' + rp(r.total) + '</span></div>' +
      '<div class="bar"><i style="width:' + Math.round(r.persen * 100) + '%"></i></div>' +
      '<div class="cat-pct">' + Math.round(r.persen * 100) + '% dari total pengeluaran</div></button>').join('')
      : '<div class="empty">Belum ada pengeluaran di bulan ini.</div>';
  }

  function renderSettings(cw) {
    const byId = Object.fromEntries(cw.map((w) => [w.id, w]));
    $('s-wallets').innerHTML = activeWallets().map((w) =>
      '<button class="list-item ' + walletColor(w.id) + '" data-edit-wallet="' + esc(w.id) + '"><span><i class="dot"></i>' + walletEmoji(w.nama) + ' ' + esc(w.nama) +
      (w.id === L.UTAMA_ID ? ' <small>(utama)</small>' : '') + '</span><small>' + rp(byId[w.id].saldo) + ' ›</small></button>').join('');
    ['keluar', 'masuk'].forEach((j) => {
      $('s-cats-' + j).innerHTML = catsOf(j).map((c) =>
        '<button class="list-item" data-edit-cat="' + esc(c.nama) + '" data-jenis="' + j + '"><span>' +
        (ICON[c.nama] || '•') + ' ' + esc(c.nama) + '</span><small>›</small></button>').join('');
    });
    $('s-conn').innerHTML = DEMO ? '🟡 Mode demo: tanpa AI suara' : '🟢 Tersambung ke server AI';
    renderDataInfo();
    const lt = S.lastTiming;
    $('s-timing').hidden = !lt;
    if (lt) {
      $('s-timing').innerHTML = '<span>⏱ Proses terakhir: <b>' + secs(lt.total) + '</b><br><small>' +
        (lt.conv ? 'siapkan rekaman ' + secs(lt.conv) + ' (' + lt.kb + ' KB) · ' : '') +
        (lt.ai != null ? 'AI ' + secs(lt.ai) + ' · server & internet ' + secs(lt.total - lt.ai) : '') +
        (lt.model ? '<br>model ' + esc(lt.model) + (lt.lane === 1 ? ' (jalur cadangan)' : '') : '') +
        (lt.log.length > 1 ? '<br>percobaan: ' + lt.log.map((x) => esc(x.m.replace('gemini-', '')) + ' ' +
          (x.s === 200 ? '✓' : x.s) + ' ' + secs(x.ms)).join(' → ') : '') + '</small></span>';
    }

    const me = session();
    $('btn-logout').hidden = DEMO || !me;
    $('s-account').hidden = DEMO || !me;
    if (me) $('s-account').innerHTML = '<span>👤 ' + esc(me.nama || me.email) + '<br><small>' + esc(me.email) +
      (me.owner ? ' · pemilik' : '') + '</small></span>';
    $('btn-migrate').hidden = DEMO || !me || !LEGACY_SERVER;
    $('btn-feedback').hidden = DEMO || !me || LEGACY_SERVER;
    $('btn-stats').hidden = DEMO || !me || !me.owner || LEGACY_SERVER;
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
    const cur = walletColorIndex(id);
    openSheet('<h3>' + walletEmoji(w.nama) + ' ' + esc(w.nama) + '</h3><p>Saldo: <strong>' + rp(saldo) + '</strong></p>' +
      '<div class="field"><label>Warna dompet</label><div class="swatches">' +
      Array.from({ length: PICK_COLORS }, (_, i) => '<button class="swatch wc-' + i + (i === cur ? ' on' : '') +
        '" data-color="' + i + '" aria-label="' + COLOR_NAMES[i] + '"></button>').join('') + '</div></div>' +
      '<div class="list"><button class="list-item" id="ew-rename">Ganti nama</button>' +
      '<button class="list-item" id="ew-history">Lihat riwayat dompet ini</button>' +
      (id === L.UTAMA_ID ? '' : '<button class="list-item danger-text" id="ew-del">Hapus dompet</button>') + '</div>' +
      '<div class="btn-row"><button class="btn" id="ew-close">Tutup</button></div>', (el) => {
      el.querySelector('#ew-close').onclick = closeSheet;
      el.querySelectorAll('[data-color]').forEach((b) => {
        b.onclick = async () => {
          const warna = Number(b.dataset.color);
          if (warna === walletColorIndex(id)) return;
          el.querySelectorAll('[data-color]').forEach((x) => x.classList.toggle('on', x === b));
          // Langsung tampilkan warnanya, lalu simpan ke server.
          const prev = w.warna;
          w.warna = String(warna);
          render();
          try {
            await api('setWalletColor', { id, warna });
            toast('Warna ' + w.nama + ': ' + COLOR_NAMES[warna]);
          } catch (e) {
            w.warna = prev;
            render();
            toast(e.message, 4000);
          }
        };
      });
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
    const tConv = Date.now();
    setVoiceStatus('Menyiapkan rekaman…');
    const payload = await window.HBRecorder.toPayload(blob);
    S.convMs = Date.now() - tConv;
    await processAi({ audio: payload.data, mime: payload.mime });
  }

  /**
   * Kirim ke server lewat jalur utama. Kalau belum ada jawaban dalam BACKUP_AFTER_MS (atau jalur utama gagal),
   * kirim juga lewat jalur cadangan yang memakai model AI lain. Yang selesai duluan dipakai.
   * Server hanya membaca ucapan; transaksi disimpan di HP sekali saja oleh processAi.
   */
  function aiWithBackup(req) {
    if (DEMO) {
      if (req.audio) return Promise.reject(new Error('Mode demo belum bisa memproses suara. Coba fitur ketik.'));
      return Promise.resolve({ transkrip: req.text, demoTxs: L.parseDemo(req.text, S.wallets, S.categories, todayStr()) });
    }
    const lists = {
      wallets: activeWallets().map((w) => ({ id: w.id, nama: w.nama })),
      categories: S.categories.map((c) => ({ nama: c.nama, jenis: c.jenis })),
    };
    return new Promise((resolve, reject) => {
      let finished = false, pending = 0, backupSent = false, lastErr = null, timer = null;
      const send = (lane) => {
        pending++;
        api('parse', { ...req, ...lists, lane }).then((out) => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          resolve(out);
        }, (err) => {
          pending--;
          lastErr = err;
          if (finished) return;
          if (err.code === 'auth' || err.code === 'forbidden') { finished = true; clearTimeout(timer); reject(err); return; }
          if (!backupSent && !DEMO) { clearTimeout(timer); backup(); return; }
          if (pending === 0) { finished = true; reject(lastErr); }
        });
      };
      const backup = () => {
        if (backupSent || finished) return;
        backupSent = true;
        send(1);
      };
      send(0);
      if (!DEMO) timer = setTimeout(backup, BACKUP_AFTER_MS);
    });
  }

  async function processAi(req) {
    busy = true;
    $('btn-mic').classList.add('busy');
    const t0 = Date.now();
    setVoiceStatus('Memproses… 0 dtk');
    const tick = setInterval(() => setVoiceStatus('Memproses… ' + Math.floor((Date.now() - t0) / 1000) + ' dtk'), 1000);
    try {
      const out = await aiWithBackup(req);
      const sumber = req.audio ? 'suara' : 'ketik';
      const txs = out.demoTxs ? out.demoTxs.map((t) => ({ ...t, sumber, transkrip: out.transkrip }))
        : L.mapAiResult(out, S.wallets, S.categories, { sumber, transkrip: out.transkrip, today: todayStr() });
      out.saved = txs.length ? await api('addTxs', { txs }) : [];
      const totalMs = Date.now() - t0;
      S.lastTiming = { total: totalMs, ai: out.timing && out.timing.ai_ms, model: out.timing && out.timing.model,
        attempts: out.timing && out.timing.attempts, lane: out.timing && out.timing.lane, log: (out.timing && out.timing.log) || [], conv: req.audio ? S.convMs : 0, kb: req.audio ? Math.round(req.audio.length * 0.75 / 1024) : 0 };
      S.transkrip = out.transkrip || '';
      S.newIds = new Set(out.saved.map((t) => t.id));
      await refresh(true);
      if (S.tab !== 'home') setTab('home');
      if (out.saved.length) {
        const total = out.saved.reduce((s, t) => s + t.nominal, 0);
        toast(out.saved.length + ' transaksi tersimpan (' + rp(total) + ') · ' + secs(totalMs) + '\nKetuk untuk koreksi.');
        warnWallets(out.saved);
      } else {
        toast('Tidak ada transaksi yang dikenali. Coba ulangi dengan menyebut nominalnya.', 4000);
      }
    } catch (e) {
      offerRetry(req, e.message);
    } finally {
      clearInterval(tick);
      busy = false;
      $('btn-mic').classList.remove('busy');
      setVoiceStatus('');
    }
  }

  /** Simpan rekaman/teks yang gagal diproses supaya bisa dicoba lagi tanpa bicara ulang. */
  function offerRetry(req, msg) {
    openSheet('<h3>Belum berhasil diproses</h3><p>' + esc(msg) + '</p>' +
      '<p class="transcript">' + (req.audio ? 'Rekaman suara Anda masih disimpan.' : 'Teks: “' + esc(req.text) + '”') + '</p>' +
      '<div class="btn-row"><button class="btn" id="rt-no">Buang</button><button class="btn primary" id="rt-yes">Coba lagi</button></div>', (el) => {
      el.querySelector('#rt-no').onclick = closeSheet;
      el.querySelector('#rt-yes').onclick = () => { closeSheet(); processAi(req); };
    });
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

  // ---------- Login Google ----------
  // Memakai pengalihan halaman (bukan pop-up) supaya juga berjalan di aplikasi layar utama iPhone.

  function session() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch (e) { return null; }
  }

  function randomStr() {
    const a = new Uint8Array(16);
    crypto.getRandomValues(a);
    return Array.from(a, (x) => x.toString(16).padStart(2, '0')).join('');
  }

  /** Alamat aplikasi ini tanpa "index.html", harus sama persis dengan yang didaftarkan di Google Cloud. */
  function appUrl() {
    return location.origin + location.pathname.replace(/index\.html$/, '');
  }

  function logout(msg) {
    localStorage.removeItem(SESSION_KEY);
    $('app').hidden = true;
    $('login-screen').hidden = false;
    $('btn-login').disabled = false;
    $('login-error').textContent = msg || '';
  }

  function startLogin() {
    if (!CLIENT_ID) {
      $('login-error').textContent = 'Client ID Google belum diisi di config.js.';
      return;
    }
    const st = { state: randomStr(), nonce: randomStr() };
    localStorage.setItem(LOGIN_KEY, JSON.stringify(st));
    const q = new URLSearchParams({
      client_id: CLIENT_ID, redirect_uri: appUrl(), response_type: 'id_token', scope: 'openid email profile',
      state: st.state, nonce: st.nonce, prompt: 'select_account',
    });
    $('btn-login').disabled = true;
    location.href = 'https://accounts.google.com/o/oauth2/v2/auth?' + q.toString();
  }

  /** Dipanggil saat Google mengembalikan pengguna ke aplikasi dengan #id_token=... */
  async function finishLogin() {
    const p = new URLSearchParams(location.hash.slice(1));
    history.replaceState(null, '', appUrl()); // buang token dari alamat
    let st = null;
    try { st = JSON.parse(localStorage.getItem(LOGIN_KEY)); } catch (e) { /* abaikan */ }
    localStorage.removeItem(LOGIN_KEY);
    logout();
    if (p.get('error')) {
      $('login-error').textContent = p.get('error') === 'access_denied'
        ? 'Login dibatalkan atau ditolak Google. Kalau Anda tidak membatalkan, minta pemilik aplikasi mendaftarkan email Anda sebagai Test user.' :
        'Login Google gagal (' + p.get('error') + '). Alamat yang harus didaftarkan: ' + appUrl();
      return;
    }
    if (!st || p.get('state') !== st.state) {
      $('login-error').textContent = 'Login tidak valid. Silakan coba lagi.';
      return;
    }
    $('btn-login').disabled = true;
    $('login-error').textContent = 'Memeriksa akun…';
    try {
      const out = await api('login', { idToken: p.get('id_token'), nonce: st.nonce });
      localStorage.setItem(SESSION_KEY, JSON.stringify({ token: out.token, email: out.email, nama: out.nama, owner: out.owner }));
      $('login-error').textContent = '';
      showApp();
    } catch (e) {
      logout(e.message);
    }
  }

  // ---------- Masukan & statistik ----------

  function sendFeedback() {
    openSheet('<h3>Kirim masukan</h3><p class="transcript">Ceritakan apa yang menyenangkan, membingungkan, atau ingin ditambahkan.</p>' +
      '<div class="field"><textarea id="fb-text" maxlength="2000" placeholder="Tulis masukan Anda…"></textarea></div>' +
      '<div class="btn-row"><button class="btn" id="fb-no">Batal</button><button class="btn primary" id="fb-yes">Kirim</button></div>', (el) => {
      const ta = el.querySelector('#fb-text');
      setTimeout(() => ta.focus(), 50);
      el.querySelector('#fb-no').onclick = closeSheet;
      el.querySelector('#fb-yes').onclick = async () => {
        const text = ta.value.trim();
        if (!text) { toast('Masukan masih kosong'); return; }
        try {
          await api('feedback', { text });
          closeSheet();
          toast('Terima kasih! Masukan Anda sudah terkirim 🙏');
        } catch (e) {
          toast(e.message, 5000);
        }
      };
    });
  }

  async function showStats() {
    let st;
    try {
      st = await withBusy('Mengambil statistik…', () => api('stats'));
    } catch (e) {
      toast(e.message, 5000);
      return;
    }
    const rows = st.hari.slice().reverse().map((d) =>
      '<tr><td>' + esc(fmtDay(d.day)) + '</td><td>' + d.aktif + '</td><td>' + d.catatan + '</td></tr>').join('');
    const fb = st.masukan.length ? st.masukan.map((f) =>
      '<div class="fb-item"><small>' + esc(f.email) + ' · ' + esc(fmtDateTime(f.ts)) + '</small>' + esc(f.text) + '</div>').join('')
      : '<p class="transcript">Belum ada masukan.</p>';
    openSheet('<h3>📈 Statistik pemakaian</h3>' +
      '<div class="month-strip" style="margin-top:0"><div class="stat"><div class="stat-label">Total pengguna</div><div class="stat-value">' +
      st.totalPengguna + '</div></div><div class="stat"><div class="stat-label">Baru (14 hari)</div><div class="stat-value">' + st.penggunaBaru14 + '</div></div></div>' +
      '<h2>14 hari terakhir</h2>' +
      (rows ? '<table class="stat-table"><tr><th>Hari</th><th>Pengguna aktif</th><th>Catatan AI</th></tr>' + rows + '</table>'
        : '<p class="transcript">Belum ada pemakaian AI.</p>') +
      '<h2>Masukan terbaru</h2>' + fb +
      '<div class="btn-row"><button class="btn" id="st-close">Tutup</button></div>', (el) => {
      el.querySelector('#st-close').onclick = closeSheet;
    });
  }

  async function showApp() {
    try {
      await window.HBStore.open(DEMO ? null : session().email);
    } catch (e) {
      toast('Penyimpanan HP tidak bisa dibuka: ' + e.message, 6000);
      return;
    }
    $('login-screen').hidden = true;
    $('app').hidden = false;
    $('demo-banner').hidden = !DEMO;
    await loadMeta();
    setTab('home');
    await refresh();
    if (!DEMO && LEGACY_SERVER) offerMigrationOnce();
    if (!META.tutorialSelesai) showTutorial();
  }

  // ---------- Perbandingan pengeluaran (Laporan) ----------

  function renderCompare() {
    const n = S.compareN || 3;
    document.querySelectorAll('#cmp-seg button').forEach((b) => b.classList.toggle('on', Number(b.dataset.n) === n));
    const c = L.compareMonths(S.transactions, S.reportMonth, n);
    const cur = c.bulan[c.bulan.length - 1];
    const box = $('r-compare');
    if (!c.bulan.some((b) => b.keluar > 0)) {
      box.innerHTML = '<div class="empty">Belum ada pengeluaran untuk dibandingkan.</div>';
      return;
    }
    const short = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('id-ID', { month: 'short' }); };
    const max = Math.max(...c.bulan.map((b) => b.keluar), 1);
    let verdict;
    if (c.persen === null) verdict = 'Belum ada data pengeluaran di bulan-bulan sebelumnya.';
    else if (Math.abs(c.persen) < 0.05) verdict = '⚖️ Pengeluaran ' + fmtMonth(cur.bulan) + ' kurang lebih sama dengan rata-rata sebelumnya.';
    else if (c.persen < 0) verdict = '🎉 Lebih hemat <b>' + Math.round(-c.persen * 100) + '%</b> (' + rp(-c.selisih) + ') dibanding rata-rata ' + c.dibanding + ' bulan sebelumnya.';
    else verdict = '🔥 Lebih boros <b>' + Math.round(c.persen * 100) + '%</b> (' + rp(c.selisih) + ') dibanding rata-rata ' + c.dibanding + ' bulan sebelumnya.';
    const partial = cur.bulan === thisMonth() ? '<p class="cmp-note">Bulan ini baru sampai tanggal ' + Number(todayStr().slice(8)) + ', jadi angkanya masih bisa bertambah.</p>' : '';
    // Garis putus-putus = rata-rata bulan-bulan sebelumnya (digambar di dalam tiap kolom supaya posisinya tepat).
    const avgPct = c.rataSebelum > 0 ? Math.round((c.rataSebelum / max) * 1000) / 10 : null;
    const bars = c.bulan.map((b, i) => {
      const h = Math.round((b.keluar / max) * 100);
      const last = i === c.bulan.length - 1;
      return '<div class="cmp-col' + (last ? ' cur' : '') + (b.adaData ? '' : ' nodata') + '" title="' + esc(fmtMonth(b.bulan)) + ': ' +
        (b.adaData ? rp(b.keluar) : 'belum mulai mencatat') + '">' +
        '<span class="cmp-val">' + (b.adaData ? rpShort(b.keluar) : '–') + '</span>' +
        '<div class="cmp-track"><i style="height:' + Math.max(h, b.keluar ? 3 : 0) + '%"></i>' +
        (avgPct !== null ? '<b class="cmp-avg" style="bottom:' + avgPct + '%"></b>' : '') + '</div>' +
        '<span class="cmp-label">' + esc(short(b.bulan)) + '</span></div>';
    }).join('');
    const rows = c.kategori.slice(0, 8).map((k) => {
      const up = k.selisih > 0.5, down = k.selisih < -0.5;
      return '<tr><td>' + (ICON[k.kategori] || '•') + ' ' + esc(k.kategori) + '</td><td>' + rpShort(k.ini) + '</td><td>' + rpShort(k.rata) + '</td>' +
        '<td class="' + (up ? 'c-out' : down ? 'c-in' : '') + '">' + (up ? '▲ ' : down ? '▼ ' : '') + rpShort(Math.abs(k.selisih)) + '</td></tr>';
    }).join('');
    box.innerHTML = '<p class="cmp-verdict">' + verdict + '</p>' + partial +
      '<div class="cmp-chart">' + bars + '</div>' +
      (avgPct !== null ? '<p class="cmp-legend"><i></i>rata-rata ' + c.dibanding + ' bulan sebelumnya: ' + rp(c.rataSebelum) + '</p>' : '') +
      (c.persen === null ? '' : '<div class="cmp-table-wrap"><table class="stat-table cmp-table"><tr><th>Kategori</th><th>' + esc(short(cur.bulan)) +
        '</th><th>Rata²</th><th>±</th></tr>' + rows + '</table></div>');
  }

  function rpShort(n) {
    const a = Math.abs(n);
    if (a >= 1e6) return 'Rp' + (n / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + ' jt';
    if (a >= 1e3) return 'Rp' + Math.round(n / 1e3).toLocaleString('id-ID') + ' rb';
    return rp(n);
  }

  // ---------- Tutorial singkat (pertama kali masuk) ----------

  const TUTORIAL = [
    { icon: '👋', title: 'Halo, bos! Selamat datang', text: 'Habis Berapa siap jawab pertanyaan paling horor tiap akhir bulan: <i>“duitku habis buat apa aja sih?”</i> Tenang, mulai sekarang ada yang nyatetin.' },
    { icon: '👛', title: 'Dompet = amplop ajaib', text: 'Gajian masuk ke dompet <b>Utama</b>, lalu bagi-bagi ke dompet lain: Uang Makan, Bensin, Tabungan. Persis amplop jaman nenek, bedanya nggak bisa diselipin di bawah kasur. Pakai tombol <b>Bagi uang</b> di Beranda.' },
    { icon: '🎙️', title: 'Nggak usah ngetik, ngomong aja', text: 'Tekan tombol mic, terus cerita kayak lagi curhat:<br><b>“makan siang 25 ribu, parkir 2 ribu, ambil dari dompet uang makan.”</b><br>Goceng, ceban, cepek? Paham kok. Kalau salah tangkap, ketuk transaksinya terus benerin.' },
    { icon: '🚦', title: 'Kalau dompet mulai merah…', text: 'Bingkai kuning artinya dompet tinggal dikit. Merah artinya… ya udah, puasa jajan dulu 🙃. Cek juga <b>Laporan</b>: posisi kasmu dari <i>“di atas awan king”</i> sampai <i>“mode survival”</i>, plus perbandingan sama bulan-bulan sebelumnya.' },
    { icon: '💾', title: 'Datamu, HP-mu, tanggung jawabmu', text: 'Semua catatan cuma disimpan di HP ini, nggak di server mana pun. Jadi rajin-rajin <b>Simpan cadangan</b> ke Excel atau Google Sheets di menu Atur, biar nggak nangis kalau HP nyemplung.' },
    { icon: '🚀', title: 'Udah, gitu doang!', text: 'Mulai dengan bikin dompet di menu <b>Atur</b>, atau langsung tekan mic dan bilang <b>“gajian 5 juta”</b>. Ada ide atau keluhan? <b>Atur → Kirim masukan</b>. Selamat nyatet!' },
  ];

  function showTutorial() {
    let i = 0;
    const el = $('tutorial');
    const draw = () => {
      const s = TUTORIAL[i];
      el.querySelector('.tut-icon').textContent = s.icon;
      el.querySelector('.tut-title').textContent = s.title;
      el.querySelector('.tut-text').innerHTML = s.text;
      el.querySelector('.tut-dots').innerHTML = TUTORIAL.map((_, k) => '<i class="' + (k === i ? 'on' : '') + '"></i>').join('');
      el.querySelector('#tut-back').hidden = i === 0;
      el.querySelector('#tut-skip').hidden = i === TUTORIAL.length - 1;
      el.querySelector('#tut-next').textContent = i === TUTORIAL.length - 1 ? 'Gas! 🚀' : 'Lanjut';
    };
    const done = async () => {
      el.hidden = true;
      await api('setMeta', { key: 'tutorialSelesai', value: true });
    };
    el.querySelector('#tut-next').onclick = () => { if (i < TUTORIAL.length - 1) { i++; draw(); } else done(); };
    el.querySelector('#tut-back').onclick = () => { if (i > 0) { i--; draw(); } };
    el.querySelector('#tut-skip').onclick = done;
    let x0 = null;
    el.ontouchstart = (e) => { x0 = e.touches[0].clientX; };
    el.ontouchend = (e) => {
      if (x0 === null) return;
      const dx = e.changedTouches[0].clientX - x0;
      x0 = null;
      if (dx < -50 && i < TUTORIAL.length - 1) { i++; draw(); }
      if (dx > 50 && i > 0) { i--; draw(); }
    };
    draw();
    el.hidden = false;
  }

  // ---------- Cadangan ke Google Sheets ----------

  const GTOKEN_KEY = 'hb_gtoken';     // izin Google Sheets sementara (±1 jam), hanya di sesi browser ini
  const GPENDING_KEY = 'hb_gpending'; // aksi yang menunggu izin: { state, action }

  function sheetsToken() {
    try {
      const t = JSON.parse(sessionStorage.getItem(GTOKEN_KEY));
      const me = session();
      if (t && t.exp > Date.now() + 60000 && me && t.email === me.email) return t.token;
    } catch (e) { /* abaikan */ }
    return null;
  }

  /** Pastikan ada izin Google Sheets; kalau belum, pindah ke halaman izin Google lalu lanjut otomatis. */
  function withSheets(action) {
    const token = sheetsToken();
    if (token) return runSheetsAction(action, token);
    const st = 'gs.' + randomStr();
    localStorage.setItem(GPENDING_KEY, JSON.stringify({ state: st, action }));
    location.href = window.HBSheets.authUrl({ clientId: CLIENT_ID, redirect: appUrl(), state: st, email: session().email });
  }

  /** Dipanggil saat Google mengembalikan pengguna dengan #access_token=... */
  async function finishSheetsAuth() {
    const p = new URLSearchParams(location.hash.slice(1));
    history.replaceState(null, '', appUrl());
    let pending = null;
    try { pending = JSON.parse(localStorage.getItem(GPENDING_KEY)); } catch (e) { /* abaikan */ }
    localStorage.removeItem(GPENDING_KEY);
    await showApp();
    if (!pending || p.get('state') !== pending.state) { toast('Izin Google tidak valid. Coba lagi.'); return; }
    if (p.get('error') || !p.get('access_token')) {
      toast(p.get('error') === 'access_denied' ? 'Izin Google Sheets dibatalkan.' : 'Izin Google gagal: ' + (p.get('error') || '-'), 5000);
      return;
    }
    if (!/drive\.file/.test(p.get('scope') || '')) {
      toast('Centang izin Google Drive supaya cadangan bisa dibuat. Coba lagi.', 6000);
      return;
    }
    const token = p.get('access_token');
    sessionStorage.setItem(GTOKEN_KEY, JSON.stringify({ token, email: session().email, exp: Date.now() + Number(p.get('expires_in') || 3600) * 1000 }));
    setTab('settings');
    runSheetsAction(pending.action, token);
  }

  async function runSheetsAction(action, token) {
    try {
      if (action === 'backup') await sheetsBackup(token);
      else if (action === 'restore') await sheetsRestore(token);
    } catch (e) {
      if (e.code === 'auth') sessionStorage.removeItem(GTOKEN_KEY);
      toast(e.message, 6000);
    }
  }

  async function sheetsBackup(token) {
    const me = session();
    const knownId = await api('getMeta', { key: 'sheetsId' });
    const r = await withBusy('Menyimpan ke Google Sheets…', () => window.HBSheets.backup(token, window.HBStore.snapshot(),
      { dibuat: new Date().toISOString(), akun: me ? me.email : '' }, knownId));
    await api('setMeta', { key: 'sheetsId', value: r.id });
    META.sheetsId = r.id;
    META.lastBackup = new Date().toISOString();
    await api('setMeta', { key: 'lastBackup', value: META.lastBackup });
    await api('setMeta', { key: 'lastSheetsBackup', value: META.lastBackup });
    META.lastSheetsBackup = META.lastBackup;
    render();
    openSheet('<h3>Tersimpan di Google Sheets ✅</h3><p>' + window.HBStore.snapshot().transactions.length + ' transaksi sudah dicadangkan ke Google Drive Anda.</p>' +
      '<p class="transcript">Cadangan berikutnya akan memperbarui spreadsheet yang sama.</p>' +
      '<div class="btn-row"><button class="btn" id="gs-close">Tutup</button><a class="btn primary" id="gs-open" href="' + esc(r.url) +
      '" target="_blank" rel="noopener" style="text-align:center;text-decoration:none">Buka spreadsheet</a></div>', (el) => {
      el.querySelector('#gs-close').onclick = closeSheet;
    });
  }

  async function sheetsRestore(token) {
    const file = await withBusy('Mencari cadangan di Google Drive…', () => window.HBSheets.findLatest(token));
    if (!file) { toast('Belum ada cadangan Google Sheets dari aplikasi ini di akun Google Anda.', 5000); return; }
    const data = await withBusy('Membaca cadangan…', () => window.HBSheets.read(token, file.id));
    const when = fmtDateTime(file.modifiedTime);
    if (!(await confirmBox('Pulihkan dari "' + file.name + '" (diperbarui ' + when + ', ' + data.transactions.length +
      ' transaksi)? Data yang sekarang ada di HP ini akan diganti.', 'Pulihkan'))) return;
    const r = await api('replaceAll', { data });
    await api('setMeta', { key: 'sheetsId', value: file.id });
    META.sheetsId = file.id;
    S.newIds.clear(); S.transkrip = '';
    await refresh();
    toast('Berhasil dipulihkan dari Google Sheets: ' + r.transaksi + ' transaksi');
  }

  /** Pilihan cadangan dari banner pengingat. */
  function chooseBackup() {
    openSheet('<h3>Simpan cadangan ke…</h3><div class="list">' +
      (DEMO ? '' : '<button class="list-item" id="cb-sheets"><span>🟩 Google Sheets <small>(di Google Drive Anda)</small></span><small>›</small></button>') +
      '<button class="list-item" id="cb-excel"><span>💾 File Excel <small>(simpan di HP / kirim ke WA)</small></span><small>›</small></button></div>' +
      '<div class="btn-row"><button class="btn" id="cb-close">Batal</button></div>', (el) => {
      el.querySelector('#cb-close').onclick = closeSheet;
      el.querySelector('#cb-excel').onclick = () => { closeSheet(); makeBackup(); };
      if (!DEMO) el.querySelector('#cb-sheets').onclick = () => { closeSheet(); withSheets('backup'); };
    });
  }

  // ---------- Data di HP: cadangan, pulihkan, laporan, pindahan ----------

  const BACKUP_EVERY_DAYS = 7;
  const META = {};   // salinan meta dari penyimpanan HP (lastBackup, migrasiDicek)

  async function loadMeta() {
    META.lastBackup = await api('getMeta', { key: 'lastBackup' });
    META.migrasiDicek = await api('getMeta', { key: 'migrasiDicek' });
    META.tutorialSelesai = await api('getMeta', { key: 'tutorialSelesai' });
    META.sheetsId = await api('getMeta', { key: 'sheetsId' });
    META.lastSheetsBackup = await api('getMeta', { key: 'lastSheetsBackup' });
  }

  function daysSince(iso) {
    if (!iso) return Infinity;
    return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  }
  function fmtDateTime(iso) {
    return new Date(iso).toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function fileStamp() { return todayStr(); }

  function renderBackupBanner() {
    const b = $('backup-banner');
    const due = S.transactions.length > 0 && daysSince(META.lastBackup) >= BACKUP_EVERY_DAYS;
    b.hidden = !due;
    if (due) {
      b.innerHTML = '<span>💾 ' + (META.lastBackup ? 'Sudah ' + daysSince(META.lastBackup) + ' hari belum simpan cadangan.'
        : 'Data hanya ada di HP ini. Simpan cadangan supaya aman.') + '</span><button data-backup-now>Simpan</button>';
    }
  }

  function renderDataInfo() {
    $('s-data-info').innerHTML = '<span>📱 Data tersimpan di HP ini<br><small>' + S.transactions.length + ' transaksi · ' +
      (META.lastBackup ? 'cadangan terakhir ' + esc(fmtDateTime(META.lastBackup)) : 'belum pernah dicadangkan') +
      (META.sheetsId ? '<br><a href="https://docs.google.com/spreadsheets/d/' + esc(META.sheetsId) + '" target="_blank" rel="noopener">Buka cadangan Google Sheets</a>' : '') +
      '</small></span>';
    $('btn-sheets-backup').hidden = DEMO;
    $('btn-sheets-restore').hidden = DEMO;
  }

  /**
   * Tawarkan file ke pengguna. Dibuat dua langkah (siapkan, lalu ketuk "Simpan / Bagikan") karena
   * iPhone hanya mengizinkan menu bagikan langsung dari ketukan pengguna.
   */
  function offerFile(blob, filename, title) {
    const file = new File([blob], filename, { type: blob.type });
    openSheet('<h3>' + esc(title) + '</h3><p>' + esc(filename) + ' · ' + Math.max(1, Math.round(blob.size / 1024)) + ' KB</p>' +
      '<p class="transcript">Di iPhone pilih "Simpan ke File" atau kirim lewat WhatsApp/email.</p>' +
      '<div class="btn-row"><button class="btn" id="of-close">Tutup</button><button class="btn primary" id="of-go">Simpan / Bagikan</button></div>', (el) => {
      el.querySelector('#of-close').onclick = closeSheet;
      el.querySelector('#of-go').onclick = async () => {
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          try {
            await navigator.share({ files: [file], title });
            closeSheet();
            return true;
          } catch (e) {
            if (e.name === 'AbortError') return false;
          }
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        closeSheet();
        return true;
      };
    });
  }

  async function withBusy(label, fn) {
    toast(label, 20000);
    try { return await fn(); } finally { $('toast').hidden = true; }
  }

  async function makeBackup() {
    try {
      const me = session();
      const blob = await withBusy('Menyiapkan cadangan…', () => window.HBExport.backupXlsx(window.HBStore.snapshot(),
        { dibuat: new Date().toISOString(), akun: me ? me.email : '' }));
      offerFile(blob, 'habisberapa-cadangan-' + fileStamp() + '.xlsx', 'Cadangan siap');
      // Dianggap sudah dicadangkan begitu file dibuat.
      META.lastBackup = new Date().toISOString();
      await api('setMeta', { key: 'lastBackup', value: META.lastBackup });
      render();
    } catch (e) {
      toast(e.message, 5000);
    }
  }

  async function restoreBackup(file) {
    let data;
    try {
      data = await withBusy('Membaca file…', async () => window.HBExport.readBackup(await file.arrayBuffer()));
    } catch (e) {
      toast(e.message, 6000);
      return;
    }
    const msg = 'Ganti semua data di HP ini dengan isi cadangan? (' + data.transactions.length + ' transaksi, ' +
      data.wallets.filter((w) => !String(w.arsip)).length + ' dompet). Data yang sekarang akan terhapus.';
    if (!(await confirmBox(msg, 'Pulihkan'))) return;
    try {
      const r = await api('replaceAll', { data });
      S.newIds.clear(); S.transkrip = '';
      await refresh();
      toast('Berhasil dipulihkan: ' + r.transaksi + ' transaksi');
    } catch (e) {
      toast(e.message, 6000);
    }
  }

  /** Data lama dari Google Sheets (versi sebelum data disimpan di HP). */
  async function migrateFromSheets(auto) {
    let legacy;
    try {
      legacy = await withBusy('Mengambil data dari Google Sheets…', () => api('legacyState'));
    } catch (e) {
      if (!auto) toast(e.message, 5000);
      return;
    }
    await api('setMeta', { key: 'migrasiDicek', value: true });
    META.migrasiDicek = true;
    if (!legacy || !legacy.transactions.length) {
      if (!auto) toast('Tidak ada data lama di Google Sheets untuk akun ini.');
      return;
    }
    const replace = S.transactions.length > 0;
    const msg = 'Ada ' + legacy.transactions.length + ' transaksi lama di Google Sheets. Pindahkan ke HP ini?' +
      (replace ? ' Data yang sekarang ada di HP ini akan diganti.' : '');
    if (!(await confirmBox(msg, 'Pindahkan'))) return;
    try {
      const r = await api('replaceAll', { data: legacy });
      await refresh();
      toast(r.transaksi + ' transaksi dipindahkan ke HP ini. Jangan lupa simpan cadangan.', 5000);
    } catch (e) {
      toast(e.message, 6000);
    }
  }

  async function offerMigrationOnce() {
    if (!META.migrasiDicek && !S.transactions.length) migrateFromSheets(true);
  }

  /** Susun isi laporan bulan yang sedang dilihat di halaman Laporan. */
  function buildReport() {
    const m = S.reportMonth;
    const me = session();
    const cw = computed().filter((w) => !w.arsip);
    const statusText = { aman: 'Aman', menipis: 'Hampir habis', habis: 'Habis', kosong: 'Belum diisi' };
    const cp = L.cashPosition(S.transactions, m, m === thisMonth() ? todayStr() : null);
    const pts = cp.days.filter((d) => d.persen !== null);
    const last = pts[pts.length - 1];
    return {
      bulan: fmtMonth(m),
      akun: me ? (me.nama ? me.nama + ' (' + me.email + ')' : me.email) : '',
      dibuat: new Date().toLocaleString('id-ID'),
      ringkasan: L.monthSummary(S.transactions, m),
      totalSaldo: cw.reduce((s, w) => s + w.saldo, 0),
      posisiKas: last ? { persen: pct(last.persen), label: ZONES[L.cashZone(last.persen)].label } : null,
      dompet: activeWallets().map((w0) => { const w = cw.find((x) => x.id === w0.id); return { nama: w.nama, saldo: w.saldo, status: statusText[w.status] }; }),
      kategori: L.categoryReport(S.transactions, m).rows,
      transaksi: L.sortTx(S.transactions).filter((t) => L.monthOf(t.tanggal) === m).map((t) => ({
        tanggal: t.tanggal, jenis: t.jenis, keterangan: t.keterangan || t.kategori, kategori: t.kategori,
        dompet: walletName(t.dompet_id), tujuan: t.jenis === 'pindah' ? walletName(t.dompet_tujuan_id) : '', nominal: t.nominal })),
    };
  }

  async function exportReport(kind) {
    try {
      const rep = buildReport();
      const name = 'habisberapa-laporan-' + S.reportMonth + (kind === 'pdf' ? '.pdf' : '.xlsx');
      const blob = await withBusy('Menyiapkan laporan…', () =>
        kind === 'pdf' ? window.HBExport.reportPdf(rep, rp) : window.HBExport.reportXlsx(rep));
      offerFile(blob, name, 'Laporan ' + rep.bulan + ' siap');
    } catch (e) {
      toast(e.message, 5000);
    }
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
    $('btn-backup').onclick = makeBackup;
    $('btn-restore').onclick = () => $('restore-file').click();
    $('restore-file').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) restoreBackup(f); };
    $('btn-migrate').onclick = () => migrateFromSheets(false);
    $('btn-report-pdf').onclick = () => exportReport('pdf');
    $('btn-report-xlsx').onclick = () => exportReport('xlsx');
    $('backup-banner').onclick = (e) => { if (e.target.closest('[data-backup-now]')) chooseBackup(); };
    $('btn-sheets-backup').onclick = () => withSheets('backup');
    $('btn-sheets-restore').onclick = () => withSheets('restore');
    $('btn-tutorial').onclick = showTutorial;
    $('cmp-seg').onclick = (e) => { const b = e.target.closest('[data-n]'); if (b) { S.compareN = Number(b.dataset.n); renderCompare(); } };
    $('btn-logout').onclick = async () => {
      if (await confirmBox('Keluar dari akun ini di HP ini?', 'Keluar')) logout();
    };
    $('btn-login').onclick = startLogin;
    $('btn-feedback').onclick = sendFeedback;
    $('btn-stats').onclick = showStats;
    $('btn-reset-data').onclick = async () => {
      if (!(await confirmBox('Hapus SEMUA transaksi, dompet & kategori di HP ini? Simpan cadangan dulu kalau masih dibutuhkan. Tindakan ini tidak bisa dibatalkan.', 'Hapus semua'))) return;
      await window.HBStore.reset(); S.newIds.clear(); S.transkrip = '';
      await refresh();
      toast('Semua data di HP ini sudah dihapus');
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

    // Grafik menyesuaikan lebar layar (mis. HP diputar)
    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { if (S.tab === 'report') renderCash(); }, 150);
    });

    // Muat ulang data saat aplikasi dibuka kembali
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !$('app').hidden) refresh(true);
    });
  }

  // ---------- Mulai ----------

  bind();
  if (DEMO) showApp();
  else if (session() && (location.hash.indexOf('access_token=') >= 0 ||
    (location.hash.indexOf('state=gs.') >= 0 && location.hash.indexOf('error=') >= 0))) finishSheetsAuth();
  else if (location.hash.indexOf('id_token=') >= 0 || location.hash.indexOf('error=') >= 0) finishLogin();
  else if (session()) showApp();
  else logout();

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
