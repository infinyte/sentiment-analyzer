#Requires -Version 5.1
<#
.SYNOPSIS
    Stops any running sentiment-analyzer processes, builds both backend and
    frontend from source, then launches them in separate console windows.

.DESCRIPTION
    Safe shutdown  - kills Node processes bound to ports 3000 and 5173, then
    kills any remaining node/tsx/vite processes that look like they belong to
    this project, without touching unrelated Node work.

    Build order    - backend first (tsc), then frontend (tsc + vite build).
    Both builds must succeed before either process is started.

    Launch         - backend via "node dist/index.js", frontend via "npm run dev",
    each in its own colour-coded console window so output stays separate.
    The script waits up to 30 seconds for each port to open, then reports URLs.

.PARAMETER SkipTests
    Skip the Jest / Vitest test runs (useful for fast restarts during development).

.PARAMETER NoBuild
    Skip all build and test steps and only stop + relaunch the compiled output.

.EXAMPLE
    .\start.ps1
    .\start.ps1 -SkipTests
    .\start.ps1 -NoBuild
#>

param(
    [switch]$SkipTests,
    [switch]$NoBuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot     = $PSScriptRoot
$BackendDir   = Join-Path $RepoRoot 'backend'
$FrontendDir  = Join-Path $RepoRoot 'frontend'
$BackendPort  = 3000
$FrontendPort = 5173
$NpmCmd       = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
if (-not $NpmCmd) { $NpmCmd = 'npm.cmd' }

# ── Helpers ───────────────────────────────────────────────────────────────────

function Write-Step  { param([string]$m) Write-Host "" ; Write-Host "==> $m" -ForegroundColor Cyan   }
function Write-Ok    { param([string]$m) Write-Host "    OK  $m"   -ForegroundColor Green  }
function Write-Warn  { param([string]$m) Write-Host "    !!  $m"   -ForegroundColor Yellow }
function Write-Fail  { param([string]$m) Write-Host "    FAIL  $m" -ForegroundColor Red    }

function Stop-PortProcess {
    param([int]$Port)

    $pattern = [string]::Format(':{0} ', $Port)
    $rows = netstat -ano 2>$null | Where-Object { $_ -match $pattern -and $_ -match 'LISTENING' }
    if (-not $rows) { return }

    $foundPids = @()
    foreach ($row in $rows) {
        $parts = ($row.Trim() -split '\s+')
        $pid_  = $parts[-1]
        if ($pid_ -match '^\d+$' -and $foundPids -notcontains $pid_) {
            $foundPids += $pid_
        }
    }

    foreach ($p in $foundPids) {
        $proc = Get-Process -Id ([int]$p) -ErrorAction SilentlyContinue
        if ($proc) {
            try {
                Stop-Process -Id ([int]$p) -Force -ErrorAction Stop
                Write-Ok "Stopped PID $p ($($proc.ProcessName)) on port $Port"
            } catch {
                Write-Warn "Could not stop PID $p on port $Port"
            }
        }
    }
}

function Stop-ProjectNodeProcesses {
    $markers = @('sentiment-analyzer', 'tsx src/index', 'vite')

    $nodeProcs = Get-WmiObject Win32_Process -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -eq 'node.exe' -or $_.Name -eq 'tsx.exe' }

    if (-not $nodeProcs) { return }

    foreach ($proc in $nodeProcs) {
        $cl = [string]$proc.CommandLine
        $matched = $false
        foreach ($marker in $markers) {
            if ($cl -like "*$marker*") { $matched = $true; break }
        }
        if ($matched) {
            try {
                Stop-Process -Id ([int]$proc.ProcessId) -Force -ErrorAction SilentlyContinue
                Write-Ok "Stopped orphan node process PID $($proc.ProcessId)"
            } catch {
                Write-Warn "Could not stop PID $($proc.ProcessId)"
            }
        }
    }
}

function Invoke-Step {
    param([string]$Label, [scriptblock]$Block)
    Write-Step $Label
    & $Block
    if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) {
        Write-Fail "$Label failed (exit code $LASTEXITCODE)"
        exit $LASTEXITCODE
    }
}

function Wait-PortOpen {
    param([int]$Port, [int]$TimeoutSeconds = 30)
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $tcp = New-Object System.Net.Sockets.TcpClient
            $tcp.Connect('127.0.0.1', $Port)
            $tcp.Close()
            return $true
        } catch {
            Start-Sleep -Milliseconds 500
        }
    }
    return $false
}

# ── 1. Shutdown ───────────────────────────────────────────────────────────────

Write-Step 'Shutting down existing processes'

Stop-PortProcess -Port $BackendPort
Stop-PortProcess -Port $FrontendPort
Stop-ProjectNodeProcesses

Start-Sleep -Seconds 1
Write-Ok "Ports $BackendPort and $FrontendPort are free"

# ── 2 & 3. Build (optional) ───────────────────────────────────────────────────

if ($NoBuild) {
    Write-Warn '-NoBuild specified - skipping build and test steps'
} else {

    # Backend
    Push-Location $BackendDir

    Invoke-Step 'Backend - type-check' {
        & $NpmCmd run type-check 2>&1 | ForEach-Object { Write-Host $_ }
    }

    if (-not $SkipTests) {
        Invoke-Step 'Backend - tests (Jest)' {
            & $NpmCmd test 2>&1 | ForEach-Object { Write-Host $_ }
        }
    }

    Invoke-Step 'Backend - build (tsc)' {
        & $NpmCmd run build 2>&1 | ForEach-Object { Write-Host $_ }
    }

    Pop-Location

    # Frontend
    Push-Location $FrontendDir

    Invoke-Step 'Frontend - type-check' {
        & $NpmCmd run type-check 2>&1 | ForEach-Object { Write-Host $_ }
    }

    if (-not $SkipTests) {
        Invoke-Step 'Frontend - tests (Vitest)' {
            & $NpmCmd test 2>&1 | ForEach-Object { Write-Host $_ }
        }
    }

    Invoke-Step 'Frontend - build (vite)' {
        & $NpmCmd run build 2>&1 | ForEach-Object { Write-Host $_ }
    }

    Pop-Location
}

# ── 4. Launch backend ─────────────────────────────────────────────────────────

Write-Step "Launching backend  (port $BackendPort)"

$backendScript = [string]::Format(
    "Set-Location '{0}'; Write-Host '=== Backend (port {1}) ===' -ForegroundColor Green; node dist/index.js",
    $BackendDir, $BackendPort
)

$backendProc = Start-Process powershell `
    -ArgumentList '-NoExit', '-ExecutionPolicy', 'Bypass', '-Command', $backendScript `
    -PassThru `
    -WindowStyle Normal

Write-Ok "Backend launched (PID $($backendProc.Id))"

# ── 5. Wait for backend ───────────────────────────────────────────────────────

Write-Step "Waiting for backend to accept connections on port $BackendPort"

if (Wait-PortOpen -Port $BackendPort -TimeoutSeconds 30) {
    Write-Ok "Backend is listening on port $BackendPort"
} else {
    Write-Fail "Backend did not open port $BackendPort within 30 seconds - check the backend window"
    exit 1
}

# ── 6. Launch frontend ────────────────────────────────────────────────────────

Write-Step "Launching frontend dev server  (port $FrontendPort)"

$frontendScript = [string]::Format(
    "Set-Location '{0}'; Write-Host '=== Frontend dev server (port {1}) ===' -ForegroundColor Magenta; npm.cmd run dev",
    $FrontendDir, $FrontendPort
)

$frontendProc = Start-Process powershell `
    -ArgumentList '-NoExit', '-ExecutionPolicy', 'Bypass', '-Command', $frontendScript `
    -PassThru `
    -WindowStyle Normal

Write-Ok "Frontend launched (PID $($frontendProc.Id))"

# ── 7. Wait for frontend ──────────────────────────────────────────────────────

Write-Step "Waiting for frontend to accept connections on port $FrontendPort"

if (Wait-PortOpen -Port $FrontendPort -TimeoutSeconds 30) {
    Write-Ok "Frontend is listening on port $FrontendPort"
} else {
    Write-Fail "Frontend did not open port $FrontendPort within 30 seconds - check the frontend window"
    exit 1
}

# ── 8. Summary ────────────────────────────────────────────────────────────────

Write-Host ''
Write-Host '============================================================' -ForegroundColor Green
Write-Host '  Sentiment Analyzer is running' -ForegroundColor Green
Write-Host ''
Write-Host "  Backend   http://localhost:$BackendPort/api/health" -ForegroundColor Green
Write-Host "  Frontend  http://localhost:$FrontendPort" -ForegroundColor Green
Write-Host '============================================================' -ForegroundColor Green
Write-Host ''
Write-Host '  Close the two console windows to stop both services.' -ForegroundColor DarkGray
Write-Host ''
