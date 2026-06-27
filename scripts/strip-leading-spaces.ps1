<#
.SYNOPSIS
    Strips leading spaces from HTML/MD files, preserving <pre>...</pre> blocks.

.DESCRIPTION
    Removes leading whitespace (spaces and tabs) from every line of the target
    HTML or Markdown file, except for lines inside <pre>...</pre> blocks, which
    are preserved as-is. A dated backup of the original file is created before
    any modification using the format: originalfilename.YYYY-MM-DD[-###].ext

.PARAMETER Path
    Path to the .html or .md file to process.

.EXAMPLE
    .\strip-leading-spaces.ps1 -Path "blogs/post.html"

    Strips leading spaces from post.html and saves a backup as post.YYYY-MM-DD.html.

.EXAMPLE
    .\strip-leading-spaces.ps1 "README.md"

    Processes README.md using positional argument.

.NOTES
    Version: 1.0.0
    Date: 2026-04-21
    Requires: PowerShell 5.1 or higher
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0, HelpMessage = "Path to the .html or .md file to process")]
    [ValidateNotNullOrEmpty()]
    [string]$Path
)

Set-StrictMode -Version Latest

$ScriptVersion = '1.0.0'

# Load external logging module. The module references PowerShell 7+ automatic
# variables ($IsWindows, $IsMacOS, $IsLinux) that are unset under Windows
# PowerShell 5.1. Strict mode must be off during dot-sourcing and during every
# Write-Log / Initialize-Log call on 5.1, so we disable it here and leave it off
# for the remainder of the script (this matches the pattern used by other
# logging-enabled scripts in this repo).
$LoggingScriptUrl = 'https://raw.githubusercontent.com/mytech-today-now/scripts/refs/heads/main/logging.ps1'
try {
    $ProgressPreference = 'SilentlyContinue'
    Set-StrictMode -Off
    . ([scriptblock]::Create((Invoke-WebRequest -Uri $LoggingScriptUrl -UseBasicParsing).Content))
}
catch {
    Write-Error "Failed to load logging module: $_"
    Write-Error "Script cannot continue without logging. Exiting."
    exit 1
}

function New-BackupPath {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$OriginalPath
    )

    $dir = Split-Path -Parent $OriginalPath
    if ([string]::IsNullOrEmpty($dir)) { $dir = "." }
    $ext = [System.IO.Path]::GetExtension($OriginalPath)
    $basename = [System.IO.Path]::GetFileNameWithoutExtension($OriginalPath)
    $today = (Get-Date).ToString("yyyy-MM-dd")

    for ($counter = 0; $counter -le 999; $counter++) {
        $suffix = if ($counter -eq 0) { "" } else { "-{0:D3}" -f $counter }
        $backupPath = Join-Path $dir "$basename.$today$suffix$ext"
        if (-not (Test-Path -LiteralPath $backupPath)) {
            return $backupPath
        }
    }

    throw "Too many backup files for today. Clean up old backups."
}

function Invoke-StripLeadingSpaces {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [AllowEmptyString()]
        [string]$Content
    )

    $lines = $Content -split "`n", -1
    $result = New-Object System.Collections.Generic.List[string]
    $preDepth = 0

    $preOpenRegex = [regex]'<pre[^>]*>'
    $preCloseRegex = [regex]'</pre>'

    foreach ($line in $lines) {
        $preOpens = $preOpenRegex.Matches($line).Count
        $preCloses = $preCloseRegex.Matches($line).Count
        $preDepth += $preOpens

        if ($preDepth -gt 0) {
            $result.Add($line) | Out-Null
        }
        else {
            $result.Add(($line -replace '^[ \t]+', '')) | Out-Null
        }

        $preDepth = [Math]::Max(0, $preDepth - $preCloses)
    }

    return ($result -join "`n")
}

try {
    Initialize-Log -ScriptName ([System.IO.Path]::GetFileNameWithoutExtension($MyInvocation.MyCommand.Name)) -ScriptVersion $ScriptVersion | Out-Null
    Write-Log "Script started with parameters: Path='$Path'" -Level INFO

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "File '$Path' does not exist."
    }

    $ext = [System.IO.Path]::GetExtension($Path).ToLowerInvariant()
    if ($ext -notin @('.html', '.md')) {
        throw "File must be .html or .md, got '$ext'"
    }

    Write-Log "Reading original content from '$Path'" -Level INFO
    $originalContent = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)

    $backupPath = New-BackupPath -OriginalPath $Path
    Write-Log "Creating backup: $backupPath" -Level INFO
    [System.IO.File]::WriteAllText($backupPath, $originalContent, [System.Text.UTF8Encoding]::new($false))
    Write-Host "[OK] Backup created: $backupPath" -ForegroundColor Green

    Write-Log "Processing content..." -Level INFO
    $processedContent = Invoke-StripLeadingSpaces -Content $originalContent

    [System.IO.File]::WriteAllText($Path, $processedContent, [System.Text.UTF8Encoding]::new($false))

    $originalLines = ($originalContent -split "`n", -1).Count
    $sizeDiff = $originalContent.Length - $processedContent.Length

    Write-Host "[OK] Processing complete: $Path" -ForegroundColor Green
    Write-Host "Statistics:" -ForegroundColor Cyan
    Write-Host "   - Lines processed: $originalLines"
    Write-Host "   - Size reduction: $sizeDiff characters"
    Write-Host "   - Backup saved as: $([System.IO.Path]::GetFileName($backupPath))"

    Write-Log "Completed: lines=$originalLines, sizeReduction=$sizeDiff, backup='$backupPath'" -Level INFO
    Write-Log "Script completed successfully" -Level SUCCESS
}
catch {
    try {
        Write-Log "Script failed with error: $($_.Exception.Message)" -Level ERROR
        Write-Log "Error details: $($_.ScriptStackTrace)" -Level ERROR
    } catch { }
    Write-Error $_.Exception.Message
    exit 1
}
