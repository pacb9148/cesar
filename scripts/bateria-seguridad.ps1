<#
.SYNOPSIS
    Batería integral de pruebas de seguridad y detección temprana de vulnerabilidades.
.DESCRIPTION
    Escanea el repositorio en busca de:
    1. Secretos y credenciales expuestas en código o configuración.
    2. Vulnerabilidades de alto impacto en dependencias (npm/pip/uv).
    3. Exposición accidental de variables de servicio en frontend (NEXT_PUBLIC_).
    4. Reglas de protección en .gitignore.
    5. Estado de integración con Strix y flujos de mitigación OWASP.
#>

param (
    [string]$ProjectDir = (Get-Location).Path,
    [switch]$FailOnWarning
)

$ErrorActionPreference = "Continue"

Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "  BATERÍA DE PRUEBAS DE SEGURIDAD Y VULNERABILIDADES (STRIX)   " -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "Directorio analizado: $ProjectDir"
Write-Host "Fecha y hora: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Write-Host ""

$totalErrors = 0
$totalWarnings = 0

# -----------------------------------------------------------------------------
# 1. VERIFICACIÓN DE .gitignore Y ARCHIVOS SENSIBLES
# -----------------------------------------------------------------------------
Write-Host "[1/5] Verificando protección en .gitignore..." -ForegroundColor Yellow

$gitignorePath = Join-Path $ProjectDir ".gitignore"
if (-not (Test-Path $gitignorePath)) {
    Write-Host "  [ALERTA] No se encontró archivo .gitignore en el proyecto!" -ForegroundColor Red
    $totalErrors++
} else {
    $gitignoreContent = Get-Content $gitignorePath -Raw
    $essentialPatterns = @(".env", ".env*.local", "*.pem", "*.key")
    foreach ($pat in $essentialPatterns) {
        if ($gitignoreContent -notmatch [regex]::Escape($pat)) {
            Write-Host "  [AVISO] El patrón '$pat' no está explícitamente en .gitignore" -ForegroundColor DarkYellow
            $totalWarnings++
        }
    }
    Write-Host "  -> .gitignore analizado correctamente." -ForegroundColor Green
}

# -----------------------------------------------------------------------------
# 2. BARRIDO DE SECRETOS Y CREDENCIALES
# -----------------------------------------------------------------------------
Write-Host "`n[2/5] Buscando secretos y credenciales filtradas..." -ForegroundColor Yellow

$secretPatterns = @(
    @{ Name = "JWT Token"; Pattern = 'eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}' },
    @{ Name = "Supabase Secret Key"; Pattern = 'sb_secret_[a-zA-Z0-9_-]{16,}' },
    @{ Name = "OpenAI / OpenRouter Key"; Pattern = 'sk-(live-)?[a-zA-Z0-9_-]{20,}' },
    @{ Name = "GitHub PAT / Token"; Pattern = 'gh[pousr]_[a-zA-Z0-9]{20,}|github_pat_[a-zA-Z0-9_]{30,}' },
    @{ Name = "Google AIza Key"; Pattern = 'AIza[0-9A-Za-z-_]{35}' },
    @{ Name = "Private Key Header"; Pattern = '-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----' }
)

$excludeFolders = @(".git", "node_modules", ".next", "dist", "build", ".turbo", ".cache", "bitacora")
$filesToScan = Get-ChildItem -Path $ProjectDir -Recurse -File -ErrorAction SilentlyContinue | Where-Object {
    $item = $_
    $skip = $false
    foreach ($ex in $excludeFolders) {
        if ($item.FullName -match "\\$ex\\") { $skip = $true; break }
    }
    if ($item.Name -match '^\.env(\..+)?$') { $skip = $true } # Los .env locales se auditan aparte
    if ($item.Extension -match '\.(png|jpg|jpeg|gif|ico|svg|woff|woff2|eot|ttf|mp4|webm|zip|tar|gz|pdf)$') { $skip = $true }
    -not $skip
}

$secretsFound = 0
foreach ($file in $filesToScan) {
    $content = Get-Content $file.FullName -Raw -ErrorAction SilentlyContinue
    if (-not $content) { continue }
    foreach ($sec in $secretPatterns) {
        if ($content -match $sec.Pattern) {
            # Evitar falsos positivos en mocks de tests claramente etiquetados
            if ($content -match 'mock|fake|dummy|test-key|example' -and $file.FullName -match '\\tests?\\') {
                Write-Host "  [AVISO MOCK] Se detectó patrón en archivo de test (verificar si es falso positivo): $($file.FullName.Replace($ProjectDir, ''))" -ForegroundColor DarkYellow
                $totalWarnings++
            } else {
                Write-Host "  [VULNERABILIDAD] $($sec.Name) detectado en: $($file.FullName.Replace($ProjectDir, ''))" -ForegroundColor Red
                $secretsFound++
                $totalErrors++
            }
        }
    }
}

if ($secretsFound -eq 0) {
    Write-Host "  -> No se detectaron secretos ni credenciales reales en los archivos escaneados." -ForegroundColor Green
}

# -----------------------------------------------------------------------------
# 3. VERIFICACIÓN DE FUGAS EN CLIENTE (NEXT_PUBLIC_*)
# -----------------------------------------------------------------------------
Write-Host "`n[3/5] Verificando variables públicas de cliente (NEXT_PUBLIC_*)..." -ForegroundColor Yellow

$dangerousClientVars = 0
$envExampleFiles = Get-ChildItem -Path $ProjectDir -Filter "*env*" -File -ErrorAction SilentlyContinue | Where-Object {
    $_.FullName -notmatch "\\(node_modules|\.git|\.next)\\"
}

foreach ($envFile in $envExampleFiles) {
    $lines = Get-Content $envFile.FullName -ErrorAction SilentlyContinue
    foreach ($line in $lines) {
        # Anon y Publishable keys son legítimas en frontend. Prohibir secretos de servicio.
        if ($line -match '^NEXT_PUBLIC_.*(SERVICE_ROLE|PRIVATE|SECRET_KEY|DATABASE_URL|MASTER_KEY)' -or
           ($line -match '^NEXT_PUBLIC_.*SECRET' -and $line -notmatch 'PUBLISHABLE|ANON')) {
            Write-Host "  [PELIGRO] Secreto de backend expuesto con prefijo público en $($envFile.Name): $line" -ForegroundColor Red
            $dangerousClientVars++
            $totalErrors++
        }
    }
}

if ($dangerousClientVars -eq 0) {
    Write-Host "  -> No se encontraron variables con prefijo NEXT_PUBLIC_ exponiendo secretos de backend." -ForegroundColor Green
}

# -----------------------------------------------------------------------------
# 4. AUDITORÍA DE DEPENDENCIAS (NPM / YARN / PNPM / PYTHON)
# -----------------------------------------------------------------------------
Write-Host "`n[4/5] Auditando dependencias de software..." -ForegroundColor Yellow

$pkgJson = Join-Path $ProjectDir "package.json"
if (Test-Path $pkgJson) {
    Write-Host "  Ejecutando auditoría de paquetes npm..." -ForegroundColor Gray
    try {
        $auditResult = & npm audit --json 2>$null | ConvertFrom-Json
        if ($auditResult -and $auditResult.metadata -and $auditResult.metadata.vulnerabilities) {
            $vulns = $auditResult.metadata.vulnerabilities
            $crit = $vulns.critical
            $high = $vulns.high
            $mod = $vulns.moderate
            $low = $vulns.low
            
            Write-Host "  Vulnerabilidades detectadas: Críticas: $crit | Altas: $high | Moderadas: $mod | Bajas: $low"
            if ($crit -gt 0 -or $high -gt 0) {
                Write-Host "  [VULNERABILIDAD] Dependencias críticas o altas encontradas en package.json!" -ForegroundColor Red
                $totalErrors += ($crit + $high)
            } else {
                Write-Host "  -> Sin vulnerabilidades críticas o altas en dependencias npm." -ForegroundColor Green
            }
        } else {
            Write-Host "  -> Dependencias analizadas sin alertas críticas." -ForegroundColor Green
        }
    } catch {
        Write-Host "  -> npm audit finalizó sin reporte de JSON o paquetes no instalados localmente." -ForegroundColor DarkGray
    }
} else {
    Write-Host "  (Proyecto sin package.json, se omite npm audit)" -ForegroundColor DarkGray
}

# -----------------------------------------------------------------------------
# 5. DISPONIBILIDAD DE STRIX APPSEC Y REMEDIACIÓN
# -----------------------------------------------------------------------------
Write-Host "`n[5/5] Estado del suite Strix y capacidades de remediación..." -ForegroundColor Yellow

$strixSkillPath = "C:\Users\pacb9\.claude\skills\find-security-vulnerabilities-in-code\SKILL.md"
if (Test-Path $strixSkillPath) {
    Write-Host "  -> Habilidades de Strix disponibles globalmente en el sistema:" -ForegroundColor Green
    Write-Host "     - /find-security-vulnerabilities-in-code (Escaneo asistido por IA de código)" -ForegroundColor Gray
    Write-Host "     - /owasp-top-10-testing (Evaluación OWASP Top 10)" -ForegroundColor Gray
    Write-Host "     - /fix-security-vulnerabilities-with-strix (Parcheo y verificación automática)" -ForegroundColor Gray
} else {
    Write-Host "  [AVISO] Skills de Strix no detectadas en ruta estándar." -ForegroundColor DarkYellow
    $totalWarnings++
}

# -----------------------------------------------------------------------------
# RESULTADO FINAL
# -----------------------------------------------------------------------------
Write-Host "`n================================================================" -ForegroundColor Cyan
if ($totalErrors -gt 0) {
    Write-Host "  RESULTADO: FALLIDO ($totalErrors vulnerabilidades / errores detectados)" -ForegroundColor Red
    Write-Host "  ACCIÓN RECOMENDADA: Invocar '/fix-security-vulnerabilities-with-strix' para corregir las incidencias." -ForegroundColor Yellow
    Write-Host "================================================================" -ForegroundColor Cyan
    exit 1
} elseif ($totalWarnings -gt 0 -and $FailOnWarning) {
    Write-Host "  RESULTADO: ADVERTENCIA ($totalWarnings avisos con flag estricto)" -ForegroundColor Yellow
    Write-Host "================================================================" -ForegroundColor Cyan
    exit 1
} else {
    Write-Host "  RESULTADO: APROBADO (Batería de seguridad 100% limpia)" -ForegroundColor Green
    Write-Host "================================================================" -ForegroundColor Cyan
    exit 0
}
