# Offline IP to country data (Network monitor)

`ip-country.bin` is built from DB-IP's free "IP to Country Lite" database (October 2026 edition),
licensed CC BY 4.0: IP Geolocation by DB-IP (https://db-ip.com). The Network monitor credits it.

PS looks countries up only in this file, on the Mac. It never asks any online service.

To refresh it (monthly editions): download `dbip-country-lite-YYYY-MM.csv.gz` from
https://db-ip.com/db/download/ip-to-country-lite into an empty folder, then
`python3 -I mkgeo.py <that .csv.gz> ip-country.bin` and rebuild PS (build.sh copies it in).

Format: "PSG1", uint32 v4 count, uint32 v6 count (little endian), then the v4 range starts
(uint32 each, sorted), their 2 letter country codes, the v6 range starts (first 64 bits, uint64)
and their codes. A range runs until the next start.
