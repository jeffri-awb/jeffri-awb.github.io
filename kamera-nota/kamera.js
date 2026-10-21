'use strict';
/* Kamera nota v6 — Portal Asia Group · Supply Chain (kontrak: laporan-scm-finance-2026-10-14/BUILD.md § 5,
   foto-nota-v405-2026-10-16/BUILD.md § 6, foto-nota-v406-2026-10-16/BUILD.md § 2–§ 5,
   masukan-uji-v412-2026-10-20/BUILD.md § 4: pilihan bingkai Mendatar | Tegak,
   audit-laporan-v413-2026-10-20/BUILD.md § 5: antrean latar, unggah terasa ≤ 2 dtk).
   Dibuka Portal (menu Foto nota) di tab baru, di LAYAR NOTA: dua kotak (Foto nota, Foto barang). Kotak kosong =
   tombol kamera; kotak terisi = gambar kecil + Hapus. Kamera menyala di halaman yang sama (tanpa muat ulang), jadi
   izin kamera HP cukup ditanya sekali selama tab ini terbuka.
     v=3 (Portal v406): #v=3&api&t&o&on&f&s&g&tgl&j&jd&st&set&fn&fb&kk&kj&kc&ko&kt&ka (BUILD v406 § 5)
     v=2 (Portal v405, selama jeda rilis): #v=2&api&t&o&on&f&s&g&tgl&m&set&hal&j — m=baru → dua kotak kosong;
         m=barang|tambah|ganti → kotak nota "Sudah ada" tanpa gambar dan tanpa Hapus.
   - Fragmen (#) tidak terkirim ke hosting dan langsung dihapus dari alamat. Salinannya + keadaan terakhir yang
     diketahui (id foto, set, status; BUKAN gambar) hanya di sessionStorage tab ini, supaya muat ulang tetap jalan.
   - Kirim/hapus langsung ke Portal (doPost nota-foto / nota-hapus): POST text/plain (tanpa preflight). Server menolak
     simpan ganda: idFoto/idAksi yang sama di setiap ulangan.
   - Foto yang sudah ada di Portal dimuat lewat doPost nota-gambar dan dipasang sebagai data URL (CSP img-src data:).
   - Token foto berumur pendek; token sesi Portal tidak pernah sampai ke sini. Server memeriksa ulang akun, cabang,
     faktur, jendela 2 hari, mode, dan ukuran foto. Semua teks dari Portal ditulis lewat textContent.
   v6 (BUILD v413 § 5; rancangan audit unggah-foto A1–A9):
   - JALUR ANTREAN: jepret → potong → canvas.toBlob JPEG → IndexedDB 'kamera-nota'/'antrean' (kunci idFoto) → layar
     nota LANGSUNG dengan gambar dari blob + pil "Mengirim…". Tanpa layar kirim dan tanpa jeda 300/1200 ms.
   - Satu pengirim latar untuk semua tab (navigator.locks 'kamera-nota-kirim'), berurutan per faktur, satu kiriman
     sekaligus; XMLHttpRequest dengan batas diam 20 dtk dan tunggu jawaban ≤ 90 dtk; ulang 2/5/10/20/30/60 dtk tanpa
     batas selama halaman terbuka; dengar online/offline. Hijau "Terkirim" HANYA dari jawaban ok Portal.
   - Item dikirim hanya bila milik akun ini: dibuat di tab ini (dibuktikan token tab ini), atau `pemilik` item sama
     dengan `pemilik` jawaban Portal untuk token sekarang. Akun lain / tidak bisa dipastikan = "foto tertinggal",
     tidak dikirim. Lebih dari 72 jam = dihapus dari HP. Token TIDAK pernah ditulis ke IndexedDB.
   - JALUR SINKRON (v5 apa adanya): Portal tanpa `pemilik` (v412), alamat v=2, atau IndexedDB tidak ada/melempar.
   - K3 (bantahan peninjau): koneksi IndexedDB yang putus di tengah halaman (Safari iOS) dibuka lagi dan pekerjaannya
     diulang sekali; tetap gagal → kartu "Belum terkirim. Muat ulang halaman ini." + tombol Muat ulang, putaran kirim
     berhenti, dan Hapus/Buang foto di HP tidak berpura-pura berhasil.
   - K2 (bantahan peninjau): sisa waktu halaman dihitung dari `sampai` − `kini` jam Portal, bukan jam HP. */
(() => {
  const UJI = window.__ujiKameraNota || {};            // hanya diisi uji otomatis, untuk memperpendek jeda
  const $ = id => document.getElementById(id);
  /* Bingkai nota (BUILD v406 § 3): satu bingkai LANDSCAPE 3:2, lebar 80% bidang kamera, tinggi paling banyak 70%.
     Alasan ukuran: kamera utama HP dalam posisi tegak melihat ±50–60° mendatar. Nota selebar 21 cm yang memenuhi 80%
     lebar layar terpotret dari ±23–30 cm — cukup jauh untuk tetap fokus (kamera utama iPhone Pro fokus mulai ±20 cm),
     cukup dekat supaya tulisan terbaca. Bingkai tegak v3 lebarnya hanya ±65%, sehingga nota landscape kecil di foto
     dan admin memotret dari jauh (buram).
     v5 (BUILD v412 § 4): nota tegak yang dipaksa masuk bingkai mendatar jadi miring, maka admin memilih bentuknya di
     layar kamera. Mendatar = bawaan, persis v4. Tegak = 3:4 (lebar:tinggi), lebar paling banyak 80%, tinggi paling
     banyak 72%. Keduanya dinaikkan sedikit dari tengah. Pilihan diingat per HP (localStorage), hanya 'tegak' yang
     dikenal; nilai lain atau gagal baca = Mendatar. */
  const BINGKAI = {
    mendatar: {rasio: 3 / 2, tinggiMaks: 0.7, petunjuk: 'Masukkan nota mendatar ke dalam bingkai'},
    tegak: {rasio: 3 / 4, tinggiMaks: 0.72, petunjuk: 'Masukkan nota tegak ke dalam bingkai'}
  };
  const LEBAR_BINGKAI = 0.8, NAIK_BINGKAI = 0.04;
  const SISI_MAKS = 1600, BITA_MAKS = 330 * 1024, HAL_MAKS = 6;
  const JEDA_ULANG = UJI.jeda || [1000, 3000, 7000];
  /* Batas waktu kirim (unggah-foto-07). v5 memutus di 25 dtk TOTAL, termasuk waktu mengunggah badan 309–411 KB, sehingga
     unggahan yang sedang berjalan di sinyal lemah selalu putus. v6: jatah unggah sebanding ukuran badan (LAJU_MIN) +
     tunggu jawaban (jalur sinkron 25 dtk seperti v5 karena admin menunggu di layar; antrean latar ≤ 90 dtk), lalu
     begitu jawaban mulai tiba: diam 20 dtk tanpa kemajuan = putus. Kemajuan UNGGAH sengaja tidak dipantau: pendengar
     di xhr.upload memaksa peramban mengirim preflight CORS, dan Apps Script tidak menjawab preflight. */
  const BATAS_JAWAB = UJI.batas || 25000;
  const BATAS_JAWAB_ANTRE = UJI.batasAntre || 90000;
  const BATAS_DIAM = UJI.diam || 20000;
  const LAJU_MIN = UJI.laju || 8 * 1024;               // bita per detik (±64 kbps: gudang/basement)
  const BATAS_PERIKSA = UJI.batasPeriksa || 15000;
  const JEDA_LANGKAH3 = 300, JEDA_KEMBALI = UJI.kembali || 1200;
  const JEDA_ANTRE = UJI.jedaAntre || [2000, 5000, 10000, 20000, 30000, 60000];
  const UMUR_ANTRE = 72 * 3600 * 1000;                 // foto paling lama 72 jam di HP
  const KAMERA_HIDUP = UJI.kameraHidup || 15000;       // unggah-foto-10: kamera dibiarkan hidup bila kotak lain kosong
  const SISA_TOKEN_MIN = 10 * 60 * 1000, TOKEN_MAKS = 2 * 3600 * 1000;
  const KUNCI_SESI = 'kamera-nota-v4', KUNCI_SESI_V3 = 'kamera-nota-v2', KUNCI_FLASH = 'kamera-nota-flash';
  const KUNCI_BINGKAI = 'kamera-nota-bingkai';
  /* localStorage '1' = Portal pernah menjawab HP ini dengan `pemilik` (Portal v413). Hanya petunjuk jalur, bukan bukti
     pemilik: foto yang dijepret sebelum Portal menjawab dikirim dengan token tab ini sendiri. */
  const KUNCI_V6 = 'kamera-nota-v6';
  const NAMA_DB = 'kamera-nota', TOKO = 'antrean', KUNCI_KIRIM = 'kamera-nota-kirim';
  const KODE_ULANG = new Set(['sibuk', 'belum-pasti', 'gagal']);
  /* Jawaban yang pasti: kiriman yang sama akan ditolak lagi. Foto tidak dibuang otomatis: kotak merah + pilihan admin. */
  const KODE_TOLAK = new Set(['isian', 'akses', 'lihat', 'luar-jendela', 'data-belum']);
  /* Pemeriksaan awal hanya bertindak atas jawaban yang pasti berarti "kiriman nanti akan ditolak". Jawaban lain
     (Portal v403 yang belum mengenal pemeriksaan ini, sibuk, gagal, sinyal putus) didiamkan: unggah tetap memeriksa. */
  const KODE_PERIKSA = new Set(['token', 'sesi', 'akses', 'lihat']);
  const HEX24 = /^[a-f0-9]{24}$/, HEX16 = /^[a-f0-9]{16}$/;
  const BULAN_PENDEK = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const HARI_PENDEK = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
  const NAMA = {nota: 'Foto nota', barang: 'Foto barang'};

  /* Kabar gagal (BUILD v402 § 9): [judul, isi, tombol, tindakan]. tindakan 'ulang' = kirim lagi yang sama,
     'tutup' = tidak ada yang bisa dilakukan dari halaman ini, kembali ke Portal. */
  const KABAR = {
    token: ['Buka lagi dari Portal', 'Tutup halaman ini, kembali ke Portal, lalu pilih notanya lagi.', 'Tutup', 'tutup'],
    akses: ['Belum ada akses', 'Akun ini belum diberi akses untuk ini. Minta Pak Jeffri menambahkannya di Akun & akses.',
      'Tutup', 'tutup'],
    lihat: ['Mode lihat saja', 'Anda sedang melihat sebagai akun lain, jadi tidak bisa menyimpan.', 'Tutup', 'tutup'],
    'luar-jendela': ['Lewat batas 2 hari', 'Nota hanya bisa difoto sampai 2 hari ke belakang. Kabari Purchasing pusat ' +
      'kalau nota ini masih perlu.', 'Tutup', 'tutup'],
    'data-belum': ['Data WePOS belum masuk', 'Faktur cabang ini untuk tanggal itu belum terbaca dari WePOS. Coba lagi ' +
      'sesudah jam 10.00. Kalau sampai siang belum ada, kabari Pak Jeffri.', 'Tutup', 'tutup'],
    sibuk: ['Sedang ramai', 'Portal sedang menyimpan pekerjaan lain. Tunggu sebentar lalu coba lagi.', 'Coba lagi', 'ulang'],
    'belum-pasti': ['Belum pasti tersimpan', 'Tekan Coba lagi. Yang sama tidak akan tersimpan dua kali.', 'Coba lagi',
      'ulang'],
    gagal: ['Belum berhasil', 'Ada gangguan di Portal dan sudah tercatat otomatis. Coba lagi; kalau masih gagal, kabari ' +
      'Pak Jeffri.', 'Coba lagi', 'ulang'],
    jaringan: ['Koneksi terputus', 'Periksa sinyal atau Wi-Fi, lalu coba lagi.', 'Coba lagi', 'ulang']
  };
  KABAR.sesi = KABAR.token;
  /* v6 (unggah-foto-06): sisa waktu halaman pendek → berhenti SEBELUM memotret, bukan sesudah fotonya ditolak. */
  const KABAR_HAMPIR = ['Buka lagi dari Portal', 'Waktu halaman ini hampir habis. Tutup halaman ini, kembali ke Portal, ' +
    'lalu pilih notanya lagi supaya fotonya bisa terkirim.', 'Tutup', 'tutup'];
  const BELUM_TERKIRIM = 'Belum terkirim. Periksa sinyal lalu tekan Kirim ulang. Foto masih di halaman ini, jangan tutup dulu.';
  /* v6 K3 (bantahan peninjau): koneksi IndexedDB putus di tengah halaman (Safari iOS "Connection to Indexed Database server
     lost") dan tidak bisa dibuka lagi → halaman berkata jujur dan minta dimuat ulang (koneksi baru), tidak berpura-pura
     "Mengirim…" dan tidak menjawab Hapus dengan "Dihapus" yang tidak menghapus foto di HP. */
  const KARTU_RUSAK = ['Belum terkirim. Muat ulang halaman ini.',
    'Foto yang belum terkirim masih tersimpan di HP ini dan dikirim lagi sesudah halaman dimuat ulang.'];
  const KABAR_MUAT = ['Muat ulang halaman ini', 'Foto sebelumnya belum terkirim. Muat ulang halaman ini dulu, lalu foto lagi.',
    'Muat ulang', 'muat'];
  const BELUM_HAPUS = 'Belum bisa dihapus. Muat ulang halaman ini lalu coba lagi.';
  /* G3-K3-01 (tinjau ulang gelombang 3): memori HP penuh — koneksinya sehat, jadi muat ulang tidak menolong. Foto baru
     dikirim langsung (jalur v5); yang perlu ditulis ke HP menunggu sampai memori HP dikosongkan sedikit. */
  const BELUM_HAPUS_PENUH = 'Belum bisa dihapus: memori HP penuh. Kosongkan sedikit memori HP, lalu coba lagi.';
  const KIRIM_PENUH = 'Memori HP penuh: foto dikirim langsung';
  const IDB_DIAM = UJI.idbDiam || 10000;               // transaksi tanpa kabar selama ini = koneksi dianggap putus

  const S = {
    p: null,                       // fragmen yang sudah diperiksa (v=2 atau v=3)
    set: '', status: '', nota: [], barang: '', notaLama: false, kk: '', baru: {nota: false, barang: false},
    gambar: {},                    // idFoto → {st: 'muat'|'ok'|'gagal', url}; tidak pernah disimpan ke sessionStorage
    apa: 'nota', stream: null, nomorKamera: 0, layar: '', flash: true, bisaFlash: false, bingkai: 'mendatar',
    foto: null, sibuk: false, terkirim: false, berubah: false, nomorPeriksa: 0, nomorKirim: 0, jamKembali: 0,
    hapus: {nota: null, barang: null}, sibukHapus: '',
    /* v6 */
    tab: '',                       // id acak tab ini (sessionStorage), terikat token tab ini: bukti milik foto yang dijepret di sini
    pemilik: '', server: '',       // pemilik = sidik akun dari jawaban Portal; server '' belum tahu | 'baru' (v413) | 'lama' (v412)
    tokenMati: false, sisaToken: null, ulangPeriksa: 0, jamPeriksa: 0, periksaJalan: false,
    antre: [],                     // salinan isi IndexedDB, urut dibuat
    url: new Map(), dataUrl: new Map(), hijau: {}, ganti: {nota: '', barang: ''},
    ragu: {nota: null, barang: null}, raguCalon: null, urut: 0, kedaluwarsa: 0, menungguTutup: false, jamKamera: 0,
    lepas: new Set()               // G6-K-01: id foto ditolak yang sudah diganti foto baru di Portal; tidak tampil lagi di halaman ini
  };

  /* ---------- bantuan kecil ---------- */
  function idAcak() {
    const b = new Uint8Array(12);
    crypto.getRandomValues(b);
    return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
  }
  function rupiah(v) {
    const n = Number(v);
    if (String(v).trim() === '' || !isFinite(n)) return '';
    return 'Rp' + String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }
  function tanggalPendek(t) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
    return m ? Number(m[3]) + ' ' + BULAN_PENDEK[Number(m[2]) - 1] + ' ' + m[1] : '';
  }
  function hariPendek(t) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
    if (!m) return '';
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return HARI_PENDEK[d.getDay()] + ', ' + Number(m[3]) + ' ' + BULAN_PENDEK[Number(m[2]) - 1];
  }
  function tunggu(ms) { return new Promise(r => setTimeout(r, ms)); }
  function sesudahGambar(fn) { requestAnimationFrame(() => setTimeout(fn, 0)); }
  function huruf(s) { return Array.from(s).length; }
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
  const kertas = () => S.p.j || S.p.f;

  /* ---------- data dari Portal ---------- */
  const KUNCI_V2 = ['v', 'api', 't', 'o', 'on', 'f', 's', 'g', 'tgl', 'm', 'set', 'hal', 'j'];
  const KUNCI_V3 = ['v', 'api', 't', 'o', 'on', 'f', 's', 'g', 'tgl', 'j', 'jd', 'st', 'set', 'fn', 'fb', 'kk', 'kj', 'kc', 'ko', 'kt', 'ka'];
  function bacaFragmen(h) {
    const q = new URLSearchParams(String(h || '').replace(/^#/, ''));
    const v = (q.get('v') || '').trim(), p = {};
    (v === '3' ? KUNCI_V3 : KUNCI_V2).forEach(k => { p[k] = (q.get(k) || '').trim(); });
    p.j = p.j.slice(0, 64).trim();
    return sah(p) ? p : null;
  }
  function sahDasar(p) {
    return /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{10,}\/exec$/.test(p.api)
      && /^[a-f0-9]{32}$/.test(p.t)
      && /^[A-Za-z0-9_-]{2,40}$/.test(p.o)
      && typeof p.f === 'string' && p.f.length > 0 && p.f.length <= 64
      && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(p.tgl)
      && ['on', 's', 'g', 'j'].every(k => typeof p[k] === 'string') && p.j.length <= 64;
  }
  /* Daftar putih per versi (BUILD v406 § 5): yang cacat = layar "Buka dari Portal". */
  function sah(p) {
    if (!p || typeof p !== 'object') return false;
    if (p.v === '2') {
      return sahDasar(p) && typeof p.m === 'string' && /^(baru|tambah|ganti|barang)$/.test(p.m)
        && (p.m === 'baru' || /^[A-Za-z0-9_-]{6,64}$/.test(String(p.set)))
        && (p.m !== 'ganti' || /^[1-6]$/.test(String(p.hal)));
    }
    if (p.v !== '3' || !KUNCI_V3.every(k => typeof p[k] === 'string')) return false;
    const fn = p.fn ? p.fn.split(',') : [];
    return sahDasar(p)
      && /^(terima|beli)$/.test(p.jd)
      && /^(belum|kurang|sudah|ditolak)$/.test(p.st)
      && (p.set === '' || HEX24.test(p.set))
      && fn.length <= HAL_MAKS && fn.every(x => HEX24.test(x)) && new Set(fn).size === fn.length
      && (!fn.length || p.set !== '')                          // halaman nota selalu milik satu set
      && (p.fb === '' || HEX24.test(p.fb))
      && /^(tolak|minta|cocok|tunggu)?$/.test(p.kk)
      && /^(nota|barang)?$/.test(p.kt)
      && huruf(p.kj) <= 120 && huruf(p.kc) <= 300 && huruf(p.ko) <= 80 && huruf(p.ka) <= 200;
  }
  function keadaanAwal(p) {
    if (p.v === '3') {
      const fn = p.fn ? p.fn.split(',') : [];
      return {set: p.set, status: p.st, nota: fn.map((idFoto, i) => ({idFoto, halaman: i + 1})), barang: p.fb,
        notaLama: false, kk: p.kk, baru: {nota: false, barang: false}};
    }
    return {set: p.m === 'baru' ? '' : p.set, status: '', nota: [], barang: '', notaLama: p.m !== 'baru', kk: '',
      baru: {nota: false, barang: false}};
  }
  function sahKeadaan(k) {
    return !!k && typeof k === 'object' && typeof k.set === 'string' && (k.set === '' || /^[A-Za-z0-9_-]{6,64}$/.test(k.set))
      && /^(belum|kurang|sudah|ditolak)?$/.test(String(k.status))
      && Array.isArray(k.nota) && k.nota.length <= HAL_MAKS && k.nota.every(x => x && HEX24.test(x.idFoto) && Number(x.halaman) >= 1)
      && typeof k.barang === 'string' && (k.barang === '' || HEX24.test(k.barang))
      && typeof k.notaLama === 'boolean' && /^(tolak|minta|cocok|tunggu)?$/.test(String(k.kk))
      && !!k.baru && typeof k.baru.nota === 'boolean' && typeof k.baru.barang === 'boolean';
  }
  function pakaiKeadaan(k) {
    S.set = k.set; S.status = k.status; S.nota = k.nota.map(x => ({idFoto: x.idFoto, halaman: Number(x.halaman)}));
    S.barang = k.barang; S.notaLama = k.notaLama; S.kk = k.kk; S.baru = {nota: k.baru.nota, barang: k.baru.barang};
  }
  /* sessionStorage menyimpan keadaan PORTAL yang terakhir diketahui (bukan foto yang masih antre) + id tab (v6). */
  function simpanSesi() {
    if (!S.p) return;
    const k = {set: S.set, status: S.status, nota: S.nota, barang: S.barang, notaLama: S.notaLama, kk: S.kk, baru: S.baru};
    try { sessionStorage.setItem(KUNCI_SESI, JSON.stringify({p: S.p, k, tab: S.tab})); } catch (e) { /* tanpa simpanan: muat ulang minta buka dari Portal */ }
  }
  function bacaSesi() {
    try {
      const x = JSON.parse(sessionStorage.getItem(KUNCI_SESI) || 'null');
      if (x && sah(x.p)) return {p: x.p, k: sahKeadaan(x.k) ? x.k : keadaanAwal(x.p), tab: HEX24.test(String(x.tab)) ? x.tab : ''};
      /* tab yang terbuka sejak halaman v3: salinannya berbentuk alamat v=2 */
      const lama = JSON.parse(sessionStorage.getItem(KUNCI_SESI_V3) || 'null');
      if (lama && typeof lama === 'object' && lama.j === undefined) lama.j = '';
      if (lama && lama.v === '2' && sah(lama)) return {p: lama, k: keadaanAwal(lama), tab: ''};
    } catch (e) { /* abaikan */ }
    return null;
  }
  function hapusSesi() {
    try { sessionStorage.removeItem(KUNCI_SESI); sessionStorage.removeItem(KUNCI_SESI_V3); } catch (e) { /* abaikan */ }
  }

  /* ---------- keadaan dua kotak ---------- */
  const adaNota = () => S.nota.length > 0 || S.notaLama;
  const adaBarang = () => !!S.barang;
  const ada = apa => (apa === 'nota' ? adaNota() : adaBarang());
  const cocok = () => S.kk === 'cocok';
  /* Kotak target tolakan/permintaan (kt) bertepi merah selama tolakan/permintaannya belum dijawab foto baru. */
  const target = apa => (S.kk === 'tolak' || S.kk === 'minta') && S.p.kt === apa;
  /* Hapus hanya untuk alamat v=3 (server v406 mengenal nota-hapus), bukan foto yang sudah dicek cocok, dan bukan
     kotak "Sudah ada" dari alamat v=2 yang tidak membawa id foto. v6: foto yang masih antre boleh dihapus (belum
     dikirim = batal di HP; sudah dikirim = hapus antre di belakangnya); foto yang gagal punya Foto ulang / Buang. */
  function bolehHapus(apa) {
    if (S.p.v !== '3' || cocok()) return false;
    const a = akhirSlot(apa);
    if (a) return a.jenis === 'foto' && a.status === 'antre';
    return apa === 'nota' ? S.nota.length > 0 : adaBarang();
  }
  /* Alamat v=2 (Portal v405): server v405 menolak foto barang sebelum ada foto nota. */
  const tungguNota = apa => apa === 'barang' && S.p.v === '2' && !adaNota();

  /* Kotak keadaan sesudah jawaban Portal (BUILD v406 § 2 + § 6.4): tolakan/permintaan berakhir begitu kotak targetnya
     diisi foto baru; status `sudah` dengan dua kotak terisi = "Menunggu dicek Purchasing."; cocok tidak berubah. */
  function perbaruiKeadaan() {
    if (S.kk === 'cocok') return;
    if (S.kk === 'tolak' || S.kk === 'minta') {
      const t = S.p.kt, beres = t ? S.baru[t] : S.status === 'sudah';
      if (!beres || S.status === 'ditolak') return;
    }
    S.kk = S.status === 'sudah' && adaNota() && adaBarang() ? 'tunggu' : '';
  }
  /* Keadaan di jawaban ok nota-foto / nota-hapus (BUILD v406 § 6.4), dan v413 juga di jawaban isian (unggah-foto-05).
     Cacat atau tidak ada (Portal v405) → null. */
  function bacaKeadaanJawaban(j) {
    if (!j || typeof j.status !== 'string' || !/^(belum|kurang|sudah|ditolak)$/.test(j.status) || !Array.isArray(j.nota)) return null;
    const idSet = typeof j.idSet === 'string' ? j.idSet : '', barang = typeof j.barang === 'string' ? j.barang : '';
    if ((idSet && !HEX24.test(idSet)) || (barang && !HEX24.test(barang)) || j.nota.length > HAL_MAKS) return null;
    const nota = [];
    for (const x of j.nota) {
      if (!x || typeof x !== 'object' || !HEX24.test(String(x.idFoto)) || !(Number(x.halaman) >= 1)) return null;
      nota.push({idFoto: x.idFoto, halaman: Number(x.halaman)});
    }
    nota.sort((a, b) => a.halaman - b.halaman);
    return {status: j.status, idSet, nota, barang};
  }
  function statusSetempat() { return !adaNota() ? 'belum' : !adaBarang() ? 'kurang' : 'sudah'; }
  function terapkanJawaban(j, asal) {
    const kd = bacaKeadaanJawaban(j);
    if (kd) {
      S.status = kd.status; S.set = kd.idSet; S.nota = kd.nota; S.barang = kd.barang; S.notaLama = false;
    } else if (asal.jenis === 'foto' && asal.apa === 'nota') {
      /* jawaban Portal v405: tebak dari kiriman sendiri */
      S.nota = [{idFoto: asal.idFoto, halaman: Number(j.halaman) || 1}];
      S.set = typeof j.idSet === 'string' && j.idSet ? j.idSet : asal.idSet;
      S.notaLama = false;
      if (S.status) S.status = statusSetempat();
    } else if (asal.jenis === 'foto') {
      S.barang = asal.idFoto;
      if (S.status) S.status = statusSetempat();
    } else if (asal.jenis === 'hapus') {
      if (asal.apa === 'nota') { S.nota = []; S.set = ''; S.notaLama = false; } else S.barang = '';
      if (S.status) S.status = statusSetempat();
    }
  }

  /* ---------- v6: antrean di HP (IndexedDB) ----------
     Item: {idFoto (kunci; idAksi untuk hapus), jenis 'foto'|'hapus', apa, mode, idSet, idOutlet, faktur, tanggal, w, h,
     sumber, blob, dibuat, urut, pemilik, tab, status 'antre'|'gagal', percobaan, lagiPada, sebab, kode, pesan}.
     TIDAK ada token di sini: token hanya di sessionStorage tab yang dibuka Portal. */
  /* pernah = halaman ini pernah membuka IndexedDB (antrean dipakai); rusak = koneksi putus dan tidak bisa dibuka lagi
     (v6 K3: halaman minta dimuat ulang); terbaca = isi antrean pernah terbaca utuh di halaman ini. */
  /* penuh (G3-K3-01): tulisan terakhir ke IndexedDB ditolak pada koneksi yang sehat (memori HP penuh); hilang lagi begitu
     ada put yang berhasil */
  const DB = {db: null, buka: null, pernah: false, rusak: false, terbaca: false, penuh: false};
  function idbBuka() {
    if (DB.buka) return DB.buka;
    DB.buka = new Promise(res => {
      let jam = 0, beres = false, r = null;
      const akhir = db => {
        if (beres) { if (db) { try { db.close(); } catch (e) { /* diam */ } } return; }
        beres = true;
        clearTimeout(jam);
        DB.db = db;
        if (db) DB.pernah = true;
        res(db);
      };
      jam = setTimeout(() => akhir(null), 3000);
      try { r = window.indexedDB.open(NAMA_DB, 1); } catch (e) { return akhir(null); }   // mode privat / diblokir: jalur v5
      r.onupgradeneeded = () => { try { r.result.createObjectStore(TOKO, {keyPath: 'idFoto'}); } catch (e) { /* sudah ada */ } };
      r.onsuccess = () => {
        const db = r.result;
        db.onversionchange = () => { try { db.close(); } catch (e) { /* diam */ } lepasIdb(db); };
        /* v6 K3: koneksi yang ditutup peramban (Safari iOS: "Connection to Indexed Database server lost") dilepas, supaya
           pemakaian berikutnya membuka koneksi BARU — dulu janji idbBuka diingat selamanya dengan koneksi mati. */
        db.onclose = () => lepasIdb(db);
        akhir(db);
      };
      r.onerror = () => akhir(null);
      r.onblocked = () => akhir(null);
    });
    return DB.buka;
  }
  /* Lepas koneksi yang mati: DB.db dan janji bukanya di-null-kan → idbBuka berikutnya membuka koneksi baru. Koneksi yang
     sudah diganti koneksi lain tidak menyentuh apa pun (dua kegagalan serentak = satu koneksi baru). */
  function lepasIdb(db) {
    if (!db || DB.db !== db) return;
    DB.db = null;
    DB.buka = null;
    try { db.close(); } catch (e) { /* koneksi yang sudah mati */ }
  }
  function galatIdb(nama, pesan) { const e = new Error(pesan); e.name = nama; return e; }
  /* Galat yang berarti KONEKSI (bukan isi): transaction() melempar pada koneksi tertutup (InvalidStateError) atau server
     IndexedDB hilang (UnknownError, Safari iOS); transaksi dibatalkan karena koneksinya ditutup paksa (AbortError / tanpa
     galat); transaksi diam tanpa kabar. QuotaExceededError / DataCloneError / ConstraintError BUKAN koneksi. */
  const IDB_PUTUS = ['InvalidStateError', 'UnknownError', 'AbortError', 'TransactionInactiveError', 'TimeoutError'];
  const putusIdb = e => !e || IDB_PUTUS.indexOf(e.name) >= 0;
  function idbKerjaSekali(mode, kerja) {
    return new Promise((res, rej) => {
      let t, hasil, jam = 0;
      const gagal = e => { clearTimeout(jam); rej(e); };
      /* G3-K3-01: galat yang datang dari kejadian transaksi (onerror/onabort) ditandai `dariTransaksi`: transaksinya
         sudah berhasil dibuat. Safari iOS yang memorinya penuh menolak put di tingkat permintaan (QuotaExceededError /
         UnknownError "Unable to store record…"), dan saat kejadian error itu tiba t.error masih kosong → AbortError. */
      const dariT = () => {
        const e = t.error || galatIdb('AbortError', 'idb');
        try { e.dariTransaksi = true; } catch (x) { /* galat beku: dianggap koneksi */ }
        return e;
      };
      if (!DB.db) return rej(galatIdb('InvalidStateError', 'koneksi tertutup'));
      try {
        t = DB.db.transaction(TOKO, mode);
        hasil = kerja(t.objectStore(TOKO));
      } catch (e) { return rej(e); }
      /* G3-K3-02: transaksi yang dianggap diam DIBATALKAN, supaya tulisannya tidak tersimpan terlambat sesudah
         pekerjaannya diulang atau fotonya dikirim lewat jalur v5 (close() saja tidak membatalkan transaksi yang menunggu) */
      jam = setTimeout(() => {
        try { t.abort(); } catch (e) { /* sudah selesai */ }
        gagal(galatIdb('TimeoutError', 'transaksi diam'));
      }, IDB_DIAM);
      t.oncomplete = () => { clearTimeout(jam); res(typeof IDBRequest === 'function' && hasil instanceof IDBRequest ? hasil.result : hasil); };
      t.onerror = () => gagal(dariT());
      t.onabort = () => gagal(dariT());
    });
  }
  /* Tulisan ditolak dengan galat isi/ruang (bukan koneksi) = memori HP penuh: QuotaExceededError di mana pun, atau
     galat transaksi pada koneksi yang baru berhasil dibuka (dipanggil hanya untuk percobaan itu). */
  function catatPenuh(mode, e, koneksiBaru) {
    if (mode === 'readwrite' && !!e && (e.name === 'QuotaExceededError' || (koneksiBaru && !!e.dariTransaksi))) DB.penuh = true;
  }
  /* v6 K3: koneksi putus → lepas, buka koneksi baru, ulangi SEKALI (pekerjaannya satu transaksi: yang batal tidak menulis
     apa pun — yang diam dibatalkan lebih dulu (G3-K3-02); bila abort() terlambat karena transaksinya sudah selesai,
     tulisannya sama dengan ulangannya: put item yang sama / hitungan percobaan, jadi diulang tetap aman). Tetap gagal /
     tidak bisa dibuka lagi → halaman ditandai rusak (kartu "Muat ulang"). Sesudah rusak IndexedDB tidak disentuh lagi
     sampai halaman dimuat ulang.
     G3-K3-01: tulisan (readwrite) yang transaksinya berhasil dibuat di koneksi BARU lalu ditolak = memori HP penuh, bukan
     putus: galatnya dilempar ke pemanggil (foto baru → jalur v5, A8) dan halaman TIDAK ditandai rusak. Rusak tetap untuk
     transaction() yang melempar, koneksi yang tidak bisa dibuka lagi, transaksi diam, dan bacaan yang gagal. */
  async function idbKerja(mode, kerja) {
    if (DB.rusak) throw galatIdb('InvalidStateError', 'antrean rusak');
    const db0 = DB.db;
    try { return await idbKerjaSekali(mode, kerja); } catch (e) {
      if (!putusIdb(e)) { catatPenuh(mode, e, false); throw e; }
      lepasIdb(db0);
      if (!(await idbBuka())) { tandaiIdbRusak(); throw e; }
      try { return await idbKerjaSekali(mode, kerja); } catch (e2) {
        if (putusIdb(e2) && !(e2.dariTransaksi && mode === 'readwrite')) { lepasIdb(DB.db); tandaiIdbRusak(); } else catatPenuh(mode, e2, true);
        throw e2;
      }
    }
  }
  /* Antrean di HP bisa dipakai: koneksi hidup, atau pernah hidup di halaman ini (dibuka lagi saat dipakai) dan belum rusak. */
  const idbAda = () => !DB.rusak && (!!DB.db || DB.pernah);
  async function bukaUlangIdb() {
    if (DB.db) return DB.db;
    if (!DB.pernah || DB.rusak) return null;
    const db = await idbBuka();
    if (!db) tandaiIdbRusak();
    return db;
  }
  function tandaiIdbRusak() {
    if (DB.rusak) return;
    DB.rusak = true;
    clearTimeout(jamBangun);                                    // putaran 2 dtk berhenti: halaman tidak bisa mengirim lagi
    if (S.p) segarkan();
  }
  const idbSemua = () => idbKerja('readonly', st => st.getAll());
  /* put yang berhasil = ada ruang lagi (G3-K3-01); delete tidak membuktikan apa pun karena tidak butuh ruang */
  const idbTaruh = x => idbKerja('readwrite', st => { st.put(x); }).then(() => { DB.penuh = false; });
  const idbBuang = id => idbKerja('readwrite', st => { st.delete(id); });
  /* Baca-ubah-tulis dalam SATU transaksi (atomik terhadap tab lain): ubah(x) → item baru (ditulis), null (dihapus),
     atau undefined (dibiarkan). Hasil {sebelum, sesudah}. */
  function idbUbah(id, ubah) {
    return idbKerja('readwrite', st => {
      const o = {sebelum: null, sesudah: null}, q = st.get(id);
      q.onsuccess = () => {
        const x = q.result || null;
        o.sebelum = o.sesudah = x;
        if (!x) return;
        const y = ubah(x);
        if (y === null) { st.delete(id); o.sesudah = null; } else if (y) { st.put(y); o.sesudah = y; }
      };
      return o;
    }).then(o => { if (o.sesudah && o.sesudah !== o.sebelum) DB.penuh = false; return o; });
  }
  /* Isi IndexedDB bisa ditulis halaman lain di asal yang sama: bentuknya diperiksa dulu, yang cacat tidak dikirim. */
  function sahItem(x) {
    return !!x && typeof x === 'object' && HEX24.test(String(x.idFoto)) && (x.jenis === 'foto' || x.jenis === 'hapus')
      && (x.apa === 'nota' || x.apa === 'barang') && typeof x.idOutlet === 'string' && typeof x.faktur === 'string'
      && typeof x.idSet === 'string' && (x.idSet === '' || HEX24.test(x.idSet)) && (x.status === 'antre' || x.status === 'gagal')
      && typeof x.tab === 'string' && typeof x.pemilik === 'string' && isFinite(Number(x.dibuat))
      && (x.jenis === 'hapus' || ((x.mode === 'baru' || x.mode === 'barang') && !!x.blob));
  }
  async function muatAntrean() {
    if (!idbAda()) return S.antre;
    let semua;
    /* gagal = salinan terakhir; v6 K3: bila koneksinya putus dan tidak bisa dibuka lagi, halaman sudah ditandai rusak
       (kotak "Belum terkirim" + kartu Muat ulang), jadi salinan lama tidak lagi tampil sebagai "Mengirim…" */
    try { semua = await idbSemua(); } catch (e) { return S.antre; }
    DB.terbaca = true;
    S.antre = (Array.isArray(semua) ? semua : []).filter(x => sahItem(x) && !S.lepas.has(x.idFoto))
      .sort((a, b) => (Number(a.dibuat) - Number(b.dibuat)) || (Number(a.urut) - Number(b.urut)));
    const masih = new Set(S.antre.map(x => x.idFoto));
    for (const [id, url] of S.url) {
      if (!masih.has(id) && !(S.gambar[id] && S.gambar[id].url === url)) { try { URL.revokeObjectURL(url); } catch (e) { /* diam */ } S.url.delete(id); }
    }
    return S.antre;
  }
  const umurLewat = x => !(Date.now() - Number(x.dibuat) < UMUR_ANTRE);
  const milikTab = x => !!S.tab && x.tab === S.tab;
  const milikAkun = x => milikTab(x) || (!!S.pemilik && x.pemilik === S.pemilik);
  /* Pasti tidak dikirim dari akun ini: Portal sudah menyebut pemilik lain, atau Portal lama tidak menyebut pemilik. */
  const tertinggal = x => !milikAkun(x) && (!!S.pemilik || S.server === 'lama');
  const fakturIni = x => !!S.p && x.idOutlet === S.p.o && x.faktur === S.p.f;
  /* Urutan item tab ini untuk satu kotak faktur ini; yang terakhir menentukan tampilan kotak. */
  function urutanSlot(apa) {
    return S.antre.filter(x => fakturIni(x) && x.apa === apa && milikAkun(x) && !umurLewat(x) && (x.jenis === 'foto' || x.status === 'antre'));
  }
  function akhirSlot(apa) { const u = urutanSlot(apa); return u.length ? u[u.length - 1] : null; }
  /* Kotak dianggap terisi: foto antre terakhir (optimis), atau foto Portal tanpa hapus yang menunggu. */
  function adaTampil(apa) {
    const a = akhirSlot(apa);
    if (!a) return ada(apa);
    return a.jenis === 'foto' && a.status === 'antre';
  }
  /* Set foto barang (BUILD v406 § 2): set nota sekarang — nota yang masih antre ikut dihitung (rancangan A2), supaya
     foto barang memakai set yang sama; nota yang menunggu dihapus = tanpa set.
     G7-GANTI-02 (tinjau ulang gelombang 7): foto nota yang DITOLAK Portal tidak pernah masuk Portal, jadi bukan tanda
     "tanpa set". Dulu foto gagal terakhir memberi set kosong → foto barang lewat antrean memakai set acak dan ditolak
     "Foto nota ini baru saja berubah" walau Portal sudah punya nota (mis. dari HP lain). Hapus yang menunggu tetap = tanpa set. */
  function setSekarang() {
    const u = urutanSlot('nota').filter(x => !(x.jenis === 'foto' && x.status === 'gagal')), a = u.length ? u[u.length - 1] : null;
    if (a) return a.jenis === 'foto' ? a.idSet : '';
    return adaNota() && S.set ? S.set : '';
  }
  /* G8-SET-02 (tinjau ulang gelombang 8): foto barang lewat jalur kirim langsung (memori HP penuh) memakai set foto nota
     halaman ini yang masih antre (mungkin sedang dikirim), sama dengan jalur antrean. Dulu hanya set nota Portal → set
     acak selagi nota itu belum dijawab → barang ditolak "Foto nota ini baru saja berubah". Foto nota yang ditolak dan
     hapus yang menunggu sengaja tidak dipakai di sini: tetap aturan lama (set nota Portal bila ada). */
  function setNotaAntre() { const a = akhirSlot('nota'); return a && a.jenis === 'foto' && a.status === 'antre' ? a.idSet : ''; }
  const blobDari = x => (x.blob instanceof Blob ? x.blob : new Blob([x.blob], {type: 'image/jpeg'}));
  function urlItem(x) {
    let u = S.url.get(x.idFoto);
    if (!u) { try { u = URL.createObjectURL(blobDari(x)); S.url.set(x.idFoto, u); } catch (e) { u = ''; } }
    return u;
  }
  /* Token kamera berlaku untuk cabang-cabang yang dipilih Portal (lbSesiTokenFoto_), jadi halaman ini hanya mengirim foto
     cabangnya sendiri; foto cabang lain menunggu halaman cabang itu. */
  const cabangIni = x => !!S.p && x.idOutlet === S.p.o;
  const antreSendiri = () => S.antre.filter(x => milikAkun(x) && cabangIni(x) && x.status === 'antre' && !umurLewat(x));
  /* v6 K3: antrean rusak dan faktur ini masih punya foto/hapus di HP (atau antreannya belum pernah terbaca) → jangan
     memotret atau menghapus dulu: jalur v5 akan mengacak urutan per faktur. Muat ulang = koneksi baru. */
  const perluMuatUlang = () => DB.rusak && (!DB.terbaca || S.antre.some(x => fakturIni(x) && milikAkun(x) && !umurLewat(x)));

  /* ---------- layar ---------- */
  function tampil(nama) {
    S.layar = nama;
    ['nota', 'kamera', 'kirim', 'tolak', 'pesan', 'tunggu'].forEach(n => { $(n).hidden = n !== nama; });
    try { $('warna-tema').setAttribute('content', nama === 'kamera' ? '#000000' : '#ffffff'); } catch (e) { /* hanya warna bilah */ }
    if (nama === 'kamera') letakKotak();
  }
  function isiKepala() {
    const p = S.p, tebal = p.j || p.s || p.f;
    const jenis = p.v === '3' ? p.jd : /^RL\d/i.test(p.f) ? 'terima' : 'beli';
    $('n-judul').textContent = tebal;
    $('n-sub').textContent = [tebal === p.s ? '' : p.s, rupiah(p.g), hariPendek(p.tgl)].filter(Boolean).join(' · ');
    $('n-jenis').textContent = jenis === 'terima' ? 'Receiving PO' : 'Pembelian langsung';
    $('n-jenis').className = 'pil-jenis ' + jenis;
    $('kirim-sub').textContent = [p.s, p.on, tanggalPendek(p.tgl)].filter(Boolean).join(' · ');
    $('tolak-sub').textContent = [tebal, tebal === p.s ? '' : p.s].filter(Boolean).join(' · ');
  }
  function isiKeadaan() {
    const box = $('n-keadaan'), p = S.p, kk = S.kk;
    let judul = '', catatan = '', oleh = '', aksi = '';
    if (kk === 'tolak') {
      judul = p.kj || 'Ditolak Purchasing';
      catatan = p.kc ? '“' + p.kc + '”' : '';
      oleh = p.ko;
      /* Kalimat tindakan dari Portal (ka, satu sumber kalimat). Kosong = diturunkan dari kotak target dan isinya. */
      const t = p.kt === 'barang' ? 'barang' : 'nota';
      aksi = p.ka ? p.ka : t === 'barang'
        ? (adaBarang() ? 'Hapus foto barang, lalu foto ulang sampai jelas.' : 'Foto ulang barangnya sampai jelas.')
        : (adaNota() ? 'Hapus foto nota, lalu foto ulang sampai jelas.' : 'Foto ulang notanya sampai jelas dan tidak terpotong.');
    } else if (kk === 'minta') {
      judul = p.kj || (p.kt === 'barang' ? 'Purchasing minta foto barangnya.' : 'Purchasing minta nota ini difoto.');
      catatan = p.kc ? '“' + p.kc + '”' : '';
      oleh = p.ko;
    } else if (kk === 'cocok') {
      judul = 'Sudah dicek cocok. Foto tidak bisa diubah.';
      oleh = p.ko || '';
    } else if (kk === 'tunggu') {
      judul = 'Menunggu dicek Purchasing.';
    }
    box.hidden = !kk;
    box.className = 'keadaan' + (kk ? ' ' + kk : '');
    $('k-judul').textContent = judul;
    $('k-catatan').textContent = catatan;
    $('k-oleh').textContent = oleh || '';
    $('k-aksi').textContent = aksi;
  }
  /* Isi kotak dibangun ulang hanya bila tampilannya berubah: pengirim latar memperbarui layar berkali-kali, dan tombol
     yang diganti di tengah sentuhan membuat ketukan admin hilang. */
  function gantiIsi(w, kelas, anak) {
    const baru = document.createElement('div');
    anak.forEach(a => baru.append(a));
    const lama = w.childNodes, kini = baru.childNodes;
    if (w.className === kelas && lama.length === kini.length && Array.from(lama).every((n, i) => n.isEqualNode(kini[i]))) return;
    w.className = kelas;
    w.textContent = '';
    while (baru.firstChild) w.append(baru.firstChild);
  }
  function kotak(apa) {
    const w = $('slot-' + apa), u = urutanSlot(apa), akhir = u.length ? u[u.length - 1] : null, h = S.hapus[apa];
    const lok = akhir && akhir.jenis === 'foto' ? akhir : null;
    const hapusAntre = akhir && akhir.jenis === 'hapus' ? akhir : null;
    const sebelum = hapusAntre && u.length > 1 && u[u.length - 2].jenis === 'foto' ? u[u.length - 2] : null;
    const gagalLok = !!lok && lok.status === 'gagal';
    const menghapus = S.sibukHapus === apa || !!hapusAntre;
    const isi = lok ? true : hapusAntre ? (!!sebelum || ada(apa)) : ada(apa);
    const kelas = 'slot ' + (isi ? 'terisi' : 'kosong') + (target(apa) || gagalLok ? ' target' : '') + (menghapus ? ' menghapus' : '');
    const anak = [];
    if (!isi) {
      const b = el('button', 'slot-tombol');
      b.type = 'button';
      b.id = 'foto-' + apa;
      b.append(ikon('kamera'), el('b', '', NAMA[apa]));
      if (tungguNota(apa)) b.append(el('span', 'slot-ket', 'Foto nota dulu'));
      b.disabled = !!S.sibukHapus || tungguNota(apa);
      b.addEventListener('click', () => { if (!b.disabled) mintaKamera(apa); });
      anak.push(b);
    } else {
      const kotakIsi = el('div', 'slot-isi'), kepala = el('div', 'slot-kepala'), ditolak = S.kk === 'tolak' && S.p.kt === apa;
      const lokTampil = lok || sebelum;
      let pil = null;              // pil kirim di pojok gambar, supaya kepala kotak tetap satu baris di HP 360 px
      if (gagalLok) {
        kepala.append(el('b', '', NAMA[apa]), el('span', 'pil-tolak', 'Belum tersimpan'));
      } else if (lokTampil) {
        /* foto di HP yang belum dijawab Portal: TANPA centang hijau; pil abu "Mengirim…" */
        kepala.append(el('b', '', NAMA[apa]));
        if (!menghapus) {
          const lemah = navigator.onLine === false || (lokTampil.sebab === 'jaringan' && Number(lokTampil.percobaan) >= 2);
          /* kartu (token mati / rusak) atau pita (memori HP penuh, G3-K3-01) di atas menjelaskan */
          if (S.tokenMati || DB.rusak || DB.penuh) pil = el('span', 'pil-kirim tunggu', 'Belum terkirim');
          else pil = el('span', 'pil-kirim' + (lemah ? ' tunggu' : ''), lemah ? 'Menunggu sinyal…' : 'Mengirim…');
        }
      } else {
        /* foto yang ditolak: label merah "Ditolak" TANPA centang hijau (BUILD v405 permintaan 2) */
        if (!ditolak) { const cek = el('span', 'cek'); cek.append(ikon('cek')); kepala.append(cek); }
        kepala.append(el('b', '', NAMA[apa]));
        if (ditolak) kepala.append(el('span', 'pil-tolak', 'Ditolak'));
        const idT = apa === 'nota' ? (S.nota[0] && S.nota[0].idFoto) : S.barang;
        if (idT && S.hijau[idT] && !menghapus) pil = el('span', 'pil-kirim ok', 'Terkirim');   // hanya dari jawaban ok Portal
      }
      if (bolehHapus(apa) && !menghapus) {
        const hb = el('button', 'slot-hapus');
        hb.type = 'button';
        hb.id = 'hapus-' + apa;
        hb.append(ikon('sampah'), document.createTextNode('Hapus'));
        hb.setAttribute('aria-label', 'Hapus ' + NAMA[apa].toLowerCase());
        hb.disabled = !!S.sibukHapus;
        hb.addEventListener('click', () => tanyaHapus(apa));
        kepala.append(hb);
      }
      const gb = lokTampil ? gambarLokal(apa, lokTampil) : gambarKotak(apa);
      if (pil) gb.append(pil);
      kotakIsi.append(kepala, gb);
      if (gagalLok) {
        const ps = el('p', 'slot-pesan', lok.pesan || KABAR.gagal[1]);
        ps.setAttribute('role', 'alert');
        const ak = el('div', 'slot-aksi');
        /* satu tombol biru penuh per layar: dua kotak merah → hanya Foto ulang kotak nota yang biru */
        const an = akhirSlot('nota'), biru = apa === 'nota' || !(an && an.jenis === 'foto' && an.status === 'gagal');
        ak.append(tombol(biru ? 'btn primer' : 'btn', 'ulang-' + apa, 'Foto ulang', () => fotoUlangGagal(apa, lok.idFoto)),
          tombol('btn', 'buang-' + apa, 'Buang', () => tanyaBuang(apa, lok.idFoto)));
        kotakIsi.append(ps, ak);
      }
      anak.push(kotakIsi);
      if (menghapus) anak.push(el('div', 'slot-sibuk', 'Menghapus…'));
    }
    if (h && h.pesan) {
      const ps = el('p', 'slot-pesan', h.pesan);
      ps.setAttribute('role', 'alert');
      anak.push(ps);
    }
    gantiIsi(w, kelas, anak);
  }
  function gambarLokal(apa, x) {
    const g = el('div', 'slot-gambar'), u = urlItem(x);
    if (u) {
      const img = el('img');
      img.alt = NAMA[apa] + ' ' + S.p.f;
      img.src = u;
      g.append(img);
    } else g.append(el('span', 'ada', 'Foto tersimpan di HP'));
    return g;
  }
  function gambarKotak(apa) {
    const g = el('div', 'slot-gambar'), id = apa === 'nota' ? (S.nota[0] && S.nota[0].idFoto) : S.barang;
    const x = id ? S.gambar[id] : null;
    if (x && x.st === 'ok') {
      const img = el('img');
      img.alt = NAMA[apa] + ' ' + S.p.f;
      img.addEventListener('error', () => { S.gambar[id] = {st: 'gagal'}; gambarNota(); }, {once: true});
      img.src = x.url;
      g.append(img);
    } else if (!id || S.p.v !== '3') {
      g.append(el('span', 'ada', 'Sudah ada'));               // v=2: foto dari Portal tanpa id / tanpa nota-gambar
    } else if (x && x.st === 'gagal') {
      const b = el('button', 'slot-ulang');
      b.type = 'button';
      b.append(document.createTextNode('Belum bisa dimuat · '), el('u', '', 'Coba lagi'));
      b.addEventListener('click', () => { delete S.gambar[id]; muatGambar(id); });
      g.append(b);
    } else {
      g.classList.add('memuat');
      g.setAttribute('role', 'img');
      g.setAttribute('aria-label', 'Memuat ' + NAMA[apa].toLowerCase());
    }
    if (apa === 'nota' && S.nota.length > 1) g.append(el('span', 'lencana', '+' + (S.nota.length - 1) + ' hal.'));
    return g;
  }
  /* Pita di atas kotak (rancangan A5): foto faktur lain yang ikut terkirim dari halaman ini, foto tertinggal, dan
     kartu "Buka lagi dari Portal" bila halaman ini tidak bisa mengirim lagi. Hanya hitungan, tanpa gambar. */
  function isiPita() {
    const pita = $('n-pita'), kartu = $('n-kartu'), baris = [];
    const lain = S.antre.filter(x => x.jenis === 'foto' && !fakturIni(x) && milikAkun(x) && !umurLewat(x));
    const nKirim = lain.filter(x => x.status === 'antre' && cabangIni(x)).length, nGagal = lain.filter(x => x.status === 'gagal').length;
    const nCabang = lain.filter(x => x.status === 'antre' && !cabangIni(x)).length;
    const nTinggal = S.antre.filter(x => x.jenis === 'foto' && tertinggal(x) && !umurLewat(x)).length;
    /* G3-K3-01: memori HP penuh — foto di HP menunggu (pengirim butuh menulis ke HP), foto baru dikirim langsung */
    const penuh = DB.penuh && !DB.rusak && !S.tokenMati, nPenuh = penuh ? antreSendiri().filter(x => x.jenis === 'foto').length : 0;
    if (penuh) {
      baris.push(nPenuh ? ['bahaya', 'Memori HP penuh: ' + nPenuh + ' foto di HP ini menunggu dikirim. Kosongkan sedikit memori HP ' +
        '(misalnya video WhatsApp); foto baru tetap dikirim langsung.'] : ['', 'Memori HP penuh: foto dikirim langsung.']);
    }
    if (nKirim && !DB.rusak && !DB.penuh) baris.push(['', nKirim + ' foto faktur lain sedang dikirim dari halaman ini.']);   // rusak: kartu menjelaskan
    if (nCabang) baris.push(['', nCabang + ' foto cabang lain menunggu dikirim. Terkirim saat foto nota cabang itu dibuka dari Portal.']);
    if (nGagal) baris.push(['bahaya', nGagal + ' foto faktur lain belum tersimpan. Buka fakturnya dari Portal untuk memperbaiki.']);
    if (nTinggal) baris.push(['', nTinggal + ' foto tertinggal di HP ini tidak dikirim karena tidak bisa dipastikan dari akun ini. Terhapus sendiri sesudah 3 hari.']);
    if (S.kedaluwarsa) baris.push(['', S.kedaluwarsa + ' foto lama (lebih dari 3 hari) tidak terkirim dan sudah dihapus dari HP ini. Foto ulang kalau masih perlu.']);
    gantiIsi(pita, 'pita', baris.map(([k, t]) => el('p', k, t)));
    pita.hidden = !baris.length;
    const sendiri = antreSendiri(), tunggu = sendiri.filter(x => x.jenis === 'foto');
    /* token mati didahulukan: muat ulang tidak menolong, halaman baru dari Portal yang menolong */
    const kartuToken = S.tokenMati && tunggu.length > 0, kartuRusak = !S.tokenMati && DB.rusak && (sendiri.length > 0 || !DB.terbaca);
    kartu.hidden = !(kartuToken || kartuRusak);
    $('t-muat-ulang').hidden = !kartuRusak;
    $('t-tutup3').hidden = kartuRusak;
    if (kartuToken) {
      const bercap = tunggu.every(x => HEX16.test(x.pemilik));
      $('kartu-judul').textContent = 'Buka lagi dari Portal — ' + tunggu.length + ' foto menunggu dikirim';
      $('kartu-isi').textContent = 'Tutup halaman ini, kembali ke Portal, lalu pilih notanya lagi. ' + (bercap
        ? 'Fotonya tetap di HP ini dan terkirim sesudah halaman dibuka lagi.'
        : 'Foto yang belum terkirim perlu difoto ulang sesudah dibuka lagi.');
    } else if (kartuRusak) {
      $('kartu-judul').textContent = KARTU_RUSAK[0];
      $('kartu-isi').textContent = KARTU_RUSAK[1];
    }
  }
  function idServerTampil(apa) {
    const u = urutanSlot(apa);
    if (u.length && !(u.length === 1 && u[0].jenis === 'hapus')) return '';
    return apa === 'nota' ? (S.nota[0] && S.nota[0].idFoto) : S.barang;
  }
  function gambarNota() {
    if (!S.p) return;
    isiKeadaan();
    isiPita();
    kotak('nota');
    kotak('barang');
    const lengkap = adaTampil('nota') && adaTampil('barang');
    $('n-selesai').disabled = !lengkap || !!S.sibukHapus;
    $('n-selesai-ket').hidden = lengkap;
    if (S.p.v === '3') {
      [idServerTampil('nota'), idServerTampil('barang')].forEach(id => { if (id && !S.gambar[id]) muatGambar(id); });
    }
  }
  function layarNota(fokus, biarkanKamera) {
    if (biarkanKamera && S.stream) istirahatKamera(); else matikanKamera();
    tutupPopup(false);
    clearTimeout(S.jamKembali);
    S.foto = null;
    S.menungguTutup = false;
    gambarNota();
    tampil('nota');
    window.scrollTo(0, 0);
    if (fokus) {
      const b = $('foto-nota') || $('foto-barang') || (!$('n-selesai').disabled && $('n-selesai'));
      if (b && b.focus) b.focus({preventScroll: true});
    }
  }
  function langkah(n, keadaan, judul, ket) {
    const li = document.querySelector('#alur li[data-langkah="' + n + '"]');
    li.className = keadaan || '';
    if (typeof judul === 'string') $('langkah' + n + '-judul').textContent = judul;
    if (n === 2 && typeof ket === 'string') $('langkah2-ket').textContent = ket;
  }
  function hasilKotak(jenis, teks) {
    const h = $('hasil');
    h.hidden = !jenis;
    h.className = 'hasil' + (jenis ? ' ' + jenis : '');
    h.textContent = teks || '';
  }
  function aksi(nama) {
    $('aksi-ulang').hidden = nama !== 'ulang';
    $('aksi-tutup').hidden = nama !== 'tutup';
  }
  function layarPesan(judul, isi, bisaTutup) {
    matikanKamera();
    tampil('pesan');
    $('pesan-judul').textContent = judul;
    $('pesan-isi').textContent = isi;
    $('t-tutup2').hidden = !bisaTutup;
  }

  /* ---------- kabar gagal (pop-up) dan tanya hapus / buang ---------- */
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
  function kembalikanFokus(e) {
    if (e && e.focus && document.contains(e) && !e.closest('[hidden]') && !e.disabled) e.focus({preventScroll: true});
  }
  function tutupPopup(jalankan) {
    if ($('pop').hidden) return;
    $('pop').hidden = true;
    const t = popTindakan;
    popTindakan = null;
    kembalikanFokus(popKembali);
    if (jalankan && t) t();
  }
  let tanyaApa = '', tanyaBuangId = '', tanyaKembali = null;
  function bukaTanya(judul, isi, tombolTeks) {
    tanyaKembali = document.activeElement;
    $('tanya-judul').textContent = judul;
    $('tanya-isi').textContent = isi;
    $('tanya-hapus').textContent = tombolTeks;
    $('tanya').hidden = false;
    $('tanya-batal').focus();
  }
  function tanyaHapus(apa) {
    if (S.sibukHapus || !bolehHapus(apa)) return;
    tanyaApa = apa;
    tanyaBuangId = '';
    bukaTanya(apa === 'nota' ? 'Hapus foto nota?' : 'Hapus foto barang?', 'Foto ini hilang dari Laporan harian. Anda bisa memotret lagi.', 'Hapus');
  }
  /* v6: foto yang ditolak Portal tidak dibuang otomatis. Buang = pilihan admin, dengan tanya. */
  function tanyaBuang(apa, id) {
    tanyaApa = apa;
    tanyaBuangId = id;
    bukaTanya('Buang foto ini?', 'Foto ini belum masuk Portal dan akan dihapus dari HP ini.', 'Buang');
  }
  function tutupTanya(setuju) {
    if ($('tanya').hidden) return;
    $('tanya').hidden = true;
    const apa = tanyaApa, id = tanyaBuangId;
    tanyaApa = '';
    tanyaBuangId = '';
    if (setuju && id) return buangItem(apa, id);
    if (setuju && apa) return hapusPilih(apa);
    kembalikanFokus(tanyaKembali);
  }

  /* ---------- kamera ---------- */
  function letakKotak() {
    const b = $('kam-bidik'), k = $('kotak-bidik'), pd = $('kam-panduan');
    const W = b.clientWidth, H = b.clientHeight;
    if (!W || !H) return;
    if (S.apa === 'barang') { pd.style.top = ''; return; }
    const bk = BINGKAI[S.bingkai] || BINGKAI.mendatar;
    let w = W * LEBAR_BINGKAI, h = w / bk.rasio;
    if (h > H * bk.tinggiMaks) { h = H * bk.tinggiMaks; w = h * bk.rasio; }
    const top = Math.max(8, (H - h) / 2 - H * NAIK_BINGKAI);
    k.style.width = w + 'px';
    k.style.height = h + 'px';
    k.style.left = (W - w) / 2 + 'px';
    k.style.top = top + 'px';
    /* petunjuk + pilihan Mendatar | Tegak di bawah bingkai: bertumpuk di HP tegak, sebaris di HP mendatar (flex-wrap) */
    pd.style.top = Math.max(0, Math.min(top + h + 12, H - pd.offsetHeight - 8)) + 'px';
  }
  /* Pilihan bingkai (BUILD v412 § 4): hanya di kamera foto nota. Kamera HP dan foto barang tidak memakai bingkai. */
  function tampilBingkai() {
    $('kam-bingkai').hidden = S.apa === 'barang';
    $('bingkai-mendatar').setAttribute('aria-pressed', String(S.bingkai === 'mendatar'));
    $('bingkai-tegak').setAttribute('aria-pressed', String(S.bingkai === 'tegak'));
    $('kam-petunjuk').textContent = S.apa === 'barang' ? 'Semua barang masuk layar' : BINGKAI[S.bingkai].petunjuk;
  }
  function pilihBingkai(nama) {
    if (nama !== 'mendatar' && nama !== 'tegak') return;          // daftar putih: hanya dua bentuk
    S.bingkai = nama;
    try { localStorage.setItem(KUNCI_BINGKAI, nama); } catch (e) { /* hanya kenyamanan: pilihan tetap berlaku di tab ini */ }
    tampilBingkai();
    letakKotak();
  }
  function ket(t) { $('kam-ket').textContent = t; }
  function matikanKamera() {
    clearTimeout(S.jamKamera);
    S.nomorKamera++;
    if (S.stream) S.stream.getTracks().forEach(t => t.stop());   // senter ikut mati bersama kamera
    S.stream = null;
    S.bisaFlash = false;
    $('kam-video').srcObject = null;
  }
  /* v6 (unggah-foto-10): sesudah jepret di jalur antrean, kamera dibiarkan hidup ±15 dtk selama kotak lain masih kosong,
     supaya kotak berikutnya tidak menyalakan kamera dari awal. Senter dimatikan selama di layar nota. */
  function istirahatKamera() {
    const tr = S.stream && S.stream.getVideoTracks()[0];
    if (tr && S.bisaFlash && S.flash) setelSenter(tr, false);
    clearTimeout(S.jamKamera);
    S.jamKamera = setTimeout(() => { if (S.layar !== 'kamera') matikanKamera(); }, KAMERA_HIDUP);
  }
  function kameraHidup(st) {
    try { return !!st && st.getVideoTracks().some(t => t.readyState === 'live'); } catch (e) { return false; }
  }
  /* Resolusi (BUILD v406 § 3): minta 3264×2448 (4:3); HP yang tidak sanggup menolak dengan OverconstrainedError →
     coba lagi tanpa ukuran. */
  async function mintaKameraHP() {
    const md = navigator.mediaDevices;
    try {
      return await md.getUserMedia({audio: false, video: {facingMode: {ideal: 'environment'}, width: {ideal: 3264},
        height: {ideal: 2448}, aspectRatio: {ideal: 4 / 3}}});
    } catch (e) {
      if (!e || (e.name !== 'OverconstrainedError' && e.name !== 'ConstraintNotSatisfiedError')) throw e;
      return md.getUserMedia({audio: false, video: {facingMode: {ideal: 'environment'}}});
    }
  }
  /* Ketukan admin di kotak kosong / Foto ulang. v6 (unggah-foto-06): sisa waktu halaman < 10 menit → minta buka lagi
     dari Portal SEBELUM memotret, supaya foto yang sudah dijepret tidak ditolak. */
  function mintaKamera(apa) {
    if (sisaToken() < SISA_TOKEN_MIN) {
      S.apa = apa;
      return popup(KABAR_HAMPIR, tutupAman);
    }
    if (perluMuatUlang()) { S.apa = apa; return popup(KABAR_MUAT, muatUlang); }   // v6 K3
    S.ganti[apa] = '';
    return bukaKamera(apa);
  }
  function siapkanLayarKamera() {
    const barang = S.apa === 'barang';
    $('kamera').classList.toggle('barang', barang);
    $('kam-apa').textContent = NAMA[S.apa];
    $('kam-kertas').textContent = S.p.j || S.p.s || S.p.f;
    tampilBingkai();
  }
  async function bukaKamera(apa) {
    if (apa) S.apa = apa;
    tutupPopup(false);
    clearTimeout(S.jamKembali);
    if (S.stream && kameraHidup(S.stream)) return pakaiLagiKamera();
    matikanKamera();
    siapkanLayarKamera();
    $('kam-flash').hidden = true;
    tampil('kamera');
    const nomor = S.nomorKamera, rana = $('kam-rana');
    rana.disabled = true;
    ket('Menyalakan kamera…');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return kameraGagal('');
    let st;
    try {
      st = await mintaKameraHP();
    } catch (e) {
      if (nomor === S.nomorKamera && S.layar === 'kamera') kameraGagal(e && e.name);
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
    ket('');
    rana.disabled = false;
  }
  /* v6: kamera yang masih hidup dari kotak sebelumnya dipakai lagi (tanpa getUserMedia). */
  function pakaiLagiKamera() {
    clearTimeout(S.jamKamera);
    siapkanLayarKamera();
    const tr = S.stream.getVideoTracks()[0], v = $('kam-video');
    $('kam-flash').hidden = !S.bisaFlash;
    if (S.bisaFlash) { tampilFlash(); if (S.flash) setelSenter(tr, true); }
    tampil('kamera');
    if (v.srcObject !== S.stream) v.srcObject = S.stream;
    try { const pr = v.play(); if (pr && pr.catch) pr.catch(() => {}); } catch (e) { /* tetap tampil */ }
    ket('');
    $('kam-rana').disabled = false;
  }
  function fokusTerus(st) {
    try {
      const tr = st.getVideoTracks()[0], c = tr && tr.getCapabilities ? tr.getCapabilities() : {};
      if (c.focusMode && c.focusMode.indexOf('continuous') >= 0) {
        tr.applyConstraints({advanced: [{focusMode: 'continuous'}]}).catch(() => {});
      }
    } catch (e) { /* tidak semua HP mendukung pengaturan fokus */ }
  }
  /* Flash = senter kamera (BUILD v406 § 3). Nyala bawaan; pilihan admin diingat di HP. Keadaan dilacak di halaman
     sendiri (S.flash), TIDAK dibaca dari getSettings().torch karena iOS melaporkannya salah. HP/peramban tanpa senter
     = tanpa tombol dan tanpa kalimat. Gagal menyalakan = diam; tombol tetap bisa dicoba. */
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
    /* sebagian HP baru melaporkan kemampuan senter sesaat sesudah gambar pertama tampil */
    if (!pasang()) setTimeout(pasang, 600);
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
  function kameraGagal(nama) {
    matikanKamera();
    /* v3 (BUILD v405 § 7): kalimat pendek, tanpa petunjuk ikon gembok (itu cara di komputer). HP bisa menolak
       kamera saat aplikasi lain merekam suara (uji Pekanbaru 16 Okt 12.12). */
    const ditolak = nama === 'NotAllowedError' || nama === 'SecurityError';
    $('tolak-judul').textContent = ditolak ? 'Kamera belum bisa dibuka' : 'Kamera belum menyala';
    $('tolak-isi').textContent = ditolak
      ? 'HP menolak kamera. Coba lagi, atau pakai kamera bawaan HP.'
      : 'Kamera sedang dipakai aplikasi lain. Coba lagi, atau pakai kamera bawaan HP.';
    tampil('tolak');
  }

  /* ---------- foto: potong isi kotak, perkecil, JPEG ≤ 330 KB ---------- */
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
  /* v6 (unggah-foto-10): canvas.toBlob (asinkron) menggantikan toDataURL sinkron yang membekukan layar sampai 1,3 dtk
     di HP murah. Aturan mutu sama dengan v5: mulai 0,8, turun 0,08 sampai 0,45; masih terlalu besar → sisi -20%. */
  function keBlob(c, q) {
    return new Promise((res, rej) => {
      try { c.toBlob(b => (b ? res(b) : rej(new Error('jpeg'))), 'image/jpeg', q); } catch (e) { rej(e); }
    });
  }
  async function jadikanJpeg(c) {
    for (let putaran = 0; ; putaran++) {
      let q = 0.8, b = await keBlob(c, q);
      while (b.size > BITA_MAKS && q > 0.45) { q = Math.round((q - 0.08) * 100) / 100; b = await keBlob(c, q); }
      if (b.type !== 'image/jpeg') throw new Error('jpeg');
      if (b.size <= BITA_MAKS || putaran >= 4) return {blob: b, w: c.width, h: c.height};
      c = potong(c, 0, 0, c.width, c.height, 0.8);   // masih terlalu besar: perkecil sisi 20% lalu ulangi
    }
  }
  function blobKeDataUrl(b) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => (typeof r.result === 'string' && r.result.indexOf('data:image/jpeg;base64,') === 0 ? res(r.result) : rej(new Error('jpeg')));
      r.onerror = () => rej(r.error || new Error('baca'));
      r.readAsDataURL(b);
    });
  }
  /* Jalur antrean dipakai bila Portal ini sudah terbukti v413 (pemilik), atau belum menjawab tapi HP ini pernah dijawab
     Portal v413, atau faktur ini masih punya foto antre (urutan per faktur tetap satu jalur). Selain itu jalur v5. */
  function antreBoleh() {
    if (!S.p || S.p.v !== '3' || DB.rusak) return false;          // v6 K3: rusak → jalur v5 (faktur tanpa antrean saja)
    if (S.server === 'baru') return true;
    if (S.antre.some(x => fakturIni(x) && milikAkun(x) && !umurLewat(x))) return true;
    if (S.server !== '') return false;
    try { return localStorage.getItem(KUNCI_V6) === '1'; } catch (e) { return false; }
  }
  function jepret() {
    const v = $('kam-video'), b = $('kam-bidik'), k = $('kotak-bidik');
    const vw = v.videoWidth, vh = v.videoHeight, W = b.clientWidth, H = b.clientHeight;
    if (!S.stream || !vw || !vh || !W || !H) return;
    $('kam-rana').disabled = true;
    /* video tampil dengan object-fit: cover, jadi petakan kotak di layar ke piksel video. Mode barang: seluruh
       bidang yang terlihat (tanpa kotak). */
    const s = Math.max(W / vw, H / vh), ox = (W - vw * s) / 2, oy = (H - vh * s) / 2;
    const barang = S.apa === 'barang';
    const kx = barang ? 0 : k.offsetLeft, ky = barang ? 0 : k.offsetTop, kw = barang ? W : k.offsetWidth, kh = barang ? H : k.offsetHeight;
    const sx = Math.max(0, (kx - ox) / s), sy = Math.max(0, (ky - oy) / s);
    const sw = Math.min(kw / s, vw - sx), sh = Math.min(kh / s, vh - sy);
    let c = null;
    try { c = potong(v, sx, sy, sw, sh); } catch (e) { c = null; }
    const lain = S.apa === 'nota' ? 'barang' : 'nota';
    if (c && idbAda() && antreBoleh() && !adaTampil(lain)) istirahatKamera(); else matikanKamera();
    if (!c) return gagalFoto();
    olah(c, 'kamera');
  }
  function gagalFoto() {
    matikanKamera();
    popup(['Foto belum terbaca', 'Coba foto lagi. Kalau tetap gagal, pakai kamera bawaan HP.', 'Foto lagi'], () => bukaKamera(S.apa));
  }
  async function olah(c, sumber) {
    const apa = S.apa;
    if (perluMuatUlang()) { c.width = c.height = 0; return butuhMuatUlang(); }   // v6 K3: rusak sesudah kamera menyala
    const db = antreBoleh() ? await idbBuka() : null;
    if (db && antreBoleh()) return simpanKeAntrean(c, sumber, apa);
    matikanKamera();
    olahSinkron(c, sumber, apa);
  }
  /* ---------- v6 jalur antrean: jepret → IndexedDB → layar nota langsung (rancangan A1, A2) ---------- */
  async function simpanKeAntrean(c, sumber, apa) {
    let hasil = null;
    try { hasil = await jadikanJpeg(c); } catch (e) { hasil = null; }
    c.width = c.height = 0;
    if (!hasil) return gagalFoto();
    const x = {idFoto: idAcak(), jenis: 'foto', apa, mode: apa === 'nota' ? 'baru' : 'barang',
      /* foto nota selalu set baru; foto barang memakai set nota sekarang (termasuk nota yang masih antre) */
      idSet: apa === 'nota' ? idAcak() : setSekarang() || idAcak(),
      idOutlet: S.p.o, faktur: S.p.f, tanggal: S.p.tgl, w: hasil.w, h: hasil.h, sumber, blob: hasil.blob,
      dibuat: Date.now(), urut: ++S.urut, pemilik: S.pemilik || '', tab: S.tab, status: 'antre', percobaan: 0, lagiPada: 0,
      sebab: '', kode: '', pesan: ''};
    try {
      await idbTaruh(x);
    } catch (e) {
      /* Safari lama tidak bisa menyimpan Blob: simpan isinya; tetap gagal (penuh) → jalur v5, foto tidak hilang (A8).
         G3-K3-01: memori HP penuh tidak lagi menandai rusak, jadi faktur yang masih punya foto di HP pun lewat sini. */
      try { x.blob = await hasil.blob.arrayBuffer(); await idbTaruh(x); } catch (e2) {
        matikanKamera();
        /* v6 K3: koneksi putus (rusak) dan faktur ini masih punya foto antre → jalur v5 akan mengacak urutan per faktur */
        if (perluMuatUlang()) return butuhMuatUlang();
        return olahSinkronBlob(hasil, sumber, apa, false, DB.penuh && !DB.rusak);   // G3-K3-01: memori HP penuh
      }
    }
    const lama = S.ganti[apa];
    S.ganti[apa] = '';
    if (lama) { try { await idbBuang(lama); } catch (e) { /* tinggal tampil sebagai foto gagal */ } }
    try { S.url.set(x.idFoto, URL.createObjectURL(hasil.blob)); } catch (e) { /* gambar dibuat lagi dari IndexedDB */ }
    S.antre = S.antre.filter(y => y.idFoto !== lama).concat([x]);
    S.berubah = true;
    S.hapus[apa] = null;
    if (S.layar === 'kamera') layarNota(true, true); else if (S.layar === 'nota') gambarNota();
    siarkan({jenis: 'ubah'});
    bangunkan();
  }
  /* ---------- jalur sinkron v5 (Portal v412, alamat v=2, IndexedDB tidak ada/melempar/penuh) ---------- */
  function olahSinkron(c, sumber, apa) {
    S.foto = null;
    S.nomorKirim++;
    clearTimeout(S.jamKembali);
    layarKirim(apa);
    sesudahGambar(async () => {
      let hasil = null;
      try { hasil = await jadikanJpeg(c); } catch (e) { hasil = null; }
      c.width = c.height = 0;
      if (!hasil) return gagalFoto();
      olahSinkronBlob(hasil, sumber, apa, true);
    });
  }
  function layarKirim(apa) {
    tampil('kirim');
    window.scrollTo(0, 0);
    aksi(null);
    hasilKotak(null);
    $('t-kembali').hidden = true;
    $('kirim-judul').textContent = NAMA[apa] + ' · ' + kertas();
    $('kirim-img').hidden = true;
    $('kirim-img').removeAttribute('src');
    /* BUILD v406 § 4: kalimat langkah mengikuti keadaan (sedang → selesai) */
    langkah(1, 'jalan', 'Merapikan foto…');
    langkah(2, '', 'Mengirim ke Portal…', '');
    langkah(3, '', 'Masuk Laporan harian…');
  }
  async function olahSinkronBlob(hasil, sumber, apa, sudahDiLayar, penuh) {
    if (!sudahDiLayar) { S.foto = null; S.nomorKirim++; layarKirim(apa); }
    let url;
    try { url = await blobKeDataUrl(hasil.blob); } catch (e) { return gagalFoto(); }
    S.foto = {url, w: hasil.w, h: hasil.h, idFoto: idAcak(), sumber, apa,
      /* foto nota selalu set baru; foto barang memakai set nota sekarang bila ada (BUILD v406 § 2) */
      mode: apa === 'nota' ? 'baru' : 'barang',
      idSet: apa === 'nota' ? idAcak() : setNotaAntre() || ((S.nota.length || S.notaLama) && S.set ? S.set : idAcak()),
      /* G6-K-01: Foto ulang foto yang ditolak (memori HP penuh / tanpa IndexedDB) → foto lama dibuang sesudah ok Portal */
      ganti: S.ganti[apa] || ''};
    $('kirim-img').alt = NAMA[apa] + ' ' + S.p.f;
    $('kirim-img').src = url;
    $('kirim-img').hidden = false;
    langkah(1, 'beres', penuh ? KIRIM_PENUH : sumber === 'kamera' && apa === 'nota' ? 'Foto dirapikan sesuai kotak' : 'Foto dirapikan');
    kirim();
  }
  function bacaGambar(berkas) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(berkas), img = new Image();
      img.onload = () => res({img, lepas: () => URL.revokeObjectURL(url)});
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('baca')); };
      img.src = url;
    });
  }
  /* Kamera bawaan HP (BUILD v406 § 2): seluruh foto, TANPA dipotong, diperkecil ≤ 1600 px, JPEG ≤ 330 KB. */
  async function dariBerkas(berkas) {
    matikanKamera();
    let g;
    try { g = await bacaGambar(berkas); } catch (e) { return gagalFoto(); }
    const W = g.img.naturalWidth, H = g.img.naturalHeight;
    let c = null;
    try { c = potong(g.img, 0, 0, W, H); } catch (e) { c = null; }
    g.lepas();
    if (!c) return gagalFoto();
    olah(c, 'hp-bawaan');
  }

  /* ---------- kirim ke Portal: satu permintaan ----------
     XMLHttpRequest POST text/plain (permintaan sederhana: tanpa preflight). TIDAK ada pendengar di xhr.upload (lihat
     BATAS_JAWAB di atas). Putus / batas / 'offline' = galat (ditangkap pemanggil sebagai sinyal putus). */
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
  /* Aturan ulang yang sama untuk kirim foto dan hapus di jalur sinkron: sinyal putus / sibuk / belum-pasti / gagal
     diulang 3 kali (1, 3, 7 dtk) dengan badan yang sama persis (idFoto/idAksi sama). */
  async function kirimBerulang(badan, kabarUlang) {
    let akhir = {jaringan: true};
    for (let i = 0; i <= JEDA_ULANG.length; i++) {
      if (i > 0) {
        if (kabarUlang) kabarUlang(akhir.jaringan);
        await tunggu(JEDA_ULANG[i - 1]);
      }
      let j;
      try { j = await kirimSekali(badan); } catch (e) { akhir = {jaringan: true}; continue; }
      if (j.ok === true) { catatPemilik(j, S.p && S.p.o); return {ok: true, j}; }
      akhir = {kode: String(j.kode || 'gagal'), pesan: typeof j.pesan === 'string' ? j.pesan : '', j};
      if (!KODE_ULANG.has(akhir.kode)) break;
    }
    return akhir;
  }
  function badanFoto(F) {
    return JSON.stringify({jenis: 'nota-foto', t: S.p.t, idOutlet: S.p.o, idFoto: F.idFoto, idSet: F.idSet,
      mode: F.mode, hal: '', faktur: S.p.f, tanggal: S.p.tgl, foto: F.url, w: F.w, h: F.h, sumber: F.sumber});
  }
  async function kirim() {
    const F = S.foto;
    if (!F || S.sibuk) return;
    S.sibuk = true;
    tutupPopup(false);
    aksi(null);
    hasilKotak(null);
    $('t-kembali').hidden = true;
    langkah(2, 'jalan', 'Mengirim ke Portal…', '');
    const r = await kirimBerulang(badanFoto(F), jaringan => langkah(2, 'jalan', 'Mengirim ke Portal…',
      jaringan ? 'Sinyal lemah, mencoba lagi…' : 'Portal sedang sibuk, mencoba lagi…'));
    S.sibuk = false;
    if (r.ok) return berhasil(r.j, F);
    if (S.foto === F) gagalKirim(r);                           // selain itu admin sudah kembali ke layar nota
  }
  async function berhasil(j, F, teksOk) {
    const nomor = S.nomorKirim, layarIni = S.foto === F && S.layar === 'kirim';
    S.terkirim = true;
    S.berubah = true;
    if (S.foto === F) S.foto = null;
    S.raguCalon = null;
    S.ragu[F.apa] = null;
    S.gambar[F.idFoto] = {st: 'ok', url: F.url};
    terapkanJawaban(j, {jenis: 'foto', apa: F.apa, idFoto: F.idFoto, idSet: F.idSet});
    if (F.ganti) lepasGanti(F.apa, F.ganti);
    S.baru[F.apa] = true;
    S.hapus[F.apa] = null;
    perbaruiKeadaan();
    simpanSesi();
    if (!layarIni) { if (S.layar === 'nota') gambarNota(); return; }
    langkah(2, 'beres', 'Terkirim ke Portal', '');
    langkah(3, 'jalan', 'Masuk Laporan harian…');
    await tunggu(JEDA_LANGKAH3);
    if (nomor !== S.nomorKirim || S.layar !== 'kirim') return;
    langkah(3, 'beres', 'Masuk Laporan harian');
    hasilKotak('ok', teksOk || (F.apa === 'nota' ? 'Foto nota terkirim.' : 'Foto barang terkirim.'));
    $('t-kembali').hidden = false;
    S.jamKembali = setTimeout(() => { if (nomor === S.nomorKirim && S.layar === 'kirim') layarNota(true); }, JEDA_KEMBALI);
  }
  function gagalKirim(akhir) {
    $('t-kembali').hidden = false;
    /* v6 (unggah-foto-05): kiriman yang belum pasti diingat. Bila admin memilih Foto ulang / ‹ Kembali, foto ini mungkin
       sudah masuk Portal walau jawabannya hilang. */
    S.raguCalon = akhir.jaringan || KODE_ULANG.has(akhir.kode) ? S.foto : null;
    if (akhir.jaringan) {
      langkah(2, 'gagal', 'Belum terkirim', '');
      hasilKotak('gagal', BELUM_TERKIRIM);
      aksi('ulang');
      return;
    }
    langkah(2, 'gagal', 'Belum tersimpan', '');
    if (akhir.kode === 'isian') {
      const F = S.foto;
      /* unggah-foto-05: Portal v413 membawa keadaan di jawaban isian → kotak terisi foto Portal + Hapus (tidak terjebak).
         Portal lama tanpa keadaan: foto sebelumnya yang belum pasti dikirim ulang SEKALI dengan idFoto yang sama —
         kalau ternyata sudah masuk, Portal menjawab ulangan ok beserta keadaannya. */
      const kd = bacaKeadaanJawaban(akhir.j), R = F && S.ragu[F.apa];
      /* G7-GANTI-01 (tinjau ulang gelombang 7): foto sebelumnya yang belum pasti (R, jawabannya hilang) ternyata ada di
         keadaan Portal → R terkirim, sama dengan cobaRagu yang ok untuk Portal lama. Tanpa ini foto lama yang ditolak
         (R.ganti) tetap tampil merah, Selesai mati, dan Foto ulang selalu ditolak "sudah difoto". */
      if (kd && R && R !== F && (F.apa === 'nota' ? kd.nota.some(x => x.idFoto === R.idFoto) : kd.barang === R.idFoto)) {
        S.foto = R;
        $('kirim-img').src = R.url;
        return berhasil(akhir.j, R, 'Foto sebelumnya ternyata sudah masuk Portal. Hapus dulu kalau mau memakai foto baru.');
      }
      if (kd) {
        terapkanJawaban(akhir.j, {});
        perbaruiKeadaan();
        simpanSesi();
      } else if (F && S.ragu[F.apa] && S.ragu[F.apa] !== F) {
        return cobaRagu(F, akhir);
      }
      S.foto = null;
      hasilKotak('gagal', akhir.pesan || 'Foto ini belum bisa disimpan. Kembali ke Portal, lalu buka lagi notanya.');
      aksi('tutup');
      return;
    }
    const kb = KABAR[akhir.kode] || KABAR.gagal;
    hasilKotak('gagal', kb[1]);
    if (kb[3] === 'ulang') {
      aksi('ulang');
      popup(kb, kirim);
    } else {
      S.foto = null;
      aksi('tutup');
      popup(kb, tutupHalaman);
    }
  }
  async function cobaRagu(F, akhir) {
    const R = S.ragu[F.apa];
    S.ragu[F.apa] = null;
    S.sibuk = true;
    langkah(2, 'jalan', 'Mengirim ke Portal…', 'Memeriksa foto sebelumnya…');
    const r = await kirimBerulang(badanFoto(R), null);
    S.sibuk = false;
    if (S.foto !== F) return;
    if (r.ok) {
      S.foto = R;
      $('kirim-img').src = R.url;
      return berhasil(r.j, R, 'Foto sebelumnya ternyata sudah masuk Portal. Hapus dulu kalau mau memakai foto baru.');
    }
    S.raguCalon = null;
    langkah(2, 'gagal', 'Belum tersimpan', '');
    S.foto = null;
    hasilKotak('gagal', akhir.pesan || 'Foto ini belum bisa disimpan. Kembali ke Portal, lalu buka lagi notanya.');
    aksi('tutup');
  }
  function simpanRagu() {
    if (S.foto && S.raguCalon === S.foto) S.ragu[S.foto.apa] = S.foto;
    S.raguCalon = null;
  }

  /* ---------- hapus (BUILD v406 § 2, § 6.2) ---------- */
  function sidikKotak(apa) { return apa === 'nota' ? S.set + '|' + S.nota.map(x => x.idFoto).join(',') : S.barang; }
  function hapusPilih(apa) {
    if (S.sibukHapus || !bolehHapus(apa)) return;
    if (perluMuatUlang()) return belumHapus(apa);              // v6 K3: urutan faktur ini hanya terjaga sesudah muat ulang
    if (idbAda() && antreBoleh()) return hapusAntre(apa);
    return hapus(apa);
  }
  /* v6 K3: hapus/buang yang tidak bisa dicatat di HP — kotak tetap seperti adanya (tidak berpura-pura terhapus) */
  function belumHapus(apa) {
    S.hapus[apa] = {pesan: DB.penuh && !DB.rusak ? BELUM_HAPUS_PENUH : BELUM_HAPUS};   // G3-K3-01: muat ulang tidak menolong
    gambarNota();
  }
  async function hapus(apa) {
    if (S.sibukHapus || !bolehHapus(apa)) return;
    /* idAksi yang sama untuk semua ulangan, termasuk Coba lagi sesudah kabar gagal, selama isi kotaknya belum berubah */
    let h = S.hapus[apa];
    if (!h || h.sidik !== sidikKotak(apa)) h = S.hapus[apa] = {idAksi: idAcak(), sidik: sidikKotak(apa), pesan: ''};
    h.pesan = '';
    S.sibukHapus = apa;
    S.berubah = true;
    gambarNota();
    const badan = JSON.stringify({jenis: 'nota-hapus', t: S.p.t, idOutlet: S.p.o, idAksi: h.idAksi, faktur: S.p.f, apa,
      idSet: S.set});
    const r = await kirimBerulang(badan, null);
    S.sibukHapus = '';
    if (r.ok) {
      terapkanJawaban(r.j, {jenis: 'hapus', apa});
      S.hapus[apa] = null;
      S.ragu[apa] = null;
      perbaruiKeadaan();
      simpanSesi();
      gambarNota();
      const b = $('foto-' + apa);
      if (b && S.layar === 'nota') b.focus({preventScroll: true});
      return;
    }
    if (r.kode === 'isian') {
      h.pesan = r.pesan || 'Foto ini belum bisa dihapus. Kembali ke Portal, lalu buka notanya lagi.';
      gambarNota();
      return;
    }
    gambarNota();
    const kb = r.jaringan ? KABAR.jaringan : KABAR[r.kode] || KABAR.gagal;
    popup(kb, kb[3] === 'ulang' ? () => hapus(apa) : tutupHalaman);
    popKembali = $('hapus-' + apa);
  }
  /* v6 (rancangan A6): foto antre yang belum pernah dikirim → batal di HP saja (atomik: pengirim di tab lain belum
     menyentuhnya). Sudah/sedang dikirim, atau foto Portal → nota-hapus masuk antrean DI BELAKANGNYA, idAksi tetap. */
  async function hapusAntre(apa) {
    const a = akhirSlot(apa), lokal = !!a && a.jenis === 'foto';
    S.berubah = true;
    S.hapus[apa] = null;
    if (lokal) {
      let batal = false, gagalHP = false;
      try { batal = !(await idbUbah(a.idFoto, y => (y.status === 'antre' && !(Number(y.percobaan) > 0) ? null : undefined))).sesudah; }
      catch (e) { gagalHP = true; }
      if (gagalHP) return belumHapus(apa);                     // v6 K3: foto tetap di HP → jangan katakan "Dihapus"
      if (batal) {
        await muatAntrean();
        gambarNota();
        siarkan({jenis: 'ubah'});
        const b = $('foto-' + apa);
        if (b && S.layar === 'nota') b.focus({preventScroll: true});
        return;
      }
    }
    const x = {idFoto: idAcak(), jenis: 'hapus', apa, idSet: apa === 'nota' ? (a && a.jenis === 'foto' ? a.idSet : S.set) : setSekarang(),
      idOutlet: S.p.o, faktur: S.p.f, tanggal: S.p.tgl, dibuat: Date.now(), urut: ++S.urut, pemilik: S.pemilik || '', tab: S.tab,
      status: 'antre', percobaan: 0, lagiPada: 0, sebab: '', kode: '', pesan: ''};
    try { await idbTaruh(x); } catch (e) {
      /* v6 K3: foto di HP (belum pasti di Portal) TIDAK dihapus langsung ke Portal: Portal menjawab "Dihapus" tanpa
         menghapus apa pun, lalu foto di HP terkirim sesudah muat ulang. Hanya foto Portal yang dihapus langsung (v5). */
      if (lokal) return belumHapus(apa);
      return hapus(apa);                                       // IndexedDB menolak: hapus langsung seperti v5
    }
    S.antre = S.antre.concat([x]);
    gambarNota();
    siarkan({jenis: 'ubah'});
    bangunkan();
  }
  async function buangItem(apa, id) {
    /* v6 K3: belum terbuang dari HP → kotak merah tetap + kalimat (dulu kotak dikosongkan padahal foto masih di HP) */
    try { await idbBuang(id); } catch (e) { return belumHapus(apa); }
    S.antre = S.antre.filter(x => x.idFoto !== id);
    await muatAntrean();
    gambarNota();
    siarkan({jenis: 'ubah'});
    const b = $('foto-' + apa);
    if (b && S.layar === 'nota') b.focus({preventScroll: true});
  }
  /* Foto ulang untuk foto yang ditolak Portal: foto lama dibuang hanya sesudah foto baru tersimpan di HP. */
  function fotoUlangGagal(apa, id) {
    if (sisaToken() < SISA_TOKEN_MIN) { S.apa = apa; return popup(KABAR_HAMPIR, tutupAman); }
    if (perluMuatUlang()) { S.apa = apa; return popup(KABAR_MUAT, muatUlang); }   // v6 K3
    S.ganti[apa] = id;
    bukaKamera(apa);
  }
  /* G6-K-01 (tinjau ulang gelombang 6): foto baru yang tidak bisa disimpan di HP (memori penuh) dikirim lewat jalur v5,
     jadi simpanKeAntrean tidak sempat membuang foto lama. Dipanggil HANYA sesudah Portal menjawab ok foto barunya: foto
     lama dibuang dari kotak dan dari HP (delete tidak butuh ruang). Delete yang gagal: foto lama tertinggal di HP, tetapi
     tidak tampil lagi selama halaman ini hidup (S.lepas), karena penggantinya sudah di Portal. */
  function lepasGanti(apa, id) {
    if (S.ganti[apa] === id) S.ganti[apa] = '';
    S.lepas.add(id);
    S.antre = S.antre.filter(y => y.idFoto !== id);
    if (!idbAda()) return;
    idbBuang(id).then(() => siarkan({jenis: 'ubah'}), () => { /* tertinggal di HP: tidak ditampilkan di halaman ini */ });
  }

  /* ---------- v6: pengirim latar tunggal (rancangan A3, A4) ---------- */
  let kirimJalan = false, kirimLagi = false, jamBangun = 0, tundaSampai = 0, paksa = false;
  function bangunkan(segera) {
    if (segera) paksa = true;
    if (!idbAda() || !S.p || S.p.v !== '3') return;
    /* v6 K3: koneksi ditutup peramban (onclose) → buka koneksi baru dulu; tidak bisa → rusak (kartu Muat ulang) */
    if (!DB.db) { bukaUlangIdb().then(db => { if (db) bangunkan(); }); return; }
    clearTimeout(jamBangun);
    if (kirimJalan) { kirimLagi = true; return; }
    kirimJalan = true;
    const jalan = () => kirimSemua().catch(() => { /* satu putaran gagal: dijadwalkan lagi */ });
    let p;
    try {
      p = navigator.locks && typeof navigator.locks.request === 'function' ? navigator.locks.request(KUNCI_KIRIM, jalan) : jalan();
    } catch (e) { p = jalan(); }
    Promise.resolve(p).catch(() => {}).then(() => {
      kirimJalan = false;
      if (kirimLagi) { kirimLagi = false; bangunkan(); } else jadwalBangun();
    });
  }
  /* Berikutnya yang boleh dikirim: per faktur hanya yang terdepan (urutan nota → barang → hapus terjaga); foto gagal
     tidak menahan faktur; foto yang pemiliknya belum bisa dipastikan menahan fakturnya sampai Portal menjawab. */
  function rencana(semua, kini, abaikanJeda) {
    const tutup = new Set();
    let tungguSampai = Infinity;
    for (const x of semua) {
      if (!cabangIni(x) || umurLewat(x) || tertinggal(x) || x.status !== 'antre') continue;
      const k = x.idOutlet + '|' + x.faktur;
      if (tutup.has(k)) continue;
      tutup.add(k);
      if (!milikAkun(x)) continue;
      const bisa = abaikanJeda ? 0 : Math.max(Number(x.lagiPada) || 0, tundaSampai);
      if (bisa <= kini) return {item: x, tunggu: 0};
      tungguSampai = Math.min(tungguSampai, bisa);
    }
    return {item: null, tunggu: tungguSampai};
  }
  function jadwalBangun() {
    clearTimeout(jamBangun);
    if (!idbAda() || !S.p || S.tokenMati || navigator.onLine === false) return;
    const r = rencana(S.antre, Date.now(), false);
    if (r.item) { jamBangun = setTimeout(() => bangunkan(), 50); return; }
    if (r.tunggu !== Infinity) jamBangun = setTimeout(() => bangunkan(), Math.max(50, r.tunggu - Date.now()));
  }
  function segarkan() {
    if (S.layar === 'nota') gambarNota();
    cekTunggu();
  }
  async function kirimSemua() {
    for (let n = 0; n < 200; n++) {
      if (!S.p || S.tokenMati || DB.rusak) return;
      if (!DB.db && !(await bukaUlangIdb())) return;             // v6 K3: koneksi tertutup di tengah putaran → koneksi baru
      const semua = await muatAntrean();
      segarkan();
      if (DB.rusak || navigator.onLine === false) return;       // rusak: berhenti (kartu Muat ulang); tanpa sinyal: tunggu 'online'
      const r = rencana(semua, Date.now(), paksa);
      paksa = false;
      if (!r.item) return;
      await kirimItem(r.item);
    }
  }
  async function badanItem(x) {
    if (x.jenis === 'hapus') {
      return JSON.stringify({jenis: 'nota-hapus', t: S.p.t, idOutlet: x.idOutlet, idAksi: x.idFoto, faktur: x.faktur, apa: x.apa,
        idSet: x.idSet});
    }
    let foto = S.dataUrl.get(x.idFoto);
    if (!foto) { foto = await blobKeDataUrl(blobDari(x)); S.dataUrl.set(x.idFoto, foto); }
    return JSON.stringify({jenis: 'nota-foto', t: S.p.t, idOutlet: x.idOutlet, idFoto: x.idFoto, idSet: x.idSet,
      mode: x.mode, hal: '', faktur: x.faktur, tanggal: x.tanggal, foto, w: x.w, h: x.h, sumber: x.sumber});
  }
  async function kirimItem(x0) {
    /* tandai "sudah mulai dikirim" SEBELUM berangkat, dalam satu transaksi: Hapus sesudah ini tidak lagi batal di HP */
    let x = null;
    try {
      x = (await idbUbah(x0.idFoto, y => (y.status === 'antre' ? Object.assign({}, y, {percobaan: (Number(y.percobaan) || 0) + 1}) : undefined))).sesudah;
    } catch (e) { tundaSampai = Date.now() + JEDA_ANTRE[0]; return; }
    if (!x || x.status !== 'antre' || umurLewat(x) || !milikAkun(x)) return;      // dibaca ulang: bisa berubah sejak direncanakan
    let badan;
    try { badan = await badanItem(x); } catch (e) { return tolakItem(x, 'isian', {pesan: 'Foto tidak terbaca. Foto ulang notanya.'}); }
    let j = null;
    try { j = await kirimSekali(badan, BATAS_JAWAB_ANTRE); } catch (e) { j = null; }
    if (j && j.ok === true) return selesaiItem(x, j);
    const kode = j ? String(j.kode || 'gagal') : 'jaringan';
    if (kode === 'token' || kode === 'sesi') {
      /* rancangan A4: item TETAP di HP; terkirim dari halaman yang dibuka lagi dari Portal (token baru, pemilik sama) */
      S.tokenMati = true;
      segarkan();
      return;
    }
    if (KODE_TOLAK.has(kode)) return tolakItem(x, kode, j);
    /* putus / sibuk / belum-pasti / gagal / jawaban asing: ulang dengan idFoto/idAksi yang sama, 2/5/10/20/30/60 dtk */
    const lagi = Date.now() + JEDA_ANTRE[Math.min(Math.max(0, Number(x.percobaan) - 1), JEDA_ANTRE.length - 1)];
    try { await idbUbah(x.idFoto, y => Object.assign({}, y, {lagiPada: lagi, sebab: kode})); } catch (e) { /* ingatan halaman */ }
    if (kode === 'jaringan' || kode === 'sibuk') tundaSampai = lagi;
  }
  function ringkasJawaban(j) {
    const r = {ok: true};
    ['status', 'idSet', 'nota', 'barang', 'halaman'].forEach(k => { if (j[k] !== undefined) r[k] = j[k]; });
    return r;
  }
  async function selesaiItem(x, j) {
    catatPemilik(j, x.idOutlet);
    try { await idbBuang(x.idFoto); } catch (e) { /* tertinggal: kiriman berikutnya dijawab ulangan oleh Portal */ }
    S.dataUrl.delete(x.idFoto);
    const h = {jenis: 'terkirim', kirim: x.jenis, idFoto: x.idFoto, apa: x.apa, idOutlet: x.idOutlet, faktur: x.faktur,
      idSet: x.idSet, j: ringkasJawaban(j)};
    terapkanSelesai(h);
    siarkan(h);
  }
  /* Jawaban ok Portal untuk faktur yang tampil di tab ini (dikirim tab ini atau tab lain). */
  function terapkanSelesai(h) {
    S.antre = S.antre.filter(y => y.idFoto !== h.idFoto);
    if (!S.p || h.idOutlet !== S.p.o || h.faktur !== S.p.f) return segarkan();
    if (h.kirim === 'hapus') {
      terapkanJawaban(h.j, {jenis: 'hapus', apa: h.apa});
    } else {
      const u = S.url.get(h.idFoto);
      if (u) S.gambar[h.idFoto] = {st: 'ok', url: u};          // unggah-foto-09: gambar tetap dari HP, tanpa nota-gambar
      terapkanJawaban(h.j, {jenis: 'foto', apa: h.apa, idFoto: h.idFoto, idSet: h.idSet});
      S.baru[h.apa] = true;
      S.hijau[h.idFoto] = true;
      S.terkirim = true;
    }
    S.hapus[h.apa] = null;
    perbaruiKeadaan();
    simpanSesi();
    segarkan();
  }
  async function tolakItem(x, kode, j) {
    const pesan = kode === 'isian' ? (j && typeof j.pesan === 'string' && j.pesan ? j.pesan : 'Foto ini belum bisa disimpan.')
      : (KABAR[kode] || KABAR.gagal)[1];
    if (x.jenis === 'hapus') {
      /* hapus yang ditolak tidak menyisakan apa pun untuk dikirim: kalimat Portal di bawah kotaknya (seperti v5) */
      try { await idbBuang(x.idFoto); } catch (e) { /* diam */ }
    } else {
      try { await idbUbah(x.idFoto, y => Object.assign({}, y, {status: 'gagal', kode, pesan})); } catch (e) { /* diam */ }
    }
    const h = {jenis: 'tolak', kirim: x.jenis, idFoto: x.idFoto, apa: x.apa, idOutlet: x.idOutlet, faktur: x.faktur, pesan, j: j || {}};
    terapkanTolak(h);
    siarkan(h);
    if (x.jenis === 'foto' && x.apa === 'nota') await barangIkutSetPortal(x, bacaKeadaanJawaban(j));
  }
  /* G8-SET-01 (tinjau ulang gelombang 8): foto nota ditolak karena Portal sudah punya nota (set lain, mis. dari HP lain;
     keadaan di jawaban isian v413). Foto barang faktur itu yang masih antre dengan set foto nota yang ditolak ikut set
     Portal, dalam SATU transaksi (tab lain bisa sedang menulis). Dulu foto barang yang dijepret selagi nota dikirim tetap
     membawa set itu dan ditolak "Foto nota ini baru saja berubah". Dipanggil sesudah terapkanTolak: foto barang yang
     dijepret sebelumnya sudah tertulis lebih dulu (urutan transaksi), yang sesudahnya memakai set Portal (setSekarang).
     Set foto nota acak dan unik, jadi hanya turunannya yang ikut (akun/tab mana pun); hapus barang tidak ikut (Portal
     tidak memeriksa setnya). Gagal (memori HP penuh) = seperti dulu. */
  async function barangIkutSetPortal(x, kd) {
    if (!kd || !kd.nota.length || !kd.idSet || kd.idSet === x.idSet) return;
    const ikut = y => !!y && y.jenis === 'foto' && y.apa === 'barang' && y.status === 'antre' && y.idOutlet === x.idOutlet &&
      y.faktur === x.faktur && y.idSet === x.idSet;
    try {
      await idbKerja('readwrite', st => {
        const q = st.getAll();
        q.onsuccess = () => (q.result || []).forEach(y => { if (ikut(y)) { y.idSet = kd.idSet; st.put(y); } });
      });
    } catch (e) { return; }
    /* salinan di memori ikut (kirimSemua membaca ulang IndexedDB tiap putaran, kirimItem membaca ulang itemnya) */
    S.antre = S.antre.map(y => (ikut(y) ? Object.assign({}, y, {idSet: kd.idSet}) : y));
  }
  function terapkanTolak(h) {
    if (!S.p || h.idOutlet !== S.p.o || h.faktur !== S.p.f) return segarkan();
    if (bacaKeadaanJawaban(h.j)) { terapkanJawaban(h.j, {}); perbaruiKeadaan(); simpanSesi(); }   // unggah-foto-05
    if (h.kirim === 'hapus') {
      S.antre = S.antre.filter(y => y.idFoto !== h.idFoto);
      S.hapus[h.apa] = {pesan: h.pesan};
    } else {
      S.antre = S.antre.map(y => (y.idFoto === h.idFoto ? Object.assign({}, y, {status: 'gagal', pesan: h.pesan}) : y));
    }
    if (S.menungguTutup) { S.menungguTutup = false; return layarNota(true); }
    segarkan();
  }
  /* `pemilik` (16 hex sidik akun) + `idOutlet` di jawaban ok = Portal v413 (BUILD v413 § 2.10). Tanpa itu = Portal lama. */
  function catatPemilik(j, idOutlet) {
    if (j && typeof j.pemilik === 'string' && HEX16.test(j.pemilik) && j.idOutlet === idOutlet) {
      const baru = S.pemilik !== j.pemilik;
      S.pemilik = j.pemilik;
      S.server = 'baru';
      try { localStorage.setItem(KUNCI_V6, '1'); } catch (e) { /* hanya petunjuk */ }
      if (baru) capPemilik();
      return;
    }
    if (S.server === 'baru') return;
    S.server = 'lama';
    try { localStorage.removeItem(KUNCI_V6); } catch (e) { /* hanya petunjuk */ }
  }
  /* Foto yang dijepret di tab ini sebelum Portal menyebut pemiliknya diberi cap pemilik begitu diketahui, supaya tetap
     bisa dikirim dari halaman yang dibuka lagi dari Portal. */
  function capPemilik() {
    if (!idbAda() || !S.pemilik) return;
    const p = S.pemilik, t = S.tab;
    idbKerja('readwrite', st => {
      const q = st.getAll();
      q.onsuccess = () => (q.result || []).forEach(x => { if (x && x.tab === t && !x.pemilik) { x.pemilik = p; st.put(x); } });
    }).then(() => muatAntrean()).then(() => { segarkan(); bangunkan(); }).catch(() => { /* cap menyusul di jawaban berikutnya */ });
  }
  /* > 72 jam: tidak dikirim lagi dan dihapus dari HP (README § Pengaman), lalu diberitahukan sekali di pita. */
  async function sapuKedaluwarsa() {
    if (!idbAda()) return;
    try {
      S.kedaluwarsa += await idbKerja('readwrite', st => {
        const o = {n: 0}, q = st.getAll();
        q.onsuccess = () => (q.result || []).forEach(x => { if (x && umurLewat(x)) { if (x.jenis === 'foto') o.n++; st.delete(x.idFoto); } });
        return o;
      }).then(o => o.n);
    } catch (e) { /* dicoba lagi saat halaman dibuka berikutnya */ }
  }

  /* ---------- v6: kabar antar tab (BroadcastChannel; asal yang sama saja) ---------- */
  let saluran = null;
  try { if (typeof BroadcastChannel === 'function') saluran = new BroadcastChannel('kamera-nota'); } catch (e) { saluran = null; }
  function siarkan(m) { try { if (saluran) saluran.postMessage(m); } catch (e) { /* tab lain membaca IndexedDB sendiri */ } }
  if (saluran) {
    saluran.onmessage = e => {
      const m = e && e.data;
      if (!m || typeof m !== 'object' || !S.p) return;
      const sahH = HEX24.test(String(m.idFoto)) && (m.apa === 'nota' || m.apa === 'barang') && typeof m.faktur === 'string' &&
        typeof m.idOutlet === 'string' && (m.kirim === 'foto' || m.kirim === 'hapus') && !!m.j && typeof m.j === 'object' &&
        (m.idSet === undefined || m.idSet === '' || HEX24.test(String(m.idSet)));
      if (m.jenis === 'terkirim' && sahH) terapkanSelesai(m);
      else if (m.jenis === 'tolak' && sahH && typeof m.pesan === 'string') terapkanTolak(m);
      muatAntrean().then(segarkan);
      if (!kirimJalan) bangunkan();
    };
  }

  /* ---------- v6: Selesai / ‹ Kembali dengan antrean belum kosong (rancangan A7) ---------- */
  function tutupAman() {
    tutupPopup(false);
    if (!idbAda() || S.tokenMati || !antreSendiri().length) return tutupHalaman();
    S.menungguTutup = true;
    layarTunggu();
    bangunkan(true);
  }
  function layarTunggu() {
    const semua = antreSendiri(), foto = semua.filter(x => x.jenis === 'foto');
    if (S.layar !== 'tunggu') { matikanKamera(); tampil('tunggu'); window.scrollTo(0, 0); }
    $('tunggu-judul').textContent = foto.length ? 'Menunggu ' + foto.length + ' foto terkirim…' : 'Menunggu foto selesai dihapus…';
    $('tunggu-isi').textContent = (DB.penuh ? 'Memori HP penuh: kosongkan sedikit memori HP supaya fotonya bisa terkirim. ' : '') +
      'Halaman ini menutup sendiri sesudah semuanya terkirim. ' + (semua.every(x => HEX16.test(x.pemilik))
      ? 'Kalau terpaksa ditutup, fotonya tetap di HP ini dan terkirim saat foto nota dibuka lagi dari Portal.'
      : 'Jangan tutup halaman ini dulu.');
  }
  function cekTunggu() {
    if (!S.menungguTutup) return;
    if (S.tokenMati || DB.rusak) { S.menungguTutup = false; return layarNota(true); }   // kartu di layar nota menjelaskan
    if (S.antre.some(x => fakturIni(x) && milikAkun(x) && x.jenis === 'foto' && x.status === 'gagal')) { S.menungguTutup = false; return layarNota(true); }
    if (!antreSendiri().length) { S.menungguTutup = false; return tutupHalaman(); }
    layarTunggu();
  }

  /* ---------- foto yang sudah ada di Portal: nota-gambar (BUILD v406 § 6.1) ---------- */
  async function muatGambar(id) {
    const x = S.gambar[id];
    if (x && (x.st === 'ok' || x.st === 'muat')) return;
    S.gambar[id] = {st: 'muat'};
    if (S.layar === 'nota') gambarNota();
    const p = S.p, badan = JSON.stringify({jenis: 'nota-gambar', t: p.t, idOutlet: p.o, faktur: p.f, idFoto: id});
    let j = null;
    /* panggilan baca: sinyal putus diulang sekali otomatis sebelum kabar tampil (BUILD v402 § 9) */
    for (let i = 0; i < 2 && !j; i++) {
      if (i > 0) await tunggu(JEDA_ULANG[0]);
      try { j = await kirimSekali(badan); } catch (e) { j = null; }
    }
    if (S.p !== p || !S.gambar[id] || S.gambar[id].st !== 'muat') return;
    const ok = !!j && j.ok === true && j.idFoto === id && j.mime === 'image/jpeg' && typeof j.b64 === 'string'
      && j.b64.length > 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(j.b64);
    S.gambar[id] = ok ? {st: 'ok', url: 'data:image/jpeg;base64,' + j.b64} : {st: 'gagal'};
    gambarNota();
  }

  /* v6 K3: muat ulang = koneksi IndexedDB baru (pesan Safari sendiri: "Refresh the page to try again"). Salinan fragmen ada
     di sessionStorage, jadi halaman yang sama terbuka lagi dan foto di HP dikirim dari situ. */
  function muatUlang() {
    matikanKamera();
    try { location.reload(); } catch (e) { /* peramban menolak: admin bisa memuat ulang sendiri */ }
  }
  function butuhMuatUlang() {
    matikanKamera();
    layarNota(false);
    popup(KABAR_MUAT, muatUlang);
  }
  function tutupHalaman() {
    matikanKamera();
    S.foto = null;
    S.menungguTutup = false;
    hapusSesi();
    try { window.close(); } catch (e) { /* peramban menolak menutup tab ini */ }
    setTimeout(() => layarPesan(S.terkirim ? 'Selesai' : 'Foto nota', 'Kembali ke tab Portal untuk melanjutkan. Halaman ini boleh ditutup.', false), 300);
  }

  /* ---------- periksa token foto begitu halaman dibuka (BUILD v405 § 4.1, § 6) ----------
     Hanya jawaban token/sesi/akses/lihat yang dipakai untuk berhenti, dan hanya selama belum ada foto atau hapus yang
     sedang/sudah dikirim — kiriman itu melaporkan hasilnya sendiri. v6: jawaban ok membawa `pemilik` (Portal v413),
     `sampai` + `kini` (sisa waktu halaman menurut jam Portal, unggah-foto-06 / K2); sinyal putus diulang di latar selama
     ada foto antre. */
  async function periksaToken() {
    const nomor = ++S.nomorPeriksa, p = S.p;
    clearTimeout(S.jamPeriksa);
    S.periksaJalan = true;
    let j = null;
    try { j = await kirimSekali(JSON.stringify({jenis: 'nota-token', t: p.t, idOutlet: p.o}), BATAS_PERIKSA); } catch (e) { j = null; }
    if (nomor !== S.nomorPeriksa || S.p !== p) return;
    S.periksaJalan = false;
    if (!j || (j.ok !== true && !KODE_PERIKSA.has(String(j.kode || '')))) return periksaNanti();
    if (j.ok === true) {
      S.ulangPeriksa = 0;
      catatPemilik(j, p.o);
      catatSampai(j.sampai, j.kini);
      await muatAntrean();
      segarkan();
      bangunkan();
      return;
    }
    if (j.kode === 'token' || j.kode === 'sesi') S.tokenMati = true;
    if (S.sibuk || S.foto || S.terkirim || S.berubah || S.sibukHapus || antreSendiri().length || ['nota', 'kamera', 'tolak'].indexOf(S.layar) < 0) {
      return segarkan();
    }
    const kb = KABAR[j.kode] || KABAR.token;
    tutupPopup(false);
    tutupTanya(false);
    layarPesan(kb[0], kb[1], true);
  }
  /* Pemeriksaan awal gagal (sinyal putus, sibuk) sementara ada foto dari tab lain yang menunggu `pemilik`: diulang di
     latar dengan jeda antrean, supaya foto itu (dan foto faktur yang sama di belakangnya) tidak tertahan. */
  function periksaNanti() {
    clearTimeout(S.jamPeriksa);
    if (!idbAda() || S.server || S.tokenMati || S.periksaJalan) return;
    if (!S.antre.some(x => !milikTab(x) && !umurLewat(x))) return;   // hanya perlu untuk foto dari tab lain
    S.jamPeriksa = setTimeout(() => { if (!S.server && !S.tokenMati) periksaToken(); },
      JEDA_ANTRE[Math.min(S.ulangPeriksa++, JEDA_ANTRE.length - 1)]);
  }
  /* Sisa waktu token = `sampai` − `kini`, KEDUANYA jam Portal, lalu dihitung mundur dengan jam halaman (performance.now)
     sejak jawaban tiba. Jam HP (Date.now) tidak dipakai sebagai patokan: v6 K2 (bantahan peninjau) — HP yang jamnya
     maju ≥ 20 menit menghitung sisa terlalu pendek, ditolak memotret, sementara Portal memberi token yang SAMA selama sisa aslinya > 30
     menit (v412) / 90 menit (v413), jadi admin berputar "Buka lagi dari Portal". Portal tanpa `kini` (v412) → sisa tidak
     diketahui → tidak memblokir sebelum memotret (perilaku v5): kiriman yang memeriksa. Angka yang tidak masuk akal
     (sisa > 2 jam + 5 menit, atau lewat > 5 menit) juga diabaikan.
     L413-K2-tidur (tinjau ulang gelombang 4): performance.now BERHENTI selama HP tidur (Android CLOCK_MONOTONIC, iOS
     mach_absolute_time), jadi tab yang hidup melewati HP terkunci ±2 jam membaca sisa masih banyak, kamera menyala, lalu
     fotonya ditolak Portal. Waktu berlalu = max(selisih monoton, selisih jam HP sejak jawaban tiba): selisih jam HP ikut
     menghitung waktu tidur dan jam HP yang salah tetap (maju/mundur sekian menit) hilang di selisih; max dengan selisih
     monoton menangkap jam HP yang dimundurkan di tengah jalan. Tanpa padaJam (data lama) = selisih monoton saja. */
  function catatSampai(v, kini) {
    const n = Number(v), sisa = n - kini;
    S.sisaToken = typeof kini === 'number' && isFinite(kini) && kini > 0 && isFinite(n) && n > 0 && sisa > -5 * 60000 &&
      sisa <= TOKEN_MAKS + 5 * 60000 ? {sisa, pada: performance.now(), padaJam: Date.now()} : null;
  }
  function sisaToken() {
    const s = S.sisaToken;
    if (!s) return Infinity;
    const monoton = performance.now() - s.pada, jam = typeof s.padaJam === 'number' && isFinite(s.padaJam) ? Date.now() - s.padaJam : monoton;
    return s.sisa - Math.max(monoton, isFinite(jam) ? jam : monoton);
  }

  /* ---------- mulai ---------- */
  async function siapkanAntrean() {
    if (!S.p || S.p.v !== '3') return;
    const db = await idbBuka();
    if (!db || !S.p) return;
    await sapuKedaluwarsa();
    await muatAntrean();
    segarkan();
    bangunkan();
    periksaNanti();              // pemeriksaan awal sudah gagal sebelum antrean terbaca
  }
  function mulai() {
    let x = null, tab = '';
    const sebelum = bacaSesi();
    if (location.hash.length > 1) {
      const p = bacaFragmen(location.hash);
      try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* biarkan */ }
      x = p ? {p, k: keadaanAwal(p)} : null;
      if (!x) hapusSesi();
      /* id tab terikat token: tab yang sama dibuka lagi dengan token lain (akun lain) = tab baru bagi antrean */
      if (x && sebelum && sebelum.p.t === x.p.t) tab = sebelum.tab;
    } else {
      x = sebelum;
      tab = x ? x.tab : '';
    }
    if (!x) {
      S.p = null;
      return layarPesan('Buka dari Portal', 'Halaman ini dibuka dari Portal Asia Group: menu Foto nota, lalu pilih notanya.', true);
    }
    S.p = x.p;
    pakaiKeadaan(x.k);
    S.tab = HEX24.test(String(tab)) ? tab : idAcak();
    S.gambar = {};
    S.foto = null;
    S.sibuk = false;
    S.terkirim = false;
    S.berubah = false;
    S.hapus = {nota: null, barang: null};
    S.sibukHapus = '';
    S.apa = 'nota';
    S.pemilik = '';
    S.server = '';
    S.tokenMati = false;
    S.sisaToken = null;
    S.hijau = {};
    S.ganti = {nota: '', barang: ''};
    S.ragu = {nota: null, barang: null};
    S.raguCalon = null;
    S.menungguTutup = false;
    S.ulangPeriksa = 0;
    S.periksaJalan = false;
    S.kedaluwarsa = 0;
    try { localStorage.removeItem('kamera-nota-bentuk'); } catch (e) { /* simpanan pilihan Nota/Struk v3 dibuang */ }
    try { S.flash = localStorage.getItem(KUNCI_FLASH) !== '0'; } catch (e) { S.flash = true; }
    try { S.bingkai = localStorage.getItem(KUNCI_BINGKAI) === 'tegak' ? 'tegak' : 'mendatar'; } catch (e) { S.bingkai = 'mendatar'; }
    simpanSesi();
    try { sessionStorage.removeItem(KUNCI_SESI_V3); } catch (e) { /* abaikan */ }
    isiKepala();
    layarNota(false);
    periksaToken();
    siapkanAntrean();
  }
  function muatHuruf() {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap';
    document.head.appendChild(l);
  }

  $('kam-rana').addEventListener('click', jepret);
  $('kam-tutup').addEventListener('click', () => layarNota(true));
  $('kam-flash').addEventListener('click', tombolFlash);
  $('bingkai-mendatar').addEventListener('click', () => pilihBingkai('mendatar'));
  $('bingkai-tegak').addEventListener('click', () => pilihBingkai('tegak'));
  document.querySelectorAll('.pilih-foto').forEach(inp => {
    inp.addEventListener('click', () => { if (S.stream) matikanKamera(); });
    inp.addEventListener('change', () => {
      const f = inp.files && inp.files[0];
      inp.value = '';
      if (f) dariBerkas(f);
      else if (S.layar === 'kamera') bukaKamera(S.apa);
    });
    /* batal memilih foto: kamera halaman dinyalakan lagi (peramban yang tidak mengirim `change` saat batal) */
    inp.addEventListener('cancel', () => { if (S.layar === 'kamera' && !S.stream) bukaKamera(S.apa); });
  });
  $('n-kembali').addEventListener('click', tutupAman);
  $('n-selesai').addEventListener('click', () => { if (adaTampil('nota') && adaTampil('barang') && !S.sibukHapus) tutupAman(); });
  $('t-kembali').addEventListener('click', () => { if (!S.sibuk) { simpanRagu(); layarNota(true); } });
  $('t-tolak-kembali').addEventListener('click', () => layarNota(true));
  $('t-tutup').addEventListener('click', tutupHalaman);
  $('t-tutup2').addEventListener('click', tutupHalaman);
  $('t-tutup3').addEventListener('click', tutupHalaman);
  $('t-muat-ulang').addEventListener('click', muatUlang);
  $('t-batal-tunggu').addEventListener('click', () => layarNota(true));
  $('t-kirim-ulang').addEventListener('click', kirim);
  $('t-foto-lagi').addEventListener('click', () => { simpanRagu(); S.foto = null; bukaKamera(S.apa); });
  $('t-coba-kamera').addEventListener('click', () => bukaKamera(S.apa));
  $('pop-tombol').addEventListener('click', () => tutupPopup(true));
  $('tanya-batal').addEventListener('click', () => tutupTanya(false));
  $('tanya-hapus').addEventListener('click', () => tutupTanya(true));
  document.addEventListener('keydown', e => {
    if (!$('tanya').hidden) {
      if (e.key === 'Escape') { e.preventDefault(); tutupTanya(false); } else if (e.key === 'Tab') {
        e.preventDefault();
        (document.activeElement === $('tanya-batal') ? $('tanya-hapus') : $('tanya-batal')).focus();
      }
      return;
    }
    if ($('pop').hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); tutupPopup(false); } else if (e.key === 'Tab') { e.preventDefault(); $('pop-tombol').focus(); }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if (S.stream || S.layar === 'kamera') matikanKamera(); } else {
      if (S.layar === 'kamera' && !S.stream) bukaKamera(S.apa);
      bangunkan(true);                                          // peramban HP menahan jam latar: coba lagi begitu tampil
    }
  });
  window.addEventListener('online', () => { bangunkan(true); if (S.p && !S.server) { S.ulangPeriksa = 0; periksaNanti(); } });
  window.addEventListener('offline', () => { if (S.layar === 'nota') gambarNota(); });
  window.addEventListener('pagehide', matikanKamera);
  window.addEventListener('pageshow', e => {
    if (e.persisted && S.layar === 'kamera' && !S.stream) bukaKamera(S.apa);
    if (e.persisted) bangunkan(true);
  });
  window.addEventListener('resize', letakKotak);
  /* HP diputar / bilah peramban muncul: ukuran bidang kamera bisa berubah sesudah `resize` (Safari iOS), jadi bingkai
     dihitung ulang juga setiap kali bidangnya sendiri berubah ukuran. */
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => letakKotak()).observe($('kam-bidik'));
  /* Peringatan tutup: foto/hapus jalur sinkron sedang berjalan, atau foto antre yang hanya bisa dikirim dari sini.
     Halaman yang tidak bisa mengirim lagi (token habis; v6 K3: antrean rusak, tombol Muat ulang) tidak menahan: fotonya
     tetap di HP dan dikirim halaman berikutnya. */
  window.addEventListener('beforeunload', e => {
    if (S.foto || S.sibuk || S.sibukHapus || (idbAda() && !S.tokenMati && antreSendiri().length)) { e.preventDefault(); e.returnValue = ''; }
  });
  window.addEventListener('hashchange', () => { if (location.hash.length > 1 && !S.sibuk && !S.foto && !S.sibukHapus) mulai(); });

  try { window.opener = null; } catch (e) { /* tidak ada jendela pembuka */ }
  mulai();
  setTimeout(muatHuruf, 0);
})();
