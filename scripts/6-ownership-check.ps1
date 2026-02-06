param(
	[string]$ApiUrl = "http://localhost:3000",
	[string]$Password = "tasksync",
	[string]$SpaceId = "s1",
	[string]$ListId = "goal-management",
	[string]$AssigneeEmail = "admin@example.com",
	[string]$CreatorEmail = "contrib@example.com"
)

$ErrorActionPreference = "Stop"

function Login {
	param(
		[string]$Email
	)
	$payload = @{
		email = $Email
		password = $Password
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

function StatusFromException {
	param($Exception)
	if ($Exception -and $Exception.Exception -and $Exception.Exception.Response -and $Exception.Exception.Response.StatusCode) {
		return [int]$Exception.Exception.Response.StatusCode
	}
	return -1
}

Write-Host "Logging in admin and contributor..."
$admin = Login -Email $AssigneeEmail
$contrib = Login -Email $CreatorEmail

Write-Host "Loading members..."
$members = Invoke-RestMethod -Method Get -Uri "$ApiUrl/auth/members" -Headers (JsonHeaders -Token $admin.token)
$assignee = $members | Where-Object { $_.email -eq $AssigneeEmail } | Select-Object -First 1
Assert ($null -ne $assignee) "Could not find assignee member '$AssigneeEmail'"

$taskTitle = "Ownership check $(Get-Date -Format 'yyyyMMdd-HHmmss')"
$createPayload = @{
	title = $taskTitle
	list_id = $ListId
	my_day = $true
	assignee_user_id = $assignee.user_id
} | ConvertTo-Json

Write-Host "Creating contributor-assigned task..."
$created = Invoke-RestMethod -Method Post -Uri "$ApiUrl/tasks" -Headers (JsonHeaders -Token $contrib.token) -Body $createPayload
Assert ($created.assignee_user_id -eq $assignee.user_id) "Task assignee_user_id mismatch"
Assert ($created.created_by_user_id -eq $contrib.user_id) "Task created_by_user_id mismatch"

Write-Host "Verifying contributor cannot edit task..."
$patchPayload = @{ title = "$taskTitle edited" } | ConvertTo-Json
$editBlocked = $false
try {
	$null = Invoke-RestMethod -Method Patch -Uri "$ApiUrl/tasks/$($created.id)" -Headers (JsonHeaders -Token $contrib.token) -Body $patchPayload
} catch {
	$status = StatusFromException -Exception $_
	if ($status -eq 403) {
		$editBlocked = $true
	} else {
		throw
	}
}
Assert $editBlocked "Contributor edit was not blocked with 403"

Write-Host "Verifying task visibility..."
$adminTasks = Invoke-RestMethod -Method Get -Uri "$ApiUrl/tasks" -Headers (JsonHeaders -Token $admin.token)
$contribTasks = Invoke-RestMethod -Method Get -Uri "$ApiUrl/tasks" -Headers (JsonHeaders -Token $contrib.token)
$adminSees = @($adminTasks | Where-Object { $_.id -eq $created.id }).Count -eq 1
$contribSees = @($contribTasks | Where-Object { $_.id -eq $created.id }).Count -eq 1
Assert $adminSees "Admin should see created task"
Assert $contribSees "Contributor should see created task they created"

Write-Host "OK: ownership/contributor flow passed"
$summary = @{
	task_id = $created.id
	title = $created.title
	assignee_user_id = $created.assignee_user_id
	created_by_user_id = $created.created_by_user_id
}
$summary | ConvertTo-Json -Depth 5
