<#
Windows bootstrap script to verify Rust toolchain presence before starting Tauri dev.
This script checks for rustc and cargo in PATH, ensures an active toolchain, and optionally installs stable toolchain.
Usage: Run as part of Windows startup before `pnpm tauri dev`.
#>
$ErrorActionPreference = 'Stop'

function Get-ToolPath([string]$name) {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    return $cmd
}

Write-Host "[Rust Bootstrap] Checking for Rust toolchain on PATH..." -ForegroundColor Cyan

$rustc = Get-ToolPath "rustc"
$cargo = Get-ToolPath "cargo"

if (-not $rustc -or -not $cargo) {
    Write-Host "Rust toolchain not found on PATH." -ForegroundColor Yellow
    Write-Host "Please install Rust via https://rustup.rs and ensure PATH includes the cargo/bin directory." -ForegroundColor Yellow
    Write-Host "If you already installed Rust, please reopen the terminal to refresh PATH." -ForegroundColor Yellow
    exit 1
}

Write-Host "Rust tooling detected: $(rustc --version)" -ForegroundColor Green
Write-Host "Cargo tooling detected: $(cargo --version)" -ForegroundColor Green

try {
    $toolchain = rustup show active-toolchain 2>$null
    if (-not $toolchain) {
        Write-Host "No active Rust toolchain detected. Installing stable toolchain..." -ForegroundColor Yellow
        rustup install stable
        rustup default stable
        $toolchain = rustup show active-toolchain
    } else {
        Write-Host "Active toolchain: $toolchain" -ForegroundColor Green
    }
} catch {
    Write-Host "Warning: rustup not found or rustup encountered an error. Attempting to use stable toolchain may fail if rustup is missing." -ForegroundColor Yellow
}

Write-Host "Rust bootstrap completed. Proceeding to start Tauri dev..." -ForegroundColor Cyan
exit 0
