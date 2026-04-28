<#
.SYNOPSIS
  Renew the Tailscale-issued Let's Encrypt cert for the receiving proxy and
  restart the service if the cert was rewritten.

.DESCRIPTION
  Run daily via Windows Task Scheduler. Idempotent: only renews when the
  current cert is within 14 days of expiry, only restarts the service when
  the cert was actually replaced. Output appended to cert-renewal.log.

.NOTES
  - tailscale cert is itself idempotent, but this script also short-circuits
    on its own to keep the log signal-to-noise high.
  - Run as SYSTEM so it works regardless of who is logged in.

.EXAMPLE
  # One-time scheduled task registration (run as Admin):
  $a = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument '-NoProfile -ExecutionPolicy Bypass -File "C:\Apps\receiving-proxy\proxy\scripts\Renew-ProxyCert.ps1"'
  $t = New-ScheduledTaskTrigger -Daily -At '3:30AM'
  $p = New-ScheduledTaskPrincipal -UserId 'NT AUTHORITY\SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  $s = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
  Register-ScheduledTask -TaskName 'ReceivingProxyCertRenewal' -Action $a -Trigger $t -Principal $p -Settings $s
#>

$ErrorActionPreference = 'Stop'

$certPath  = 'C:\Apps\receiving-proxy\proxy\certs\cert.pem'
$keyPath   = 'C:\Apps\receiving-proxy\proxy\certs\key.pem'
$tsExe     = 'C:\Program Files\Tailscale\tailscale.exe'
$hostname  = 'tork-app.tail14e57a.ts.net'
$logFile   = 'C:\Apps\receiving-proxy\proxy\logs\cert-renewal.log'
$renewWithinDays = 14

function Log($msg) {
  Add-Content -Path $logFile -Value "$(Get-Date -Format 's') $msg"
}

try {
  if (-not (Test-Path $certPath)) {
    Log "no existing cert at $certPath; provisioning fresh"
  } else {
    $cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($certPath)
    $daysLeft = [int](($cert.NotAfter - (Get-Date)).TotalDays)
    if ($daysLeft -gt $renewWithinDays) {
      Log "cert valid until $($cert.NotAfter) ($daysLeft days left); no renewal needed"
      exit 0
    }
    Log "cert valid until $($cert.NotAfter) ($daysLeft days left); renewing"
  }

  $hashBefore = if (Test-Path $certPath) { (Get-FileHash $certPath -Algorithm SHA256).Hash } else { '' }

  & $tsExe cert --cert-file $certPath --key-file $keyPath $hostname 2>&1 | ForEach-Object { Log "tailscale: $_" }
  if ($LASTEXITCODE -ne 0) {
    Log "tailscale cert FAILED with exit code $LASTEXITCODE"
    exit 1
  }

  $hashAfter = (Get-FileHash $certPath -Algorithm SHA256).Hash
  if ($hashAfter -eq $hashBefore) {
    Log "cert content unchanged; skipping service restart"
    exit 0
  }

  Log "cert content changed; restarting ReceivingProxy"
  Restart-Service -Name ReceivingProxy -Force

  $deadline = (Get-Date).AddSeconds(15)
  do {
    Start-Sleep -Milliseconds 500
    $code = & curl.exe -sk -o NUL -w "%{http_code}" --max-time 2 https://127.0.0.1:3001/api/health 2>$null
    if ($code -eq '200') { break }
  } while ((Get-Date) -lt $deadline)

  if ($code -eq '200') {
    Log "post-restart health: 200 OK"
  } else {
    Log "post-restart health: $code (FAILED to come back up cleanly)"
    exit 1
  }
} catch {
  Log "ERROR: $($_.Exception.Message)"
  exit 1
}
