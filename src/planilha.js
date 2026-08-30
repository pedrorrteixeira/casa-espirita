/**
 * planilha.js — todo acesso a SpreadsheetApp vive aqui.
 *
 * Nenhum outro arquivo chama `getRange`, `getValues` ou `setValues`. Quem
 * precisa de dado chama uma função daqui e recebe objeto JavaScript com as
 * chaves iguais aos cabeçalhos da aba.
 *
 * TRÊS REGRAS QUE NÃO PODEM SER QUEBRADAS
 * ---------------------------------------
 * 1. Leitura e escrita em LOTE. `getValues()`/`setValues()` sobre intervalo.
 *    `getValue()` dentro de laço estoura quota e fica lento.
 *
 * 2. Em `Titulos` e `Exemplares`, `getLastRow()` MENTE. As colunas derivadas
 *    são uma ARRAYFORMULA que preenche a coluna inteira com "", e o Apps
 *    Script conta isso como conteúdo: devolve 1000. Use sempre
 *    `ultimaLinhaDeDados_()`, que conta pela coluna-chave.
 *
 * 3. NUNCA escrever em coluna derivada (`Titulos!P:Q`, `Exemplares!G:I`).
 *    Escrever quebra a ARRAYFORMULA com #REF!. `escreverLinha_()` recusa.
 */

var ABA_CONFIG = 'Config';
var ABA_TITULOS = 'Titulos';
var ABA_EXEMPLARES = 'Exemplares';
var ABA_PESSOAS = 'Pessoas';
var ABA_EMPRESTIMOS = 'Emprestimos';
var ABA_REUNIOES = 'Reunioes';
var ABA_SUGESTOES = 'Sugestoes';
var ABA_LOG = 'Log';

/**
 * Colunas que são ARRAYFORMULA, por aba, em base 1.
 *
 * É um CONJUNTO, não uma fronteira. Em `Exemplares` as derivadas são as três
 * últimas, mas em `Titulos` elas ficam no MEIO: P e Q são fórmula e R
 * (`observacao`) volta a ser escrita normal. Tratar isso como "tudo a partir
 * da coluna 16" recusava gravar a observação de qualquer título.
 *
 * Nas abas listadas aqui, `getLastRow()` também não serve — a fórmula preenche
 * a coluna inteira com "" e o Apps Script conta como conteúdo.
 */
var COLUNAS_DERIVADAS = {
  Titulos: [13, 14],           // M qtd_exemplares, N qtd_disponiveis
  Exemplares: [10, 11, 12]     // J situacao, K com_quem, L previsao_devolucao
};

function ehColunaDerivada_(nome, coluna) {
  var derivadas = COLUNAS_DERIVADAS[nome];
  return !!derivadas && derivadas.indexOf(coluna) !== -1;
}

var CACHE_SEGUNDOS = 300;              // 5 minutos, como pede o PLANO.md
var CACHE_LIMITE_PEDACO = 90 * 1024;   // o CacheService corta em 100KB por chave

// --- Leitura -----------------------------------------------------------------

/**
 * Lê uma aba inteira em lote e devolve array de objetos, chave = cabeçalho.
 * Acrescenta `_linha` — o número da linha na planilha, necessário para
 * atualizar depois sem procurar de novo.
 */
function lerAba_(nome) {
  var aba = abaOuErro_(nome);
  var totalColunas = aba.getLastColumn();
  if (totalColunas === 0) return [];

  var cabecalhos = aba.getRange(1, 1, 1, totalColunas).getValues()[0];
  var ultima = ultimaLinhaDeDados_(aba);
  if (ultima < 2) return [];

  var linhas = aba.getRange(2, 1, ultima - 1, totalColunas).getValues();

  return linhas.map(function (linha, i) {
    var registro = { _linha: i + 2 };
    cabecalhos.forEach(function (cabecalho, c) {
      if (cabecalho !== '') registro[String(cabecalho)] = linha[c];
    });
    return registro;
  });
}

/**
 * Última linha que tem dado de verdade.
 *
 * Em `Titulos` e `Exemplares` conta pela coluna A, porque `getLastRow()` é
 * envenenado pela ARRAYFORMULA das colunas derivadas. Nas outras cinco abas
 * `getLastRow()` é confiável e sai mais barato.
 */
function ultimaLinhaDeDados_(aba) {
  var nome = aba.getName();
  if (!COLUNAS_DERIVADAS[nome]) return aba.getLastRow();

  var maximo = aba.getMaxRows();
  if (maximo < 2) return 1;

  var chave = aba.getRange(2, 1, maximo - 1, 1).getValues();
  for (var i = chave.length - 1; i >= 0; i--) {
    if (String(chave[i][0]).trim() !== '') return i + 2;
  }
  return 1;
}

function abaOuErro_(nome) {
  var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nome);
  if (!aba) {
    throw new Error(
      'A aba "' + nome + '" não existe. Rode "Biblioteca → Criar / atualizar ' +
      'estrutura da planilha" no menu.'
    );
  }
  return aba;
}

// --- Config ------------------------------------------------------------------

/**
 * Lê uma chave da aba `Config`. Nada de valor de configuração hardcoded:
 * prazo, e-mail do admin e id do calendário mudam sem tocar em código.
 */
function lerConfig(chave, padrao) {
  var pares = lerAba_(ABA_CONFIG);
  for (var i = 0; i < pares.length; i++) {
    if (String(pares[i].chave).trim() === chave) {
      var valor = pares[i].valor;
      if (valor === '' || valor === null || valor === undefined) break;
      return valor;
    }
  }
  if (padrao === undefined) {
    throw new Error('Falta a chave "' + chave + '" na aba Config.');
  }
  return padrao;
}

function lerConfigNumero(chave, padrao) {
  var valor = Number(lerConfig(chave, padrao));
  if (!isFinite(valor)) {
    throw new Error('A chave "' + chave + '" da aba Config não é um número.');
  }
  return valor;
}

// --- Títulos, com cache ------------------------------------------------------

/**
 * Lista de títulos para busca e listagem. Cacheada por 5 minutos: a tela de
 * busca lê a mesma lista a cada tecla, e ler a aba inteira toda vez
 * desperdiça quota.
 *
 * NÃO traz `sinopse`. É o campo que mais pesa, a busca não usa, e é o que faz
 * o acervo caber no cache. Quem precisa da sinopse chama `lerTitulo(id)`.
 *
 * Traz sempre a mesma forma, venha do cache ou da planilha — se o caminho com
 * cache devolvesse campo diferente do caminho sem, o bug só apareceria depois
 * de 5 minutos de uso e ninguém ligaria uma coisa à outra.
 */
function lerTitulos(ignorarCache) {
  if (!ignorarCache) {
    var doCache = lerDoCache_('titulos');
    if (doCache) return doCache;
  }

  var titulos = lerAba_(ABA_TITULOS).map(function (titulo) {
    var copia = {};
    Object.keys(titulo).forEach(function (campo) {
      if (campo !== 'sinopse') copia[campo] = titulo[campo];
    });
    return copia;
  });

  gravarNoCache_('titulos', titulos);
  return titulos;
}

function lerTitulo(idTitulo) {
  var alvo = Number(idTitulo);
  var achados = lerAba_(ABA_TITULOS).filter(function (titulo) {
    return Number(titulo.id_titulo) === alvo;
  });
  return achados.length ? achados[0] : null;
}

function lerExemplares() {
  return lerAba_(ABA_EXEMPLARES);
}

function lerPessoas() {
  return lerAba_(ABA_PESSOAS);
}

function lerEmprestimos() {
  return lerAba_(ABA_EMPRESTIMOS);
}

// --- Escrita -----------------------------------------------------------------

/**
 * Acrescenta uma linha, montada a partir de um objeto com chaves iguais aos
 * cabeçalhos. Devolve o número da linha criada.
 *
 * Recusa escrever em coluna derivada: é o único ponto do código que poderia
 * quebrar a ARRAYFORMULA, então a checagem mora aqui e não na disciplina de
 * quem chama.
 */
function escreverLinha_(nome, registro) {
  var aba = abaOuErro_(nome);
  var totalColunas = aba.getLastColumn();
  var cabecalhos = aba.getRange(1, 1, 1, totalColunas).getValues()[0];

  // Confere antes de montar nada: campo com nome errado tem que estourar, não
  // sumir calado. Um `observacoes` no lugar de `observacao` seria perda de
  // dado que ninguém notaria.
  Object.keys(registro).forEach(function (campo) {
    if (campo === '_linha') return;
    var posicao = cabecalhos.indexOf(campo);
    if (posicao === -1) {
      throw new Error('A coluna "' + campo + '" não existe na aba ' + nome + '.');
    }
    if (ehColunaDerivada_(nome, posicao + 1)) {
      throw new Error(
        'Tentativa de escrever na coluna derivada "' + campo + '" de ' + nome +
        '. Essa coluna é ARRAYFORMULA — escrever nela quebra a fórmula com #REF!.'
      );
    }
  });

  var linha = ultimaLinhaDeDados_(aba) + 1;

  // Grava em trechos contíguos, pulando as derivadas. Em `Titulos` são dois
  // trechos (A:O e R), porque P e Q ficam no meio. Um `setValues` cobrindo
  // A:R passaria por cima das fórmulas.
  var trecho = [];
  var inicio = 0;
  for (var c = 1; c <= totalColunas; c++) {
    if (ehColunaDerivada_(nome, c)) {
      gravarTrecho_(aba, linha, inicio, trecho);
      trecho = [];
      inicio = 0;
      continue;
    }
    if (!trecho.length) inicio = c;
    var campo = String(cabecalhos[c - 1]);
    trecho.push(registro[campo] === undefined ? '' : registro[campo]);
  }
  gravarTrecho_(aba, linha, inicio, trecho);

  return linha;
}

function gravarTrecho_(aba, linha, inicio, valores) {
  if (!valores.length) return;
  aba.getRange(linha, inicio, 1, valores.length).setValues([valores]);
}

/**
 * Grava várias linhas de uma vez, no fim da aba.
 *
 * Existe porque `escreverLinha_` faz um `setValues` por trecho e por linha:
 * importar 666 títulos daria 1.332 chamadas e estouraria o tempo de execução.
 * Aqui são dois `setValues` no total, um por trecho contíguo.
 *
 * Mesma recusa de coluna derivada, e pela mesma razão — só que aqui o estrago
 * seria maior: um `setValues` cobrindo A:O de uma vez apagaria a ARRAYFORMULA
 * de M e N, e com ela as colunas derivadas do acervo inteiro.
 */
function escreverLinhas_(nome, registros) {
  if (!registros || !registros.length) return 0;

  var aba = abaOuErro_(nome);
  var totalColunas = aba.getLastColumn();
  var cabecalhos = aba.getRange(1, 1, 1, totalColunas).getValues()[0];

  registros.forEach(function (registro) {
    Object.keys(registro).forEach(function (campo) {
      var posicao = cabecalhos.indexOf(campo);
      if (posicao === -1) {
        throw new Error('A coluna "' + campo + '" não existe na aba ' + nome + '.');
      }
      if (ehColunaDerivada_(nome, posicao + 1)) {
        throw new Error(
          'Tentativa de escrever na coluna derivada "' + campo + '" de ' + nome +
          '. Essa coluna é ARRAYFORMULA — escrever nela quebra a fórmula com #REF!.'
        );
      }
    });
  });

  var primeira = ultimaLinhaDeDados_(aba) + 1;

  // Monta os trechos contíguos uma vez só, e grava cada um com todas as linhas.
  var trechos = [];
  var atual = null;
  for (var c = 1; c <= totalColunas; c++) {
    if (ehColunaDerivada_(nome, c)) { atual = null; continue; }
    if (!atual) { atual = { inicio: c, campos: [] }; trechos.push(atual); }
    atual.campos.push(String(cabecalhos[c - 1]));
  }

  trechos.forEach(function (trecho) {
    var matriz = registros.map(function (registro) {
      return trecho.campos.map(function (campo) {
        return registro[campo] === undefined ? '' : registro[campo];
      });
    });
    aba.getRange(primeira, trecho.inicio, matriz.length, trecho.campos.length)
      .setValues(matriz);
  });

  return primeira;
}
/**
 * Atualiza células soltas de uma linha existente. Mesma recusa de coluna
 * derivada. Escreve célula a célula porque as colunas raramente são vizinhas;
 * o volume aqui é de unidades, não de centenas.
 */
function atualizarCelulas_(nome, linha, mudancas) {
  var aba = abaOuErro_(nome);
  var cabecalhos = aba.getRange(1, 1, 1, aba.getLastColumn()).getValues()[0];

  Object.keys(mudancas).forEach(function (campo) {
    var posicao = cabecalhos.indexOf(campo);
    if (posicao === -1) {
      throw new Error('A coluna "' + campo + '" não existe em ' + nome + '.');
    }
    if (ehColunaDerivada_(nome, posicao + 1)) {
      throw new Error(
        'Tentativa de escrever na coluna derivada "' + campo + '" de ' + nome + '.'
      );
    }
    aba.getRange(linha, posicao + 1).setValue(mudancas[campo]);
  });
}

/**
 * Próximo identificador numérico de uma aba (D13).
 *
 * Não usa a contagem de linhas: linha nunca é apagada neste sistema, mas
 * contar linha daria o número errado se algum dia alguém apagar uma à mão.
 * Vai pelo maior id existente.
 */
function proximoId_(nome, colunaId) {
  var maior = 0;
  lerAba_(nome).forEach(function (registro) {
    var id = Number(registro[colunaId]);
    if (isFinite(id) && id > maior) maior = id;
  });
  return maior + 1;
}

// --- Log ---------------------------------------------------------------------

/**
 * Registra uma escrita na aba `Log` (regra 14).
 *
 * `detalhe` nunca deve levar dado pessoal: os logs ficam retidos e a aba é
 * visível a quem tem a planilha. Referencie por id, não por nome.
 */
function registrarLog_(usuario, acao, entidade, id, detalhe) {
  var aba = abaOuErro_(ABA_LOG);
  aba.appendRow([
    new Date(),
    usuario || '(não identificado)',
    acao,
    entidade,
    id,
    detalhe || ''
  ]);
}

// --- Auxiliares de escrita, compartilhados -----------------------------------
// Moram aqui, e não no arquivo que os usa, porque Apps Script tem um escopo
// global só: se `catalogo.js` e `emprestimos.js` definissem `comTrava_` cada
// um, uma definição sobrescreveria a outra em silêncio, na ordem em que os
// arquivos fossem concatenados.

var LOCK_ESPERA_MS = 10000;

/**
 * Roda a escrita dentro de `LockService`.
 *
 * Vale para o catálogo, e não só para empréstimo: `proximoId_()` lê o maior id
 * e soma um. Dois cadastros ao mesmo tempo, sem trava, dariam o mesmo tombo a
 * dois livros diferentes — e o tombo vai colado na etiqueta do livro.
 */
function comTrava_(operacao) {
  var trava = LockService.getScriptLock();
  if (!trava.tryLock(LOCK_ESPERA_MS)) {
    throw new Error(
      'O sistema está ocupado com outra gravação. Espere um instante e tente ' +
      'de novo.'
    );
  }
  try {
    return operacao();
  } finally {
    trava.releaseLock();
  }
}

function limparCampo_(valor) {
  if (valor === null || valor === undefined) return '';
  return String(valor).trim();
}

/** Célula vazia. `getValues()` devolve '' para vazia, nunca null — mas o
 *  JSON do cache pode devolver null, então checa os dois. */
function ehVazio_(valor) {
  return valor === '' || valor === null || valor === undefined;
}

// --- Cache -------------------------------------------------------------------

/**
 * O CacheService corta em 100KB por chave, e um acervo de algumas centenas de
 * títulos passa disso. Então parte em pedaços e guarda quantos foram.
 *
 * CUIDADO: passa por JSON, e JSON não tem tipo Date — objeto Date volta como
 * string ISO. `Titulos` não tem coluna de data, por isso cabe aqui. Antes de
 * cachear `Exemplares`, `Emprestimos` ou `Reunioes`, que têm, é preciso
 * reidratar as datas na volta.
 */
function gravarNoCache_(nome, dados) {
  var cache = CacheService.getScriptCache();
  var texto = JSON.stringify(dados);

  var pedacos = {};
  var total = 0;
  for (var i = 0; i < texto.length; i += CACHE_LIMITE_PEDACO) {
    pedacos[nome + '_' + total] = texto.substring(i, i + CACHE_LIMITE_PEDACO);
    total++;
  }

  // Sem isso, um acervo que encolhe deixaria pedaço velho para trás e o JSON
  // remontado sairia corrompido.
  pedacos[nome + '_total'] = String(total);

  try {
    cache.putAll(pedacos, CACHE_SEGUNDOS);
  } catch (erro) {
    // Cache é otimização, não requisito. Se falhar, a próxima leitura vai na
    // planilha e o sistema segue funcionando.
    console.log('Cache de "%s" não gravado: %s', nome, erro.message);
  }
}

function lerDoCache_(nome) {
  var cache = CacheService.getScriptCache();
  var total = Number(cache.get(nome + '_total'));
  if (!isFinite(total) || total < 1) return null;

  var chaves = [];
  for (var i = 0; i < total; i++) chaves.push(nome + '_' + i);

  var pedacos = cache.getAll(chaves);
  var texto = '';
  for (var j = 0; j < total; j++) {
    var pedaco = pedacos[nome + '_' + j];
    if (pedaco === undefined || pedaco === null) return null;  // expirou no meio
    texto += pedaco;
  }

  try {
    return JSON.parse(texto);
  } catch (erro) {
    return null;
  }
}

/** Chamada por toda escrita no catálogo, senão a busca serve dado velho. */
function invalidarCacheTitulos_() {
  var cache = CacheService.getScriptCache();
  var total = Number(cache.get('titulos_total'));
  var chaves = ['titulos_total'];
  if (isFinite(total)) {
    for (var i = 0; i < total; i++) chaves.push('titulos_' + i);
  }
  cache.removeAll(chaves);
}

// Exporta para o `node --test`. Em Apps Script a guarda não dispara.
if (typeof module !== 'undefined') { module.exports = { COLUNAS_DERIVADAS: COLUNAS_DERIVADAS }; }
