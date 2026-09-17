# JUMPY GOONERS 💦 — SEASON 2 🏁

> Icy Tower walked so JUMPY GOONERS could jet-propel itself upward on a column of
> questionable fluid while its friends drowned below. Scientists are baffled.
> Parents are concerned. The leaderboard has a guy called MUSSOLINI at level 1337.

An Icy Tower-style **co-op LAN** vertical jumper. Runs on any Apple Silicon Mac —
and friends join from any laptop **or phone** on the same wifi. Zero dependencies,
zero installs for players, total size ≈ 70 KB.

## How to play

**Host (one person):**
1. Double-click `start_game.command` (or run `python3 server.py`).
2. Your browser opens automatically. The lobby shows the LAN address.

**Everyone else on the same wifi:**
- Open the address shown on the host's screen, e.g. `http://192.168.1.23:8420`,
  in any browser. Phones work: **lean the phone** to move, tap the on-screen
  JUMP / GOON JET buttons. (iPhones ask permission for the tilt sensor once;
  if there's no gyro, arrow buttons appear.)

## Controls

| Input | Action |
|---|---|
| ← → / A D — or lean phone 📱 | run (keep running — speed builds!) |
| Space / ↑ / W — or JUMP button | jump — the faster you run, the higher you jump |
| **Shift / E — or GOON JET button** | **goon jet 💦** (see below) |
| T / 😩 button | taunt |
| R | restart after the team wipes |

## The rules of gooning

- **Speed = height.** Build run speed, bounce off the walls (works on the ground
  too), and launch multiple floors at once.
- **Combos:** every jump that skips 2+ floors chains a combo. Bank a chain for a
  fat `combo² × 10` bonus. Combos also charge your goon meter.
- **Floating XLs 🎈:** rare — grab one for a *goon combo* (+100 pts, +goon meter,
  bounces you upward).
- **MEGA floors ⭐:** every 100th floor glows — land on it for an automatic MEGA JUMP.
- **Levels:** lifetime total score levels you up (LV worn on your belly; gold name
  at LV10, rainbow aura at LV20). ESC / L returns to the lobby; progress autosaves.
  One stat point per level — spend them in bulk with the `±1 / ±10 / ±100 / MAX`
  buttons, or `RESET ALL` to respec for free.
- **GOON JET 💦:** short, violent, and expensive. The drain *ramps up* the longer
  you hold, so a full tank buys ~1.3 s of blast and then you're dry — plus a brief
  "catching your breath" beat before it starts charging again. Altitude you *buy*
  with the jet earns **no combo and no fuel back**: it's an escape tool, not a
  score engine. Refill by climbing with your legs (combos + condoms + drip floors).
  It still slows every other player for a second. They will hear about it.
- **🔥 FIRE:** the skill meter. Stay near your top speed *and* actually moving
  vertically and it creeps up — about **35 seconds of clean play for a full bar**,
  and it bleeds away four times faster the moment you go sloppy. Wall bounces and
  banked combos each chip in. Full fire **doubles your speed ceiling** (and jumps
  scale with speed, so a max-fire launch clears ~10 floors instead of ~4). Jetting
  bleeds it. Consistently good inputs → you go faster than the game's normal cap.
- **The goon juice rises.** Slow gooners get submerged.
- **Co-op:** fall in and you become a ghost — float back up to a living teammate
  and respawn. If *everyone* falls in: post-nut clarity, game over, press R.
- Every 25 floors is a new, increasingly questionable zone
  (Goon Cave → Edging Altitude → the Moist Stratosphere → …).

## High scores & unlockable hats

Your personal best (score + floor) is **saved in the browser's localStorage** on
each device — it survives restarts. High scores unlock hats:

| Hat | Unlock at |
|---|---|
| 💉 TREN Syringe (gigabig, straight through the skull) | 1,500 pts |
| 🏎️ Lamborghini (it's just a lamborghini) | 4,000 pts |
| 🍆 The Aubergine | 8,000 pts |

Plus 9 free hats, nameable characters, any body color, any hat color.

## Season 2 🏁

Everyone is back to **LV1** with 0 lifetime score and 0 spent stat points. The wipe
runs once per device on first load — no action needed from players. Hats stay
unlocked by high score as before (that's the `gooner_best` score, also reset).
Last season's Hall of Goon is archived to `gooner_seen.season1.json`.

To start Season 3 later, bump `const SEASON` at the top of the persistence block in
`game.js` — every browser wipes itself the next time it loads.

## Admin controls ⚙

Click the **⚙** in the top-left corner (or press <kbd>`</kbd>) to open two live sliders:

| Slider | Range | Effect |
|---|---|---|
| ⏱ TIME | 0.1× – 3× | slow-mo through to hyperspeed; physics are substepped so nothing tunnels |
| 🌍 GRAVITY | 0.1× – 3× | floaty moon jumps through to lead boots — apex height scales as 1/g |

**Server-side and host-only.** The values live in `server.py` and apply to *every*
player in the tower. The ⚙ appears only in the browser on the machine running the
server — friends and phones never see it, and the server refuses an `admin` message
from any non-loopback connection, so nobody can retune the tower from their phone.
Everyone gets a toast when you change something, and late joiners inherit the current
settings on join. `RESET TO 1×` puts both back.

## Playing over the internet (Render)

The game is **not** static — `server.py` is the WebSocket relay and also owns the
shared tower seed, so GitHub Pages can't host it (the client never even starts
without a `welcome` from the server). It does deploy to Render as-is:

1. `git init && git add -A && git commit -m "season 2"` and push to GitHub.
2. Render → **New Web Service** → pick the repo. `render.yaml` supplies the rest
   (Python, `python3 server.py`, free plan) and generates a `GOONER_ADMIN_KEY`.
3. Copy that key from the Render dashboard → Environment.
4. Open `https://<your-app>.onrender.com/?admin=<the key>` **once**. The key is
   stashed in localStorage and stripped from the URL bar; the ⚙ is yours from then on.
   Friends just get `https://<your-app>.onrender.com` and never see it.

Free-tier caveats: the service sleeps after ~15 min idle, so the first visitor waits
~50 s for a cold start; and the filesystem is ephemeral, so the Hall of Goon
(`gooner_seen.json`, gitignored) resets on every deploy or restart.

**Don't use a bare tunnel (cloudflared/ngrok) with `GOONER_ADMIN_KEY` unset.** Tunnels
connect to the server *from localhost*, so with the old loopback-only check every
visitor would have looked like the host. `server.py` now fails closed instead — but
set the key and use `?admin=` if you tunnel.

## Files

- `server.py` — tiny HTTP + WebSocket relay server (Python 3 stdlib only)
- `index.html` / `game.js` — the whole game
- `start_game.command` — double-click launcher
- `render.yaml` / `requirements.txt` — deploy config (stdlib only; nothing to install)

## ☕ Support

Free forever. If this game ruined a perfectly good LAN party in the best way, you can buy me a coffee (or a goon jet refill):

[![Support me on Ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/gigacook)
