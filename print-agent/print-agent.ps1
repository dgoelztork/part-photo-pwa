<#
    Tork label print agent.

    Makes a USB-attached Zebra look like a network printer.

    Networked Zebras accept raw ZPL on TCP 9100. A USB one doesn't listen on
    anything, so this sits in front of it: accept a connection on 9100, read the
    ZPL, hand it to the Windows print spooler as RAW. The receiving proxy is
    unchanged — it opens a socket to this machine exactly as it would to a
    network printer, and never knows the difference.

    Why it exists at all: the warehouse Zebras aren't reachable from TORK-APP.
    Alameda's is on a network the server can't see, and Pascagoula has no link
    to the server at all. Rather than quote for cabling and VLAN work at two
    sites, the PC already attached to each printer joins the Tailscale network
    and runs this. The printer itself needs no network, no IP, and no cabling.

    RAW matters. ZPL is printer control code, not a document — anything that
    tries to render or convert it produces pages of gibberish instead of a
    label. StartDocPrinter with a datatype of "RAW" tells the spooler to pass
    the bytes through untouched.

    Requires no installed runtime: Windows PowerShell 5.1, which ships with
    Windows. See README.md for install.
#>

[CmdletBinding()]
param(
    # Printer name exactly as Windows shows it in Devices and Printers.
    [Parameter(Mandatory = $true)]
    [string]$PrinterName,

    # 9100 is the raw-print port every network Zebra uses, so the proxy needs
    # no special case for USB sites.
    [int]$Port = 9100,

    # 0.0.0.0 accepts from the local network and the tailnet. The install
    # script's firewall rule is what limits who can actually reach it; pass a
    # specific address here to bind more tightly still.
    [string]$ListenAddress = "0.0.0.0",

    [string]$LogPath = "$PSScriptRoot\print-agent.log",

    # A label is a few kilobytes. Anything larger is a mistake or a probe, and
    # is refused rather than spooled.
    [int]$MaxJobBytes = 2097152,

    # A client that connects and says nothing must not hold the agent open.
    [int]$ReadTimeoutMs = 15000
)

$ErrorActionPreference = "Stop"

function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $line = "{0} [{1}] {2}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Level, $Message
    Write-Output $line
    try { Add-Content -Path $LogPath -Value $line -Encoding utf8 } catch { }
}

# --- raw printing -----------------------------------------------------------
# The spooler API is reached through P/Invoke because PowerShell's own printing
# cmdlets all render text. There is no managed API for "send these exact bytes".
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class RawPrinter
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private class DOCINFO
    {
        [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
    }

    [DllImport("winspool.Drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool OpenPrinter(string src, out IntPtr hPrinter, IntPtr pd);

    [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true)]
    private static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFO di);

    [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true)]
    private static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true)]
    private static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true)]
    private static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true)]
    private static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

    /// <summary>Send bytes to a printer untouched. Throws with the Win32 error on failure.</summary>
    public static void Send(string printerName, byte[] bytes, string jobName)
    {
        IntPtr hPrinter;
        if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero))
            throw new Exception("OpenPrinter failed for '" + printerName + "': " + Marshal.GetLastWin32Error());

        try
        {
            DOCINFO di = new DOCINFO();
            di.pDocName = jobName;
            di.pDataType = "RAW";      // pass through; do not render

            if (!StartDocPrinter(hPrinter, 1, di))
                throw new Exception("StartDocPrinter failed: " + Marshal.GetLastWin32Error());
            try
            {
                if (!StartPagePrinter(hPrinter))
                    throw new Exception("StartPagePrinter failed: " + Marshal.GetLastWin32Error());
                try
                {
                    IntPtr buf = Marshal.AllocCoTaskMem(bytes.Length);
                    try
                    {
                        Marshal.Copy(bytes, 0, buf, bytes.Length);
                        int written;
                        if (!WritePrinter(hPrinter, buf, bytes.Length, out written))
                            throw new Exception("WritePrinter failed: " + Marshal.GetLastWin32Error());
                        if (written != bytes.Length)
                            throw new Exception("Short write: " + written + " of " + bytes.Length + " bytes");
                    }
                    finally { Marshal.FreeCoTaskMem(buf); }
                }
                finally { EndPagePrinter(hPrinter); }
            }
            finally { EndDocPrinter(hPrinter); }
        }
        finally { ClosePrinter(hPrinter); }
    }
}
'@ -Language CSharp

# --- startup checks ---------------------------------------------------------
Write-Log "Tork label print agent starting"
Write-Log "printer      : $PrinterName"
Write-Log "listening on : ${ListenAddress}:$Port"
Write-Log "log          : $LogPath"

$printer = Get-Printer -Name $PrinterName -ErrorAction SilentlyContinue
if (-not $printer) {
    # Named up front rather than on the first label, so a typo surfaces at
    # install time instead of when someone is waiting at the bench.
    Write-Log "Printer '$PrinterName' not found. Installed printers:" "ERROR"
    Get-Printer | ForEach-Object { Write-Log "    $($_.Name)" "ERROR" }
    throw "Printer '$PrinterName' not found"
}
Write-Log "printer found: $($printer.Name) [$($printer.DriverName)] on $($printer.PortName)"

# --- listen -----------------------------------------------------------------
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse($ListenAddress), $Port)
try {
    $listener.Start()
} catch {
    Write-Log "Could not listen on ${ListenAddress}:${Port} — $($_.Exception.Message)" "ERROR"
    throw
}
Write-Log "ready — waiting for labels"

$jobNumber = 0

while ($true) {
    $client = $null
    try {
        $client = $listener.AcceptTcpClient()
        $peer = $client.Client.RemoteEndPoint.ToString()
        $client.ReceiveTimeout = $ReadTimeoutMs

        $stream = $client.GetStream()
        $buffer = New-Object System.IO.MemoryStream
        $chunk = New-Object byte[] 8192

        # Read until the sender closes its end. The proxy writes the label then
        # half-closes, which lands here as a zero-length read.
        while ($true) {
            $read = $stream.Read($chunk, 0, $chunk.Length)
            if ($read -le 0) { break }
            $buffer.Write($chunk, 0, $read)
            if ($buffer.Length -gt $MaxJobBytes) {
                throw "Job exceeded $MaxJobBytes bytes from $peer — refusing"
            }
        }

        $bytes = $buffer.ToArray()
        if ($bytes.Length -eq 0) {
            # Port scanners and health checks connect and leave. Not an error.
            Write-Log "empty connection from $peer — ignored"
        }
        else {
            $jobNumber++
            $name = "Tork label $jobNumber"
            # ^PQ in the ZPL carries the copy count, so one job may be many
            # labels. Logged for matching against the proxy's own line.
            $copies = 1
            $text = [System.Text.Encoding]::ASCII.GetString($bytes)
            if ($text -match '\^PQ(\d+)') { $copies = [int]$Matches[1] }

            try {
                [RawPrinter]::Send($PrinterName, $bytes, $name)
                Write-Log "job $jobNumber from $peer — $($bytes.Length) bytes, $copies label(s) sent to '$PrinterName'"
            }
            catch {
                # Spooler refusals are the failure worth shouting about: the
                # proxy has already told the receiver the label went, because a
                # raw socket write cannot report back.
                Write-Log "job $jobNumber FAILED to print: $($_.Exception.Message)" "ERROR"
            }
        }
    }
    catch {
        Write-Log "connection error: $($_.Exception.Message)" "ERROR"
    }
    finally {
        if ($client) { try { $client.Close() } catch { } }
    }
}
