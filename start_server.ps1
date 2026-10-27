# 감지기 생산현황 관리 시스템 - 초경량 로컬 웹 서버 (Windows 내장 PowerShell 기반)
$port = 8080
$url = "http://localhost:$port/"
$folder = $PSScriptRoot

if (-not $folder) {
    $folder = Get-Location
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($url)

try {
    $listener.Start()
} catch {
    Write-Host "포트 $port 가 이미 사용 중이거나 권한이 필요할 수 있습니다. 브라우저로 직접 index.html 파일을 엽니다..." -ForegroundColor Yellow
    Start-Process "$folder\index.html"
    exit
}

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " [감지기 생산현황 관리 시스템] 로컬 서버가 시작되었습니다." -ForegroundColor Green
Write-Host " 로컬 주소: $url" -ForegroundColor White
Write-Host " 서버를 종료하려면 이 창에서 Ctrl + C를 누르세요." -ForegroundColor Gray
Write-Host "==========================================================" -ForegroundColor Cyan

# 기본 브라우저 자동 실행
Start-Process $url

while ($listener.IsListening) {
    try {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response

        $path = $request.Url.LocalPath
        if ($path -eq "/" -or $path -eq "") {
            $path = "/index.html"
        }

        $localPath = Join-Path $folder ($path.TrimStart('/').Replace('/', '\'))

        if (Test-Path $localPath -PathType Leaf) {
            $bytes = [System.IO.File]::ReadAllBytes($localPath)
            
            $ext = [System.IO.Path]::GetExtension($localPath).ToLower()
            switch ($ext) {
                ".html" { $response.ContentType = "text/html; charset=utf-8" }
                ".css"  { $response.ContentType = "text/css; charset=utf-8" }
                ".js"   { $response.ContentType = "application/javascript; charset=utf-8" }
                ".json" { $response.ContentType = "application/json; charset=utf-8" }
                ".csv"  { $response.ContentType = "text/csv; charset=utf-8" }
                default { $response.ContentType = "application/octet-stream" }
            }

            $response.ContentLength64 = $bytes.Length
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
            $response.StatusCode = 404
            $msg = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found")
            $response.OutputStream.Write($msg, 0, $msg.Length)
        }
        $response.OutputStream.Close()
    } catch {
        # 연결 종료 시 예외 무시
    }
}
