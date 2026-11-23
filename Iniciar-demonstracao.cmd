@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -Command ^
  "$ErrorActionPreference = 'Stop'; $demoUrl = 'http://127.0.0.1:8088';" ^
  "function DemoReady { try { return (Invoke-RestMethod -Uri ($demoUrl + '/api/session') -TimeoutSec 1).demo -eq $true } catch { return $false } }" ^
  "if (!(DemoReady)) {" ^
  "  $nodeApp = (Get-Command node.exe -ErrorAction SilentlyContinue).Source;" ^
  "  if (!$nodeApp) { $runtime = Get-AppxPackage -Name 'OpenAI.CodexPrimaryRuntime*' | Sort-Object Version -Descending | Select-Object -First 1; if ($runtime) { $nodeApp = Join-Path $runtime.InstallLocation 'dependencies/node/bin/node.exe' } }" ^
  "  if (!$nodeApp -or !(Test-Path -LiteralPath $nodeApp)) { throw 'Instale Node.js 22 ou mais recente para abrir a demonstracao.' }" ^
  "  $env:TABELA_HOST = '127.0.0.1'; $env:TABELA_PORT = '8088';" ^
  "  $demo = Start-Process -FilePath $nodeApp -ArgumentList @('server.mjs', '--demo') -WorkingDirectory (Get-Location).Path -WindowStyle Hidden -PassThru;" ^
  "  $deadline = (Get-Date).AddSeconds(8);" ^
  "  while (!(DemoReady)) { if ($demo.HasExited -or (Get-Date) -ge $deadline) { throw 'A demonstracao nao iniciou. Confira se a porta 8088 esta ocupada e se o Node.js e versao 22 ou mais recente.' }; Start-Sleep -Milliseconds 250 }" ^
  "}" ^
  "Write-Host ('Demonstracao pronta em ' + $demoUrl);" ^
  "if (!$env:TABELA_DEMO_NO_BROWSER) { Start-Process -FilePath $demoUrl }"
if errorlevel 1 (
  pause
  exit /b 1
)
