@echo off
:: Jalankan sebagai Administrator (klik kanan > Run as administrator) di laptop host, sekali saja.
netsh advfirewall firewall delete rule name="Pos Soal 3000" >nul 2>&1
netsh advfirewall firewall add rule name="Pos Soal 3000" dir=in action=allow protocol=TCP localport=3000 profile=any
pause
