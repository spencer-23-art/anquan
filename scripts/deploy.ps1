param(
  [string]$ServerHost = "8.137.13.118",
  [string]$ServerUser = "root",
  [string]$RemoteDir = "/www/wwwroot/anquan",
  [string]$Branch = "main",
  [switch]$SkipPush,
  [switch]$NoCache
)

$ErrorActionPreference = "Stop"

function Run-Step {
  param(
    [string]$Title,
    [scriptblock]$Command
  )

  Write-Host ""
  Write-Host "==> $Title" -ForegroundColor Cyan
  & $Command
}

function Require-Command {
  param([string]$Name)

  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Missing command: $Name"
  }
}

function Resolve-SshCommand {
  $pathCommand = Get-Command ssh -ErrorAction SilentlyContinue
  if ($pathCommand) {
    return $pathCommand.Source
  }

  $candidates = @(
    "C:\Program Files\Git\usr\bin\ssh.exe",
    "C:\Program Files\Git\bin\ssh.exe",
    "C:\Windows\System32\OpenSSH\ssh.exe"
  )

  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      return $candidate
    }
  }

  throw "Missing command: ssh. Please install Windows OpenSSH Client or Git for Windows."
}

Require-Command git
$sshCommand = Resolve-SshCommand

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repoRoot

Run-Step "Checking local git state" {
  $currentBranch = (git branch --show-current).Trim()
  if ($currentBranch -ne $Branch) {
    throw "Current branch is '$currentBranch', expected '$Branch'. Please switch branch first."
  }

  $dirty = git status --porcelain
  if ($dirty) {
    Write-Host "Local files have not been committed yet:" -ForegroundColor Yellow
    git status --short
    throw "Please commit your local changes before deployment, then run this script again."
  }

  git log --oneline -1
}

if (-not $SkipPush) {
  Run-Step "Pushing local code to GitHub" {
    git push origin $Branch
  }
}

$composeBuild = "docker compose build"
if ($NoCache) {
  $composeBuild = "docker compose build --no-cache"
}

$remoteScript = @"
set -e
cd "$RemoteDir"
mkdir -p /www/backup
if [ -f anquan-data-sync-2026-04-23.zip ]; then
  mv anquan-data-sync-2026-04-23.zip "/www/backup/anquan-data-sync-2026-04-23-\$(date +%Y%m%d%H%M%S).zip"
fi
git fetch origin "$Branch"
git checkout "$Branch"
git pull --ff-only origin "$Branch"
$composeBuild
docker compose up -d
docker compose ps
curl -fsS http://127.0.0.1:8000/api/health
echo
"@

Run-Step "Deploying on server $ServerUser@$ServerHost" {
  $remoteScript | & $sshCommand "$ServerUser@$ServerHost" "bash -s"
}

Write-Host ""
Write-Host "Deployment finished. Open: http://$ServerHost:8000" -ForegroundColor Green
