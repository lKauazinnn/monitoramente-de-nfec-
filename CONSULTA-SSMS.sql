/* =====================================================================
   EXPORTAÇÃO NFC-e  -  rodar no SSMS de cada servidor (somente leitura)
   ===================================================================== */

/* PASSO 1 - Quantas notas tem este servidor por mês (leve, não lê os XMLs).
   Use para separar os blocos do passo 2 em até ~30.000 notas cada.      */
SELECT xFantEmit AS loja, CNPJCpfEmit AS cnpj, YEAR(dhEmi) AS ano, MONTH(dhEmi) AS mes, COUNT(*) AS notas
FROM [FiscalGateway].[dbo].[NFe] WITH (NOLOCK)
WHERE dhEmi >= '20260101' AND status = 'processado'
GROUP BY xFantEmit, CNPJCpfEmit, YEAR(dhEmi), MONTH(dhEmi)
ORDER BY cnpj, ano, mes;


/* PASSO 2 - Exportação. Troque só as datas da linha DECLARE a cada bloco.
   @fim = primeiro dia DEPOIS do período (ex.: '20260401' pega até 31/03).
   Depois: botão direito na grade > Salvar Resultados Como... > .csv
   Confira se o nº de linhas no rodapé bate com o passo 1.               */
DECLARE @ini datetime = '20260101', @fim datetime = '20260401';

SELECT n.ID + '|' + ISNULL(n.CNPJCpfEmit,'') + '|' + CONVERT(char(7), n.dhEmi, 126) + '|'
     + ISNULL(REPLACE(n.xFantEmit,'|',' '),'') + '|' + ISNULL(n.xml_proc_algo,'') + '|'
     + ISNULL(n.nProt,'') + '|' + ISNULL(CONVERT(varchar(19), n.dhRecbto, 126),'') + '|'
     + ISNULL(CAST(n.digestValue AS varchar(100)),'') + '|' + ISNULL(n.cStat,'') + '|'
     + ISNULL(REPLACE(CAST(n.xMotivo AS varchar(255)),'|',' '),'') + '|' + ISNULL(n.veraplic_ret,'') + '|'
     + CAST('' AS xml).value('xs:base64Binary(sql:column("n.xml_proc_bin"))','varchar(max)') AS linha
FROM [FiscalGateway].[dbo].[NFe] n WITH (NOLOCK)
WHERE n.dhEmi >= @ini AND n.dhEmi < @fim
  AND n.status = 'processado'
  AND n.xml_proc_bin IS NOT NULL
ORDER BY n.dhEmi;
