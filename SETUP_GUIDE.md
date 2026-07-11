# Mise — Setup & Operating Guide

A month-end stock-count app for your outlets. This guide assumes **no prior server experience**. Follow the path that fits you:

- **Path A — Try it on your own laptop (5 minutes).** Best for a first look and for training staff.
- **Path B — Run it for real on the internet (a proper VPS).** This is what you use once you want managers counting from their own phones, anywhere.
- **Path C — Docker.** If you (or whoever helps you) already know Docker, it's the shortest real deployment.

Everyone should read **Section 4 (First-run)** and **Section 5 (Monthly routine)** — that part is the same no matter how you host it.

---

## What you're running (plain English)

Mise is a small web application. It has two pieces bundled together:

1. A **server** (a Node.js program) that holds all the data in a single file (a SQLite database).
2. The **web pages** that people open in a browser (laptop or phone).

There is **no external database to set up, no cloud account required, nothing to compile.** The whole thing is one folder. All your data lives in one sub-folder called `data/`. Back that folder up and you've backed up everything.

**Honest caveat about self-hosting:** once this is on the internet, *someone owns it* — keeping it online, keeping backups, applying the occasional update. It's light, but it's not zero. If nobody on your side wants that responsibility long-term, Path A (laptop, on your shop Wi-Fi) is a legitimate way to run it for one outlet at a time.

---

## 0. One-time: what you need

- The `mise` folder (the zip you downloaded, unzipped).
- **Node.js version 22.5 or newer.** Mise uses a brand-new built-in database feature that only exists in Node 22.5+. Older Node will not start it. (Check anytime with `node --version`.)

That's the entire dependency list.

---

## Path A — Run it on your own laptop (first look / staff training)

### A1. Install Node.js

- Go to **https://nodejs.org** and download the **LTS** installer (must show 22.x or higher — if the LTS is older than 22.5, click "Current" and take that instead).
- Run the installer, click through with defaults.
- Open a terminal:
  - **Windows:** press Start, type **PowerShell**, open it.
  - **Mac:** press Cmd+Space, type **Terminal**, open it.
- Type this and press Enter:
  ```
  node --version
  ```
  You should see something like `v22.22.2`. If the number after `v22.` is below `5`, or it says 20.x / 18.x, install a newer Node before continuing.

### A2. Open the mise folder in the terminal

Unzip the download somewhere you'll remember (e.g. Desktop). Then in the terminal, "change directory" into it:

- **Windows example:**
  ```
  cd $HOME\Desktop\mise
  ```
- **Mac example:**
  ```
  cd ~/Desktop/mise
  ```

(If you put it elsewhere, type `cd ` then drag the folder onto the terminal window — it pastes the path for you.)

### A3. Install the app's parts (once)

```
npm install
```

This downloads the helper libraries into a `node_modules` folder. Takes a minute. You only do this once (and again after an update).

### A4. Start it

```
npm start
```

The first time it runs, it prints a box like this:

```
========================================
  MISE — initial admin login created
  username: admin
  password: kJ8x2pQ...
  (change it after first login)
========================================
Mise running on http://localhost:8080
```

**Copy that password.** (It's also saved to `data/ADMIN_CREDENTIALS.txt` inside the folder, so you can't lose it.)

### A5. Open it

In your browser go to: **http://localhost:8080**

Log in as `admin` with the printed password. Done — jump to **Section 4 (First-run)**.

### Letting staff on the same Wi-Fi use it (optional, for training)

While `npm start` is running on your laptop, others on the **same Wi-Fi** can reach it:

1. Find your laptop's local IP:
   - Windows: run `ipconfig`, look for "IPv4 Address" (e.g. `192.168.1.7`).
   - Mac: run `ipconfig getifaddr en0`.
2. On a phone on the same Wi-Fi, open `http://192.168.1.7:8080` (use your number).

This is perfect for a training session. It is **not** how you run it permanently (the laptop has to stay on and awake, and it only works on that one Wi-Fi). For real use, do Path B.

**To stop the app:** click the terminal and press `Ctrl + C`.

---

## Path B — Run it for real on a VPS (recommended for live use)

A **VPS** is a small always-on computer you rent in a data centre. The cheapest tier (about ₹350–500 / US$4–6 a month) is more than enough. Good providers: **Hetzner**, **DigitalOcean**, **Vultr**, **Linode**.

You'll do everything by typing commands into the server. Copy-paste them exactly. Where you must substitute your own value, it's written in `CAPITALS` — replace the whole thing including nothing extra.

### B1. Create the server

1. Sign up with a provider. Create a new server ("Droplet" / "Cloud Server" / "Instance").
2. Choose **Ubuntu 24.04 LTS** as the operating system.
3. Choose the smallest plan (1 shared CPU, ~1 GB RAM is plenty).
4. For login, choose **SSH key** if you know what that is; otherwise choose **password** and the provider will email/show you the root password.
5. After a minute it gives you an **IP address** like `203.0.113.45`. Write it down.

### B2. Connect to the server

On your own laptop terminal (PowerShell or Terminal):

```
ssh root@YOUR_SERVER_IP
```

Type `yes` if it asks about authenticity, then the password. You're now "inside" the server — the prompt changes.

### B3. Install Node.js 22 on the server

Paste these one block at a time:

```
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs
node --version
```

The last line must show `v22.5` or higher.

### B4. Get the mise folder onto the server

Two options — pick one.

**Option 1 — upload the zip from your laptop.** Open a *second* terminal on your laptop (don't close the ssh one) and run, from the folder where your `mise.zip` is:

```
scp mise.zip root@YOUR_SERVER_IP:/root/
```

Back in the ssh terminal:

```
apt-get install -y unzip
cd /root
unzip mise.zip
cd mise
```

**Option 2 — if you put the code on GitHub**, just `git clone` it instead. (Only if you already use GitHub.)

### B5. Install and test-run

```
npm install
ADMIN_PASSWORD='choose-a-strong-one' npm start
```

It should print "Mise running on http://localhost:8080". You can't open that from your laptop yet (it's the server's own localhost) — we expose it properly in the next step. For now press `Ctrl + C` to stop it. Note the admin password you chose.

### B6. Keep it running forever with PM2

`npm start` stops the moment you disconnect. **PM2** keeps it alive and restarts it on reboot.

```
npm install -g pm2
ADMIN_PASSWORD='the-same-strong-one' SECURE_COOKIE=1 pm2 start "node --experimental-sqlite server/index.js" --name mise
pm2 save
pm2 startup
```

The `pm2 startup` command prints **one more command** — copy that line, paste it, run it. That's what makes Mise come back after a server reboot.

Useful later: `pm2 logs mise` (see output, including the first-run admin box), `pm2 restart mise`, `pm2 stop mise`.

> Set `SECURE_COOKIE=1` only because we're about to put HTTPS in front (next step). With it on, login cookies only work over `https://`. If you ever run without HTTPS, leave it off.

### B7. Put a real web address + HTTPS in front (Caddy — the easy way)

Right now the app is on port 8080 with no encryption. **Caddy** is a tiny web server that gives you automatic, free HTTPS. You need a **domain name** pointed at your server first:

1. Buy a domain (or use a subdomain you own), e.g. `stock.yourcompany.com`.
2. In your domain's DNS settings, add an **A record**: name `stock` (or `@` for the root), value = `YOUR_SERVER_IP`. Wait a few minutes for it to take effect.

Then on the server:

```
apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt-get update
apt-get install -y caddy
```

Now tell Caddy your address. Open its config:

```
nano /etc/caddy/Caddyfile
```

Delete everything in there and put **only** this (use your real domain):

```
stock.yourcompany.com {
    reverse_proxy localhost:8080
}
```

Save and exit nano: press `Ctrl+O`, Enter, then `Ctrl+X`. Then:

```
systemctl restart caddy
```

That's it. In under a minute Caddy fetches a free HTTPS certificate automatically. Open **https://stock.yourcompany.com** in any browser, anywhere — you're live. Get the admin password from `pm2 logs mise` or `cat data/ADMIN_CREDENTIALS.txt`, then go to **Section 4**.

### B8. Lock the front door (firewall)

```
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw --force enable
```

This blocks everything except SSH and web traffic. (Note we do **not** open 8080 to the world — only Caddy talks to it, locally.)

---

## Path C — Docker (if you already use it)

From inside the `mise` folder, on any machine with Docker:

```
docker compose up -d
```

It builds and starts on port 8080, with your data in a `./data` folder next to the compose file. Get the admin password with `docker compose logs`. To put HTTPS in front, use the same Caddy step (B7) pointing `reverse_proxy` at the container, or run Caddy as another compose service. Update later with `git pull` (or re-copy files) then `docker compose up -d --build`.

---

## 4. First-run (everyone — do this once)

1. **Log in** as `admin` with the first-run password.
2. **Change the admin password** immediately: top-right menu → Settings → change password. Pick something strong; this account can see and delete everything.
3. **Download the master template.** Go to **Item master** (or Settings) → **Download template**. You get one Excel workbook with four tabs:
   - **Items** — every countable thing: name, category, the unit you buy/store it in, pack size, and price. There's a READ ME tab explaining each column, plus sample rows.
   - **Categories** — your grouping names (e.g. Dairy, Dry Goods, Sauces).
   - **Containers** — reusable vessels you count *into* (e.g. "GN 1/4 pan", "2L Cambro") with their empty weight (tare). This is what lets a manager weigh a half-full tub and have Mise subtract the container automatically.
   - **Recipes** — for processed/prepped items: one row per ingredient, grouped by recipe name, with the batch yield. Mise computes a cost per gram/ml for the finished prep from its ingredients (and handles a prep that uses another prep).
4. **Fill the workbook** with your real data. Keep the column headers exactly as given. Save it.
5. **Upload it:** Item master → **Upload masters**. Mise replaces the master lists and shows a summary (how many items/categories/containers/recipes loaded) and any warnings (e.g. a recipe referencing an ingredient it can't find). Fix warnings in the sheet and re-upload if needed. **Re-uploading replaces the masters but never touches counts you've already saved** — old counts keep the prices they were taken at.
6. **Create your outlets:** Settings → Outlets → add each location.
7. **Create a login for each outlet manager:** Settings → Logins → add user, role **Manager**, assign their outlet, set a username + password. Hand each manager only their own credentials. A manager only ever sees the **Stock taking** screen, locked to their outlet — no masters, no other outlets.

You're ready.

---

## 5. The monthly routine

**Manager, on the last day / first morning of the month, from their phone:**

1. Open the site, log in. Tap **New count** (or resume the one in progress — it auto-saves continuously, so a dropped connection or closed tab loses nothing).
2. For each item, pick how it's being counted:
   - **Unopened** — scan the barcode (camera) or type it; enter how many packs. Value = packs × pack price.
   - **Opened** — search the item; either enter a direct quantity, or pick the **container** it's in and enter the gross weight — Mise subtracts the container's tare and values the net.
   - **Processed/prep** — search the recipe; pick the container and weigh it; Mise values it at the prep's computed cost.
   - **Not in master** — if something isn't in the list, add it by name; it's saved as a **flagged line with no value**, so the count isn't blocked.
3. When finished, tap **Complete**, then **Export to Excel**. The export lists every counted line with values and a total, plus a separate section: *"Items not in master — needs Admin action."*

**Admin, monthly:**

- Review any flagged "not in master" items; add the real ones to the master workbook and re-upload so they're countable next month.
- Each month is its own independent, dated count, kept permanently. Only Admin can delete a count.

---

## 6. Backups (do not skip)

Everything — users, masters, every count — lives in the single **`data/`** folder. Back it up regularly.

- **Laptop (Path A):** copy the `data` folder to a USB drive or cloud drive periodically.
- **VPS (Path B):** from your laptop terminal,
  ```
  scp -r root@YOUR_SERVER_IP:/root/mise/data ./mise-backup-$(date +%F)
  ```
  Run that monthly (right after counts close is ideal). Keep a few months of copies.

To **restore**, you just put a saved `data/` folder back in place of the current one and restart.

---

## 7. Updating to a new version

When I send you an updated build:

- **Laptop / Docker:** replace the code files with the new ones (keep your `data/` folder!), then `npm install` and `npm start` again (or `docker compose up -d --build`).
- **VPS:** upload the new files over the old (again, **never delete `data/`**), then:
  ```
  cd /root/mise
  npm install
  pm2 restart mise
  ```

Your data is untouched because it's all in `data/`, which the code never overwrites.

---

## 8. Quick troubleshooting

- **"node: command not found" / it won't start and mentions SQLite or `--experimental-sqlite`:** your Node is older than 22.5. Install a newer Node.
- **Forgot the admin password:** on the server, `cat data/ADMIN_CREDENTIALS.txt` (that's the *first-run* one; if you changed it and forgot the new one, tell me and I'll give you a safe reset step).
- **Manager can't log in from their phone (Path B):** confirm you're using the `https://` address and that `SECURE_COOKIE=1` is set (it must be, with HTTPS). If you're testing without HTTPS, that flag must be off.
- **Camera won't scan barcodes:** the browser only allows camera access over `https://` (or `localhost`). On a phone this means you must use the real HTTPS address from Path B. There's always a manual "type the barcode" fallback.
- **Page loads but looks unstyled:** the visual styling currently loads from the internet (Tailwind CDN), so the device needs a connection to look right. If you need it to look correct fully offline, tell me and I'll send a build with the styling baked in.

---

If anything here doesn't match what you see on screen, stop and tell me exactly what the terminal or the page says — I'll walk you through it.
