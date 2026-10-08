#requires -Version 7.2
$ErrorActionPreference = 'Stop'
# Fixed official snapshot; no token, remote code or changes to the WD environment.
$repository = 'google/embeddinggemma-2'
$revision = '914f7f89142e33e77833254d9c9b90c3cef7303b'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$destination = Join-Path $workspace 'models\embeddinggemma-2'
$expectedNames = @('.gitattributes', '1_Pooling/config.json', '2_Normalize/config.json', 'README.md',
  'chat_template.jinja', 'config.json', 'config_sentence_transformers.json', 'model.safetensors',
  'modules.json', 'preprocessor_config.json', 'processor_config.json', 'sentence_bert_config.json',
  'tokenizer.json', 'tokenizer.model', 'tokenizer_config.json')
$metadata = Invoke-RestMethod "https://huggingface.co/api/models/$repository/revision/${revision}?blobs=true" -TimeoutSec 30
if ($metadata.sha -ne $revision -or $metadata.gated) { throw 'Official snapshot identity or access differs; download stopped.' }
if (Compare-Object ($expectedNames | Sort-Object) ($metadata.siblings.rfilename | Sort-Object)) { throw 'Snapshot file list differs; review before downloading.' }
New-Item -ItemType Directory -Path $destination -Force | Out-Null
$records = @()
foreach ($entry in ($metadata.siblings | Sort-Object size)) {
  $relativeName = $entry.rfilename
  $filePath = [IO.Path]::GetFullPath((Join-Path $destination $relativeName))
  if (-not $filePath.StartsWith($destination + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe model path.' }
  New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($filePath)) -Force | Out-Null
  $partialPath = "$filePath.part"
  $downloadPath = if (Test-Path -LiteralPath $filePath) { $filePath } else { $partialPath }
  if ($downloadPath -eq $partialPath) {
    Write-Output "Downloading $relativeName ($($entry.size) bytes)"
    $ProgressPreference = 'SilentlyContinue'
    Invoke-WebRequest "https://huggingface.co/$repository/resolve/$revision/${relativeName}?download=true" -OutFile $partialPath -Resume
  }
  if ((Get-Item -LiteralPath $downloadPath).Length -ne $entry.size) { throw "Incomplete file: $relativeName. Partial download retained for retry." }
  $digest = (Get-FileHash -LiteralPath $downloadPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($entry.lfs -and $digest -ne $entry.lfs.sha256) { throw "SHA-256 mismatch: $relativeName. File retained; review before retry." }
  if (-not $entry.lfs) {
    $blobHash = [Security.Cryptography.SHA1]::Create()
    try {
      $prefix = [Text.Encoding]::UTF8.GetBytes("blob $($entry.size)" + [char]0)
      $content = [IO.File]::ReadAllBytes($downloadPath)
      $blobHash.TransformBlock($prefix, 0, $prefix.Length, $null, 0) | Out-Null
      $blobHash.TransformFinalBlock($content, 0, $content.Length) | Out-Null
      if ([Convert]::ToHexString($blobHash.Hash).ToLowerInvariant() -ne $entry.blobId) { throw "Git blob mismatch: $relativeName" }
    } finally { $blobHash.Dispose() }
  }
  if ($downloadPath -eq $partialPath) { Move-Item -LiteralPath $partialPath -Destination $filePath }
  $records += [PSCustomObject]@{ path = $relativeName; size = $entry.size; sha256 = $digest }
  Write-Output "Verified $relativeName"
}
$manifest = [PSCustomObject]@{ repository = $repository; revision = $revision; files = $records }
[IO.File]::WriteAllText((Join-Path $destination 'sanctuary.manifest.json'), ($manifest | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
Write-Output "Ready: $destination"
