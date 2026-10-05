# Panduan Pasang "Habis Berapa"

Total waktu sekitar 20–30 menit, cukup sekali saja. Tidak perlu bisa memprogram: tinggal ikuti langkahnya.
Kalau macet di langkah mana pun, ambil screenshot dan tunjukkan ke Claude.

Yang dibutuhkan: akun Google (Gmail), akun GitHub, dan iPhone.

---

## Langkah 1 — Buat kunci AI Gemini (gratis)

1. Buka **https://aistudio.google.com/apikey** dan masuk dengan akun Google Anda.
2. Klik **Create API key** (Buat kunci API). Kalau diminta memilih project, pilih yang ada atau buat baru.
3. Salin kuncinya (berupa teks panjang yang biasanya diawali `AIza...`) dan simpan sementara di Notes.

> Jangan bagikan kunci ini ke siapa pun.

## Langkah 2 — Siapkan Google Sheets + server kecil

1. Buka **https://sheets.new** untuk membuat spreadsheet baru. Beri nama, misalnya **Habis Berapa**.
2. Di menu atas, klik **Ekstensi → Apps Script**. Tab baru akan terbuka.
3. Di editor, hapus semua isi file `Code.gs` yang sudah ada.
4. Buka file `apps-script/Code.gs` dari folder projek ini, salin **seluruh** isinya, lalu tempel ke editor.
5. Di bagian paling atas, ubah dua baris ini:
   ```
   const PIN = '123456';                 ← ganti dengan PIN Anda (disarankan 6 angka)
   const GEMINI_API_KEY = 'ISI_KUNCI_GEMINI_DI_SINI';   ← tempel kunci dari Langkah 1
   ```
   Pastikan tanda petik `'...'` tetap ada.
6. Klik ikon **💾 Simpan**.

## Langkah 3 — Aktifkan servernya

1. Di editor Apps Script, klik tombol biru **Terapkan (Deploy) → Deployment baru (New deployment)**.
2. Klik ikon ⚙️ di sebelah "Pilih jenis", lalu pilih **Aplikasi web (Web app)**.
3. Isi:
   - **Jalankan sebagai (Execute as):** *Saya (email Anda)*
   - **Yang memiliki akses (Who has access):** *Siapa saja (Anyone)*
4. Klik **Terapkan (Deploy)**.
5. Google akan meminta izin. Klik **Izinkan akses** dan pilih akun Anda.
   - Kalau muncul peringatan *"Google belum memverifikasi aplikasi ini"*, itu wajar karena aplikasinya buatan Anda sendiri.
     Klik **Lanjutan (Advanced)** → **Buka Habis Berapa (tidak aman)** → **Izinkan**.
6. Salin **URL aplikasi web** yang berakhiran `/exec`, lalu **kirimkan URL ini ke Claude**.
   Claude akan memasukkannya ke `web/config.js`.

> "Siapa saja" artinya alamat ini bisa dihubungi, tapi **tanpa PIN yang benar tidak ada data yang bisa dibuka**.
> Setelah 10 kali PIN salah, server terkunci selama 10 menit.

## Langkah 4 — Pasang tampilan aplikasi di GitHub Pages (gratis)

1. Masuk ke **https://github.com**, lalu klik **+ → New repository**.
2. Nama repository: `habisberapa`. Pilih **Public** (diperlukan untuk hosting gratis; tidak ada data keuangan di sini). Klik **Create repository**.
3. Klik tautan **uploading an existing file**.
4. Buka folder `web` di komputer, pilih **semua isinya** (termasuk folder `icons`), lalu seret ke halaman GitHub. Klik **Commit changes**.
   - Yang diunggah adalah *isi* folder `web`, bukan folder `web`-nya.
5. Buka **Settings → Pages**. Di "Branch", pilih **main** dan **/ (root)**, lalu klik **Save**.
6. Tunggu 1–2 menit. Alamat aplikasi Anda akan menjadi: `https://NAMA-GITHUB-ANDA.github.io/habisberapa/`

## Langkah 5 — Pasang di iPhone

1. Buka alamat dari Langkah 4 di **Safari** (bukan Chrome).
2. Ketuk tombol **Bagikan** (kotak dengan panah ke atas), lalu pilih **Tambahkan ke Layar Utama (Add to Home Screen)**.
3. Buka aplikasi **Habis Berapa** dari layar utama, lalu masukkan PIN.
4. Saat pertama kali menekan tombol mikrofon, izinkan akses mikrofon.

Selesai! Coba ucapkan: *"gajian 8 juta"*, lalu buat dompet di menu **Atur**, dan bagikan uangnya dengan tombol **Bagi uang**.

---

## Catatan penting

- **Mengganti PIN atau kunci Gemini:** ubah di editor Apps Script, simpan, lalu
  **Terapkan → Kelola deployment → ✏️ (edit) → Versi: Versi baru → Terapkan.**
  Langkah yang sama juga berlaku setiap kali `Code.gs` diperbarui. URL-nya tetap sama.
- **Data Anda** ada di Google Sheets (lembar *Transaksi*, *Dompet*, *Kategori*). Sebaiknya **jangan mengubah susunan kolomnya**.
  Koreksi transaksi dilakukan dari aplikasi.
- **Kuota gratis Gemini** jauh lebih besar dari kebutuhan pencatatan pribadi. Kalau suatu hari kuotanya habis,
  aplikasi akan memberi tahu, dan Anda tetap bisa mencatat lewat **Isi formulir**.
- **Mode demo:** kalau `web/config.js` masih kosong, aplikasi berjalan tanpa server. Data tersimpan di browser saja
  dan suara belum bisa diproses (hanya ketik).
