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
