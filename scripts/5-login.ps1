param(
	[string]$ApiUrl = "http://localhost:3000",
	[string]$Email = "admin@example.com",
	[string]$Password = "tasksync",
	[string]$SpaceId = "s1"
)

$payload = @{
	email = $Email
	password = $Password
	space_id = $SpaceId
} | ConvertTo-Json

$response = Invoke-RestMethod -Method Post -Uri "$ApiUrl/auth/login" -ContentType "application/json" -Body $payload
$response | ConvertTo-Json -Depth 5
