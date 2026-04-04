$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$vendor = Join-Path $root 'static/vendor'

$files = @(
  @{ out='marked/marked.min.js'; urls=@('https://cdnjs.cloudflare.com/ajax/libs/marked/11.1.1/marked.min.js') },
  @{ out='highlightjs/highlight.min.js'; urls=@('https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js') },
  @{ out='highlightjs/styles/github.min.css'; urls=@('https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css') },
  @{ out='katex/katex.min.js'; urls=@(
    'https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.js',
    'https://unpkg.com/katex@0.16.9/dist/katex.min.js',
    'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js'
  ) },
  @{ out='katex/katex.min.css'; urls=@(
    'https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.css',
    'https://unpkg.com/katex@0.16.9/dist/katex.min.css',
    'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css'
  ) },
  @{ out='katex/contrib/auto-render.min.js'; urls=@(
    'https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/contrib/auto-render.min.js',
    'https://unpkg.com/katex@0.16.9/dist/contrib/auto-render.min.js',
    'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js'
  ) },
  @{ out='easymde/easymde.min.js'; urls=@(
    'https://cdnjs.cloudflare.com/ajax/libs/easymde/2.18.0/easymde.min.js',
    'https://unpkg.com/easymde@2.18.0/dist/easymde.min.js',
    'https://cdn.jsdelivr.net/npm/easymde@2.18.0/dist/easymde.min.js'
  ) },
  @{ out='easymde/easymde.min.css'; urls=@(
    'https://cdnjs.cloudflare.com/ajax/libs/easymde/2.18.0/easymde.min.css',
    'https://unpkg.com/easymde@2.18.0/dist/easymde.min.css',
    'https://cdn.jsdelivr.net/npm/easymde@2.18.0/dist/easymde.min.css'
  ) },
  @{ out='fontawesome/css/all.min.css'; urls=@('https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css') },
  @{ out='fontawesome/webfonts/fa-solid-900.woff2'; urls=@('https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-solid-900.woff2') },
  @{ out='fontawesome/webfonts/fa-regular-400.woff2'; urls=@('https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-regular-400.woff2') },
  @{ out='fontawesome/webfonts/fa-brands-400.woff2'; urls=@('https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-brands-400.woff2') }
)

function Download-WithFallback {
  param(
    [string[]]$Urls,
    [string]$Target
  )

  foreach ($u in $Urls) {
    try {
      Write-Host "Downloading $u -> $Target"
      Invoke-WebRequest -Uri $u -OutFile $Target -UseBasicParsing
      return $true
    }
    catch {
      Write-Warning "Failed: $u ($($_.Exception.Message))"
    }
  }
  return $false
}

$failed = @()
foreach ($f in $files) {
  $target = Join-Path $vendor $f.out
  $dir = Split-Path -Parent $target
  if (-not (Test-Path $dir)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
  }
  $ok = Download-WithFallback -Urls $f.urls -Target $target
  if (-not $ok) {
    $failed += $f.out
  }
}

$fontsCss = @"
/* Local font stack to avoid external Google Fonts dependency */
:root {
  --nc-font-sans: "Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif;
  --nc-font-mono: "JetBrains Mono", "Cascadia Mono", "Consolas", "SFMono-Regular", monospace;
}
html, body {
  font-family: var(--nc-font-sans);
}
code, pre, .cm-editor, .cm-scroller {
  font-family: var(--nc-font-mono);
}
"@

$fontsCssPath = Join-Path $vendor 'fonts/fonts.css'
$fontsDir = Split-Path -Parent $fontsCssPath
if (-not (Test-Path $fontsDir)) {
  New-Item -ItemType Directory -Path $fontsDir -Force | Out-Null
}
Set-Content -Path $fontsCssPath -Value $fontsCss -Encoding UTF8
Write-Host "Wrote $fontsCssPath"

if ($failed.Count -gt 0) {
  Write-Error ("Vendor assets download incomplete. Missing files: " + ($failed -join ', '))
}

Write-Host 'Vendor assets download complete.'
