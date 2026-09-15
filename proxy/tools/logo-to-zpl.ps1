<#
    Turn the Tork logo into the ^GFA bitmap that item labels carry.

    Why this exists
    ---------------
    A Zebra prints one bit per dot: a dot is burned or it is not. There is no
    grey and no colour, so the logo cannot be handed to the printer as a PNG.
    It has to become a bitmap of the exact pixel size it will occupy, and that
    is what this produces.

    IMPORTANT: unlike every other measurement in services/zpl.ts, which is a
    fraction of the label and rescales by itself, this bitmap is fixed pixels.
    If the label stock ever changes size, re-run this at the new dot size and
    paste the result back into LOGO_ZPL. Nothing will warn you.

    Source artwork
    --------------
    tork-systems-logo-300x100-no_background.png from torksystems.com, which is
    the black wordmark with the red wheel and a transparent background. Note
    the file is really 300x127 despite its name, so pass sizes that keep the
    2.36:1 aspect or the mark comes out squashed.

    The red wheel becomes solid black. That is unavoidable on a thermal head
    and is worth knowing before anyone compares a label against the colour
    sample from SAP.

    Usage
    -----
        .\logo-to-zpl.ps1 -Source .\tork-logo-source.png

    The defaults below are the current label's logo box, so normally -Source is
    the only argument needed. Pass -Width and -Height only when the stock size
    has changed, and keep the source's 2.36:1 aspect.

    Writes logo.gfa.txt (paste into LOGO_ZPL) and logo-preview.png (look at
    this before trusting it - thresholding small text can break up strokes).
#>
param(
    [Parameter(Mandatory = $true)]
    [string]$Source,

    # Defaults are the logo box on the current label: 2x3 stock (3in wide) on a
    # 600 dpi ZM400, so 1800 dots across. The box sits clear of the left margin
    # at 59 and the right-aligned header text at 396, above the description.
    #
    # These have been wrong twice already - 149x63 when the stock was believed
    # to be 4in, then 104x44 when the printer was assumed to be 203 dpi. Both
    # the stock size AND the resolution feed this. If either changes, change it
    # here as well as in zpl.ts, or the next person regenerates at the wrong
    # size and nothing says so.
    [int]$Width  = 307,
    [int]$Height = 130,

    # Anything darker than this burns. Raised above the midpoint on purpose:
    # scaling anti-aliases the strokes to grey, and a strict 128 thins the
    # small "SYSTEMS" lettering until it breaks up.
    [int]$Threshold = 160,

    [string]$OutDir = $PSScriptRoot
)

Add-Type -AssemblyName System.Drawing

$src = [System.Drawing.Image]::FromFile((Resolve-Path $Source))
Write-Output ("source: {0} x {1} px  ({2:N3} : 1)" -f $src.Width, $src.Height, ($src.Width / $src.Height))
Write-Output ("target: {0} x {1} dots ({2:N3} : 1, threshold {3})" -f $Width, $Height, ($Width / $Height), $Threshold)

$srcAspect = $src.Width / $src.Height
$outAspect = $Width / $Height
if ([Math]::Abs($srcAspect - $outAspect) -gt 0.05) {
    Write-Warning ("aspect differs by more than 5% - the logo will look stretched. Source is {0:N3} : 1." -f $srcAspect)
}

# Draw onto a WHITE canvas first. The source background is transparent, and
# transparency composited onto black would invert the whole mark.
$canvas = New-Object System.Drawing.Bitmap($Width, $Height)
$g = [System.Drawing.Graphics]::FromImage($canvas)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.PixelOffsetMode   = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.Clear([System.Drawing.Color]::White)
$g.DrawImage($src, 0, 0, $Width, $Height)
$g.Dispose()

$bytesPerRow = [Math]::Ceiling($Width / 8.0)
$sb = New-Object System.Text.StringBuilder
$preview = New-Object System.Drawing.Bitmap($Width, $Height)
$dark = 0

for ($y = 0; $y -lt $Height; $y++) {
    for ($bx = 0; $bx -lt $bytesPerRow; $bx++) {
        $b = 0
        for ($bit = 0; $bit -lt 8; $bit++) {
            $x = $bx * 8 + $bit
            if ($x -lt $Width) {
                $c = $canvas.GetPixel($x, $y)
                # Rec.601 luminance, the usual weighting for perceived brightness.
                $lum = 0.299 * $c.R + 0.587 * $c.G + 0.114 * $c.B
                if ($lum -lt $Threshold) {
                    # Bit set means burn. Most significant bit is the leftmost dot.
                    $b = $b -bor (1 -shl (7 - $bit))
                    $dark++
                    $preview.SetPixel($x, $y, [System.Drawing.Color]::Black)
                } else {
                    $preview.SetPixel($x, $y, [System.Drawing.Color]::White)
                }
            }
        }
        [void]$sb.Append($b.ToString('X2'))
    }
}

$total = $bytesPerRow * $Height
$hex = $sb.ToString()

Set-Content -Path (Join-Path $OutDir 'logo.gfa.txt') -Value "^GFA,$total,$total,$bytesPerRow,$hex" -Encoding ascii -NoNewline
$preview.Save((Join-Path $OutDir 'logo-preview.png'), [System.Drawing.Imaging.ImageFormat]::Png)

Write-Output ("bytes per row {0}, total {1}, hex {2} chars" -f $bytesPerRow, $total, $hex.Length)
Write-Output ("black dots: {0} of {1} ({2:N1}%)" -f $dark, ($Width * $Height), (100.0 * $dark / ($Width * $Height)))
Write-Output ("wrote logo.gfa.txt and logo-preview.png in {0}" -f $OutDir)

$preview.Dispose(); $canvas.Dispose(); $src.Dispose()
