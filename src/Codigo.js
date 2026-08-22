/**
 * Codigo.js — ponto de entrada do Web App: doGet, roteamento e include().
 *
 * Fase 0: só o esqueleto, para confirmar que a implantação responde.
 * Nenhum acesso a planilha aqui — isso vive em planilha.js (Fase 1).
 */

function doGet() {
  var pagina = HtmlService.createTemplateFromFile('ui/index').evaluate();
  return pagina
    .setTitle('Biblioteca')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Injeta um arquivo HTML dentro de outro. Padrão do HtmlService. */
function include(nomeArquivo) {
  return HtmlService.createHtmlOutputFromFile(nomeArquivo).getContent();
}
