# Gera o CSV de XMLs de NFC-e de uma loja em um passo so (rodar no servidor da loja):
#   1) exporta do FiscalGateway as notas que tem XML no banco (mesmo formato do CONSULTA-SSMS.sql)
#   2) completa com os <chave>-procNFe.xml das pastas (ACOM / NCR Solution / sistema colibri)
#      - so CNPJs que existem no FiscalGateway, so modelo 65, sem canceladas/nao processadas
#   3) mostra por mes: esperado no banco x gravado no arquivo x faltando
#
# Formato: ID|CNPJ|AAAA-MM|xFant|gzip|nProt|dhRecbto|digestValue|cStat|xMotivo|veraplic_ret|base64(gzip(xml))
#
# Uso:
#   powershell -ExecutionPolicy Bypass -File C:\Temp\GERAR-XML-LOJA.ps1
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
    [string]$Saida = ''
)

$ErrorActionPreference = 'Stop'
$dtIni = [datetime]::ParseExact($Ini, 'yyyyMMdd', $null)
$dtFim = [datetime]::ParseExact($Fim, 'yyyyMMdd', $null)
$aammIni = $dtIni.ToString('yyMM')
$aammFim = $dtFim.AddDays(-1).ToString('yyMM')
if (-not $Saida) {
    New-Item -ItemType Directory -Force 'C:\Temp' | Out-Null
    $Saida = "C:\Temp\XML $env:COMPUTERNAME $($dtIni.Year) A $($dtFim.AddDays(-1).Year).csv"
}

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
$r = (New-Cmd "SELECT DISTINCT CNPJCpfEmit FROM dbo.NFe WITH (NOLOCK) WHERE ISNULL(CNPJCpfEmit,'') <> ''").ExecuteReader()
while ($r.Read()) { [void]$cnpjs.Add($r.GetString(0).Trim()) }
$r.Close()
Write-Host "CNPJs no banco: $([string]::Join(', ', @($cnpjs)))"

$naoProcessadas = New-Object 'System.Collections.Generic.HashSet[string]'
$r = (New-Cmd "SELECT ID FROM dbo.NFe WITH (NOLOCK) WHERE status <> 'processado' AND ID IS NOT NULL AND dhEmi >= @ini AND dhEmi < @fim").ExecuteReader()
while ($r.Read()) { [void]$naoProcessadas.Add($r.GetString(0).Trim()) }
$r.Close()
Write-Host "Notas canceladas/nao processadas no banco (serao excluidas): $($naoProcessadas.Count)"

$esperado = @{}
$r = (New-Cmd @"
SELECT CONVERT(char(7), dhEmi, 126), COUNT(*) FROM dbo.NFe WITH (NOLOCK)
WHERE status = 'processado' AND dhEmi >= @ini AND dhEmi < @fim
GROUP BY CONVERT(char(7), dhEmi, 126)
"@).ExecuteReader()
while ($r.Read()) { $esperado[$r.GetString(0)] = $r.GetInt32(1) }
$r.Close()

# ---------- 1) Exporta do banco ----------
$enc = New-Object System.Text.UTF8Encoding($true)
$sw = New-Object System.IO.StreamWriter($Saida, $false, $enc)
$sw.WriteLine('linha')

$gravadasMes = @{}
$vistas = New-Object 'System.Collections.Generic.HashSet[string]'
$doBanco = 0
Write-Host 'Exportando XMLs do banco...'
$r = (New-Cmd @"
SELECT n.ID,
       n.ID + '|' + ISNULL(n.CNPJCpfEmit,'') + '|' + CONVERT(char(7), n.dhEmi, 126) + '|'
     + ISNULL(REPLACE(n.xFantEmit,'|',' '),'') + '|' + ISNULL(n.xml_proc_algo,'') + '|'
     + ISNULL(n.nProt,'') + '|' + ISNULL(CONVERT(varchar(19), n.dhRecbto, 126),'') + '|'
     + ISNULL(CAST(n.digestValue AS varchar(100)),'') + '|' + ISNULL(n.cStat,'') + '|'
     + ISNULL(REPLACE(CAST(n.xMotivo AS varchar(255)),'|',' '),'') + '|' + ISNULL(n.veraplic_ret,'') + '|',
       n.xml_proc_bin,
       CONVERT(char(7), n.dhEmi, 126)
FROM dbo.NFe n WITH (NOLOCK)
WHERE n.dhEmi >= @ini AND n.dhEmi < @fim
  AND n.status = 'processado'
  AND n.xml_proc_bin IS NOT NULL
  AND n.ID IS NOT NULL
ORDER BY n.dhEmi
"@).ExecuteReader()
while ($r.Read()) {
    $ch = $r.GetString(0).Trim()
    if (-not $vistas.Add($ch)) { continue }
    $sw.WriteLine($r.GetString(1) + [Convert]::ToBase64String([byte[]]$r.GetValue(2)))
    Add-Mes $gravadasMes $r.GetString(3)
    $doBanco++
    if ($doBanco % 5000 -eq 0) { Write-Host "  $doBanco ..." }
}
$r.Close()
$cn.Close()
Write-Host "Do banco: $doBanco notas"

# ---------- 2) Completa com as pastas ----------
$arquivos = @{}
$canceladasPasta = New-Object 'System.Collections.Generic.HashSet[string]'
$copias = 0
foreach ($p in $Pastas) {
    if (-not (Test-Path $p)) { Write-Host "Pasta nao existe, pulando: $p"; continue }
    Write-Host "Varrendo $p ..."
    Get-ChildItem $p -Recurse -File -Filter *.xml -ErrorAction SilentlyContinue | ForEach-Object {
        $m = [regex]::Match($_.Name, '^(\d{44})-procNFe\.xml$', 'IgnoreCase')
        if ($m.Success) {
            $ch = $m.Groups[1].Value
            $aamm = $ch.Substring(2, 4)
            if ($cnpjs.Contains($ch.Substring(6, 14)) -and $ch.Substring(20, 2) -eq '65' -and
                $aamm -ge $aammIni -and $aamm -le $aammFim) {
                if ($arquivos.ContainsKey($ch)) { $copias++ } else { $arquivos[$ch] = $_.FullName }
            }
        }
        else {
            $c = [regex]::Match($_.Name, '110111(\d{44})')
            if ($c.Success) { [void]$canceladasPasta.Add($c.Groups[1].Value) }
        }
    }
}
Write-Host "XMLs unicos nas pastas: $($arquivos.Count)  (copias repetidas: $copias)"

$daPasta = 0; $jaNoBanco = 0; $excluidas = 0; $semAutorizacao = 0; $i = 0
foreach ($ch in ($arquivos.Keys | Sort-Object)) {
    $i++
    if ($i % 5000 -eq 0) { Write-Host "  $i / $($arquivos.Count) ..." }
    if ($vistas.Contains($ch)) { $jaNoBanco++; continue }
    if ($naoProcessadas.Contains($ch) -or $canceladasPasta.Contains($ch)) { $excluidas++; continue }

    $bytes = [System.IO.File]::ReadAllBytes($arquivos[$ch])
    $xml = [System.Text.Encoding]::UTF8.GetString($bytes)
    $ip = $xml.IndexOf('<protNFe')
    if ($ip -lt 0) { $semAutorizacao++; continue }
    $prot = $xml.Substring($ip)
    $cStat = Get-Tag $prot 'cStat'
    if ($cStat -ne '100' -and $cStat -ne '150') { $semAutorizacao++; continue }

    $dhEmi = Get-Tag $xml 'dhEmi'
    $dhRecbto = Get-Tag $prot 'dhRecbto'
    if ($dhRecbto.Length -gt 19) { $dhRecbto = $dhRecbto.Substring(0, 19) }
    $mes = $dhEmi.Substring(0, 7)

    $campos = @(
        $ch,
        $ch.Substring(6, 14),
        $mes,
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
    [void]$vistas.Add($ch)
    Add-Mes $gravadasMes $mes
    $daPasta++
}
$sw.Dispose()

# ---------- 3) Resumo ----------
Write-Host ''
Write-Host '===== Por mes: esperado (banco) x no arquivo'
$meses = @($esperado.Keys) + @($gravadasMes.Keys) | Sort-Object -Unique
$totEsp = 0; $totArq = 0; $totFalta = 0
$linhas = foreach ($mes in $meses) {
    $e = 0; if ($esperado.ContainsKey($mes)) { $e = $esperado[$mes] }
    $a = 0; if ($gravadasMes.ContainsKey($mes)) { $a = $gravadasMes[$mes] }
    $f = [Math]::Max(0, $e - $a)
    $totEsp += $e; $totArq += $a; $totFalta += $f
    [pscustomobject]@{ Mes = $mes; Esperado = $e; NoArquivo = $a; Faltando = $f }
}
$linhas | Format-Table -AutoSize | Out-Host
Write-Host "Do banco:                 $doBanco"
Write-Host "Das pastas:               $daPasta"
Write-Host "Puladas (ja no banco):    $jaNoBanco"
Write-Host "Puladas (canceladas):     $excluidas"
Write-Host "Puladas (sem autorizacao): $semAutorizacao"
Write-Host "TOTAL NO ARQUIVO: $totArq   ESPERADO: $totEsp   FALTANDO: $totFalta"
Write-Host "Arquivo: $Saida"
