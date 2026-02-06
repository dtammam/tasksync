param(
	[string]$ApiUrl = "http://localhost:3000",
	[string]$Password = "tasksync",
	[string]$SpaceId = "s1",
	[string]$AdminEmail = "admin@example.com",
	[string]$ListId = "goal-management",
	[string]$NewMemberEmail = "",
	[string]$NewMemberDisplay = "Contributor Check",
	[string]$NewMemberPassword = "tasksync123"
)

$ErrorActionPreference = "Stop"

function Login {
	param(
		[string]$Email,
		[string]$PasswordValue
	)
	$payload = @{
		email = $Email
		password = $PasswordValue
		space_id = $SpaceId
	} | ConvertTo-Json
	return Invoke-RestMethod -Method Post -Uri "$ApiUrl/auth/login" -ContentType "application/json" -Body $payload
}

function JsonHeaders {
	param(
		[string]$Token
	)
	return @{
		Authorization = "Bearer $Token"
		"Content-Type" = "application/json"
	}
}

function Assert {
	param(
		[bool]$Condition,
		[string]$Message
	)
	if (-not $Condition) {
		throw "ASSERT FAILED: $Message"
	}
}

Write-Host "Logging in as admin..."
$admin = Login -Email $AdminEmail -PasswordValue $Password
$headers = JsonHeaders -Token $admin.token

Write-Host "Checking /auth/me role..."
$me = Invoke-RestMethod -Method Get -Uri "$ApiUrl/auth/me" -Headers $headers
Assert ($me.role -eq "admin") "Expected admin role, got '$($me.role)'"

$avatarIcon = "A1"
Write-Host "Updating admin profile icon via PATCH /auth/me..."
$profileBody = @{
	display = $me.display
	avatar_icon = $avatarIcon
} | ConvertTo-Json
$updated = Invoke-RestMethod -Method Patch -Uri "$ApiUrl/auth/me" -Headers $headers -Body $profileBody
Assert ($updated.avatar_icon -eq $avatarIcon) "Expected avatar_icon '$avatarIcon', got '$($updated.avatar_icon)'"

if (-not $NewMemberEmail.Trim()) {
	$stamp = Get-Date -Format "yyyyMMddHHmmss"
	$NewMemberEmail = "admin-check-$stamp@example.com"
}

Write-Host "Creating contributor via POST /auth/members..."
$memberBody = @{
	email = $NewMemberEmail
	display = $NewMemberDisplay
	role = "contributor"
	password = $NewMemberPassword
	avatar_icon = "C1"
} | ConvertTo-Json

$createdMember = $null
try {
	$createdMember = Invoke-RestMethod -Method Post -Uri "$ApiUrl/auth/members" -Headers $headers -Body $memberBody
} catch {
	if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 409) {
		Write-Host "Member already exists in this space, reusing..."
	} else {
		throw
	}
}

$members = Invoke-RestMethod -Method Get -Uri "$ApiUrl/auth/members" -Headers $headers
$targetMember = @($members | Where-Object { $_.email -eq $NewMemberEmail } | Select-Object -First 1)[0]
Assert ($null -ne $targetMember) "Member '$NewMemberEmail' not found after create/list"
Assert ($targetMember.role -eq "contributor") "Expected contributor role for '$NewMemberEmail'"

Write-Host "Granting list access via PUT /auth/grants..."
$grantBody = @{
	user_id = $targetMember.user_id
	list_id = $ListId
	granted = $true
} | ConvertTo-Json
$grant = Invoke-RestMethod -Method Put -Uri "$ApiUrl/auth/grants" -Headers $headers -Body $grantBody
Assert ($grant.user_id -eq $targetMember.user_id) "Grant response user mismatch"
Assert ($grant.list_id -eq $ListId) "Grant response list mismatch"

$grants = Invoke-RestMethod -Method Get -Uri "$ApiUrl/auth/grants" -Headers $headers
$hasGrant = @($grants | Where-Object { $_.user_id -eq $targetMember.user_id -and $_.list_id -eq $ListId }).Count -eq 1
Assert $hasGrant "Expected grant not found in /auth/grants"

Write-Host "Resetting contributor password via PATCH /auth/members/:id/password..."
$passwordBody = @{
	password = $NewMemberPassword
} | ConvertTo-Json
Invoke-RestMethod -Method Patch -Uri "$ApiUrl/auth/members/$($targetMember.user_id)/password" -Headers $headers -Body $passwordBody | Out-Null

Write-Host "Verifying contributor can log in with reset password..."
$memberSession = Login -Email $targetMember.email -PasswordValue $NewMemberPassword
Assert ($memberSession.role -eq "contributor") "Expected contributor role login for '$($targetMember.email)'"

Write-Host "OK: admin profile + member + grant + password reset APIs are healthy"
$summary = @{
	admin = @{
		email = $me.email
		role = $me.role
		avatar_icon = $updated.avatar_icon
	}
	member = @{
		email = $targetMember.email
		user_id = $targetMember.user_id
		role = $targetMember.role
	}
	grant = @{
		user_id = $grant.user_id
		list_id = $grant.list_id
	}
	member_login_verified = $true
}
$summary | ConvertTo-Json -Depth 5
