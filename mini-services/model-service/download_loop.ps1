# Uses $env:HF_TOKEN if set
while ($true) {
    Write-Host "Starting download attempt..."
    .\.venv\Scripts\python.exe cache_model.py
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Download complete!"
        break
    }
    Write-Host "Download failed or timed out. Restarting in 2 seconds..."
    Start-Sleep -Seconds 2
}
