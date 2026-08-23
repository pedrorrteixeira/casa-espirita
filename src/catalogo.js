/**
 * catalogo.js — criação e manutenção de títulos e exemplares.
 *
 * Toda função aqui grava. Portanto: valida antes, usa `LockService`, registra
 * na aba `Log` e invalida o cache de títulos. Nenhuma delas apaga linha —
 * baixa é sempre lógica (regras 10 e 15).
 *
 * O acesso à planilha é todo por `planilha.js`. Nada de `SpreadsheetApp` aqui.
 */

// --- Títulos -----------------------------------------------------------------

/**
 * Cria um título. `titulo` é o único campo obrigatório: a casa cataloga obra
 * que não possui, para consulta e para a lista de doação desejada (D5), e
 * muita edição antiga da FEB não tem nem ISBN nem ano legíveis.
 */
function criarTitulo(dados, quemRegistrou) {
  var nome = limparCampo_(dados && dados.titulo);
  if (!nome) throw new Error('O título é obrigatório.');

  return comTrava_(function () {
    var registro = {
      id_titulo: proximoId_(ABA_TITULOS, 'id_titulo'),
      titulo: nome,
      subtitulo: limparCampo_(dados.subtitulo),
      autor: limparCampo_(dados.autor),
      autor_espiritual: limparCampo_(dados.autor_espiritual),
      medium: limparCampo_(dados.medium),
      tradutor: limparCampo_(dados.tradutor),
      editora: limparCampo_(dados.editora),
      ano: limparCampo_(dados.ano),
      isbn: limparCampo_(dados.isbn),
      categoria: limparCampo_(dados.categoria),
      serie: limparCampo_(dados.serie),
      ordem_na_serie: limparCampo_(dados.ordem_na_serie),
      sinopse: limparCampo_(dados.sinopse),
      link_online: limparCampo_(dados.link_online),
      observacao: limparCampo_(dados.observacao)
    };

    escreverLinha_(ABA_TITULOS, registro);
    invalidarCacheTitulos_();
    registrarLog_(quemRegistrou, 'criar', 'titulo', registro.id_titulo, '');
    return registro.id_titulo;
  });
}

/**
 * Atualiza campos de um título. Só mexe no que veio em `mudancas`; o resto
 * fica como está. `id_titulo` não é alterável — é o que liga os exemplares.
 */
function atualizarTitulo(idTitulo, mudancas, quemRegistrou) {
  return comTrava_(function () {
    var titulo = lerTitulo(idTitulo);
    if (!titulo) throw new Error('Título ' + idTitulo + ' não existe.');

    var permitidos = [
      'titulo', 'subtitulo', 'autor', 'autor_espiritual', 'medium', 'tradutor',
      'editora', 'ano', 'isbn', 'categoria', 'serie', 'ordem_na_serie',
      'sinopse', 'link_online', 'observacao'
    ];

    var aplicar = {};
    Object.keys(mudancas || {}).forEach(function (campo) {
      if (permitidos.indexOf(campo) === -1) {
        throw new Error('O campo "' + campo + '" não pode ser alterado.');
      }
      aplicar[campo] = limparCampo_(mudancas[campo]);
    });

    if (aplicar.titulo === '') throw new Error('O título não pode ficar vazio.');
    if (Object.keys(aplicar).length === 0) return idTitulo;

    atualizarCelulas_(ABA_TITULOS, titulo._linha, aplicar);
    invalidarCacheTitulos_();
    registrarLog_(quemRegistrou, 'atualizar', 'titulo', idTitulo,
      Object.keys(aplicar).join(', '));
    return idTitulo;
  });
}

// --- Exemplares --------------------------------------------------------------

/**
 * Cria um exemplar físico e devolve o tombo, que é o número que vai na
 * etiqueta colada no livro (D6, D13).
 *
 * Regra 8: exige `id_titulo` existente. Quem cria exemplar de obra ainda não
 * catalogada tem que criar o título primeiro — é o fluxo da tela, não uma
 * gentileza que o backend faça sozinho, senão erro de digitação no id vira
 * título fantasma.
 */
function criarExemplar(dados, quemRegistrou) {
  var idTitulo = Number(dados && dados.id_titulo);
  if (!isFinite(idTitulo) || idTitulo <= 0) {
    throw new Error('Informe o título ao qual este exemplar pertence.');
  }

  return comTrava_(function () {
    if (!lerTitulo(idTitulo)) {
      throw new Error(
        'Título ' + idTitulo + ' não existe. Cadastre o título antes do exemplar.'
      );
    }

    // A validação de dados da planilha NÃO vale para `setValues`: ela só
    // barra digitação humana na interface do Sheets. Escrita por código passa
    // reto. Então o enum é conferido aqui também, contra a mesma lista que
    // `setup.js` usa na validação — uma fonte de verdade só.
    var estado = limparCampo_(dados.estado) || 'bom';
    if (LISTA_ESTADO.indexOf(estado) === -1) {
      throw new Error(
        'Estado "' + estado + '" inválido. Use: ' + LISTA_ESTADO.join(', ') + '.'
      );
    }

    var registro = {
      tombo: proximoId_(ABA_EXEMPLARES, 'tombo'),
      id_titulo: idTitulo,
      estado: estado,
      doado_por: limparCampo_(dados.doado_por),
      data_entrada: dados.data_entrada instanceof Date ? dados.data_entrada : new Date(),
      ativo: 'SIM'
    };

    escreverLinha_(ABA_EXEMPLARES, registro);
    invalidarCacheTitulos_();
    registrarLog_(quemRegistrou, 'criar', 'exemplar', registro.tombo,
      'titulo ' + idTitulo);
    return registro.tombo;
  });
}

/**
 * Baixa de exemplar: perdido, danificado ou repassado (regra 10).
 *
 * `ativo` = NÃO, nunca `deleteRow`. A linha fica, e com ela o histórico de
 * circulação do livro — inclusive os empréstimos que já aconteceram.
 */
function darBaixaExemplar(tombo, motivo, quemRegistrou) {
  var alvo = Number(tombo);
  if (!isFinite(alvo)) throw new Error('Tombo inválido.');

  var razao = limparCampo_(motivo);
  if (!razao) throw new Error('Informe o motivo da baixa.');

  return comTrava_(function () {
    var exemplares = lerExemplares().filter(function (exemplar) {
      return Number(exemplar.tombo) === alvo;
    });
    if (!exemplares.length) throw new Error('Tombo ' + alvo + ' não existe.');

    var exemplar = exemplares[0];
    if (String(exemplar.ativo).trim() !== 'SIM') {
      throw new Error('O exemplar ' + alvo + ' já está baixado.');
    }

    // Um exemplar emprestado não pode sair do acervo sem alguém decidir o que
    // fazer com o empréstimo aberto. Some da estante e continua na mão de
    // alguém — a devolução depois não teria exemplar ativo para voltar.
    var aberto = lerEmprestimos().some(function (emprestimo) {
      return Number(emprestimo.tombo) === alvo && ehVazio_(emprestimo.data_devolucao);
    });
    if (aberto) {
      throw new Error(
        'O exemplar ' + alvo + ' está emprestado. Registre a devolução antes ' +
        'de dar baixa, ou anote a perda no empréstimo.'
      );
    }

    // O motivo da baixa vive só na aba Log: `Exemplares` não tem coluna de
    // observação, e acrescentar uma mudaria o modelo de dados da
    // especificação sem necessidade — o Log já responde "por que sumiu?".
    atualizarCelulas_(ABA_EXEMPLARES, exemplar._linha, { ativo: 'NÃO' });
    invalidarCacheTitulos_();
    registrarLog_(quemRegistrou, 'baixa', 'exemplar', alvo, razao);
    return alvo;
  });
}

/**
 * REGRA 9 — "excluir título com exemplares vinculados é proibido".
 *
 * Não existe `excluirTitulo()` aqui, e é de propósito: a regra 15 proíbe
 * apagar linha de planilha em qualquer situação. Sem função de exclusão, a
 * regra 9 não tem como ser violada. Se um dia alguém precisar retirar um
 * título do catálogo, o caminho é o mesmo do exemplar — marcação lógica —,
 * e aí a checagem de exemplares vinculados passa a ser necessária.
 */

// --- API das telas -----------------------------------------------------------
// Funções chamadas por `google.script.run`. Tudo o que sai daqui vai para o
// navegador do frequentador, então o retorno é montado campo a campo.

/**
 * Busca do acervo, para a tela pública.
 *
 * O retorno é uma LISTA BRANCA montada à mão, não o registro da planilha
 * repassado. Isso é deliberado: `Exemplares` traz `com_quem` preenchido, e
 * devolver o objeto inteiro publicaria o nome de quem está com cada livro.
 * Acrescentar campo aqui é decisão consciente; esquecer de tirar, não seria.
 */
function buscarNoAcervo(termo) {
  var achados = buscarTitulos(lerTitulos(), termo);
  if (!achados.length) return [];

  var porTitulo = {};
  lerExemplares().forEach(function (exemplar) {
    var id = Number(exemplar.id_titulo);
    if (!porTitulo[id]) porTitulo[id] = [];
    porTitulo[id].push(exemplar);
  });

  return achados.map(function (titulo) {
    var resumo = resumirDisponibilidade(porTitulo[Number(titulo.id_titulo)] || []);
    return {
      id_titulo: titulo.id_titulo,
      titulo: titulo.titulo,
      subtitulo: titulo.subtitulo,
      autoria: montarAutoria(titulo),
      categoria: titulo.categoria,
      serie: titulo.serie,
      ordem_na_serie: titulo.ordem_na_serie,
      editora: titulo.editora,
      ano: titulo.ano,
      link_online: titulo.link_online,
      estado: resumo.estado,
      total: resumo.total,
      disponiveis: resumo.disponiveis,
      previsao: resumo.previsao ? formatarData_(resumo.previsao) : ''
    };
  });
}

/** Ficha completa de um título, para a tela de detalhe. Traz a sinopse. */
function verTitulo(idTitulo) {
  var titulo = lerTitulo(idTitulo);
  if (!titulo) throw new Error('Título não encontrado.');

  var exemplares = lerExemplares().filter(function (exemplar) {
    return Number(exemplar.id_titulo) === Number(idTitulo);
  });
  var resumo = resumirDisponibilidade(exemplares);

  return {
    id_titulo: titulo.id_titulo,
    titulo: titulo.titulo,
    subtitulo: titulo.subtitulo,
    autoria: montarAutoria(titulo),
    autor: titulo.autor,
    autor_espiritual: titulo.autor_espiritual,
    medium: titulo.medium,
    tradutor: titulo.tradutor,
    editora: titulo.editora,
    ano: titulo.ano,
    isbn: titulo.isbn,
    categoria: titulo.categoria,
    serie: titulo.serie,
    ordem_na_serie: titulo.ordem_na_serie,
    sinopse: titulo.sinopse,
    link_online: titulo.link_online,
    estado: resumo.estado,
    total: resumo.total,
    disponiveis: resumo.disponiveis,
    previsao: resumo.previsao ? formatarData_(resumo.previsao) : ''
  };
}

/** Categorias e estados que a tela de cadastro oferece, da mesma fonte que a
 *  validação da planilha usa. */
function lerListasDeCadastro() {
  return { categorias: LISTA_CATEGORIA, estados: LISTA_ESTADO };
}

/**
 * Cadastra título e, opcionalmente, o primeiro exemplar de uma vez.
 *
 * A bibliotecária tem o livro na mão: separar em duas telas obrigaria a
 * decorar o id do título recém-criado para digitar na tela seguinte.
 */
function cadastrarTituloComExemplar(dados, quemRegistrou) {
  var idTitulo = criarTitulo(dados, quemRegistrou);
  var resposta = { id_titulo: idTitulo, tombo: null };

  if (dados && dados.criar_exemplar) {
    resposta.tombo = criarExemplar({
      id_titulo: idTitulo,
      estado: dados.estado_exemplar,
      doado_por: dados.doado_por
    }, quemRegistrou);
  }
  return resposta;
}

/**
 * Consulta a API de livros do Google por ISBN.
 *
 * É atalho, não caminho principal: a API cobre mal edição FEB e LAKE dos anos
 * 70-80, e muita obra do acervo nem tem ISBN. Por isso não achar NÃO é erro —
 * devolve `null` e a tela segue no preenchimento manual, sem alarde.
 *
 * Nunca preenche `autor_espiritual` nem `medium`: o Google devolve o médium no
 * campo de autor, e adivinhar qual dos dois é qual erraria a catalogação de
 * toda psicografia. Quem separa é a bibliotecária (D9).
 */
function buscarPorIsbn(isbn) {
  var limpo = limparCampo_(isbn).replace(/[^0-9Xx]/g, '');
  if (limpo.length !== 10 && limpo.length !== 13) {
    throw new Error('ISBN deve ter 10 ou 13 dígitos.');
  }

  var achados = consultarGoogleBooks_('isbn:' + limpo, 1);
  if (!achados.length) return null;

  var livro = achados[0];
  livro.isbn = limpo;   // o ISBN digitado vale mais que o que a API devolveu
  return livro;
}

/**
 * Procura por título, e opcionalmente autor, quando a consulta por ISBN não
 * acha nada.
 *
 * O índice de ISBN do Google é fraco para editora brasileira — muita obra do
 * acervo tem código de barras impresso e mesmo assim não aparece. Por título,
 * costuma aparecer.
 *
 * Diferente do ISBN, aqui NÃO preenche sozinho: busca por título é ambígua,
 * volta edição de outra editora, de outro ano, e às vezes outro livro. Quem
 * escolhe é a bibliotecária, olhando editora e ano.
 */
function buscarLivrosPorTitulo(titulo, autor) {
  var nome = limparCampo_(titulo);
  if (nome.length < 3) {
    throw new Error('Escreva ao menos três letras do título.');
  }

  var consulta = 'intitle:"' + nome + '"';
  var quem = limparCampo_(autor);
  if (quem) consulta += ' inauthor:"' + quem + '"';

  return consultarGoogleBooks_(consulta, 8);
}

/**
 * A chamada à API, com o tratamento de erro que as duas buscas compartilham.
 * Devolve lista de livros já no nosso formato — possivelmente vazia.
 *
 * Nunca preenche `autor_espiritual` nem `medium`: o Google devolve o médium
 * no campo de autor, e adivinhar qual dos dois é qual erraria a catalogação
 * de toda psicografia. Quem separa é a bibliotecária (D9).
 */
function consultarGoogleBooks_(consulta, quantos) {
  var url = 'https://www.googleapis.com/books/v1/volumes'
    + '?q=' + encodeURIComponent(consulta)
    + '&maxResults=' + quantos;

  // Sem chave, o Google atribui a chamada a um projeto anônimo compartilhado
  // por todo mundo que usa Apps Script — e essa cota diária vive estourada.
  // Com chave, a cota passa a ser da casa. A chave é opcional de propósito:
  // sem ela o sistema segue funcionando, só que a consulta vai falhar mais.
  var chave = limparCampo_(lerConfig('chave_api_livros', ''));
  if (chave) url += '&key=' + encodeURIComponent(chave);

  var resposta;
  try {
    resposta = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  } catch (erro) {
    return [];  // sem internet ou fora do ar: o manual continua valendo
  }

  var codigo = resposta.getResponseCode();

  // 429 e 5xx são "tente de novo", não "não existe". Confundir os dois manda
  // o voluntário digitar tudo à mão quando bastava esperar um minuto — e a
  // API do Google limita por IP quando a chamada não leva chave, então isto
  // acontece de verdade.
  // Cota DIÁRIA, não rajada: esperar alguns minutos não resolve. Sem chave, a
  // cota é de um projeto anônimo compartilhado e costuma já estar estourada.
  if (codigo === 429) {
    throw new Error(
      chave
        ? 'A cota diária da chave da casa acabou. Volta amanhã; até lá, ' +
          'preencha à mão.'
        : 'Cota diária do Google esgotada. Ela é compartilhada com todo mundo ' +
          'que usa Apps Script sem chave própria. Ver "chave_api_livros" na ' +
          'aba Config.'
    );
  }
  if (codigo >= 500) {
    throw new Error('A busca de livros do Google está fora do ar agora. ' +
      'Tente daqui a pouco, ou preencha à mão.');
  }
  if (codigo !== 200) return [];

  var dados;
  try {
    dados = JSON.parse(resposta.getContentText());
  } catch (erro) {
    return [];
  }
  if (!dados.items || !dados.items.length) return [];

  return dados.items.map(function (item) {
    var livro = item.volumeInfo || {};
    return {
      titulo: livro.title || '',
      subtitulo: livro.subtitle || '',
      autor: (livro.authors || []).join('; '),
      editora: livro.publisher || '',
      ano: String(livro.publishedDate || '').substring(0, 4),
      sinopse: livro.description || '',
      isbn: isbnDe_(livro.industryIdentifiers)
    };
  });
}

/** Prefere o ISBN-13; aceita o que houver. */
function isbnDe_(identificadores) {
  var lista = identificadores || [];
  for (var i = 0; i < lista.length; i++) {
    if (lista[i].type === 'ISBN_13') return lista[i].identifier;
  }
  for (var j = 0; j < lista.length; j++) {
    if (String(lista[j].type).indexOf('ISBN') === 0) return lista[j].identifier;
  }
  return '';
}

/** Data no formato que o voluntário lê, no fuso da planilha. */
function formatarData_(data) {
  return Utilities.formatDate(
    data,
    SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(),
    'dd/MM/yyyy'
  );
}

// --- Diagnóstico -------------------------------------------------------------

/**
 * Bate na API do Google Books com quatro consultas diferentes e mostra o
 * resultado cru numa janela da planilha.
 *
 * Existe porque o editor do Apps Script não abre neste navegador, então não há
 * como ler o log de execução. Sem isto, "a busca não funcionou" pode ser
 * limite de acesso, bloqueio, consulta malformada ou obra realmente ausente —
 * e cada um pede uma resposta diferente.
 */
function diagnosticarGoogleBooks() {
  var testes = [
    { nome: 'ISBN 9788501924919 (o que você tentou)', consulta: 'isbn:9788501924919' },
    { nome: 'ISBN 9788535914849 (livro comum, controle)', consulta: 'isbn:9788535914849' },
    { nome: 'Título "Nosso Lar"', consulta: 'intitle:"Nosso Lar"' },
    { nome: 'Palavra solta "kardec"', consulta: 'kardec' }
  ];

  var chave = limparCampo_(lerConfig('chave_api_livros', ''));
  var linhas = [
    'Consulta à API de livros do Google, a partir deste script:',
    'Chave própria em Config: ' + (chave ? 'SIM (' + chave.length + ' caracteres)' : 'NÃO'),
    ''
  ];

  testes.forEach(function (teste) {
    var url = 'https://www.googleapis.com/books/v1/volumes'
      + '?q=' + encodeURIComponent(teste.consulta) + '&maxResults=3'
      + (chave ? '&key=' + encodeURIComponent(chave) : '');
    linhas.push('### ' + teste.nome);
    try {
      var resposta = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
      var codigo = resposta.getResponseCode();
      var corpo = resposta.getContentText();

      var total = '(não consegui ler)';
      var primeiro = '';
      try {
        var dados = JSON.parse(corpo);
        total = dados.totalItems;
        if (dados.items && dados.items.length) {
          var livro = dados.items[0].volumeInfo || {};
          primeiro = livro.title + ' / ' + (livro.authors || []).join('; ') +
            ' / ' + livro.publisher;
        }
      } catch (erro) { /* corpo não é JSON: o próprio corpo vai no relatório */ }

      linhas.push('  HTTP ' + codigo + '   totalItems: ' + total);
      if (primeiro) linhas.push('  1º: ' + primeiro);
      if (codigo !== 200) linhas.push('  corpo: ' + corpo.substring(0, 400));
    } catch (erro) {
      linhas.push('  EXCEÇÃO: ' + erro.message);
    }
    linhas.push('');
  });

  linhas.push('Como ler:');
  linhas.push('  HTTP 200 + totalItems 0 = a obra não está no Google. Normal.');
  linhas.push('  HTTP 429 = limite de acesso. Resolve com chave de API.');
  linhas.push('  HTTP 403 = bloqueio. Também costuma pedir chave de API.');
  linhas.push('  EXCEÇÃO = a chamada nem saiu.');

  mostrarRelatorio_('Diagnóstico — busca de livros', linhas.join('\n'));
}

/** Janela com texto pré-formatado. Alert simples corta texto longo. */
function mostrarRelatorio_(titulo, texto) {
  var escapado = String(texto)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  var html = HtmlService
    .createHtmlOutput('<pre style="font:12px/1.45 monospace;white-space:pre-wrap">' +
      escapado + '</pre>')
    .setWidth(640)
    .setHeight(480);
  SpreadsheetApp.getUi().showModalDialog(html, titulo);
}
