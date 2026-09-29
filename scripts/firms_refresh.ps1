# Trigger a TRACE FIRMS refresh via the API and wait for it to finish.
#
# The backend ALSO refreshes automatically every 6 hours on its own
# (APScheduler, FIRMS_REFRESH_HOURS env, default 6). This script is the
# visible, schedulable path — run it by hand, or from Windows Task
# Scheduler every 6 hours:
#
#   .\scripts\firms_refresh.ps1
#   .\scripts\firms_refresh.ps1 -Days 3 -TimeoutMin 120
param(
  [string]$Api = "http://localhost:8000",
  [int]$Days = 0,
  [int]$TimeoutMin = 90
)

Write-Host "Triggering FIRMS refresh on $Api ..."

try {
  $uri = "$Api/admin/refresh"
  if ($Days -gt 0) { $uri += "?days=$Days" }
  Invoke-RestMethod -Method Post -Uri $uri | Out-Null
} catch {
  $code = $_.Exception.Response.StatusCode.value__
  if ($code -eq 409) {
    Write-Host "A refresh is already running - following its progress instead."
  } else {
    Write-Host "Could not trigger a refresh: $($_.Exception.Message)"
    Write-Host "Is the API up at $Api ?"
    exit 1
  }
}

$deadline = (Get-Date).AddMinutes($TimeoutMin)
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 30
  try {
    $st = Invoke-RestMethod -Uri "$Api/admin/refresh/status"
  } catch {
    Write-Host "[$(Get-Date -Format HH:mm:ss)] status check failed: $($_.Exception.Message)"
    continue
  }
  $line = "[$(Get-Date -Format HH:mm:ss)] state=$($st.state)"
  if ($st.detail) { $line += " | $($st.detail)" }
  Write-Host $line
  if ($st.state -eq 'done')   { Write-Host "Refresh complete."; exit 0 }
  if ($st.state -eq 'failed') { Write-Host "Refresh FAILED: $($st.detail)"; exit 1 }
}

Write-Host "Timed out after $TimeoutMin min - the job may still be running."
Write-Host "Check: $Api/admin/refresh/status"
exit 2
