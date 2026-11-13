# Converts DB-IP's country lite CSV into PS's compact lookup file.
import sys, gzip, ipaddress, struct
src, out = sys.argv[1], sys.argv[2]
v4, v6 = [], []
with gzip.open(src, "rt") as f:
    for line in f:
        a, b, cc = line.strip().split(",")
        cc = cc.strip().upper()
        if len(cc) != 2: continue
        ip = ipaddress.ip_address(a)
        if ip.version == 4: v4.append((int(ip), cc))
        else: v6.append((int(ip) >> 64, cc))
def merge(rows):
    rows.sort()
    out = []
    for s, cc in rows:
        if out and out[-1][0] == s: out[-1] = (s, cc); continue
        if out and out[-1][1] == cc: continue
        out.append((s, cc))
    return out
v4, v6 = merge(v4), merge(v6)
with open(out, "wb") as f:
    f.write(b"PSG1" + struct.pack("<II", len(v4), len(v6)))
    f.write(b"".join(struct.pack("<I", s) for s, _ in v4))
    f.write(b"".join(cc.encode() for _, cc in v4))
    f.write(b"".join(struct.pack("<Q", s) for s, _ in v6))
    f.write(b"".join(cc.encode() for _, cc in v6))
print("v4", len(v4), "v6", len(v6))
