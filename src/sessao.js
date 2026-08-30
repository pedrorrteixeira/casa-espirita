/**
 * sessao.js — quem é quem, e o que cada um pode.
 *
 * Fase 5. Existe porque o Modelo A apertou: as telas que gravam moram numa URL
 * de acesso anônimo, e esconder botão não é proteção — qualquer pessoa com o
 * link chama a função do servidor direto.
 *
 * COMO FUNCIONA
 * -------------
 * 1. A pessoa informa o e-mail. Se estiver em `Pessoas` com perfil de
 *    voluntário, recebe um link com um CÓDIGO de uso único, válido 30 minutos.
 * 2. Abrir o link troca o código por uma SESSÃO de 12 horas — um plantão.
 *    O código é destruído na troca.
 * 3. Toda função que grava exige a sessão e confere o perfil no servidor.
 *
 * POR QUE DOIS SEGREDOS E NÃO UM
 * ------------------------------
 * O código vive no histórico do navegador, no e-mail, e às vezes no print que
 * alguém manda no grupo. Ele precisa ser curto e descartável. A sessão nunca
 * aparece numa URL: fica no armazenamento do navegador e vai em cada chamada.
 *
 * O QUE ISTO NÃO É
 * ----------------
 * Não é autenticação forte. Quem tem acesso à caixa de e-mail do voluntário
 * entra. Para uma casa espírita com meia dúzia de voluntários é proporcional —
 * e é o que a seção 6 desenhou, dado o D10 (nada de senha em planilha).
 */

var MINUTOS_DO_CODIGO = 30;
var HORAS_DA_SESSAO = 12;

var PREFIXO_CODIGO = 'codigo_';
var PREFIXO_SESSAO = 'sessao_';

// --- Entrada -----------------------------------------------------------------

/**
 * Manda o link de acesso, se o e-mail for de um voluntário.
 *
 * Responde SEMPRE a mesma coisa, ache ou não ache. Dizer "esse e-mail não está
 * cadastrado" transformaria a tela numa forma de descobrir quem frequenta a
 * casa, um e-mail por vez.
 */
function pedirAcesso(email) {
  var recado = 'Se esse e-mail estiver cadastrado como voluntário, o link ' +
    'chega em instantes. Ele vale por ' + MINUTOS_DO_CODIGO + ' minutos.';

  var alvo = normalizarTexto(email);
  if (!alvo || alvo.indexOf('@') === -1) return recado;

  var pessoa = null;
  lerPessoas().forEach(function (candidata) {
    if (normalizarTexto(candidata.email) === alvo) pessoa = candidata;
  });

  if (!pessoa) return recado;
  if (String(pessoa.ativo).trim() !== 'SIM') return recado;

  // Quem entra: voluntário (perfil acima de consulta) OU palestrante.
  //
  // O palestrante não é voluntário e o perfil dele costuma ser `consulta`, mas
  // ele precisa entrar para escrever o tema da PRÓPRIA palestra — que até aqui
  // só um atendente conseguia fazer por ele. A flag no cadastro existia e não
  // servia para nada.
  var perfil = limparCampo_(pessoa.perfil) || 'consulta';
  var ehPalestrante = String(pessoa.palestrante).trim() === 'SIM';
  if (perfil === 'consulta' && !ehPalestrante) return recado;

  var codigo = gerarSegredo_();
  PropertiesService.getScriptProperties().setProperty(
    PREFIXO_CODIGO + codigo,
    JSON.stringify({
      id_pessoa: pessoa.id_pessoa,
      expira: Date.now() + MINUTOS_DO_CODIGO * 60000
    })
  );

  var url = limparCampo_(lerConfig('url_sistema', ''));
  var link = url ? url + '?codigo=' + codigo : '(falta `url_sistema` na aba Config)';

  enviarEmail_(
    pessoa.email,
    'Seu acesso ao sistema da biblioteca',
    [
      'Olá, ' + pessoa.nome + '.',
      '',
      'Use este link para entrar:',
      '',
      link,
      '',
      'Ele vale por ' + MINUTOS_DO_CODIGO + ' minutos e serve uma vez só.',
      'Depois de entrar, você fica conectado por ' + HORAS_DA_SESSAO + ' horas.',
      '',
      'Se não foi você que pediu, ignore — sozinho, este link não faz nada.',
      '',
      '—',
      'Sistema da biblioteca. Não responda a este e-mail.'
    ].join('\n'),
    'link de acesso'
  );

  // Id, nunca o e-mail: o Log é visível a quem abre a planilha.
  registrarLog_('sistema', 'pedir_acesso', 'pessoa', pessoa.id_pessoa, '');
  return recado;
}

/**
 * Troca o código de uso único por uma sessão. Chamada pelo `doGet`.
 * Devolve null se o código não existe, já foi usado ou venceu.
 */
function abrirSessao(codigo) {
  var chave = PREFIXO_CODIGO + limparCampo_(codigo);
  var propriedades = PropertiesService.getScriptProperties();

  var guardado = propriedades.getProperty(chave);
  if (!guardado) return null;

  // Destrói antes de validar: mesmo um código vencido não pode sobrar para uma
  // segunda tentativa.
  propriedades.deleteProperty(chave);

  var dados = JSON.parse(guardado);
  if (Date.now() > dados.expira) return null;

  var pessoa = lerPessoa_(dados.id_pessoa);
  if (!pessoa || String(pessoa.ativo).trim() !== 'SIM') return null;

  var sessao = gerarSegredo_();
  propriedades.setProperty(
    PREFIXO_SESSAO + sessao,
    JSON.stringify({
      id_pessoa: pessoa.id_pessoa,
      expira: Date.now() + HORAS_DA_SESSAO * 3600000
    })
  );

  registrarLog_(pessoa.nome, 'entrar', 'pessoa', pessoa.id_pessoa, '');

  return {
    sessao: sessao,
    nome: pessoa.nome,
    perfil: limparCampo_(pessoa.perfil) || 'consulta',
    palestrante: String(pessoa.palestrante).trim() === 'SIM'
  };
}

/** Encerra a sessão. O botão de sair precisa existir: plantão em celular
 *  emprestado é o caso comum. */
function encerrarSessao(sessao) {
  PropertiesService.getScriptProperties()
    .deleteProperty(PREFIXO_SESSAO + limparCampo_(sessao));
  return true;
}

/** Quem a tela deve mostrar. Devolve null quando a sessão não vale mais. */
function verSessao(sessao) {
  var quem = donoDaSessao_(sessao);
  if (!quem) return null;
  return { nome: quem.nome, perfil: quem.perfil, palestrante: quem.palestrante };
}

// --- Guarda ------------------------------------------------------------------

/**
 * A guarda que toda função de escrita chama antes de qualquer coisa.
 *
 * Devolve a pessoa autenticada, ou estoura. E é o servidor que decide: a tela
 * esconde botão por conveniência, não por segurança — `google.script.run` é
 * chamável direto do console do navegador.
 *
 * O perfil é lido da planilha AGORA, não do que foi guardado na sessão.
 * Rebaixar alguém passa a valer na hora, sem esperar as 12 horas vencerem.
 */
function exigir_(sessao, acao) {
  var quem = donoDaSessao_(sessao);
  if (!quem) {
    throw new Error('Sua sessão expirou. Entre de novo para continuar.');
  }

  if (!podeFazer(quem.perfil, acao)) {
    throw new Error(
      'Seu acesso (' + quem.perfil + ') não permite esta ação. ' +
      'Fale com quem administra o sistema.'
    );
  }

  return quem;
}

function donoDaSessao_(sessao) {
  var chave = PREFIXO_SESSAO + limparCampo_(sessao);
  if (chave === PREFIXO_SESSAO) return null;

  var propriedades = PropertiesService.getScriptProperties();
  var guardado = propriedades.getProperty(chave);
  if (!guardado) return null;

  var dados = JSON.parse(guardado);
  if (Date.now() > dados.expira) {
    propriedades.deleteProperty(chave);
    return null;
  }

  var pessoa = lerPessoa_(dados.id_pessoa);
  if (!pessoa || String(pessoa.ativo).trim() !== 'SIM') return null;

  return {
    id_pessoa: pessoa.id_pessoa,
    nome: pessoa.nome,
    email: limparCampo_(pessoa.email),
    perfil: limparCampo_(pessoa.perfil) || 'consulta',
    palestrante: String(pessoa.palestrante).trim() === 'SIM'
  };
}

/**
 * Segredo aleatório em hexadecimal.
 *
 * `Utilities.getUuid()` é aleatório de verdade (v4) e vem do Google; um
 * `Math.random()` seria adivinhável. Dois juntos dão 64 caracteres, o que
 * torna tentativa por força bruta inútil contra a cota de execução do Apps
 * Script muito antes de ser útil contra o segredo.
 */
function gerarSegredo_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
}

/**
 * Apaga códigos e sessões vencidos. Chamada pelo gatilho diário.
 *
 * O `PropertiesService` tem 500KB no total. Sem limpeza, um ano de plantões
 * encheria o espaço e as gravações passariam a falhar — num lugar que ninguém
 * relacionaria com login.
 */
function limparSessoesVencidas() {
  var propriedades = PropertiesService.getScriptProperties();
  var todas = propriedades.getProperties();
  var agora = Date.now();
  var apagadas = 0;

  Object.keys(todas).forEach(function (chave) {
    if (chave.indexOf(PREFIXO_CODIGO) !== 0 && chave.indexOf(PREFIXO_SESSAO) !== 0) {
      return;
    }
    try {
      if (agora > JSON.parse(todas[chave]).expira) {
        propriedades.deleteProperty(chave);
        apagadas++;
      }
    } catch (erro) {
      propriedades.deleteProperty(chave);   // ilegível: não serve para nada
      apagadas++;
    }
  });

  return apagadas;
}
