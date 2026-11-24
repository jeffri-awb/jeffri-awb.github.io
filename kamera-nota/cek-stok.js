'use strict';
/* Cek stok v1 (24 Nov 2026, belum terbit) — Portal Asia Group · tahap 1 Anti fraud.
   PRD: cek-stok-2026-11-24/RANCANGAN.md § 3 (alur satu hari), § 4 (HP admin cabang), § 7 (cek celah). ACC Jeffri 24 Nov
   2026 ("gas live kan").
   Halaman TERPISAH dari kamera nota (index.html + kamera.js), supaya Foto nota yang dipakai admin tiap hari tidak ikut
   berisiko. Hanya kamera.css yang dipakai bersama, apa adanya.
   Dibuka Portal di tab baru: #v=1&api=<alamat Portal>&t=<token 32 hex>&o=<idOutlet>&on=<nama cabang>.
   - Fragmen (#) tidak terkirim ke hosting dan langsung dihapus dari alamat. Salinannya hanya di sessionStorage tab ini
     (cek-stok-v1), supaya muat ulang tetap jalan. Yang cacat = layar "Buka dari Portal".
   - Daftar barang hari ini: doPost cs-daftar. Admin hanya melihat NAMA barang: tidak ada angka stok dari kasir, nama staf,
     alasan, nilai, atau nomor nota. Kolom lain dari Portal tidak pernah ditulis ke layar.
   - Satu barang satu layar: foto dari kamera langsung (getUserMedia) + jumlah yang dihitung, lalu doPost cs-kirim.
     TIDAK ada masukan berkas (input file) dan atribut capture: tidak ada jalur galeri sama sekali.
   - Kirim langsung, satu per satu (tanpa IndexedDB, tanpa antrean latar). POST text/plain (tanpa preflight). idAksi acak
     24 hex terikat isi kiriman (foto + jumlah): ulangan otomatis dan Coba kirim lagi memakai idAksi yang SAMA; isi yang
     berubah dan Hitung ulang = idAksi baru (kiriman baru mengganti yang lama di Portal).
   - Semua teks dari Portal ditulis lewat textContent.
   Logika kamera disalin dari kamera.js v9 (getUserMedia ideal 3264×2448, OverconstrainedError → tanpa ukuran, Putar
   belakang ↔ depan dengan deviceId + facingMode `exact`, koreksi buka pertama Samsung A26, Flash/senter, kamera gagal),
   tanpa bingkai nota: foto = seluruh bidang kamera yang terlihat (tegak di HP). */
(() => {
  const UJI = window.__ujiCekStok || {};               // hanya diisi uji otomatis, untuk memperpendek jeda
  const $ = id => document.getElementById(id);
  const SISI_MAKS = 1600, BITA_MAKS = 330 * 1024, JUMLAH_MAKS = 9999, NAMA_MAKS = 120, PESAN_MAKS = 300;
  const JEDA_ULANG = UJI.jeda || [1000, 3000, 7000];
  const JEDA_DAFTAR = UJI.jedaDaftar || 1500;
  /* Batas waktu kirim sama dengan jalur sinkron kamera.js: tunggu jawaban 25 dtk + jatah unggah sebanding ukuran badan
     (8 KB/dtk), lalu begitu jawaban mulai tiba diam 20 dtk = putus. Tanpa pendengar di xhr.upload (memaksa preflight
     CORS yang tidak dijawab Apps Script). */
  const BATAS_JAWAB = UJI.batas || 25000;
  const BATAS_DIAM = UJI.diam || 20000;
  const LAJU_MIN = UJI.laju || 8 * 1024;
  const BATAS_DAFTAR = UJI.batasDaftar || 15000;
  /* Sisa waktu halaman < 10 menit → minta buka lagi dari Portal SEBELUM kamera menyala (kamera.js unggah-foto-06).
     Angka yang tidak masuk akal (sisa > 4 jam + 5 menit, atau lewat > 5 menit) diabaikan. */
  const SISA_TOKEN_MIN = 10 * 60 * 1000, TOKEN_MAKS = 4 * 3600 * 1000;
  const KUNCI_SESI = 'cek-stok-v1', KUNCI_FLASH = 'cek-stok-flash';
  const KODE_ULANG = new Set(['sibuk', 'belum-pasti', 'gagal']);
  const HEX24 = /^[a-f0-9]{24}$/;
  const AWALAN_JPEG = 'data:image/jpeg;base64,';
  const BULAN_PENDEK = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const HARI_PENDEK = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];

  /* Kabar dari Portal: [judul, kalimat bawaan]. Kalimat dari Portal (`pesan`) dipakai bila ada. */
  const KABAR = {
    token: ['Buka lagi dari Portal', 'Tutup halaman ini, kembali ke Portal, lalu buka Cek stok lagi.'],
    akses: ['Belum ada akses', 'Akun ini belum diberi akses Cek stok. Minta Super Admin menambahkannya di Akun & akses.'],
    lihat: ['Mode lihat saja', 'Kamu sedang melihat sebagai akun lain, jadi tidak bisa menyimpan.'],
    'luar-jendela': ['Daftar ini sudah ditutup', 'Cek stok ini untuk hari lain atau sudah ditutup. Kembali ke Portal untuk ' +
      'melihat daftar hari ini.'],
    isian: ['Belum tersimpan', 'Kiriman ini belum bisa disimpan. Foto ulang barangnya, lalu kirim lagi.'],
    sibuk: ['Sedang ramai', 'Portal sedang menyimpan pekerjaan lain. Tunggu sebentar, lalu tekan Coba kirim lagi.'],
    'belum-pasti': ['Belum pasti tersimpan', 'Tekan Coba kirim lagi. Kiriman yang sama tidak tersimpan dua kali.'],
    gagal: ['Belum berhasil', 'Ada gangguan di Portal dan sudah tercatat otomatis. Tekan Coba kirim lagi; kalau masih ' +
      'gagal, kabari Super Admin.'],
    jaringan: ['Koneksi terputus', 'Belum terkirim. Periksa sinyal atau Wi-Fi, lalu tekan Coba kirim lagi. Foto dan jumlah ' +
      'masih di halaman ini, jangan tutup dulu.']
  };
  KABAR.sesi = KABAR.token;
  /* Jawaban yang membuat halaman ini tidak bisa dipakai lagi: layar pesan + Kembali ke Portal. */
  const KODE_BERHENTI = new Set(['token', 'sesi', 'akses', 'lihat', 'luar-jendela']);
  const KABAR_HAMPIR = ['Buka lagi dari Portal', 'Waktu halaman ini hampir habis. Tutup halaman ini, kembali ke Portal, lalu ' +
    'buka Cek stok lagi supaya fotonya bisa terkirim.', 'Kembali ke Portal'];
  const DAFTAR_GAGAL = 'Daftar barang belum bisa dimuat. Periksa sinyal atau Wi-Fi, lalu coba lagi.';
  const DAFTAR_RUSAK = 'Daftar barang belum bisa dibaca. Coba lagi; kalau masih gagal, kabari Super Admin.';

  const S = {
    p: null,                       // fragmen yang sudah diperiksa
    nama: '', tanggal: '', batas: '13.00', lewat: false, batasMs: NaN,
    barang: [],                    // [{kunci, nama, terkirim: null | {jumlah, jam}}] — hanya ini yang dipakai dari Portal
    i: 0,                          // barang yang sedang dibuka
    ulang: '',                     // kunci barang yang sedang dihitung ulang (dibuka dari layar selesai)
    draf: new Map(),               // kunci → {foto: {url, b64, w, h} | null, jumlah, nomorFoto, olah, idAksi, sidikAksi, gagal}
    layar: '', sibuk: false, kabarKirim: '', nomorDaftar: 0, nomorFoto: 0, kabarOk: '', jamPortal: null, sisaToken: null, jamLewat: 0,
    /* kamera (salinan kamera.js v9) */
    kameraUntuk: '', stream: null, nomorKamera: 0, flash: true, bisaFlash: false,
    hadap: 'environment', bisaPutar: false, putarDari: '', pesanPutar: '', jamPutar: 0, putarMati: false,
    idKamera: {user: '', environment: ''}
  };

  /* ---------- bantuan kecil ---------- */
  function idAcak() {
    const b = new Uint8Array(12);
    crypto.getRandomValues(b);
    return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
  }
  function huruf(s) { return Array.from(s).length; }
  function potongHuruf(s, n) { const a = Array.from(s); return a.length <= n ? s : a.slice(0, n - 1).join('') + '…'; }
  function hariPendek(t) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
    if (!m) return '';
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return HARI_PENDEK[d.getDay()] + ', ' + Number(m[3]) + ' ' + BULAN_PENDEK[Number(m[2]) - 1];
  }
  function tunggu(ms) { return new Promise(r => setTimeout(r, ms)); }
  function el(tag, kelas, teks) {
    const e = document.createElement(tag);
    if (kelas) e.className = kelas;
    if (teks !== undefined) e.textContent = teks;
    return e;
  }
  function ikon(nama) {
    const NS = 'http://www.w3.org/2000/svg', s = document.createElementNS(NS, 'svg'), u = document.createElementNS(NS, 'use');
    s.setAttribute('aria-hidden', 'true');
    u.setAttribute('href', '#i-' + nama);
    s.append(u);
    return s;
  }
  function tombol(kelas, id, teks, fn) {
    const b = el('button', kelas, teks);
    b.type = 'button';
    if (id) b.id = id;
    b.addEventListener('click', fn);
    return b;
  }
  /* Isi dibangun ulang hanya bila tampilannya berubah (tombol yang diganti di tengah sentuhan membuat ketukan hilang). */
  function gantiIsi(w, kelas, anak) {
    const baru = document.createElement('div');
    anak.forEach(a => baru.append(a));
    const lama = w.childNodes, kini = baru.childNodes;
    if (w.className === kelas && lama.length === kini.length && Array.from(lama).every((n, i) => n.isEqualNode(kini[i]))) return;
    w.className = kelas;
    w.textContent = '';
    while (baru.firstChild) w.append(baru.firstChild);
  }
  const jumlahSah = n => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= JUMLAH_MAKS;
  const ketikanSah = s => /^\d{1,4}$/.test(s) && Number(s) <= JUMLAH_MAKS;
  const jamSah = s => typeof s === 'string' && /^\d{1,2}[.:]\d{2}$/.test(s);
  const teksTerkirim = t => ['Terkirim', t.jumlah + ' botol', t.jam].filter(Boolean).join(' · ');
  function pesanPortal(j) {
    const s = j && typeof j.pesan === 'string' ? j.pesan.trim() : '';
    return s ? potongHuruf(s, PESAN_MAKS) : '';
  }

  /* ---------- data dari Portal ---------- */
  const KUNCI_FRAGMEN = ['v', 'api', 't', 'o', 'on'];
  function bacaFragmen(h) {
    const q = new URLSearchParams(String(h || '').replace(/^#/, '')), p = {};
    KUNCI_FRAGMEN.forEach(k => { p[k] = (q.get(k) || '').trim(); });
    return sah(p) ? p : null;
  }
  /* Daftar putih (sama dengan sahDasar kamera.js untuk api/t/o): yang cacat = layar "Buka dari Portal". */
  function sah(p) {
    return !!p && typeof p === 'object' && p.v === '1'
      && /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{10,}\/exec$/.test(String(p.api))
      && /^[a-f0-9]{32}$/.test(String(p.t))
      && /^[A-Za-z0-9_-]{2,40}$/.test(String(p.o))
      && typeof p.on === 'string' && huruf(p.on) <= 60;
  }
  function simpanSesi() {
    try { sessionStorage.setItem(KUNCI_SESI, JSON.stringify({p: S.p})); } catch (e) { /* tanpa simpanan: muat ulang minta buka dari Portal */ }
  }
  function bacaSesi() {
    try {
      const x = JSON.parse(sessionStorage.getItem(KUNCI_SESI) || 'null');
      if (x && sah(x.p)) return KUNCI_FRAGMEN.reduce((o, k) => (o[k] = x.p[k], o), {});
    } catch (e) { /* abaikan */ }
    return null;
  }
  function hapusSesi() {
    try { sessionStorage.removeItem(KUNCI_SESI); } catch (e) { /* abaikan */ }
  }
  /* Jawaban ok cs-daftar. Cacat = null (layar gagal + Coba lagi). Hanya kunci, nama, dan terkirim yang diambil per barang. */
  function bacaTerkirim(t) {                              // null = belum dikirim; undefined = cacat
    if (t === null || t === undefined || t === false) return null;
    if (typeof t !== 'object' || !jumlahSah(t.jumlah)) return undefined;
    return {jumlah: t.jumlah, jam: jamSah(t.jam) ? t.jam.replace(':', '.') : ''};
  }
  function bacaDaftar(j, p) {
    if (!j || j.ok !== true || typeof j !== 'object') return null;
    if (typeof j.idOutlet === 'string' && j.idOutlet !== '' && j.idOutlet !== p.o) return null;
    if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(String(j.tanggal))) return null;
    if (!Array.isArray(j.barang) || j.barang.length > 100) return null;
    const barang = [], kunci = new Set();
    for (const x of j.barang) {
      if (!x || typeof x !== 'object' || !HEX24.test(String(x.kunci)) || kunci.has(x.kunci)) return null;
      if (typeof x.nama !== 'string' || !x.nama.trim()) return null;
      const t = bacaTerkirim(x.terkirim);
      if (t === undefined) return null;
      kunci.add(x.kunci);
      barang.push({kunci: x.kunci, nama: potongHuruf(x.nama.trim(), NAMA_MAKS), terkirim: t});
    }
    const batas = jamSah(j.batas) ? j.batas.replace(':', '.') : '13.00';
    const nama = typeof j.nama === 'string' && j.nama.trim() && huruf(j.nama.trim()) <= 60 ? j.nama.trim() : p.on;
    return {tanggal: j.tanggal, batas, lewat: j.lewat === true, nama, barang};
  }

  /* ---------- jam Portal (K2 kamera.js) ----------
     Sisa waktu = `sampai` − `kini`, KEDUANYA jam Portal, lalu dihitung mundur dengan max(selisih performance.now, selisih
     jam HP sejak jawaban tiba): jam HP yang salah tetap (maju/mundur) hilang di selisih, waktu HP tidur ikut terhitung. */
  function catatJam(sampai, kini) {
    const n = Number(sampai), k = Number(kini), sisa = n - k, ada = typeof kini === 'number' && isFinite(k) && k > 0;
    S.jamPortal = ada ? {kini: k, pada: performance.now(), padaJam: Date.now()} : null;
    S.sisaToken = ada && isFinite(n) && n > 0 && sisa > -5 * 60000 && sisa <= TOKEN_MAKS + 5 * 60000
      ? {sisa, pada: performance.now(), padaJam: Date.now()} : null;
  }
  function berlalu(s) {
    const monoton = performance.now() - s.pada, jam = Date.now() - s.padaJam;
    return Math.max(monoton, isFinite(jam) ? jam : monoton);
  }
  function sisaToken() { return S.sisaToken ? S.sisaToken.sisa - berlalu(S.sisaToken) : Infinity; }
  /* Batas kirim (13.00 WIB di tanggal daftar). Portal memberi `lewat` saat daftar dimuat; sesudahnya dihitung dari jam
     Portal (bukan jam HP), supaya kalimat ikut berganti bila halaman terbuka melewati batas. */
  function hitungBatasMs(tanggal, batas) {
    const t = /^(\d{4})-(\d{2})-(\d{2})$/.exec(tanggal), b = /^(\d{1,2})\.(\d{2})$/.exec(batas);
    return t && b ? Date.UTC(Number(t[1]), Number(t[2]) - 1, Number(t[3]), Number(b[1]) - 7, Number(b[2])) : NaN;
  }
  function lewatSekarang() {
    if (S.lewat) return true;
    const j = S.jamPortal;
    return !!j && isFinite(S.batasMs) && j.kini + berlalu(j) >= S.batasMs;
  }

  /* ---------- layar ---------- */
  function tampil(nama) {
    S.layar = nama;
    ['muat', 'barang', 'kamera', 'tolak', 'selesai', 'pesan'].forEach(n => { $(n).hidden = n !== nama; });
    try { $('warna-tema').setAttribute('content', nama === 'kamera' ? '#000000' : '#ffffff'); } catch (e) { /* hanya warna bilah */ }   // ds-izin: warna bilah peramban di layar kamera gelap (sama dengan kamera.js)
    document.querySelectorAll('.cs-tutup-ket').forEach(k => { k.hidden = true; });
  }
  function layarPesan(judul, isi) {
    matikanKamera();
    tutupPopup(false);
    S.sibuk = false;
    $('pesan-judul').textContent = judul;
    $('pesan-isi').textContent = isi;
    tampil('pesan');
    $('t-pesan-kembali').focus({preventScroll: true});
  }
  function layarMuat(gagalTeks) {
    $('m-sub').textContent = S.p ? S.p.on : '';
    $('m-memuat').hidden = !!gagalTeks;
    $('m-gagal').hidden = !gagalTeks;
    $('m-gagal-isi').textContent = gagalTeks || '';
    tampil('muat');
    if (gagalTeks) $('t-coba-daftar').focus({preventScroll: true});
  }
  const sekarang = () => S.barang[S.i];
  function draf(x) {
    if (!S.draf.has(x.kunci)) S.draf.set(x.kunci, {foto: null, jumlah: '', nomorFoto: 0, olah: 0, idAksi: '', sidikAksi: '', gagal: null});
    return S.draf.get(x.kunci);
  }
  const sidik = d => d.nomorFoto + '|' + d.jumlah;
  const siap = d => !!d.foto && !d.olah && ketikanSah(d.jumlah);
  /* Barang lain (selain yang sedang dibuka) yang belum terkirim: menentukan "lanjut" atau "selesai". */
  const sisaBelum = () => S.barang.filter((x, k) => k !== S.i && !x.terkirim).length;
  function berikutnya() {
    for (let k = 1; k <= S.barang.length; k++) {
      const n = (S.i + k) % S.barang.length;
      if (!S.barang[n].terkirim) return n;
    }
    return -1;
  }
  function isiKepala() {
    const M = S.barang.length, x = sekarang(), lewat = lewatSekarang();
    $('b-judul').textContent = 'Barang ' + (S.i + 1) + ' dari ' + M;
    $('b-sub').textContent = [S.nama, lewat ? '' : 'batas ' + S.batas + ' WIB'].filter(Boolean).join(' · ');
    $('b-lewat').textContent = lewat ? 'Lewat batas ' + S.batas + ', tetap kirim' : '';
    $('b-lewat').hidden = !lewat;
    /* garis langkah: satu ruas per barang, biru = terkirim atau sedang dibuka */
    const g = $('b-langkah'), nKirim = S.barang.filter(b => b.terkirim).length;
    gantiIsi(g, 'cs-langkah', S.barang.map((b, k) => el('i', b.terkirim || k === S.i ? 'biru' : '')));
    g.setAttribute('aria-label', 'Barang ' + (S.i + 1) + ' dari ' + M + '. ' + nKirim + ' sudah terkirim.');
    $('b-nama').textContent = x.nama;
    $('kam-kertas').textContent = x.nama;
  }
  function kotakFoto(x, d) {
    const w = $('b-foto'), anak = [], mati = S.sibuk;
    if (d.olah) {
      const g = el('div', 'slot-gambar memuat');
      g.setAttribute('role', 'img');
      g.setAttribute('aria-label', 'Merapikan foto');
      const isi = el('div', 'slot-isi');
      isi.append(el('div', 'slot-kepala'), g);
      isi.firstChild.append(el('b', '', 'Merapikan foto…'));
      anak.push(isi);
    } else if (!d.foto) {
      const b = el('button', 'slot-tombol');
      b.type = 'button';
      b.id = 'foto-barang';
      b.append(ikon('kamera'), el('b', '', 'Foto barang'));
      b.disabled = mati;
      b.addEventListener('click', () => { if (!b.disabled) mintaKamera(); });
      anak.push(b);
    } else {
      const isi = el('div', 'slot-isi'), kepala = el('div', 'slot-kepala'), g = el('div', 'slot-gambar'), img = el('img');
      kepala.append(el('b', '', 'Foto barang'));
      img.alt = 'Foto ' + x.nama;
      img.src = d.foto.url;
      g.append(img);
      const ak = el('div', 'slot-aksi');
      const fu = tombol('btn', 'foto-ulang', 'Foto ulang', () => { if (!S.sibuk) mintaKamera(); });
      fu.prepend(ikon('kamera'));
      fu.disabled = mati;
      ak.append(fu);
      isi.append(kepala, g, ak);
      anak.push(isi);
    }
    gantiIsi(w, 'slot cs-foto ' + (d.foto || d.olah ? 'terisi' : 'kosong'), anak);
  }
  function layarBarang(fokus) {
    const x = sekarang(), d = draf(x), ulang = S.ulang === x.kunci;
    isiKepala();
    const kabar = $('b-kabar');
    kabar.textContent = S.kabarOk;
    kabar.hidden = !S.kabarOk;
    /* Hitung ulang: hasil sebelumnya tampil sebagai keterangan; kiriman baru mengganti yang lama */
    $('b-sebelum').textContent = ulang && x.terkirim ? 'Sebelumnya: ' + teksTerkirim(x.terkirim) + '. Kiriman baru mengganti yang lama.' : '';
    $('b-sebelum').hidden = !(ulang && x.terkirim);
    kotakFoto(x, d);
    const inp = $('b-jumlah');
    if (inp.value !== d.jumlah) inp.value = d.jumlah;
    inp.readOnly = S.sibuk;
    const salah = d.jumlah !== '' && !ketikanSah(d.jumlah);
    inp.setAttribute('aria-invalid', String(salah));
    inp.closest('.cs-angka').classList.toggle('salah', salah);
    $('b-jumlah-pesan').textContent = salah ? 'Ketik angka bulat 0 sampai 9999, tanpa titik atau koma.' : '';
    $('b-jumlah-pesan').hidden = !salah;
    /* kaki: satu tombol biru; mati selama mengirim dan sampai foto + jumlah sah */
    const t = $('t-simpan'), hasil = $('b-hasil'), ket = $('b-simpan-ket');
    const ulangKirim = !!d.gagal && d.gagal.ulang && d.sidikAksi === sidik(d) && !!d.idAksi;
    t.textContent = S.sibuk ? 'Mengirim…' : ulangKirim ? 'Coba kirim lagi' : sisaBelum() ? 'Simpan, lanjut barang berikutnya' : 'Simpan dan selesai';
    t.disabled = S.sibuk || !siap(d);
    t.setAttribute('aria-busy', String(S.sibuk));
    if (S.sibuk) {
      hasil.className = 'hasil tunggu';
      hasil.textContent = S.kabarKirim || 'Mengirim ke Portal…';
    } else if (d.gagal) {
      hasil.className = 'hasil gagal';
      hasil.textContent = d.gagal.teks;
    }
    hasil.hidden = !(S.sibuk || d.gagal);
    hasil.setAttribute('role', d.gagal && !S.sibuk ? 'alert' : 'status');
    ket.textContent = S.sibuk || siap(d) ? '' : d.olah ? 'Foto sedang dirapikan.' : !d.foto && d.jumlah === '' ? 'Foto barangnya dan ketik jumlahnya dulu.'
      : !d.foto ? 'Foto barangnya dulu.' : d.jumlah === '' ? 'Ketik jumlah yang kamu hitung dulu.' : 'Jumlah harus angka bulat 0 sampai 9999.';
    ket.hidden = !ket.textContent;
    $('t-batal-ulang').hidden = !ulang;
    $('t-batal-ulang').disabled = S.sibuk;
    if (S.layar !== 'barang') { tampil('barang'); window.scrollTo(0, 0); }
    if (fokus === 'jumlah') inp.focus({preventScroll: true});
    else if (fokus) { const f = $('foto-barang') || (!t.disabled && t) || inp; if (f && f.focus) f.focus({preventScroll: true}); }
  }
  function layarSelesai() {
    matikanKamera();
    S.ulang = '';
    $('s-sub').textContent = [S.nama, hariPendek(S.tanggal)].filter(Boolean).join(' · ');
    const ul = $('s-daftar');
    gantiIsi(ul, 'cs-daftar', S.barang.map((x, k) => {
      const li = el('li', 'cs-baris'), kiri = el('div', 'cs-baris-isi'), ok = el('span', 'cs-ok');
      ok.append(ikon('cek'), document.createTextNode(teksTerkirim(x.terkirim)));
      kiri.append(el('b', '', x.nama), ok);
      const h = tombol('btn cs-kecil', 'hitung-' + k, 'Hitung ulang', () => hitungUlang(k));
      h.setAttribute('aria-label', 'Hitung ulang ' + x.nama);
      li.append(kiri, h);
      return li;
    }));
    tampil('selesai');
    window.scrollTo(0, 0);
    $('t-selesai-kembali').focus({preventScroll: true});
  }
  function bukaBarang(k, fokus) {
    S.i = k;
    layarBarang(fokus);
  }
  /* Hitung ulang dari layar selesai: foto + jumlah baru untuk barang yang sudah terkirim (idAksi baru, mengganti). */
  function hitungUlang(k) {
    const x = S.barang[k];
    if (!x || S.sibuk) return;
    S.draf.delete(x.kunci);
    S.ulang = x.kunci;
    S.kabarOk = '';
    bukaBarang(k, true);
  }
  function batalUlang() {
    if (S.sibuk) return;
    const x = sekarang();
    if (x) S.draf.delete(x.kunci);
    S.ulang = '';
    if (berikutnya() < 0 && (!x || x.terkirim)) return layarSelesai();
    bukaBarang(x && !x.terkirim ? S.i : berikutnya(), true);
  }

  /* ---------- pop-up (gagal foto, waktu hampir habis) ---------- */
  let popKembali = null, popTindakan = null;
  function popup(kb, tindakan) {
    $('pop-judul').textContent = kb[0];
    $('pop-isi').textContent = kb[1];
    $('pop-tombol').textContent = kb[2];
    popTindakan = tindakan || null;
    popKembali = document.activeElement;
    $('pop').hidden = false;
    $('pop-tombol').focus();
  }
  function tutupPopup(jalankan) {
    if ($('pop').hidden) return;
    $('pop').hidden = true;
    const t = popTindakan;
    popTindakan = null;
    const e = popKembali;
    if (e && e.focus && document.contains(e) && !e.closest('[hidden]') && !e.disabled) e.focus({preventScroll: true});
    if (jalankan && t) t();
  }

  /* ---------- kembali ke Portal: tutup tab bila bisa, kalau tidak beri tahu caranya ---------- */
  function kePortal() {
    matikanKamera();
    tutupPopup(false);
    const dari = S.layar;
    try { window.close(); } catch (e) { /* peramban menolak menutup tab ini */ }
    setTimeout(() => {
      const ket = {muat: 'm-tutup-ket', barang: 'b-tutup-ket', selesai: 's-tutup-ket', pesan: 'p-tutup-ket'}[S.layar === 'kamera' || S.layar === 'tolak' ? dari : S.layar];
      if (ket) $(ket).hidden = false;
    }, 300);
  }

  /* ---------- kamera (salinan kamera.js v9, tanpa bingkai nota dan tanpa Kamera HP) ---------- */
  function ket(t, kabar) {
    const k = $('kam-ket');
    k.textContent = t;
    k.classList.toggle('kabar', !!(t && kabar));
  }
  function matikanKamera() {
    S.nomorKamera++;
    if (S.stream) S.stream.getTracks().forEach(t => t.stop());   // senter ikut mati bersama kamera
    S.stream = null;
    S.bisaFlash = false;
    $('kam-video').srcObject = null;
  }
  /* Resolusi (BUILD v406 § 3): minta 3264×2448 (4:3); HP yang tidak sanggup menolak dengan OverconstrainedError →
     coba lagi tanpa ukuran. */
  const ditolakSyarat = e => !!e && (e.name === 'OverconstrainedError' || e.name === 'ConstraintNotSatisfiedError');
  const hentikan = st => { try { st.getTracks().forEach(t => t.stop()); } catch (e) { /* sudah mati */ } };
  function mintaVideo(syarat, ukuran) {
    const v = Object.assign({}, syarat);
    if (ukuran) Object.assign(v, {width: {ideal: 3264}, height: {ideal: 2448}, aspectRatio: {ideal: 4 / 3}});
    return navigator.mediaDevices.getUserMedia({audio: false, video: v});
  }
  async function mintaArahIdeal(hadap) {
    try {
      return await mintaVideo({facingMode: {ideal: hadap}}, true);
    } catch (e) {
      if (!ditolakSyarat(e)) throw e;
      return mintaVideo({facingMode: {ideal: hadap}}, false);
    }
  }
  /* v9: arah pasti. null = HP tidak punya kamera yang melaporkan arah ini (permintaan ditolak tanpa menyalakan kamera). */
  async function mintaArahPasti(hadap) {
    try { return await mintaVideo({facingMode: {exact: hadap}}, true); } catch (e) { if (!ditolakSyarat(e)) throw e; }
    try { return await mintaVideo({facingMode: {exact: hadap}}, false); } catch (e) { if (!ditolakSyarat(e)) throw e; }
    return null;
  }
  async function mintaKameraHP() {
    const hadap = S.hadap === 'user' ? 'user' : 'environment';
    /* v9 (1): kamera yang sudah pernah menyala ke arah ini di halaman ini dipakai lagi persis (Putar kembali, barang
       berikutnya). deviceId basi (ditolak) dilupakan, lalu jalan biasa. */
    const id = S.idKamera[hadap];
    if (id) {
      try { return await mintaVideo({deviceId: {exact: id}}, true); } catch (e) { if (!ditolakSyarat(e)) throw e; }
      try { return await mintaVideo({deviceId: {exact: id}}, false); } catch (e) { if (!ditolakSyarat(e)) throw e; }
      S.idKamera[hadap] = '';
    }
    /* v9 (2): sesudah Putar arah kamera HP ini sudah terbaca, jadi arah diminta pasti. */
    if (S.putarDari) {
      const st = await mintaArahPasti(hadap);
      if (st) return st;
      return mintaArahIdeal(hadap);
    }
    const st = await mintaArahIdeal(hadap);
    /* v9 (3): diminta belakang, yang menyala kamera depan (Samsung A26, 20 Nov) → matikan, minta belakang secara pasti.
       Tanpa kamera belakang, atau kamera belakang gagal menyala → kembali ke kamera yang tadi menyala. */
    if (hadap !== 'environment' || arahKamera(st.getVideoTracks()[0]) !== 'user') return st;
    hentikan(st);
    let lain = null;
    try { lain = await mintaArahPasti('environment'); } catch (e) { lain = null; }
    return lain || mintaArahIdeal(hadap);
  }
  /* Ketukan Foto barang / Foto ulang. Sisa waktu halaman < 10 menit → minta buka lagi dari Portal SEBELUM memotret. */
  function mintaKamera() {
    if (S.sibuk || !sekarang()) return;
    if (sisaToken() < SISA_TOKEN_MIN) return popup(KABAR_HAMPIR, kePortal);
    S.kameraUntuk = sekarang().kunci;
    return bukaKamera();
  }
  async function bukaKamera() {
    tutupPopup(false);
    matikanKamera();
    $('kam-flash').hidden = true;
    tampilPutar();
    tampil('kamera');
    const nomor = S.nomorKamera, rana = $('kam-rana');
    rana.disabled = true;
    ket('Menyalakan kamera…');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return kameraGagal('tanpa');
    let st;
    try {
      st = await mintaKameraHP();
    } catch (e) {
      if (nomor !== S.nomorKamera || S.layar !== 'kamera') return;
      /* kamera lain (sesudah Putar) gagal menyala → kembali ke kamera sebelumnya, bukan layar gagal */
      if (S.putarDari) { putarGagal(); return; }
      S.pesanPutar = '';
      kameraGagal(e && e.name);
      return;
    }
    if (nomor !== S.nomorKamera || S.layar !== 'kamera' || document.hidden) { st.getTracks().forEach(t => t.stop()); return; }
    S.stream = st;
    const v = $('kam-video');
    v.srcObject = st;
    try { await v.play(); } catch (e) { /* video bisu tetap tampil walau play() ditolak */ }
    if (nomor !== S.nomorKamera) return;
    fokusTerus(st);
    pasangFlash(st, nomor);
    const dari = S.putarDari;
    S.putarDari = '';
    pasangPutar(st, nomor, dari);
    ketPutar();
    rana.disabled = false;
    tampilPutar();
  }
  function tutupKamera() {
    matikanKamera();
    kembaliKeBarang(true);
  }
  /* kembali ke layar barang untuk barang yang tadi dipotret */
  function kembaliKeBarang(fokus) {
    const k = S.barang.findIndex(x => x.kunci === S.kameraUntuk);
    if (k >= 0) S.i = k;
    layarBarang(fokus);
  }
  function fokusTerus(st) {
    try {
      const tr = st.getVideoTracks()[0], c = tr && tr.getCapabilities ? tr.getCapabilities() : {};
      if (c.focusMode && c.focusMode.indexOf('continuous') >= 0) {
        tr.applyConstraints({advanced: [{focusMode: 'continuous'}]}).catch(() => {});
      }
    } catch (e) { /* tidak semua HP mendukung pengaturan fokus */ }
  }
  /* Flash = senter kamera. Nyala bawaan; pilihan admin diingat di HP (cek-stok-flash, terpisah dari Foto nota). Keadaan
     dilacak di halaman sendiri, TIDAK dibaca dari getSettings().torch (iOS melaporkannya salah). Tanpa senter = tanpa
     tombol. Gagal menyalakan = diam. */
  function bisaSenter(tr) {
    try { const c = tr && tr.getCapabilities ? tr.getCapabilities() : null; return !!c && c.torch === true; } catch (e) { return false; }
  }
  function setelSenter(tr, nyala) {
    try {
      const pr = tr.applyConstraints({advanced: [{torch: nyala}]});
      if (pr && pr.catch) pr.catch(() => {});
    } catch (e) { /* diam */ }
  }
  function pasangFlash(st, nomor) {
    const tr = st.getVideoTracks()[0];
    const pasang = () => {
      if (nomor !== S.nomorKamera || S.stream !== st || S.bisaFlash || !bisaSenter(tr)) return false;
      S.bisaFlash = true;
      tampilFlash();
      $('kam-flash').hidden = false;
      if (S.flash) setelSenter(tr, true);
      return true;
    };
    if (!pasang()) setTimeout(pasang, 600);              // sebagian HP baru melaporkan senter sesaat sesudah gambar pertama
  }
  function tampilFlash() {
    const b = $('kam-flash');
    b.setAttribute('aria-pressed', String(S.flash));
    b.setAttribute('aria-label', S.flash ? 'Flash nyala' : 'Flash mati');
    b.classList.toggle('nyala', S.flash);
    b.querySelector('use').setAttribute('href', S.flash ? '#i-petir' : '#i-petir-mati');
  }
  function tombolFlash() {
    S.flash = !S.flash;
    try { localStorage.setItem(KUNCI_FLASH, S.flash ? '1' : '0'); } catch (e) { /* hanya kenyamanan */ }
    tampilFlash();
    const tr = S.stream && S.stream.getVideoTracks()[0];
    if (tr && S.bisaFlash) setelSenter(tr, S.flash);
  }
  /* Putar kamera belakang ↔ depan (kamera.js v8–v9). Tampil hanya bila arah kamera terbaca dan peramban mencatat ≥ 2
     kamera. Pilihan berlaku selama halaman terbuka, tidak disimpan di HP. Pratinjau tidak dicermin. */
  const NAMA_ARAH = {user: 'Kamera depan', environment: 'Kamera belakang'};
  const arahLain = a => (a === 'user' ? 'environment' : 'user');
  function arahKamera(tr) {
    try { const a = tr && tr.getSettings ? tr.getSettings().facingMode : ''; return a === 'user' || a === 'environment' ? a : ''; } catch (e) { return ''; }
  }
  function pasangPutar(st, nomor, dari) {
    const arah = arahKamera(st.getVideoTracks()[0]);
    if (!arah) { S.bisaPutar = false; return tampilPutar(); }
    if (dari && arah === dari) {                                       // diminta kamera lain, yang menyala tetap yang sama
      S.pesanPutar = NAMA_ARAH[arahLain(dari)] + ' belum bisa dipakai di HP ini.';
      S.bisaPutar = false;
      S.putarMati = true;
    }
    S.hadap = arah;
    try { const id = st.getVideoTracks()[0].getSettings().deviceId; if (id) S.idKamera[arah] = String(id); } catch (e) { /* tanpa id */ }
    if (S.bisaPutar || (dari && arah === dari)) return tampilPutar();
    const md = navigator.mediaDevices;
    if (!md || typeof md.enumerateDevices !== 'function') return tampilPutar();
    md.enumerateDevices().then(d => {
      if (nomor !== S.nomorKamera || S.stream !== st) return;
      S.bisaPutar = !S.putarMati && Array.isArray(d) && d.filter(x => x && x.kind === 'videoinput').length >= 2;
      tampilPutar();
    }, () => { /* tanpa daftar kamera = tanpa tombol */ });
  }
  function tampilPutar() {
    const b = $('kam-putar');
    b.hidden = !S.bisaPutar;
    b.disabled = !S.stream || !!S.putarDari;
    b.setAttribute('aria-label', 'Putar ke ' + NAMA_ARAH[arahLain(S.hadap)].toLowerCase());
  }
  function tombolPutar() {
    if (!S.bisaPutar || !S.stream || S.putarDari || S.layar !== 'kamera') return;
    S.putarDari = S.hadap;
    S.hadap = arahLain(S.hadap);
    matikanKamera();          // banyak HP tidak bisa menyalakan dua kamera sekaligus: matikan yang lama dulu
    bukaKamera();
  }
  function putarGagal() {
    const gagal = S.hadap;
    S.hadap = S.putarDari;
    S.putarDari = '';
    S.pesanPutar = NAMA_ARAH[gagal] + ' belum bisa dibuka.';
    bukaKamera();
  }
  function ketPutar() {
    const t = S.pesanPutar;
    S.pesanPutar = '';
    clearTimeout(S.jamPutar);
    ket(t, true);
    if (t) S.jamPutar = setTimeout(() => { if ($('kam-ket').textContent === t) ket(''); }, UJI.pesanPutar || 2500);
  }
  /* Kamera gagal: TANPA jalan keluar lewat kamera bawaan HP atau galeri (foto cek stok wajib dari kamera langsung). */
  function kameraGagal(nama) {
    matikanKamera();
    const ditolak = nama === 'NotAllowedError' || nama === 'SecurityError';
    $('tolak-judul').textContent = ditolak || nama === 'tanpa' ? 'Kamera belum bisa dibuka' : 'Kamera belum menyala';
    $('tolak-isi').textContent = nama === 'tanpa'
      ? 'Halaman ini belum bisa membuka kamera di peramban ini. Buka lagi dari Portal di Chrome atau Safari.'
      : ditolak
        ? 'HP menolak kamera. Izinkan kamera untuk halaman ini, lalu tekan Coba nyalakan kamera lagi.'
        : 'Kamera sedang dipakai aplikasi lain. Tutup aplikasi itu, lalu tekan Coba nyalakan kamera lagi.';
    const x = S.barang.find(b => b.kunci === S.kameraUntuk);
    $('tolak-sub').textContent = x ? x.nama : '';
    tampil('tolak');
    $('t-coba-kamera').focus({preventScroll: true});
  }

  /* ---------- foto: seluruh bidang kamera, perkecil, JPEG ≤ 330 KB (aturan kamera.js) ---------- */
  function potong(src, sx, sy, sw, sh, skala) {
    const k = skala || Math.min(1, SISI_MAKS / Math.max(sw, sh));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(sw * k));
    c.height = Math.max(1, Math.round(sh * k));
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return c;
  }
  function keBlob(c, q) {
    return new Promise((res, rej) => {
      try { c.toBlob(b => (b ? res(b) : rej(new Error('jpeg'))), 'image/jpeg', q); } catch (e) { rej(e); }
    });
  }
  /* mutu mulai 0,8, turun 0,08 sampai 0,45; masih terlalu besar → sisi -20% lalu ulangi */
  async function jadikanJpeg(c) {
    for (let putaran = 0; ; putaran++) {
      let q = 0.8, b = await keBlob(c, q);
      while (b.size > BITA_MAKS && q > 0.45) { q = Math.round((q - 0.08) * 100) / 100; b = await keBlob(c, q); }
      if (b.type !== 'image/jpeg') throw new Error('jpeg');
      if (b.size <= BITA_MAKS) return {blob: b, w: c.width, h: c.height};
      if (putaran >= 4) throw new Error('besar');     // tidak pernah dikirim melebihi 330 KB
      c = potong(c, 0, 0, c.width, c.height, 0.8);
    }
  }
  function blobKeDataUrl(b) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => (typeof r.result === 'string' && r.result.indexOf(AWALAN_JPEG) === 0 ? res(r.result) : rej(new Error('jpeg')));
      r.onerror = () => rej(r.error || new Error('baca'));
      r.readAsDataURL(b);
    });
  }
  function jepret() {
    const v = $('kam-video'), b = $('kam-bidik');
    const vw = v.videoWidth, vh = v.videoHeight, W = b.clientWidth, H = b.clientHeight;
    if (!S.stream || !vw || !vh || !W || !H) return;
    $('kam-rana').disabled = true;
    /* video tampil dengan object-fit: cover: petakan bidang yang terlihat ke piksel video (seperti foto barang kamera.js) */
    const s = Math.max(W / vw, H / vh), ox = (W - vw * s) / 2, oy = (H - vh * s) / 2;
    const sx = Math.max(0, -ox / s), sy = Math.max(0, -oy / s);
    const sw = Math.min(W / s, vw - sx), sh = Math.min(H / s, vh - sy);
    let c = null;
    try { c = potong(v, sx, sy, sw, sh); } catch (e) { c = null; }
    matikanKamera();
    if (!c) return gagalFoto();
    olahFoto(c, S.kameraUntuk);
  }
  function gagalFoto() {
    matikanKamera();
    kembaliKeBarang(false);
    popup(['Foto belum terbaca', 'Coba foto lagi.', 'Foto lagi'], () => mintaKamera());
  }
  async function olahFoto(c, kunci) {
    const x = S.barang.find(b => b.kunci === kunci);
    if (!x) return;
    const d = draf(x), nomor = ++S.nomorFoto;
    d.olah = nomor;
    S.kabarOk = '';
    kembaliKeBarang(false);
    let hasil = null;
    try {
      const j = await jadikanJpeg(c), url = await blobKeDataUrl(j.blob);
      hasil = {url, b64: url.slice(AWALAN_JPEG.length), w: j.w, h: j.h};
    } catch (e) { hasil = null; }
    c.width = c.height = 0;
    if (d.olah !== nomor || draf(x) !== d) return;      // barang ini sudah dibuang/diganti selagi foto dirapikan
    d.olah = 0;
    if (!hasil) { if (S.layar === 'barang') layarBarang(false); return gagalFoto(); }
    d.foto = hasil;
    d.nomorFoto = nomor;
    d.gagal = null;
    if (S.layar === 'barang' && sekarang() === x) layarBarang(d.jumlah === '' ? 'jumlah' : true);
  }

  /* ---------- kirim ke Portal: satu permintaan (kirimSekali kamera.js) ----------
     XMLHttpRequest POST text/plain (permintaan sederhana: tanpa preflight). TIDAK ada pendengar di xhr.upload. Putus /
     batas / 'offline' = galat (ditangkap pemanggil sebagai sinyal putus). */
  function kirimSekali(badan, batasJawab) {
    return new Promise((res, rej) => {
      let x, jam = 0, beres = false;
      const akhir = (galat, j) => {
        if (beres) return;
        beres = true;
        clearTimeout(jam);
        window.removeEventListener('offline', putus);
        if (galat) rej(galat); else res(j);
      };
      const putus = () => { try { x.abort(); } catch (e) { /* diam */ } akhir(new Error('putus')); };
      const pasang = ms => { clearTimeout(jam); jam = setTimeout(putus, ms); };
      try {
        x = new XMLHttpRequest();
        x.open('POST', S.p.api, true);
        x.setRequestHeader('Content-Type', 'text/plain;charset=utf-8');
      } catch (e) { return akhir(e); }
      x.onreadystatechange = () => { if (x.readyState >= 2 && x.readyState < 4) pasang(BATAS_DIAM); };
      x.onprogress = () => pasang(BATAS_DIAM);                  // jawaban mulai tiba: diam 20 dtk = putus
      x.onload = () => {
        let j = null;
        try { j = JSON.parse(x.responseText); } catch (e) { j = null; }
        akhir(null, j && typeof j === 'object' ? j : {ok: false, kode: 'gagal'});
      };
      x.onerror = () => akhir(new Error('putus'));
      x.onabort = () => akhir(new Error('putus'));
      window.addEventListener('offline', putus);
      pasang((batasJawab || BATAS_JAWAB) + Math.ceil(badan.length * 1000 / LAJU_MIN));
      try { x.send(badan); } catch (e) { akhir(e); }
    });
  }
  /* Sinyal putus / sibuk / belum-pasti / gagal diulang 3 kali (1, 3, 7 dtk) dengan badan yang SAMA persis (idAksi sama). */
  async function kirimBerulang(badan, kabarUlang) {
    let akhir = {jaringan: true};
    for (let i = 0; i <= JEDA_ULANG.length; i++) {
      if (i > 0) {
        if (kabarUlang) kabarUlang(akhir.jaringan);
        await tunggu(JEDA_ULANG[i - 1]);
      }
      let j;
      try { j = await kirimSekali(badan); } catch (e) { akhir = {jaringan: true}; continue; }
      if (j.ok === true) return {ok: true, j};
      akhir = {kode: String(j.kode || 'gagal'), pesan: pesanPortal(j), j};
      if (!KODE_ULANG.has(akhir.kode)) break;
    }
    return akhir;
  }

  /* ---------- daftar barang hari ini (cs-daftar) ---------- */
  async function muatDaftar() {
    const nomor = ++S.nomorDaftar, p = S.p;
    layarMuat('');
    let akhir = null;
    for (let i = 0; i < 2; i++) {
      if (i > 0) await tunggu(JEDA_DAFTAR);
      if (nomor !== S.nomorDaftar || S.p !== p) return;
      let j = null;
      try { j = await kirimSekali(JSON.stringify({jenis: 'cs-daftar', t: p.t, idOutlet: p.o}), BATAS_DAFTAR); } catch (e) { j = null; }
      if (nomor !== S.nomorDaftar || S.p !== p) return;
      if (j && j.ok === true) { akhir = {j}; break; }
      akhir = j ? {kode: String(j.kode || 'gagal'), pesan: pesanPortal(j)} : {jaringan: true};
      if (j && !KODE_ULANG.has(akhir.kode)) break;               // jawaban pasti: tidak diulang
    }
    if (akhir.j) {
      const d = bacaDaftar(akhir.j, p);
      if (!d) return layarMuat(DAFTAR_RUSAK);
      catatJam(akhir.j.sampai, akhir.j.kini);
      return pakaiDaftar(d);
    }
    if (akhir.jaringan || KODE_ULANG.has(akhir.kode)) return layarMuat(DAFTAR_GAGAL);
    const kb = KABAR[akhir.kode] || (akhir.kode === 'isian' ? KABAR.token : null);
    if (KODE_BERHENTI.has(akhir.kode) || akhir.kode === 'isian') {
      return layarPesan(kb[0], akhir.pesan || (akhir.kode === 'isian' ? KABAR.token[1] : kb[1]));
    }
    return layarMuat(akhir.pesan || DAFTAR_GAGAL);                // kode tidak dikenal: boleh coba lagi
  }
  function pakaiDaftar(d) {
    S.nama = d.nama;
    S.tanggal = d.tanggal;
    S.batas = d.batas;
    S.lewat = d.lewat;
    S.batasMs = hitungBatasMs(d.tanggal, d.batas);
    S.barang = d.barang;
    S.draf = new Map();
    S.ulang = '';
    S.kabarOk = '';
    if (!S.barang.length) {
      return layarPesan('Tidak ada cek stok hari ini', 'Hari ini tidak ada barang yang perlu dihitung' + (S.nama ? ' di ' + S.nama : '') + '.');
    }
    const k = S.barang.findIndex(x => !x.terkirim);
    if (k < 0) return layarSelesai();
    bukaBarang(k, true);
  }

  /* ---------- simpan satu barang (cs-kirim) ---------- */
  async function simpan() {
    const x = sekarang();
    if (S.sibuk || S.layar !== 'barang' || !x) return;
    const d = draf(x);
    if (!siap(d)) return layarBarang(false);
    /* idAksi terikat isi: isi yang sama (ulangan, Coba kirim lagi) = idAksi sama; foto/jumlah berubah = idAksi baru */
    if (!d.idAksi || d.sidikAksi !== sidik(d)) { d.idAksi = idAcak(); d.sidikAksi = sidik(d); }
    const jumlah = Number(d.jumlah), idAksi = d.idAksi, p = S.p;
    const badan = JSON.stringify({jenis: 'cs-kirim', t: p.t, idOutlet: p.o, tanggal: S.tanggal, kunci: x.kunci, idAksi,
      jumlah, foto: d.foto.b64, w: d.foto.w, h: d.foto.h});
    S.sibuk = true;
    S.kabarKirim = '';
    d.gagal = null;
    S.kabarOk = '';
    layarBarang(false);
    const r = await kirimBerulang(badan, jaringan => {
      S.kabarKirim = jaringan ? 'Sinyal lemah, mencoba lagi…' : 'Portal sedang sibuk, mencoba lagi…';
      if (S.layar === 'barang') layarBarang(false);
    });
    if (S.p !== p) return;                                         // halaman sudah dibuka ulang dari Portal
    S.sibuk = false;
    S.kabarKirim = '';
    if (r.ok && r.j.kunci === x.kunci) return berhasil(x, d, r.j, jumlah);
    if (r.ok) r.kode = 'belum-pasti';                              // ok untuk barang lain: belum pasti, kirim lagi yang sama
    gagalKirim(x, d, r);
  }
  function berhasil(x, d, j, jumlah) {
    x.terkirim = {jumlah: jumlahSah(j.jumlah) ? j.jumlah : jumlah, jam: jamSah(j.jam) ? j.jam.replace(':', '.') : ''};
    S.draf.delete(x.kunci);
    S.ulang = '';
    S.kabarOk = 'Terkirim: ' + x.nama + ' · ' + x.terkirim.jumlah + ' botol.';
    const n = berikutnya();
    if (n < 0) return layarSelesai();
    bukaBarang(n, true);
  }
  function gagalKirim(x, d, r) {
    if (r.jaringan) {
      d.gagal = {ulang: true, teks: KABAR.jaringan[1]};
    } else if (KODE_BERHENTI.has(r.kode)) {
      const kb = KABAR[r.kode];
      return layarPesan(kb[0], r.pesan || kb[1]);
    } else if (r.kode === 'isian') {
      /* isi yang sama akan ditolak lagi: tanpa Coba kirim lagi. Foto dan jumlah tetap; Foto ulang / ubah jumlah lalu Simpan. */
      d.gagal = {ulang: false, teks: r.pesan || KABAR.isian[1]};
    } else {
      d.gagal = {ulang: true, teks: r.pesan || (KABAR[r.kode] || KABAR.gagal)[1]};
    }
    if (S.layar === 'barang' && sekarang() === x) layarBarang(false);
    const t = $('t-simpan');
    if (S.layar === 'barang' && !t.disabled) t.focus({preventScroll: true});
  }
  function ubahJumlah() {
    const x = sekarang();
    if (!x || S.sibuk) return;
    const d = draf(x), v = $('b-jumlah').value.trim();
    if (d.jumlah === v) return;
    d.jumlah = v;
    if (d.gagal && sidik(d) !== d.sidikAksi) d.gagal = null;      // isi berubah: kabar gagal lama tidak berlaku lagi
    S.kabarOk = '';
    layarBarang(false);
  }

  /* ---------- mulai ---------- */
  function mulai() {
    let p = null;
    if (location.hash.length > 1) {
      p = bacaFragmen(location.hash);
      try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* biarkan */ }
      if (!p) hapusSesi();
    } else {
      p = bacaSesi();
    }
    matikanKamera();
    tutupPopup(false);
    S.nomorDaftar++;
    S.sibuk = false;
    S.barang = [];
    S.draf = new Map();
    S.ulang = '';
    S.kabarOk = '';
    S.sisaToken = null;
    S.jamPortal = null;
    S.lewat = false;
    if (!p) {
      S.p = null;
      return layarPesan('Buka dari Portal', 'Halaman ini dibuka dari Portal Asia Group: menu Cek stok, lalu Mulai cek stok.');
    }
    S.p = p;
    S.nama = p.on;
    try { S.flash = localStorage.getItem(KUNCI_FLASH) !== '0'; } catch (e) { S.flash = true; }
    simpanSesi();
    muatDaftar();
  }
  function muatHuruf() {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap';
    document.head.appendChild(l);
  }

  $('kam-rana').addEventListener('click', jepret);
  $('kam-tutup').addEventListener('click', tutupKamera);
  $('kam-flash').addEventListener('click', tombolFlash);
  $('kam-putar').addEventListener('click', tombolPutar);
  $('t-tolak-kembali').addEventListener('click', () => kembaliKeBarang(true));
  $('t-coba-kamera').addEventListener('click', () => { if (S.kameraUntuk) bukaKamera(); });
  $('t-simpan').addEventListener('click', simpan);
  $('t-batal-ulang').addEventListener('click', batalUlang);
  $('t-coba-daftar').addEventListener('click', () => { if (S.p) muatDaftar(); });
  ['m-kembali', 'b-kembali', 't-selesai-kembali', 't-pesan-kembali'].forEach(id => $(id).addEventListener('click', kePortal));
  $('pop-tombol').addEventListener('click', () => tutupPopup(true));
  const jml = $('b-jumlah');
  jml.addEventListener('input', ubahJumlah);
  jml.addEventListener('change', ubahJumlah);
  /* Enter / Selesai di papan ketik HP menutup papan ketik saja: menyimpan tetap lewat tombol */
  jml.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); jml.blur(); } });
  document.addEventListener('keydown', e => {
    if ($('pop').hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); tutupPopup(false); } else if (e.key === 'Tab') { e.preventDefault(); $('pop-tombol').focus(); }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if (S.stream || S.layar === 'kamera') matikanKamera(); } else if (S.layar === 'kamera' && !S.stream) bukaKamera();
  });
  window.addEventListener('pagehide', matikanKamera);
  window.addEventListener('pageshow', e => { if (e.persisted && S.layar === 'kamera' && !S.stream) bukaKamera(); });
  /* Peringatan tutup: kiriman sedang berjalan, atau foto yang belum terkirim (foto hanya di memori halaman ini). */
  window.addEventListener('beforeunload', e => {
    if (S.sibuk || Array.from(S.draf.values()).some(d => d.foto || d.olah)) { e.preventDefault(); e.returnValue = ''; }
  });
  window.addEventListener('hashchange', () => { if (location.hash.length > 1 && !S.sibuk) mulai(); });
  /* kalimat batas ikut berganti bila halaman terbuka melewati 13.00 (jam Portal) */
  S.jamLewat = setInterval(() => { if (S.layar === 'barang' && !S.lewat && S.barang.length) isiKepala(); }, UJI.jamLewat || 30000);

  try { window.opener = null; } catch (e) { /* tidak ada jendela pembuka */ }
  mulai();
  setTimeout(muatHuruf, 0);
})();
