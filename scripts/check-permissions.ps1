<#
.SYNOPSIS
  H-13 SID-based Windows ACL validator. Uses scripts/permission-policy.json.
#>
[CmdletBinding()]
param([string]$Root = (Split-Path -Parent $PSScriptRoot), [switch]$SelfTest)
$ErrorActionPreference = 'Stop'
$Policy = Get-Content (Join-Path $PSScriptRoot 'permission-policy.json') -Raw | ConvertFrom-Json
$BroadSids = @('S-1-1-0', 'S-1-5-11', 'S-1-5-32-545')
$WriteRights = @(
    [System.Security.AccessControl.FileSystemRights]::Write,
    [System.Security.AccessControl.FileSystemRights]::WriteData,
    [System.Security.AccessControl.FileSystemRights]::AppendData,
    [System.Security.AccessControl.FileSystemRights]::CreateFiles,
    [System.Security.AccessControl.FileSystemRights]::CreateDirectories,
    [System.Security.AccessControl.FileSystemRights]::Modify,
    [System.Security.AccessControl.FileSystemRights]::Delete,
    [System.Security.AccessControl.FileSystemRights]::ChangePermissions,
    [System.Security.AccessControl.FileSystemRights]::TakeOwnership,
    [System.Security.AccessControl.FileSystemRights]::FullControl
)
$ReadRights = @(
    [System.Security.AccessControl.FileSystemRights]::Read,
    [System.Security.AccessControl.FileSystemRights]::ReadData,
    [System.Security.AccessControl.FileSystemRights]::ReadAttributes,
    [System.Security.AccessControl.FileSystemRights]::ReadExtendedAttributes,
    [System.Security.AccessControl.FileSystemRights]::FullControl
)

function Test-AnyRights($Granted, $Candidates) {
    foreach ($candidate in $Candidates) {
        if (($Granted -band $candidate) -eq $candidate) { return $true }
    }
    return $false
}
function Get-Sid([System.Security.AccessControl.FileSystemAccessRule]$Rule) {
    return $Rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
}
function Add-Failure([System.Collections.Generic.List[string]]$Failures, [string]$Path, $Rule, [string]$Reason) {
    $classification = if ($Rule.IsInherited) { 'inherited' } else { 'explicit' }
    $Failures.Add("FAIL: $Path; SID=$(Get-Sid $Rule); $($Rule.AccessControlType); $classification; rights=$($Rule.FileSystemRights); $Reason")
}
function Test-AclPath([string]$Path, [bool]$Secret, [System.Collections.Generic.List[string]]$Failures) {
    try { $acl = Get-Acl -LiteralPath $Path } catch { $Failures.Add("FAIL: $Path; cannot read ACL: $($_.Exception.Message)"); return }
    foreach ($rule in $acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])) {
        $sid = $rule.IdentityReference.Value
        if ($sid -notin $BroadSids) { continue }
        if ($rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow) { continue }
        if (Test-AnyRights $rule.FileSystemRights $WriteRights) { Add-Failure $Failures $Path $rule 'broad Allow grants write-class access'; continue }
        if ($Secret -and (Test-AnyRights $rule.FileSystemRights $ReadRights)) { Add-Failure $Failures $Path $rule 'broad Allow grants secret read access' }
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
    foreach ($relative in $Policy.source_root_files) {
        $path = Join-Path $Base $relative
        if (Test-Path -LiteralPath $path) { Test-AclPath $path $false $failures }
    }
    foreach ($relative in $Policy.secret_files) {
        $path = Join-Path $Base $relative
        if (Test-Path -LiteralPath $path) { Test-AclPath $path $true $failures }
    }
    $runtime = Join-Path $Base $Policy.runtime_root
    if (Test-Path -LiteralPath $runtime) {
        Test-AclPath $runtime $false $failures
        Get-ChildItem -LiteralPath $runtime -Force -Recurse | ForEach-Object { Test-AclPath $_.FullName $false $failures }
    }
    return $failures
}
function Add-Rule([string]$Path, [string]$Sid, [System.Security.AccessControl.FileSystemRights]$Rights, [System.Security.AccessControl.AccessControlType]$Type, [bool]$Inherit = $false) {
    $acl = Get-Acl -LiteralPath $Path
    $inheritance = if ($Inherit) { [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit' } else { [System.Security.AccessControl.InheritanceFlags]::None }
    $rule = [System.Security.AccessControl.FileSystemAccessRule]::new([System.Security.Principal.SecurityIdentifier]::new($Sid), $Rights, $inheritance, [System.Security.AccessControl.PropagationFlags]::None, $Type)
    [void]$acl.AddAccessRule($rule)
    Set-Acl -LiteralPath $Path -AclObject $acl
}
function New-Fixture {
    $root = Join-Path ([IO.Path]::GetTempPath()) ('fastasl-acl-' + [guid]::NewGuid())
    New-Item -ItemType Directory -Path "$root\backend\nested", "$root\var\cache" -Force | Out-Null
    Set-Content -LiteralPath "$root\backend\nested\safe.txt" -Value 'safe'
    Set-Content -LiteralPath "$root\var\cache\safe.txt" -Value 'safe'
    Set-Content -LiteralPath "$root\.env" -Value 'SECRET=x'

    return $root
}
function Remove-Fixture([string]$RootPath) {
    if (Test-Path -LiteralPath $RootPath) {
        $currentName = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
        & icacls.exe $RootPath /reset /T /C /Q | Out-Null
        & icacls.exe $RootPath /grant "${currentName}:(OI)(CI)F" /T /C /Q | Out-Null
        Remove-Item -LiteralPath $RootPath -Recurse -Force
    }
}
function Assert-Exposure($Failures, [string]$PathFragment, [string]$Sid, [string]$Rights, [string]$Classification) {
    $match = @($Failures | Where-Object { $_ -like "*$PathFragment*" -and $_ -like "*SID=$Sid*" -and $_ -like '*Allow*' -and $_ -like "*$Classification*" -and $_ -like "*rights=*$Rights*" })
    if ($match.Count -eq 0) { throw "Expected $PathFragment / $Sid / Allow / $Classification / $Rights. Got: $($Failures -join ' | ')" }
}
function Invoke-Case([string]$Name, [scriptblock]$Body) {
    $fixture = New-Fixture
    try { & $Body $fixture } catch { throw "$Name failed: $($_.Exception.Message)" } finally { Remove-Fixture $fixture }
}
function Invoke-SelfTest {
    Invoke-Case 'safe source ACL' {
        param($root)
        $failures = Test-Policy $root
        if ($failures.Count -ne 0) { throw "safe fixture failed: $($failures -join ' | ')" }
    }
    Invoke-Case 'Everyone Allow Write' {
        param($root)
        $path = "$root\backend\nested"; Add-Rule $path 'S-1-1-0' ([System.Security.AccessControl.FileSystemRights]::Write) ([System.Security.AccessControl.AccessControlType]::Allow)
        Assert-Exposure (Test-Policy $root) 'backend' 'S-1-1-0' 'Write' 'explicit'
    }
    Invoke-Case 'BUILTIN Users Allow Modify' {
        param($root)
        $path = "$root\backend\nested"; Add-Rule $path 'S-1-5-32-545' ([System.Security.AccessControl.FileSystemRights]::Modify) ([System.Security.AccessControl.AccessControlType]::Allow)
        Assert-Exposure (Test-Policy $root) 'backend' 'S-1-5-32-545' 'Modify' 'explicit'
    }
    Invoke-Case 'Authenticated Users Allow FullControl' {
        param($root)
        $path = "$root\backend\nested"; Add-Rule $path 'S-1-5-11' ([System.Security.AccessControl.FileSystemRights]::FullControl) ([System.Security.AccessControl.AccessControlType]::Allow)
        Assert-Exposure (Test-Policy $root) 'backend' 'S-1-5-11' 'FullControl' 'explicit'
    }
    Invoke-Case 'Deny Write has no broad Allow' {
        param($root)
        Add-Rule "$root\backend\nested" 'S-1-1-0' ([System.Security.AccessControl.FileSystemRights]::Write) ([System.Security.AccessControl.AccessControlType]::Deny)
        $failures = Test-Policy $root
        if ($failures.Count -ne 0) { throw "Deny-only fixture was treated as exposure: $($failures -join ' | ')" }
    }
    Invoke-Case 'broad secret Read' {
        param($root)
        Add-Rule "$root\.env" 'S-1-5-11' ([System.Security.AccessControl.FileSystemRights]::Read) ([System.Security.AccessControl.AccessControlType]::Allow)
        Assert-Exposure (Test-Policy $root) '.env' 'S-1-5-11' 'Read' 'explicit'
    }
    Invoke-Case 'broad secret Write' {
        param($root)
        Add-Rule "$root\.env" 'S-1-1-0' ([System.Security.AccessControl.FileSystemRights]::Write) ([System.Security.AccessControl.AccessControlType]::Allow)
        Assert-Exposure (Test-Policy $root) '.env' 'S-1-1-0' 'Write' 'explicit'
    }
    Invoke-Case 'inherited Everyone Allow Write' {
        param($root)
        $parent = "$root\backend\inherited-parent"; New-Item -ItemType Directory -Path $parent | Out-Null
        Add-Rule $parent 'S-1-1-0' ([System.Security.AccessControl.FileSystemRights]::Write) ([System.Security.AccessControl.AccessControlType]::Allow) $true
        $child = "$parent\child.txt"; Set-Content -LiteralPath $child -Value 'child'
        $inherited = @((Get-Acl -LiteralPath $child).Access | Where-Object { (Get-Sid $_) -eq 'S-1-1-0' -and $_.AccessControlType -eq 'Allow' -and $_.IsInherited })
        if ($inherited.Count -eq 0) { throw 'child did not receive inherited Everyone Allow ACE' }
        Assert-Exposure (Test-Policy $root) 'child.txt' 'S-1-1-0' 'Write' 'inherited'
    }
    Invoke-Case 'unsafe nested source directory' {
        param($root)
        Add-Rule "$root\backend\nested" 'S-1-1-0' ([System.Security.AccessControl.FileSystemRights]::Write) ([System.Security.AccessControl.AccessControlType]::Allow)
        Assert-Exposure (Test-Policy $root) 'backend\nested' 'S-1-1-0' 'Write' 'explicit'
    }
    Invoke-Case 'unsafe nested source file' {
        param($root)
        Add-Rule "$root\backend\nested\safe.txt" 'S-1-1-0' ([System.Security.AccessControl.FileSystemRights]::Write) ([System.Security.AccessControl.AccessControlType]::Allow)
        Assert-Exposure (Test-Policy $root) 'safe.txt' 'S-1-1-0' 'Write' 'explicit'
    }
    Invoke-Case 'unsafe nested runtime directory' {
        param($root)
        $path = "$root\var\cache\unsafe"; New-Item -ItemType Directory -Path $path | Out-Null
        Add-Rule $path 'S-1-5-32-545' ([System.Security.AccessControl.FileSystemRights]::Modify) ([System.Security.AccessControl.AccessControlType]::Allow)
        Assert-Exposure (Test-Policy $root) 'var\cache\unsafe' 'S-1-5-32-545' 'Modify' 'explicit'
    }
    Invoke-Case 'unsafe nested runtime file' {
        param($root)
        $path = "$root\var\cache\unsafe.txt"; Set-Content -LiteralPath $path -Value 'unsafe'
        Add-Rule $path 'S-1-5-11' ([System.Security.AccessControl.FileSystemRights]::Write) ([System.Security.AccessControl.AccessControlType]::Allow)
        Assert-Exposure (Test-Policy $root) 'unsafe.txt' 'S-1-5-11' 'Write' 'explicit'
    }
    Write-Host 'OK: Windows SID ACL regression fixtures passed.' -ForegroundColor Green
}
if ($SelfTest) { Invoke-SelfTest; exit 0 }
$Result = Test-Policy (Resolve-Path $Root)
if ($Result.Count -gt 0) { $Result | ForEach-Object { Write-Error $_ }; exit 1 }
Write-Host 'OK: Windows ACL permissions are safe.' -ForegroundColor Green
