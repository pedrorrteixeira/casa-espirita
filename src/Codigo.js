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
    // "Repor chaves padrão em Config" saiu daqui: `criarEstruturaPlanilha`
    // termina chamando `popularConfigPadrao`, então o item era subconjunto
    // estrito do de cima — dois botões, um resultado. A função continua, só
    // não tem mais entrada própria no menu.
    .addItem('Criar / atualizar estrutura da planilha', 'criarEstruturaPlanilha')
    .addItem('Pré-cadastrar obras espíritas conhecidas', 'preCadastrarAcervo')
    .addSeparator()
    .addItem('Sincronizar reuniões com o Google Agenda', 'sincronizarAgora')
    .addItem('Instalar gatilhos automáticos', 'instalarGatilhos')
    .addItem('Ver gatilhos instalados', 'verGatilhos')
    .addSubMenu(SpreadsheetApp.getUi().createMenu('Rodar agora (teste)')
      .addItem('Avisar atrasos por e-mail', 'testarAvisoDeAtrasos')
      .addItem('Cobrar o tema da próxima reunião', 'testarCobrancaDeTema')
      .addItem('Fazer backup da planilha', 'testarBackup'))
    .addSeparator()
    .addItem('Diagnóstico: busca de livros do Google', 'diagnosticarGoogleBooks')
    .addItem('Diagnóstico: calendários visíveis', 'diagnosticarAgenda')
    .addToUi();
}

function doGet(evento) {
  var parametros = (evento && evento.parameter) || {};

  // O cartaz da estante é outra página, com a biblioteca de QR que as telas
  // do dia a dia não precisam carregar.
  if (parametros.cartaz !== undefined) return paginaDoCartaz_();

  var pagina = HtmlService.createTemplateFromFile('ui/index');

  // Nada de nome de casa hardcoded: vem do Config, como toda configuração.
  pagina.nomeCasa = lerConfig('nome_casa', 'Biblioteca');

  // O link público do sistema, para o botão que abre o cartaz. Não é segredo:
  // é o mesmo link que todo voluntário tem.
  pagina.urlSistema = comoJsNoHtml_(limparCampo_(lerConfig('url_sistema', '')));

  // `?pegar` é o QR da estante: abre direto na tela de pegar livro, que não
  // tem aba — quem navega pelo sistema de casa não esbarra nela.
  pagina.telaInicial = comoJsNoHtml_(parametros.pegar !== undefined ? 'pegar' : '');

  // `url_agendamento` NÃO entra aqui, e a ausência é a correção de um bug.
  //
  // Ela chegou a entrar, e o convite "Vai palestrar?" aparecia para qualquer
  // visitante. Isso contraria a seção 5 da especificação — o link da página de
  // agendamento se distribui só no grupo de palestrantes, porque quem o tem
  // reserva uma segunda-feira. E esconder o bloco na tela não resolveria:
  // valor que passa pelo template vai para o código-fonte da página, que
  // qualquer um lê.
  //
  // Quem tem direito ao link pede por `verLinkDeAgendamento`, com a sessão.

  // O link mágico chega como ?codigo=. Trocar aqui, no carregamento, é o que
  // permite ao código ser de uso único: ele morre antes de a página existir.
  //
  // A sessão vai para o HTML e o cliente a guarda. Ela nunca volta a aparecer
  // numa URL — URL vai parar em histórico, print e grupo de WhatsApp.
  pagina.entrada = 'null';
  var codigo = parametros.codigo;
  if (codigo) {
    var aberta = abrirSessao(codigo);
    if (aberta) pagina.entrada = JSON.stringify(aberta);
  }

  return pagina.evaluate()
    .setTitle(pagina.nomeCasa)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * O cartaz com o QR code que vai impresso na estante.
 *
 * Público e sem dado nenhum: só o nome da casa e o link da tela de pegar livro.
 * O link sai de `url_sistema`, o mesmo que o e-mail de acesso usa com
 * `?codigo=` — se aquele funciona, este também. Se o link mudar um dia, é só
 * imprimir o cartaz de novo.
 */
function paginaDoCartaz_() {
  var cartaz = HtmlService.createTemplateFromFile('ui/cartaz');
  cartaz.nomeCasa = lerConfig('nome_casa', 'Biblioteca');

  // `&` se o link já tiver `?` — encurtador às vezes tem.
  var url = limparCampo_(lerConfig('url_sistema', ''));
  cartaz.linkDoQr = comoJsNoHtml_(url ? url + (url.indexOf('?') === -1 ? '?' : '&') + 'pegar=1' : '');

  // A regra vem do Config, como o limite que a tela aplica: um cartaz que diz
  // "um por vez" enquanto o sistema aceita dois ensina a regra errada.
  var limite = lerConfigNumero('limite_autoatendimento', 1);
  cartaz.regra = limite <= 0
    ? 'O empréstimo pela estante está suspenso. Procure o balcão.'
    : (limite === 1 ? 'Um livro por vez.' : 'Até ' + limite + ' livros por vez.') +
      ' A devolução é no balcão.';

  return cartaz.evaluate()
    .setTitle('Cartaz da estante — ' + cartaz.nomeCasa)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Valor pronto para ir dentro de um <script> da página: JSON, com `<` trocado
 * pelo escape. Sem isso, um "</script>" num texto do Config fecharia o bloco
 * no meio e o resto viraria HTML.
 */
function comoJsNoHtml_(valor) {
  return JSON.stringify(valor).replace(/</g, '\\u003c');
}

/** Injeta um arquivo HTML dentro de outro. Padrão do HtmlService. */
function include(nomeArquivo) {
  return HtmlService.createHtmlOutputFromFile(nomeArquivo).getContent();
}
