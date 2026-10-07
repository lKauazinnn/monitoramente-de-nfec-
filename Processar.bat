@echo off
rem Arraste um ou mais .csv exportados do SSMS para cima deste arquivo
if "%~1"=="" (echo Arraste os arquivos .csv do SSMS para cima deste arquivo. & pause & exit /b)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Processar.ps1" %*
pause
