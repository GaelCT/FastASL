<#
.SYNOPSIS
  H-13 SID-based Windows ACL validator. Uses scripts/permission-policy.json.
#>
[CmdletBinding()]
param([string]$Root = (Split-Path -Parent $PSScriptRoot), [switch]$SelfTest)
$ErrorActionPreference = 'Stop'
$Policy = Get-Content (Join-Path $PSScriptRoot 'permission-policy.json') -Raw | ConvertFrom-Json
$BroadSids = @('S-1-1-0', 'S-1-5-11', 'S-1-5-32-545')
$WriteRights = [System.Security.AccessControl.FileSystemRights]::Write -bor
    [System.Security.AccessControl.FileSystemRights]::WriteData -bor
    [System.Security.AccessControl.FileSystemRights]::AppendData -bor
    [System.Security.AccessControl.FileSystemRights]::CreateFiles -bor
    [System.Security.AccessControl.FileSystemRights]::CreateDirectories -bor
    [System.Security.AccessControl.FileSystemRights]::Modify -bor
    [System.Security.AccessControl.FileSystemRights]::Delete -bor
    [System.Security.AccessControl.FileSystemRights]::ChangePermissions -bor
    [System.Security.AccessControl.FileSystemRights]::TakeOwnership -bor
    [System.Security.AccessControl.FileSystemRights]::FullControl
$ReadRights = [System.Security.AccessControl.FileSystemRights]::Read -bor
    [System.Security.AccessControl.FileSystemRights]::ReadData -bor
    [System.Security.AccessControl.FileSystemRights]::ReadAttributes -bor
    [System.Security.AccessControl.FileSystemRights]::ReadExtendedAttributes -bor
    [System.Security.AccessControl.FileSystemRights]::FullControl

function Get-Sid([System.Security.AccessControl.FileSystemAccessRule]$Rule) {
    return $Rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
}
function Add-Failure([System.Collections.Generic.List[string]]$Failures, [string]$Path, $Rule, [string]$Reason) {
    $inherited = if ($Rule.IsInherited) { 'inherited' } else { 'explicit' }
    $Failures.Add("FAIL: $Path; SID=$(Get-Sid $Rule); $($Rule.AccessControlType); $inherited; rights=$($Rule.FileSystemRights); $Reason")
}
function Test-AclPath([string]$Path, [bool]$Secret, [System.Collections.Generic.List[string]]$Failures) {
    try { $acl = Get-Acl -LiteralPath $Path } catch { $Failures.Add("FAIL: $Path; cannot read ACL: $($_.Exception.Message)"); return }
    $rules = $acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])
    foreach ($rule in $rules) {
        $sid = $rule.IdentityReference.Value
        if ($sid -notin $BroadSids) { continue }
        if ($rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow) { continue }
        if (($rule.FileSystemRights -band $WriteRights) -ne 0) { Add-Failure $Failures $Path $rule 'broad Allow grants write-class access'; continue }
        if ($Secret -and (($rule.FileSystemRights -band $ReadRights) -ne 0)) { Add-Failure $Failures $Path $rule 'broad Allow grants secret read access' }
    }
}
function Test-Policy([string]$Base) {
    $failures = [System.Collections.Generic.List[string]]::new()
    foreach ($relative in $Policy.source_roots) {
        $path = Join-Path $Base $relative
        if (Test-Path -LiteralPath $path) {
            Test-AclPath $path $false $failures
            Get-ChildItem -LiteralPath $path -Force -Recurse | ForEach-Object { Test-AclPath $_.FullName $false $failures }
        }
    }
    foreach ($relative in $Policy.source_root_files) { $path = Join-Path $Base $relative; if (Test-Path -LiteralPath $path) { Test-AclPath $path $false $failures } }
    foreach ($relative in $Policy.secret_files) { $path = Join-Path $Base $relative; if (Test-Path -LiteralPath $path) { Test-AclPath $path $true $failures } }
    $runtime = Join-Path $Base $Policy.runtime_root
    if (Test-Path -LiteralPath $runtime) { Test-AclPath $runtime $false $failures; Get-ChildItem -LiteralPath $runtime -Force -Recurse | ForEach-Object { Test-AclPath $_.FullName $false $failures } }
    return $failures
}
function Add-Rule([string]$Path, [string]$Sid, [System.Security.AccessControl.FileSystemRights]$Rights, [System.Security.AccessControl.AccessControlType]$Type) {
    $acl = Get-Acl -LiteralPath $Path
    $rule = [System.Security.AccessControl.FileSystemAccessRule]::new([System.Security.Principal.SecurityIdentifier]::new($Sid), $Rights, $Type)
    [void]$acl.AddAccessRule($rule)
    Set-Acl -LiteralPath $Path -AclObject $acl
}
function Invoke-SelfTest {
    $temp = Join-Path ([IO.Path]::GetTempPath()) ("fastasl-acl-" + [guid]::NewGuid())
    try {
        New-Item -ItemType Directory -Path "$temp\backend\nested", "$temp\var\cache" -Force | Out-Null
        Set-Content -LiteralPath "$temp\.env" -Value 'SECRET=x'
        $safe = Test-Policy $temp
        if ($safe.Count -ne 0) { throw "safe ACL fixture failed: $($safe -join '; ')" }
        Add-Rule "$temp\backend\nested" 'S-1-1-0' ([System.Security.AccessControl.FileSystemRights]::Write) ([System.Security.AccessControl.AccessControlType]::Allow)
        if ((Test-Policy $temp).Count -eq 0) { throw 'Everyone Allow Write did not fail' }
        $acl = Get-Acl -LiteralPath "$temp\backend\nested"; foreach ($rule in @($acl.Access | Where-Object { $_.AccessControlType -eq 'Allow' -and (Get-Sid $_) -eq 'S-1-1-0' })) { [void]$acl.RemoveAccessRule($rule) }; Set-Acl "$temp\backend\nested" $acl
        Add-Rule "$temp\.env" 'S-1-5-11' ([System.Security.AccessControl.FileSystemRights]::Read) ([System.Security.AccessControl.AccessControlType]::Allow)
        if ((Test-Policy $temp).Count -eq 0) { throw 'Authenticated Users secret read did not fail' }
        Write-Host 'OK: Windows SID ACL fixtures passed.' -ForegroundColor Green
    } finally { if (Test-Path $temp) { Remove-Item -LiteralPath $temp -Recurse -Force } }
}
if ($SelfTest) { Invoke-SelfTest; exit 0 }
$Result = Test-Policy (Resolve-Path $Root)
if ($Result.Count -gt 0) { $Result | ForEach-Object { Write-Error $_ }; exit 1 }
Write-Host 'OK: Windows ACL permissions are safe.' -ForegroundColor Green