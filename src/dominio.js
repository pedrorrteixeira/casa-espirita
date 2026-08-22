/**
 * dominio.js — funções puras.
 *
 * Única camada testável em node: sem `SpreadsheetApp`, `CalendarApp` ou
 * `MailApp`, sem leitura de `Config`, sem data de hoje implícita. Tudo o que
 * a função precisa chega por parâmetro.
 *
 * Rodapé exporta para o `node --test`. Em Apps Script a guarda não dispara e
 * as funções ficam no escopo global, como o runtime espera.
 */

/**
 * Reduz um texto à forma comparável na busca: sem acento, minúsculo, com
 * espaços colapsados.
 *
 * O acervo é digitado por voluntários diferentes ao longo de anos, e quem
 * busca digita no celular, sem acento. "andre luiz" tem que achar
 * "André Luiz" — senão a busca só serve para quem já sabe a grafia exata.
 */
function normalizarTexto(texto) {
  if (texto === null || texto === undefined) return '';
  return String(texto)
    .normalize('NFD')                 // separa a letra do acento
    .replace(/[\u0300-\u036f]/g, '')  // descarta os acentos soltos
                                      // (escapado de propósito: literal seriam
                                      //  caracteres invisíveis no código-fonte)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Monta a linha de autoria para exibição, resolvendo autor comum vs. obra
 * psicografada (D9).
 *
 * Em psicografia, autor espiritual e médium são pessoas diferentes e as duas
 * importam: o frequentador pede tanto "um do André Luiz" quanto "um do Chico".
 *
 * Se `autor` vier preenchido junto com `autor_espiritual` — o que a
 * especificação pede para não fazer —, a forma psicografada ganha, por ser a
 * mais específica.
 */
function montarAutoria(titulo) {
  if (!titulo) return '';

  var autor = limpar_(titulo.autor);
  var espiritual = limpar_(titulo.autor_espiritual);
  var medium = limpar_(titulo.medium);

  if (espiritual && medium) return espiritual + ' (psicografia de ' + medium + ')';
  if (espiritual) return espiritual;
  if (medium) return 'psicografia de ' + medium;
  return autor;
}

/**
 * Busca títulos por `titulo`, `autor`, `autor_espiritual`, `medium` e `serie`,
 * simultaneamente.
 *
 * Casa todas as palavras do termo (E, não OU): "andre luiz" acha os livros de
 * André Luiz, e não tudo que tem "luiz" em algum lugar. Cada palavra casa como
 * pedaço, então "espirit" acha "Espíritos".
 *
 * Termo vazio devolve lista vazia, não o acervo inteiro — a tela pede para
 * digitar em vez de despejar centenas de linhas.
 *
 * Não conhece exemplar nem empréstimo: disponibilidade é outra camada. Isto
 * aqui só decide o que casa e em que ordem aparece.
 */
function buscarTitulos(titulos, termo) {
  var palavras = normalizarTexto(termo).split(' ').filter(function (palavra) {
    return palavra.length > 0;
  });
  if (palavras.length === 0) return [];

  var achados = (titulos || []).filter(function (titulo) {
    var alvo = camposDeBusca_(titulo);
    return palavras.every(function (palavra) {
      return alvo.indexOf(palavra) !== -1;
    });
  });

  return achados.sort(function (a, b) {
    return compararAchados_(a, b, palavras);
  });
}

// --- Auxiliares --------------------------------------------------------------

function limpar_(valor) {
  if (valor === null || valor === undefined) return '';
  return String(valor).trim();
}

/** Os cinco campos pesquisáveis, normalizados e juntos num texto só. */
function camposDeBusca_(titulo) {
  return normalizarTexto([
    titulo.titulo,
    titulo.autor,
    titulo.autor_espiritual,
    titulo.medium,
    titulo.serie
  ].join(' '));
}

/**
 * Ordena o resultado. Três critérios, nesta ordem:
 *
 * 1. Quem casa no próprio título vem antes de quem só casa por autor ou série.
 *    Quem digita "nosso lar" quer o livro, não a série inteira.
 * 2. Dentro da mesma série, ordem de leitura vence ordem alfabética — "Nosso
 *    Lar" antes de "Os Mensageiros", ainda que M venha antes de N.
 * 3. Alfabético, para o resultado não mudar de ordem entre uma busca e outra.
 */
function compararAchados_(a, b, palavras) {
  var pesoA = casaNoTitulo_(a, palavras) ? 0 : 1;
  var pesoB = casaNoTitulo_(b, palavras) ? 0 : 1;
  if (pesoA !== pesoB) return pesoA - pesoB;

  var serieA = normalizarTexto(a.serie);
  var serieB = normalizarTexto(b.serie);
  if (serieA && serieA === serieB) {
    var ordemA = numeroOuNulo_(a.ordem_na_serie);
    var ordemB = numeroOuNulo_(b.ordem_na_serie);
    if (ordemA !== null && ordemB !== null && ordemA !== ordemB) {
      return ordemA - ordemB;
    }
  }

  return normalizarTexto(a.titulo).localeCompare(normalizarTexto(b.titulo));
}

function casaNoTitulo_(titulo, palavras) {
  var alvo = normalizarTexto(titulo.titulo);
  return palavras.every(function (palavra) {
    return alvo.indexOf(palavra) !== -1;
  });
}

function numeroOuNulo_(valor) {
  if (valor === null || valor === undefined || String(valor).trim() === '') return null;
  var numero = Number(valor);
  return isFinite(numero) ? numero : null;
}

if (typeof module !== 'undefined') {
  module.exports = { normalizarTexto: normalizarTexto, montarAutoria: montarAutoria, buscarTitulos: buscarTitulos };
}
