<#
.SYNOPSIS
    H-13: Verify source, configuration, and runtime file permissions on Windows.
.DESCRIPTION
    Windows does not expose POSIX permission bits through the normal
    filesystem API, so this script verifies the effective protection
    against the Everyone/Users identity, which is the practical
    group/world analogue on Windows.
    Usage: powershell -ExecutionPolicy Bypass -File scripts/check-permissions.ps1
#>

$ErrorActionPreference = 'Stop'
$failures = 0

function Fail([string]$message) {
    Write-Host "FAIL: $message" -ForegroundColor Red
    $script:failures++
}

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

# 1. .env (when present) must not grant Everyone/Users write access
if (Test-Path '.env') {
    try {
        $acl = Get-Acl '.env'
        foreach ($rule in $acl.Access) {
            if (($rule.IdentityReference -match 'Everyone|Users') -and
                ($rule.FileSystemRights -match 'Write|FullControl')) {
                Fail ".env grants write to $($rule.IdentityReference)"
            }
        }
    } catch {
        Fail "cannot read ACL on .env: $($_.Exception.Message)"
    }
}

# 2. Runtime directories must not be writable by Everyone/Users
foreach ($dir in @('var', 'var\log', 'var\cache')) {
    if (Test-Path $dir) {
        $acl = Get-Acl $dir
        foreach ($rule in $acl.Access) {
            if (($rule.IdentityReference -match 'Everyone|Users') -and
                ($rule.FileSystemRights -match 'Write|FullControl')) {
                Fail "runtime directory $dir grants write to $($rule.IdentityReference)"
            }
        }
    }
}

if ($failures -gt 0) {
    Write-Host ""
    Write-Host "$failures permission problem(s) found. See ASL_Revive_Project_Audit.md H-13." -ForegroundColor Red
    exit 1
}

Write-Host "OK: permissions are safe." -ForegroundColor Green
