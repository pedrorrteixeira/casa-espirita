/**
 * setup.js — Fase 0: cria a estrutura da planilha.
 *
 * Rode `criarEstruturaPlanilha()` uma vez, pelo editor do Apps Script.
 * É idempotente: rodar de novo reaplica cabeçalhos, formatos, validações e
 * fórmulas, mas NUNCA apaga linha de dado nem remove aba (regra 15).
 *
 * ATENÇÃO A QUEM FOR MEXER
 * ------------------------
 * As colunas derivadas (Titulos!P:Q e Exemplares!G:I) são uma ARRAYFORMULA
 * única, escrita na LINHA 2, que se expande sozinha para as linhas novas.
 * Nenhum código pode escrever nessas colunas — escrever quebra a fórmula com
 * #REF (decisão D7 da ESPECIFICACAO.md).
 *
 * Consequência: em Titulos e Exemplares o `getLastRow()` MENTE. A ARRAYFORMULA
 * preenche a coluna inteira com "" e o Apps Script conta isso como conteúdo,
 * então getLastRow() devolve 1000. Para achar a última linha de dado nessas
 * duas abas, leia a coluna A em lote e conte. As outras cinco abas não têm
 * fórmula e podem usar getLastRow() normalmente.
 *
 * SEPARADOR DE ARGUMENTOS
 * -----------------------
 * As fórmulas abaixo são escritas com vírgula, mas isso é só a forma de
 * armazenamento neste arquivo. `setFormula()` grava o texto literal: quem
 * interpreta é a planilha, e numa planilha pt_BR o separador é ";". Passar
 * vírgula ali dá #ERROR! (erro de sintaxe), não #REF!.
 *
 * Por isso `separadorDeFormula_()` descobre em tempo de execução qual notação
 * esta planilha aceita, e `comSeparador_()` converte antes de gravar.
 *
 * Consequência para quem for editar as fórmulas: nenhuma delas pode conter
 * vírgula dentro de uma string literal, porque a conversão é textual.
 */

var SETUP_FUSO = 'America/Sao_Paulo';
var SETUP_LOCALE = 'pt_BR';
var SETUP_MARCA_PROTECAO = 'setup.js';

// --- Listas de validação -----------------------------------------------------

var LISTA_SIM_NAO = ['SIM', 'NÃO'];
var LISTA_ESTADO = ['novo', 'bom', 'regular', 'ruim'];
var LISTA_PERFIL = ['consulta', 'atendente', 'bibliotecario', 'admin'];
var LISTA_STATUS_REUNIAO = [
  'vaga_aberta', 'reservada', 'tema_confirmado', 'realizada', 'cancelada'
];
// Única lista permissiva: vai crescer com o acervo, e bloquear obrigaria
// mexer no código toda vez que aparecesse uma categoria nova.
var LISTA_CATEGORIA = [
  'doutrinário', 'romance', 'infantil', 'estudo', 'mediunidade',
  'biografia', 'mensagens', 'poesia', 'outros'
];

// --- Fórmulas derivadas (D7) -------------------------------------------------
// Um tombo tem no máximo UM empréstimo aberto (data_devolucao vazia). Por isso
// SUMIFS funciona onde MATCH com condição composta não vetorizaria dentro de
// ARRAYFORMULA: somar a coluna devolve o valor daquela única linha.

// ATENÇÃO às letras de coluna: elas seguem a ordem dos cabeçalhos logo abaixo.
// Em `Exemplares`, `ativo` é a coluna I e `situacao` a J. Mexer na ordem dos
// cabeçalhos sem mexer aqui quebra tudo em silêncio — o teste
// "as fórmulas apontam para as colunas certas" existe para pegar isso.
var F_SITUACAO =
  '=ARRAYFORMULA(IF(A2:A="","",' +
  'IF(I2:I="","(preencher ativo)",' +
  'IF(I2:I<>"SIM","baixado",' +
  'IF(COUNTIFS(Emprestimos!$B$2:$B,A2:A,Emprestimos!$F$2:$F,"")>0,' +
  '"emprestado","disponível")))))';

var F_COM_QUEM =
  '=ARRAYFORMULA(IF(A2:A="","",IFERROR(VLOOKUP(' +
  'SUMIFS(Emprestimos!$C$2:$C,Emprestimos!$B$2:$B,A2:A,Emprestimos!$F$2:$F,""),' +
  'Pessoas!$A$2:$B,2,FALSE),"")))';

var F_PREVISAO =
  '=ARRAYFORMULA(IF(A2:A="","",' +
  'IF(COUNTIFS(Emprestimos!$B$2:$B,A2:A,Emprestimos!$F$2:$F,"")=0,"",' +
  'SUMIFS(Emprestimos!$E$2:$E,Emprestimos!$B$2:$B,A2:A,Emprestimos!$F$2:$F,""))))';

// Exemplar baixado não conta: qtd_exemplares é o que a casa realmente tem.
// Exemplares!I = ativo.
var F_QTD_EXEMPLARES =
  '=ARRAYFORMULA(IF(A2:A="","",' +
  'COUNTIFS(Exemplares!$B$2:$B,A2:A,Exemplares!$I$2:$I,"SIM")))';

// Casa a string "disponível" produzida por F_SITUACAO. Mudar a palavra lá e
// não aqui quebra a contagem. Exemplares!J = situacao.
var F_QTD_DISPONIVEIS =
  '=ARRAYFORMULA(IF(A2:A="","",' +
  'COUNTIFS(Exemplares!$B$2:$B,A2:A,Exemplares!$J$2:$J,"disponível")))';

// --- Valores padrão da aba Config --------------------------------------------

var CONFIG_PADRAO = [
  ['prazo_devolucao_dias', 21, 'Dias de prazo padrão do empréstimo.'],
  ['email_admin', '', 'PREENCHER: e-mail que recebe os avisos de atraso.'],
  ['id_calendario', '', 'PREENCHER NA FASE 3: ID do calendário das reuniões.'],
  ['horario_reuniao', '19:30', 'Horário fixo das reuniões de segunda-feira.'],
  ['nome_casa', '', 'PREENCHER: nome da casa, aparece no cabeçalho do sistema.'],
  ['chave_api_livros', '', 'OPCIONAL: chave da API de livros do Google. Sem ' +
    'ela a busca por ISBN quase sempre falha, porque a cota é compartilhada ' +
    'com todo mundo. É gratuita e não pede cartão. Ver PLANO.md.']
];

// --- Estrutura das sete abas -------------------------------------------------
// Colunas em base 1. `formulas` é { coluna: fórmula }, aplicada só na linha 2.

var ESTRUTURA_ABAS = [
  {
    nome: 'Config',
    cabecalhos: ['chave', 'valor', 'descricao'],
    larguras: { 1: 200, 2: 260, 3: 440 }
  },
  {
    // `autor_ou_medium` é um campo só para os dois papéis, porque nunca são
    // preenchidos ao mesmo tempo: obra de autor tem autor, psicografia tem
    // médium. Quem diz qual dos dois é `autor_espiritual` estar preenchido.
    //
    // `editora` e `ano` NÃO ficam aqui: descrevem o objeto físico, e a casa
    // pode ter o mesmo livro em três edições. Vivem em `Exemplares`.
    // `isbn` fica, como chave da consulta ao Google — é atalho de cadastro,
    // não afirmação sobre cada exemplar.
    nome: 'Titulos',
    cabecalhos: [
      'id_titulo', 'titulo', 'subtitulo', 'autor_ou_medium', 'autor_espiritual',
      'tradutor', 'isbn', 'categoria', 'serie', 'ordem_na_serie', 'sinopse',
      'link_online', 'qtd_exemplares', 'qtd_disponiveis', 'observacao'
    ],
    formatos: [
      { colunas: [1, 10, 13, 14], formato: '0' },
      { colunas: [7], formato: '@' }
    ],
    validacoes: [{ coluna: 8, lista: LISTA_CATEGORIA, bloqueia: false }],
    formulas: { 13: F_QTD_EXEMPLARES, 14: F_QTD_DISPONIVEIS },
    colunasProtegidas: [[13, 14]],
    larguras: {
      2: 280, 3: 220, 4: 230, 5: 200, 6: 170,
      9: 200, 11: 340, 12: 240, 15: 240
    }
  },
  {
    // Edição, editora e ano moram aqui porque descrevem o exemplar físico:
    // um Nosso Lar da FEB de 1978 e outro da Petit de 2015 são o mesmo
    // título com objetos diferentes na estante.
    nome: 'Exemplares',
    cabecalhos: [
      'tombo', 'id_titulo', 'edicao', 'editora', 'ano', 'estado', 'doado_por',
      'data_entrada', 'ativo', 'situacao', 'com_quem', 'previsao_devolucao'
    ],
    formatos: [
      { colunas: [1, 2, 5], formato: '0' },
      { colunas: [8, 12], formato: 'dd/mm/yyyy' }
    ],
    validacoes: [
      { coluna: 6, lista: LISTA_ESTADO, bloqueia: true },
      { coluna: 9, lista: LISTA_SIM_NAO, bloqueia: true }
    ],
    formulas: { 10: F_SITUACAO, 11: F_COM_QUEM, 12: F_PREVISAO },
    colunasProtegidas: [[10, 12]],
    larguras: { 3: 170, 4: 190, 7: 200, 10: 150, 11: 220, 12: 160 }
  },
  {
    nome: 'Pessoas',
    cabecalhos: [
      'id_pessoa', 'nome', 'telefone', 'email', 'frequentador', 'palestrante',
      'perfil', 'ativo', 'data_cadastro', 'observacao'
    ],
    formatos: [
      { colunas: [1], formato: '0' },
      { colunas: [3], formato: '@' },
      { colunas: [9], formato: 'dd/mm/yyyy' }
    ],
    validacoes: [
      { coluna: 5, lista: LISTA_SIM_NAO, bloqueia: true },
      { coluna: 6, lista: LISTA_SIM_NAO, bloqueia: true },
      { coluna: 7, lista: LISTA_PERFIL, bloqueia: true },
      { coluna: 8, lista: LISTA_SIM_NAO, bloqueia: true }
    ],
    larguras: { 2: 240, 3: 150, 4: 250, 10: 240 }
  },
  {
    nome: 'Emprestimos',
    cabecalhos: [
      'id_emprestimo', 'tombo', 'id_pessoa', 'data_emprestimo', 'data_prevista',
      'data_devolucao', 'quem_registrou', 'renovacoes', 'observacao'
    ],
    formatos: [
      { colunas: [1, 2, 3, 8], formato: '0' },
      { colunas: [4, 5, 6], formato: 'dd/mm/yyyy' }
    ],
    larguras: { 7: 200, 9: 240 }
  },
  {
    nome: 'Reunioes',
    cabecalhos: [
      'id_reuniao', 'data', 'horario', 'id_palestrante', 'nome_reservado',
      'email_reservado', 'tema', 'status', 'id_evento_calendar', 'data_inscricao'
    ],
    formatos: [
      { colunas: [1, 4], formato: '0' },
      { colunas: [2], formato: 'dd/mm/yyyy' },
      { colunas: [3], formato: '@' },
      { colunas: [10], formato: 'dd/mm/yyyy hh:mm' }
    ],
    validacoes: [{ coluna: 8, lista: LISTA_STATUS_REUNIAO, bloqueia: true }],
    larguras: { 5: 220, 6: 250, 7: 300, 8: 150, 9: 300, 10: 150 }
  },
  {
    nome: 'Sugestoes',
    cabecalhos: ['data', 'id_titulo', 'titulo_livre', 'quem_pediu', 'atendido'],
    formatos: [
      { colunas: [1], formato: 'dd/mm/yyyy' },
      { colunas: [2], formato: '0' }
    ],
    validacoes: [{ coluna: 5, lista: LISTA_SIM_NAO, bloqueia: true }],
    larguras: { 3: 300, 4: 220 }
  },
  {
    nome: 'Log',
    cabecalhos: ['data_hora', 'usuario', 'acao', 'entidade', 'id', 'detalhe'],
    formatos: [{ colunas: [1], formato: 'dd/mm/yyyy hh:mm:ss' }],
    larguras: { 1: 170, 2: 190, 3: 170, 4: 140, 5: 90, 6: 380 }
  }
];

// --- Funções públicas --------------------------------------------------------

/**
 * Cria (ou reaplica) a estrutura completa da planilha.
 * Não apaga linha de dado e não remove aba de dado.
 */
function criarEstruturaPlanilha() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error(
      'Nenhuma planilha ativa. Este script precisa estar vinculado a uma ' +
      'planilha (npx clasp create --type sheets).'
    );
  }

  ss.setSpreadsheetTimeZone(SETUP_FUSO);
  ss.setSpreadsheetLocale(SETUP_LOCALE);

  // Duas passadas, de propósito. As ARRAYFORMULA de Titulos e Exemplares
  // referenciam Emprestimos e Pessoas. Escrever a fórmula antes de a aba
  // referida existir faz o Sheets gravar #REF! dentro do próprio texto da
  // fórmula — e isso não se conserta quando a aba aparece depois.
  var criadas = [];
  var atualizadas = [];
  ESTRUTURA_ABAS.forEach(function (spec) {
    if (garantirAba_(ss, spec)) {
      criadas.push(spec.nome);
    } else {
      atualizadas.push(spec.nome);
    }
  });
  var sep = separadorDeFormula_(ss);
  console.log('Separador de fórmulas desta planilha: "%s"', sep);

  ESTRUTURA_ABAS.forEach(function (spec) {
    configurarAba_(ss, spec, sep);
  });

  var nomes = ESTRUTURA_ABAS.map(function (spec) { return spec.nome; });
  removerAbaPadrao_(ss, nomes);
  ordenarAbas_(ss, nomes);
  popularConfigPadrao();

  console.log('Abas criadas: %s', criadas.length ? criadas.join(', ') : '(nenhuma)');
  console.log('Abas reaplicadas: %s', atualizadas.length ? atualizadas.join(', ') : '(nenhuma)');
  ss.toast('Estrutura pronta: ' + nomes.length + ' abas.', 'Biblioteca', 5);

  return { criadas: criadas, atualizadas: atualizadas };
}

/**
 * Insere na aba Config apenas as chaves que ainda não existem.
 * Nunca sobrescreve um valor já preenchido.
 */
function popularConfigPadrao() {
  var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Config');
  if (!aba) {
    throw new Error('A aba Config não existe. Rode criarEstruturaPlanilha() antes.');
  }

  // Config não tem ARRAYFORMULA, então getLastRow() é confiável aqui.
  var ultima = aba.getLastRow();
  var existentes = [];
  if (ultima >= 2) {
    existentes = aba.getRange(2, 1, ultima - 1, 1).getValues().map(function (linha) {
      return String(linha[0]).trim();
    });
  }

  var faltando = CONFIG_PADRAO.filter(function (par) {
    return existentes.indexOf(par[0]) === -1;
  });

  if (faltando.length === 0) {
    console.log('Config: nada a fazer, as %s chaves já existem.', CONFIG_PADRAO.length);
    return 0;
  }

  aba.getRange(ultima + 1, 1, faltando.length, 3).setValues(faltando);
  console.log('Config: %s chave(s) inserida(s): %s', faltando.length,
    faltando.map(function (par) { return par[0]; }).join(', '));
  return faltando.length;
}

// --- Auxiliares --------------------------------------------------------------

/**
 * Passada 1: garante que a aba existe, com a largura certa de colunas.
 * Devolve true se a aba foi criada agora.
 */
function garantirAba_(ss, spec) {
  var nCols = spec.cabecalhos.length;
  var aba = ss.getSheetByName(spec.nome);
  var nova = !aba;

  if (nova) {
    aba = ss.insertSheet(spec.nome);
    var sobrando = aba.getMaxColumns() - nCols;
    if (sobrando > 0) {
      aba.deleteColumns(nCols + 1, sobrando);
    }
  }
  if (aba.getMaxColumns() < nCols) {
    aba.insertColumnsAfter(aba.getMaxColumns(), nCols - aba.getMaxColumns());
  }
  return nova;
}

/**
 * Passada 2: reaplica cabeçalho, formato, validação, fórmula, congelamento e
 * proteção. Só roda depois que TODAS as abas existem — ver criarEstruturaPlanilha().
 */
function configurarAba_(ss, spec, sep) {
  var nCols = spec.cabecalhos.length;
  var aba = ss.getSheetByName(spec.nome);

  var cabecalho = aba.getRange(1, 1, 1, nCols);
  cabecalho.setValues([spec.cabecalhos]);
  cabecalho.setFontWeight('bold').setBackground('#e8eaed').setVerticalAlignment('middle');
  aba.setFrozenRows(1);

  var linhasDados = aba.getMaxRows() - 1;

  (spec.formatos || []).forEach(function (regra) {
    regra.colunas.forEach(function (col) {
      aba.getRange(2, col, linhasDados, 1).setNumberFormat(regra.formato);
    });
  });

  (spec.validacoes || []).forEach(function (regra) {
    aba.getRange(2, regra.coluna, linhasDados, 1)
      .setDataValidation(criarValidacao_(regra.lista, regra.bloqueia));
  });

  // Fórmula só na linha 2 — a ARRAYFORMULA cuida do resto da coluna sozinha.
  Object.keys(spec.formulas || {}).forEach(function (col) {
    aba.getRange(2, Number(col)).setFormula(comSeparador_(spec.formulas[col], sep));
  });

  Object.keys(spec.larguras || {}).forEach(function (col) {
    aba.setColumnWidth(Number(col), spec.larguras[col]);
  });

  aplicarProtecoes_(aba, spec, nCols, linhasDados);
}

/**
 * Descobre qual separador de argumentos o parser desta planilha aceita.
 *
 * Não dá para deduzir do locale com segurança, então a gente pergunta: grava
 * uma fórmula-sonda numa aba temporária e vê qual das duas notações devolve
 * resultado em vez de #ERROR!. Falha alto se nenhuma funcionar — melhor parar
 * aqui do que espalhar #ERROR! por cinco colunas derivadas.
 */
function separadorDeFormula_(ss) {
  // Sobra de uma execução que morreu no meio faria o insertSheet estourar.
  var restos = ss.getSheetByName('__sonda__');
  if (restos) ss.deleteSheet(restos);

  var aba = ss.insertSheet('__sonda__');
  try {
    var celula = aba.getRange('A1');

    celula.setFormula('=IF(TRUE,1,2)');
    SpreadsheetApp.flush();
    if (celula.getValue() === 1) return ',';

    celula.setFormula('=IF(TRUE;1;2)');
    SpreadsheetApp.flush();
    if (celula.getValue() === 1) return ';';

    throw new Error(
      'Não consegui descobrir o separador de fórmulas desta planilha: nem "," ' +
      'nem ";" foram aceitos pela fórmula-sonda.'
    );
  } finally {
    ss.deleteSheet(aba);
  }
}

/**
 * Converte a fórmula para o separador que a planilha aceita.
 * Conversão textual: nenhuma fórmula pode ter vírgula dentro de string.
 */
function comSeparador_(formula, sep) {
  return sep === ',' ? formula : formula.split(',').join(sep);
}

function criarValidacao_(lista, bloqueia) {
  return SpreadsheetApp.newDataValidation()
    .requireValueInList(lista, true)
    .setAllowInvalid(!bloqueia)
    .setHelpText('Valores aceitos: ' + lista.join(', '))
    .build();
}

/**
 * Protege cabeçalho e colunas de fórmula. Aviso, não bloqueio: não exige saber
 * o e-mail de ninguém e ainda assim impede a digitação acidental por cima de
 * uma ARRAYFORMULA, que é o risco listado no PLANO.md.
 */
function aplicarProtecoes_(aba, spec, nCols, linhasDados) {
  // Remove só as proteções que este script criou, para não empilhar duplicatas
  // a cada nova execução — e para não mexer em proteção feita à mão.
  aba.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach(function (p) {
    if (String(p.getDescription()).indexOf(SETUP_MARCA_PROTECAO) === 0) {
      p.remove();
    }
  });

  proteger_(aba.getRange(1, 1, 1, nCols), 'cabeçalho');
  (spec.colunasProtegidas || []).forEach(function (faixa) {
    var largura = faixa[1] - faixa[0] + 1;
    proteger_(aba.getRange(2, faixa[0], linhasDados, largura), 'coluna de fórmula');
  });
}

function proteger_(intervalo, motivo) {
  intervalo.protect()
    .setDescription(SETUP_MARCA_PROTECAO + ' — ' + motivo + ', não edite à mão')
    .setWarningOnly(true);
}

/**
 * Apaga a aba padrão que o Google cria junto com a planilha — e só ela, e só
 * se estiver vazia. Aba de dado nunca é removida (regra 15).
 */
function removerAbaPadrao_(ss, nomesValidos) {
  var candidatos = ['Página1', 'Pagina1', 'Planilha1', 'Sheet1', 'Sheet 1'];
  ss.getSheets().forEach(function (aba) {
    var nome = aba.getName();
    if (nomesValidos.indexOf(nome) !== -1) return;
    if (candidatos.indexOf(nome) === -1) return;
    if (aba.getLastRow() > 0 || aba.getLastColumn() > 0) return;
    if (ss.getSheets().length <= 1) return;
    ss.deleteSheet(aba);
    console.log('Aba padrão vazia "%s" removida.', nome);
  });
}

function ordenarAbas_(ss, nomes) {
  nomes.forEach(function (nome, i) {
    var aba = ss.getSheetByName(nome);
    if (!aba) return;
    ss.setActiveSheet(aba);
    ss.moveActiveSheet(i + 1);
  });
}

// Exporta para o `node --test`. Em Apps Script a guarda nao dispara.
if (typeof module !== 'undefined') { module.exports = { ESTRUTURA_ABAS: ESTRUTURA_ABAS }; }

