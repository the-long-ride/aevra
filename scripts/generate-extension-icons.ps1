Add-Type -AssemblyName System.Drawing

$srcPath = "assets/aevra-logo.png"
$outDir = "apps/extension/icons"
if (-not (Test-Path $outDir)) {
    New-Item -ItemType Directory -Path $outDir -Force | Out-Null
}

$sizes = @(16, 32, 48, 128)
$srcImage = [System.Drawing.Image]::FromFile((Resolve-Path $srcPath).Path)

foreach ($size in $sizes) {
    $destBitmap = New-Object System.Drawing.Bitmap($size, $size)
    $graphics = [System.Drawing.Graphics]::FromImage($destBitmap)
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.Clear([System.Drawing.Color]::Transparent)

    $rect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
    $graphics.DrawImage($srcImage, $rect)
    $graphics.Dispose()

    $destPath = Join-Path $outDir ("icon-$size.png")
    $destBitmap.Save($destPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $destBitmap.Dispose()
    Write-Host "Generated $destPath"
}

$srcImage.Dispose()
