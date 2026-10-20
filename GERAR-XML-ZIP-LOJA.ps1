# Junta todos os XMLs de NFC-e de uma loja num ZIP (rodar no servidor da loja):
#   1) XMLs que estao no FiscalGateway (xml_proc_bin, descompactado)
#   2) <chave>-procNFe.xml das pastas (ACOM / NCR Solution / sistema colibri)
#      - so CNPJs que existem no FiscalGateway, so modelo 65, sem canceladas/nao processadas
#   3) mostra por mes: esperado no banco x no ZIP x faltando
#
# Saida: C:\Temp\XML <loja> <cnpj> <ano ini>-<ano fim>.zip  ->  <AAAA-MM>\<chave>-procNFe.xml
#
# Uso:
#   powershell -ExecutionPolicy Bypass -File C:\Temp\GERAR-XML-ZIP-LOJA.ps1
#   (tenta login do Windows no SQL; se nao der, pede a senha do sa)
#   Instancia nomeada: -Servidor ".\SQLEXPRESS"   Pasta extra: -Pastas 'C:\ACOM','D:\XML'

param(
    [string]$Servidor = 'localhost',
    [string]$Banco = 'FiscalGateway',
    [string]$Usuario = 'sa',
    [string]$Senha = '',
    [string]$Ini = '20240101',   # inclusive
    [string]$Fim = '20270101',   # exclusive
    [string[]]$Pastas = @('C:\ACOM', 'C:\ACOM NFCE', 'C:\NCR Solution', 'C:\sistema colibri'),
    [string]$Destino = 'C:\Temp'
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$dtIni = [datetime]::ParseExact($Ini, 'yyyyMMdd', $null)
$dtFim = [datetime]::ParseExact($Fim, 'yyyyMMdd', $null)
$aammIni = $dtIni.ToString('yyMM')
$aammFim = $dtFim.AddDays(-1).ToString('yyMM')
$inicio = Get-Date

function Get-Tag([string]$texto, [string]$tag) {
    $m = [regex]::Match($texto, "<$tag>([^<]*)</$tag>")
    if ($m.Success) { return $m.Groups[1].Value }
    return ''
}

function Expand-Gzip([byte[]]$bytes) {
    if ($bytes.Length -lt 2 -or $bytes[0] -ne 0x1f -or $bytes[1] -ne 0x8b) { return $bytes }
    $ms = New-Object System.IO.MemoryStream(, $bytes)
    $gz = New-Object System.IO.Compression.GZipStream($ms, [System.IO.Compression.CompressionMode]::Decompress)
    $out = New-Object System.IO.MemoryStream
    $gz.CopyTo($out)
    $gz.Dispose(); $ms.Dispose()
    return $out.ToArray()
}

function Add-Mes([hashtable]$h, [string]$mes) {
    if ($h.ContainsKey($mes)) { $h[$mes]++ } else { $h[$mes] = 1 }
}

# ---------- Conexao ----------
$csb = New-Object System.Data.SqlClient.SqlConnectionStringBuilder
$csb['Data Source'] = $Servidor
$csb['Initial Catalog'] = $Banco
$csb['TrustServerCertificate'] = $true
$csb['Connect Timeout'] = 15
$cn = $null
if (-not $Senha) {
    $csb['Integrated Security'] = $true
    $cn = New-Object System.Data.SqlClient.SqlConnection($csb.ConnectionString)
    try { $cn.Open(); Write-Host "Conectado em $Servidor\$Banco com o usuario do Windows" }
    catch { $cn = $null }
}
if (-not $cn) {
    if (-not $Senha) {
        $sec = Read-Host "Senha do usuario '$Usuario' no SQL Server" -AsSecureString
        $Senha = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
    }
    $csb['Integrated Security'] = $false
    $csb['User ID'] = $Usuario
    $csb['Password'] = $Senha
    $cn = New-Object System.Data.SqlClient.SqlConnection($csb.ConnectionString)
    $cn.Open()
    Write-Host "Conectado em $Servidor\$Banco como $Usuario"
}

function New-Cmd([string]$sql) {
    $c = $cn.CreateCommand()
    $c.CommandText = $sql
    $c.CommandTimeout = 0
    [void]$c.Parameters.Add('@ini', [System.Data.SqlDbType]::DateTime)
    [void]$c.Parameters.Add('@fim', [System.Data.SqlDbType]::DateTime)
    $c.Parameters['@ini'].Value = $dtIni
    $c.Parameters['@fim'].Value = $dtFim
    return $c
}

# ---------- Dados de apoio do banco ----------
$cnpjs = New-Object 'System.Collections.Generic.HashSet[string]'
$nomeLoja = ''
$r = (New-Cmd @"
SELECT CNPJCpfEmit, MAX(ISNULL(xFantEmit, '')) FROM dbo.NFe WITH (NOLOCK)
WHERE ISNULL(CNPJCpfEmit,'') <> '' GROUP BY CNPJCpfEmit ORDER BY COUNT(*) DESC
"@).ExecuteReader()
while ($r.Read()) {
    [void]$cnpjs.Add($r.GetString(0).Trim())
    if (-not $nomeLoja) { $nomeLoja = $r.GetString(1).Trim() + ' ' + $r.GetString(0).Trim() }
}
$r.Close()
if (-not $cnpjs.Count) { throw "Nenhuma nota no $Banco deste servidor." }
Write-Host "Loja: $nomeLoja   (CNPJs no banco: $([string]::Join(', ', @($cnpjs))))"

$nomeArq = ('XML ' + $nomeLoja + " $($dtIni.Year)-$($dtFim.AddDays(-1).Year)") -replace '[\\/:*?"<>|]', '_'
$pasta = Join-Path $Destino $nomeArq
$zip = "$pasta.zip"
if (Test-Path $pasta) { Remove-Item $pasta -Recurse -Force }
New-Item -ItemType Directory -Force $pasta | Out-Null

$naoProcessadas = New-Object 'System.Collections.Generic.HashSet[string]'
$r = (New-Cmd "SELECT ID FROM dbo.NFe WITH (NOLOCK) WHERE status <> 'processado' AND ID IS NOT NULL AND dhEmi >= @ini AND dhEmi < @fim").ExecuteReader()
while ($r.Read()) { [void]$naoProcessadas.Add($r.GetString(0).Trim()) }
$r.Close()
Write-Host "Canceladas/nao processadas no banco (ficam de fora): $($naoProcessadas.Count)"

$esperado = @{}
$r = (New-Cmd @"
SELECT CONVERT(char(7), dhEmi, 126), COUNT(*) FROM dbo.NFe WITH (NOLOCK)
WHERE status = 'processado' AND dhEmi >= @ini AND dhEmi < @fim
GROUP BY CONVERT(char(7), dhEmi, 126)
"@).ExecuteReader()
while ($r.Read()) { $esperado[$r.GetString(0)] = $r.GetInt32(1) }
$r.Close()

$noZip = @{}
$vistas = New-Object 'System.Collections.Generic.HashSet[string]'
function Save-Xml([string]$ch, [string]$mes, [byte[]]$bytes) {
    $dir = Join-Path $pasta $mes
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory $dir | Out-Null }
    [System.IO.File]::WriteAllBytes((Join-Path $dir "$ch-procNFe.xml"), $bytes)
    [void]$vistas.Add($ch)
    Add-Mes $noZip $mes
}

# ---------- 1) XMLs do banco ----------
Write-Host 'Extraindo XMLs do banco...'
$doBanco = 0
$r = (New-Cmd @"
SELECT n.ID, CONVERT(char(7), n.dhEmi, 126), n.xml_proc_bin
FROM dbo.NFe n WITH (NOLOCK)
WHERE n.dhEmi >= @ini AND n.dhEmi < @fim
  AND n.status = 'processado'
  AND n.xml_proc_bin IS NOT NULL
  AND n.ID IS NOT NULL
"@).ExecuteReader()
while ($r.Read()) {
    $ch = $r.GetString(0).Trim()
    if ($vistas.Contains($ch)) { continue }
    Save-Xml $ch $r.GetString(1) (Expand-Gzip ([byte[]]$r.GetValue(2)))
    $doBanco++
    if ($doBanco % 5000 -eq 0) { Write-Host "  $doBanco ..." }
}
$r.Close()
$cn.Close()
Write-Host "Do banco: $doBanco XMLs"

# ---------- 2) XMLs das pastas ----------
$arquivos = @{}
$canceladasPasta = New-Object 'System.Collections.Generic.HashSet[string]'
foreach ($p in $Pastas) {
    if (-not (Test-Path $p)) { Write-Host "Pasta nao existe, pulando: $p"; continue }
    Write-Host "Varrendo $p ..."
    Get-ChildItem $p -Recurse -File -Filter *.xml -ErrorAction SilentlyContinue | ForEach-Object {
        $m = [regex]::Match($_.Name, '^(\d{44})-procNFe\.xml$', 'IgnoreCase')
        if ($m.Success) {
            $ch = $m.Groups[1].Value
            $aamm = $ch.Substring(2, 4)
            if ($cnpjs.Contains($ch.Substring(6, 14)) -and $ch.Substring(20, 2) -eq '65' -and
                $aamm -ge $aammIni -and $aamm -le $aammFim -and -not $arquivos.ContainsKey($ch)) {
                $arquivos[$ch] = $_.FullName
            }
        }
        else {
            $c = [regex]::Match($_.Name, '110111(\d{44})')
            if ($c.Success) { [void]$canceladasPasta.Add($c.Groups[1].Value) }
        }
    }
}
Write-Host "XMLs unicos nas pastas: $($arquivos.Count)"

$daPasta = 0; $excluidas = 0; $semAutorizacao = 0; $i = 0
foreach ($ch in $arquivos.Keys) {
    $i++
    if ($i % 5000 -eq 0) { Write-Host "  $i / $($arquivos.Count) ..." }
    if ($vistas.Contains($ch)) { continue }
    if ($naoProcessadas.Contains($ch) -or $canceladasPasta.Contains($ch)) { $excluidas++; continue }
    $bytes = [System.IO.File]::ReadAllBytes($arquivos[$ch])
    $xml = [System.Text.Encoding]::UTF8.GetString($bytes)
    $ip = $xml.IndexOf('<protNFe')
    $cStat = if ($ip -ge 0) { Get-Tag $xml.Substring($ip) 'cStat' } else { '' }
    if ($cStat -ne '100' -and $cStat -ne '150') { $semAutorizacao++; continue }
    $mes = '20' + $ch.Substring(2, 2) + '-' + $ch.Substring(4, 2)   # AAMM da chave
    Save-Xml $ch $mes $bytes
    $daPasta++
}

# ---------- 3) ZIP ----------
Write-Host 'Compactando...'
if (Test-Path $zip) { Remove-Item $zip -Force }
[System.IO.Compression.ZipFile]::CreateFromDirectory($pasta, $zip, [System.IO.Compression.CompressionLevel]::Optimal, $false)
Remove-Item $pasta -Recurse -Force

# ---------- Resumo ----------
Write-Host ''
Write-Host '===== Por mes: esperado (banco) x no ZIP'
$meses = @($esperado.Keys) + @($noZip.Keys) | Sort-Object -Unique
$totEsp = 0; $totZip = 0; $totFalta = 0
$linhas = foreach ($mes in $meses) {
    $e = 0; if ($esperado.ContainsKey($mes)) { $e = $esperado[$mes] }
    $z = 0; if ($noZip.ContainsKey($mes)) { $z = $noZip[$mes] }
    $f = [Math]::Max(0, $e - $z)
    $totEsp += $e; $totZip += $z; $totFalta += $f
    [pscustomobject]@{ Mes = $mes; Esperado = $e; NoZip = $z; Faltando = $f }
}
$linhas | Format-Table -AutoSize | Out-Host
Write-Host "Do banco: $doBanco   Das pastas: $daPasta   Canceladas fora: $excluidas   Sem autorizacao: $semAutorizacao"
Write-Host "TOTAL NO ZIP: $totZip   ESPERADO: $totEsp   FALTANDO: $totFalta"
Write-Host ("ZIP: $zip  ({0:N0} MB)" -f ((Get-Item $zip).Length / 1MB))
Write-Host ("Tempo: {0:mm\:ss}" -f ((Get-Date) - $inicio))
