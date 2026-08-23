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
  normalizarTexto, montarAutoria, buscarTitulos, resumirDisponibilidade, separarAutoria, resumirEdicoes, acharTituloEquivalente,
  calcularSituacao, acharEmprestimoAberto, calcularDataPrevista,
  estaAtrasado, diasDeAtraso, planejarSincronizacao,
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

// --- acharTituloEquivalente --------------------------------------------------

test('acha o mesmo título mesmo com caixa e acento diferentes', () => {
  const achado = acharTituloEquivalente(ACERVO, {
    titulo: 'NOSSO LAR',
    autor_ou_medium: 'Francisco Cândido Xavier (Chico Xavier)',
    autor_espiritual: 'André Luiz'
  });
  assert.equal(achado.id_titulo, 1);
});

test('espaço sobrando não engana', () => {
  const achado = acharTituloEquivalente(ACERVO, {
    titulo: '  Nosso   Lar  ',
    autor_ou_medium: 'Francisco Cândido Xavier (Chico Xavier)',
    autor_espiritual: 'André Luiz'
  });
  assert.equal(achado.id_titulo, 1);
});

test('título igual com autoria diferente são obras diferentes', () => {
  // Obras distintas compartilham nome. Bloquear por título só impediria
  // catalogar a segunda.
  const achado = acharTituloEquivalente(ACERVO, {
    titulo: 'Nosso Lar',
    autor_ou_medium: 'Outro Autor Qualquer',
    autor_espiritual: ''
  });
  assert.equal(achado, null);
});

test('ficha sem autoria conta como equivalente, para avisar', () => {
  // Melhor avisar de leve numa ficha incompleta do que duplicar calado.
  const achado = acharTituloEquivalente(ACERVO, { titulo: 'Nosso Lar' });
  assert.equal(achado.id_titulo, 1);
});

test('título diferente não casa', () => {
  assert.equal(acharTituloEquivalente(ACERVO, { titulo: 'A Gênese' }), null);
});

test('acervo vazio e entrada vazia não quebram', () => {
  assert.equal(acharTituloEquivalente([], { titulo: 'Nosso Lar' }), null);
  assert.equal(acharTituloEquivalente(null, { titulo: 'Nosso Lar' }), null);
  assert.equal(acharTituloEquivalente(ACERVO, { titulo: '' }), null);
  assert.equal(acharTituloEquivalente(ACERVO, null), null);
});

// --- empréstimo: situação, prazo e atraso ------------------------------------

const emprestimo = (extra) => Object.assign({
  id_emprestimo: 1, tombo: 1, id_pessoa: 1,
  data_emprestimo: new Date(2026, 7, 1),
  data_prevista: new Date(2026, 7, 22),
  data_devolucao: '', renovacoes: 0
}, extra);

test('exemplar ativo e sem empréstimo aberto está disponível', () => {
  assert.equal(calcularSituacao(exemplar({ tombo: 1 }), []), SITUACAO_DISPONIVEL);
});

test('exemplar com empréstimo aberto está emprestado — regra 1', () => {
  assert.equal(
    calcularSituacao(exemplar({ tombo: 1 }), [emprestimo({ tombo: 1 })]),
    SITUACAO_EMPRESTADO
  );
});

test('empréstimo já devolvido não prende o exemplar', () => {
  assert.equal(
    calcularSituacao(exemplar({ tombo: 1 }), [
      emprestimo({ tombo: 1, data_devolucao: new Date(2026, 7, 10) })
    ]),
    SITUACAO_DISPONIVEL
  );
});

test('empréstimo de outro tombo não interfere', () => {
  assert.equal(
    calcularSituacao(exemplar({ tombo: 1 }), [emprestimo({ tombo: 99 })]),
    SITUACAO_DISPONIVEL
  );
});

test('exemplar baixado está baixado, tenha empréstimo ou não — regra 10', () => {
  assert.equal(
    calcularSituacao(exemplar({ tombo: 1, ativo: 'NÃO' }), []),
    SITUACAO_BAIXADO
  );
});

test('calcularSituacao lê os empréstimos, não a coluna de fórmula', () => {
  // A fórmula da planilha pode estar desatualizada no meio de uma gravação.
  // Se ela mandasse, a decisão de emprestar sairia de um valor velho.
  const mentindo = exemplar({ tombo: 1, situacao: 'disponível' });
  assert.equal(
    calcularSituacao(mentindo, [emprestimo({ tombo: 1 })]),
    SITUACAO_EMPRESTADO
  );
});

test('data prevista é o empréstimo mais o prazo — regra 3', () => {
  const prevista = calcularDataPrevista(new Date(2026, 7, 1), 21);
  assert.equal(prevista.getFullYear(), 2026);
  assert.equal(prevista.getMonth(), 7);
  assert.equal(prevista.getDate(), 22);
});

test('data prevista atravessa o mês e o ano corretamente', () => {
  const virandoMes = calcularDataPrevista(new Date(2026, 7, 25), 21);
  assert.equal(virandoMes.getMonth(), 8);
  assert.equal(virandoMes.getDate(), 15);

  const virandoAno = calcularDataPrevista(new Date(2026, 11, 20), 21);
  assert.equal(virandoAno.getFullYear(), 2027);
  assert.equal(virandoAno.getMonth(), 0);
  assert.equal(virandoAno.getDate(), 10);
});

test('prazo inválido estoura em vez de gerar data errada', () => {
  assert.throws(() => calcularDataPrevista(new Date(2026, 7, 1), 0), /prazo/);
  assert.throws(() => calcularDataPrevista(new Date(2026, 7, 1), 'muitos'), /prazo/);
  assert.throws(() => calcularDataPrevista('', 21), /Data de empréstimo/);
});

test('devolver no próprio dia do vencimento não é atraso', () => {
  const noPrazo = emprestimo({ data_prevista: new Date(2026, 7, 22) });
  assert.equal(estaAtrasado(noPrazo, new Date(2026, 7, 22)), false);
});

test('um dia depois do vencimento é atraso', () => {
  const vencido = emprestimo({ data_prevista: new Date(2026, 7, 22) });
  assert.equal(estaAtrasado(vencido, new Date(2026, 7, 23)), true);
  assert.equal(diasDeAtraso(vencido, new Date(2026, 7, 30)), 8);
});

test('empréstimo devolvido nunca está atrasado, mesmo que fora do prazo', () => {
  // O histórico registra o atraso, mas a lista de cobrança não pode chamar de
  // volta um livro que já voltou.
  const devolvidoTarde = emprestimo({
    data_prevista: new Date(2026, 7, 22),
    data_devolucao: new Date(2026, 8, 5)
  });
  assert.equal(estaAtrasado(devolvidoTarde, new Date(2026, 8, 30)), false);
  assert.equal(diasDeAtraso(devolvidoTarde, new Date(2026, 8, 30)), 0);
});

test('hora do dia não decide atraso', () => {
  // Devolver às 19h30 do dia do vencimento é em dia.
  const noPrazo = emprestimo({ data_prevista: new Date(2026, 7, 22, 8, 0) });
  assert.equal(estaAtrasado(noPrazo, new Date(2026, 7, 22, 19, 30)), false);
});

test('acharEmprestimoAberto devolve o aberto e ignora os fechados', () => {
  const historico = [
    emprestimo({ id_emprestimo: 1, tombo: 5, data_devolucao: new Date(2026, 5, 1) }),
    emprestimo({ id_emprestimo: 2, tombo: 5, data_devolucao: '' })
  ];
  assert.equal(acharEmprestimoAberto(historico, 5).id_emprestimo, 2);
  assert.equal(acharEmprestimoAberto(historico, 6), null);
  assert.equal(acharEmprestimoAberto([], 5), null);
  assert.equal(acharEmprestimoAberto(null, 5), null);
});

// --- planejarSincronizacao ---------------------------------------------------
// Sincronização é o tipo de código que só quebra meses depois, quando alguém
// cancela uma reserva. Estes testes existem para isso não acontecer em
// produção — não há como testar contra um calendário de verdade.

const JANELA = { inicio: new Date(2026, 0, 1), fim: new Date(2026, 11, 31) };

const evento = (extra) => Object.assign({
  id_evento_calendar: 'evt1',
  data: new Date(2026, 8, 7),
  horario: '19:30',
  nome_reservado: 'Maria da Silva',
  email_reservado: 'maria@exemplo.com',
  data_inscricao: new Date(2026, 7, 20)
}, extra);

const reuniao = (extra) => Object.assign({
  _linha: 2,
  id_reuniao: 1,
  data: new Date(2026, 8, 7),
  horario: '19:30',
  id_palestrante: '',
  nome_reservado: 'Maria da Silva',
  email_reservado: 'maria@exemplo.com',
  tema: '',
  status: 'reservada',
  id_evento_calendar: 'evt1'
}, extra);

const PESSOAS = [
  { id_pessoa: 7, nome: 'Maria da Silva', email: 'maria@exemplo.com' },
  { id_pessoa: 8, nome: 'João Souza', email: 'JOAO@EXEMPLO.COM' }
];

test('reserva nova vira linha nova, já vinculada à pessoa', () => {
  const plano = planejarSincronizacao([evento()], [], PESSOAS, JANELA);

  assert.equal(plano.criar.length, 1);
  assert.equal(plano.atualizar.length, 0);
  assert.equal(plano.cancelar.length, 0);

  assert.equal(plano.criar[0].id_evento_calendar, 'evt1');
  assert.equal(plano.criar[0].nome_reservado, 'Maria da Silva');
  assert.equal(plano.criar[0].id_palestrante, 7, 'devia resolver pelo e-mail');
  assert.equal(plano.criar[0].status, 'reservada');
});

test('e-mail casa sem depender de maiúsculas', () => {
  const plano = planejarSincronizacao(
    [evento({ email_reservado: 'joao@exemplo.com' })], [], PESSOAS, JANELA);
  assert.equal(plano.criar[0].id_palestrante, 8);
});

test('e-mail que não está em Pessoas deixa o vínculo vazio, não quebra', () => {
  // O público é fechado, mas alguém pode reservar com um e-mail diferente do
  // cadastrado. A reserva vale mesmo assim.
  const plano = planejarSincronizacao(
    [evento({ email_reservado: 'desconhecido@exemplo.com' })], [], PESSOAS, JANELA);
  assert.equal(plano.criar[0].id_palestrante, '');
  assert.equal(plano.criar[0].nome_reservado, 'Maria da Silva');
});

test('reserva que não mudou nada não gera escrita', () => {
  // Sincronização diária: reescrever tudo todo dia gasta quota à toa.
  const plano = planejarSincronizacao([evento()], [reuniao({ id_palestrante: 7 })],
    PESSOAS, JANELA);
  assert.deepEqual(plano, { criar: [], atualizar: [], cancelar: [] });
});

test('reserva remarcada para outra data atualiza a linha', () => {
  const plano = planejarSincronizacao(
    [evento({ data: new Date(2026, 8, 14) })],
    [reuniao({ id_palestrante: 7 })], PESSOAS, JANELA);

  assert.equal(plano.atualizar.length, 1);
  assert.equal(plano.atualizar[0]._linha, 2);
  assert.equal(plano.atualizar[0].mudancas.data.getDate(), 14);
});

test('troca de palestrante na mesma data atualiza nome e e-mail', () => {
  const plano = planejarSincronizacao(
    [evento({ nome_reservado: 'João Souza', email_reservado: 'joao@exemplo.com' })],
    [reuniao({ id_palestrante: 7 })], PESSOAS, JANELA);

  assert.equal(plano.atualizar[0].mudancas.nome_reservado, 'João Souza');
  assert.equal(plano.atualizar[0].mudancas.email_reservado, 'joao@exemplo.com');
});

test('sincronização NUNCA mexe no tema — regra 13', () => {
  // O tema é escrito pelo palestrante depois. Sobrescrever a cada sincronização
  // apagaria em silêncio o que ele escreveu.
  const comTema = reuniao({
    id_palestrante: 7,
    tema: 'A prece segundo o Evangelho',
    status: 'tema_confirmado'
  });
  const plano = planejarSincronizacao(
    [evento({ data: new Date(2026, 8, 14) })], [comTema], PESSOAS, JANELA);

  const mudancas = plano.atualizar[0].mudancas;
  assert.equal('tema' in mudancas, false, 'não pode tocar no tema');
});

test('status já avançado não é rebaixado', () => {
  for (const status of ['tema_confirmado', 'realizada']) {
    const plano = planejarSincronizacao(
      [evento()], [reuniao({ id_palestrante: 7, status: status })], PESSOAS, JANELA);
    assert.deepEqual(plano.atualizar, [],
      `status ${status} não podia virar reservada de novo`);
  }
});

test('reserva cancelada e refeita volta a valer', () => {
  const plano = planejarSincronizacao(
    [evento()], [reuniao({ id_palestrante: 7, status: 'cancelada' })],
    PESSOAS, JANELA);
  assert.equal(plano.atualizar[0].mudancas.status, 'reservada');
});

test('evento que sumiu do Agenda vira cancelada, não some da planilha', () => {
  // Regra 12 e regra 15: o código nunca apaga linha.
  const plano = planejarSincronizacao([], [reuniao({ id_palestrante: 7 })],
    PESSOAS, JANELA);

  assert.equal(plano.cancelar.length, 1);
  assert.equal(plano.cancelar[0]._linha, 2);
  assert.equal(plano.cancelar[0].mudancas.status, 'cancelada');
});

test('reunião fora da janela consultada não é cancelada', () => {
  // Sem isso, sincronizar os próximos 365 dias marcaria como cancelada toda
  // reunião do histórico, só por não estar entre os eventos lidos.
  const antiga = reuniao({ data: new Date(2025, 5, 10), status: 'realizada' });
  const plano = planejarSincronizacao([], [antiga], PESSOAS, JANELA);
  assert.deepEqual(plano.cancelar, []);
});

test('já cancelada não é cancelada de novo', () => {
  const plano = planejarSincronizacao([],
    [reuniao({ status: 'cancelada' })], PESSOAS, JANELA);
  assert.deepEqual(plano.cancelar, []);
});

test('vínculo feito à mão não é apagado pela sincronização', () => {
  // Alguém pode ligar o palestrante à ficha na planilha quando o e-mail da
  // reserva não bate com o cadastrado. A sincronização não pode desfazer.
  const plano = planejarSincronizacao(
    [evento({ email_reservado: 'outro@exemplo.com' })],
    [reuniao({ id_palestrante: 7, email_reservado: 'outro@exemplo.com' })],
    PESSOAS, JANELA);
  assert.deepEqual(plano.atualizar, []);
});

test('linha da planilha sem id de evento é ignorada pela sincronização', () => {
  // Data aberta à mão, ainda sem reserva: não é do Agenda, não se mexe.
  const manual = reuniao({ id_evento_calendar: '', status: 'vaga_aberta' });
  const plano = planejarSincronizacao([], [manual], PESSOAS, JANELA);
  assert.deepEqual(plano, { criar: [], atualizar: [], cancelar: [] });
});

test('entradas vazias não quebram', () => {
  assert.deepEqual(planejarSincronizacao([], [], [], JANELA),
    { criar: [], atualizar: [], cancelar: [] });
  assert.deepEqual(planejarSincronizacao(null, null, null, null),
    { criar: [], atualizar: [], cancelar: [] });
});
