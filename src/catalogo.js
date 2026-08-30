/**
 * catalogo.js — criação e manutenção de títulos e exemplares.
 *
 * Toda função aqui grava. Portanto: valida antes, usa `LockService`, registra
 * na aba `Log` e invalida o cache de títulos. Nenhuma delas apaga linha —
 * baixa é sempre lógica (regras 10 e 15).
 *
 * O acesso à planilha é todo por `planilha.js`. Nada de `SpreadsheetApp` aqui.
 */

/**
 * País informado à API de livros do Google.
 *
 * Sem ele, a chamada volta 403 "Cannot determine user location for
 * geographically restricted operation": a API restringe conteúdo por país e,
 * vindo de servidor, não há navegador nem IP de usuário para o Google inferir
 * a origem — então ele recusa em vez de adivinhar.
 *
 * Fica como constante, e não na aba Config, porque não é configuração que um
 * voluntário mude: é onde a casa está.
 */
var PAIS_API_LIVROS = 'BR';

// --- Títulos -----------------------------------------------------------------

/**
 * Cria um título. `titulo` é o único campo obrigatório: a casa cataloga obra
 * que não possui, para consulta e para a lista de doação desejada (D5), e
 * muita edição antiga da FEB não tem nem ISBN nem ano legíveis.
 */
function criarTitulo(sessao, dados, permitirDuplicata) {
  var quem = exigir_(sessao, 'cadastrar_obra');
  var quemRegistrou = quem.nome;

  var nome = limparCampo_(dados && dados.titulo);
  if (!nome) throw new Error('O título é obrigatório.');

  return comTrava_(function () {
    // Dentro da trava e lendo sem cache, de propósito. A tela já avisa antes
    // de salvar, mas dois voluntários cadastrando o mesmo livro ao mesmo
    // tempo passariam pelo aviso e criariam a duplicata assim mesmo.
    if (!permitirDuplicata) {
      var jaExiste = acharTituloEquivalente(lerTitulos(true), dados);
      if (jaExiste) {
        throw new Error(
          'O título "' + jaExiste.titulo + '" já está cadastrado (nº ' +
          jaExiste.id_titulo + '). Acrescente um exemplar a ele em vez de ' +
          'criar outro.'
        );
      }
    }

    var registro = {
      id_titulo: proximoId_(ABA_TITULOS, 'id_titulo'),
      titulo: nome,
      subtitulo: limparCampo_(dados.subtitulo),
      autor_ou_medium: limparCampo_(dados.autor_ou_medium),
      autor_espiritual: limparCampo_(dados.autor_espiritual),
      tradutor: limparCampo_(dados.tradutor),
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
function atualizarTitulo(sessao, idTitulo, mudancas) {
  var quemRegistrou = exigir_(sessao, 'editar_obra').nome;

  return comTrava_(function () {
    var titulo = lerTitulo(idTitulo);
    if (!titulo) throw new Error('Título ' + idTitulo + ' não existe.');

    var permitidos = [
      'titulo', 'subtitulo', 'autor_ou_medium', 'autor_espiritual', 'tradutor',
      'isbn', 'categoria', 'serie', 'ordem_na_serie', 'sinopse', 'link_online',
      'observacao'
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
function criarExemplar(sessao, dados) {
  var quemRegistrou = exigir_(sessao, 'cadastrar_obra').nome;

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
      edicao: limparCampo_(dados.edicao),
      editora: limparCampo_(dados.editora),
      ano: limparCampo_(dados.ano),
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
function darBaixaExemplar(sessao, tombo, motivo) {
  var quemRegistrou = exigir_(sessao, 'dar_baixa').nome;

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
    var meus = porTitulo[Number(titulo.id_titulo)] || [];
    var resumo = resumirDisponibilidade(meus);
    return {
      id_titulo: titulo.id_titulo,
      titulo: titulo.titulo,
      subtitulo: titulo.subtitulo,
      autoria: montarAutoria(titulo),
      categoria: titulo.categoria,
      serie: titulo.serie,
      ordem_na_serie: titulo.ordem_na_serie,
      link_online: titulo.link_online,
      // Editora e ano agora vêm dos exemplares, e podem ser vários. A busca
      // mostra o título, então resume o que existe na estante.
      edicoes: resumirEdicoes(meus),
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
    autor_ou_medium: titulo.autor_ou_medium,
    autor_espiritual: titulo.autor_espiritual,
    tradutor: titulo.tradutor,
    isbn: titulo.isbn,
    categoria: titulo.categoria,
    serie: titulo.serie,
    ordem_na_serie: titulo.ordem_na_serie,
    sinopse: titulo.sinopse,
    link_online: titulo.link_online,
    edicoes: resumirEdicoes(exemplares),
    estado: resumo.estado,
    total: resumo.total,
    disponiveis: resumo.disponiveis,
    previsao: resumo.previsao ? formatarData_(resumo.previsao) : ''
  };
}

/**
 * A tela pergunta isto ANTES de salvar, para poder oferecer a saída certa em
 * vez de só recusar. Quem cadastra um livro que já existe quase sempre quer
 * acrescentar um exemplar, não criar outra ficha.
 *
 * Devolve null quando não há conflito. Quando há, devolve o suficiente para a
 * tela mostrar de qual obra se trata — sem , como toda saída daqui.
 */
function verificarTituloExistente(sessao, dados) {
  exigir_(sessao, 'cadastrar_obra');
  var achado = acharTituloEquivalente(lerTitulos(), dados);
  if (!achado) return null;

  var exemplares = lerExemplares().filter(function (exemplar) {
    return Number(exemplar.id_titulo) === Number(achado.id_titulo);
  });
  var resumo = resumirDisponibilidade(exemplares);

  return {
    id_titulo: achado.id_titulo,
    titulo: achado.titulo,
    autoria: montarAutoria(achado),
    total: resumo.total,
    disponiveis: resumo.disponiveis,
    edicoes: resumirEdicoes(exemplares)
  };
}

/**
 * Acrescenta um exemplar a um título que já existe. É o que a tela oferece
 * quando detecta duplicata.
 */
function acrescentarExemplar(sessao, idTitulo, dados) {
  return criarExemplar(sessao, {
    id_titulo: idTitulo,
    edicao: dados && dados.edicao,
    editora: dados && dados.editora,
    ano: dados && dados.ano,
    estado: dados && dados.estado_exemplar,
    doado_por: dados && dados.doado_por
  });
}

/**
 * O que já foi digitado antes, para a tela oferecer de volta.
 *
 * Não é só conveniência de digitação: é o que mantém o acervo consistente.
 * Sem isto, "FEB", "F.E.B." e "Feb Editora" viram três editoras diferentes, e
 * aí a busca por editora não acha e o agrupamento por edição se despedaça —
 * em silêncio, porque nada erra: só existem três coisas onde havia uma.
 *
 * Exige perfil de catalogação porque `doado_por` é nome de pessoa.
 */
function lerSugestoesDeCadastro(sessao) {
  exigir_(sessao, 'cadastrar_obra');

  var titulos = lerTitulos();
  var exemplares = lerExemplares();

  return {
    autor_ou_medium: distintos_(titulos, 'autor_ou_medium'),
    autor_espiritual: distintos_(titulos, 'autor_espiritual'),
    tradutor: distintos_(titulos, 'tradutor'),
    serie: distintos_(titulos, 'serie'),
    editora: distintos_(exemplares, 'editora'),
    doado_por: distintos_(exemplares, 'doado_por')
  };
}

/**
 * Valores distintos de uma coluna, em ordem alfabética.
 *
 * Compara normalizado para não oferecer "FEB Editora" e "feb editora" como se
 * fossem duas opções — mas devolve a grafia como foi escrita, porque é ela que
 * vai para a ficha.
 */
function distintos_(linhas, campo) {
  var vistos = {};
  var lista = [];

  (linhas || []).forEach(function (linha) {
    var valor = limparCampo_(linha[campo]);
    if (!valor) return;
    var chave = normalizarTexto(valor);
    if (vistos[chave]) return;
    vistos[chave] = true;
    lista.push(valor);
  });

  return lista.sort(function (a, b) {
    return normalizarTexto(a).localeCompare(normalizarTexto(b));
  });
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
function cadastrarTituloComExemplar(sessao, dados, permitirDuplicata) {
  var idTitulo = criarTitulo(sessao, dados, permitirDuplicata);
  var resposta = { id_titulo: idTitulo, tombo: null };

  if (dados && dados.criar_exemplar) {
    resposta.tombo = criarExemplar(sessao, {
      id_titulo: idTitulo,
      edicao: dados.edicao,
      editora: dados.editora,
      ano: dados.ano,
      estado: dados.estado_exemplar,
      doado_por: dados.doado_por
    });
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
function buscarPorIsbn(sessao, isbn) {
  exigir_(sessao, 'cadastrar_obra');

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
function buscarLivrosPorTitulo(sessao, titulo, autor) {
  exigir_(sessao, 'cadastrar_obra');

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
    + '&maxResults=' + quantos
    + '&country=' + PAIS_API_LIVROS;

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

    // O Google preserva a marca "(Espírito)" da catalogação brasileira, então
    // dá para separar médium de autor espiritual sem chutar. Antes isto era
    // trabalho manual da bibliotecária em toda psicografia.
    var autoria = separarAutoria(livro.authors);

    return {
      titulo: livro.title || '',
      subtitulo: livro.subtitle || '',
      autor_ou_medium: autoria.autor_ou_medium,
      autor_espiritual: autoria.autor_espiritual,
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
      + '&country=' + PAIS_API_LIVROS
      + (chave ? '&key=' + encodeURIComponent(chave) : '');
    linhas.push('### ' + teste.nome);
    try {
      var resposta = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
      var codigo = resposta.getResponseCode();
      var corpo = resposta.getContentText();

      var total = '(não consegui ler)';
      var primeiro = '';
      var separado = '';
      try {
        var dados = JSON.parse(corpo);
        total = dados.totalItems;
        if (dados.items && dados.items.length) {
          var livro = dados.items[0].volumeInfo || {};
          primeiro = livro.title + ' / ' + (livro.authors || []).join('; ') +
            ' / ' + (livro.publisher || 'sem editora');

          // Mostra também como o sistema interpreta esses autores. O bloco
          // acima é a resposta crua; este é o que vai para a ficha. Ver os
          // dois lado a lado é o que permite conferir a separação de
          // psicografia sem abrir a tela de cadastro.
          var autoria = separarAutoria(livro.authors);
          separado = 'autor_ou_medium: "' + autoria.autor_ou_medium + '"' +
            ' | autor_espiritual: "' + autoria.autor_espiritual + '"';
        }
      } catch (erro) { /* corpo não é JSON: o próprio corpo vai no relatório */ }

      linhas.push('  HTTP ' + codigo + '   totalItems: ' + total);
      if (primeiro) linhas.push('  cru      : ' + primeiro);
      if (separado) linhas.push('  separado : ' + separado);
      if (codigo !== 200) linhas.push('  corpo: ' + corpo.substring(0, 400));
    } catch (erro) {
      linhas.push('  EXCEÇÃO: ' + erro.message);
    }
    linhas.push('');
  });

  linhas.push('Como ler:');
  linhas.push('  HTTP 200 + totalItems 0 = a obra não está no Google. Normal,');
  linhas.push('    e a resposta que interessa: mede a cobertura do acervo.');
  linhas.push('  HTTP 200 + totalItems > 0 = funcionando.');
  linhas.push('  HTTP 429 = cota diária esgotada. Falta chave própria em Config.');
  linhas.push('  HTTP 403 unknownLocation = falta o parâmetro country na URL.');
  linhas.push('  HTTP 403 outro motivo = chave inválida ou Books API desativada.');
  linhas.push('  EXCEÇÃO = a chamada nem saiu do Apps Script.');

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

/**
 * Pré-cadastra as obras de `acervo-base.js` na aba `Titulos`.
 *
 * Roda pelo menu da planilha, não pelo Web App: é operação de catalogação em
 * massa, feita uma vez, por quem já tem a planilha aberta — e ter a planilha
 * aberta já é a permissão (é o mesmo raciocínio de `criarEstruturaPlanilha`).
 *
 * IDEMPOTENTE. Pula toda obra que já exista, comparando pelo mesmo
 * `acharTituloEquivalente` que a tela de cadastro usa. Rodar duas vezes não
 * duplica, e acrescentar obras ao arquivo e rodar de novo importa só as novas.
 *
 * NUNCA CRIA EXEMPLAR. O título entra com zero exemplares — que é o D5: a casa
 * não passa a ter o livro, passa a saber que ele existe. Quem tem exemplar de
 * verdade é a estante, e isso se cadastra um a um, com tombo.
 */
function importarAcervoBase() {
  var candidatos = montarAcervoBase_();

  return comTrava_(function () {
    // Sem cache de propósito: uma importação anterior na mesma sessão teria
    // deixado a lista velha, e a checagem de duplicata passaria batido.
    var existentes = lerTitulos(true);

    // Compara SÓ pelo título, e não pelo par título+autoria que a tela de
    // cadastro usa.
    //
    // A tela compara os dois porque está julgando o que uma pessoa acabou de
    // digitar, com o livro na mão: ali, dois "Reencontro" de autores
    // diferentes são obras diferentes e ambas devem entrar. Aqui é o
    // contrário. As obras já cadastradas vieram do Google Books, que grava
    // "Francisco Cândido Xavier"; este arquivo grava "Francisco Cândido
    // Xavier (Chico Xavier)", que é a convenção de catalogação da casa. Pela
    // regra da tela as duas autorias divergem, e "Nosso Lar" ganharia uma
    // segunda ficha — com os exemplares na primeira e o pré-cadastro na
    // segunda, que é o pior resultado possível.
    //
    // Errar para o lado de pular é barato: no máximo uma obra homônima deixa
    // de ser pré-cadastrada, e ela se cadastra à mão em meio minuto. Errar
    // para o lado de duplicar racha o acervo em duas fichas.
    var jaCadastrado = {};
    existentes.forEach(function (titulo) {
      jaCadastrado[normalizarTexto(titulo.titulo)] = true;
    });

    var novos = [];
    var pulados = [];

    candidatos.forEach(function (obra) {
      var chave = normalizarTexto(obra.titulo);
      if (jaCadastrado[chave]) {
        pulados.push(obra.titulo);
        return;
      }
      // Marca já: se o próprio arquivo tiver a mesma obra duas vezes, a
      // segunda tem que ser pulada igual.
      jaCadastrado[chave] = true;
      novos.push(obra);
    });

    if (!novos.length) {
      return { criados: 0, pulados: pulados.length, primeiroId: 0 };
    }

    var proximo = proximoId_(ABA_TITULOS, 'id_titulo');
    var registros = novos.map(function (obra, i) {
      return {
        id_titulo: proximo + i,
        titulo: obra.titulo,
        subtitulo: '',
        autor_ou_medium: obra.autor_ou_medium,
        autor_espiritual: obra.autor_espiritual,
        tradutor: '',
        isbn: '',
        categoria: '',
        serie: obra.serie,
        ordem_na_serie: obra.ordem_na_serie,
        sinopse: '',
        link_online: '',
        observacao: obra.observacao
      };
    });

    escreverLinhas_(ABA_TITULOS, registros);
    invalidarCacheTitulos_();

    // Uma linha de log para a importação inteira, não uma por título: 666
    // linhas no `Log` afogariam o histórico de empréstimo, que é o que
    // alguém vai querer ler ali.
    registrarLog_('(menu da planilha)', 'importar', 'titulo', 0,
      novos.length + ' obra(s) pré-cadastrada(s), ' + pulados.length + ' já existia(m)');

    return {
      criados: novos.length,
      pulados: pulados.length,
      primeiroId: proximo
    };
  });
}

/**
 * O item de menu. Pergunta antes: acrescentar centenas de linhas é visível e
 * ninguém deve descobrir que fez isso depois de feito.
 */
function preCadastrarAcervo() {
  var ui = SpreadsheetApp.getUi();
  var quantas = montarAcervoBase_().length;

  var resposta = ui.alert(
    'Pré-cadastrar o acervo base',
    'Vou acrescentar até ' + quantas + ' obras espíritas conhecidas à aba ' +
    'Titulos: Kardec, as psicografias de Chico Xavier e as de Divaldo Franco.\n\n' +
    'Elas entram SEM exemplar: aparecem na busca como "a casa não tem", e ' +
    'servem para catalogar mais rápido e para montar a lista de doações.\n\n' +
    'O que já estiver cadastrado é pulado. Pode rodar de novo sem duplicar.\n\n' +
    'Continuar?',
    ui.ButtonSet.YES_NO
  );
  if (resposta !== ui.Button.YES) return;

  try {
    var r = importarAcervoBase();
    ui.alert(
      'Pré-cadastro concluído',
      r.criados + ' obra(s) acrescentada(s).\n' +
      r.pulados + ' já estava(m) cadastrada(s) e foi(ram) pulada(s).\n\n' +
      (r.criados
        ? 'Confira a aba Titulos. A coluna observacao diz de onde veio cada ' +
          'linha; o ano ali é o da fonte e pode não bater com o exemplar.'
        : 'Nada a fazer — o acervo base já está todo cadastrado.'),
      ui.ButtonSet.OK
    );
  } catch (erro) {
    ui.alert('Não consegui pré-cadastrar', erro.message, ui.ButtonSet.OK);
  }
}
