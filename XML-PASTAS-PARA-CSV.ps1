# Gera linhas no mesmo formato do CONSULTA-SSMS.sql a partir dos arquivos <chave>-procNFe.xml
# guardados em pasta (ACOM / NCR Solution), para completar o periodo que o FiscalGateway nao tem XML.
#
# Formato: ID|CNPJ|AAAA-MM|xFant|gzip|nProt|dhRecbto|digestValue|cStat|xMotivo|veraplic_ret|base64(gzip(xml))
#
# Uso (no servidor):
#   powershell -ExecutionPolicy Bypass -File .\XML-PASTAS-PARA-CSV.ps1
#   powershell -ExecutionPolicy Bypass -File .\XML-PASTAS-PARA-CSV.ps1 -CsvExistente "C:\...\XML NAZO AGUAS CLARAS 2024 A 2026.csv"
#
# -CsvExistente: pula as chaves que ja estao no CSV gerado pelo SQL (evita duplicar).

param(
    [string[]]$Pastas = @('C:\ACOM', 'C:\ACOM NFCE', 'C:\NCR Solution', 'C:\Users\SERVIDOR NZAC\Desktop\PC'),
    [string]$Cnpj = '21131221000330',
    [string]$AnoMesIni = '2401',   # AAMM
    [string]$AnoMesFim = '2612',   # AAMM
    [string]$CsvExistente = '',
    [string]$Saida = (Join-Path $env:USERPROFILE 'Documents\XML NAZO AGUAS CLARAS - PASTAS.csv')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Web -ErrorAction SilentlyContinue

function Get-Tag([string]$texto, [string]$tag) {
    $m = [regex]::Match($texto, "<$tag>([^<]*)</$tag>")
    if ($m.Success) { return [System.Net.WebUtility]::HtmlDecode($m.Groups[1].Value) }
    return ''
}

function ConvertTo-GzipBase64([byte[]]$bytes) {
    $ms = New-Object System.IO.MemoryStream
    $gz = New-Object System.IO.Compression.GZipStream($ms, [System.IO.Compression.CompressionMode]::Compress, $true)
    $gz.Write($bytes, 0, $bytes.Length)
    $gz.Dispose()
    $b64 = [Convert]::ToBase64String($ms.ToArray())
    $ms.Dispose()
    return $b64
}

# 1) Chaves que ja estao no CSV do SQL
$existentes = New-Object 'System.Collections.Generic.HashSet[string]'
if ($CsvExistente) {
    Write-Host "Lendo chaves do CSV existente: $CsvExistente"
    $sr = New-Object System.IO.StreamReader($CsvExistente)
    while (($l = $sr.ReadLine()) -ne $null) {
        if ($l.Length -ge 44 -and $l.Substring(0, 44) -match '^\d{44}$') { [void]$existentes.Add($l.Substring(0, 44)) }
    }
    $sr.Dispose()
    Write-Host "  $($existentes.Count) chaves ja exportadas pelo SQL"
}

# 2) Varre as pastas: procNFe por chave + eventos de cancelamento (110111)
$arquivos   = @{}
$canceladas = New-Object 'System.Collections.Generic.HashSet[string]'
$duplicados = 0
foreach ($p in $Pastas) {
    if (-not (Test-Path $p)) { Write-Host "Pasta nao existe, pulando: $p"; continue }
    Write-Host "Varrendo $p ..."
    Get-ChildItem $p -Recurse -File -Filter *.xml -ErrorAction SilentlyContinue | ForEach-Object {
        $nome = $_.Name
        $m = [regex]::Match($nome, '^(\d{44})-procNFe\.xml$', 'IgnoreCase')
        if ($m.Success) {
            $ch = $m.Groups[1].Value
            $aamm = $ch.Substring(2, 4)
            if ($ch.Substring(6, 14) -eq $Cnpj -and $ch.Substring(20, 2) -eq '65' -and
                $aamm -ge $AnoMesIni -and $aamm -le $AnoMesFim) {
                if ($arquivos.ContainsKey($ch)) { $duplicados++ } else { $arquivos[$ch] = $_.FullName }
            }
        }
        else {
            $c = [regex]::Match($nome, '110111(\d{44})')
            if ($c.Success) { [void]$canceladas.Add($c.Groups[1].Value) }
        }
    }
}
Write-Host "Notas unicas encontradas: $($arquivos.Count)  (copias repetidas ignoradas: $duplicados)"
Write-Host "Eventos de cancelamento encontrados: $($canceladas.Count)"

# 3) Gera o CSV
$enc = New-Object System.Text.UTF8Encoding($true)
$sw = New-Object System.IO.StreamWriter($Saida, $false, $enc)
$sw.WriteLine('linha')

$porMes = @{}
$pulouExistente = 0; $pulouCancelada = 0; $pulouNaoAutorizada = 0; $gravadas = 0; $i = 0
foreach ($ch in ($arquivos.Keys | Sort-Object)) {
    $i++
    if ($i % 5000 -eq 0) { Write-Host "  $i / $($arquivos.Count) ..." }
    if ($existentes.Contains($ch)) { $pulouExistente++; continue }
    if ($canceladas.Contains($ch)) { $pulouCancelada++; continue }

    $bytes = [System.IO.File]::ReadAllBytes($arquivos[$ch])
    $xml = [System.Text.Encoding]::UTF8.GetString($bytes)
    $ip = $xml.IndexOf('<protNFe')
    if ($ip -lt 0) { $pulouNaoAutorizada++; continue }
    $prot = $xml.Substring($ip)
    $cStat = Get-Tag $prot 'cStat'
    if ($cStat -ne '100' -and $cStat -ne '150') { $pulouNaoAutorizada++; continue }

    $dhEmi = Get-Tag $xml 'dhEmi'
    $dhRecbto = Get-Tag $prot 'dhRecbto'
    if ($dhRecbto.Length -gt 19) { $dhRecbto = $dhRecbto.Substring(0, 19) }

    $campos = @(
        $ch,
        $Cnpj,
        $dhEmi.Substring(0, 7),
        ((Get-Tag $xml 'xFant') -replace '\|', ' '),
        'gzip',
        (Get-Tag $prot 'nProt'),
        $dhRecbto,
        (Get-Tag $prot 'digVal'),
        $cStat,
        ((Get-Tag $prot 'xMotivo') -replace '\|', ' '),
        '',   # veraplic_ret: vem vazio no FiscalGateway, mantido igual
        (ConvertTo-GzipBase64 $bytes)
    )
    $sw.WriteLine([string]::Join('|', $campos))
    $gravadas++
    $mes = $dhEmi.Substring(0, 7)
    if ($porMes.ContainsKey($mes)) { $porMes[$mes]++ } else { $porMes[$mes] = 1 }
}
$sw.Dispose()

Write-Host ''
Write-Host '===== Notas gravadas por mes'
$porMes.GetEnumerator() | Sort-Object Name | Format-Table @{n='Mes';e={$_.Name}}, @{n='Qtd';e={$_.Value}} -AutoSize
Write-Host "Gravadas:                    $gravadas"
Write-Host "Puladas (ja no CSV do SQL):  $pulouExistente"
Write-Host "Puladas (canceladas):        $pulouCancelada"
Write-Host "Puladas (sem autorizacao):   $pulouNaoAutorizada"
Write-Host "Arquivo: $Saida"
