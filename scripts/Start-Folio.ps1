$ErrorActionPreference = 'Stop'

$appRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$distIndex = Join-Path $appRoot 'dist\index.html'
$nodeModules = Join-Path $appRoot 'node_modules'
$serverPath = Join-Path $appRoot 'scripts\server.mjs'
$outputDirectory = Join-Path $appRoot 'output'
$healthUrl = 'http://127.0.0.1:4173/health'
$appUrl = 'http://127.0.0.1:4173/'

function Get-HealthResult {
    $request = [System.Net.HttpWebRequest]::Create($healthUrl)
    $request.Method = 'GET'
    $request.AllowAutoRedirect = $false
    $request.Timeout = 1000
    $request.ReadWriteTimeout = 1000

    $response = $null
    try {
        $response = [System.Net.HttpWebResponse]$request.GetResponse()
    }
    catch [System.Net.WebException] {
        if ($_.Exception.Response) {
            return [pscustomobject]@{ Responded = $true; IsFolio = $false }
        }
        return [pscustomobject]@{ Responded = $false; IsFolio = $false }
    }

    try {
        $reader = New-Object System.IO.StreamReader($response.GetResponseStream())
        try { $body = $reader.ReadToEnd() }
        finally { $reader.Dispose() }

        $health = $null
        try { $health = $body | ConvertFrom-Json }
        catch { }

        $isFolio = $response.StatusCode -eq [System.Net.HttpStatusCode]::OK -and
            $health.application -ceq 'folio-reader' -and $health.status -ceq 'ok'
        return [pscustomobject]@{ Responded = $true; IsFolio = $isFolio }
    }
    finally {
        $response.Dispose()
    }
}

function Find-Chrome {
    $candidates = @(
        (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
        (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) }

    if ($candidates) { return $candidates | Select-Object -First 1 }
    $command = Get-Command chrome.exe -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    return $null
}

try {
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $nodeCommand) {
        throw 'Node.js is required to start Folio. Install Node.js 22.13 or newer, then run this launcher again.'
    }

    $nodeVersionOutput = & $nodeCommand.Source --version
    if ($LASTEXITCODE -ne 0 -or $nodeVersionOutput -notmatch '^v(\d+)\.(\d+)\.(\d+)') {
        throw 'Folio could not read the installed Node.js version. Reinstall Node.js 22.13 or newer and try again.'
    }
    $nodeVersion = [version]::new([int]$Matches[1], [int]$Matches[2], [int]$Matches[3])
    if ($nodeVersion -lt [version]'22.13.0') {
        throw "Folio requires Node.js 22.13 or newer. Installed version: $nodeVersion."
    }

    if (-not (Test-Path -LiteralPath $nodeModules -PathType Container)) {
        throw 'Folio dependencies are not installed. Open a terminal in the Folio folder, run "npm ci", then launch Folio again.'
    }

    if (-not (Test-Path -LiteralPath $distIndex -PathType Leaf)) {
        Write-Host 'Folio production files are missing. Building them with npm run build...'
        Push-Location $appRoot
        try { & npm run build }
        finally { Pop-Location }
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $distIndex -PathType Leaf)) {
            throw 'Folio could not build its production files. Review the build output above, fix the reported issue, then run "npm run build" again.'
        }
    }

    $health = Get-HealthResult
    if ($health.Responded -and -not $health.IsFolio) {
        throw 'Port 4173 is answering as another app. Close that app, then launch Folio again. Folio did not stop the other app.'
    }

    if (-not $health.IsFolio) {
        if (-not (Test-Path -LiteralPath $outputDirectory -PathType Container)) {
            New-Item -ItemType Directory -Path $outputDirectory | Out-Null
        }

        $logStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
        $stdoutLog = Join-Path $outputDirectory "server-$logStamp.log"
        $stderrLog = Join-Path $outputDirectory "server-error-$logStamp.log"
        $nodeArguments = '"' + $serverPath + '"'
        $serverProcess = Start-Process -FilePath $nodeCommand.Source -ArgumentList $nodeArguments -WorkingDirectory $appRoot -WindowStyle Hidden -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog -PassThru

        $deadline = [DateTime]::UtcNow.AddSeconds(5)
        do {
            Start-Sleep -Milliseconds 150
            $health = Get-HealthResult
            if ($health.Responded -and -not $health.IsFolio) {
                throw 'Port 4173 is answering as another app. Close that app, then launch Folio again. Folio did not stop the other app.'
            }
            if (-not $health.IsFolio -and $serverProcess.HasExited) {
                $startupError = if (Test-Path -LiteralPath $stderrLog -PathType Leaf) { Get-Content -LiteralPath $stderrLog -Raw } else { '' }
                if ($startupError -match 'already in use') {
                    throw 'Port 4173 is already in use by another service. Close that service, then launch Folio again. Folio did not stop it.'
                }
                throw "Folio's server exited before becoming ready. Check $stderrLog and $stdoutLog for details."
            }
        } while (-not $health.IsFolio -and [DateTime]::UtcNow -lt $deadline)

        if (-not $health.IsFolio) {
            throw "Folio did not become ready at $appUrl within 5 seconds. Check $stderrLog and $stdoutLog for details."
        }
    }

    $chromePath = Find-Chrome
    if ($chromePath) {
        Start-Process -FilePath $chromePath -ArgumentList $appUrl | Out-Null
    }
    else {
        Write-Host 'Chrome was not found. Opening Folio in your default browser.'
        Start-Process -FilePath $appUrl | Out-Null
    }
}
catch {
    Write-Error $_.Exception.Message
    exit 1
}
