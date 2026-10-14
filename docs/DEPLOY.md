# Run your own Cafecito

This guide puts Cafecito on a server of your own, with HTTPS, nightly backups and, if you want, email sign-in links. You do not need to be a developer: every step is a command to paste. Plan on about 30 minutes.

## What you need

- **A small Linux server** with a public IP address: any 1 GB VPS (Hetzner, DigitalOcean, OVH and so on) with Ubuntu or Debian. Cafecito uses very little memory and disk.
- **A domain or subdomain** you control, for example `cafecito.example.org`. In your DNS provider, create an `A` record pointing that name at the server's IP address. It can take a few minutes to take effect.
- **Docker** on the server. On Ubuntu or Debian, sign in to the server (`ssh root@your-server-ip`) and run:

  ```bash
  curl -fsSL https://get.docker.com | sh
  ```

- **Optional: an email account that can send mail over SMTP** (your mail provider's "SMTP settings", or a service such as Postmark, Mailgun or Amazon SES). Without it, everything works except "email me a sign-in link". You can add it later.

## 1. Install

On the server, make a folder for Cafecito and go into it:

```bash
mkdir -p /opt/cafecito && cd /opt/cafecito
```

Create the file `compose.yaml` (for example with `nano compose.yaml`, paste, then Ctrl+O, Enter, Ctrl+X). Replace `cafecito.example.org` with your domain:

```yaml
services:
  cafecito:
    image: ghcr.io/hoshi-corp/cafecito:latest
    restart: unless-stopped
    environment:
      CAFECITO_URL: https://cafecito.example.org
      # Optional, for email sign-in links. Remove the # at the start of the next three lines and fill them in.
      # SMTP_URL: smtps://username:password@smtp.example.org:465
      # SMTP_FROM: Cafecito <cafecito@example.org>
    volumes:
      - data:/data

  caddy:
    image: caddy:2
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data

volumes:
  data:
  caddy-data:
```

Create the file `Caddyfile` next to it, again with your domain:

```
cafecito.example.org {
	reverse_proxy cafecito:4174
}
```

Caddy is the front door: it gets a free HTTPS certificate for your domain and renews it by itself.

Start everything:

```bash
docker compose up -d
```

Open `https://cafecito.example.org` in a browser. You should see **Create group**.

## 2. First use

1. Create your group. You become its **owner**, and this browser is signed in.
2. Open **Settings** at the bottom of the page and click **Create invite link**. Send the link to your friends. It works for the number of days you chose, and you can revoke it.
3. Each friend opens the link, picks a name, a color and a time zone, and is in.

**Anyone who can open your address can create a new group.** That is harmless (groups cannot see each other), but if you want only your own group on the server, see [Limit who can create groups](#limit-who-can-create-groups).

## 3. Email sign-in links (optional)

People are signed in by a cookie in their browser. If someone loses their phone or clears their browser, they can get back in two ways:

- **With their personal link:** everyone gets one when they join (it is shown once; they should save it). Opening it on any device signs that device in.
- **Lost the link, no email:** the owner presses *New link* beside their name in Settings and sends them the new one; the old link stops working. Nothing is lost.
- **With email:** they set a *recovery email* in Settings beforehand. Then, from the start page of any browser, they ask for a sign-in link and receive it by email.

To turn on email, fill in the two `SMTP_` lines in `compose.yaml` and remove the `#` in front of them:

- `SMTP_URL`: `smtps://USERNAME:PASSWORD@HOST:465` (or `smtp://...:587` for a server that uses STARTTLS). If the password contains `@`, `:` or `/`, write them as `%40`, `%3A` and `%2F`.
- `SMTP_FROM`: the sender, for example `Cafecito <cafecito@example.org>`. Many providers only accept an address they know.

Then apply the change:

```bash
docker compose up -d
```

To check it works: in Settings, set your recovery email; in a private browser window, open your address and use **Email me a sign-in link**. If no email arrives within a minute, see [Troubleshooting](#troubleshooting).

Recovery emails are only visible to the person who set them. A sign-in link works once, for 30 minutes, and only after a click on the page it opens.

## 4. Backups

All of Cafecito's data is one file, `cafecito.db`, inside the `data` volume. Back it up every night with a small script. Create `backup.sh` in `/opt/cafecito`:

```bash
#!/bin/sh
# Copies Cafecito's database into ./backups and keeps the last 14 days.
set -e
cd "$(dirname "$0")"
mkdir -p backups
# SQLite's online backup: safe while the app is running.
docker compose exec -T cafecito node -e "require('better-sqlite3')('/data/cafecito.db').backup('/data/backup.db')"
docker compose cp cafecito:/data/backup.db "backups/cafecito-$(date +%F).db"
docker compose exec -T cafecito rm /data/backup.db
find backups -name 'cafecito-*.db' -mtime +14 -delete
```

Make it runnable, try it once, and schedule it for 3:30 every night:

```bash
chmod +x backup.sh
./backup.sh && ls backups
(crontab -l 2>/dev/null; echo "30 3 * * * /opt/cafecito/backup.sh") | crontab -
```

The backups live on the same server, which does not protect against losing the server. Copy the `backups` folder elsewhere from time to time (for example `scp -r root@your-server-ip:/opt/cafecito/backups .` from your own computer), or use your VPS provider's snapshot feature.

### Restore a backup

This replaces everything with the state of the backup: changes made since then are lost.

```bash
cd /opt/cafecito
docker compose stop cafecito
docker compose run --rm --no-deps -v "$PWD/backups:/backups" cafecito \
  sh -c "rm -f /data/cafecito.db-wal /data/cafecito.db-shm && cp /backups/cafecito-2026-10-11.db /data/cafecito.db"
docker compose start cafecito
```

Replace `cafecito-2026-10-11.db` with the backup you want (`ls backups` lists them). Everyone stays signed in, unless their session was created after the backup.

## 5. Upgrading

1. Read the notes below for every version between yours and the new one.
2. Take a backup: `./backup.sh`.
3. Download the new version and restart:

   ```bash
   cd /opt/cafecito
   docker compose pull
   docker compose up -d
   ```

The database is upgraded automatically when the new version starts. To go back to the previous version, restore the backup you just took and set the old version in `compose.yaml` (for example `ghcr.io/hoshi-corp/cafecito:0.3.0` instead of `:latest`).

To always know what you are running, you can use a version number instead of `latest` in `compose.yaml` and change it when you upgrade. The versions are listed on the project's [releases page](https://github.com/Hoshi-Corp/cafecito/releases).

### Upgrade notes

**To 1.1, from 1.0.x.** Automatic, and only adds: the database gets eight new tables (plans and their answers; the wishlist with its votes, ratings and comments; which devices want notifications, and the server's notification key); plans get one new optional column (the wishlist place they point at) and places one more (when a place was removed); one table (wishlist comments) is rebuilt, with every row copied. Nothing already stored is changed or deleted. It happens on the first request after the new version starts, in one quick step; if that step fails, nothing is applied and the app answers with errors until you fix it or go back. Take the backup first (step 2). From now on a backup also holds the notification private key (the same trust as the rest of the database file). To go back, restore the backup you took and use the old version (see above). Staying on the new database with the old version also works, because the old version ignores tables it does not know, but it can then fail to delete the last member of a group that has plans or places, so restore the backup instead.

**To 1.0, from 0.4 or 0.5 (built from `main`).** Automatic. Date-specific availability is stored as time ranges instead of one row per 15 minutes, and anything that ended more than a week ago is deleted; past weeks then show the typical week. Everyone stays signed in. From now on, a browser left unused for 180 days is signed out.

**To 1.0, from 0.3.** The 0.3 demo group had no owner, so nobody can open it. Start with a fresh database: `docker compose down`, then `docker volume ls` to find the old volume (its name ends in `cafecito-data`) and remove it with `docker volume rm <name>`, then follow this guide from step 1.

**New settings in 1.0:** `CAFECITO_URL` (your public address; needed for email links, and marks the session cookie HTTPS-only when it starts with `https://`), `SMTP_URL` and `SMTP_FROM` (optional email).

## Settings reference

| Variable | Default | Meaning |
|---|---|---|
| `CAFECITO_URL` | none | Public address, such as `https://cafecito.example.org`. Used in emailed links. With `https://`, the session cookie is only sent over HTTPS. |
| `SMTP_URL` | none | Mail server, such as `smtps://user:pass@smtp.example.org:465`. Email sign-in is on only when this, `SMTP_FROM` and `CAFECITO_URL` are all set. |
| `SMTP_FROM` | none | Sender of the emails. |
| `CAFECITO_DB` | `/data/cafecito.db` | Where the database lives in the container. |
| `CAFECITO_DEMO` | off | `1` adds a demo group with public sign-in tokens. **Never** on a server others can reach. |

## Limit who can create groups

Cafecito has no switch for this yet. Once your group exists, you can make Caddy refuse new groups. Replace the `Caddyfile` with:

```
cafecito.example.org {
	@create {
		method POST
		path /api/groups
	}
	respond @create "New groups are closed on this server" 403
	reverse_proxy cafecito:4174
}
```

Then reload Caddy with `docker compose restart caddy`.

## Using another reverse proxy

If the server already runs nginx, Traefik or another proxy, drop the `caddy` service, publish Cafecito on the server only (`ports: ["127.0.0.1:4174:4174"]`), and point the proxy at it. Two things matter:

- **Live updates use a long-lived stream** at `/api/groups/*/events`. Turn off response buffering for it (nginx: `proxy_buffering off;`), or changes by others show up late.
- **The proxy must set `X-Forwarded-For` to the visitor's address.** Cafecito limits how often one address can try invite links and sign-ins, and reads the address from the last entry of that header. Without a proxy in front, visitors could fake it, so do not expose port 4174 to the internet directly.

## Troubleshooting

- **See what the app says:** `docker compose logs --tail=100 cafecito`. Problems sending email are logged there as "Could not send the sign-in email".
- **The browser says the site is not secure, or does not load:** check that the DNS record points at the server (`ping cafecito.example.org`) and that ports 80 and 443 are open in the VPS provider's firewall. `docker compose logs caddy` shows certificate problems.
- **"Too many attempts":** someone (or a script) tried invite links or sign-in links many times from one address. It clears within 15 to 60 minutes, and a restart clears it at once.
- **Changes by others only appear after a reload:** a proxy is buffering the live stream; see [Using another reverse proxy](#using-another-reverse-proxy).
- **Someone lost access and has no recovery email:** as the owner, press *New link* beside their name in Settings and send them the new link. (People who joined before 1.0.1 have no personal link yet; they can make one in Settings while signed in, or you can make one for them.)
- **The owner lost every device:** nobody else can make a new link for the owner. Before that happens, owners should save their own personal link (Settings, *Get a new personal link*) or set a recovery email. Without either, the group can no longer invite or remove people.
