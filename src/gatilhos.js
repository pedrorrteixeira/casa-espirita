/**
 * gatilhos.js — instalação e execução dos gatilhos automáticos.
 *
 * Gatilho não se cria sozinho: alguém precisa rodar `instalarGatilhos()` uma
 * vez. Está no menu da planilha, porque o editor do Apps Script não abre no
 * navegador em uso (ver Fase 0 no PLANO.md).
 *
 * COTAS DE CONTA GMAIL COMUM, que governam este arquivo:
 *   - 90 minutos de execução acumulada por dia, 6 minutos por execução;
 *   - 100 destinatários de e-mail por dia.
 *
 * Por isso: um gatilho diário só, leitura em lote, e nada de enviar e-mail
 * dentro de laço.
 */

/**
 * Cria os gatilhos. Idempotente: remove os que este arquivo instalou antes de
 * criar de novo, senão rodar duas vezes deixa a sincronização acontecendo em
 * dobro — e consumindo o dobro da cota.
 */
function instalarGatilhos() {
  var funcoes = ['gatilhoDiario'];

  var removidos = 0;
  ScriptApp.getProjectTriggers().forEach(function (gatilho) {
    if (funcoes.indexOf(gatilho.getHandlerFunction()) !== -1) {
      ScriptApp.deleteTrigger(gatilho);
      removidos++;
    }
  });

  ScriptApp.newTrigger('gatilhoDiario')
    .timeBased()
    .atHour(5)          // de madrugada: ninguém está usando o sistema
    .everyDays(1)
    .create();

  var recado = 'Gatilho diário instalado para as 5h.' +
    (removidos ? ' (' + removidos + ' antigo(s) removido(s).)' : '');

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
  mostrarRelatorio_('Gatilhos', 'Instalados:\n\n' + linhas.join('\n'));
}

/**
 * O gatilho diário.
 *
 * Uma função só para tudo o que é diário, e não um gatilho por tarefa: cada
 * gatilho tem custo de agendamento, e a cota é de 90 minutos por dia.
 *
 * Cada tarefa é isolada num try: se a sincronização falhar porque alguém
 * apagou o calendário, os avisos de atraso ainda precisam sair.
 */
function gatilhoDiario() {
  var problemas = [];

  try {
    sincronizarReunioes();
  } catch (erro) {
    problemas.push('sincronizar reuniões: ' + erro.message);
  }

  if (problemas.length) {
    // No Log, não por e-mail: erro de gatilho acontece em série — calendário
    // apagado falha todo dia — e um e-mail por dia queimaria a cota de 100.
    registrarLog_('gatilho', 'erro', 'gatilho_diario', '', problemas.join(' | '));
  }
}
