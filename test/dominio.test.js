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

const {
  normalizarTexto, montarAutoria, buscarTitulos, resumirDisponibilidade, separarAutoria, resumirEdicoes,
  SITUACAO_DISPONIVEL, SITUACAO_EMPRESTADO, SITUACAO_BAIXADO
} = require('../src/dominio.js');

// Segue a convenção de catalogação da ESPECIFICACAO.md: nome formal com o
// popular entre parênteses, porque o frequentador pede "um do Chico".
const ACERVO = [
  {
    id_titulo: 1,
    titulo: 'Nosso Lar',
    autor_ou_medium: 'Francisco Cândido Xavier (Chico Xavier)',
    autor_espiritual: 'André Luiz',
    serie: 'A Vida no Mundo Espiritual',
    ordem_na_serie: 1,
    categoria: 'romance'
  },
  {
    id_titulo: 2,
    titulo: 'Os Mensageiros',
    autor_ou_medium: 'Francisco Cândido Xavier (Chico Xavier)',
    autor_espiritual: 'André Luiz',
    serie: 'A Vida no Mundo Espiritual',
    ordem_na_serie: 2,
    categoria: 'romance'
  },
  {
    id_titulo: 3,
    titulo: 'Paulo e Estêvão',
    autor_ou_medium: 'Francisco Cândido Xavier (Chico Xavier)',
    autor_espiritual: 'Emmanuel',
    serie: '',
    ordem_na_serie: '',
    categoria: 'romance'
  },
  {
    id_titulo: 4,
    titulo: 'O Livro dos Espíritos',
    autor_ou_medium: 'Allan Kardec',
    autor_espiritual: '',
    tradutor: 'Guillon Ribeiro',
    serie: '',
    ordem_na_serie: '',
    categoria: 'doutrinário'
  },
  {
    id_titulo: 5,
    titulo: 'Vida e Sexo',
    autor_ou_medium: 'Francisco Cândido Xavier (Chico Xavier)',
    autor_espiritual: 'Emmanuel',
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
  assert.equal(montarAutoria({ autor_ou_medium: 'Divaldo Franco' }), 'Divaldo Franco');
  assert.equal(montarAutoria({}), '');
  assert.equal(montarAutoria(null), '');

  // A especificação manda deixar `autor` vazio em psicografia. Se vier
  // preenchido assim mesmo, a forma psicografada ganha por ser mais específica.
  assert.equal(
    montarAutoria({ autor_ou_medium: 'Chico Xavier', autor_espiritual: 'Emmanuel' }),
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
  const semExemplar = [{ id_titulo: 9, titulo: 'A Gênese', autor_ou_medium: 'Allan Kardec' }];
  assert.deepEqual(idsDe(buscarTitulos(semExemplar, 'genese')), [9]);
});

// --- resumirDisponibilidade --------------------------------------------------

const exemplar = (extra) => Object.assign({
  tombo: 1, id_titulo: 1, ativo: 'SIM',
  situacao: 'disponível', com_quem: '', previsao_devolucao: ''
}, extra);

test('título sem exemplar nenhum: a casa não tem', () => {
  // D5: catalogar obra que a casa não possui é recurso, não bug.
  const resumo = resumirDisponibilidade([]);
  assert.equal(resumo.estado, 'sem_exemplar');
  assert.equal(resumo.total, 0);
  assert.equal(resumo.disponiveis, 0);
  assert.equal(resumo.previsao, null);
});

test('conta disponíveis sobre o total de ativos', () => {
  const resumo = resumirDisponibilidade([
    exemplar({ tombo: 1 }),
    exemplar({ tombo: 2 }),
    exemplar({ tombo: 3, situacao: 'emprestado', previsao_devolucao: new Date(2026, 8, 12) })
  ]);
  assert.equal(resumo.estado, 'disponivel');
  assert.equal(resumo.disponiveis, 2);
  assert.equal(resumo.total, 3);
});

test('exemplar baixado não conta em nada', () => {
  // Para quem procura livro, exemplar perdido e exemplar inexistente são a
  // mesma coisa.
  const resumo = resumirDisponibilidade([
    exemplar({ tombo: 1, ativo: 'NÃO', situacao: 'baixado' }),
    exemplar({ tombo: 2 })
  ]);
  assert.equal(resumo.total, 1);
  assert.equal(resumo.disponiveis, 1);
});

test('todos emprestados: estado emprestado e previsão mais próxima', () => {
  const resumo = resumirDisponibilidade([
    exemplar({ tombo: 1, situacao: 'emprestado', previsao_devolucao: new Date(2026, 8, 30) }),
    exemplar({ tombo: 2, situacao: 'emprestado', previsao_devolucao: new Date(2026, 8, 12) })
  ]);
  assert.equal(resumo.estado, 'emprestado');
  assert.equal(resumo.disponiveis, 0);
  assert.equal(resumo.previsao.getTime(), new Date(2026, 8, 12).getTime(),
    'tem que ser a devolução mais próxima, que é quando dá para pegar');
});

test('previsão em texto ISO, como volta do cache, também é entendida', () => {
  const resumo = resumirDisponibilidade([
    exemplar({ situacao: 'emprestado', previsao_devolucao: '2026-09-12T03:00:00.000Z' })
  ]);
  assert.ok(resumo.previsao instanceof Date);
});

test('resumo não devolve nada sobre quem está com o livro', () => {
  // Seção 6: a busca pública mostra "emprestado — previsão dd/mm", nunca o
  // nome. A privacidade não pode depender de a tela lembrar de esconder.
  const resumo = resumirDisponibilidade([
    exemplar({ situacao: 'emprestado', com_quem: 'Maria da Silva',
               previsao_devolucao: new Date(2026, 8, 12) })
  ]);
  const serializado = JSON.stringify(resumo);
  assert.equal(serializado.indexOf('Maria'), -1, 'vazou nome de frequentador');
  assert.equal(Object.keys(resumo).sort().join(','), 'disponiveis,estado,previsao,total');
});

test('o vocabulário de situacao é o mesmo em dominio.js e setup.js', () => {
  // A ARRAYFORMULA de setup.js produz estas palavras; dominio.js compara
  // contra elas. Divergir quebraria a busca em silêncio: nenhum exemplar
  // apareceria como disponível e nenhum erro seria levantado.
  const fs = require('node:fs');
  const path = require('node:path');
  const setup = fs.readFileSync(path.join(__dirname, '..', 'src', 'setup.js'), 'utf8');

  for (const palavra of [SITUACAO_DISPONIVEL, SITUACAO_EMPRESTADO, SITUACAO_BAIXADO]) {
    assert.ok(setup.includes('"' + palavra + '"'),
      `setup.js não produz mais a situação "${palavra}"`);
  }
});

// --- separarAutoria ----------------------------------------------------------
// A forma exata em que o Google devolve os autores, verificada em 22/08/2026
// pelo diagnóstico rodando na planilha da casa.

test('separa médium de autor espiritual pela marca (Espírito)', () => {
  // Resposta real do Google para intitle:"Nosso Lar".
  assert.deepEqual(
    separarAutoria(['Francisco Cândido Xavier', 'André Luiz (Espírito)']),
    { autor_ou_medium: 'Francisco Cândido Xavier', autor_espiritual: 'André Luiz' }
  );
});

test('a marca decide, não a ordem', () => {
  // O médium costuma vir primeiro, mas não dá para contar com isso.
  assert.deepEqual(
    separarAutoria(['Emmanuel (Espírito)', 'Francisco Cândido Xavier']),
    { autor_ou_medium: 'Francisco Cândido Xavier', autor_espiritual: 'Emmanuel' }
  );
});

test('sem marca nenhuma é obra de autor, não psicografia', () => {
  assert.deepEqual(
    separarAutoria(['Allan Kardec']),
    { autor_ou_medium: 'Allan Kardec', autor_espiritual: '' }
  );
  assert.deepEqual(
    separarAutoria(['George Orwell', 'Heloisa Jahn', 'Alexandre Hubner']),
    { autor_ou_medium: 'George Orwell; Heloisa Jahn; Alexandre Hubner',
      autor_espiritual: '' }
  );
});

test('aceita as variações da marca que aparecem no catálogo', () => {
  assert.equal(separarAutoria(['Emmanuel (Espirito)']).autor_espiritual, 'Emmanuel');
  assert.equal(separarAutoria(['Emmanuel (espírito)']).autor_espiritual, 'Emmanuel');
  assert.equal(separarAutoria(['Emmanuel (Espíritos)']).autor_espiritual, 'Emmanuel');
  assert.equal(separarAutoria(['Emmanuel (Spirit)']).autor_espiritual, 'Emmanuel');
});

test('parêntese que não é marca de espírito fica no nome', () => {
  // A convenção de catalogação da casa põe o apelido entre parênteses.
  assert.deepEqual(
    separarAutoria(['Francisco Cândido Xavier (Chico Xavier)', 'André Luiz (Espírito)']),
    { autor_ou_medium: 'Francisco Cândido Xavier (Chico Xavier)',
      autor_espiritual: 'André Luiz' }
  );
});

test('aceita string com ponto e vírgula, não só lista', () => {
  assert.deepEqual(
    separarAutoria('Francisco Cândido Xavier; André Luiz (Espírito)'),
    { autor_ou_medium: 'Francisco Cândido Xavier', autor_espiritual: 'André Luiz' }
  );
});

test('entrada vazia ou estranha não quebra', () => {
  const vazio = { autor_ou_medium: '', autor_espiritual: '' };
  assert.deepEqual(separarAutoria([]), vazio);
  assert.deepEqual(separarAutoria(null), vazio);
  assert.deepEqual(separarAutoria(undefined), vazio);
  assert.deepEqual(separarAutoria(['', '  ']), vazio);
});

test('psicografia sem médium identificado ainda é psicografia', () => {
  assert.deepEqual(
    separarAutoria(['André Luiz (Espírito)']),
    { autor_ou_medium: '', autor_espiritual: 'André Luiz' }
  );
});

// --- resumirEdicoes ----------------------------------------------------------

test('lista as edições distintas dos exemplares ativos', () => {
  // O mesmo título com dois exemplares de edições diferentes: é o caso que
  // motivou mover editora e ano do título para o exemplar.
  assert.deepEqual(resumirEdicoes([
    exemplar({ tombo: 1, editora: 'FEB Editora', ano: 1978 }),
    exemplar({ tombo: 2, editora: 'Petit', ano: 2015 })
  ]), ['FEB Editora 1978', 'Petit 2015']);
});

test('edição repetida aparece uma vez só', () => {
  // Três cópias da mesma edição são uma linha na tela, não três.
  assert.deepEqual(resumirEdicoes([
    exemplar({ tombo: 1, editora: 'FEB Editora', ano: 2013 }),
    exemplar({ tombo: 2, editora: 'FEB Editora', ano: 2013 }),
    exemplar({ tombo: 3, editora: 'FEB Editora', ano: 2013 })
  ]), ['FEB Editora 2013']);
});

test('exemplar baixado não entra na lista de edições', () => {
  // A edição de um livro perdido não ajuda ninguém a decidir se vem buscar.
  assert.deepEqual(resumirEdicoes([
    exemplar({ tombo: 1, ativo: 'NÃO', editora: 'LAKE', ano: 1972 }),
    exemplar({ tombo: 2, editora: 'FEB Editora', ano: 2013 })
  ]), ['FEB Editora 2013']);
});

test('exemplar sem editora nem ano não vira linha vazia', () => {
  assert.deepEqual(resumirEdicoes([exemplar({ editora: '', ano: '' })]), []);
  assert.deepEqual(resumirEdicoes([]), []);
  assert.deepEqual(resumirEdicoes(null), []);
});

test('editora sem ano, e ano sem editora, ainda informam algo', () => {
  // Edição antiga costuma ter um dos dois ilegível.
  assert.deepEqual(resumirEdicoes([exemplar({ editora: 'FEB Editora', ano: '' })]),
    ['FEB Editora']);
  assert.deepEqual(resumirEdicoes([exemplar({ editora: '', ano: 1978 })]), ['1978']);
});
