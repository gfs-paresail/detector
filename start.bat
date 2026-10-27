@echo off
chcp 65001 > nul
title 감지기 생산현황 관리 시스템
echo [감지기 생산현황 관리 시스템] 로컬 서버를 구동합니다...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start_server.ps1"
if %errorlevel% neq 0 (
    echo 브라우저로 index.html 파일을 직접 실행합니다.
    start "" "%~dp0index.html"
)
pause
