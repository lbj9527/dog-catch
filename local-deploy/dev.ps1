[CmdletBinding()]
param(
  [ValidateSet("start-all","start-backend","start-frontend","start-admin","stop-all","status")] [string]$action = "start-all",
  [switch]$Open
)

$ErrorActionPreference = 'Stop'

function Write-Log {
  param([string]$msg)
  $ts = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
  Write-Host "[$ts] $msg"
}

# Paths
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$BackendDir  = Join-Path $Root 'backend'
$FrontendDir = Join-Path $Root 'frontend'
$AdminDir    = Join-Path $Root 'admin'
$AiSvcDir    = Join-Path $Root 'ai-rt-service'
$SecretsDir  = Join-Path $PSScriptRoot '.secrets'
$PidsDir     = Join-Path $PSScriptRoot '.pids'

# PID files
$BackendPidFile  = Join-Path $PidsDir 'backend.pid'
$FrontendPidFile = Join-Path $PidsDir 'frontend.pid'
$AdminPidFile    = Join-Path $PidsDir 'admin.pid'
$AiSvcPidFile    = Join-Path $PidsDir 'ai-rt-service.pid'

function Ensure-Dirs {
  foreach ($d in @($SecretsDir, $PidsDir)) { if (!(Test-Path $d)) { New-Item -ItemType Directory -Force -Path $d | Out-Null } }
}

function Ensure-NodeModules {
  param([string]$dir)
  if (!(Test-Path (Join-Path $dir 'package.json'))) { return }
  if (!(Test-Path (Join-Path $dir 'node_modules'))) {
    Write-Log "[$dir] node_modules not found, running npm install..."
    Push-Location $dir
    try { npm install | Write-Host } finally { Pop-Location }
  }
}

function Get-Or-Create-JwtSecret {
  $secretFile = Join-Path $SecretsDir 'JWT_SECRET.txt'
  if (Test-Path $secretFile) {
    $secret = Get-Content -Raw -Path $secretFile
    if ($null -ne $secret -and $secret.Trim().Length -ge 24) { return $secret.Trim() }
  }
  # Generate strong random secret (Base64 48 bytes)
  $bytes = New-Object byte[] 48; [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $secret = [Convert]::ToBase64String($bytes)
  $secret | Out-File -Encoding ascii -FilePath $secretFile -Force
  return $secret
}

function Save-Pid {
  param([int]$procId, [string]$file)
  "$procId" | Out-File -Encoding ascii -FilePath $file -Force
}

function Read-Pid {
  param([string]$file)
  if (!(Test-Path $file)) { return $null }
  try { return [int](Get-Content -Raw -Path $file) } catch { return $null }
}

function Is-Process-Running {
  param([int]$processId)
  if ($processId -le 0) { return $false }
  try { $p = Get-Process -Id $processId -ErrorAction Stop; return $true } catch { return $false }
}

function Wait-Port {
  param([int]$Port, [int]$TimeoutSec = 20)
  $stopAt = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $stopAt) {
    try {
      $r = Test-NetConnection -ComputerName 'localhost' -Port $Port -InformationLevel Quiet
      if ($r) { return $true }
    } catch {}
    Start-Sleep -Milliseconds 400
  }
  return $false
}

function Get-FreePort {
  param([int]$StartPort = 9001, [int]$MaxTry = 50)
  for ($p = $StartPort; $p -lt ($StartPort + $MaxTry); $p++) {
    $inUse = Test-NetConnection -ComputerName 'localhost' -Port $p -InformationLevel Quiet
    if (-not $inUse) { return $p }
  }
  return $StartPort
}

function Start-Backend {
  Ensure-NodeModules $BackendDir
  $secret = Get-Or-Create-JwtSecret
  $cors = 'http://localhost:3000,http://localhost:3001,http://localhost:5173'
  # 读取本地 DeepSeek 配置（可选）
  $deepseekKeyFile = Join-Path $SecretsDir 'DEEPSEEK_API_KEY.txt'
  $deepseekEndpointFile = Join-Path $SecretsDir 'DEEPSEEK_ENDPOINT.txt'
  $deepseekModelFile = Join-Path $SecretsDir 'DEEPSEEK_MODEL.txt'
  $deepseekKey = ''
  if (Test-Path $deepseekKeyFile) { $deepseekKey = (Get-Content -Raw -Path $deepseekKeyFile).Trim() }
  $deepseekEndpoint = ''
  if (Test-Path $deepseekEndpointFile) { $deepseekEndpoint = (Get-Content -Raw -Path $deepseekEndpointFile).Trim() }
  $deepseekModel = ''
  if (Test-Path $deepseekModelFile) { $deepseekModel = (Get-Content -Raw -Path $deepseekModelFile).Trim() }

  $cmd = @"
cd "$BackendDir"
`$env:PORT='8000'
`$env:JWT_SECRET='$secret'
`$env:CORS_ORIGINS='$cors'
`$env:CAPTCHA_PROVIDER='hcaptcha'
`$env:CAPTCHA_SITE_KEY='10000000-ffff-ffff-ffff-000000000001'
`$env:CAPTCHA_SECRET_KEY='0x0000000000000000000000000000000000000000'
`$env:PY_AI_SERVICE_URL='${global:PY_AI_SERVICE_URL -replace "\"", "" }'
if (-not `$env:PY_AI_SERVICE_URL -or `$env:PY_AI_SERVICE_URL.Trim() -eq '') { `$env:PY_AI_SERVICE_URL='ws://127.0.0.1:9001/stream' }
`$env:DEEPSEEK_API_KEY='$deepseekKey'
`$env:DEEPSEEK_ENDPOINT='$deepseekEndpoint'
`$env:DEEPSEEK_MODEL='$deepseekModel'
npm run dev
"@
  Write-Log 'Starting backend (http://localhost:8000) ...'
  $proc = Start-Process -FilePath 'powershell' -ArgumentList '-NoExit','-Command', $cmd -WorkingDirectory $BackendDir -PassThru
  Save-Pid -procId $proc.Id -file $BackendPidFile
  if (Wait-Port -Port 8000 -TimeoutSec 20) { Write-Log 'Backend ready: http://localhost:8000' } else { Write-Log 'Note: 8000 not open within timeout; it may still be starting.' }
}

function Start-Frontend {
  Ensure-NodeModules $FrontendDir
  
  # 确保使用本地开发配置
  $configLocal = Join-Path $FrontendDir 'public\config.local.js'
  $configMain = Join-Path $FrontendDir 'public\config.js'
  if (Test-Path $configLocal) {
    Write-Log 'Using config.local.js for local development...'
    Copy-Item -Path $configLocal -Destination $configMain -Force
  } else {
    Write-Log 'Warning: config.local.js not found, using existing config.js'
  }
  
  $cmd = @"
cd "$FrontendDir"
npm run dev
"@
  Write-Log 'Starting frontend (Vite HMR, http://localhost:5173) ...'
  $proc = Start-Process -FilePath 'powershell' -ArgumentList '-NoExit','-Command', $cmd -WorkingDirectory $FrontendDir -PassThru
  Save-Pid -procId $proc.Id -file $FrontendPidFile
  if (Wait-Port -Port 5173 -TimeoutSec 20) { Write-Log 'Frontend ready: http://localhost:5173' } else { Write-Log 'Note: 5173 not open within timeout; it may still be starting.' }
}

function Start-Admin {
  Ensure-NodeModules $AdminDir
  $cmd = @"
cd "$AdminDir"
`$env:VITE_DEV_PORT='3001'
npm run dev
"@
  Write-Log 'Starting admin (Vite, http://localhost:3001) ...'
  $proc = Start-Process -FilePath 'powershell' -ArgumentList '-NoExit','-Command', $cmd -WorkingDirectory $AdminDir -PassThru
  Save-Pid -procId $proc.Id -file $AdminPidFile
  if (Wait-Port -Port 3001 -TimeoutSec 20) { Write-Log 'Admin ready: http://localhost:3001' } else { Write-Log 'Note: 3001 not open within timeout; it may still be starting.' }
}

function Start-AiService {
  # 使用 ai-rt-service 目录启动 Python 微服务
  $freePort = Get-FreePort -StartPort 9001 -MaxTry 50
  $cmd = @"
cd "$AiSvcDir"
# 激活 venv（如果存在）
if (Test-Path (Join-Path "$AiSvcDir" 'venv\Scripts\Activate.ps1')) { . "$AiSvcDir\venv\Scripts\Activate.ps1" }
`$env:PY_AI_PORT='$freePort'
python rt_asr_service.py
"@
  Write-Log "Starting Python AI RT service (ws://127.0.0.1:$freePort/stream) ..."
  $proc = Start-Process -FilePath 'powershell' -ArgumentList '-NoExit','-Command', $cmd -WorkingDirectory $AiSvcDir -PassThru
  Save-Pid -procId $proc.Id -file $AiSvcPidFile
  # 导出后端桥接 URL 到本 shell，供后续 Start-Backend 使用
  $global:PY_AI_SERVICE_URL = "ws://127.0.0.1:$freePort/stream"
  if (Wait-Port -Port $freePort -TimeoutSec 20) { Write-Log "AI RT service ready: ws://127.0.0.1:$freePort/stream" } else { Write-Log "Note: $freePort not open within timeout; it may still be starting." }
}

function Stop-All {
  foreach ($f in @($BackendPidFile,$FrontendPidFile,$AdminPidFile,$AiSvcPidFile)) {
    $procId = Read-Pid $f
    if ($null -ne $procId -and (Is-Process-Running $procId)) {
      Write-Log "Stopping PID=$procId ($f) ..."
      try { Stop-Process -Id $procId -Force -ErrorAction Stop; Write-Log "Stopped $procId" } catch { Write-Log "Stop failed: $procId ($_ )" }
    }
    if (Test-Path $f) { Remove-Item -Force $f }
  }
}

function Show-Status {
  $items = @(
    @{ Name='Backend';  File=$BackendPidFile;  Port=8000; Url='http://localhost:8000' },
    @{ Name='Frontend'; File=$FrontendPidFile; Port=5173; Url='http://localhost:5173/?api=http://localhost:8000' },
    @{ Name='Admin';    File=$AdminPidFile;    Port=3001; Url='http://localhost:3001' }
  )
  foreach ($it in $items) {
    $procId = Read-Pid $it.File
    $running = if ($procId) { Is-Process-Running $procId } else { $false }
    $portOpen = Wait-Port -Port $it.Port -TimeoutSec 1
    Write-Host ("{0,-9} PID={1,-6} Running={2,-5} Port{3}={4}  {5}" -f $it.Name, ($procId -as [string]), $running, $it.Port, $portOpen, $it.Url)
  }
}

# Main
Ensure-Dirs

switch ($action) {
  'start-backend'  { Start-Backend; if ($Open) { Start-Process 'http://localhost:8000' } }
  'start-frontend' { Start-Frontend; if ($Open) { Start-Process 'http://localhost:5173/?api=http://localhost:8000' } }
  'start-admin'    { Start-Admin;    if ($Open) { Start-Process 'http://localhost:3001' } }
  'stop-all'       { Stop-All }
  'status'         { Show-Status }
  'start-all'      {
    Start-AiService
    Start-Backend
    Start-Frontend
    Start-Admin
    if ($Open) {
      Start-Sleep -Seconds 1
      #Start-Process 'http://localhost:5173/?api=http://localhost:8000'  # 由 userscript 触发
      Start-Process 'http://localhost:3001'
    }
    Show-Status
  }
  default { Write-Host 'Usage: .\dev.ps1 [start-all|start-backend|start-frontend|start-admin|stop-all|status] [-Open]' }
}