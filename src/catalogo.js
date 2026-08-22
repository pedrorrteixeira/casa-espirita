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
