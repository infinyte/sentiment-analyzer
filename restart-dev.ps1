param(
  [int]$BackendPort = 3000,
  [int]$FrontendPort = 5173,
  [int]$StartupTimeoutSeconds = 90
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Join-Path $repoRoot 'backend'
$frontendDir = Join-Path $repoRoot 'frontend'
$frontendUrl = "http://localhost:$FrontendPort"

function Stop-RepoDevProcesses {
  param(
    [string]$RootPath,
    [int[]]$Ports
  )

  $stopped = [System.Collections.Generic.HashSet[int]]::new()

  foreach ($port in $Ports) {
    try {
      $connections = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
      foreach ($connection in $connections) {
        if ($connection.OwningProcess -and $stopped.Add($connection.OwningProcess)) {
          try {
            Stop-Process -Id $connection.OwningProcess -Force -ErrorAction Stop
            Write-Host "Stopped process on port $port (PID $($connection.OwningProcess))"
          } catch {
            Write-Warning "Failed to stop PID $($connection.OwningProcess) on port ${port}: $($_.Exception.Message)"
          }
        }
      }
    } catch {
      Write-Warning "Port scan failed for ${port}: $($_.Exception.Message)"
    }
  }

  try {
    $escapedRoot = [regex]::Escape($RootPath)
    $processes = Get-CimInstance Win32_Process |
      Where-Object {
        $_.CommandLine -and
        $_.CommandLine -match $escapedRoot -and
        $_.ProcessId -ne $PID -and
        (
          $_.CommandLine -match 'npm(\.cmd)?\s+run\s+dev' -or
          $_.CommandLine -match 'vite(\.cmd)?' -or
          $_.CommandLine -match 'tsx(\.cmd)?.*src\\index\.ts' -or
          $_.CommandLine -match 'nodemon(\.cmd)?'
        )
      }

    foreach ($process in $processes) {
      if ($process.ProcessId -and $stopped.Add([int]$process.ProcessId)) {
        try {
          Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
          Write-Host "Stopped repo dev process PID $($process.ProcessId)"
        } catch {
          Write-Warning "Failed to stop repo dev process PID $($process.ProcessId): $($_.Exception.Message)"
        }
      }
    }
  } catch {
    Write-Warning "Command-line process scan failed: $($_.Exception.Message)"
  }
}

function Start-DevTerminal {
  param(
    [string]$Title,
    [string]$WorkingDirectory,
    [string]$Command
  )

  $script = @"
Set-Location -LiteralPath '$WorkingDirectory'


$host.UI.RawUI.WindowTitle = '$Title'
$env:FORCE_COLOR = '1'
$Command
"@

  Start-Process -FilePath 'pwsh' -WorkingDirectory $WorkingDirectory -ArgumentList @(
    '-NoExit'
    '-Command'
    $script
  ) | Out-Null
}

function Wait-ForUrl {
  param(
    [string]$Url,
    [int]$TimeoutSeconds
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
        return $true
      }
    } catch {
      Start-Sleep -Seconds 2
    }
  }

  return $false
}

if (-not (Test-Path -LiteralPath $backendDir)) {
  throw "Backend directory not found: $backendDir"
}

if (-not (Test-Path -LiteralPath $frontendDir)) {
  throw "Frontend directory not found: $frontendDir"
}

Write-Host 'Stopping existing backend/frontend dev processes...'
Stop-RepoDevProcesses -RootPath $repoRoot -Ports @($BackendPort, $FrontendPort)

Start-Sleep -Seconds 2

Write-Host 'Starting backend terminal...'
Start-DevTerminal -Title 'Sentiment Analyzer Backend' -WorkingDirectory $backendDir -Command 'npm run dev'

Write-Host 'Starting frontend terminal...'
Start-DevTerminal -Title 'Sentiment Analyzer Frontend' -WorkingDirectory $frontendDir -Command 'npm run dev'

Write-Host "Waiting for frontend at $frontendUrl ..."
if (Wait-ForUrl -Url $frontendUrl -TimeoutSeconds $StartupTimeoutSeconds) {
  Write-Host "Frontend is ready. Opening $frontendUrl"
  Start-Process $frontendUrl | Out-Null
} else {
  Write-Warning "Frontend did not become ready within $StartupTimeoutSeconds seconds."
}