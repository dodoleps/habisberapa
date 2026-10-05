# Habis Berapa

Pencatat cash flow pribadi lewat suara, dengan sistem dompet (amplop anggaran).

- `SPESIFIKASI.md`: apa yang dilakukan aplikasi
- `PANDUAN-PASANG.md`: cara memasang (langkah demi langkah)
- `CATATAN-PROJEK.md`: riwayat diskusi & keputusan

## Isi folder
| Folder | Isi |
|---|---|
| `web/` | Tampilan aplikasi (diunggah ke GitHub Pages) |
| `apps-script/Code.gs` | Server di Google Apps Script (menempel di Google Sheets) |
| `tools/` | Alat bantu pengembangan: server lokal & uji otomatis |

## Untuk pengembangan
```bash
node tools/serve.js
```
Buka http://localhost:5173. Kalau `web/config.js` kosong, aplikasi berjalan dalam mode demo.
Kalau diisi `'/api'`, aplikasi memakai server tiruan lokal yang menjalankan `Code.gs` (PIN 123456; AI tidak aktif).

```bash
node tools/test-backend.js
```
Menjalankan uji otomatis untuk `Code.gs`.
