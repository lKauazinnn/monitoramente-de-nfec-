#Requires -Version 5.1
<#
  PROCESSADOR NFC-e  -  roda no SEU PC, não acessa banco nenhum.

  Entrada: arquivos .csv salvos pelo SSMS com a consulta de CONSULTA-SSMS.sql
           (uma linha por nota, campos separados por |, XML em base64 no final).

  Saída (dentro da pasta deste script):
    XMLs\<LOJA - CNPJ>\<aaaa-mm>\<chave>-procNFe.xml   XML autorizado, um por nota
    XMLs\_ZIPs\<aaaa-mm>\<LOJA - CNPJ - aaaa-mm>.zip    um ZIP por loja/mês
    Painel\dados\...                                     dados para o painel

  Notas em contingência (gravadas no banco sem o protocolo) são completadas com o
  protocolo da SEFAZ que vem na mesma linha, depois de conferir que o digest bate.

  Uso: arraste os .csv para "Processar.bat"
       .\Processar.ps1 -Arquivos a.csv,b.csv            processa CSVs
       .\Processar.ps1 -SoPainel                         só refaz os dados do painel a partir dos XMLs
#>
param(
    [Parameter(Position = 0, ValueFromRemainingArguments = $true)]
    [string[]]$Arquivos,
    [string[]]$Protocolos,      # opcional: arquivos antigos só com protocolos (formato de 7 campos)
    [string]$Destino = $PSScriptRoot,
    [switch]$SemZip,
    [switch]$SoPainel
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$INV = [Globalization.CultureInfo]::InvariantCulture
$UTF8 = New-Object System.Text.UTF8Encoding($false)
$RO = [Text.RegularExpressions.RegexOptions]::Singleline

$pastaXml    = Join-Path $Destino 'XMLs'
$pastaZip    = Join-Path $pastaXml '_ZIPs'
$pastaDados  = Join-Path (Join-Path $Destino 'Painel') 'dados'
New-Item -ItemType Directory -Force -Path $pastaXml, $pastaDados | Out-Null
$logFile = Join-Path $pastaXml ('processamento-{0:yyyyMMdd-HHmmss}.log' -f (Get-Date))
function Log($m) { Add-Content -Path $logFile -Value $m -Encoding UTF8 }

function Expand-Gzip([byte[]]$data) {
    $in  = New-Object System.IO.MemoryStream(,$data)
    $gz  = New-Object System.IO.Compression.GZipStream($in, [System.IO.Compression.CompressionMode]::Decompress)
    $out = New-Object System.IO.MemoryStream
    try { $gz.CopyTo($out) } finally { $gz.Dispose(); $in.Dispose() }
    return ,$out.ToArray()
}
function Nome-Pasta($fant, $cnpj) {
    $f = ([string]$fant -replace '[\\/:*?"<>|]', '_').Trim()
    if (-not $f) { $f = 'SEM NOME' }
    return "$f - $cnpj"
}

# ======================================================================
# 1) CSV -> XML
# ======================================================================
$rxNFe     = New-Object regex('(<NFe[ >].*</NFe>)', $RO)
$rxDigest  = [regex]'<DigestValue>([^<]+)</DigestValue>'
$rxTpAmb   = [regex]'<tpAmb>(\d)</tpAmb>'
$rxVerApl  = [regex]'<verAplic>([^<]+)</verAplic>'
$tocados   = New-Object System.Collections.Generic.HashSet[string]   # pastas loja\mês alteradas
$verAplicPorCnpj = @{}
$pendentes = New-Object System.Collections.Generic.List[object]
$cont = @{ Linhas = 0; Gerados = 0; Montados = 0; Existentes = 0; Erros = 0 }

$protExtra = @{}
foreach ($pf in @($Protocolos | Where-Object { $_ })) {
    foreach ($l in [IO.File]::ReadLines((Resolve-Path $pf).Path)) {
        $p = $l.Trim().Trim([char]0xFEFF).Split('|')
        if ($p.Count -ge 7 -and $p[0] -match '^\d{44}$') { $protExtra[$p[0]] = $p }
    }
}

function Gravar($alvo, [byte[]]$bytes) {
    $dir = Split-Path -Parent $alvo
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $tmp = "$alvo.tmp"
    [IO.File]::WriteAllBytes($tmp, $bytes)
    Move-Item -LiteralPath $tmp -Destination $alvo -Force
    [void]$tocados.Add($dir)
}

# Junta a NFe assinada (intacta) com o protocolo da SEFAZ
function Montar-Proc($ch, $texto, $prot, $cnpj) {
    # $prot = nProt, dhRecbto, digest, cStat, xMotivo, verAplic
    $nProt, $dh, $dig, $cst, $xmot, $ver = $prot
    if (-not $nProt -or -not $dh) { throw 'sem protocolo no banco' }
    if ($cst -ne '100' -and $cst -ne '150') { throw "cStat $cst $xmot" }
    $m = $rxNFe.Match($texto); if (-not $m.Success) { throw 'NFe não encontrada no XML' }
    $dv = $rxDigest.Match($texto).Groups[1].Value
    if ($dv -ne $dig) { throw 'digest do banco não bate com a assinatura do XML' }
    if (-not $ver) { $ver = $verAplicPorCnpj[$cnpj] }
    if (-not $ver) { return $null }   # tenta de novo no fim
    $tp = $rxTpAmb.Match($texto).Groups[1].Value
    $xmot = [Security.SecurityElement]::Escape($xmot)
    return '<?xml version="1.0" encoding="UTF-8"?><nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">' + $m.Groups[1].Value +
        '<protNFe versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><infProt>' +
        "<tpAmb>$tp</tpAmb><verAplic>$ver</verAplic><chNFe>$ch</chNFe><dhRecbto>$dh-03:00</dhRecbto>" +
        "<nProt>$nProt</nProt><digVal>$dig</digVal><cStat>$cst</cStat><xMotivo>$xmot</xMotivo>" +
        '</infProt></protNFe></nfeProc>'
}

function Processar-Linha($p, [bool]$fimDeFila) {
    # p: chave, cnpj, mes, fant, algo, [nProt, dhRecbto, digest, cStat, xMotivo, verAplic,] base64
    $ch = $p[0]; $cnpj = $p[1]
    $alvo = Join-Path (Join-Path (Join-Path $pastaXml (Nome-Pasta $p[3] $cnpj)) $p[2]) "$ch-procNFe.xml"
    if (Test-Path -LiteralPath $alvo) { $cont.Existentes++; return }
    [byte[]]$bytes = [Convert]::FromBase64String($p[$p.Count - 1])
    if ($p[4] -eq 'gzip') { $bytes = Expand-Gzip $bytes }
    $texto = $UTF8.GetString($bytes)
    if ($texto -notmatch [regex]::Escape("NFe$ch")) { throw 'chave do XML não confere' }
    $fim = $texto.TrimEnd()
    if ($fim.EndsWith('</nfeProc>') -and $texto.Contains('<protNFe')) {
        $v = $rxVerApl.Match($texto); if ($v.Success -and -not $verAplicPorCnpj[$cnpj]) { $verAplicPorCnpj[$cnpj] = $v.Groups[1].Value }
        Gravar $alvo $bytes; $cont.Gerados++; return
    }
    if (-not ($fim.EndsWith('</NFe>') -or $fim.EndsWith('</enviNFe>'))) { throw 'XML incompleto (cortado na exportação)' }
    if ($p.Count -ge 12) { $prot = $p[5..10] }
    elseif ($protExtra.ContainsKey($ch)) { $q = $protExtra[$ch]; $prot = $q[1..6] }
    else { throw 'XML sem protocolo e a linha não traz os dados do protocolo (use a consulta nova)' }
    $proc = Montar-Proc $ch $texto $prot $cnpj
    if ($null -eq $proc) {
        if ($fimDeFila) { throw 'versão da SEFAZ (verAplic) desconhecida para esta loja' }
        $pendentes.Add($p); return
    }
    Gravar $alvo ($UTF8.GetBytes($proc)); $cont.Montados++
}

if (-not $SoPainel) {
    $Arquivos = @($Arquivos | Where-Object { $_ -and $_ -notmatch '^-' })
    if ($Arquivos.Count -eq 0) { Write-Host 'Arraste os arquivos .csv salvos do SSMS para cima de "Processar.bat".' -ForegroundColor Yellow; exit 1 }
    $inicio = Get-Date
    foreach ($arq in $Arquivos) {
        $caminho = (Resolve-Path $arq).Path
        Write-Host "Lendo $caminho ..." -ForegroundColor Cyan
        foreach ($linha in [IO.File]::ReadLines($caminho)) {
            $linha = $linha.Trim().Trim([char]0xFEFF).Trim('"')
            if ($linha -notmatch '^\d{44}\|') { continue }
            $cont.Linhas++
            $p = $linha.Split('|')
            if ($p.Count -gt 12) { $p = $linha.Split('|', 12) }
            if ($p.Count -ne 6 -and $p.Count -ne 12) { $cont.Erros++; Log "$($p[0]) - linha com formato inesperado"; continue }
            try { Processar-Linha $p $false }
            catch { $cont.Erros++; Log "$($p[0]) - $($_.Exception.Message)" }
            if ($cont.Linhas % 2000 -eq 0) { Write-Host ("  {0} notas lidas..." -f $cont.Linhas) }
        }
    }
    foreach ($p in $pendentes) {
        try { Processar-Linha $p $true } catch { $cont.Erros++; Log "$($p[0]) - $($_.Exception.Message)" }
    }
    Write-Host ''
    Write-Host ("XMLs: {0} lidas | {1} prontas | {2} completadas com protocolo | {3} já existiam | {4} com erro  ({5}s)" -f `
        $cont.Linhas, $cont.Gerados, $cont.Montados, $cont.Existentes, $cont.Erros, [int]((Get-Date) - $inicio).TotalSeconds) -ForegroundColor Green
    if ($cont.Erros) { Write-Host "Veja os erros em $logFile" -ForegroundColor Yellow }
}

# ======================================================================
# 2) ZIPs por loja/mês
# ======================================================================
if ($SoPainel) {
    Get-ChildItem -LiteralPath $pastaXml -Directory | Where-Object { $_.Name -notlike '_*' } | ForEach-Object {
        Get-ChildItem -LiteralPath $_.FullName -Directory | Where-Object { $_.Name -match '^\d{4}-\d\d$' } | ForEach-Object { [void]$tocados.Add($_.FullName) }
    }
} elseif (-not $SemZip -and $tocados.Count) {
    Write-Host 'Gerando ZIPs...' -ForegroundColor Cyan
    foreach ($pm in $tocados) {
        $mes = Split-Path -Leaf $pm; $loja = Split-Path -Leaf (Split-Path -Parent $pm)
        $zd = Join-Path $pastaZip $mes; New-Item -ItemType Directory -Force -Path $zd | Out-Null
        $za = Join-Path $zd "$loja - $mes.zip"
        if (Test-Path -LiteralPath $za) { Remove-Item -LiteralPath $za -Force }
        [IO.Compression.ZipFile]::CreateFromDirectory($pm, $za)
    }
}

# ======================================================================
# 3) Dados do painel (um arquivo por loja/mês + índice de lojas)
# ======================================================================
$R = @{
    nNF = [regex]'<nNF>(\d+)</nNF>';           serie = [regex]'<serie>(\d+)</serie>'
    dh  = [regex]'<dhEmi>(\d{4}-\d\d-\d\dT\d\d:\d\d)'
    tot = New-Object regex('<ICMSTot>(.*?)</ICMSTot>', $RO)
    vNF = [regex]'<vNF>([\d.]+)</vNF>';        vDesc = [regex]'<vDesc>([\d.]+)</vDesc>'
    vICMS = [regex]'<vICMS>([\d.]+)</vICMS>'
    det = New-Object regex('<det nItem="\d+">(.*?)</det>', $RO)
    cProd = [regex]'<cProd>([^<]*)</cProd>';   xProd = [regex]'<xProd>([^<]*)</xProd>'
    qCom = [regex]'<qCom>([\d.]+)</qCom>';     vProd = [regex]'<vProd>([\d.]+)</vProd>'
    pag = New-Object regex('<detPag>(.*?)</detPag>', $RO)
    tPag = [regex]'<tPag>(\d+)</tPag>';        vPag = [regex]'<vPag>([\d.]+)</vPag>'
    inf = [regex]'<infCpl>([^<]*)</infCpl>';   ch = [regex]'Id="NFe(\d{44})"'
    emit = New-Object regex('<emit>(.*?)</emit>', $RO)
    xFant = [regex]'<xFant>([^<]*)</xFant>';   xNome = [regex]'<xNome>([^<]*)</xNome>'
    xLgr = [regex]'<xLgr>([^<]*)</xLgr>';      nro = [regex]'<nro>([^<]*)</nro>'
    xBairro = [regex]'<xBairro>([^<]*)</xBairro>'; xMun = [regex]'<xMun>([^<]*)</xMun>'; UF = [regex]'<UF>([^<]*)</UF>'
}
function G($rx, $s, $padrao = '') { $m = $rx.Match($s); if ($m.Success) { $m.Groups[1].Value } else { $padrao } }
function J([string]$s) {
    $s = [Net.WebUtility]::HtmlDecode($s)
    '"' + ($s -replace '\\', '\\' -replace '"', '\"' -replace '[\x00-\x1f]', ' ') + '"'
}

$resumoFile = Join-Path $pastaDados 'resumo.json'
$resumo = @{}
if (Test-Path $resumoFile) {
    (Get-Content $resumoFile -Raw -Encoding UTF8 | ConvertFrom-Json).PSObject.Properties | ForEach-Object { $resumo[$_.Name] = $_.Value }
}

if ($tocados.Count) { Write-Host "Montando dados do painel ($($tocados.Count) loja/mês)..." -ForegroundColor Cyan }
foreach ($pm in $tocados) {
    $mes = Split-Path -Leaf $pm
    $nomePasta = Split-Path -Leaf (Split-Path -Parent $pm)
    if ($nomePasta -notmatch '(\d{14})$') { continue }
    $cnpj = $Matches[1]
    $prods = @{}; $plist = New-Object System.Collections.Generic.List[string]
    $sb = New-Object System.Text.StringBuilder
    $series = @{}
    $tot = 0.0; $n = 0; $emitInfo = $null
    foreach ($f in [IO.Directory]::EnumerateFiles($pm, '*-procNFe.xml')) {
        $x = [IO.File]::ReadAllText($f, $UTF8)
        if (-not $emitInfo) {
            $e = G $R.emit $x
            $emitInfo = @{
                loja = (G $R.xFant $e); razao = (G $R.xNome $e)
                end = ('{0}, {1} - {2}, {3}/{4}' -f (G $R.xLgr $e), (G $R.nro $e), (G $R.xBairro $e), (G $R.xMun $e), (G $R.UF $e))
            }
            if (-not $emitInfo.loja) { $emitInfo.loja = $emitInfo.razao }
        }
        $t = G $R.tot $x
        $vnf = G $R.vNF $t '0'
        $nn = [int](G $R.nNF $x '0'); $se = G $R.serie $x '0'
        if (-not $series[$se]) { $series[$se] = New-Object System.Collections.Generic.List[int] }
        $series[$se].Add($nn)
        $pays = foreach ($pg in $R.pag.Matches($x)) { '["{0}",{1}]' -f (G $R.tPag $pg.Groups[1].Value), (G $R.vPag $pg.Groups[1].Value '0') }
        $itens = foreach ($d in $R.det.Matches($x)) {
            $di = $d.Groups[1].Value
            $k = (G $R.cProd $di) + '|' + (G $R.xProd $di)
            if (-not $prods.ContainsKey($k)) { $prods[$k] = $plist.Count; $plist.Add('[' + (J (G $R.cProd $di)) + ',' + (J (G $R.xProd $di)) + ']') }
            '[{0},{1},{2},{3}]' -f $prods[$k], (G $R.qCom $di '0'), (G $R.vProd $di '0'), (G $R.vDesc $di '0')
        }
        if ($n -gt 0) { [void]$sb.Append(',') }
        [void]$sb.Append(('[{0},"{1}",{2},{3},{4},[{5}],{6},[{7}],"{8}"]' -f $nn, (G $R.dh $x), $vnf, (G $R.vDesc $t '0'), (G $R.vICMS $t '0'),
            (@($pays) -join ','), (J (G $R.inf $x)), (@($itens) -join ','), (G $R.ch $x)))
        $tot += [double]::Parse($vnf, $INV); $n++
    }
    if ($n -eq 0) { continue }
    $lacunas = 0
    foreach ($lst in $series.Values) { $u = @($lst | Sort-Object -Unique); $lacunas += ($u[-1] - $u[0] + 1 - $u.Count) }

    $dirLoja = Join-Path $pastaDados $cnpj; New-Item -ItemType Directory -Force -Path $dirLoja | Out-Null
    $js = 'NFCE_LOAD({"cnpj":"' + $cnpj + '","mes":"' + $mes + '","loja":' + (J $emitInfo.loja) + ',"end":' + (J $emitInfo.end) +
          ',"lacunas":' + $lacunas + ',"prods":[' + ($plist -join ',') + '],"notes":[' + $sb.ToString() + ']});'
    [IO.File]::WriteAllText((Join-Path $dirLoja "$mes.js"), $js, $UTF8)
    $resumo["$cnpj|$mes"] = [pscustomobject]@{ cnpj = $cnpj; mes = $mes; loja = $emitInfo.loja; end = $emitInfo.end; notas = $n; total = [math]::Round($tot, 2) }
    Write-Host ("  {0} {1}: {2} notas, R$ {3:N2}" -f $emitInfo.loja, $mes, $n, $tot)
}

# índice de lojas
$lojas = @{}
foreach ($r in $resumo.Values) {
    if (-not $lojas[$r.cnpj]) { $lojas[$r.cnpj] = @{ cnpj = $r.cnpj; loja = $r.loja; end = $r.end; meses = New-Object System.Collections.Generic.List[string] } }
    $lojas[$r.cnpj].meses.Add(('{{"mes":"{0}","notas":{1},"total":{2}}}' -f $r.mes, $r.notas, ([double]$r.total).ToString($INV)))
}
$partes = foreach ($l in ($lojas.Values | Sort-Object { $_.loja })) {
    '{"cnpj":"' + $l.cnpj + '","loja":' + (J $l.loja) + ',"end":' + (J $l.end) + ',"meses":[' + ((@($l.meses) | Sort-Object) -join ',') + ']}'
}
[IO.File]::WriteAllText((Join-Path $pastaDados 'lojas.js'), ('NFCE_LOJAS({"gerado":"' + (Get-Date).ToString('s') + '","lojas":[' + (@($partes) -join ',') + ']});'), $UTF8)
$resumo | ConvertTo-Json -Depth 3 | Set-Content $resumoFile -Encoding UTF8

Write-Host ''
Write-Host "Pronto. Abra Painel\Painel NFC-e.html" -ForegroundColor Green
