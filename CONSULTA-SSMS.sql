/* =====================================================================
   EXPORTAÇÃO NFC-e  -  rodar no SSMS de cada servidor (somente leitura)
   ===================================================================== */

/* PASSO 0 - Diagnóstico: quantas notas têm o XML guardado no banco, por mês.
   Onde "sem_xml" > 0, o CSV do passo 2 vai trazer a nota sem XML (o painel acusa
   "XML vazio no banco"). Para esses meses, exporte os XMLs pelo emissor (ZIP com
   as pastas Autorizadas/Canceladas) e importe o .zip no painel.                  */
SELECT xFantEmit AS loja, CNPJCpfEmit AS cnpj, CONVERT(char(7), dhEmi, 126) AS mes, xml_proc_algo,
       COUNT(*) AS notas,
       SUM(CASE WHEN DATALENGTH(xml_proc_bin) > 0 THEN 1 ELSE 0 END) AS com_xml,
       SUM(CASE WHEN ISNULL(DATALENGTH(xml_proc_bin), 0) = 0 THEN 1 ELSE 0 END) AS sem_xml
FROM [FiscalGateway].[dbo].[NFe] WITH (NOLOCK)
WHERE dhEmi >= '20260101' AND status = 'processado'
GROUP BY xFantEmit, CNPJCpfEmit, CONVERT(char(7), dhEmi, 126), xml_proc_algo
ORDER BY cnpj, mes;


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
   Confira se o nº de linhas no rodapé bate com o passo 1.
   Atenção: esta tabela NÃO marca as notas canceladas depois (elas continuam
   'processado' / cStat 100). Por isso importe também os cancelamentos (passo 3
   ou o .zip do emissor, que traz a pasta Canceladas).                    */
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


/* PASSO 3 - Cancelamentos.
   3a) Descobrir em que tabela o FiscalGateway guarda os eventos de cancelamento
       (rode e mande o resultado para quem mantém o painel montar o 3b):          */
SELECT t.name AS tabela, c.name AS coluna, ty.name AS tipo
FROM [FiscalGateway].sys.tables t
JOIN [FiscalGateway].sys.columns c ON c.object_id = t.object_id
JOIN [FiscalGateway].sys.types ty ON ty.user_type_id = c.user_type_id
WHERE t.name LIKE '%event%' OR t.name LIKE '%cancel%' OR c.name LIKE '%tpEvento%' OR c.name LIKE '%cancel%'
ORDER BY t.name, c.column_id;

/* 3b) A exportação dos cancelamentos precisa sair uma linha por nota, neste formato
       (o painel reconhece pela palavra CANCELAMENTO no 2º campo):
         chave|CANCELAMENTO|tpEvento|cStat|nProtEvento|dhEvento|chaveSubstituta
       tpEvento: 110111 (cancelamento) ou 110112 (por substituição); cStat 135/155 = registrado.
       Salve como .csv e importe no painel junto com (ou depois de) as notas.        */
