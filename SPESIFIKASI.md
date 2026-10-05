# Spesifikasi Aplikasi "habisberapa" (v1)

Pencatat cash flow pribadi lewat suara, dengan sistem **dompet** (amplop anggaran).
Satu pengguna, dipakai di iPhone.

## 1. Alur utama
1. Buka aplikasi dari layar utama iPhone (sekali masukkan PIN, setelah itu diingat).
2. Layar utama menampilkan **kartu-kartu dompet** beserta saldo dan warnanya.
3. Tekan tombol mikrofon, lalu bicara bebas, misalnya:
   - *"tadi habis makan siang 25 ribu, parkir 2 ribu, ambil dari dompet uang makan"*
   - *"gajian 8 juta"* (masuk ke dompet Utama)
   - *"pindahkan 1,5 juta dari utama ke uang makan"* (mengisi dompet)
4. Rekaman dikirim ke Gemini, yang mendengar sekaligus memahami isinya, lalu
   menghasilkan satu atau lebih transaksi: tanggal, jenis, nominal, kategori, **dompet**, keterangan.
5. Transaksi **langsung tersimpan** ke Google Sheets, ditampilkan di layar, dan saldo dompet langsung berubah.
6. Kalau ada yang salah, edit atau hapus **di aplikasi** (tidak perlu membuka Sheets).
7. Cadangan: bisa juga mengetik kalimat yang sama kalau sedang tidak bisa bicara.

## 2. Dompet
- Pengguna bisa **membuat, mengganti nama, dan menghapus** dompet. Contoh: Utama, Tabungan, Uang Makan, Uang Bensin.
- Dompet **Utama** selalu ada. Semua **pemasukan** masuk ke Utama, kecuali disebut lain.
- **Isi dompet**: memindahkan uang dari satu dompet ke dompet lain, lewat suara atau tombol "Bagi uang"
  (contoh: gaji 8 juta di Utama dibagi ke Tabungan 2 juta, Uang Makan 1,5 juta, Uang Bensin 500 ribu).
- **Dompet tidak disebut** saat bicara: AI menebak dari kategori (makan → Uang Makan, bensin → Uang Bensin).
  Kalau tidak ada yang cocok, uangnya diambil dari Utama. Bisa dikoreksi di aplikasi.
- **Warna dompet**:
  - Normal: sisa lebih dari 20% dari jumlah setelah pengisian terakhir.
  - **Kuning/oranye** (mendekati habis): sisa ≤ 20%.
  - **Merah**: saldo Rp0 atau minus.
  - Contoh: Uang Makan diisi Rp1.000.000. Dompet menjadi kuning saat sisa ≤ Rp200.000, dan merah saat habis.
- **Ganti bulan**: sisa uang terbawa, tidak di-reset (seperti dompet sungguhan).
- Pengeluaran yang melebihi saldo **tetap dicatat** (saldo jadi minus, dompet merah), supaya catatan tetap sesuai kenyataan.

## 3. Fitur lainnya
- **Riwayat & pencarian**: daftar transaksi, filter per dompet/kategori/tanggal, cari kata, edit, hapus.
- **Pengeluaran per kategori**: grafik per bulan (uang habis untuk apa).
- **Ringkasan bulan ini**: total masuk, total keluar, selisih.
- **Kategori**: daftar standar, bisa ditambah/diubah di aplikasi.
  - Keluar: Makan & Minum, Transportasi, Belanja, Tagihan, Kesehatan, Hiburan, Keluarga, Lainnya
  - Masuk: Gaji, Bonus, Lainnya
- Tidak ada batas anggaran per kategori, karena dompet sudah berfungsi sebagai anggaran.
- Mata uang hanya Rupiah.

## 4. Teknologi (semua gratis)
| Bagian | Teknologi |
|---|---|
| Tampilan | Web app (PWA) di GitHub Pages, bisa "Add to Home Screen" di iPhone (Safari) |
| Suara ke transaksi | Rekaman audio dikirim ke Google Gemini (kuota gratis) |
| Server & keamanan | Google Apps Script (menyimpan kunci Gemini & PIN, tidak terlihat publik) |
| Penyimpanan | Google Sheets milik pengguna (lembar: Transaksi, Dompet, Kategori) |

## 5. Yang perlu disiapkan pengguna (dengan panduan)
- Akun Google: sudah ada.
- Akun GitHub: sudah ada.
- Kunci API Gemini gratis dari Google AI Studio (akan dipandu).
- iPhone dengan Safari.
