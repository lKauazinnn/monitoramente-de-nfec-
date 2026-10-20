# Junta o CSV do SQL (CONSULTA-SSMS.sql) com o CSV das pastas (XML-PASTAS-PARA-CSV.ps1) num arquivo so,
# sem chaves repetidas e sem as chaves listadas em -Excluir (canceladas etc., exportadas do FiscalGateway).
#
# Uso:
#   powershell -ExecutionPolicy Bypass -File .\JUNTAR-CSV.ps1 -CsvSql "C:\Temp\...2024 A 2026.csv" `
#       -CsvPastas "C:\Temp\...PASTAS.csv" -Excluir "C:\Temp\excluir.txt" -Saida "C:\Temp\...FINAL.csv"

param(
    [Parameter(Mandatory = $true)][string]$CsvSql,
    [Parameter(Mandatory = $true)][string]$CsvPastas,
    [string]$Excluir = '',
    [Parameter(Mandatory = $true)][string]$Saida
)

$ErrorActionPreference = 'Stop'

# Chaves a excluir: uma por linha (aceita com ou sem prefixo "NFe")
$chavesExcluir = New-Object 'System.Collections.Generic.HashSet[string]'
if ($Excluir) {
    foreach ($l in [System.IO.File]::ReadLines($Excluir)) {
        $m = [regex]::Match($l, '\d{44}')
        if ($m.Success) { [void]$chavesExcluir.Add($m.Value) }
    }
    Write-Host "Chaves para excluir: $($chavesExcluir.Count)"
}

$vistas = New-Object 'System.Collections.Generic.HashSet[string]'
$porMes = @{}
$enc = New-Object System.Text.UTF8Encoding($true)
$sw = New-Object System.IO.StreamWriter($Saida, $false, $enc)
$sw.WriteLine('linha')

foreach ($arq in @($CsvSql, $CsvPastas)) {
    $gravadas = 0; $excluidas = 0; $repetidas = 0
    $sr = New-Object System.IO.StreamReader($arq)
    [void]$sr.ReadLine()   # cabecalho "linha"
    while (($l = $sr.ReadLine()) -ne $null) {
        if ($l.Length -lt 52) { continue }
        $ch = $l.Substring(0, 44)
        if ($chavesExcluir.Contains($ch)) { $excluidas++; continue }
        if (-not $vistas.Add($ch)) { $repetidas++; continue }
        $sw.WriteLine($l)
        $gravadas++
        $mes = $l.Split('|', 4)[2]
        if ($porMes.ContainsKey($mes)) { $porMes[$mes]++ } else { $porMes[$mes] = 1 }
    }
    $sr.Dispose()
    Write-Host "$arq"
    Write-Host "  gravadas: $gravadas   excluidas: $excluidas   repetidas: $repetidas"
}
$sw.Dispose()

Write-Host ''
Write-Host '===== Arquivo final por mes'
$porMes.GetEnumerator() | Sort-Object Name | Format-Table @{n='Mes';e={$_.Name}}, @{n='Qtd';e={$_.Value}} -AutoSize
Write-Host "Total: $($vistas.Count)"
Write-Host "Arquivo: $Saida"
