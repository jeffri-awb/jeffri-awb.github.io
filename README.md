# AWI Kurir — halaman publik

Beranda dan kebijakan privasi untuk aplikasi Google "AWI Kurir" (alat internal Asia Group).
Diminta Google supaya aplikasi bisa berstatus *In production* (sambungan tidak putus tiap 7 hari).
Sumber: repo privat `jeff-headquarter`, folder `_Sistem/vps/halaman-awi-kurir/`. Tidak memuat data pribadi atau rahasia.

## Kamera foto nota (`kamera-nota/`)

Halaman kamera untuk menu Foto nota di Portal Asia Group (HP admin cabang). Statis, tanpa pustaka luar, tanpa data:
semua isian (alamat Portal, token foto sekali pakai, faktur) datang dari Portal lewat fragmen `#` yang tidak terkirim
ke hosting. Foto hanya di memori HP lalu langsung dikirim ke Portal. Sumber dan ujinya: repo privat `jeff-headquarter`,
folder `bangun/portal-asia-group/kamera-nota/` (yang diunggah hanya `index.html`, `kamera.css`, `kamera.js`).
