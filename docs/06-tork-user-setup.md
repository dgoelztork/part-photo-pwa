# Tork User Setup — Receiving PWA

This guide walks you through everything you need to do once to use the Receiving PWA on your phone, tablet, or laptop.

## What you'll set up

The Receiving PWA is a web app that runs in your browser at <https://dgoelztork.github.io/part-photo-pwa/>. It talks to a proxy server inside Tork's network (TORK-APP) which in turn talks to SAP Business One.

To reach that proxy from your device — whether you're at the office, at home, or on cellular — your device needs to be on the **Tork tailnet** via Tailscale. Tailscale is a small networking app from a third-party company that creates a private connection from your device to TORK-APP. It does **not** route your other traffic and does **not** install device management.

You'll do this once per device. After that you just open the PWA and go.

## Prerequisites

- A Tork Microsoft 365 account (anyone with an `@torksystems.com` address)
- The device you want to use the PWA on (iPhone, iPad, Android, Mac, or Windows)
- About 5 minutes

## Step 1 — Install Tailscale

| Device | Where to get it |
|---|---|
| iPhone / iPad | App Store → search "Tailscale" → install |
| Android | Play Store → search "Tailscale" → install |
| macOS | <https://tailscale.com/download/mac> |
| Windows | <https://tailscale.com/download/windows> |
| Linux | <https://tailscale.com/download/linux> |

## Step 2 — Sign in with your Tork account

1. Open the Tailscale app
2. Tap **Sign in**
3. Choose **Sign in with Microsoft** (or "Continue with Microsoft")
4. Sign in with your `@torksystems.com` Microsoft account
5. If prompted, approve the consent screen for Tailscale

You'll be added to the `torksys.onmicrosoft.com` tailnet.

## Step 3 — Approve the network profile (mobile only)

On iPhone / iPad / Android, the OS will pop up a request to add a VPN configuration the first time. **Approve it.**

This is how Tailscale routes traffic to TORK-APP. It's not a traditional VPN — see "Privacy" below.

## Step 4 — Confirm the connection

In the Tailscale app you should see at least two devices listed:

- `tork-app` (the proxy server inside Tork)
- Your own device

If you see them, you're done with networking setup.

## Step 5 — Open the PWA

Open this in your browser:

<https://dgoelztork.github.io/part-photo-pwa/>

If you want a home-screen icon (recommended):

- **iPhone / iPad**: Safari → Share button → **Add to Home Screen**
- **Android**: Chrome → menu → **Add to Home Screen**

## Step 6 — Sign in and use it

1. Make sure the Tailscale toggle in the Tailscale app is **ON**
2. Open the PWA
3. Sign in with your `@torksystems.com` Microsoft account
4. You should land on the Dashboard. Try a real PO lookup to confirm everything works.

## Day-to-day use

- **You only need to log in to Tailscale once.** It stays signed in.
- You can leave the Tailscale toggle on full-time. It's lightweight and only routes Tork-internal traffic.
- If you prefer, toggle Tailscale **on** when you're about to use the PWA and **off** when you're done — your call.

## Privacy

Tailscale is a **split-tunnel** network overlay. Plain English:

- Only traffic to Tork-internal addresses (TORK-APP) goes through the Tailscale tunnel.
- Everything else — Safari, iMessage, Instagram, your other apps, your other browsing — goes out over your normal Wi-Fi or cellular **without touching Tailscale**.
- Tork can see *that* your device is a tailnet member and *which* tailnet servers you've connected to.
- Tork **cannot** see what websites you visit, what other apps you use, your photos, your contacts, your location, or anything else outside the Tailscale connection itself. Tailscale has no access to that — it's a network app, not a device-management app.

If you're using a personal device, you can revoke its tailnet membership at any time from the Tailscale app (sign out) and that's the end of the connection.

## Troubleshooting

### White / blank screen after login

Almost always means Tailscale isn't running. Check the Tailscale app and make sure the toggle is ON.

### "Cannot reach proxy" in Dashboard

Same fix: confirm Tailscale toggle is ON. If it is, open <https://tork-app.tail14e57a.ts.net:3001/api/health> in your browser. You should see `{"status":"ok",...}`. If you don't, contact IT.

### "Sign in failed" / "Email not authorized"

Make sure you're signing in with your `@torksystems.com` account. Personal Microsoft accounts won't work.

### Tailscale won't sign in with Microsoft

If you get a Microsoft consent screen that you can't approve, your IT admin may need to grant tenant-wide consent for Tailscale on your behalf. Contact IT.

### My device doesn't show up in the Tailscale app

Sometimes the OS-level VPN profile gets disabled. On iPhone: **Settings → General → VPN & Device Management → VPN → Tailscale**. Make sure it's enabled and **Connect on Demand** is on.

### I'm on Tork Wi-Fi — do I still need Tailscale?

Yes. Same URL, same Tailscale requirement. Tailscale automatically takes the fast direct LAN path when you're on Tork Wi-Fi, so there's no speed penalty — but the URL still resolves through Tailscale.

## Changing devices / phones

When you get a new device, just install Tailscale on it and sign in with your Tork account. The new device is automatically added.

You can remove old devices in the Tailscale app under your account, or ask IT to remove them for you.

## Questions

Talk to whoever owns Receiving PWA at Tork (currently `dgoelz@torksystems.com`).
