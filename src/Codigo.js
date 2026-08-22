/**
 * Codigo.js — pontos de entrada: onOpen (menu da planilha) e doGet (Web App).
 *
 * Fase 0: só o esqueleto do Web App, para confirmar que a implantação responde.
 * Nenhum acesso a planilha aqui — isso vive em planilha.js (Fase 1).
 */

/**
 * Monta o menu "Biblioteca" ao abrir a planilha.
 *
 * Não é conveniência: em navegador com várias contas Google logadas, o
 * script.google.com ignora a sessão multi-conta e tenta abrir sempre como
 * conta padrão, devolvendo "Não foi possível abrir o arquivo" mesmo para o
 * dono. O docs.google.com lida com multi-conta; o editor do Apps Script não.
 * Pelo menu, a função roda de dentro do Sheets, onde a conta já está resolvida.
 *
 * Vale também para a manutenção do dia a dia: voluntário não abre editor.
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Biblioteca')
    .addItem('Criar / atualizar estrutura da planilha', 'criarEstruturaPlanilha')
    .addItem('Repor chaves padrão em Config', 'popularConfigPadrao')
    .addToUi();
}

function doGet() {
  var pagina = HtmlService.createTemplateFromFile('ui/index');

  // Nada de nome de casa hardcoded: vem do Config, como toda configuração.
  pagina.nomeCasa = lerConfig('nome_casa', 'Biblioteca');

  return pagina.evaluate()
    .setTitle(pagina.nomeCasa)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Injeta um arquivo HTML dentro de outro. Padrão do HtmlService. */
function include(nomeArquivo) {
  return HtmlService.createHtmlOutputFromFile(nomeArquivo).getContent();
}
