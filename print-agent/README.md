# Tork label print agent

Makes a USB-attached Zebra look like a network printer, so the receiving app can print to it.

## Why this exists

Networked Zebras accept raw ZPL on TCP 9100, and that is what the receiving proxy sends. Neither warehouse printer is reachable that way: Alameda's isn't visible from TORK-APP (a scan of all 254 addresses on `192.168.201.0/24` found one Brother and no Zebra), and Pascagoula has no network link to the server at all.

Rather than pay for cabling and VLAN work at two sites, the PC already plugged into each printer joins Tailscale and runs this. It listens on 9100 and hands whatever arrives to the Windows print spooler. **The proxy is unchanged** — it opens a socket exactly as it would to a network printer.

The printer needs no network, no IP address, and no cabling.

## What you need on the PC

- Windows, with the Zebra installed and printing (test it: Devices and Printers → right-click the Zebra → Printer properties → **Print Test Page**)
- **Tailscale** installed and signed in with a `@torksystems.com` account
- Nothing else — the agent is Windows PowerShell 5.1, which ships with Windows

In the Tailscale admin console, **disable key expiry** for this machine. Otherwise it silently drops off the tailnet in a few months; that is exactly what took the receiving app down in August.

## Install

Copy this folder to the PC, then from an **elevated** PowerShell:

```powershell
cd C:\tork-print-agent
.\install.ps1 -PrinterName "ZDesigner ZD621-203dpi ZPL"
```

Use the printer's name exactly as Devices and Printers shows it. If it's wrong the script lists what is installed and stops.

It registers a scheduled task that runs at boot as SYSTEM (so it survives restarts and needs nobody logged in), opens port 9100 **to the Tailscale range only** (`100.64.0.0/10` — not the warehouse network, not the internet), and starts it.

At the end it prints the machine's Tailscale address. **Send that, and the site name, to Avery.**

## Then, on the server

One entry in the proxy's `LABEL_PRINTERS`, mapping the site's SAP warehouse codes to that address:

```json
[{"id":"alameda","name":"Alameda Warehouse","host":"100.x.y.z","port":9100,
  "warehouses":["01","01A","2","S","02"]},
 {"id":"pascagoula","name":"Pascagoula","host":"100.a.b.c","port":9100,
  "warehouses":["3"]}]
```

Restart `ReceivingProxy`. That is also what makes the **Print Item Labels** button appear on the dashboard — it stays hidden while no printer is configured.

## Checking it

- **Log**: `print-agent.log`, next to the script. Every job records its size, the copy count from `^PQ`, and where it came from.
- **Running?** `Get-ScheduledTask TorkLabelPrintAgent` and `Get-NetTCPConnection -LocalPort 9100 -State Listen`
- **Restart it**: `Stop-ScheduledTask TorkLabelPrintAgent; Start-ScheduledTask TorkLabelPrintAgent`
- **Test print from anywhere on the tailnet**:

  ```powershell
  $c = New-Object System.Net.Sockets.TcpClient("100.x.y.z", 9100)
  $s = $c.GetStream()
  $b = [Text.Encoding]::ASCII.GetBytes("^XA^FO40,40^A0N,40,40^FDTEST^FS^XZ")
  $s.Write($b,0,$b.Length); $c.Client.Shutdown("Send"); $c.Close()
  ```

## Known limits

- **A successful send is not a printed label.** Raw printing is one-way: out of media, head open, or a ribbon fault all look identical to the sender. The agent logs what the spooler accepted, and the app says "sent", never "printed". If nothing comes out, look at the printer.
- **The label layout is provisional.** `proxy/src/services/zpl.ts` assumes 4"x2" at 203 dpi with guessed fields, pending a sample of the label Tork already uses. Don't run production stock through it until that's matched.
- Only one printer per PC. Two Zebras at one site would need a second port and a second `LABEL_PRINTERS` entry.
