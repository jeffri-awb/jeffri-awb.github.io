'use strict';
/* Kamera nota v2 — Portal Asia Group · Supply Chain (kontrak: laporan-scm-finance-2026-10-14/BUILD.md § 5).
   Dibuka Portal (menu Foto nota) di tab baru:
     #v=2&api=<alamat exec>&t=<token foto>&o=<idOutlet>&on=<nama cabang>&f=<faktur>&s=<supplier>&g=<total>
      &tgl=<yyyy-mm-dd>&m=<baru|tambah|ganti>&set=<idSet>&hal=<halaman>
   - Fragmen (#) tidak terkirim ke hosting dan langsung dihapus dari alamat. Salinannya hanya di sessionStorage tab
     ini, supaya muat ulang tetap jalan.
   - Foto hanya di memori halaman: tidak ada salinan di galeri HP dan tidak ada yang tersimpan di hosting.
   - Kirim langsung ke Portal (doPost jenis nota-foto): fetch POST text/plain (tanpa preflight), batas 25 dtk,
     3 kali ulang otomatis (1, 3, 7 dtk) dengan idFoto yang sama. Server menolak simpan ganda per idFoto.
   - Token foto berumur pendek; token sesi Portal tidak pernah sampai ke sini. Server memeriksa ulang akun, cabang,
     faktur, jendela 2 hari, mode, dan ukuran foto. */
(() => {
  const UJI = window.__ujiKameraNota || {};            // hanya diisi uji otomatis, untuk memperpendek jeda
  const $ = id => document.getElementById(id);
  const BENTUK = {nota: 0.72, struk: 0.42};
  const SISI_MAKS = 1600, BITA_MAKS = 330 * 1024, HAL_MAKS = 6;
  const JEDA_ULANG = UJI.jeda || [1000, 3000, 7000];
  const BATAS_TUNGGU = UJI.batas || 25000;
  const KUNCI_SESI = 'kamera-nota-v2', KUNCI_BENTUK = 'kamera-nota-bentuk';
  const KODE_ULANG = new Set(['sibuk', 'belum-pasti', 'gagal']);
  const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober',
    'November', 'Desember'];
  const BULAN_PENDEK = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

  /* Kabar gagal (BUILD.md § 9): [judul, isi, tombol, tindakan]. tindakan 'ulang' = kirim lagi foto yang sama,
     'tutup' = tidak ada yang bisa dilakukan dari halaman ini, kembali ke Portal. */
  const KABAR = {
    token: ['Halaman kamera sudah lama terbuka', 'Tutup halaman ini, lalu buka lagi dari Portal.', 'Tutup', 'tutup'],
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
      'Pak Jeffri.', 'Coba lagi', 'ulang']
  };
  KABAR.sesi = KABAR.token;
  const BELUM_TERKIRIM = 'Belum terkirim. Periksa sinyal lalu tekan Kirim ulang. Foto masih di halaman ini, jangan tutup dulu.';

  const S = {
    p: null, mode: 'baru', idSet: '', hal: 0, bentuk: 'nota', stream: null, nomorKamera: 0, layar: '',
    foto: null, sibuk: false, halaman: [], nHalaman: 0, halTerakhir: 0, terkirim: false
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
  function bulanTahun(t) {
    const m = /^(\d{4})-(\d{2})/.exec(t);
    return m ? BULAN[Number(m[2]) - 1] + ' ' + m[1] : '';
  }
  function bita(url) {
    const n = url.length - url.indexOf(',') - 1;
    return n * 3 / 4 - (url.endsWith('==') ? 2 : url.endsWith('=') ? 1 : 0);
  }
  function tunggu(ms) { return new Promise(r => setTimeout(r, ms)); }
  function sesudahGambar(fn) { requestAnimationFrame(() => setTimeout(fn, 0)); }

  /* ---------- data dari Portal ---------- */
  function bacaFragmen(h) {
    const q = new URLSearchParams(String(h || '').replace(/^#/, ''));
    const p = {};
    ['v', 'api', 't', 'o', 'on', 'f', 's', 'g', 'tgl', 'm', 'set', 'hal'].forEach(k => { p[k] = (q.get(k) || '').trim(); });
    return sah(p) ? p : null;
  }
  function sah(p) {
    return !!p && p.v === '2'
      && /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{10,}\/exec$/.test(p.api)
      && /^[a-f0-9]{32}$/.test(p.t)
      && /^[A-Za-z0-9_-]{2,40}$/.test(p.o)
      && typeof p.f === 'string' && p.f.length > 0 && p.f.length <= 64
      && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(p.tgl)
      && /^(baru|tambah|ganti)$/.test(p.m)
      && (p.m === 'baru' || /^[A-Za-z0-9_-]{6,64}$/.test(p.set))
      && (p.m !== 'ganti' || /^[1-6]$/.test(p.hal));
  }
  function simpanSesi(p) { try { sessionStorage.setItem(KUNCI_SESI, JSON.stringify(p)); } catch (e) { /* tanpa simpanan: muat ulang minta buka dari Portal */ } }
  function bacaSesi() {
    try { const p = JSON.parse(sessionStorage.getItem(KUNCI_SESI) || 'null'); return sah(p) ? p : null; } catch (e) { return null; }
  }
  function hapusSesi() { try { sessionStorage.removeItem(KUNCI_SESI); } catch (e) { /* abaikan */ } }

  /* ---------- layar ---------- */
  function tampil(nama) {
    S.layar = nama;
    ['kamera', 'kirim', 'tolak', 'pesan'].forEach(n => { $(n).hidden = n !== nama; });
    if (nama === 'kamera') letakKotak();
  }
  function isiKepala() {
    const p = S.p;
    $('kam-supplier').textContent = p.s || p.f;
    let info = p.f + (rupiah(p.g) ? ' · ' + rupiah(p.g) : '');
    if (S.mode === 'ganti') info += ' · foto ulang halaman ' + S.hal;
    else if (S.mode === 'tambah') info += S.nHalaman ? ' · halaman ' + (S.nHalaman + 1) : ' · halaman tambahan';
    $('kam-info').textContent = info;
    $('kirim-judul').textContent = p.f;
    $('kirim-sub').textContent = [p.s, p.on, tanggalPendek(p.tgl)].filter(Boolean).join(' · ');
    $('tolak-sub').textContent = [p.f, p.s].filter(Boolean).join(' · ');
  }
  function tujuan() { return ['Bukti nota', S.p.on, bulanTahun(S.p.tgl)].filter(Boolean).join(' · '); }
  function langkah(n, keadaan, teks) {
    const li = document.querySelector('#alur li[data-langkah="' + n + '"]');
    li.className = keadaan || '';
    const sp = n === 1 ? $('langkah1-ket') : n === 2 ? $('langkah2-ket') : null;
    if (sp && typeof teks === 'string') sp.textContent = teks;
  }
  function hasilKotak(jenis, teks) {
    const h = $('hasil');
    h.hidden = !jenis;
    h.className = 'hasil' + (jenis ? ' ' + jenis : '');
    h.textContent = teks || '';
  }
  function aksi(nama, fotoLagi) {
    $('aksi-ok').hidden = nama !== 'ok';
    $('aksi-ulang').hidden = nama !== 'ulang';
    $('aksi-tutup').hidden = nama !== 'tutup';
    $('t-foto-lagi2').hidden = !(nama === 'tutup' && fotoLagi);
  }
  function gambarKecil() {
    const daftar = S.halaman.map(x => ({hal: x.hal, url: x.url}));
    const F = S.foto;
    if (F) {
      if (F.mode === 'ganti') {
        const i = daftar.findIndex(x => x.hal === F.hal);
        if (i >= 0) daftar[i] = {hal: F.hal, url: F.url}; else daftar.push({hal: F.hal, url: F.url});
      } else {
        daftar.push({hal: S.nHalaman ? S.nHalaman + 1 : F.mode === 'baru' ? 1 : 0, url: F.url});
      }
    }
    const wadah = $('thumbs');
    wadah.textContent = '';
    daftar.forEach(x => {
      const fig = document.createElement('figure');
      fig.className = 'thumb';
      const img = document.createElement('img');
      img.src = x.url;
      img.alt = 'Nota ' + S.p.f + (x.hal ? ' halaman ' + x.hal : ' halaman tambahan');
      const cap = document.createElement('figcaption');
      cap.textContent = x.hal ? 'Hal. ' + x.hal : 'Halaman baru';
      fig.append(img, cap);
      wadah.append(fig);
    });
  }
  function layarPesan(judul, isi, bisaTutup) {
    tampil('pesan');
    $('pesan-judul').textContent = judul;
    $('pesan-isi').textContent = isi;
    $('t-tutup2').hidden = !bisaTutup;
  }

  /* ---------- kabar gagal (pop-up) ---------- */
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
    if (popKembali && popKembali.focus && document.contains(popKembali) && !popKembali.closest('[hidden]')) {
      popKembali.focus({preventScroll: true});
    }
    if (jalankan && t) t();
  }

  /* ---------- kamera ---------- */
  function letakKotak() {
    const b = $('kam-bidik'), k = $('kotak-bidik'), r = BENTUK[S.bentuk];
    const W = b.clientWidth, H = b.clientHeight;
    if (!W || !H) return;
    let h = H * 0.8, w = h * r;
    if (w > W * 0.86) { w = W * 0.86; h = w / r; }
    k.style.width = w + 'px';
    k.style.height = h + 'px';
    k.style.left = (W - w) / 2 + 'px';
    k.style.top = Math.max(8, (H - h) / 2 - H * 0.02) + 'px';
  }
  function pilihBentuk(b, simpan) {
    if (!BENTUK[b]) b = 'nota';
    S.bentuk = b;
    document.querySelectorAll('[data-bentuk]').forEach(x => x.setAttribute('aria-checked', String(x.dataset.bentuk === b)));
    $('kam-petunjuk').textContent = b === 'struk' ? 'Masukkan seluruh struk ke dalam kotak' : 'Masukkan seluruh nota ke dalam kotak';
    letakKotak();
    if (simpan) { try { localStorage.setItem(KUNCI_BENTUK, b); } catch (e) { /* hanya kenyamanan */ } }
  }
  function ket(t) { $('kam-ket').textContent = t; }
  function matikanKamera() {
    S.nomorKamera++;
    if (S.stream) S.stream.getTracks().forEach(t => t.stop());
    S.stream = null;
    $('kam-video').srcObject = null;
  }
  async function bukaKamera() {
    tutupPopup(false);
    matikanKamera();
    tampil('kamera');
    isiKepala();
    const nomor = S.nomorKamera, rana = $('kam-rana');
    rana.disabled = true;
    ket('Menyalakan kamera…');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return kameraGagal('');
    let st;
    try {
      st = await navigator.mediaDevices.getUserMedia({audio: false,
        video: {facingMode: {ideal: 'environment'}, width: {ideal: 2560}, height: {ideal: 1440}}});
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
    ket('Kamera belakang menyala');
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
  function kameraGagal(nama) {
    matikanKamera();
    const ditolak = nama === 'NotAllowedError' || nama === 'SecurityError';
    $('tolak-judul').textContent = ditolak ? 'Kamera belum diizinkan' : 'Kamera belum menyala';
    $('tolak-isi').textContent = ditolak
      ? 'Izinkan kamera untuk halaman ini (ikon gembok di samping alamat), lalu tekan Coba nyalakan kamera lagi. Bisa juga langsung pakai kamera bawaan HP.'
      : 'Kamera HP sedang dipakai aplikasi lain atau tidak terbaca. Tutup aplikasi kamera lain, lalu tekan Coba nyalakan kamera lagi. Bisa juga langsung pakai kamera bawaan HP.';
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
    /* video tampil dengan object-fit: cover, jadi petakan kotak di layar ke piksel video */
    const s = Math.max(W / vw, H / vh), ox = (W - vw * s) / 2, oy = (H - vh * s) / 2;
    const sx = Math.max(0, (k.offsetLeft - ox) / s), sy = Math.max(0, (k.offsetTop - oy) / s);
    const sw = Math.min(k.offsetWidth / s, vw - sx), sh = Math.min(k.offsetHeight / s, vh - sy);
    let c = null;
    try { c = potong(v, sx, sy, sw, sh); } catch (e) { c = null; }
    matikanKamera();
    if (!c) return gagalFoto();
    olah(c, 'kamera');
  }
  function gagalFoto() {
    popup(['Foto belum terbaca', 'Coba foto lagi. Kalau tetap gagal, pakai kamera bawaan HP.', 'Foto lagi'], bukaKamera);
  }
  function olah(c, sumber) {
    S.foto = null;
    tampil('kirim');
    aksi(null);
    hasilKotak(null);
    $('t-kembali').hidden = true;
    gambarKecil();
    langkah(1, 'jalan', sumber === 'kamera' ? 'Hanya isi kotak yang dikirim' : 'Diperkecil supaya cepat terkirim');
    langkah(2, '', tujuan());
    langkah(3, '');
    sesudahGambar(() => {
      let hasil = null;
      try { hasil = jadikanJpeg(c); } catch (e) { hasil = null; }
      c.width = c.height = 0;
      if (!hasil) return gagalFoto();
      S.foto = {url: hasil.url, w: hasil.w, h: hasil.h, idFoto: idAcak(), sumber, mode: S.mode, idSet: S.idSet,
        hal: S.mode === 'ganti' ? S.hal : 0};
      langkah(1, 'beres');
      gambarKecil();
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
  async function dariBerkas(berkas) {
    matikanKamera();
    let g;
    try { g = await bacaGambar(berkas); } catch (e) { return gagalFoto(); }
    const W = g.img.naturalWidth, H = g.img.naturalHeight, r = BENTUK[S.bentuk];
    let sx = 0, sy = 0, sw = W, sh = H;
    /* foto tegak: potong tengah mendekati bentuk kotak, paling banyak seperlima tiap ukuran supaya nota tidak terpotong */
    if (H >= W) {
      if (W / H > r) { sw = Math.max(H * r, W * 0.8); sx = (W - sw) / 2; } else { sh = Math.max(W / r, H * 0.8); sy = (H - sh) / 2; }
    }
    let c = null;
    try { c = potong(g.img, sx, sy, sw, sh); } catch (e) { c = null; }
    g.lepas();
    if (!c) return gagalFoto();
    olah(c, 'hp-bawaan');
  }

  /* ---------- kirim ke Portal ---------- */
  async function kirimSekali(badan) {
    const ac = typeof AbortController === 'function' ? new AbortController() : null;
    const jam = setTimeout(() => { if (ac) ac.abort(); }, BATAS_TUNGGU);
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
  async function kirim() {
    const F = S.foto;
    if (!F || S.sibuk) return;
    S.sibuk = true;
    tutupPopup(false);
    aksi(null);
    hasilKotak(null);
    $('t-kembali').hidden = true;
    langkah(2, 'jalan', tujuan());
    const badan = JSON.stringify({jenis: 'nota-foto', t: S.p.t, idOutlet: S.p.o, idFoto: F.idFoto, idSet: F.idSet,
      mode: F.mode, hal: F.mode === 'ganti' ? F.hal : '', faktur: S.p.f, tanggal: S.p.tgl, foto: F.url, w: F.w, h: F.h,
      sumber: F.sumber});
    let akhir = {jaringan: true};
    for (let i = 0; i <= JEDA_ULANG.length; i++) {
      if (i > 0) {
        langkah(2, 'jalan', akhir.jaringan ? 'Sinyal lemah, mencoba lagi…' : 'Portal sedang sibuk, mencoba lagi…');
        await tunggu(JEDA_ULANG[i - 1]);
      }
      let j;
      try { j = await kirimSekali(badan); } catch (e) { akhir = {jaringan: true}; continue; }
      if (j.ok === true) { S.sibuk = false; return berhasil(j, F); }
      akhir = {kode: String(j.kode || 'gagal'), pesan: typeof j.pesan === 'string' ? j.pesan : ''};
      if (!KODE_ULANG.has(akhir.kode)) break;
    }
    S.sibuk = false;
    gagalKirim(akhir);
  }
  function berhasil(j, F) {
    S.idSet = String(j.idSet || F.idSet);
    const hal = Number(j.halaman) || (F.mode === 'ganti' ? F.hal : S.halaman.length + 1);
    const i = S.halaman.findIndex(x => x.hal === hal);
    if (i >= 0) S.halaman[i] = {hal, url: F.url}; else S.halaman.push({hal, url: F.url});
    S.halaman.sort((a, b) => a.hal - b.hal);
    S.nHalaman = Math.max(Number(j.nHalaman) || 0, hal, S.halaman.length);
    S.halTerakhir = hal;
    S.terkirim = true;
    S.foto = null;
    /* muat ulang sesudah ini melanjutkan nota yang sama sebagai halaman tambahan, bukan nota baru */
    simpanSesi(Object.assign({}, S.p, {m: 'tambah', set: S.idSet, hal: ''}));
    gambarKecil();
    langkah(2, 'beres', tujuan());
    langkah(3, 'beres');
    hasilKotak('ok', (F.mode === 'ganti' ? 'Terkirim sebagai foto ulang.' : 'Terkirim.') + ' Foto tidak tersimpan di galeri HP.');
    const penuh = S.nHalaman >= HAL_MAKS;
    $('t-tambah').disabled = penuh;
    $('t-batas').hidden = !penuh;
    aksi('ok');
    $('t-kembali').hidden = false;
  }
  function gagalKirim(akhir) {
    if (akhir.jaringan) {
      langkah(2, 'gagal', 'Belum terkirim');
      hasilKotak('gagal', BELUM_TERKIRIM);
      aksi('ulang');
      return;
    }
    langkah(2, 'gagal', 'Belum tersimpan');
    if (akhir.kode === 'isian') {
      S.foto = null;
      gambarKecil();
      hasilKotak('gagal', akhir.pesan || 'Foto ini belum bisa disimpan. Kembali ke Portal, lalu buka lagi fakturnya.');
      aksi('tutup', false);
      $('t-kembali').hidden = false;
      return;
    }
    const kb = KABAR[akhir.kode] || KABAR.gagal;
    hasilKotak('gagal', kb[1]);
    if (kb[3] === 'ulang') {
      aksi('ulang');
      popup(kb, kirim);
    } else {
      S.foto = null;
      gambarKecil();
      aksi('tutup', false);
      $('t-kembali').hidden = false;
      popup(kb, tutupHalaman);
    }
  }
  function tutupHalaman() {
    matikanKamera();
    S.foto = null;
    S.halaman = [];
    hapusSesi();
    try { window.close(); } catch (e) { /* peramban menolak menutup tab ini */ }
    setTimeout(() => layarPesan(S.terkirim ? 'Selesai' : 'Foto nota', 'Kembali ke tab Portal untuk melanjutkan. Halaman ini boleh ditutup.', false), 300);
  }

  /* ---------- mulai ---------- */
  function mulai() {
    let p = null;
    if (location.hash.length > 1) {
      p = bacaFragmen(location.hash);
      try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* biarkan */ }
      if (p) simpanSesi(p);
    } else {
      p = bacaSesi();
    }
    if (!p) return layarPesan('Buka dari Portal', 'Halaman ini dibuka dari Portal Asia Group: menu Foto nota, lalu ketuk fakturnya.', true);
    S.p = p;
    S.mode = p.m;
    S.idSet = p.m === 'baru' ? idAcak() : p.set;
    S.hal = p.m === 'ganti' ? Number(p.hal) : 0;
    S.halaman = [];
    S.nHalaman = 0;
    S.halTerakhir = 0;
    S.terkirim = false;
    S.foto = null;
    let b = 'nota';
    try { b = localStorage.getItem(KUNCI_BENTUK) || 'nota'; } catch (e) { b = 'nota'; }
    pilihBentuk(b, false);
    bukaKamera();
  }
  function muatHuruf() {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap';
    document.head.appendChild(l);
  }

  $('kam-rana').addEventListener('click', jepret);
  $('kam-tutup').addEventListener('click', () => {
    if (S.terkirim) { matikanKamera(); tampil('kirim'); } else tutupHalaman();
  });
  document.querySelectorAll('[data-bentuk]').forEach(x => x.addEventListener('click', () => pilihBentuk(x.dataset.bentuk, true)));
  document.querySelector('.kam-bentuk').addEventListener('keydown', e => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const b = S.bentuk === 'nota' ? 'struk' : 'nota';
    pilihBentuk(b, true);
    document.querySelector('[data-bentuk="' + b + '"]').focus();
  });
  document.querySelectorAll('.pilih-foto').forEach(inp => {
    inp.addEventListener('click', () => { if (S.stream) matikanKamera(); });
    inp.addEventListener('change', () => {
      const f = inp.files && inp.files[0];
      inp.value = '';
      if (f) dariBerkas(f);
      else if (S.layar === 'kamera') bukaKamera();
    });
  });
  $('t-selesai').addEventListener('click', tutupHalaman);
  $('t-kembali').addEventListener('click', tutupHalaman);
  $('t-tutup').addEventListener('click', tutupHalaman);
  $('t-tutup2').addEventListener('click', tutupHalaman);
  $('t-tambah').addEventListener('click', () => {
    if (S.nHalaman >= HAL_MAKS) return;
    S.mode = 'tambah';
    S.hal = 0;
    bukaKamera();
  });
  $('t-ganti').addEventListener('click', () => {
    S.mode = 'ganti';
    S.hal = S.halTerakhir || 1;
    bukaKamera();
  });
  $('t-kirim-ulang').addEventListener('click', kirim);
  $('t-foto-lagi').addEventListener('click', () => { S.foto = null; bukaKamera(); });
  $('t-foto-lagi2').addEventListener('click', () => { S.foto = null; bukaKamera(); });
  $('t-coba-kamera').addEventListener('click', bukaKamera);
  $('pop-tombol').addEventListener('click', () => tutupPopup(true));
  document.addEventListener('keydown', e => {
    if ($('pop').hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); tutupPopup(false); } else if (e.key === 'Tab') { e.preventDefault(); $('pop-tombol').focus(); }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if (S.stream || S.layar === 'kamera') matikanKamera(); } else if (S.layar === 'kamera' && !S.stream) bukaKamera();
  });
  window.addEventListener('pagehide', matikanKamera);
  window.addEventListener('pageshow', e => { if (e.persisted && S.layar === 'kamera' && !S.stream) bukaKamera(); });
  window.addEventListener('resize', letakKotak);
  window.addEventListener('beforeunload', e => { if (S.foto || S.sibuk) { e.preventDefault(); e.returnValue = ''; } });
  window.addEventListener('hashchange', () => { if (location.hash.length > 1 && !S.sibuk && !S.foto) mulai(); });

  try { window.opener = null; } catch (e) { /* tidak ada jendela pembuka */ }
  mulai();
  setTimeout(muatHuruf, 0);
})();
