# Install the three DSH design-skill repos into ~/.dsh/skills (markdown/HTML only, no plugin code).
# ASCII-only on purpose: Windows PowerShell reads BOM-less .ps1 as ANSI and mangles CJK.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$H = @{ 'User-Agent' = 'dsh-agent' }
$skills = Join-Path $env:USERPROFILE '.dsh\skills'

function Get-GhFile {
  param([string]$Repo, [string]$Path, [string]$DestDir, [string]$DestName)
  New-Item -ItemType Directory -Path $DestDir -Force | Out-Null
  $url = "https://api.github.com/repos/$Repo/contents/$Path"
  $r = Invoke-RestMethod -Uri $url -Headers $H -TimeoutSec 60
  if (-not $r.content) { throw "no content for $Path" }
  $b64 = ($r.content -replace '\s', '')
  $bytes = [Convert]::FromBase64String($b64)
  $target = Join-Path $DestDir $DestName
  [System.IO.File]::WriteAllBytes($target, $bytes)
  Write-Output ("{0,9} bytes  {1}" -f $bytes.Length, $target)
}

$jobs = @(
  # --- Viger1/dsh-design : design-system skill + the audit engine source (rules reference) ---
  @{ r='Viger1/dsh-design'; p='skills/design-system/SKILL.md';            d="$skills\design-system";             n='SKILL.md' }
  @{ r='Viger1/dsh-design'; p='src/audit.ts';                             d="$skills\design-system\references";  n='audit-rules.ts' }
  @{ r='Viger1/dsh-design'; p='src/color.ts';                             d="$skills\design-system\references";  n='color.ts' }
  @{ r='Viger1/dsh-design'; p='examples/pricing-page/BRIEF.md';           d="$skills\design-system\references";  n='example-brief.md' }
  @{ r='Viger1/dsh-design'; p='examples/pricing-page/README.md';          d="$skills\design-system\references";  n='example-readme.md' }
  @{ r='Viger1/dsh-design'; p='examples/pricing-page/baseline.html';      d="$skills\design-system\references";  n='example-baseline.html' }
  @{ r='Viger1/dsh-design'; p='examples/pricing-page/guided.html';        d="$skills\design-system\references";  n='example-guided.html' }
  @{ r='Viger1/dsh-design'; p='README.zh.md';                             d="$skills\design-system\references";  n='plugin-readme.zh.md' }

  # --- xulelenlp/dsh-web-artifact-designer ---
  @{ r='xulelenlp/dsh-web-artifact-designer'; p='skills/web-artifact-designer/SKILL.md';                          d="$skills\web-artifact-designer"; n='SKILL.md' }
  @{ r='xulelenlp/dsh-web-artifact-designer'; p='skills/web-artifact-designer/references/design-principles.md';   d="$skills\web-artifact-designer\references"; n='design-principles.md' }
  @{ r='xulelenlp/dsh-web-artifact-designer'; p='skills/web-artifact-designer/references/self-contained-html.md'; d="$skills\web-artifact-designer\references"; n='self-contained-html.md' }
  @{ r='xulelenlp/dsh-web-artifact-designer'; p='skills/web-artifact-designer/assets/template.html';              d="$skills\web-artifact-designer\assets"; n='template.html' }
  @{ r='xulelenlp/dsh-web-artifact-designer'; p='skills/web-artifact-designer/assets/example-landing.html';       d="$skills\web-artifact-designer\assets"; n='example-landing.html' }
  @{ r='xulelenlp/dsh-web-artifact-designer'; p='README.md';                                                      d="$skills\web-artifact-designer\references"; n='plugin-readme.md' }

  # --- zhaiyateng/dsh-design-skills : 10 visual styles + dark-saas tokens + worked examples ---
  @{ r='zhaiyateng/dsh-design-skills'; p='references/dark-saas-tokens.md'; d="$skills\dark-saas\references"; n='dark-saas-tokens.md' }
  @{ r='zhaiyateng/dsh-design-skills'; p='README.zh.md';                   d="$skills\bento-grid\references"; n='plugin-readme.zh.md' }
)

$styles = @('apple-minimal','art-deco','bento-grid','brutalism','cyberpunk','dark-saas','glassmorphism','japanese-minimal','neo-neumorphism','vaporwave')
foreach ($s in $styles) {
  $jobs += @{ r='zhaiyateng/dsh-design-skills'; p="skills/$s/SKILL.md";              d="$skills\$s";            n='SKILL.md' }
  $jobs += @{ r='zhaiyateng/dsh-design-skills'; p="examples/$s-landing.html";        d="$skills\$s\examples";   n="$s-landing.html" }
}

$ok = 0; $fail = 0
foreach ($j in $jobs) {
  try { Get-GhFile -Repo $j.r -Path $j.p -DestDir $j.d -DestName $j.n | Out-Null; $ok++ }
  catch { $fail++; Write-Output "FAIL $($j.r)/$($j.p) : $($_.Exception.Message)" }
}
Write-Output "-----"
Write-Output "installed files: $ok, failed: $fail"
Write-Output "skills dir: $skills"
Get-ChildItem $skills -Directory | ForEach-Object {
  $s = Join-Path $_.FullName 'SKILL.md'
  "{0,-22} SKILL.md={1}" -f $_.Name, (Test-Path $s)
}
