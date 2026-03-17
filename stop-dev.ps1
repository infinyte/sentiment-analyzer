param(
  [int]$BackendPort = 3000,
  [int]$FrontendPort = 5173
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ports = @($BackendPort, $FrontendPort)
$stopped = [System.Collections.Generic.HashSet[int]]::new()

foreach ($port in $ports) {
  try {
    $connections = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    foreach ($connection in $connections) {
      if ($connection.OwningProcess -and $stopped.Add([int]$connection.OwningProcess)) {
        try {
          Stop-Process -Id $connection.OwningProcess -Force -ErrorAction Stop
          Write-Host "Stopped process on port ${port} (PID $($connection.OwningProcess))"
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
  $escapedRoot = [regex]::Escape($repoRoot)
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