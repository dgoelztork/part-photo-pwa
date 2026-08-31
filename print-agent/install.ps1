<#
    Install the Tork label print agent on a warehouse PC.

    Run this ONCE per site, from an elevated PowerShell, on the PC the Zebra is
    plugged into. It:

      1. checks the printer name is real
      2. registers a scheduled task that runs the agent at boot, as SYSTEM, so
         it survives restarts and needs nobody logged in
      3. opens the port to the Tailscale network only
      4. starts it

    A scheduled task rather than a Windows service because it needs no extra
    software — nssm isn't on these machines and this way nothing has to be
    installed to install it.

    Example:
        .\install.ps1 -PrinterName "ZDesigner ZD621-203dpi ZPL"
#>

[CmdletBinding()]
param(
    # Exactly as it appears in Devices and Printers.
    [Parameter(Mandatory = $true)]
    [string]$PrinterName,

    [int]$Port = 9100,

    [string]$TaskName = "TorkLabelPrintAgent"
)

$ErrorActionPreference = "Stop"

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
        ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Run this from an elevated PowerShell (right-click, Run as administrator)."
}

$agent = Join-Path $PSScriptRoot "print-agent.ps1"
if (-not (Test-Path $agent)) { throw "print-agent.ps1 not found next to this script." }

# --- 1. the printer ---------------------------------------------------------
$printer = Get-Printer -Name $PrinterName -ErrorAction SilentlyContinue
if (-not $printer) {
    Write-Host "`nPrinter '$PrinterName' not found. Installed printers:`n" -ForegroundColor Red
    Get-Printer | ForEach-Object { Write-Host "    $($_.Name)" }
    throw "Fix the -PrinterName and run again."
}
Write-Host "printer : $($printer.Name)" -ForegroundColor Green
Write-Host "driver  : $($printer.DriverName)"
Write-Host "port    : $($printer.PortName)"

# --- 2. the scheduled task --------------------------------------------------
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Write-Host "`nreplacing the existing task" -ForegroundColor Yellow
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument ("-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$agent`" " +
               "-PrinterName `"$PrinterName`" -Port $Port")
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
# Restart on failure and never stop it: this must be running whenever someone
# is at the bench, and nobody is watching it.
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Principal $principal -Settings $settings `
    -Description "Receives labels from the Tork receiving app and prints them to the USB Zebra." | Out-Null
Write-Host "`ntask registered: $TaskName" -ForegroundColor Green

# --- 3. the firewall --------------------------------------------------------
# 100.64.0.0/10 is the range Tailscale assigns. Limiting the rule to it means
# only machines on the tailnet can print — not the whole warehouse network,
# and nothing from the internet.
$ruleName = "Tork label print agent (Tailscale only)"
Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow `
    -Protocol TCP -LocalPort $Port -RemoteAddress "100.64.0.0/10" -Profile Any | Out-Null
Write-Host "firewall: port $Port open to the Tailscale network only" -ForegroundColor Green

# --- 4. start it ------------------------------------------------------------
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 4
$listening = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue

Write-Host ""
if ($listening) {
    Write-Host "RUNNING - the agent is listening on port $Port" -ForegroundColor Green
} else {
    Write-Host "NOT LISTENING - check print-agent.log next to this script" -ForegroundColor Red
}

$ts = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
      Where-Object { $_.IPAddress -like "100.*" } | Select-Object -First 1
Write-Host ""
if ($ts) {
    Write-Host "Tailscale address: $($ts.IPAddress)" -ForegroundColor Green
    Write-Host "Send this to Avery, with the site name, so the server can find this printer."
} else {
    Write-Host "No Tailscale address yet." -ForegroundColor Yellow
    Write-Host "Install Tailscale and sign in, then run: Get-NetIPAddress | Where-Object { `$_.IPAddress -like '100.*' }"
}
