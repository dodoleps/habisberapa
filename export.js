/*
 * Ekspor & impor: file cadangan (Excel, bisa dipulihkan) dan laporan bulanan (Excel & PDF).
 * Pustaka Excel/PDF baru diunduh saat pertama kali dipakai, supaya aplikasi tetap ringan.
 */
(function (root) {
  const LIBS = {
    xlsx: ['https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'],
    pdf: ['https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
      'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js'],
  };
  const loaded = {};

  function loadScript(url) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = url;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Gagal mengunduh pustaka ekspor. Periksa koneksi internet.'));
      document.head.appendChild(s);
    });
  }
  function load(name) {
    if (!loaded[name]) {
      loaded[name] = LIBS[name].reduce((p, url) => p.then(() => loadScript(url)), Promise.resolve())
        .catch((e) => { delete loaded[name]; throw e; });
    }
    return loaded[name];
  }

  const TX_COLS = ['id', 'tanggal', 'jenis', 'nominal', 'kategori', 'dompet_id', 'dompet_tujuan_id',
    'keterangan', 'sumber', 'transkrip', 'dibuat'];
  const WALLET_COLS = ['id', 'nama', 'urutan', 'arsip', 'dibuat', 'warna'];
  const CAT_COLS = ['nama', 'jenis'];
  const RP = '"Rp"#,##0;-"Rp"#,##0';

  const rows = (list, cols) => list.map((o) => {
    const r = {};
    cols.forEach((c) => { r[c] = c === 'nominal' ? Number(o[c]) || 0 : (o[c] == null ? '' : String(o[c])); });
    return r;
  });
  const toBlob = (wb) => new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })],
    { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

  /** File cadangan lengkap: bisa dibuka di Excel dan dipulihkan kembali ke aplikasi. */
  async function backupXlsx(snap, info) {
    await load('xlsx');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows(snap.transactions, TX_COLS), { header: TX_COLS }), 'Transaksi');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows(snap.wallets, WALLET_COLS), { header: WALLET_COLS }), 'Dompet');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows(snap.categories, CAT_COLS), { header: CAT_COLS }), 'Kategori');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['aplikasi', 'Habis Berapa'], ['format', 'cadangan-1'], ['dibuat', info.dibuat], ['akun', info.akun || ''],
      ['catatan', 'Jangan ubah nama lembar & kolom supaya file ini bisa dipulihkan.'],
    ]), 'Info');
    return toBlob(wb);
  }

  /** Baca file cadangan. Mengembalikan { wallets, categories, transactions }. */
  async function readBackup(arrayBuffer) {
    await load('xlsx');
    let wb;
    try { wb = XLSX.read(arrayBuffer, { type: 'array' }); } catch (e) { throw new Error('File tidak bisa dibaca. Pilih file cadangan .xlsx dari aplikasi ini.'); }
    const sheet = (name) => {
      const ws = wb.Sheets[name];
      if (!ws) throw new Error('Ini bukan file cadangan Habis Berapa (lembar "' + name + '" tidak ada).');
      return XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });
    };
    // Tanggal yang terlanjur diubah Excel menjadi angka dikembalikan ke format YYYY-MM-DD.
    const fixDate = (v) => {
      if (typeof v === 'number') {
        const d = XLSX.SSF.parse_date_code(v);
        return d.y + '-' + String(d.m).padStart(2, '0') + '-' + String(d.d).padStart(2, '0');
      }
      return String(v).trim();
    };
    const transactions = sheet('Transaksi').map((r) => ({ ...r, tanggal: fixDate(r.tanggal),
      nominal: Number(String(r.nominal).replace(/[^\d.-]/g, '')) || 0 }));
    return { wallets: sheet('Dompet'), categories: sheet('Kategori'), transactions };
  }

  /** Laporan bulanan dalam Excel (beberapa lembar, angka berformat Rupiah). */
  async function reportXlsx(rep) {
    await load('xlsx');
    const wb = XLSX.utils.book_new();
    const money = (ws, colLetters, from, to) => {
      for (let r = from; r <= to; r++) colLetters.forEach((c) => { const cell = ws[c + r]; if (cell && cell.t === 'n') cell.z = RP; });
    };
    const ring = XLSX.utils.aoa_to_sheet([
      ['Laporan Keuangan Habis Berapa'], [rep.bulan], [rep.akun ? 'Akun: ' + rep.akun : ''], [],
      ['Pemasukan', rep.ringkasan.masuk], ['Pengeluaran', rep.ringkasan.keluar], ['Selisih', rep.ringkasan.selisih],
      ['Total saldo semua dompet', rep.totalSaldo],
      ['Posisi kas', rep.posisiKas ? rep.posisiKas.persen + ' — ' + rep.posisiKas.label : '-'], [],
      ['Dibuat', rep.dibuat],
    ]);
    money(ring, ['B'], 5, 8);
    ring['!cols'] = [{ wch: 26 }, { wch: 22 }];
    XLSX.utils.book_append_sheet(wb, ring, 'Ringkasan');

    const dompet = XLSX.utils.aoa_to_sheet([['Dompet', 'Saldo', 'Status']].concat(rep.dompet.map((w) => [w.nama, w.saldo, w.status])));
    money(dompet, ['B'], 2, rep.dompet.length + 1);
    dompet['!cols'] = [{ wch: 24 }, { wch: 18 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, dompet, 'Dompet');

    const kat = XLSX.utils.aoa_to_sheet([['Kategori', 'Pengeluaran', 'Persen']].concat(rep.kategori.map((k) => [k.kategori, k.total, Math.round(k.persen * 100) + '%'])));
    money(kat, ['B'], 2, rep.kategori.length + 1);
    kat['!cols'] = [{ wch: 24 }, { wch: 18 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, kat, 'Per Kategori');

    const tx = XLSX.utils.aoa_to_sheet([['Tanggal', 'Jenis', 'Keterangan', 'Kategori', 'Dari dompet', 'Ke dompet', 'Nominal']]
      .concat(rep.transaksi.map((t) => [t.tanggal, t.jenis, t.keterangan, t.kategori, t.dompet, t.tujuan, t.nominal])));
    money(tx, ['G'], 2, rep.transaksi.length + 1);
    tx['!cols'] = [{ wch: 12 }, { wch: 9 }, { wch: 30 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, tx, 'Transaksi');
    return toBlob(wb);
  }

  /** Laporan bulanan dalam PDF (A4). */
  async function reportPdf(rep, rp) {
    await load('pdf');
    const doc = new root.jspdf.jsPDF({ unit: 'pt', format: 'a4' });
    const ink = [30, 42, 39], muted = [122, 133, 130], head = [221, 243, 234];
    const W = doc.internal.pageSize.getWidth();
    let y = 48;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.setTextColor(...ink);
    doc.text('Laporan Keuangan', 40, y);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(...muted);
    doc.text(rep.bulan + (rep.akun ? '  |  ' + rep.akun : ''), 40, y + 18);
    doc.text('Habis Berapa', W - 40, y, { align: 'right' });
    y += 40;

    const table = (title, headRow, body, opts) => {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(...ink);
      doc.text(title, 40, y);
      doc.autoTable(Object.assign({
        startY: y + 8, head: [headRow], body, margin: { left: 40, right: 40 }, theme: 'plain',
        styles: { fontSize: 9.5, cellPadding: 5, textColor: ink, lineColor: [236, 234, 228], lineWidth: { bottom: 0.5 } },
        headStyles: { fillColor: head, fontStyle: 'bold' },
        // Judul kolom angka ikut rata kanan, sejajar dengan isinya.
        didParseCell: (d) => {
          const cs = opts && opts.columnStyles && opts.columnStyles[d.column.index];
          if (d.section === 'head' && cs && cs.halign) d.cell.styles.halign = cs.halign;
        },
      }, opts || {}));
      y = doc.lastAutoTable.finalY + 24;
    };

    table('Ringkasan', ['', ''], [
      ['Pemasukan', rp(rep.ringkasan.masuk)], ['Pengeluaran', rp(rep.ringkasan.keluar)], ['Selisih', rp(rep.ringkasan.selisih)],
      ['Total saldo semua dompet', rp(rep.totalSaldo)],
      ['Posisi kas', rep.posisiKas ? rep.posisiKas.persen + ' - ' + rep.posisiKas.label : '-'],
    ], { showHead: false, columnStyles: { 1: { halign: 'right', fontStyle: 'bold' } } });
    table('Saldo dompet', ['Dompet', 'Status', 'Saldo'], rep.dompet.map((w) => [w.nama, w.status, rp(w.saldo)]),
      { columnStyles: { 2: { halign: 'right' } } });
    if (rep.kategori.length) {
      table('Pengeluaran per kategori', ['Kategori', 'Persen', 'Total'],
        rep.kategori.map((k) => [k.kategori, Math.round(k.persen * 100) + '%', rp(k.total)]),
        { columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } } });
    }
    table('Daftar transaksi', ['Tanggal', 'Keterangan', 'Kategori', 'Dompet', 'Nominal'],
      rep.transaksi.map((t) => [t.tanggal, t.keterangan, t.kategori, t.tujuan ? t.dompet + ' ke ' + t.tujuan : t.dompet,
        (t.jenis === 'masuk' ? '+' : t.jenis === 'keluar' ? '-' : '') + rp(t.nominal)]),
      { columnStyles: { 4: { halign: 'right' } } });

    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i); doc.setFontSize(8); doc.setTextColor(...muted);
      doc.text('Dibuat ' + rep.dibuat + '  |  halaman ' + i + ' dari ' + pages, 40, doc.internal.pageSize.getHeight() - 24);
    }
    return doc.output('blob');
  }

  root.HBExport = { backupXlsx, readBackup, reportXlsx, reportPdf };
})(this);
