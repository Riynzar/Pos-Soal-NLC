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
