# Catatan Projek: habisberapa

Aplikasi pencatatan transaksi / cash flow pribadi menggunakan suara.
File ini adalah riwayat diskusi & keputusan projek. Diperbarui setiap sesi.

---

## 2026-10-04 — Sesi 1: Merapikan ke folder projek

- Projek dipindahkan/dimulai di folder `D:\CLAUDE\habisberapa` (masih kosong).
- Catatan: diskusi sebelumnya tidak tersimpan di memori Claude, jadi detailnya perlu diceritakan ulang.
- Tujuan: aplikasi praktis, mudah dipakai, berguna untuk cash flow pribadi.
- Tahap saat ini: **pengumpulan kebutuhan** (tanya-jawab).

### Keputusan (putaran tanya-jawab 1)
- **Perangkat:** HP via browser (web app yang bisa di-"Add to Home Screen"), bisa juga dibuka di laptop.
- **Penyimpanan:** Google Sheets milik pengguna.
- **Input suara:** bahasa bebas, dipahami AI (satu ucapan bisa berisi beberapa transaksi + kategori otomatis).
- **Pengguna:** sendiri (satu buku kas).

### Keputusan (putaran tanya-jawab 2)
- **Setelah bicara:** langsung tersimpan, tetap ditampilkan di aplikasi. Koreksi/edit dilakukan **di aplikasi**, bukan di spreadsheet.
- **Sumber dana:** tidak perlu per akun/dompet, cukup total masuk & keluar.
- **Laporan:** pengeluaran per kategori, batas anggaran per kategori, riwayat & pencarian (dengan edit/hapus).
- **Biaya AI:** usahakan gratis.

### Keputusan (putaran tanya-jawab 3)
- Arsitektur gratis **disetujui**.
- Kategori: pakai daftar standar dulu, bisa diubah di aplikasi.
- Keamanan: **PIN sederhana** (sekali per perangkat).
- Sudah punya: akun Google & akun GitHub.
- HP: **iPhone**, jadi suara direkam lalu dikirim langsung ke Gemini (bukan pengenal suara browser).
- Spesifikasi lengkap ditulis di `SPESIFIKASI.md`.

### Perubahan: fitur Dompet (menggantikan keputusan "tanpa sumber dana")
- Pengguna bisa membuat dompet sendiri, misalnya Utama, Tabungan, Uang Makan, Uang Bensin.
- Pemasukan (misalnya gaji) masuk ke dompet **Utama**, lalu bisa dibagi-bagi ke dompet lain.
- Warna dompet: normal → berubah saat **mendekati habis** → **merah** saat habis.
- Ucapan menyebut dompet, misalnya: "tadi habis makan siang 25 ribu, parkir 2 ribu, ambil dari dompet uang makan".
- Aturan dompet (putaran tanya-jawab 4):
  - Dompet tidak disebut: AI menebak dari kategori, kalau tidak cocok diambil dari Utama.
  - Mendekati habis = sisa ≤ 20% dari jumlah setelah pengisian terakhir.
  - Ganti bulan: sisa uang terbawa (tidak di-reset).
  - **Batas anggaran per kategori dihapus**, karena dompet sudah berfungsi sebagai anggaran.
- SPESIFIKASI.md sudah diperbarui.

### Arsitektur final
- Suara: rekaman audio dikirim ke Google Gemini, yang mendengar sekaligus memahami (kuota gratis).
- Penyimpanan + "server": Google Sheets + Google Apps Script (kunci AI tersembunyi di sini).
- Tampilan aplikasi: web app (PWA) di hosting gratis, bisa dipasang di layar utama HP.

- Overspend: tetap dicatat, saldo boleh minus (dompet merah). Disetujui ("lanjut").

### Prototipe v1 selesai dibuat (2026-10-04)
- `web/`: tampilan aplikasi (Beranda + kartu dompet berwarna, Riwayat + cari/filter/edit, Laporan per kategori, Atur dompet & kategori, layar PIN, Bagi uang, tombol suara & ketik).
- `apps-script/Code.gs`: server Google Apps Script (Sheets + Gemini `gemini-3.5-flash`, cadangan `gemini-2.5-flash`).
- Suara direkam, diubah ke WAV 16 kHz di HP, lalu dikirim ke Gemini.
- Sudah diuji: mode demo di browser (ukuran HP), uji otomatis server (`tools/test-backend.js` lulus), layar PIN dengan server tiruan.
- **Belum diuji:** suara sungguhan dan Gemini sungguhan, karena butuh kunci API milik pengguna dan iPhone.
- Panduan pasang: `PANDUAN-PASANG.md`.

### Langkah berikutnya
- Pengguna mencoba mode demo, lalu mengikuti PANDUAN-PASANG.md (kunci Gemini → Sheets + Apps Script → kirim URL /exec ke Claude → GitHub Pages → iPhone).
- Claude memasukkan URL /exec ke `web/config.js`, lalu uji bersama di iPhone.
