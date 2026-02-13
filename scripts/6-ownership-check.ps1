param(
	[string]$ApiUrl = "http://localhost:3000",
	[string]$Password = "tasksync",
	[string]$AssigneePassword = "",
	[string]$CreatorPassword = "",
	[string]$SpaceId = "s1",
	[string]$ListId = "goal-management",
	[string]$AssigneeEmail = "admin@example.com",
	[string]$CreatorEmail = "contrib@example.com"
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

Write-Host "Logging in admin and contributor..."
$resolvedAssigneePassword = if ($AssigneePassword.Trim()) { $AssigneePassword } else { $Password }
$resolvedCreatorPassword = if ($CreatorPassword.Trim()) { $CreatorPassword } else { $Password }
$admin = Login -Email $AssigneeEmail -PasswordValue $resolvedAssigneePassword
$contrib = Login -Email $CreatorEmail -PasswordValue $resolvedCreatorPassword

Write-Host "Loading members..."
$members = Invoke-RestMethod -Method Get -Uri "$ApiUrl/auth/members" -Headers (JsonHeaders -Token $admin.token)
$assignee = $members | Where-Object { $_.email -eq $AssigneeEmail } | Select-Object -First 1
Assert ($null -ne $assignee) "Could not find assignee member '$AssigneeEmail'"

$taskTitle = "Ownership check $(Get-Date -Format 'yyyyMMdd-HHmmss')"
$adminVisibleTitle = "Admin baseline $(Get-Date -Format 'yyyyMMdd-HHmmss')"
$adminCreatePayload = @{
	title = $adminVisibleTitle
	list_id = $ListId
	my_day = $false
	assignee_user_id = $assignee.user_id
} | ConvertTo-Json

Write-Host "Creating admin baseline task for contributor-read check..."
$adminCreated = Invoke-RestMethod -Method Post -Uri "$ApiUrl/tasks" -Headers (JsonHeaders -Token $admin.token) -Body $adminCreatePayload
Assert ($adminCreated.created_by_user_id -eq $admin.user_id) "Admin baseline task should be created by admin"

$createPayload = @{
	title = $taskTitle
	list_id = $ListId
	my_day = $true
	assignee_user_id = $assignee.user_id
} | ConvertTo-Json

Write-Host "Creating contributor-assigned task..."
$created = Invoke-RestMethod -Method Post -Uri "$ApiUrl/tasks" -Headers (JsonHeaders -Token $contrib.token) -Body $createPayload
Assert ($created.assignee_user_id -eq $contrib.user_id) "Task assignee_user_id should be creator user id"
Assert ($created.created_by_user_id -eq $contrib.user_id) "Task created_by_user_id mismatch"

Write-Host "Verifying contributor can edit owned task..."
$patchPayload = @{ title = "$taskTitle edited" } | ConvertTo-Json
$edited = Invoke-RestMethod -Method Patch -Uri "$ApiUrl/tasks/$($created.id)" -Headers (JsonHeaders -Token $contrib.token) -Body $patchPayload
Assert ($edited.title -eq "$taskTitle edited") "Contributor owned-task edit did not persist"

Write-Host "Verifying task visibility..."
$adminTasks = Invoke-RestMethod -Method Get -Uri "$ApiUrl/tasks" -Headers (JsonHeaders -Token $admin.token)
$contribTasks = Invoke-RestMethod -Method Get -Uri "$ApiUrl/tasks" -Headers (JsonHeaders -Token $contrib.token)
$adminSees = @($adminTasks | Where-Object { $_.id -eq $created.id }).Count -eq 1
$contribSees = @($contribTasks | Where-Object { $_.id -eq $created.id }).Count -eq 1
$contribSeesAdminTask = @($contribTasks | Where-Object { $_.id -eq $adminCreated.id }).Count -eq 1
Assert $adminSees "Admin should see created task"
Assert $contribSees "Contributor should see created task they created"
Assert $contribSeesAdminTask "Contributor should see admin task in granted list"

Write-Host "OK: ownership/contributor flow passed"
$summary = @{
	task_id = $created.id
	title = $created.title
	assignee_user_id = $created.assignee_user_id
	created_by_user_id = $created.created_by_user_id
}
$summary | ConvertTo-Json -Depth 5
