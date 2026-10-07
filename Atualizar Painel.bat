@echo off
rem Refaz os dados do painel a partir dos XMLs que ja estao na pasta XMLs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Processar.ps1" -SoPainel
pause
