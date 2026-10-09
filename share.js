/*
 * Kartu rekap bulanan & stiker pencapaian hemat untuk dibagikan ke story (ala stiker Strava).
 * Digambar di HP dengan <canvas> (1080×1920), tanpa server.
 *  - stiker transparan: hanya teks & grafik batang tembus pandang
 *  - gambar jadi: foto pengguna (atau latar pastel) + stiker
 */
(function (root) {
  const W = 1080, H = 1920;
  const FONT = '"Plus Jakarta Sans", -apple-system, "Segoe UI", Roboto, sans-serif';

  /** Kalimat lucu berdasarkan kata di keterangan (lebih spesifik) atau kategori. */
  const KEYWORDS = [
    [/kopi|coffee|starbucks|kopken|janji jiwa|fore|latte/i, '☕', 'Barista udah hafal namamu.'],
    [/gofood|grabfood|shopeefood|pesan antar/i, '🛵', 'Kurir makanan udah kayak teman sendiri.'],
    [/bensin|pertalite|pertamax|bbm|shell/i, '⛽', 'Tangki penuh, dompet yang kosong.'],
    [/gojek|grab|ojol|ojek|maxim/i, '🛵', 'Abang ojol udah kayak sopir pribadi.'],
    [/parkir/i, '🅿️', 'Tukang parkir: muncul tanpa diundang.'],
    [/shopee|tokopedia|tiktok shop|lazada|checkout/i, '🛍️', 'Checkout dulu, mikir belakangan.'],
    [/netflix|spotify|youtube|disney|langganan/i, '🎬', 'Langganan banyak, nontonnya dikit.'],
  ];
  const CATEGORY_LINES = {
    'Makan & Minum': ['🍜', 'Perut kenyang, dompet melayang.'],
    Transportasi: ['🛵', 'Jalan terus, saldonya yang berhenti.'],
    Belanja: ['🛍️', 'Checkout dulu, mikir belakangan.'],
    Tagihan: ['🧾', 'Tagihan: yang paling setia datang tiap bulan.'],
    Kesehatan: ['💊', 'Investasi terbaik: badan sehat.'],
    Hiburan: ['🎬', 'Healing itu perlu, katanya.'],
    Keluarga: ['👨‍👩‍👧', 'Buat keluarga, nggak ada kata rugi.'],
  };

  /** Pilih kalimat lucu untuk kategori teratas yang dipilih. */
  function funnyLine(top, keterangan) {
    if (!top) return '';
    const text = (keterangan || []).join(' ');
    const kw = KEYWORDS.find(([re]) => re.test(text));
    if (kw) return kw[1] + ' ' + kw[2];
    const c = CATEGORY_LINES[top.nama];
    return c ? c[0] + ' ' + c[1] : '💸 Habis ke mana? Rahasia.';
  }

  function short(n) {
    if (n >= 1e6) return 'Rp' + (n / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + ' jt';
    if (n >= 1e3) return 'Rp' + Math.round(n / 1e3).toLocaleString('id-ID') + ' rb';
    return 'Rp' + Math.round(n).toLocaleString('id-ID');
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /** Gambar stiker (tanpa latar) ke ctx. opts.dark = teks gelap untuk foto terang. */
  // Ukuran stiker: K mengecilkan semua huruf & batang (1 = ukuran awal). Lebar blok dibuat ramping
  // supaya foto pengguna lebih banyak terlihat.
  const K = 0.7, MARGIN = 150;

  function drawSticker(ctx, d, opts) {
    const ink = opts.dark ? '#14201c' : '#ffffff';
    const soft = opts.dark ? 'rgba(20,32,28,.62)' : 'rgba(255,255,255,.78)';
    const track = opts.dark ? 'rgba(20,32,28,.16)' : 'rgba(255,255,255,.28)';
    const fill = opts.dark ? 'rgba(20,32,28,.82)' : 'rgba(255,255,255,.92)';
    const px = (n) => Math.round(n * K);
    const font = (w, size) => w + ' ' + px(size) + 'px ' + FONT;
    ctx.save();
    ctx.shadowColor = opts.dark ? 'rgba(255,255,255,.35)' : 'rgba(0,0,0,.35)';
    ctx.shadowBlur = px(18);
    ctx.textBaseline = 'alphabetic';
    const X = MARGIN, R = W - MARGIN;
    const items = d.items.slice(0, 5);
    // Tinggi blok dihitung supaya stiker selalu menempel di bagian bawah.
    const rowH = px(132);
    const blockH = px(120) + px(190) + (d.line ? px(110) : px(20)) + items.length * rowH + px(150);
    let y = H - 140 - blockH;

    ctx.fillStyle = soft;
    ctx.font = font(700, 40);
    ctx.letterSpacing = px(6) + 'px';
    ctx.fillText(d.bulanLabel.toUpperCase(), X, y + px(40));
    ctx.letterSpacing = '0px';
    y += px(120);
    ctx.fillStyle = soft;
    ctx.font = font(600, 46);
    ctx.fillText(d.items.length ? 'Habis' : 'Total pengeluaran', X, y - px(10));
    ctx.fillStyle = ink;
    ctx.font = font(800, 150);
    ctx.fillText(short(d.total), X, y + px(150));
    y += px(190);

    if (d.line) {
      ctx.fillStyle = ink;
      ctx.font = font(600, 44);
      ctx.fillText(d.line, X, y + px(40), R - X);
      y += px(110);
    } else y += px(20);

    const max = Math.max(1, ...items.map((i) => i.total));
    const barH = px(30);
    items.forEach((it) => {
      ctx.shadowBlur = px(18);
      ctx.fillStyle = ink;
      ctx.font = font(700, 46);
      ctx.fillText((it.icon ? it.icon + '  ' : '') + it.nama, X, y + px(46), R - X - px(260));
      ctx.textAlign = 'right';
      ctx.fillText(short(it.total), R, y + px(46));
      ctx.textAlign = 'left';
      ctx.shadowBlur = 0;
      roundRect(ctx, X, y + px(70), R - X, barH, barH / 2);
      ctx.fillStyle = track;
      ctx.fill();
      roundRect(ctx, X, y + px(70), Math.max(barH, (R - X) * (it.total / max)), barH, barH / 2);
      ctx.fillStyle = fill;
      ctx.fill();
      y += rowH;
    });

    ctx.shadowBlur = px(18);
    drawFooter(ctx, d.appName, opts, X, y + px(40));
    ctx.restore();
  }

  /** Logo kecil + nama aplikasi di bagian bawah stiker. */
  function drawFooter(ctx, appName, opts, X, y) {
    const c = colors(opts);
    const px = (n) => Math.round(n * K);
    const font = (w, size) => w + ' ' + px(size) + 'px ' + FONT;
    const r = px(34);
    ctx.beginPath();
    ctx.arc(X + r, y + px(40), r, 0, Math.PI * 2);
    ctx.fillStyle = c.fill;
    ctx.fill();
    ctx.fillStyle = opts.dark ? '#ffffff' : '#2f8a75';
    ctx.font = font(700, 36);
    ctx.textAlign = 'center';
    ctx.fillText('🎙', X + r, y + px(54));
    ctx.textAlign = 'left';
    ctx.fillStyle = c.ink;
    ctx.font = font(800, 42);
    ctx.fillText(appName, X + px(90), y + px(38));
    ctx.fillStyle = c.soft;
    ctx.font = font(600, 32);
    ctx.fillText('catat keuangan cukup ngomong', X + px(90), y + px(80));
  }

  function colors(opts) {
    return {
      ink: opts.dark ? '#14201c' : '#ffffff',
      soft: opts.dark ? 'rgba(20,32,28,.62)' : 'rgba(255,255,255,.78)',
      track: opts.dark ? 'rgba(20,32,28,.16)' : 'rgba(255,255,255,.28)',
      fill: opts.dark ? 'rgba(20,32,28,.82)' : 'rgba(255,255,255,.92)',
    };
  }

  /** Kalimat apresiasi sesuai persen pemasukan yang tersisa. */
  function praiseLine(persen) {
    if (persen >= 0.5) return '👑 Sultan hemat! Separuh pemasukan masih utuh.';
    if (persen >= 0.25) return '💪 Dompet tebal, hati tenang.';
    if (persen >= 0.1) return '🌱 Hemat level aman. Pertahankan!';
    return '😄 Tipis-tipis, yang penting masih sisa.';
  }

  function pct(persen) { return Math.round(persen * 100) + '%'; }

  /**
   * Stiker pencapaian hemat bulanan.
   * d = { bulanLabel, sisa, persen, appName }; opts.hideAmount = tampilkan persen saja tanpa rupiah.
   */
  function drawAchievement(ctx, d, opts) {
    const c = colors(opts);
    const px = (n) => Math.round(n * K);
    const font = (w, size) => w + ' ' + px(size) + 'px ' + FONT;
    ctx.save();
    ctx.shadowColor = opts.dark ? 'rgba(255,255,255,.35)' : 'rgba(0,0,0,.35)';
    ctx.shadowBlur = px(18);
    ctx.textBaseline = 'alphabetic';
    const X = MARGIN, R = W - MARGIN;
    const blockH = px(120) + px(130) + px(190) + px(90) + px(150) + px(150);
    let y = H - 140 - blockH;

    ctx.fillStyle = c.soft;
    ctx.font = font(700, 40);
    ctx.letterSpacing = px(6) + 'px';
    ctx.fillText(d.bulanLabel.toUpperCase(), X, y + px(40));
    ctx.letterSpacing = '0px';
    y += px(120);
    ctx.fillStyle = c.ink;
    ctx.font = font(800, 64);
    ctx.fillText('🏆 Berhasil hemat!', X, y + px(50), R - X);
    y += px(130);
    ctx.fillStyle = c.soft;
    ctx.font = font(600, 46);
    ctx.fillText(opts.hideAmount ? 'Pemasukan yang tersisa' : 'Masih sisa', X, y - px(10));
    ctx.fillStyle = c.ink;
    ctx.font = font(800, 150);
    ctx.fillText(opts.hideAmount ? pct(d.persen) : short(d.sisa), X, y + px(150));
    y += px(190);
    ctx.fillStyle = c.soft;
    ctx.font = font(600, 44);
    ctx.fillText(opts.hideAmount ? 'dari total pemasukan' : pct(d.persen) + ' dari total pemasukan', X, y + px(40), R - X);
    y += px(90);

    const barH = px(30);
    ctx.shadowBlur = 0;
    roundRect(ctx, X, y, R - X, barH, barH / 2);
    ctx.fillStyle = c.track;
    ctx.fill();
    roundRect(ctx, X, y, Math.max(barH, (R - X) * Math.min(1, d.persen)), barH, barH / 2);
    ctx.fillStyle = c.fill;
    ctx.fill();
    ctx.shadowBlur = px(18);
    y += px(60);
    ctx.fillStyle = c.ink;
    ctx.font = font(600, 44);
    ctx.fillText(praiseLine(d.persen), X, y + px(50), R - X);
    y += px(150);

    drawFooter(ctx, d.appName, opts, X, y);
    ctx.restore();
  }

  /** Latar: foto pengguna (dipotong pas 9:16) atau gradasi pastel bila tanpa foto. */
  function drawBackground(ctx, photo, dark) {
    if (photo) {
      const s = Math.max(W / photo.width, H / photo.height);
      const w = photo.width * s, h = photo.height * s;
      ctx.drawImage(photo, (W - w) / 2, (H - h) / 2, w, h);
      // Bayangan lembut di bagian bawah supaya tulisan tetap terbaca di foto apa pun.
      const g = ctx.createLinearGradient(0, H * 0.35, 0, H);
      g.addColorStop(0, dark ? 'rgba(255,255,255,0)' : 'rgba(0,0,0,0)');
      g.addColorStop(1, dark ? 'rgba(255,255,255,.55)' : 'rgba(0,0,0,.55)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    } else {
      const g = ctx.createLinearGradient(0, 0, W, H);
      if (dark) { g.addColorStop(0, '#cfeee2'); g.addColorStop(.55, '#e4e0fa'); g.addColorStop(1, '#ffe2d2'); }
      else { g.addColorStop(0, '#2f8a75'); g.addColorStop(.6, '#5a4fb0'); g.addColorStop(1, '#c0603e'); }
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
  }

  async function ready() {
    try { await document.fonts.load('800 150px "Plus Jakarta Sans"'); await document.fonts.load('600 44px "Plus Jakarta Sans"'); } catch (e) { /* pakai huruf cadangan */ }
  }

  function toBlob(canvas) {
    return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Gagal membuat gambar'))), 'image/png'));
  }

  /**
   * Buat kanvas. mode: 'final' (latar + stiker) atau 'sticker' (transparan).
   * opts.kind: 'rekap' (bawaan) atau 'hemat' (stiker pencapaian).
   */
  async function render(d, opts, mode) {
    await ready();
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    if (mode === 'final') drawBackground(ctx, opts.photo, opts.dark);
    if (opts.kind === 'hemat') drawAchievement(ctx, d, opts);
    else drawSticker(ctx, d, opts);
    return c;
  }

  /** Baca file foto dari galeri menjadi gambar. */
  function loadPhoto(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { resolve(img); setTimeout(() => URL.revokeObjectURL(url), 1000); };
      img.onerror = () => reject(new Error('Foto tidak bisa dibaca. Coba foto lain.'));
      img.src = url;
    });
  }

  root.HBShare = { render, toBlob, loadPhoto, funnyLine, praiseLine, W, H };
})(this);
