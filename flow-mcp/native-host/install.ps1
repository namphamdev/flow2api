# Installs the flow-mcp Native Messaging host manifest for Chrome and/or
# Microsoft Edge on Windows.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File install.ps1 -ExtensionId <id>
#   powershell -ExecutionPolicy Bypass -File install.ps1 -ExtensionId <id> -Browser Edge
#   powershell -ExecutionPolicy Bypass -File install.ps1 -ExtensionId <id> -Browser Both
#
# After loading the unpacked extension at edge://extensions or chrome://extensions,
# copy its ID and pass it via -ExtensionId.

param(
  [Parameter(Mandatory = $true)][string]$ExtensionId,
  [ValidateSet("Chrome", "Edge", "Both")][string]$Browser = "Chrome",
  [string]$NodePath = ""
)

$ErrorActionPreference = "Stop"

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$hostJs = Join-Path $here "host.js"

if (-not (Test-Path $hostJs)) {
  throw "host.js not found at $hostJs"
}

if ([string]::IsNullOrWhiteSpace($NodePath)) {
  $node = (Get-Command node -ErrorAction SilentlyContinue)
  if (-not $node) { throw "node.exe not found in PATH; pass -NodePath C:\path\to\node.exe" }
  $NodePath = $node.Source
}

# Both Chrome and Edge use chrome-extension:// origins. The extension ID is
# whatever the browser shows on the extensions page.
$allowedOrigin = "chrome-extension://$ExtensionId/"

# Launcher .bat (browsers exec the manifest "path" directly; node needs a wrapper)
$launcher = Join-Path $here "flow-mcp-host.bat"
@"
@echo off
"$NodePath" "$hostJs" %*
"@ | Set-Content -Encoding ASCII -Path $launcher

$manifest = @{
  name             = "com.flow_mcp.host"
  description      = "flow-mcp Native Messaging host"
  path             = $launcher
  type             = "stdio"
  allowed_origins  = @($allowedOrigin)
} | ConvertTo-Json -Depth 4

$manifestPath = Join-Path $here "com.flow_mcp.host.json"
$manifest | Set-Content -Encoding UTF8 -Path $manifestPath

function Register-NativeHost($name, $regBase) {
  $regKey = "$regBase\NativeMessagingHosts\com.flow_mcp.host"
  New-Item -Path $regKey -Force | Out-Null
  Set-ItemProperty -Path $regKey -Name "(default)" -Value $manifestPath
  Write-Host "  [$name] $regKey"
}

Write-Host "Installed Native Messaging host:"
Write-Host "  manifest : $manifestPath"
Write-Host "  launcher : $launcher"
Write-Host "  ext id   : $ExtensionId"
Write-Host "  browsers :"

if ($Browser -eq "Chrome" -or $Browser -eq "Both") {
  Register-NativeHost "Chrome" "HKCU:\Software\Google\Chrome"
}
if ($Browser -eq "Edge" -or $Browser -eq "Both") {
  Register-NativeHost "Edge" "HKCU:\Software\Microsoft\Edge"
}

Write-Host "Restart the browser (or just reload the extension) to pick up changes."
