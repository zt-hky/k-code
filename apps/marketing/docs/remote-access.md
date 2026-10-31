Your agents run wherever the K-code **server** runs: a desktop, a home server, a VPS or an AgentBox workspace. Clients (browser, desktop app, mobile app) connect to it. Run the server where your code lives and drive it from anywhere.

Every method below ends with a **pairing link**: a one-time URL or QR code that authorizes one device. After pairing, the device reconnects on its own.

## Pair over a LAN or private network

On a desktop host, open **Settings → Sharing & access**, enable **Network access** and create a pairing link. Changing network access restarts the app.

On a command-line host, bind to the host's private address and print a link:

```bash
kcode serve --host <private-ip>
kcode pair               # fresh link for a running server
```

Scan the QR code, or paste the URL into **Add environment** in the receiving client. A loopback address such as `127.0.0.1` only reaches the device opening it.

## Tailscale HTTPS

Join both devices to the same tailnet. In the desktop app enable **Tailscale HTTPS** in **Settings → Sharing & access**. From the command line:

```bash
kcode serve --tailscale-serve      # at startup
kcode pair --tailscale             # for an already running server
```

The link uses an address like `https://machine.tailnet.ts.net/`. Remove the mapping with `tailscale serve --https=443 off`. If port 443 is taken, choose another with `--tailscale-serve-port`.

## Cloudflare tunnel (your own domain)

Put the server behind a [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) and a [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/) application, then start it with:

```bash
T3CODE_CLOUDFLARE_ACCESS_TEAM_DOMAIN=<team>.cloudflareaccess.com \
T3CODE_CLOUDFLARE_ACCESS_AUD=<application audience tag> \
T3CODE_CLOUDFLARE_ACCESS_EMAILS=you@example.com \
kcode serve
```

After you sign in to Access, the browser receives a K-code session automatically. Only the listed emails (comma-separated) get one, even if the Access policy allows more. The mobile app cannot pass Access; pair it over LAN or Tailscale instead. Never expose the server on a public address without Access or another authentication layer in front.

## SSH

The desktop app can manage an SSH connection to another machine: it starts a server there and forwards the port. Add the host in **Settings → Environments**. The remote machine needs your provider CLIs installed.

## Phone access

Use any method above and open **Add environment** in the mobile app (or the mobile web page), then scan the pairing QR code. The phone must reach the server's address, so over the internet use Tailscale or a tunnel.

## Manage or revoke access

**Settings → Sharing & access** on the host lists pairing links and sessions and lets you revoke them. Revoke a device's session to remove its access. From the command line, `kcode auth --help` shows the management commands. Pass `--scope` to limit what a pairing link allows; without it, a link grants every permission.

Treat a pairing link like a password: a client with full access can run commands on the host.
