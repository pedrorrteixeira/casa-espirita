/**
 * gatilhos.js — o que roda sozinho, e os e-mails que ele manda.
 *
 * Gatilho não se cria sozinho: alguém roda `instalarGatilhos()` uma vez, pelo
 * menu da planilha (o editor do Apps Script não abre no navegador em uso —
 * ver Fase 0 no PLANO.md).
 *
 * AS COTAS QUE GOVERNAM ESTE ARQUIVO, em conta Gmail comum:
 *   - 100 destinatários de e-mail por dia;
 *   - 90 minutos de execução acumulada por dia, 6 minutos por execução.
 *
 * Daí três disciplinas, e nenhuma delas é opcional:
 *   1. Nunca enviar e-mail dentro de laço sem checar a cota antes.
 *   2. Um aviso consolidado, nunca um por item.
 *   3. Não reenviar o mesmo aviso todo dia — cota é só metade do motivo; a
 *      outra é que aviso repetido para de ser lido.
 */

var CHAVE_ULTIMO_AVISO = 'ultimo_aviso_atrasos';
var CHAVE_ULTIMA_COBRANCA = 'ultima_cobranca_tema';
var DIAS_PARA_REENVIAR_AVISO = 7;
var DIAS_DE_ANTECEDENCIA_TEMA = 7;
var BACKUPS_A_MANTER = 12;

// Nomes longos de propósito: são o que distingue o que este código criou do
// que é de outra pessoa. A poda só toca em arquivo com este prefixo.
var PASTA_BACKUP = 'Backups — Biblioteca Casa Espírita';
var PREFIXO_BACKUP = 'Biblioteca — backup ';

// --- Instalação --------------------------------------------------------------

/**
 * Cria os três gatilhos. Idempotente: remove os que este arquivo instalou
 * antes de criar de novo. Rodar duas vezes sem isso deixaria tudo acontecendo
 * em dobro, e consumindo o dobro dos 90 minutos diários.
 */
function instalarGatilhos() {
  var nossos = ['gatilhoDiario', 'gatilhoSemanal', 'gatilhoMensal'];

  var removidos = 0;
  ScriptApp.getProjectTriggers().forEach(function (gatilho) {
    if (nossos.indexOf(gatilho.getHandlerFunction()) !== -1) {
      ScriptApp.deleteTrigger(gatilho);
      removidos++;
    }
  });

  // De madrugada: ninguém está usando o sistema, e a cota de execução do dia
  // está inteira.
  ScriptApp.newTrigger('gatilhoDiario').timeBased().atHour(5).everyDays(1).create();

  // Quinta: dá ao palestrante o fim de semana para pensar no tema antes da
  // reunião de segunda.
  ScriptApp.newTrigger('gatilhoSemanal')
    .timeBased().onWeekDay(ScriptApp.WeekDay.THURSDAY).atHour(9).create();

  ScriptApp.newTrigger('gatilhoMensal')
    .timeBased().onMonthDay(1).atHour(4).create();

  var recado =
    'Instalados:\n' +
    '• diário, 5h — sincroniza a agenda e avisa atrasos\n' +
    '• semanal, quinta 9h — cobra o tema da próxima reunião\n' +
    '• mensal, dia 1 às 4h — copia a planilha para a pasta Backups' +
    (removidos ? '\n\n(' + removidos + ' gatilho(s) antigo(s) removido(s).)' : '');

  SpreadsheetApp.getUi().alert('Gatilhos', recado, SpreadsheetApp.getUi().ButtonSet.OK);
  return recado;
}

/** Mostra o que está instalado. Sem isso não há como conferir sem o editor. */
function verGatilhos() {
  var gatilhos = ScriptApp.getProjectTriggers();
  if (!gatilhos.length) {
    mostrarRelatorio_('Gatilhos', 'Nenhum gatilho instalado.\n\n' +
      'Use "Biblioteca → Instalar gatilhos automáticos".');
    return;
  }

  var linhas = gatilhos.map(function (gatilho) {
    return '• ' + gatilho.getHandlerFunction() + '  (' + gatilho.getEventType() + ')';
  });
  linhas.push('');
  linhas.push('Cota de e-mail restante hoje: ' +
    MailApp.getRemainingDailyQuota() + ' destinatário(s).');

  mostrarRelatorio_('Gatilhos', 'Instalados:\n\n' + linhas.join('\n'));
}

// --- Os gatilhos -------------------------------------------------------------

/**
 * Diário: sincroniza a agenda e avisa o admin sobre atrasos.
 *
 * Cada tarefa isolada num try. Se a sincronização falhar porque alguém apagou
 * o calendário, o aviso de atraso ainda precisa sair.
 */
function gatilhoDiario() {
  executarTarefas_('gatilho_diario', [
    { nome: 'sincronizar reuniões', fazer: sincronizarReunioes },
    { nome: 'avisar atrasos', fazer: avisarAtrasos }
  ]);
}

/** Semanal: cobra o tema de quem palestra na próxima reunião. */
function gatilhoSemanal() {
  executarTarefas_('gatilho_semanal', [
    { nome: 'cobrar tema', fazer: cobrarTema }
  ]);
}

/** Mensal: cópia de segurança da planilha. */
function gatilhoMensal() {
  executarTarefas_('gatilho_mensal', [
    { nome: 'backup', fazer: fazerBackup }
  ]);
}

/**
 * Roda uma lista de tarefas, isolando o erro de cada uma.
 *
 * Falha vai para o `Log`, não por e-mail: erro de gatilho acontece em série —
 * calendário apagado falha todo dia — e um e-mail diário de erro queimaria a
 * cota de 100 que existe para avisar sobre livros.
 */
function executarTarefas_(qual, tarefas) {
  var problemas = [];

  tarefas.forEach(function (tarefa) {
    try {
      tarefa.fazer();
    } catch (erro) {
      problemas.push(tarefa.nome + ': ' + erro.message);
    }
  });

  if (problemas.length) {
    registrarLog_('gatilho', 'erro', qual, '', problemas.join(' | '));
  }
}

// --- Aviso de atrasos --------------------------------------------------------

/**
 * Um e-mail ao admin com todos os atrasos. Nunca um por atraso (seção 7).
 *
 * Só envia quando a lista MUDOU, ou quando passou uma semana desde o último
 * envio. A especificação pede gatilho diário, e ele roda diariamente — o que
 * não roda diariamente é o incômodo. Receber a mesma lista todo dia é como um
 * aviso deixa de ser lido, e aí ele para de servir para o que existe.
 */
function avisarAtrasos() {
  var destinatario = limparCampo_(lerConfig('email_admin', ''));
  if (!destinatario) {
    throw new Error('Falta `email_admin` na aba Config. Sem ele não há para quem avisar.');
  }

  var aviso = montarAvisoDeAtrasos(listarEmprestados(true));

  var propriedades = PropertiesService.getScriptProperties();
  var anterior = propriedades.getProperty(CHAVE_ULTIMO_AVISO);
  var memoria = anterior ? JSON.parse(anterior) : null;

  if (!aviso) {
    // Nada atrasado: esquece o que foi avisado, para o próximo atraso voltar
    // a ser novidade.
    if (memoria) propriedades.deleteProperty(CHAVE_ULTIMO_AVISO);
    return;
  }

  var hoje = new Date();
  if (memoria && memoria.chave === aviso.chave) {
    var dias = (hoje.getTime() - new Date(memoria.quando).getTime()) / 86400000;
    if (dias < DIAS_PARA_REENVIAR_AVISO) return;
  }

  if (!enviarEmail_(destinatario, aviso.assunto, aviso.corpo, 'aviso de atraso')) return;

  propriedades.setProperty(CHAVE_ULTIMO_AVISO,
    JSON.stringify({ chave: aviso.chave, quando: hoje.toISOString() }));
  registrarLog_('gatilho', 'avisar', 'atrasos', '', aviso.chave);
}

// --- Cobrança de tema --------------------------------------------------------

/**
 * Pede o tema a quem palestra na próxima reunião, se ainda não escreveu.
 *
 * Um destinatário só, e não uma vez por reunião do ano: cobrar com dois meses
 * de antecedência é incômodo, não lembrete.
 */
function cobrarTema() {
  var reuniao = escolherReuniaoSemTema(
    lerAba_(ABA_REUNIOES), new Date(), DIAS_DE_ANTECEDENCIA_TEMA);
  if (!reuniao) return;

  var propriedades = PropertiesService.getScriptProperties();
  // Uma cobrança por reunião. Sem isso, um palestrante que não responde
  // receberia o mesmo pedido toda quinta até a data chegar.
  if (propriedades.getProperty(CHAVE_ULTIMA_COBRANCA) === String(reuniao.id_reuniao)) {
    return;
  }

  var quando = formatarData_(reuniao.data);
  var corpo = [
    'Olá, ' + limparCampo_(reuniao.nome_reservado) + '.',
    '',
    'Você está inscrito para a reunião pública de ' + quando +
      (limparCampo_(reuniao.horario) ? ', às ' + reuniao.horario : '') + '.',
    '',
    'O tema ainda não foi informado. Você pode escrevê-lo no sistema da casa,',
    'na aba Agenda:',
    '',
    lerConfig('url_sistema', '(peça o link a quem coordena)'),
    '',
    'Se não puder mais palestrar nessa data, cancele a reserva na mesma página',
    'de agendamento em que você se inscreveu, para a data abrir para outra',
    'pessoa.',
    '',
    '—',
    'Aviso automático do sistema da biblioteca. Não responda a este e-mail.'
  ].join('\n');

  var enviado = enviarEmail_(
    limparCampo_(reuniao.email_reservado),
    'Reunião de ' + quando + ': qual será o tema?',
    corpo,
    'cobrança de tema'
  );
  if (!enviado) return;

  propriedades.setProperty(CHAVE_ULTIMA_COBRANCA, String(reuniao.id_reuniao));
  // Id, nunca o e-mail: o Log é visível e fica retido.
  registrarLog_('gatilho', 'cobrar_tema', 'reuniao', reuniao.id_reuniao, '');
}

// --- Backup ------------------------------------------------------------------

/**
 * Cópia mensal da planilha numa pasta `Backups`, mantendo as 12 últimas.
 *
 * É a única proteção contra alguém apagar uma coluna sem perceber. O Drive tem
 * histórico de versões, mas ele é difícil de navegar sob pressão, e ninguém
 * lembra dele na hora do susto.
 */
function fazerBackup() {
  var planilha = SpreadsheetApp.getActiveSpreadsheet();
  var pasta = pastaDeBackups_();

  var nome = PREFIXO_BACKUP +
    Utilities.formatDate(new Date(), SETUP_FUSO, 'yyyy-MM-dd');

  DriveApp.getFileById(planilha.getId()).makeCopy(nome, pasta);

  var apagados = podarBackups_(pasta);
  registrarLog_('gatilho', 'backup', 'planilha', '',
    nome + (apagados ? ' · ' + apagados + ' antigo(s) removido(s)' : ''));
}

/**
 * A pasta das cópias.
 *
 * O nome é longo de propósito. `getFoldersByName` varre o Drive inteiro,
 * inclusive pastas compartilhadas: uma pasta chamada só "Backups" tem chance
 * real de já existir por outro motivo — e a poda passaria a mexer nela.
 */
function pastaDeBackups_() {
  var achadas = DriveApp.getFoldersByName(PASTA_BACKUP);
  return achadas.hasNext() ? achadas.next() : DriveApp.createFolder(PASTA_BACKUP);
}

/**
 * Mantém só as 12 cópias mais recentes.
 *
 * SÓ MEXE NO QUE ESTE CÓDIGO CRIOU. A versão anterior mandava para a lixeira
 * qualquer arquivo da pasta, sem olhar o nome — se alguém guardasse um
 * documento ali, ou se a pasta já existisse por outro motivo, o gatilho mensal
 * apagaria material alheio. Era o defeito mais perigoso do sistema: destruía
 * dado fora do nosso alcance, uma vez por mês, sem ninguém ver.
 *
 * Manda para a lixeira, não apaga de vez: se a poda ainda tiver defeito, o
 * arquivo é recuperável por 30 dias. A regra 15 fala de linha de planilha; aqui
 * a limpeza é o objetivo.
 */
function podarBackups_(pasta) {
  var copias = [];
  var arquivos = pasta.getFiles();

  while (arquivos.hasNext()) {
    var arquivo = arquivos.next();
    if (arquivo.getName().indexOf(PREFIXO_BACKUP) !== 0) continue;   // não é nosso
    copias.push({ arquivo: arquivo, quando: arquivo.getDateCreated().getTime() });
  }

  if (copias.length <= BACKUPS_A_MANTER) return 0;

  copias.sort(function (a, b) { return b.quando - a.quando; });   // recente primeiro

  var sobrando = copias.slice(BACKUPS_A_MANTER);
  sobrando.forEach(function (copia) { copia.arquivo.setTrashed(true); });
  return sobrando.length;
}

// --- Envio, com guarda de cota -----------------------------------------------

/**
 * Envia um e-mail depois de conferir a cota do dia.
 *
 * Devolve false quando não enviou, para quem chamou não gravar que avisou.
 * A checagem existe porque estourar a cota faz o `MailApp` lançar exceção, e
 * o gatilho inteiro morreria no meio — levando junto o que viesse depois.
 */
function enviarEmail_(destinatario, assunto, corpo, oQue) {
  if (!destinatario) {
    registrarLog_('gatilho', 'erro', 'email', '', oQue + ': sem destinatário');
    return false;
  }

  var restante = MailApp.getRemainingDailyQuota();
  if (restante < 1) {
    registrarLog_('gatilho', 'cota', 'email', '',
      oQue + ' não enviado: cota diária de e-mail esgotada');
    return false;
  }

  MailApp.sendEmail({ to: destinatario, subject: assunto, body: corpo });
  return true;
}

// --- Execução manual, para testar --------------------------------------------
// As automações rodam de madrugada, na quinta e no dia 1º. Esperar um mês para
// descobrir que o backup não funciona não é forma de verificar nada.

function testarAvisoDeAtrasos() {
  rodarAgora_('Aviso de atrasos', avisarAtrasos,
    'Se havia atraso e a lista mudou desde o último envio, o e-mail saiu para ' +
    'o `email_admin`.\n\nNão sair pode ser certo: nada atrasado, ou a mesma ' +
    'lista já avisada há menos de ' + DIAS_PARA_REENVIAR_AVISO + ' dias.');
}

function testarCobrancaDeTema() {
  rodarAgora_('Cobrança de tema', cobrarTema,
    'Se há reunião nos próximos ' + DIAS_DE_ANTECEDENCIA_TEMA + ' dias, sem ' +
    'tema e com e-mail, o pedido saiu.\n\nCada reunião só é cobrada uma vez.');
}

function testarBackup() {
  rodarAgora_('Backup', fazerBackup,
    'A cópia está no seu Drive, na pasta "Backups".\n\nSão mantidas as ' +
    BACKUPS_A_MANTER + ' mais recentes; as anteriores vão para a lixeira.');
}

/**
 * Roda uma automação na hora e mostra o resultado numa janela.
 *
 * Deixa o erro aparecer com a mensagem inteira, ao contrário do gatilho, que
 * o manda para o `Log`: aqui há alguém olhando a tela, e é para ele que a
 * mensagem serve.
 */
function rodarAgora_(oQue, fazer, explicacao) {
  var ui = SpreadsheetApp.getUi();
  try {
    fazer();
    ui.alert(oQue,
      'Executado.\n\n' + explicacao +
      '\n\nCota de e-mail restante hoje: ' + MailApp.getRemainingDailyQuota() + '.',
      ui.ButtonSet.OK);
  } catch (erro) {
    ui.alert(oQue + ' — não deu certo', erro.message, ui.ButtonSet.OK);
  }
}
