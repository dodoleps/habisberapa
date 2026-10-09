/* Perhitungan murni (tanpa tampilan): saldo dompet, ringkasan, laporan, dan parser mode demo. */
(function (root) {
  const UTAMA_ID = 'utama';
  const KATEGORI_PINDAH = 'Pindah dana';
  const KATEGORI_SALDO_AWAL = 'Saldo awal'; // sisa uang yang dibawa saat mulai pencatatan baru
  const MENIPIS = 0.2; // dompet "mendekati habis" jika sisa <= 20% dari jumlah setelah pengisian terakhir

  function sortTx(txs) {
    return txs.slice().sort((a, b) =>
      a.tanggal === b.tanggal ? String(a.dibuat).localeCompare(String(b.dibuat)) : a.tanggal.localeCompare(b.tanggal));
  }

  /** Hitung saldo, acuan (jumlah setelah pengisian terakhir), dan status warna tiap dompet. */
  function computeWallets(wallets, txs) {
    const map = {};
    wallets.forEach((w) => { map[w.id] = { ...w, saldo: 0, acuan: 0, pernahDiisi: false }; });
    const get = (id) => map[id] || (map[id] = { id, nama: '(dompet terhapus)', arsip: '1', saldo: 0, acuan: 0 });
    sortTx(txs).forEach((t) => {
      const n = Number(t.nominal) || 0;
      if (t.jenis === 'keluar') {
        get(t.dompet_id).saldo -= n;
      } else if (t.jenis === 'masuk') {
        const w = get(t.dompet_id);
        w.saldo += n; w.acuan = w.saldo; w.pernahDiisi = true;
      } else if (t.jenis === 'pindah') {
        get(t.dompet_id).saldo -= n;
        const w = get(t.dompet_tujuan_id);
        w.saldo += n; w.acuan = w.saldo; w.pernahDiisi = true;
      }
    });
    return Object.values(map).map((w) => {
      let status = 'aman';
      if (w.saldo < 0 || (w.saldo === 0 && w.pernahDiisi)) status = 'habis';
      else if (w.saldo === 0) status = 'kosong';
      else if (w.acuan > 0 && w.saldo <= w.acuan * MENIPIS) status = 'menipis';
      const persen = w.acuan > 0 ? Math.max(0, Math.min(1, w.saldo / w.acuan)) : (w.saldo > 0 ? 1 : 0);
      return { ...w, status, persen };
    });
  }

  function monthOf(tanggal) { return String(tanggal).slice(0, 7); }

  /** Total masuk & keluar dalam satu bulan (pindah antar dompet dan saldo awal tidak dihitung). */
  function monthSummary(txs, bulan) {
    let masuk = 0, keluar = 0;
    txs.forEach((t) => {
      if (monthOf(t.tanggal) !== bulan) return;
      if (t.jenis === 'masuk' && t.kategori !== KATEGORI_SALDO_AWAL) masuk += Number(t.nominal);
      if (t.jenis === 'keluar') keluar += Number(t.nominal);
    });
    return { masuk, keluar, selisih: masuk - keluar };
  }

  /**
   * Pencapaian hemat satu bulan: sisa = pemasukan − pengeluaran bulan itu.
   * null kalau bulan itu tidak ada pemasukan atau tidak ada sisa.
   */
  function monthAchievement(txs, bulan) {
    const s = monthSummary(txs, bulan);
    if (!(s.masuk > 0) || !(s.selisih > 0)) return null;
    return { bulan, masuk: s.masuk, keluar: s.keluar, sisa: s.selisih, persen: s.selisih / s.masuk };
  }

  /**
   * Transaksi "Saldo awal" untuk mulai pencatatan baru sambil membawa sisa uang tiap dompet.
   * Sisa di dompet yang sudah dihapus masuk ke dompet utama; saldo minus tidak dibawa.
   */
  function openingBalances(wallets, txs, tanggal) {
    const sisa = {};
    computeWallets(wallets, txs).forEach((w) => {
      if (!(w.saldo > 0)) return;
      const id = w.arsip ? UTAMA_ID : w.id;
      sisa[id] = (sisa[id] || 0) + w.saldo;
    });
    return Object.keys(sisa).map((id) => ({ tanggal, jenis: 'masuk', nominal: sisa[id], kategori: KATEGORI_SALDO_AWAL,
      dompet_id: id, dompet_tujuan_id: '', keterangan: 'Sisa saldo saat mulai pencatatan baru' }));
  }

  /** Pengeluaran per kategori dalam satu bulan, urut terbesar. */
  function categoryReport(txs, bulan) {
    const sums = {};
    let total = 0;
    txs.forEach((t) => {
      if (t.jenis !== 'keluar' || monthOf(t.tanggal) !== bulan) return;
      sums[t.kategori] = (sums[t.kategori] || 0) + Number(t.nominal);
      total += Number(t.nominal);
    });
    const rows = Object.keys(sums).map((k) => ({ kategori: k, total: sums[k], persen: total ? sums[k] / total : 0 }));
    rows.sort((a, b) => b.total - a.total);
    return { total, rows };
  }

  /**
   * Posisi kas harian dalam satu bulan.
   * persen = saldo semua dompet di akhir hari ÷ uang tersedia bulan itu
   * (saldo awal bulan + pemasukan bulan itu sampai hari tersebut). Pindah antar dompet tidak berpengaruh.
   * sampai: tanggal terakhir yang dihitung (YYYY-MM-DD), mis. hari ini untuk bulan berjalan.
   */
  function cashPosition(txs, bulan, sampai) {
    const [y, m] = bulan.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    let saldo = 0;
    const perDay = {};
    txs.forEach((t) => {
      const n = Number(t.nominal) || 0;
      const delta = t.jenis === 'masuk' ? n : t.jenis === 'keluar' ? -n : 0;
      if (t.tanggal < bulan + '-01') { saldo += delta; return; }
      if (monthOf(t.tanggal) !== bulan) return;
      const d = perDay[t.tanggal] || (perDay[t.tanggal] = { masuk: 0, keluar: 0 });
      if (t.jenis === 'masuk') d.masuk += n;
      if (t.jenis === 'keluar') d.keluar += n;
    });
    const saldoAwal = saldo;
    let tersedia = saldoAwal;
    const out = [];
    for (let day = 1; day <= lastDay; day++) {
      const tanggal = bulan + '-' + String(day).padStart(2, '0');
      if (sampai && tanggal > sampai) break;
      const d = perDay[tanggal] || { masuk: 0, keluar: 0 };
      saldo += d.masuk - d.keluar;
      tersedia += d.masuk;
      const persen = tersedia > 0 ? Math.max(0, Math.min(1, saldo / tersedia)) : null;
      out.push({ tanggal, saldo, tersedia, masuk: d.masuk, keluar: d.keluar, persen });
    }
    return { saldoAwal, days: out };
  }

  /** Zona posisi kas: 'hijau' (> 75%), 'kuning' (50–75%), 'oranye' (25–50%), 'merah' (< 25%). */
  const CASH_LEVELS = [0.75, 0.5, 0.25];
  function cashZone(persen) {
    if (persen > 0.75) return 'hijau';
    if (persen >= 0.5) return 'kuning';
    if (persen >= 0.25) return 'oranye';
    return 'merah';
  }

  function shiftMonth(ym, delta) {
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  /**
   * Bandingkan pengeluaran bulan `bulan` dengan `n` bulan sebelumnya (n = 1..3).
   * Bulan sebelum transaksi pertama pengguna tidak ikut dihitung (ditandai adaData: false).
   * Hasil: { bulan: [{ bulan, keluar, adaData, kategori: {nama: total} }...] (lama -> baru), dibanding (jumlah bulan yang dihitung),
   *          rataSebelum, selisih (bulan ini - rata-rata), persen (selisih ÷ rata-rata, null kalau rata-rata 0),
   *          kategori: [{ kategori, ini, rata, selisih }] urut dari yang terbesar }.
   */
  function compareMonths(txs, bulan, n) {
    const months = [];
    for (let i = n; i >= 0; i--) months.push(shiftMonth(bulan, -i));
    const first = txs.reduce((m, t) => (t.tanggal && (!m || t.tanggal < m) ? t.tanggal : m), '');
    const firstMonth = first ? monthOf(first) : bulan;
    const data = months.map((b) => ({ bulan: b, keluar: 0, kategori: {}, adaData: b >= firstMonth }));
    const idx = Object.fromEntries(months.map((b, i) => [b, i]));
    txs.forEach((t) => {
      if (t.jenis !== 'keluar') return;
      const i = idx[monthOf(t.tanggal)];
      if (i === undefined) return;
      const v = Number(t.nominal) || 0;
      data[i].keluar += v;
      data[i].kategori[t.kategori] = (data[i].kategori[t.kategori] || 0) + v;
    });
    const sekarang = data[data.length - 1];
    const sebelum = data.slice(0, -1).filter((d) => d.adaData);
    const rataSebelum = sebelum.length ? sebelum.reduce((s, d) => s + d.keluar, 0) / sebelum.length : 0;
    const names = new Set();
    data.forEach((d) => Object.keys(d.kategori).forEach((k) => names.add(k)));
    const kategori = Array.from(names).map((k) => {
      const ini = sekarang.kategori[k] || 0;
      const rata = sebelum.length ? sebelum.reduce((s, d) => s + (d.kategori[k] || 0), 0) / sebelum.length : 0;
      return { kategori: k, ini, rata, selisih: ini - rata };
    }).sort((a, b) => Math.max(b.ini, b.rata) - Math.max(a.ini, a.rata));
    const selisih = sekarang.keluar - rataSebelum;
    return { bulan: data, dibanding: sebelum.length, rataSebelum, selisih,
      persen: sebelum.length && rataSebelum > 0 ? selisih / rataSebelum : null, kategori };
  }

  // ---------- Merapikan transaksi & hasil AI ----------

  /** Rapikan & periksa satu transaksi. Melempar Error kalau tidak valid. */
  function cleanTx(tx, today) {
    const jenis = ['keluar', 'masuk', 'pindah'].indexOf(tx.jenis) >= 0 ? tx.jenis : 'keluar';
    const nominal = Math.round(Number(tx.nominal));
    if (!(nominal > 0)) throw new Error('Nominal harus lebih dari 0');
    const out = {
      ...tx,
      jenis,
      nominal,
      tanggal: /^\d{4}-\d{2}-\d{2}$/.test(tx.tanggal || '') ? tx.tanggal : today,
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

  /**
   * Ubah jawaban AI ({ transkrip, transaksi: [{ jenis, nominal, kategori, dompet, dompet_tujuan, ... }] })
   * menjadi transaksi siap simpan: nama dompet -> id, kategori harus ada di daftar. Item yang tidak valid dibuang.
   */
  function mapAiResult(result, wallets, categories, opts) {
    const active = wallets.filter((w) => !w.arsip);
    const findWallet = (nama) => {
      const n = String(nama || '').trim().toLowerCase();
      const w = active.find((x) => x.nama.toLowerCase() === n);
      return w ? w.id : '';
    };
    const out = [];
    (result.transaksi || []).forEach((t) => {
      const jenis = t.jenis;
      let kategori = String(t.kategori || '');
      if (jenis !== 'pindah') {
        const match = categories.find((c) => c.jenis === jenis && c.nama.toLowerCase() === kategori.toLowerCase());
        kategori = match ? match.nama : 'Lainnya';
      }
      try {
        out.push(cleanTx({
          tanggal: t.tanggal, jenis, nominal: t.nominal, kategori,
          dompet_id: findWallet(t.dompet) || UTAMA_ID,
          dompet_tujuan_id: jenis === 'pindah' ? findWallet(t.dompet_tujuan) : '',
          keterangan: t.keterangan, sumber: opts.sumber, transkrip: opts.transkrip,
        }, opts.today));
      } catch (e) { /* lewati item yang tidak valid */ }
    });
    return out;
  }

  // ---------- Parser sederhana untuk MODE DEMO (tanpa AI) ----------

  const SLANG = { gopek: 500, seceng: 1000, goceng: 5000, ceban: 10000, gocap: 50000, cepek: 100000 };
  const KATA_KATEGORI = [
    ['Makan & Minum', /makan|minum|kopi|bakso|nasi|sarapan|jajan|snack|gofood|warung|teh|mie/],
    ['Transportasi', /parkir|bensin|ojek|gojek|grab|tol|bus|kereta|krl|taksi|angkot|pertalite|pertamax/],
    ['Tagihan', /listrik|pulsa|internet|wifi|pln|pdam|tagihan|cicilan|kos|sewa|kuota/],
    ['Kesehatan', /obat|dokter|apotek|vitamin|klinik|rumah sakit/],
    ['Hiburan', /nonton|film|game|netflix|spotify|liburan|karaoke/],
    ['Belanja', /belanja|beli|baju|sepatu|sabun|indomaret|alfamart|shopee|tokopedia/],
    ['Keluarga', /anak|ortu|orang tua|ibu|ayah|istri|suami|keluarga/],
  ];

  function parseAmount(s) {
    for (const k in SLANG) if (new RegExp('\\b' + k + '\\b').test(s)) return SLANG[k];
    const m = s.match(/(\d+(?:[.,]\d+)*)\s*(ribu|rebu|rb|k|juta|jt)?\b/);
    if (!m) return 0;
    let num = m[1];
    const unit = m[2];
    if (unit) num = num.replace(',', '.');
    else num = num.replace(/[.,]/g, '');
    let v = parseFloat(num);
    if (/ribu|rebu|rb|k/.test(unit || '')) v *= 1000;
    if (/juta|jt/.test(unit || '')) v *= 1000000;
    return Math.round(v);
  }

  function findWalletIn(text, wallets) {
    // Nama terpanjang dulu, supaya "uang makan" tidak kalah oleh "makan".
    const sorted = wallets.filter((w) => !w.arsip).slice().sort((a, b) => b.nama.length - a.nama.length);
    return sorted.find((w) => text.indexOf(w.nama.toLowerCase()) >= 0);
  }

  function guessWalletForCategory(kategori, keterangan, wallets) {
    const kata = (kategori + ' ' + keterangan).toLowerCase().split(/[^a-z]+/).filter((k) => k.length > 3);
    const w = wallets.find((x) => !x.arsip && x.id !== UTAMA_ID && kata.some((k) => x.nama.toLowerCase().indexOf(k) >= 0));
    return w ? w.id : UTAMA_ID;
  }

  /** Ubah kalimat ketikan menjadi transaksi (perkiraan sederhana, hanya untuk mode demo). */
  function parseDemo(text, wallets, categories, today) {
    const s = String(text).toLowerCase();
    const pindah = s.match(/(?:pindah(?:kan)?|isi|sisihkan|nabung|transfer)\s+(.+?)\s+(?:dari\s+(?:dompet\s+)?(.+?)\s+)?ke\s+(?:dompet\s+)?(.+)/);
    if (pindah) {
      const asal = pindah[2] ? findWalletIn(pindah[2], wallets) : null;
      const tujuan = findWalletIn(pindah[3], wallets);
      const n = parseAmount(pindah[1]);
      if (tujuan && n > 0) {
        return [{ tanggal: today, jenis: 'pindah', nominal: n, kategori: 'Pindah dana',
          dompet_id: asal ? asal.id : UTAMA_ID, dompet_tujuan_id: tujuan.id, keterangan: 'Isi dompet ' + tujuan.nama }];
      }
    }
    // "ambil dari dompet X" / "pakai X" berlaku untuk seluruh kalimat
    let dompetDisebut = null;
    const sumber = s.match(/(?:ambil\s+)?(?:dari|pakai)\s+(?:dompet\s+)?(.+)$/);
    let body = s;
    if (sumber) {
      dompetDisebut = findWalletIn(sumber[1], wallets);
      if (dompetDisebut) body = s.slice(0, sumber.index);
    }
    const pieces = body.split(/,|\bsama\b|\bdan\b|\bterus\b|\blalu\b|\+/).map((p) => p.trim()).filter(Boolean);
    const out = [];
    pieces.forEach((p) => {
      const n = parseAmount(p);
      if (!(n > 0)) return;
      const masuk = /gaji|gajian|bonus|terima|dapat|dikasih|dibayar|thr|pemasukan/.test(p);
      const jenis = masuk ? 'masuk' : 'keluar';
      let kategori = 'Lainnya';
      if (masuk) kategori = /gaji|gajian/.test(p) ? 'Gaji' : (/bonus|thr/.test(p) ? 'Bonus' : 'Lainnya');
      else {
        const hit = KATA_KATEGORI.find(([, re]) => re.test(p));
        if (hit) kategori = hit[0];
      }
      if (!categories.some((c) => c.nama === kategori && c.jenis === jenis)) kategori = 'Lainnya';
      let ket = p.replace(/(\d+(?:[.,]\d+)*)\s*(ribu|rebu|rb|k|juta|jt)?\b/, '')
        .replace(/\b(tadi|habis|abis|buat|untuk|bayar|seharga|harganya)\b/g, '').replace(/\s+/g, ' ').trim();
      for (const k in SLANG) ket = ket.replace(new RegExp('\\b' + k + '\\b'), '').trim();
      ket = ket ? ket.charAt(0).toUpperCase() + ket.slice(1) : kategori;
      const dompet_id = masuk ? (dompetDisebut ? dompetDisebut.id : UTAMA_ID)
        : (dompetDisebut ? dompetDisebut.id : guessWalletForCategory(kategori, ket, wallets));
      out.push({ tanggal: today, jenis, nominal: n, kategori, dompet_id, dompet_tujuan_id: '', keterangan: ket });
    });
    return out;
  }

  const api = { UTAMA_ID, KATEGORI_PINDAH, KATEGORI_SALDO_AWAL, computeWallets, monthSummary, monthAchievement, openingBalances, categoryReport, cashPosition, cashZone, CASH_LEVELS,
    cleanTx, mapAiResult, compareMonths, shiftMonth, parseDemo, parseAmount, sortTx, monthOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HBLogic = api;
})(this);
