#!/usr/bin/env python3
# A fake mail server for tests/proton-transport-test.sh. Listens on 127.0.0.1 only, on a free port, speaks just enough IMAP
# (STARTTLS, LOGIN, EXAMINE, SEARCH, FETCH) or SMTP to exercise PS's connection code, with a throwaway self signed certificate.
# It is not a real mail server and nothing in it is a real account. Usage: proton-fake-server.py imap|smtp CERT KEY PORTFILE
import socket, ssl, sys, threading

mode, cert, key, portfile = sys.argv[1:5]
ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
ctx.load_cert_chain(cert, key)
srv = socket.socket(); srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
srv.bind(("127.0.0.1", 0)); srv.listen(5)
open(portfile, "w").write(str(srv.getsockname()[1]))

HDR = b"From: Alex Morgan <alex@client.example>\r\nSubject: Fake plan\r\nDate: Tue, 3 Nov 2026 09:15:00 +0000\r\nMessage-ID: <fake1@client.example>\r\n\r\n"
BODY = b"Can we talk about the plan?\r\n"

def lines(c):
    buf = b""
    while True:
        while b"\r\n" not in buf:
            d = c.recv(4096)
            if not d: return
            buf += d
        line, buf = buf.split(b"\r\n", 1)
        yield line.decode()

def serve(c):
    try:
        if mode == "imap":
            c.sendall(b"* OK fake imap ready\r\n")
            for l in lines(c):
                tag, _, cmd = l.partition(" ")
                if cmd == "STARTTLS":
                    c.sendall(f"{tag} OK go\r\n".encode()); c = ctx.wrap_socket(c, server_side=True); return tls_imap(c)
                c.sendall(f"{tag} BAD first STARTTLS\r\n".encode())
        else:
            c.sendall(b"220 fake smtp\r\n")
            for l in lines(c):
                if l.startswith("EHLO"): c.sendall(b"250-fake\r\n250 STARTTLS\r\n")
                elif l == "STARTTLS":
                    c.sendall(b"220 go\r\n"); c = ctx.wrap_socket(c, server_side=True); return tls_smtp(c)
                else: c.sendall(b"530 first STARTTLS\r\n")
    except Exception:
        pass
    finally:
        try: c.close()
        except Exception: pass

def tls_imap(c):
    for l in lines(c):
        tag, _, cmd = l.partition(" ")
        if cmd == "CAPABILITY": c.sendall(f"* CAPABILITY IMAP4rev1\r\n{tag} OK done\r\n".encode())
        elif cmd.startswith("LOGIN"): c.sendall((f"{tag} OK in\r\n" if '"bridge-pass"' in cmd else f"{tag} NO bad login\r\n").encode())
        elif cmd == "EXAMINE INBOX": c.sendall(f"* 1 EXISTS\r\n{tag} OK [READ-ONLY] done\r\n".encode())
        elif cmd == "UID SEARCH UNSEEN": c.sendall(f"* SEARCH 7\r\n{tag} OK done\r\n".encode())
        elif cmd.startswith("UID FETCH"):
            c.sendall(b"* 1 FETCH (UID 7 BODY[HEADER.FIELDS (FROM SUBJECT DATE MESSAGE-ID)] {%d}\r\n" % len(HDR) + HDR + b" BODY[TEXT]<0> {%d}\r\n" % len(BODY) + BODY + b")\r\n" + f"{tag} OK done\r\n".encode())
        elif cmd == "LOGOUT": c.sendall(f"* BYE\r\n{tag} OK bye\r\n".encode()); return
        else: c.sendall(f"{tag} BAD\r\n".encode())

def tls_smtp(c):
    data = False; got = []
    for l in lines(c):
        if data:
            if l == ".": data = False; c.sendall(b"250 queued\r\n"); open(portfile + ".msg", "w").write("\n".join(got)); continue
            got.append(l); continue
        if l.startswith("EHLO"): c.sendall(b"250-fake\r\n250 AUTH PLAIN\r\n")
        elif l.startswith("AUTH PLAIN"): c.sendall(b"235 ok\r\n")
        elif l.startswith("MAIL FROM") or l.startswith("RCPT TO"): c.sendall(b"250 ok\r\n")
        elif l == "DATA": data = True; c.sendall(b"354 go\r\n")
        elif l == "QUIT": c.sendall(b"221 bye\r\n"); return
        else: c.sendall(b"500 what\r\n")

while True:
    conn, _ = srv.accept()
    threading.Thread(target=serve, args=(conn,), daemon=True).start()
