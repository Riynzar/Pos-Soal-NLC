POS SOAL - cara pakai
1. Install Node.js (versi 16+) di 1 laptop host. Tidak perlu npm install.
2. Jalankan: dobel klik start.bat  (atau: node server.js)
3. Terminal menampilkan alamat, mis. http://192.168.1.5:3000
   Buka alamat itu di semua device (WiFi yang sama, tanpa internet).
4. Windows Firewall: izinkan Node.js di jaringan Private saat diminta.
Data tersimpan di events.jsonl (jangan dihapus saat acara). Reset = hentikan server, hapus file itu.
Ganti port: set PORT=8080 sebelum menjalankan.

Device lain tidak bisa buka? (site can't be reached)
- Di laptop host: klik kanan firewall.bat > Run as administrator (sekali saja).
- Pakai alamat IP dari adapter Wi-Fi (bukan VMware). Laptop host dan device lain harus di WiFi yang sama.
- Jika masih gagal: router/WiFi kampus bisa mengaktifkan "client isolation"; gunakan hotspot HP atau router sendiri.

Admin / reset data 1 pos:
- Di beranda klik tombol "Admin", masukkan password. Password bawaan: tecinikal
- Ganti password: set ADMIN_PASSWORD=passwordbaru sebelum menjalankan server (atau ubah di server.js).
- Reset Pos X menghapus semua data pos itu (saldo kembali 100, stok soal dikembalikan); pos lain tidak berubah.

Perputaran Neleci (item dari Pos Denah tiap kubu):
- Aplikasi menarik spreadsheet Denah dari Google Sheets tiap 30 detik (bisa diubah di Admin).
- Laptop HOST perlu internet untuk sinkron. HP/device lain tetap cukup WiFi yang sama.
- Sheet harus dibagikan: Share > "Siapa saja yang memiliki link" > Viewer.
- Link bawaan sudah diisi. Ganti/tambah link di Admin > Denah (satu link per baris).
- Aplikasi mencari tabel "Rekap Jumlah Item": baris header S N H P T L M dan label A-1 ... E-15.
  Tabel boleh dipindah, asalkan header dan labelnya tetap.
- Harga item: S 5, L 25, T 35, M 55. H/N/P tidak bisa dibeli (hanya dari soal Benar).
  Belanja item = S x 5 + (L di Denah - soal L Benar) x 25 + (T - T Benar) x 35 + (M - M Benar) x 55.
- Saldo tim = saldo Pos Soal - belanja item. Saldo ini dipakai di halaman tim, Hasil Akhir, dan Excel.
- Kalau internet putus / sheet tidak bisa dibaca: data Denah terakhir tetap dipakai (denah-cache.json)
  dan muncul peringatan merah beserta waktu sinkron terakhir.
- File baru di folder: denah-config.json (link) dan denah-cache.json (data terakhir). Jangan dihapus saat acara.

Supply Drop (barang Essential N/H/P gratis):
- Link sheet Supply Drop ada di Admin > Supply Drop (sudah terisi). Sinkron bareng sheet Denah.
- Sheet ini juga harus dibagikan "Siapa saja yang memiliki link" > Viewer.
- Dibaca dari tab Nutrisi / Hidrasi / Proteksi: kotak centang "Menjawab Benar" di kanan label tim (A-1 ... E-15).
- Barang dari Supply Drop TIDAK memakai Neleci, jadi saldo tidak berubah.
- H/N/P di Denah dianggap sah sampai: soal Benar jenis itu + 1 (kalau dicentang di Supply Drop).
  Lebih dari itu -> peringatan di Perputaran Neleci / halaman tim / Excel.
- Kuota tiap jenis 15 tim (gabungan 5 kubu). Kalau dicentang lebih dari 15 -> peringatan.
  Sheet tidak mencatat urutan, jadi panitia yang menghapus centang yang berlebih.

Nama kelompok & tim:
- Diambil dari teams.json (hasil PEMBAGIAN KELOMPOK PEREMPAT FINAL NLC): Alpha, Beta, Charlie, Delta, Echo
  masing-masing 15 tim, lengkap dengan nama tim dan asal sekolah.
- Kode di sheet Denah/Supply Drop tetap A-1 ... E-15 (A = Alpha, B = Beta, C = Charlie, D = Delta, E = Echo).
- Kalau ada nama tim yang berubah, edit teams.json lalu restart start.bat.

Login & menu (satu kali login di awal, diingat per perangkat; tombol "Keluar" ada di menu ☰):
- Admin : username "admin"   + password "tecinikal" -> menu Dashboard + Admin (Hasil Akhir, Perputaran Neleci,
          Persebaran Soal, Log, Reset, Mastersheet Rekap). Ekspor Excel, reset, dan pengaturan sinkron hanya untuk admin.
- Umum  : username bebas      + password "perempat"  -> menu Dashboard saja (Pos Soal, Denah Kota, Wave Creep,
          Supply Drop, End Day). Username dipakai sebagai nama di Log. Username "admin" tidak bisa dipakai akun umum.
- Ganti password: set LOGIN_PASSWORD=... / ADMIN_PASSWORD=... sebelum start; perangkat yang sudah login akan diminta login ulang.
- Link Sheets ada di public/index.html bagian LINKS kalau perlu diganti.

Deploy ke Render (onrender.com):
- Upload folder ini ke repo GitHub (events.jsonl & denah-*.json sudah di-.gitignore), lalu di Render:
  New + > Blueprint > pilih repo (render.yaml otomatis dipakai), ATAU New + > Web Service dengan:
    Build Command : true      (atau kosongkan / npm install — tidak ada dependensi)
    Start Command : node server.js
    Instances     : 1
- WAJIB pasang Persistent Disk (mount /var/data) dan env DATA_DIR=/var/data.
  Disk hanya tersedia di paket berbayar (Starter). Di paket Free, data Beli/Salah/Benar & Log HILANG
  setiap restart/redeploy, dan server "tidur" setelah 15 menit tanpa pengunjung (bangun lagi ~1 menit).
- Isi env ADMIN_PASSWORD dan LOGIN_PASSWORD di Render kalau mau beda dari default.
- Sheets Denah & Supply Drop tetap harus dibagikan "Siapa saja yang memiliki link" > Viewer.
