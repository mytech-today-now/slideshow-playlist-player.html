<#
.SYNOPSIS
    Starts a minimal static HTTP server for player.html v2 development and opens a browser.

.DESCRIPTION
    Launches a zero-config local server (npx serve preferred, Python fallback, pure PowerShell last resort).
    Opens Chrome/Edge to the player with full File System Access support.
    Prints a beautiful banner with the exact testing command for the videos/ folder.

.PARAMETER Port
    Port number (default 5173).

.PARAMETER Browser
    Preferred browser: Chrome, Edge, or Default.

.PARAMETER Incognito
    Launch browser in private/incognito mode.

.PARAMETER NoOpen
    Start server only, do not open browser.

.PARAMETER Test
    Print the complete prioritized Testing Protocol checklist (from the 1st-prompt-for-player.md).

.PARAMETER CreateWeddingTestList
    Writes samples/wedding-playlist.txt with the five wedding parser vectors plus real absolute paths from videos/.

.EXAMPLE
    .\scripts\Start-PlayerDev.ps1
    # Starts server on 5173, opens Edge/Chrome to src/player.html

.EXAMPLE
    .\scripts\Start-PlayerDev.ps1 -Port 8080 -Test
    # Custom port + full test checklist printed

.EXAMPLE
    .\scripts\Start-PlayerDev.ps1 -CreateWeddingTestList -Test
    # Creates samples/wedding-playlist.txt and prints the import test steps

.NOTES
    Requires PowerShell 7+. Works great with the videos/ directory in this repo for real-world testing
    (long emoji filenames, MKV, WebM, prefixed files, subtitles, 0-byte fake file).
#>
[CmdletBinding()]
param(
    [int]$Port = 5173,
    [ValidateSet('Chrome','Edge','Default')]
    [string]$Browser = 'Edge',
    [switch]$Incognito,
    [switch]$NoOpen,
    [switch]$Test,
    [switch]$CreateWeddingTestList
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $repoRoot) { $repoRoot = Get-Location }

$playerUrl = "http://localhost:$Port/src/player.html"
$weddingTestList = Join-Path $repoRoot 'samples\wedding-playlist.txt'

function New-WeddingTestList {
    $samplesDir = Join-Path $repoRoot 'samples'
    $videosDir = Join-Path $repoRoot 'videos'
    New-Item -ItemType Directory -Path $samplesDir -Force | Out-Null

    $lines = @(
        '"C:\Users\kyle_\Music\wedding\a-ha_-_Take_On_Me_Official_Video_4K [djV11Xbc914].mp4"',
        '"C:\Users\kyle_\Music\wedding\AC_DC_-_Thunderstruck_Live_At_River_Plate_December_2009 [n_GFN3a0yj0].mp4"',
        '"C:\Users\kyle_\Music\wedding\Alannah_Myles_-_Black_Velvet [tT4d1LQy4es].mp4"',
        '"C:\Users\kyle_\Music\wedding\Berlin_-_Take_My_Breath_Away_Official_Video_-_Top_Gun [Bx51eegLTY8].mp4"',
        '"C:\Users\kyle_\Music\wedding\Bob_Seger_The_Silver_Bullet_Band_-_Night_Moves_Official_Video [xH7cSSKnkL4].mp4"'
    )

    $realFiles = Get-ChildItem -LiteralPath $videosDir -File -ErrorAction Stop |
        Where-Object { $_.Extension -match '^\.(mp4|mkv|webm)$' -and $_.Length -gt 0 } |
        Sort-Object Name |
        Select-Object -First 4

    foreach ($file in $realFiles) {
        $lines += ('"{0}"' -f $file.FullName)
    }

    Set-Content -LiteralPath $weddingTestList -Value $lines -Encoding utf8
    Write-Host "Created import test list: $weddingTestList" -ForegroundColor Green
}

function Write-Banner {
    Write-Host ""
    Write-Host "╔══════════════════════════════════════════════════════════════════╗" -ForegroundColor Magenta
    Write-Host "║   Blend • player.html v2  —  Local Media Playback Studio        ║" -ForegroundColor Magenta
    Write-Host "╚══════════════════════════════════════════════════════════════════╝" -ForegroundColor Magenta
    Write-Host ""
    Write-Host "  Serving from : $repoRoot" -ForegroundColor Cyan
    Write-Host "  URL          : $playerUrl" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Keyboard     : Space=Play/Pause  C=Config  ←/→=Prev/Next  ? = Help" -ForegroundColor Yellow
    Write-Host "  Quick Test   : When the app opens, click 'Add Folder' and select:" -ForegroundColor Yellow
    Write-Host "                 $repoRoot\videos\" -ForegroundColor White
    Write-Host "  Import Test  : Drop samples\wedding-playlist.txt onto the Playlist pane." -ForegroundColor Yellow
    Write-Host "                 Use -CreateWeddingTestList to generate it." -ForegroundColor DarkYellow
    Write-Host ""
    Write-Host "  Ctrl+C to stop the server." -ForegroundColor DarkGray
    Write-Host ""
}

function Write-TestChecklist {
    Write-Host "`n════════════════════════════════════════════════════════════════════" -ForegroundColor DarkCyan
    Write-Host " FULL TESTING PROTOCOL (from ai-prompts/1st-prompt-for-player.md)" -ForegroundColor DarkCyan
    Write-Host "════════════════════════════════════════════════════════════════════`n" -ForegroundColor DarkCyan

    Write-Host "1. Add Folder flow (use the exact videos/ below):"
    Write-Host "   - The Los Angeles Lakers - Same arena...💜💛-1225939385515823104.mp4"
    Write-Host "   - mkv-Sintel_Trailer1.480p.DivX_Plus_HD.mkv"
    Write-Host "   - webm-big-buck-bunny_trailer.webm"
    Write-Host "   - fake with a really long title that will probably need to wrap.mp4"
    Write-Host "   - nba_*.mp4 files + subtitle.srt / .vtt (must be ignored)"
    Write-Host ""

    Write-Host "2. Dual-layer construction & playback:"
    Write-Host "   - Build Playlist ≥5 items (include the emoji-long + mkv + webm)"
    Write-Host "   - Build Slideshow with 3+ videos (toggle Include Audio on 1-2)"
    Write-Host "   - Play, exercise Prev/Next 10+ times (incl. random mode), live Opacity slider, volumes"
    Write-Host ""

    Write-Host "3. Persistence & reload:"
    Write-Host "   - After playing to item #3 + changing settings, reload the page"
    Write-Host "   - Confirm library + indices + modes restored, Play resumes prior state"
    Write-Host ""

    Write-Host "4. Import/Export roundtrip:"
    Write-Host "   - Run this script with -CreateWeddingTestList"
    Write-Host "   - Drop samples\wedding-playlist.txt onto the Playlist pane"
    Write-Host "   - Export Full Experience (with long/emoji paths)"
    Write-Host "   - Clear everything, import, re-acquire handles, verify identical blend"
    Write-Host ""

    Write-Host "5. Edge cases:"
    Write-Host "   - Rapid Next/Prev spam (20+ in <5s)"
    Write-Host "   - Add same folder twice (dedupe)"
    Write-Host "   - Stale handle simulation (rename a file outside app)"
    Write-Host ""
}

if ($CreateWeddingTestList) {
    New-WeddingTestList
}

# Prefer npx serve (fastest, SPA-friendly)
$serverCmd = $null
if (Get-Command npx -ErrorAction SilentlyContinue) {
    $serverCmd = "npx serve -l $Port --cors"
    Write-Host "Using: npx serve (recommended)" -ForegroundColor Green
} elseif (Get-Command python -ErrorAction SilentlyContinue) {
    $serverCmd = "python -m http.server $Port"
    Write-Host "Using: python -m http.server" -ForegroundColor Yellow
} else {
    # Pure PowerShell HttpListener fallback (basic but functional)
    Write-Host "Using: pure PowerShell HttpListener (no npx/python found)" -ForegroundColor DarkYellow
    $listener = [System.Net.HttpListener]::new()
    $listener.Prefixes.Add("http://localhost:$Port/")
    $listener.Start()
    Write-Host "PowerShell listener running on http://localhost:$Port/" -ForegroundColor Cyan
    Write-Banner
    if ($Test) { Write-TestChecklist }
    if (-not $NoOpen) {
        Start-Process $playerUrl
    }
    Write-Host "`nPress Ctrl+C to stop..." -ForegroundColor DarkGray
    try {
        while ($listener.IsListening) {
            $ctx = $listener.GetContext()
            $path = $ctx.Request.Url.LocalPath.TrimStart('/')
            $full = Join-Path $repoRoot ($path -replace '/', '\')
            if (Test-Path $full -PathType Leaf) {
                $bytes = [IO.File]::ReadAllBytes($full)
                $ctx.Response.ContentType = 'text/html'
                $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
            } else {
                $ctx.Response.StatusCode = 404
            }
            $ctx.Response.Close()
        }
    } finally { $listener.Stop() }
    return
}

Write-Banner
if ($Test) { Write-TestChecklist }

# Start the chosen server in background
$job = Start-Job -ScriptBlock {
    param($cmd, $root)
    Set-Location $root
    Invoke-Expression $cmd
} -ArgumentList $serverCmd, $repoRoot

Start-Sleep -Milliseconds 650

if (-not $NoOpen) {
    $browserPath = $null
    if ($Browser -eq 'Edge' -and (Test-Path 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe')) {
        $browserPath = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
    } elseif ($Browser -eq 'Chrome' -and (Test-Path 'C:\Program Files\Google\Chrome\Application\chrome.exe')) {
        $browserPath = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
    }

    $args = @($playerUrl)
    if ($Incognito) {
        if ($browserPath -like '*edge*') { $args += '--inprivate' }
        elseif ($browserPath -like '*chrome*') { $args += '--incognito' }
    }

    if ($browserPath) {
        Start-Process -FilePath $browserPath -ArgumentList $args
    } else {
        Start-Process $playerUrl
    }
}

Write-Host "Server job started (ID $($job.Id)). Use Stop-Job -Id $($job.Id) or Ctrl+C if running in foreground." -ForegroundColor DarkGray

# Wait on the job so Ctrl+C stops everything nicely
try {
    Receive-Job -Job $job -Wait
} finally {
    Stop-Job -Job $job -ErrorAction SilentlyContinue
    Remove-Job -Job $job -ErrorAction SilentlyContinue
    Write-Host "`nServer stopped." -ForegroundColor Gray
}
