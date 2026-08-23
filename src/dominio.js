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

  var principal = limpar_(titulo.autor_ou_medium);
  var espiritual = limpar_(titulo.autor_espiritual);

  // `autor_espiritual` preenchido é o que define psicografia. É ele que diz
  // qual papel o outro campo está exercendo.
  if (espiritual && principal) return espiritual + ' (psicografia de ' + principal + ')';
  if (espiritual) return espiritual;
  return principal;
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

/**
 * Separa autor, autor espiritual e médium a partir da lista de autores que a
 * API de livros do Google devolve.
 *
 * A catalogação brasileira marca o autor espiritual com "(Espírito)", e o
 * Google preserva a marca:
 *
 *   ["Francisco Cândido Xavier", "André Luiz (Espírito)"]
 *      -> medium: Francisco Cândido Xavier
 *         autor_espiritual: André Luiz
 *
 * A ordem não decide nada — a marca decide. O médium costuma vir primeiro,
 * mas não dá para contar com isso.
 *
 * Sem nenhuma marca, é obra não psicografada e tudo vai para `autor` (D9).
 */
function separarAutoria(autores) {
  var lista = [];
  if (typeof autores === 'string') lista = autores.split(';');
  else if (Array.isArray(autores)) lista = autores;

  var marca = /\s*\((esp[íi]ritos?|spirit)\)\s*$/i;

  var espirituais = [];
  var encarnados = [];

  lista.forEach(function (bruto) {
    var nome = limpar_(bruto);
    if (!nome) return;
    if (marca.test(nome)) espirituais.push(nome.replace(marca, ''));
    else encarnados.push(nome);
  });

  // Um campo só para os dois papéis: quem está encarnado é o autor quando não
  // há espírito na ficha, e o médium quando há.
  return {
    autor_ou_medium: encarnados.join('; '),
    autor_espiritual: espirituais.join('; ')
  };
}

/**
 * Lista as edições distintas presentes entre os exemplares ativos de um
 * título — "FEB Editora 1978", "Petit 2015".
 *
 * Existe porque editora e ano descrevem o objeto físico, não a obra: a casa
 * pode ter o mesmo livro em três edições. Como a busca mostra o título e não
 * o exemplar, ela precisa resumir o que existe na estante.
 *
 * Exemplar baixado não entra: a edição de um livro perdido não ajuda ninguém
 * a decidir se vem buscar.
 */
function resumirEdicoes(exemplares) {
  var vistas = {};
  var lista = [];

  (exemplares || []).forEach(function (exemplar) {
    if (String(exemplar.ativo).trim() !== 'SIM') return;

    var partes = [limpar_(exemplar.editora), limpar_(exemplar.ano)]
      .filter(function (parte) { return parte !== ''; });
    if (!partes.length) return;

    var texto = partes.join(' ');
    if (vistas[texto]) return;
    vistas[texto] = true;
    lista.push(texto);
  });

  return lista;
}

/**
 * Vocabulário da coluna derivada `situacao`.
 *
 * ATENÇÃO: estas mesmas palavras estão escritas dentro da ARRAYFORMULA em
 * `setup.js`. Mudar aqui e não lá (ou o contrário) quebra em silêncio: a busca
 * pararia de achar exemplar disponível e ninguém veria erro nenhum. O teste
 * "o vocabulário de situacao é o mesmo nos dois arquivos" existe para pegar
 * isso — não é duplicação esquecida, é duplicação vigiada.
 */
var SITUACAO_DISPONIVEL = 'disponível';
var SITUACAO_EMPRESTADO = 'emprestado';
var SITUACAO_BAIXADO = 'baixado';

/**
 * Resume a disponibilidade de um título a partir dos seus exemplares.
 *
 * É a função que alimenta a busca pública, então tem uma responsabilidade
 * extra: **não devolve nada sobre quem está com o livro**. Recebe exemplares
 * que podem trazer `com_quem` preenchido e simplesmente não olha para o campo.
 * A privacidade não fica a cargo de a tela lembrar de esconder (seção 6 da
 * especificação).
 *
 * Exemplar baixado não entra em nenhuma contagem: para quem procura livro, um
 * exemplar perdido e um exemplar que nunca existiu são a mesma coisa.
 *
 * `previsao` é a devolução mais próxima entre os emprestados — é a data que
 * responde "quando posso pegar?".
 */
function resumirDisponibilidade(exemplares) {
  var ativos = (exemplares || []).filter(function (exemplar) {
    return String(exemplar.ativo).trim() === 'SIM';
  });

  var disponiveis = ativos.filter(function (exemplar) {
    return normalizarTexto(exemplar.situacao) === normalizarTexto(SITUACAO_DISPONIVEL);
  });

  var previsao = null;
  ativos.forEach(function (exemplar) {
    var data = comoData_(exemplar.previsao_devolucao);
    if (data && (previsao === null || data < previsao)) previsao = data;
  });

  var estado;
  if (ativos.length === 0) estado = 'sem_exemplar';
  else if (disponiveis.length > 0) estado = 'disponivel';
  else estado = 'emprestado';

  return {
    estado: estado,
    total: ativos.length,
    disponiveis: disponiveis.length,
    previsao: previsao
  };
}

// --- Auxiliares --------------------------------------------------------------

/**
 * Converte o que veio da planilha para Date, ou null.
 * Célula de data volta como Date; o JSON do cache volta como string ISO.
 */
function comoData_(valor) {
  if (!valor) return null;
  if (valor instanceof Date) return isFinite(valor.getTime()) ? valor : null;
  var data = new Date(valor);
  return isFinite(data.getTime()) ? data : null;
}

function limpar_(valor) {
  if (valor === null || valor === undefined) return '';
  return String(valor).trim();
}

/** Os cinco campos pesquisáveis, normalizados e juntos num texto só. */
function camposDeBusca_(titulo) {
  return normalizarTexto([
    titulo.titulo,
    titulo.autor_ou_medium,
    titulo.autor_espiritual,
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
  module.exports = {
    normalizarTexto: normalizarTexto,
    montarAutoria: montarAutoria,
    buscarTitulos: buscarTitulos,
    separarAutoria: separarAutoria,
    resumirDisponibilidade: resumirDisponibilidade,
    resumirEdicoes: resumirEdicoes,
    SITUACAO_DISPONIVEL: SITUACAO_DISPONIVEL,
    SITUACAO_EMPRESTADO: SITUACAO_EMPRESTADO,
    SITUACAO_BAIXADO: SITUACAO_BAIXADO
  };
}
