#!/usr/bin/env python3
"""JUMPY GOONERS — LAN server. Serves the game + relays WebSocket messages.
Zero dependencies. Run: python3 server.py  (or double-click start_game.command)
"""
import base64
import hashlib
import hmac
import json
import os
import random
import re
import socket
import struct
import subprocess
import threading
import time
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("PORT", 8420))   # hosts like Render hand you a $PORT
WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

# Who is allowed to move the admin sliders.
#   - deployed: set GOONER_ADMIN_KEY, then open  https://your-app/?admin=THEKEY
#   - local:    leave it unset and the host is simply whoever is on this machine
# The loopback test ALONE is not safe behind a tunnel or proxy: cloudflared/ngrok
# connect from 127.0.0.1, so every visitor would look like the host.
ADMIN_KEY = os.environ.get("GOONER_ADMIN_KEY", "")
BEHIND_PROXY = bool(os.environ.get("PORT"))  # deployed: never trust the peer IP

os.chdir(os.path.dirname(os.path.abspath(__file__)))

state_lock = threading.Lock()
clients = {}    # id -> Handler
profiles = {}   # id -> profile dict
next_id = 1
seed = random.randrange(1, 2**31)

# Admin knobs. Server-authoritative: they live here, apply to EVERY player, and
# only an admin connection (see is_host below) is allowed to change them.
admin = {"time": 1.0, "grav": 1.0}
ADMIN_MIN, ADMIN_MAX = 0.1, 3.0

SEEN_FILE = "gooner_seen.json"
try:
    with open(SEEN_FILE) as f:
        seen = json.load(f)
except Exception:
    seen = {}


def save_seen():
    try:
        with open(SEEN_FILE, "w") as f:
            json.dump(seen, f)
    except OSError:
        pass


def lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return "127.0.0.1"


def lan_ips():
    """All non-loopback IPv4 addresses, primary first."""
    ips = []
    try:
        out = subprocess.check_output(["ifconfig"], text=True, timeout=5)
        ips = [m for m in re.findall(r"inet (\d+\.\d+\.\d+\.\d+)", out)
               if not m.startswith("127.")]
    except Exception:
        pass
    primary = lan_ip()
    if primary != "127.0.0.1":
        ips = [primary] + [i for i in ips if i != primary]
    return ips or ["127.0.0.1"]


class Handler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        pass  # keep the console clean

    def end_headers(self):
        # no-store, not no-cache: browsers were still showing a stale index.html
        # (and so a missing admin panel) after an edit.
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def is_host(self, key=""):
        """Admin rights: a matching key if one is configured, else loopback-only.

        Once deployed the peer IP is worthless (proxies and tunnels both come from
        localhost or an internal address), so the key is the only check that counts.
        """
        if ADMIN_KEY:
            return hmac.compare_digest(str(key or ""), ADMIN_KEY)
        if BEHIND_PROXY:
            return False  # deployed with no key set: nobody is admin, fail closed
        return self.client_address[0] in ("127.0.0.1", "::1", "::ffff:127.0.0.1")

    def do_GET(self):
        if self.path == "/info":
            ips = lan_ips()
            with state_lock:
                players = [{"name": p["name"], "lvl": p.get("lvl", 1)}
                           for p in profiles.values()]
            with state_lock:
                seen_list = sorted(seen.values(),
                                   key=lambda u: -u.get("lvl", 1))[:12]
            body = json.dumps({"ip": ips[0], "ips": ips, "port": PORT,
                               "players": players, "seen": seen_list}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path == "/ws" and self.headers.get("Upgrade", "").lower() == "websocket":
            self.handle_websocket()
            return
        super().do_GET()

    # ---------- WebSocket ----------

    def handle_websocket(self):
        global next_id
        key = self.headers.get("Sec-WebSocket-Key", "")
        accept = base64.b64encode(
            hashlib.sha1((key + WS_GUID).encode()).digest()
        ).decode()
        self.send_response(101, "Switching Protocols")
        self.send_header("Upgrade", "websocket")
        self.send_header("Connection", "Upgrade")
        self.send_header("Sec-WebSocket-Accept", accept)
        self.end_headers()
        try:
            self.connection.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        except OSError:
            pass

        self.send_lock = threading.Lock()
        with state_lock:
            self.ws_id = next_id
            next_id += 1
            clients[self.ws_id] = self

        try:
            self.ws_loop()
        except (OSError, ConnectionError):
            pass
        finally:
            with state_lock:
                clients.pop(self.ws_id, None)
                had_profile = profiles.pop(self.ws_id, None)
            if had_profile:
                print(f"  << {had_profile.get('name','?')} left")
                broadcast({"t": "leave", "id": self.ws_id})
            self.close_connection = True

    def ws_loop(self):
        while True:
            frame = self.read_frame()
            if frame is None:
                return
            opcode, payload = frame
            if opcode == 8:  # close
                return
            if opcode == 9:  # ping -> pong
                self.send_raw(10, payload)
                continue
            if opcode != 1:
                continue
            try:
                msg = json.loads(payload.decode("utf-8"))
            except (ValueError, UnicodeDecodeError):
                continue
            self.handle_msg(msg)

    def handle_msg(self, msg):
        global seed
        t = msg.get("t")
        if t == "join":
            profile = {
                "name": str(msg.get("name", "Gooner"))[:14],
                "skin": str(msg.get("skin", "#f2b370"))[:9],
                "hat": str(msg.get("hat", "cap"))[:12],
                "hatColor": str(msg.get("hatColor", "#e94f4f"))[:9],
                "lvl": max(1, min(1337, int(msg.get("lvl", 1) or 1))),
                "char": str(msg.get("char", "goober"))[:12],
            }
            self.admin_ok = self.is_host(msg.get("key"))
            raw_stats = msg.get("stats") or {}
            profile["stats"] = {k: max(0, min(254, int(raw_stats.get(k, 0) or 0)))
                                for k in ("agi", "bnc", "msl", "rizz", "gains", "luck")}
            with state_lock:
                profiles[self.ws_id] = profile
                seen[profile["name"]] = {**profile, "ts": time.time()}
                save_seen()
                others = {str(i): p for i, p in profiles.items() if i != self.ws_id}
                cur_seed = seed
                cur_admin = dict(admin)
            print(f"  >> {profile['name']} joined ({len(profiles)} playing)")
            self.send_json({"t": "welcome", "id": self.ws_id,
                            "seed": cur_seed, "players": others,
                            "host": self.admin_ok, "admin": cur_admin})
            broadcast({"t": "join", "id": self.ws_id, "p": profile},
                      skip=self.ws_id)
        elif t == "s":  # state update, relay to everyone else
            msg["id"] = self.ws_id
            broadcast(msg, skip=self.ws_id)
        elif t == "taunt":
            broadcast({"t": "taunt", "id": self.ws_id,
                       "txt": str(msg.get("txt", ""))[:60]}, skip=self.ws_id)
        elif t == "lasso":  # goon lasso: pull the squad, then ricochet
            broadcast({"t": "lasso", "id": self.ws_id,
                       "ph": str(msg.get("ph", "s"))[:1],
                       "y": int(msg.get("y", 0) or 0)}, skip=self.ws_id)
        elif t == "admin":  # host-only: retune time/gravity for the whole tower
            if not getattr(self, "admin_ok", False):
                print(f"  !! admin change refused from {self.client_address[0]}")
                return
            with state_lock:
                for k in ("time", "grav"):
                    if k in msg:
                        try:
                            v = float(msg[k])
                        except (TypeError, ValueError):
                            continue
                        if v == v:  # reject NaN
                            admin[k] = max(ADMIN_MIN, min(ADMIN_MAX, v))
                cur_admin = dict(admin)
            print(f"  ⚙ admin: time {cur_admin['time']:.2f}x  gravity {cur_admin['grav']:.2f}x")
            broadcast({"t": "admin", **cur_admin})
        elif t == "restart":
            with state_lock:
                seed = random.randrange(1, 2**31)
                new_seed = seed
            print("  ** restart! new tower generated")
            broadcast({"t": "restart", "seed": new_seed})

    # ---------- frames ----------

    def read_exact(self, n):
        buf = b""
        while len(buf) < n:
            chunk = self.connection.recv(n - len(buf))
            if not chunk:
                return None
            buf += chunk
        return buf

    def read_frame(self):
        head = self.read_exact(2)
        if head is None:
            return None
        b1, b2 = head
        opcode = b1 & 0x0F
        masked = b2 & 0x80
        length = b2 & 0x7F
        if length == 126:
            ext = self.read_exact(2)
            if ext is None:
                return None
            length = struct.unpack(">H", ext)[0]
        elif length == 127:
            ext = self.read_exact(8)
            if ext is None:
                return None
            length = struct.unpack(">Q", ext)[0]
        if length > 1_000_000:
            return None
        mask = b"\x00\x00\x00\x00"
        if masked:
            mask = self.read_exact(4)
            if mask is None:
                return None
        payload = self.read_exact(length) if length else b""
        if payload is None:
            return None
        if masked:
            payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        return opcode, payload

    def send_raw(self, opcode, payload):
        header = bytes([0x80 | opcode])
        n = len(payload)
        if n < 126:
            header += bytes([n])
        elif n < 65536:
            header += bytes([126]) + struct.pack(">H", n)
        else:
            header += bytes([127]) + struct.pack(">Q", n)
        with self.send_lock:
            self.connection.sendall(header + payload)

    def send_json(self, obj):
        self.send_raw(1, json.dumps(obj, separators=(",", ":")).encode())


def broadcast(obj, skip=None):
    data = json.dumps(obj, separators=(",", ":")).encode()
    with state_lock:
        targets = [c for i, c in clients.items() if i != skip]
    for c in targets:
        try:
            c.send_raw(1, data)
        except (OSError, ConnectionError):
            pass  # its ws_loop will clean it up


def main():
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    if BEHIND_PROXY:  # deployed (Render etc): no LAN banner, no browser to open
        print(f"JUMPY GOONERS server listening on :{PORT}")
        print("admin sliders: " + ("enabled via ?admin=<GOONER_ADMIN_KEY>"
                                   if ADMIN_KEY else "DISABLED (set GOONER_ADMIN_KEY)"))
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        return
    ips = lan_ips()
    print()
    print("  ╔══════════════════════════════════════════╗")
    print("  ║        JUMPY GOONERS 💦  —  server        ║")
    print("  ╚══════════════════════════════════════════╝")
    print(f"   You play at:          http://localhost:{PORT}")
    for ip in ips:
        print(f"   Friends/phones join:  http://{ip}:{PORT}")
    print()
    print("   Phone can't connect? Checklist:")
    print("   1. Phone must be on the SAME wifi (not cellular/guest network).")
    print("   2. Type the address into the URL bar EXACTLY, with the http://")
    print("      (otherwise the phone searches the web instead).")
    print("   3. macOS may silently block LAN traffic: System Settings →")
    print("      Privacy & Security → Local Network → enable your Terminal app,")
    print("      then restart this server.")
    print("   4. Some routers isolate wifi clients ('AP/client isolation') —")
    print("      if so, turn that off in router settings or use a hotspot.")
    print()
    print("   Ctrl+C to stop.")
    print()
    threading.Timer(0.6, lambda: webbrowser.open(f"http://localhost:{PORT}")).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  bye!")


if __name__ == "__main__":
    main()
