param(
    [string]$DestinationDirectory = [Environment]::GetFolderPath('DesktopDirectory')
)

$ErrorActionPreference = 'Stop'
$appRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$launcherPath = Join-Path $appRoot 'Start Folio.cmd'

try {
    if (-not (Test-Path -LiteralPath $launcherPath -PathType Leaf)) {
        throw "Folio launcher is missing: $launcherPath"
    }
    if (-not (Test-Path -LiteralPath $DestinationDirectory -PathType Container)) {
        throw "Shortcut destination folder does not exist: $DestinationDirectory"
    }

    $shortcutPath = Join-Path (Resolve-Path $DestinationDirectory).Path 'Folio.lnk'
    $shell = New-Object -ComObject WScript.Shell
    if (Test-Path -LiteralPath $shortcutPath -PathType Leaf) {
        $existing = $shell.CreateShortcut($shortcutPath)
        $existingTarget = [IO.Path]::GetFullPath($existing.TargetPath)
        $wantedTarget = [IO.Path]::GetFullPath($launcherPath)
        if (-not [string]::Equals($existingTarget, $wantedTarget, [StringComparison]::OrdinalIgnoreCase)) {
            throw "A different shortcut already uses '$shortcutPath'. Rename or move that shortcut before creating Folio's shortcut."
        }
    }

    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $launcherPath
    $shortcut.WorkingDirectory = $appRoot
    $shortcut.Description = 'Open the local Folio PDF reader in Chrome'

    $chromeCandidates = @(
        (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
        (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) }
    $folioIcon = Join-Path $appRoot 'public\icon.ico'
    if (Test-Path -LiteralPath $folioIcon -PathType Leaf) {
        $shortcut.IconLocation = "$folioIcon,0"
    }
    elseif ($chromeCandidates) {
        $shortcut.IconLocation = "$(($chromeCandidates | Select-Object -First 1)),0"
    }

    $shortcut.Save()
    Write-Host "Created Folio shortcut: $shortcutPath"
}
catch {
    Write-Error $_.Exception.Message
    exit 1
}
