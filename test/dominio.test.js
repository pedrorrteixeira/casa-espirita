/**
 * dominio.test.js — Fase 1.
 *
 * Acervo de mentira, obras de verdade. Os casos que importam num acervo
 * espírita não são genéricos: série psicografada, autor espiritual diferente
 * do médium, nome popular diferente do formal, e gente buscando sem acento no
 * celular.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizarTexto, montarAutoria, buscarTitulos } = require('../src/dominio.js');

// Segue a convenção de catalogação da ESPECIFICACAO.md: nome formal com o
// popular entre parênteses, porque o frequentador pede "um do Chico".
const ACERVO = [
  {
    id_titulo: 1,
    titulo: 'Nosso Lar',
    autor: '',
    autor_espiritual: 'André Luiz',
    medium: 'Francisco Cândido Xavier (Chico Xavier)',
    serie: 'A Vida no Mundo Espiritual',
    ordem_na_serie: 1,
    categoria: 'romance'
  },
  {
    id_titulo: 2,
    titulo: 'Os Mensageiros',
    autor: '',
    autor_espiritual: 'André Luiz',
    medium: 'Francisco Cândido Xavier (Chico Xavier)',
    serie: 'A Vida no Mundo Espiritual',
    ordem_na_serie: 2,
    categoria: 'romance'
  },
  {
    id_titulo: 3,
    titulo: 'Paulo e Estêvão',
    autor: '',
    autor_espiritual: 'Emmanuel',
    medium: 'Francisco Cândido Xavier (Chico Xavier)',
    serie: '',
    ordem_na_serie: '',
    categoria: 'romance'
  },
  {
    id_titulo: 4,
    titulo: 'O Livro dos Espíritos',
    autor: 'Allan Kardec',
    autor_espiritual: '',
    medium: '',
    tradutor: 'Guillon Ribeiro',
    serie: '',
    ordem_na_serie: '',
    categoria: 'doutrinário'
  },
  {
    id_titulo: 5,
    titulo: 'Vida e Sexo',
    autor: '',
    autor_espiritual: 'Emmanuel',
    medium: 'Francisco Cândido Xavier (Chico Xavier)',
    serie: '',
    ordem_na_serie: '',
    categoria: 'estudo'
  }
];

const idsDe = (achados) => achados.map((t) => t.id_titulo);

// --- normalizarTexto ---------------------------------------------------------

test('normalizarTexto tira acento, baixa a caixa e colapsa espaço', () => {
  assert.equal(normalizarTexto('André Luiz'), 'andre luiz');
  assert.equal(normalizarTexto('  O   LIVRO   dos Espíritos '), 'o livro dos espiritos');
  assert.equal(normalizarTexto('Paulo e Estêvão'), 'paulo e estevao');
  assert.equal(normalizarTexto('Ação, Coração e João'), 'acao, coracao e joao');
});

test('normalizarTexto aguenta o que vem de célula vazia ou numérica', () => {
  // getValues() devolve '' para célula vazia e Number para célula numérica.
  assert.equal(normalizarTexto(''), '');
  assert.equal(normalizarTexto(null), '');
  assert.equal(normalizarTexto(undefined), '');
  assert.equal(normalizarTexto(1944), '1944');
});

// --- montarAutoria -----------------------------------------------------------

test('montarAutoria distingue obra psicografada de obra de autor', () => {
  assert.equal(montarAutoria(ACERVO[0]),
    'André Luiz (psicografia de Francisco Cândido Xavier (Chico Xavier))');
  assert.equal(montarAutoria(ACERVO[3]), 'Allan Kardec');
});

test('montarAutoria cobre os campos preenchidos pela metade', () => {
  assert.equal(montarAutoria({ autor_espiritual: 'Emmanuel' }), 'Emmanuel');
  assert.equal(montarAutoria({ medium: 'Divaldo Franco' }), 'psicografia de Divaldo Franco');
  assert.equal(montarAutoria({}), '');
  assert.equal(montarAutoria(null), '');

  // A especificação manda deixar `autor` vazio em psicografia. Se vier
  // preenchido assim mesmo, a forma psicografada ganha por ser mais específica.
  assert.equal(
    montarAutoria({ autor: 'Chico Xavier', autor_espiritual: 'Emmanuel', medium: 'Chico Xavier' }),
    'Emmanuel (psicografia de Chico Xavier)'
  );
});

// --- buscarTitulos: os cinco campos ------------------------------------------

test('busca por título', () => {
  assert.deepEqual(idsDe(buscarTitulos(ACERVO, 'nosso lar')), [1]);
});

test('busca por autor', () => {
  assert.deepEqual(idsDe(buscarTitulos(ACERVO, 'kardec')), [4]);
});

test('busca por autor espiritual', () => {
  // D9: autor espiritual e médium são pessoas diferentes, e as duas
  // precisam ser pesquisáveis.
  assert.deepEqual(idsDe(buscarTitulos(ACERVO, 'andre luiz')), [1, 2]);
  assert.deepEqual(idsDe(buscarTitulos(ACERVO, 'emmanuel')), [3, 5]);
});

test('busca por médium acha as psicografias, pelo nome popular', () => {
  // Critério de aceite da Fase 1: buscar "chico" retorna as psicografias.
  assert.deepEqual(idsDe(buscarTitulos(ACERVO, 'chico')), [1, 2, 3, 5]);
  assert.deepEqual(idsDe(buscarTitulos(ACERVO, 'francisco candido')), [1, 2, 3, 5]);
});

test('busca por série', () => {
  assert.deepEqual(idsDe(buscarTitulos(ACERVO, 'vida no mundo espiritual')), [1, 2]);
});

// --- buscarTitulos: acento ---------------------------------------------------

test('busca sem acento acha o que está com acento', () => {
  assert.deepEqual(idsDe(buscarTitulos(ACERVO, 'andre luiz')), [1, 2]);
  assert.deepEqual(idsDe(buscarTitulos(ACERVO, 'paulo e estevao')), [3]);
  assert.deepEqual(idsDe(buscarTitulos(ACERVO, 'espiritos')), [4]);
});

test('busca com acento também acha — o inverso vale', () => {
  assert.deepEqual(idsDe(buscarTitulos(ACERVO, 'André Luiz')), [1, 2]);
  assert.deepEqual(idsDe(buscarTitulos(ACERVO, 'ESPÍRITOS')), [4]);
});

// --- buscarTitulos: casamento e ordem ----------------------------------------

test('todas as palavras precisam casar, não qualquer uma', () => {
  // "luiz" sozinho acharia André Luiz; junto com "allan" não pode achar nada.
  assert.deepEqual(idsDe(buscarTitulos(ACERVO, 'allan luiz')), []);
  assert.deepEqual(idsDe(buscarTitulos(ACERVO, 'emmanuel sexo')), [5]);
});

test('as palavras podem casar em campos diferentes', () => {
  // "chico" está no médium, "mensageiros" no título.
  assert.deepEqual(idsDe(buscarTitulos(ACERVO, 'chico mensageiros')), [2]);
});

test('cada palavra casa como pedaço, não só palavra inteira', () => {
  assert.deepEqual(idsDe(buscarTitulos(ACERVO, 'mensag')), [2]);
});

test('quem casa no próprio título vem antes de quem casa por autor ou série', () => {
  // "vida" está no título de "Vida e Sexo" e na série dos dois André Luiz.
  const achados = idsDe(buscarTitulos(ACERVO, 'vida'));
  assert.equal(achados[0], 5, 'o livro chamado Vida e Sexo tem que vir primeiro');
  assert.deepEqual(achados, [5, 1, 2]);
});

test('dentro da mesma série, vale a ordem de leitura e não a alfabética', () => {
  // "Os Mensageiros" viria antes de "Nosso Lar" no alfabeto. Não é o que o
  // leitor quer: ele quer ler a série na ordem.
  assert.deepEqual(idsDe(buscarTitulos(ACERVO, 'andre luiz')), [1, 2]);
});

test('empate fora de série cai no alfabético, para a ordem não oscilar', () => {
  assert.deepEqual(idsDe(buscarTitulos(ACERVO, 'emmanuel')), [3, 5]);
});

// --- buscarTitulos: bordas ---------------------------------------------------

test('termo vazio devolve nada, não o acervo inteiro', () => {
  // A tela pede para digitar em vez de despejar centenas de linhas.
  assert.deepEqual(buscarTitulos(ACERVO, ''), []);
  assert.deepEqual(buscarTitulos(ACERVO, '    '), []);
  assert.deepEqual(buscarTitulos(ACERVO, null), []);
});

test('acervo vazio ou ausente não quebra a busca', () => {
  assert.deepEqual(buscarTitulos([], 'chico'), []);
  assert.deepEqual(buscarTitulos(null, 'chico'), []);
});

test('termo sem resultado devolve lista vazia', () => {
  assert.deepEqual(buscarTitulos(ACERVO, 'shakespeare'), []);
});

test('busca não altera a lista recebida', () => {
  const copia = ACERVO.slice();
  buscarTitulos(ACERVO, 'andre luiz');
  assert.deepEqual(ACERVO, copia, 'a ordem original foi mexida');
});

test('título com zero exemplares aparece na busca', () => {
  // D5: catalogar obra que a casa não tem é recurso, não bug — alimenta a
  // lista de doação desejada. A busca não filtra por disponibilidade.
  const semExemplar = [{ id_titulo: 9, titulo: 'A Gênese', autor: 'Allan Kardec' }];
  assert.deepEqual(idsDe(buscarTitulos(semExemplar, 'genese')), [9]);
});
