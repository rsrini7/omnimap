@echo off
pwsh -NoLogo -ExecutionPolicy Bypass -File "%~dp0build.ps1" %*
