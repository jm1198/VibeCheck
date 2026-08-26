# VibeCheck — First Home Test

This is your bench test. Before we ever install a camera in a real venue, we
prove the whole plumbing at home with a **cheap starter kit**, so we learn how
the camera, the relay box, and the app all fit together for ~$58 instead of
learning it in front of a venue owner.

**You do not need to be technical.** Every step below says exactly what to type
and *how you'll know it worked* after each one. If a step's "Did it work?"
checkpoint doesn't pass, stop and tell us what you saw — do not keep clicking.

---

## What's in the kit (~$58)

| Item | Cost | Notes |
|---|---|---|
| **TP-Link Tapo C210** camera | ~$20 (Amazon) | RTSP works out of the box once you create a camera account in the Tapo app |
| Raspberry Pi Zero 2 W board | $17.25 | [PiShop.us](https://www.pishop.us/product/raspberry-pi-zero-2-w/) — the bare board, not a $90 Amazon kit |
| 16 GB microSD card | ~$5 | |
| Micro-USB PSU, 5 V / 2.5 A | ~$8 | The Zero 2 W needs a real 2.5 A supply |
| Pi Zero case | ~$7 | any will do |

The relay (the Pi) and the camera talk to each other over **your home WiFi** —
no cable between them, and no internet account needed for the relay itself.

> **Optional upgrade:** if you specifically care about *color* night vision for
> dark bars later, the **Reolink CX410W** (~$90, reolink.com) is our premium
> standard-tier camera. But start with the cheap Tapo — that's the whole point:
> prove the plumbing cheaply first.

**About privacy from here on:** from the moment the camera is set up, **no audio
ever reaches the stream**. The camera's own mic is left off in its app, and the
relay *discards any audio unconditionally* (`-an`). The published feed is also
low-resolution (~640×360) and never records. So an "it worked" test is also a
**"no audio in the feed"** test.

---

## Step ① — Put the operating system on the Pi's microSD card

We flash **Raspberry Pi OS Lite** (the minimal, headless version) onto the card
using the free **Raspberry Pi Imager** app on your normal computer. This step is
fully written out in [`relay/README.md`](./README.md) §3 — do it exactly as
described there:

- Install Raspberry Pi Imager → *Raspberry Pi OS (other) → Raspberry Pi OS Lite (64-bit)*.
- Before writing, click the ⚙ and pre-configure:
  - ☑ **Enable SSH** (public-key or a strong password)
  - set **username + password** (e.g. user `relay`)
  - ☑ **Configure wireless LAN** → your home WiFi's 2.4 GHz network + password
  - ☑ **Set locale** (timezone)

**Did it work?** After writing, the card has a `bootfs` partition; you can look
and see files on it (like `ssh`) — that means it was written. You'll confirm it
actually boots in Step ③.

> The Pi only uses 2.4 GHz WiFi, so make sure it's within range of your router.

## Step ② — Set up the camera (like a smart bulb)

The Tapo connects to **the same home WiFi as the Pi**.

1. Install the free **Tapo** app (from TP-Link) on your phone.
2. Power the camera on (USB adapter — plug into the wall, not the Pi).
3. Open the Tapo app → **Add Device** → follow the prompts to put the camera on
   your **home WiFi**. (This is exactly like setting up a smart bulb.)
4. Optional but good for privacy practice: in the Tapo app, camera → **Settings
   → Microphone** → **off**. (It's already your home, so either way is fine — but
   it's good to know where the setting lives, because this is the "camera side"
   of our no-audio promise.)
5. **Create a camera account:** Tapo → camera → **Settings → Camera Account**
   (sometimes *Advanced Settings → Camera Account*). Set a username and
   password — **write these down**; the relay needs them to pull the video.
6. Note the camera's **LAN IP**. In the Tapo app: camera → **Device Info** →
   look for the IP address (something like `192.168.1.50`). Write it down.

**Did it work?** The Tapo app shows the camera's live view on your phone, and
you can find its IP in Device Info. You should also be able to open a browser on
your computer and visit `http://<that-IP>` — the camera's own little web page
appears. (That URL confirms the camera is reachable on your home network.)

> **The camera now has a live RTSP feed on your home network.** RTSP is just the
> standard "video pipe" the relay reads. Nothing is going to the internet yet —
> the camera is only talking to your phone, and to the Pi once we connect it in
> Step ④.

## Step ③ — Boot the Pi and install the relay

1. Put the microSD card into the Pi, plug in the case, and connect the Micro-USB
   power. The Pi boots headless (no screen) and joins your WiFi by itself.
2. From your computer (same WiFi), find it:
   ```bash
   ping vibecheck-relay.local        # or: ssh relay@vibecheck-relay.local
   ```
3. Log in (password you set in Step ①) and allow passwordless `sudo` for the
   install script:
   ```bash
   echo "relay ALL=(ALL) NOPASSWD:ALL" | sudo tee /etc/sudoers.d/relay
   ```
4. Copy the `relay/` folder from the repo to the Pi (from your computer, in the
   repo root):
   ```bash
   scp -r relay relay@vibecheck-relay.local:~
   ```
5. On the Pi, install the relay software (installs ffmpeg, the config, the
   service, and starts it — safe to re-run):
   ```bash
   cd ~/relay
   sudo bash provision.sh
   ```

**Did it work?** The end of the installer prints:
```
VibeCheck relay installed.
  Config (edit + restart):  sudo nano /etc/vibecheck-relay/relay.conf
  Restart service:          sudo systemctl restart vibecheck-relay
```
and either `✓ relay.conf looks configured` — or (the first time) a ⚠️ warning
listing the placeholder fields you still need to fill (that's expected; it's
Step ④).

## Step ④ — Tell the relay about your camera and stream key

Edit the relay's config on the Pi:

```bash
sudo nano /etc/vibecheck-relay/relay.conf
```

Change these four lines to your real values:

- `CAMERA_IP=` → the camera's IP from Step ② (e.g. `192.168.1.50`)
- `CAMERA_USER=` → the camera account **username** from Step ②
- `CAMERA_PASS=` → the camera account **password** from Step ②
- `MUX_STREAM_KEY=` → your venue's stream key (how to get it is just below)

The sub-stream path (`CAMERA_CHANNEL`) is already set to Tapo's low-res
sub-stream: **`/stream2`** (you normally leave this alone; see the comments in
the file — Reolink uses `/h264Preview_01_sub` instead).

> **Where does the Mux stream key come from?** It comes **from the VibeCheck
> app's Dashboard**, not from Mux's website:
> 1. Open the VibeCheck app → log in as your venue owner (`/dashboard`)
> 2. Go to **Connect Camera** — it shows **Your Stream Key** (auto-created for
>    the venue the first time you open it) and the server
>    `rtmps://global-live.mux.com:443/app`
> 3. Copy that key and paste it as `MUX_STREAM_KEY` in the config
>
> Save with **Ctrl-O, Enter**, then exit with **Ctrl-X**.

**Did it work?** When you save and come back, there should be no `REPLACE_` or
`change-me` text left. To check:
```bash
grep -E 'CAMERA_IP|CAMERA_USER|CAMERA_PASS|MUX_STREAM_KEY' /etc/vibecheck-relay/relay.conf
```
Every line should end in a real value (your IP, your account, your key) — none
should end in `REPLACE_...` or `change-me`.

## Step ⑤ — Start the relay and watch it connect

```bash
sudo systemctl restart vibecheck-relay
systemctl status vibecheck-relay --no-pager     # stop with q
journalctl -u vibecheck-relay -f                # watch the push; stop with Ctrl-C
```

**Did it work?** Watch the `journalctl` output. Within a few seconds you should
see the relay's startup lines:
```
VibeCheck relay: <camera-IP> → rtmps://global-live.mux.com:443 (no audio, stream copy)
Camera : rtsp://<user>:***@<camera-IP>:554/stream2 (transport=tcp)
Ingest : rtmps://global-live.mux.com:443/app/<stream-key-hidden>
```
and then **ffmpeg running quietly** (no error lines). If instead you see
`401 Unauthorized` or a `404`/connection error, the camera credentials or IP
are wrong — double-check Step ④ and `sudo systemctl restart vibecheck-relay`.

## Step ⑥ — Confirm the stream is live in Mux AND in the app

1. Open the **Mux dashboard** for this venue's live stream. While the relay is
   pushing, the stream status shows **Active**.
2. In the VibeCheck app, open this venue's page (it must be **within the venue's
   business hours** — set them in the Dashboard) → the **live feed plays** in
   real time.

**Did it work?**
- Mux shows **Active** (it flips to *Idle* if you stop the relay).
- The app plays the feed, and importantly: **the feed has no sound** — that's
  our whole privacy promise. Check the volume/mute control in the player; you
  can turn your speakers up and there is nothing to hear. That's the `-an`
  (no-audio) drop working.

## Step ⑦ — Prove it self-heals: power-cycle the camera

This is the "set and forget" guarantee. Pull the camera's power for ~10 seconds,
then plug it back in.

**Did it work?** The relay had a short outage (that's expected — ffmpeg exits
when the camera disappears, exactly like it will during a real venue's WiFi
blip). Within ~10 seconds of the camera returning, `journalctl -u
vibecheck-relay -f` shows the relay streaming again, and **Mux flips back to
Active** with the feed playing. You should never have to touch the Pi.

---

## 💾 How to save this snapshot for us

When all seven steps pass, run this once on the Pi to capture the receipt:

```bash
printf '== relay service ==\n'; systemctl is-active vibecheck-relay
printf '== recent relay log (last 15) ==\n'; journalctl -u vibecheck-relay -n 15 --no-pager
printf '== config (secrets redacted) ==\n'; sed -E 's/(CAMERA_PASS|MUX_STREAM_KEY)=.*/\1=<hidden>/' /etc/vibecheck-relay/relay.conf
```

Send us that output plus the **Mux "Active"** screenshot and the **app feed**
screenshot. That's our green light that the home bench works.

---

## If a step fails

Don't guess — note **which step**, **what you typed**, and **the exact error
line** (from `journalctl -u vibecheck-relay -n 50`) and send it to us. Common
ones we already know about:

- `401`/auth error or `404` on the RTSP feed → wrong camera account/IP (Step ④).
- `rtmps`/TLS errors → rare with Raspberry Pi OS Lite ffmpeg; if they appear
  we'll set the `rtmp` ingest fallback (documented in relay.conf).
- Stream not in the app → check the venue's **business hours** (Step ⑥), the
  stream key matches the Dashboard, and Mux shows Active.

That's the whole test — 7 steps, ~$58, and you'll know the relay is
venue-ready.
