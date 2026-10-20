'use strict';
/* Kamera nota v5 — Portal Asia Group · Supply Chain (kontrak: laporan-scm-finance-2026-10-14/BUILD.md § 5,
   foto-nota-v405-2026-10-16/BUILD.md § 6, foto-nota-v406-2026-10-16/BUILD.md § 2–§ 5,
   masukan-uji-v412-2026-10-20/BUILD.md § 4: pilihan bingkai Mendatar | Tegak).
   Dibuka Portal (menu Foto nota) di tab baru, di LAYAR NOTA: dua kotak (Foto nota, Foto barang). Kotak kosong =
   tombol kamera; kotak terisi = gambar kecil + Hapus. Kamera menyala di halaman yang sama (tanpa muat ulang), jadi
   izin kamera HP cukup ditanya sekali selama tab ini terbuka.
     v=3 (Portal v406): #v=3&api&t&o&on&f&s&g&tgl&j&jd&st&set&fn&fb&kk&kj&kc&ko&kt&ka (BUILD v406 § 5)
     v=2 (Portal v405, selama jeda rilis): #v=2&api&t&o&on&f&s&g&tgl&m&set&hal&j — m=baru → dua kotak kosong;
         m=barang|tambah|ganti → kotak nota "Sudah ada" tanpa gambar dan tanpa Hapus.
   - Fragmen (#) tidak terkirim ke hosting dan langsung dihapus dari alamat. Salinannya + keadaan terakhir yang
     diketahui (id foto, set, status; BUKAN gambar) hanya di sessionStorage tab ini, supaya muat ulang tetap jalan.
   - Foto hanya di memori halaman: tidak ada salinan di galeri HP dan tidak ada yang tersimpan di hosting.
   - Kirim/hapus langsung ke Portal (doPost nota-foto / nota-hapus): fetch POST text/plain (tanpa preflight), batas
     25 dtk, 3 kali ulang otomatis (1, 3, 7 dtk) dengan idFoto/idAksi yang sama. Server menolak simpan ganda.
   - Foto yang sudah ada di Portal dimuat lewat doPost nota-gambar dan dipasang sebagai data URL (CSP img-src data:).
   - Token foto berumur pendek; token sesi Portal tidak pernah sampai ke sini. Server memeriksa ulang akun, cabang,
     faktur, jendela 2 hari, mode, dan ukuran foto. Semua teks dari Portal ditulis lewat textContent. */
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
  const BATAS_TUNGGU = UJI.batas || 25000;
  const BATAS_PERIKSA = UJI.batasPeriksa || 15000;
  const JEDA_LANGKAH3 = 300, JEDA_KEMBALI = UJI.kembali || 1200;
  const KUNCI_SESI = 'kamera-nota-v4', KUNCI_SESI_V3 = 'kamera-nota-v2', KUNCI_FLASH = 'kamera-nota-flash';
  const KUNCI_BINGKAI = 'kamera-nota-bingkai';
  const KODE_ULANG = new Set(['sibuk', 'belum-pasti', 'gagal']);
  /* Pemeriksaan awal hanya bertindak atas jawaban yang pasti berarti "kiriman nanti akan ditolak". Jawaban lain
     (Portal v403 yang belum mengenal pemeriksaan ini, sibuk, gagal, sinyal putus) didiamkan: unggah tetap memeriksa. */
  const KODE_PERIKSA = new Set(['token', 'sesi', 'akses', 'lihat']);
  const HEX24 = /^[a-f0-9]{24}$/;
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
  const BELUM_TERKIRIM = 'Belum terkirim. Periksa sinyal lalu tekan Kirim ulang. Foto masih di halaman ini, jangan tutup dulu.';

  const S = {
    p: null,                       // fragmen yang sudah diperiksa (v=2 atau v=3)
    set: '', status: '', nota: [], barang: '', notaLama: false, kk: '', baru: {nota: false, barang: false},
    gambar: {},                    // idFoto → {st: 'muat'|'ok'|'gagal', url}; tidak pernah disimpan ke sessionStorage
    apa: 'nota', stream: null, nomorKamera: 0, layar: '', flash: true, bisaFlash: false, bingkai: 'mendatar',
    foto: null, sibuk: false, terkirim: false, berubah: false, nomorPeriksa: 0, nomorKirim: 0, jamKembali: 0,
    hapus: {nota: null, barang: null}, sibukHapus: ''
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
  function bita(url) {
    const n = url.length - url.indexOf(',') - 1;
    return n * 3 / 4 - (url.endsWith('==') ? 2 : url.endsWith('=') ? 1 : 0);
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
  function simpanSesi() {
    if (!S.p) return;
    const k = {set: S.set, status: S.status, nota: S.nota, barang: S.barang, notaLama: S.notaLama, kk: S.kk, baru: S.baru};
    try { sessionStorage.setItem(KUNCI_SESI, JSON.stringify({p: S.p, k})); } catch (e) { /* tanpa simpanan: muat ulang minta buka dari Portal */ }
  }
  function bacaSesi() {
    try {
      const x = JSON.parse(sessionStorage.getItem(KUNCI_SESI) || 'null');
      if (x && sah(x.p)) return {p: x.p, k: sahKeadaan(x.k) ? x.k : keadaanAwal(x.p)};
      /* tab yang terbuka sejak halaman v3: salinannya berbentuk alamat v=2 */
      const lama = JSON.parse(sessionStorage.getItem(KUNCI_SESI_V3) || 'null');
      if (lama && typeof lama === 'object' && lama.j === undefined) lama.j = '';
      if (lama && lama.v === '2' && sah(lama)) return {p: lama, k: keadaanAwal(lama)};
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
     kotak "Sudah ada" dari alamat v=2 yang tidak membawa id foto. */
  const bolehHapus = apa => S.p.v === '3' && !cocok() && (apa === 'nota' ? S.nota.length > 0 : adaBarang());
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
  /* Keadaan di jawaban ok nota-foto / nota-hapus (BUILD v406 § 6.4). Cacat atau tidak ada (Portal v405) → null. */
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
    } else {
      if (asal.apa === 'nota') { S.nota = []; S.set = ''; S.notaLama = false; } else S.barang = '';
      if (S.status) S.status = statusSetempat();
    }
  }

  /* ---------- layar ---------- */
  function tampil(nama) {
    S.layar = nama;
    ['nota', 'kamera', 'kirim', 'tolak', 'pesan'].forEach(n => { $(n).hidden = n !== nama; });
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
  function kotak(apa) {
    const w = $('slot-' + apa), isi = ada(apa), h = S.hapus[apa], menghapus = S.sibukHapus === apa;
    w.textContent = '';
    w.className = 'slot ' + (isi ? 'terisi' : 'kosong') + (target(apa) ? ' target' : '') + (menghapus ? ' menghapus' : '');
    if (!isi) {
      const b = el('button', 'slot-tombol');
      b.type = 'button';
      b.id = 'foto-' + apa;
      b.append(ikon('kamera'), el('b', '', NAMA[apa]));
      if (tungguNota(apa)) b.append(el('span', 'slot-ket', 'Foto nota dulu'));
      b.disabled = !!S.sibukHapus || tungguNota(apa);
      b.addEventListener('click', () => { if (!b.disabled) bukaKamera(apa); });
      w.append(b);
    } else {
      const kotakIsi = el('div', 'slot-isi'), kepala = el('div', 'slot-kepala'), ditolak = S.kk === 'tolak' && S.p.kt === apa;
      /* foto yang ditolak: label merah "Ditolak" TANPA centang hijau (BUILD v405 permintaan 2) */
      if (!ditolak) { const cek = el('span', 'cek'); cek.append(ikon('cek')); kepala.append(cek); }
      kepala.append(el('b', '', NAMA[apa]));
      if (ditolak) kepala.append(el('span', 'pil-tolak', 'Ditolak'));
      if (bolehHapus(apa)) {
        const hb = el('button', 'slot-hapus');
        hb.type = 'button';
        hb.id = 'hapus-' + apa;
        hb.append(ikon('sampah'), document.createTextNode('Hapus'));
        hb.setAttribute('aria-label', 'Hapus ' + NAMA[apa].toLowerCase());
        hb.disabled = !!S.sibukHapus;
        hb.addEventListener('click', () => tanyaHapus(apa));
        kepala.append(hb);
      }
      kotakIsi.append(kepala, gambarKotak(apa));
      w.append(kotakIsi);
      if (menghapus) w.append(el('div', 'slot-sibuk', 'Menghapus…'));
    }
    if (h && h.pesan) {
      const ps = el('p', 'slot-pesan', h.pesan);
      ps.setAttribute('role', 'alert');
      w.append(ps);
    }
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
  function gambarNota() {
    if (!S.p) return;
    isiKeadaan();
    kotak('nota');
    kotak('barang');
    const siap = adaNota() && adaBarang() && !S.sibukHapus;
    $('n-selesai').disabled = !siap;
    $('n-selesai-ket').hidden = adaNota() && adaBarang();
    if (S.p.v === '3') {
      [S.nota[0] && S.nota[0].idFoto, S.barang].forEach(id => { if (id && !S.gambar[id]) muatGambar(id); });
    }
  }
  function layarNota(fokus) {
    matikanKamera();
    tutupPopup(false);
    clearTimeout(S.jamKembali);
    S.foto = null;
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

  /* ---------- kabar gagal (pop-up) dan tanya hapus ---------- */
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
  let tanyaApa = '', tanyaKembali = null;
  function tanyaHapus(apa) {
    if (S.sibukHapus || !bolehHapus(apa)) return;
    tanyaApa = apa;
    tanyaKembali = document.activeElement;
    $('tanya-judul').textContent = apa === 'nota' ? 'Hapus foto nota?' : 'Hapus foto barang?';
    $('tanya').hidden = false;
    $('tanya-batal').focus();
  }
  function tutupTanya(hapusJuga) {
    if ($('tanya').hidden) return;
    $('tanya').hidden = true;
    const apa = tanyaApa;
    tanyaApa = '';
    if (hapusJuga && apa) return hapus(apa);
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
    S.nomorKamera++;
    if (S.stream) S.stream.getTracks().forEach(t => t.stop());   // senter ikut mati bersama kamera
    S.stream = null;
    S.bisaFlash = false;
    $('kam-video').srcObject = null;
  }
  /* Resolusi (BUILD v406 § 3): minta 3264×2448 (4:3); HP yang tidak sanggup menolak dengan OverconstrainedError →
     coba lagi tanpa ukuran. */
  async function mintaKamera() {
    const md = navigator.mediaDevices;
    try {
      return await md.getUserMedia({audio: false, video: {facingMode: {ideal: 'environment'}, width: {ideal: 3264},
        height: {ideal: 2448}, aspectRatio: {ideal: 4 / 3}}});
    } catch (e) {
      if (!e || (e.name !== 'OverconstrainedError' && e.name !== 'ConstraintNotSatisfiedError')) throw e;
      return md.getUserMedia({audio: false, video: {facingMode: {ideal: 'environment'}}});
    }
  }
  async function bukaKamera(apa) {
    if (apa) S.apa = apa;
    tutupPopup(false);
    matikanKamera();
    clearTimeout(S.jamKembali);
    const barang = S.apa === 'barang';
    $('kamera').classList.toggle('barang', barang);
    $('kam-apa').textContent = NAMA[S.apa];
    $('kam-kertas').textContent = S.p.j || S.p.s || S.p.f;
    tampilBingkai();
    $('kam-flash').hidden = true;
    tampil('kamera');
    const nomor = S.nomorKamera, rana = $('kam-rana');
    rana.disabled = true;
    ket('Menyalakan kamera…');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return kameraGagal('');
    let st;
    try {
      st = await mintaKamera();
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
  function jadikanJpeg(c) {
    for (let putaran = 0; ; putaran++) {
      let q = 0.8, url = c.toDataURL('image/jpeg', q);
      while (bita(url) > BITA_MAKS && q > 0.45) { q = Math.round((q - 0.08) * 100) / 100; url = c.toDataURL('image/jpeg', q); }
      if (url.indexOf('data:image/jpeg;base64,') !== 0) throw new Error('jpeg');
      if (bita(url) <= BITA_MAKS || putaran >= 4) return {url, w: c.width, h: c.height};
      c = potong(c, 0, 0, c.width, c.height, 0.8);   // masih terlalu besar: perkecil sisi 20% lalu ulangi
    }
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
    matikanKamera();
    if (!c) return gagalFoto();
    olah(c, 'kamera');
  }
  function gagalFoto() {
    popup(['Foto belum terbaca', 'Coba foto lagi. Kalau tetap gagal, pakai kamera bawaan HP.', 'Foto lagi'], () => bukaKamera(S.apa));
  }
  function olah(c, sumber) {
    S.foto = null;
    S.nomorKirim++;
    clearTimeout(S.jamKembali);
    tampil('kirim');
    window.scrollTo(0, 0);
    aksi(null);
    hasilKotak(null);
    $('t-kembali').hidden = true;
    $('kirim-judul').textContent = NAMA[S.apa] + ' · ' + kertas();
    $('kirim-img').hidden = true;
    $('kirim-img').removeAttribute('src');
    /* BUILD v406 § 4: kalimat langkah mengikuti keadaan (sedang → selesai) */
    langkah(1, 'jalan', 'Merapikan foto…');
    langkah(2, '', 'Mengirim ke Portal…', '');
    langkah(3, '', 'Masuk Laporan harian…');
    const apa = S.apa;
    sesudahGambar(() => {
      let hasil = null;
      try { hasil = jadikanJpeg(c); } catch (e) { hasil = null; }
      c.width = c.height = 0;
      if (!hasil) return gagalFoto();
      S.foto = {url: hasil.url, w: hasil.w, h: hasil.h, idFoto: idAcak(), sumber, apa,
        /* foto nota selalu set baru; foto barang memakai set nota sekarang bila ada (BUILD v406 § 2) */
        mode: apa === 'nota' ? 'baru' : 'barang',
        idSet: apa === 'nota' ? idAcak() : (S.nota.length || S.notaLama) && S.set ? S.set : idAcak()};
      $('kirim-img').alt = NAMA[apa] + ' ' + S.p.f;
      $('kirim-img').src = hasil.url;
      $('kirim-img').hidden = false;
      langkah(1, 'beres', sumber === 'kamera' && apa === 'nota' ? 'Foto dirapikan sesuai kotak' : 'Foto dirapikan');
      kirim();
    });
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

  /* ---------- kirim ke Portal ---------- */
  async function kirimSekali(badan, batas) {
    const ac = typeof AbortController === 'function' ? new AbortController() : null;
    const jam = setTimeout(() => { if (ac) ac.abort(); }, batas || BATAS_TUNGGU);
    try {
      const r = await fetch(S.p.api, {method: 'POST', body: badan, headers: {'Content-Type': 'text/plain;charset=utf-8'},
        redirect: 'follow', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
        signal: ac ? ac.signal : undefined});
      const teks = await r.text();
      let j = null;
      try { j = JSON.parse(teks); } catch (e) { j = null; }
      return j && typeof j === 'object' ? j : {ok: false, kode: 'gagal'};
    } finally {
      clearTimeout(jam);
    }
  }
  /* Aturan ulang yang sama untuk kirim foto dan hapus: sinyal putus / sibuk / belum-pasti / gagal diulang 3 kali
     (1, 3, 7 dtk) dengan badan yang sama persis (idFoto/idAksi sama). */
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
      akhir = {kode: String(j.kode || 'gagal'), pesan: typeof j.pesan === 'string' ? j.pesan : ''};
      if (!KODE_ULANG.has(akhir.kode)) break;
    }
    return akhir;
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
    const badan = JSON.stringify({jenis: 'nota-foto', t: S.p.t, idOutlet: S.p.o, idFoto: F.idFoto, idSet: F.idSet,
      mode: F.mode, hal: '', faktur: S.p.f, tanggal: S.p.tgl, foto: F.url, w: F.w, h: F.h, sumber: F.sumber});
    const r = await kirimBerulang(badan, jaringan => langkah(2, 'jalan', 'Mengirim ke Portal…',
      jaringan ? 'Sinyal lemah, mencoba lagi…' : 'Portal sedang sibuk, mencoba lagi…'));
    S.sibuk = false;
    if (r.ok) return berhasil(r.j, F);
    if (S.foto === F) gagalKirim(r);                           // selain itu admin sudah kembali ke layar nota
  }
  async function berhasil(j, F) {
    const nomor = S.nomorKirim, layarIni = S.foto === F && S.layar === 'kirim';
    S.terkirim = true;
    S.berubah = true;
    if (S.foto === F) S.foto = null;
    S.gambar[F.idFoto] = {st: 'ok', url: F.url};
    terapkanJawaban(j, {jenis: 'foto', apa: F.apa, idFoto: F.idFoto, idSet: F.idSet});
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
    hasilKotak('ok', F.apa === 'nota' ? 'Foto nota terkirim.' : 'Foto barang terkirim.');
    $('t-kembali').hidden = false;
    S.jamKembali = setTimeout(() => { if (nomor === S.nomorKirim && S.layar === 'kirim') layarNota(true); }, JEDA_KEMBALI);
  }
  function gagalKirim(akhir) {
    $('t-kembali').hidden = false;
    if (akhir.jaringan) {
      langkah(2, 'gagal', 'Belum terkirim', '');
      hasilKotak('gagal', BELUM_TERKIRIM);
      aksi('ulang');
      return;
    }
    langkah(2, 'gagal', 'Belum tersimpan', '');
    if (akhir.kode === 'isian') {
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

  /* ---------- hapus (BUILD v406 § 2, § 6.2) ---------- */
  function sidikKotak(apa) { return apa === 'nota' ? S.set + '|' + S.nota.map(x => x.idFoto).join(',') : S.barang; }
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

  function tutupHalaman() {
    matikanKamera();
    S.foto = null;
    hapusSesi();
    try { window.close(); } catch (e) { /* peramban menolak menutup tab ini */ }
    setTimeout(() => layarPesan(S.terkirim ? 'Selesai' : 'Foto nota', 'Kembali ke tab Portal untuk melanjutkan. Halaman ini boleh ditutup.', false), 300);
  }

  /* ---------- periksa token foto begitu halaman dibuka (BUILD v405 § 4.1, § 6) ----------
     Sekali, tanpa ulang. Hanya jawaban token/sesi/akses/lihat yang dipakai, dan hanya selama belum ada foto atau
     hapus yang sedang/sudah dikirim — kiriman itu melaporkan hasilnya sendiri. */
  async function periksaToken() {
    const nomor = ++S.nomorPeriksa, p = S.p;
    let j = null;
    try { j = await kirimSekali(JSON.stringify({jenis: 'nota-token', t: p.t, idOutlet: p.o}), BATAS_PERIKSA); } catch (e) { return; }
    if (nomor !== S.nomorPeriksa || S.p !== p) return;
    if (!j || j.ok !== false || !KODE_PERIKSA.has(String(j.kode || ''))) return;
    if (S.sibuk || S.foto || S.terkirim || S.berubah || S.sibukHapus || ['nota', 'kamera', 'tolak'].indexOf(S.layar) < 0) return;
    const kb = KABAR[j.kode] || KABAR.token;
    tutupPopup(false);
    tutupTanya(false);
    layarPesan(kb[0], kb[1], true);
  }

  /* ---------- mulai ---------- */
  function mulai() {
    let x = null;
    if (location.hash.length > 1) {
      const p = bacaFragmen(location.hash);
      try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* biarkan */ }
      x = p ? {p, k: keadaanAwal(p)} : null;
      if (!x) hapusSesi();
    } else {
      x = bacaSesi();
    }
    if (!x) {
      S.p = null;
      return layarPesan('Buka dari Portal', 'Halaman ini dibuka dari Portal Asia Group: menu Foto nota, lalu pilih notanya.', true);
    }
    S.p = x.p;
    pakaiKeadaan(x.k);
    S.gambar = {};
    S.foto = null;
    S.sibuk = false;
    S.terkirim = false;
    S.berubah = false;
    S.hapus = {nota: null, barang: null};
    S.sibukHapus = '';
    S.apa = 'nota';
    try { localStorage.removeItem('kamera-nota-bentuk'); } catch (e) { /* simpanan pilihan Nota/Struk v3 dibuang */ }
    try { S.flash = localStorage.getItem(KUNCI_FLASH) !== '0'; } catch (e) { S.flash = true; }
    try { S.bingkai = localStorage.getItem(KUNCI_BINGKAI) === 'tegak' ? 'tegak' : 'mendatar'; } catch (e) { S.bingkai = 'mendatar'; }
    simpanSesi();
    try { sessionStorage.removeItem(KUNCI_SESI_V3); } catch (e) { /* abaikan */ }
    isiKepala();
    layarNota(false);
    periksaToken();
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
  $('n-kembali').addEventListener('click', tutupHalaman);
  $('n-selesai').addEventListener('click', () => { if (adaNota() && adaBarang() && !S.sibukHapus) tutupHalaman(); });
  $('t-kembali').addEventListener('click', () => { if (!S.sibuk) layarNota(true); });
  $('t-tolak-kembali').addEventListener('click', () => layarNota(true));
  $('t-tutup').addEventListener('click', tutupHalaman);
  $('t-tutup2').addEventListener('click', tutupHalaman);
  $('t-kirim-ulang').addEventListener('click', kirim);
  $('t-foto-lagi').addEventListener('click', () => { S.foto = null; bukaKamera(S.apa); });
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
    if (document.hidden) { if (S.stream || S.layar === 'kamera') matikanKamera(); } else if (S.layar === 'kamera' && !S.stream) bukaKamera(S.apa);
  });
  window.addEventListener('pagehide', matikanKamera);
  window.addEventListener('pageshow', e => { if (e.persisted && S.layar === 'kamera' && !S.stream) bukaKamera(S.apa); });
  window.addEventListener('resize', letakKotak);
  /* HP diputar / bilah peramban muncul: ukuran bidang kamera bisa berubah sesudah `resize` (Safari iOS), jadi bingkai
     dihitung ulang juga setiap kali bidangnya sendiri berubah ukuran. */
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => letakKotak()).observe($('kam-bidik'));
  window.addEventListener('beforeunload', e => { if (S.foto || S.sibuk || S.sibukHapus) { e.preventDefault(); e.returnValue = ''; } });
  window.addEventListener('hashchange', () => { if (location.hash.length > 1 && !S.sibuk && !S.foto && !S.sibukHapus) mulai(); });

  try { window.opener = null; } catch (e) { /* tidak ada jendela pembuka */ }
  mulai();
  setTimeout(muatHuruf, 0);
})();
