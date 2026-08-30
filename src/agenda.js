/**
 * agenda.js — Google Agenda → aba `Reunioes`.
 *
 * SENTIDO ÚNICO (regra 12). O calendário manda, a planilha obedece. Nada aqui
 * cria, altera ou apaga evento: quem reserva é o palestrante, pela página de
 * agendamento, e é ela que garante uma reunião por data (D4). Se este arquivo
 * um dia chamar `createEvent`, é bug.
 *
 * A decisão de o que gravar é de `planejarSincronizacao()`, em `dominio.js`,
 * que é pura e testada. Aqui só se lê o calendário, traduz o evento para o
 * nosso formato, e aplica o plano.
 */

var JANELA_PASSADO_DIAS = 30;    // o suficiente para pegar cancelamento recente
var JANELA_FUTURO_DIAS = 400;    // a página de agendamento abre 365 dias

/**
 * Lê os eventos do período e reflete na aba `Reunioes`.
 *
 * Chamada pelo gatilho diário e pelo menu. Devolve o resumo do que fez, para o
 * menu mostrar e para o log do gatilho registrar.
 */
function sincronizarReunioes() {
  var idCalendario = limparCampo_(lerConfig('id_calendario', ''));
  if (!idCalendario) {
    throw new Error(
      'Falta o `id_calendario` na aba Config. Ele é o ID do calendário ' +
      '"Reuniões Públicas" — está em Google Agenda → configurações do ' +
      'calendário → "ID do calendário".'
    );
  }

  var calendario = CalendarApp.getCalendarById(idCalendario);
  if (!calendario) {
    throw new Error(
      'Não achei o calendário "' + idCalendario + '". Confira o ID na aba ' +
      'Config e se ele pertence a esta conta.'
    );
  }

  var hoje = new Date();
  var janela = {
    inicio: new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - JANELA_PASSADO_DIAS),
    fim: new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + JANELA_FUTURO_DIAS)
  };

  // O fuso e o id são lidos UMA vez e passados adiante. Lê-los dentro de
  // `traduzirEvento_` significava reler a aba Config inteira a cada evento —
  // com as segundas de um ano, cinquenta e duas leituras por sincronização.
  var contexto = {
    idCalendario: normalizarTexto(idCalendario),
    fuso: SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone()
  };

  var eventos = calendario.getEvents(janela.inicio, janela.fim)
    .map(function (evento) { return traduzirEvento_(evento, contexto); });

  return comTrava_(function () {
    var plano = planejarSincronizacao(
      eventos, lerAba_(ABA_REUNIOES), lerPessoas(), janela);

    plano.criar.forEach(function (nova) {
      nova.id_reuniao = proximoId_(ABA_REUNIOES, 'id_reuniao');
      escreverLinha_(ABA_REUNIOES, nova);
    });

    plano.atualizar.forEach(function (item) {
      atualizarCelulas_(ABA_REUNIOES, item._linha, item.mudancas);
    });

    plano.cancelar.forEach(function (item) {
      atualizarCelulas_(ABA_REUNIOES, item._linha, item.mudancas);
    });

    var resumo = {
      lidos: eventos.length,
      criadas: plano.criar.length,
      atualizadas: plano.atualizar.length,
      canceladas: plano.cancelar.length
    };

    // Só registra quando houve mudança: um gatilho diário que não faz nada
    // encheria o Log de linhas inúteis e esconderia o que importa.
    if (resumo.criadas || resumo.atualizadas || resumo.canceladas) {
      registrarLog_('gatilho', 'sincronizar', 'reunioes', '',
        resumo.criadas + ' nova(s), ' + resumo.atualizadas + ' alterada(s), ' +
        resumo.canceladas + ' cancelada(s)');
    }

    return resumo;
  });
}

/**
 * Traduz um evento do Google para o nosso formato.
 *
 * A página de agendamento cria o evento com quem reservou na lista de
 * convidados, então é de lá que vêm nome e e-mail. O título do evento serve
 * de reserva: em alguns formatos ele traz o nome e a lista de convidados vem
 * vazia.
 *
 * O horário é gravado como TEXTO ("19:30"). Como hora, o Sheets converteria
 * para fração de dia e a exibição dependeria do fuso da planilha — para um
 * campo que nunca é calculado, texto é mais honesto.
 */
function traduzirEvento_(evento, contexto) {
  var inicio = evento.getStartTime();
  var convidados = evento.getGuestList();

  var nome = '';
  var email = '';

  // Ignora a própria casa na lista: quem interessa é quem reservou.
  for (var i = 0; i < convidados.length; i++) {
    var candidato = normalizarTexto(convidados[i].getEmail());
    if (candidato && candidato !== contexto.idCalendario) {
      email = convidados[i].getEmail();
      nome = convidados[i].getName() || '';
      break;
    }
  }

  if (!nome) nome = limparCampo_(evento.getTitle());

  return {
    id_evento_calendar: evento.getId(),
    data: new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate()),
    horario: Utilities.formatDate(inicio, contexto.fuso, 'HH:mm'),
    nome_reservado: nome,
    email_reservado: email,
    data_inscricao: evento.getDateCreated()
  };
}

// --- API das telas -----------------------------------------------------------

/**
 * Próximas reuniões, para a tela de agenda.
 *
 * Esta tela é aberta a todos: mostra quem palestra e sobre o quê, que é
 * informação pública da casa. Mas NÃO devolve o e-mail de quem reservou —
 * esse é dado de contato, e vale a mesma regra da tela de pessoa.
 */
function listarProximasReunioes(quantas, sessao) {
  var limite = Number(quantas);
  if (!isFinite(limite) || limite <= 0) limite = 12;

  // Quem está olhando, se estiver identificado. Serve só para marcar quais
  // reuniões são dele — a lista em si é pública e não muda.
  var eu = sessao ? donoDaSessao_(sessao) : null;
  var hoje = soDataDeHoje_();

  return lerAba_(ABA_REUNIOES)
    .filter(function (reuniao) {
      if (limparCampo_(reuniao.status) === STATUS_CANCELADA) return false;
      var quando = comoDataSegura_(reuniao.data);
      return quando && quando.getTime() >= hoje.getTime();
    })
    .sort(function (a, b) {
      return comoDataSegura_(a.data).getTime() - comoDataSegura_(b.data).getTime();
    })
    .slice(0, limite)
    .map(function (reuniao) {
      return {
        id_reuniao: reuniao.id_reuniao,
        data: formatarData_(reuniao.data),
        horario: reuniao.horario,
        palestrante: limparCampo_(reuniao.nome_reservado),
        tema: limparCampo_(reuniao.tema),
        status: limparCampo_(reuniao.status),
        minha: ehMinhaReuniao_(reuniao, eu)
      };
    });
}

/**
 * A reunião é de quem está olhando?
 *
 * Casa por id_palestrante — o vínculo que a sincronização resolve — e também
 * por e-mail, porque o vínculo fica vazio quando a reserva foi feita com um
 * endereço diferente do cadastrado. Sem a segunda comparação, justamente o
 * palestrante cuja inscrição não foi reconhecida ficaria sem escrever o tema.
 */
function ehMinhaReuniao_(reuniao, eu) {
  if (!eu) return false;

  if (limparCampo_(reuniao.id_palestrante) !== '' &&
      Number(reuniao.id_palestrante) === Number(eu.id_pessoa)) {
    return true;
  }

  var meuEmail = normalizarTexto(eu.email);
  return meuEmail !== '' && normalizarTexto(reuniao.email_reservado) === meuEmail;
}

/**
 * O palestrante grava o tema da PRÓPRIA palestra.
 *
 * Separado de `definirTema` de propósito: aquele é permissão por PERFIL — um
 * atendente pode gravar o tema de qualquer reunião. Este é por DONO, e não
 * cabe na hierarquia de perfis: o palestrante não está acima nem abaixo do
 * atendente, ele é outra coisa.
 *
 * Misturar os dois obrigaria a inventar um perfil "palestrante" no meio da
 * escada, e aí um palestrante herdaria emprestar livro.
 */
function definirMeuTema(sessao, idReuniao, tema) {
  var eu = donoDaSessao_(sessao);
  if (!eu) throw new Error('Sua sessão expirou. Entre de novo para continuar.');

  var texto = limparCampo_(tema);
  if (!texto) throw new Error('Escreva o tema.');

  return comTrava_(function () {
    var alvo = Number(idReuniao);
    var achadas = lerAba_(ABA_REUNIOES).filter(function (reuniao) {
      return Number(reuniao.id_reuniao) === alvo;
    });
    if (!achadas.length) throw new Error('Reunião não encontrada.');

    var reuniao = achadas[0];

    // A checagem de dono é do SERVIDOR. A tela só mostra o campo nas reuniões
    // certas; sem isto, qualquer pessoa identificada escreveria o tema da
    // palestra de outra — e o tema é público.
    if (!ehMinhaReuniao_(reuniao, eu)) {
      throw new Error('Esta reunião não é sua. Fale com quem coordena a agenda.');
    }
    if (limparCampo_(reuniao.status) === STATUS_CANCELADA) {
      throw new Error('Esta reunião está cancelada.');
    }

    var mudancas = { tema: texto };
    if (limparCampo_(reuniao.status) !== STATUS_REALIZADA) {
      mudancas.status = STATUS_TEMA_CONFIRMADO;
    }

    atualizarCelulas_(ABA_REUNIOES, reuniao._linha, mudancas);
    registrarLog_(eu.nome, 'tema', 'reuniao', alvo, 'pelo palestrante');
    return alvo;
  });
}

/**
 * Grava o tema de uma reunião (regra 13).
 *
 * O tema é a única coisa que a planilha manda e o Agenda não sabe — por isso
 * `planejarSincronizacao` nunca o toca.
 */
function definirTema(sessao, idReuniao, tema) {
  var quemRegistrou = exigir_(sessao, 'definir_tema').nome;

  var texto = limparCampo_(tema);
  if (!texto) throw new Error('Escreva o tema.');

  var quem = limparCampo_(quemRegistrou);
  if (!quem) throw new Error('Informe quem está preenchendo.');

  return comTrava_(function () {
    var alvo = Number(idReuniao);
    var achadas = lerAba_(ABA_REUNIOES).filter(function (reuniao) {
      return Number(reuniao.id_reuniao) === alvo;
    });
    if (!achadas.length) throw new Error('Reunião não encontrada.');

    var reuniao = achadas[0];
    if (limparCampo_(reuniao.status) === STATUS_CANCELADA) {
      throw new Error('Esta reunião está cancelada.');
    }

    var mudancas = { tema: texto };
    // Já realizada não volta para tema_confirmado só por corrigir o texto.
    if (limparCampo_(reuniao.status) !== STATUS_REALIZADA) {
      mudancas.status = STATUS_TEMA_CONFIRMADO;
    }

    atualizarCelulas_(ABA_REUNIOES, reuniao._linha, mudancas);
    registrarLog_(quem, 'tema', 'reuniao', alvo, '');
    return alvo;
  });
}

/** Hoje à meia-noite. Nome distinto do `soData_` de dominio.js. */
function soDataDeHoje_() {
  var agora = new Date();
  return new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
}

/** Célula de data para Date, ou null. */
function comoDataSegura_(valor) {
  if (!valor) return null;
  if (valor instanceof Date) return isFinite(valor.getTime()) ? valor : null;
  var data = new Date(valor);
  return isFinite(data.getTime()) ? data : null;
}

/**
 * Sincronização manual, pelo menu. Existe para não ser preciso esperar até as
 * 5h da manhã para ver se a reserva chegou — e para dar mensagem de erro
 * legível quando o `id_calendario` estiver errado, coisa que o gatilho só
 * registraria no Log.
 */
function sincronizarAgora() {
  var ui = SpreadsheetApp.getUi();
  try {
    var resumo = sincronizarReunioes();
    ui.alert(
      'Sincronização concluída',
      resumo.lidos + ' evento(s) lido(s) no calendário.\n\n' +
      resumo.criadas + ' reunião(ões) nova(s)\n' +
      resumo.atualizadas + ' atualizada(s)\n' +
      resumo.canceladas + ' cancelada(s)',
      ui.ButtonSet.OK
    );
  } catch (erro) {
    ui.alert('Não consegui sincronizar', erro.message, ui.ButtonSet.OK);
  }
}

/**
 * Lista os calendários que este script enxerga.
 *
 * `getCalendarById` devolve nulo tanto para ID errado quanto para calendário
 * de outra conta, e a mensagem de erro não distingue os dois. Isto mostra o
 * que existe, com o ID exato para copiar.
 */
function diagnosticarAgenda() {
  var configurado = limparCampo_(lerConfig('id_calendario', ''));
  var linhas = ['Calendários visíveis para este script:', ''];

  var calendarios;
  try {
    calendarios = CalendarApp.getAllCalendars();
  } catch (erro) {
    mostrarRelatorio_('Diagnóstico — agenda',
      'Não consegui listar os calendários: ' + erro.message +
      '\n\nSe fala de permissão, reautorize pelo menu.');
    return;
  }

  if (!calendarios.length) {
    linhas.push('  (nenhum — esta conta não tem calendário algum)');
  }

  var achou = false;
  calendarios.forEach(function (calendario) {
    var id = calendario.getId();
    var marca = (id === configurado) ? '  <<< é o configurado' : '';
    if (id === configurado) achou = true;
    linhas.push('• ' + calendario.getName());
    linhas.push('  ' + id + marca);
    linhas.push('  ' + (calendario.isOwnedByMe() ? 'próprio' : 'assinado de outra conta'));
    linhas.push('');
  });

  linhas.push('---');
  linhas.push('Config → id_calendario: ' +
    (configurado ? '"' + configurado + '"' : '(vazio)'));
  linhas.push('');

  if (!configurado) {
    linhas.push('Copie acima o ID do calendário das reuniões e cole na aba Config.');
  } else if (achou) {
    linhas.push('O ID confere. Se a sincronização ainda falhar, o problema é outro.');
  } else {
    linhas.push('O ID configurado NÃO está na lista. Duas causas possíveis:');
    linhas.push('  1. O calendário foi criado em outra conta Google. Crie-o');
    linhas.push('     nesta conta, ou compartilhe-o com ela.');
    linhas.push('  2. O ID foi copiado com erro. Compare com a lista acima.');
  }

  mostrarRelatorio_('Diagnóstico — agenda', linhas.join('\n'));
}
