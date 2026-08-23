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
 * Procura um título já cadastrado equivalente ao que se quer criar.
 *
 * Duplicata acontece porque a casa recebe a segunda cópia do mesmo livro meses
 * depois, e quem cataloga não lembra que já entrou. O resultado é o acervo
 * dizendo "1 exemplar" duas vezes em vez de "2 exemplares", e a busca
 * devolvendo a mesma obra repetida.
 *
 * Equivalência compara texto normalizado — "Nosso Lar" e "nosso lar " são o
 * mesmo livro. Mas título igual NÃO basta: obras diferentes compartilham nome.
 * Por isso, quando as duas fichas têm autoria preenchida e ela difere, são
 * obras distintas e ambas podem existir.
 *
 * Quando uma das duas está sem autoria, trata como equivalente: é o caso de
 * ficha incompleta, e avisar de leve é melhor do que deixar duplicar calado.
 */
function acharTituloEquivalente(titulos, candidato) {
  if (!candidato) return null;

  var nome = normalizarTexto(candidato.titulo);
  if (!nome) return null;

  var autoriaNova = autoriaComparavel_(candidato);

  var iguais = (titulos || []).filter(function (existente) {
    if (normalizarTexto(existente.titulo) !== nome) return false;

    var autoriaVelha = autoriaComparavel_(existente);
    if (autoriaNova && autoriaVelha && autoriaNova !== autoriaVelha) return false;

    return true;
  });

  return iguais.length ? iguais[0] : null;
}

/** Autoria reduzida a texto comparável, juntando os dois campos. */
function autoriaComparavel_(titulo) {
  return normalizarTexto(
    limpar_(titulo.autor_ou_medium) + ' ' + limpar_(titulo.autor_espiritual)
  );
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
 * Monta o aviso de atrasos: um e-mail só, com todos.
 *
 * Nunca um e-mail por atraso. A cota de conta Gmail comum é de 100
 * destinatários por dia, e três livros atrasados não podem virar três
 * mensagens — a seção 7 da especificação é explícita.
 *
 * Devolve também uma `chave`: a identidade do conjunto de atrasos. É o que
 * permite ao gatilho não reenviar todo dia a mesma lista, que é como um aviso
 * vira ruído e para de ser lido.
 */
function montarAvisoDeAtrasos(emprestados) {
  var atrasados = (emprestados || []).filter(function (item) {
    return Number(item.dias_de_atraso) > 0;
  });

  if (!atrasados.length) return null;

  // O mais atrasado primeiro: é a ordem em que alguém vai agir.
  var ordenados = atrasados.slice().sort(function (a, b) {
    return Number(b.dias_de_atraso) - Number(a.dias_de_atraso);
  });

  var linhas = ordenados.map(function (item) {
    return '• ' + item.titulo +
      '\n  tombo ' + item.tombo +
      ' · com ' + item.nome +
      ' · venceu em ' + item.data_prevista +
      ' (' + item.dias_de_atraso + ' dia' + (item.dias_de_atraso > 1 ? 's' : '') + ')';
  });

  var quantos = ordenados.length;
  return {
    assunto: 'Biblioteca: ' + quantos + ' livro' + (quantos > 1 ? 's' : '') + ' em atraso',
    corpo: [
      quantos === 1
        ? 'Um livro está em atraso:'
        : quantos + ' livros estão em atraso:',
      '',
      linhas.join('\n\n'),
      '',
      '—',
      'Aviso automático do sistema da biblioteca. Não responda a este e-mail.'
    ].join('\n'),
    // Tombos ordenados: a chave muda quando entra ou sai um livro da lista,
    // e NÃO muda só porque o atraso aumentou de 3 para 4 dias.
    chave: ordenados.map(function (item) { return item.tombo; })
      .sort(function (a, b) { return Number(a) - Number(b); })
      .join(',')
  };
}

/**
 * Escolhe a reunião de quem precisa ser cobrado pelo tema.
 *
 * A mais próxima dentro da janela, com palestrante inscrito, e-mail conhecido
 * e tema ainda vazio. Devolve null quando não há ninguém a cobrar — que é o
 * caso mais comum, e não deve gerar e-mail nenhum.
 */
function escolherReuniaoSemTema(reunioes, hoje, diasDeAntecedencia) {
  var referencia = comoData_(hoje);
  if (!referencia) return null;

  var inicio = soData_(referencia);
  var limite = new Date(
    inicio.getFullYear(), inicio.getMonth(),
    inicio.getDate() + Number(diasDeAntecedencia || 7)
  );

  var candidatas = (reunioes || []).filter(function (reuniao) {
    if (limpar_(reuniao.tema)) return false;
    if (!limpar_(reuniao.email_reservado)) return false;

    var status = limpar_(reuniao.status);
    if (status === STATUS_CANCELADA || status === STATUS_REALIZADA) return false;

    var quando = comoData_(reuniao.data);
    if (!quando) return false;

    var dia = soData_(quando).getTime();
    return dia >= inicio.getTime() && dia <= limite.getTime();
  });

  if (!candidatas.length) return null;

  candidatas.sort(function (a, b) {
    return soData_(comoData_(a.data)).getTime() - soData_(comoData_(b.data)).getTime();
  });
  return candidatas[0];
}

/**
 * Status possíveis de uma reunião.
 * `vaga_aberta` existe para data criada à mão na planilha, sem reserva ainda.
 */
var STATUS_VAGA_ABERTA = 'vaga_aberta';
var STATUS_RESERVADA = 'reservada';
var STATUS_TEMA_CONFIRMADO = 'tema_confirmado';
var STATUS_REALIZADA = 'realizada';
var STATUS_CANCELADA = 'cancelada';

/**
 * Decide o que fazer para a aba `Reunioes` refletir o Google Agenda.
 *
 * Pura de propósito, e é a parte que mais precisa disso: sincronização é o
 * tipo de código que só quebra em produção, meses depois, quando alguém
 * cancela uma reserva. Aqui dá para testar cancelamento, remarcação e troca de
 * palestrante sem tocar em calendário nenhum.
 *
 * Sentido único (regra 12): o Agenda manda, a planilha obedece. Este
 * planejamento nunca cria nem apaga evento — só descreve o que gravar.
 *
 * DUAS COISAS QUE ELE NÃO PODE FAZER, e ambas já seriam bugs difíceis de ver:
 *
 * 1. Nunca mexer em `tema`. O tema é preenchido depois, pela planilha ou pela
 *    tela (regra 13). Sobrescrevê-lo a cada sincronização apagaria em silêncio
 *    o que o palestrante escreveu.
 *
 * 2. Nunca rebaixar o status. Uma reunião já `realizada` não volta a ser
 *    `reservada` porque o evento continua no calendário.
 *
 * `janela` limita o cancelamento ao período que foi realmente consultado —
 * sem isso, toda reunião antiga do histórico seria marcada como cancelada por
 * não estar entre os eventos lidos.
 */
function planejarSincronizacao(eventos, reunioes, pessoas, janela) {
  var porEmail = {};
  (pessoas || []).forEach(function (pessoa) {
    var email = normalizarTexto(pessoa.email);
    if (email) porEmail[email] = pessoa.id_pessoa;
  });

  var existentes = {};
  (reunioes || []).forEach(function (reuniao) {
    var chave = limpar_(reuniao.id_evento_calendar);
    if (chave) existentes[chave] = reuniao;
  });

  var plano = { criar: [], atualizar: [], cancelar: [] };
  var vistos = {};

  (eventos || []).forEach(function (evento) {
    var chave = limpar_(evento.id_evento_calendar);
    if (!chave) return;
    vistos[chave] = true;

    var idPalestrante = porEmail[normalizarTexto(evento.email_reservado)] || '';
    var jaExiste = existentes[chave];

    if (!jaExiste) {
      plano.criar.push({
        data: evento.data,
        horario: evento.horario,
        id_palestrante: idPalestrante,
        nome_reservado: evento.nome_reservado,
        email_reservado: evento.email_reservado,
        tema: '',
        status: STATUS_RESERVADA,
        id_evento_calendar: chave,
        data_inscricao: evento.data_inscricao || ''
      });
      return;
    }

    var mudancas = {};
    if (!mesmaData_(jaExiste.data, evento.data)) mudancas.data = evento.data;
    if (limpar_(jaExiste.horario) !== limpar_(evento.horario)) {
      mudancas.horario = evento.horario;
    }
    if (limpar_(jaExiste.nome_reservado) !== limpar_(evento.nome_reservado)) {
      mudancas.nome_reservado = evento.nome_reservado;
    }
    if (limpar_(jaExiste.email_reservado) !== limpar_(evento.email_reservado)) {
      mudancas.email_reservado = evento.email_reservado;
    }
    // Só preenche o vínculo; nunca apaga um que alguém ligou à mão.
    if (idPalestrante && limpar_(jaExiste.id_palestrante) === '') {
      mudancas.id_palestrante = idPalestrante;
    }
    // Reserva cancelada e refeita volta a valer. Mas `tema_confirmado` e
    // `realizada` não são rebaixados.
    if (limpar_(jaExiste.status) === STATUS_CANCELADA ||
        limpar_(jaExiste.status) === STATUS_VAGA_ABERTA) {
      mudancas.status = STATUS_RESERVADA;
    }

    if (Object.keys(mudancas).length) {
      plano.atualizar.push({ _linha: jaExiste._linha, mudancas: mudancas });
    }
  });

  // Sumiu do Agenda = cancelada, nunca apagada (regra 12 e regra 15).
  (reunioes || []).forEach(function (reuniao) {
    var chave = limpar_(reuniao.id_evento_calendar);
    if (!chave || vistos[chave]) return;
    if (limpar_(reuniao.status) === STATUS_CANCELADA) return;
    if (!dentroDaJanela_(reuniao.data, janela)) return;

    plano.cancelar.push({
      _linha: reuniao._linha,
      id_reuniao: reuniao.id_reuniao,
      mudancas: { status: STATUS_CANCELADA }
    });
  });

  return plano;
}

function mesmaData_(a, b) {
  var da = comoData_(a);
  var db = comoData_(b);
  if (!da && !db) return true;
  if (!da || !db) return false;
  return soData_(da).getTime() === soData_(db).getTime();
}

function dentroDaJanela_(data, janela) {
  if (!janela) return true;
  var quando = comoData_(data);
  if (!quando) return false;

  var dia = soData_(quando).getTime();
  var inicio = comoData_(janela.inicio);
  var fim = comoData_(janela.fim);

  if (inicio && dia < soData_(inicio).getTime()) return false;
  if (fim && dia > soData_(fim).getTime()) return false;
  return true;
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
 * Situação de um exemplar, calculada a partir dos empréstimos.
 *
 * NÃO lê a coluna derivada `situacao`. Aquela fórmula é para quem olha a
 * planilha; para decidir se pode emprestar, ela não serve: dentro de uma
 * gravação a fórmula pode ainda não ter recalculado, e a decisão sairia de um
 * valor velho. A verdade é a aba `Emprestimos` (D7), e é o que isto lê.
 */
function calcularSituacao(exemplar, emprestimos) {
  if (!exemplar) return null;
  if (String(exemplar.ativo).trim() !== 'SIM') return SITUACAO_BAIXADO;

  return acharEmprestimoAberto(emprestimos, exemplar.tombo)
    ? SITUACAO_EMPRESTADO
    : SITUACAO_DISPONIVEL;
}

/**
 * O empréstimo aberto de um tombo, ou null.
 *
 * "Aberto" é `data_devolucao` vazia — essa é a definição, não uma convenção
 * (D8). Um tombo tem no máximo um, e é o que as fórmulas derivadas assumem.
 */
function acharEmprestimoAberto(emprestimos, tombo) {
  var alvo = Number(tombo);
  var abertos = (emprestimos || []).filter(function (emprestimo) {
    return Number(emprestimo.tombo) === alvo && semValor_(emprestimo.data_devolucao);
  });
  return abertos.length ? abertos[0] : null;
}

/**
 * Data prevista de devolução: empréstimo + prazo (regra 3).
 *
 * Soma pelos componentes da data, não por milissegundos, para o horário de
 * verão não empurrar a data um dia para trás.
 */
function calcularDataPrevista(dataEmprestimo, prazoDias) {
  var inicio = comoData_(dataEmprestimo);
  if (!inicio) throw new Error('Data de empréstimo inválida.');

  var prazo = Number(prazoDias);
  if (!isFinite(prazo) || prazo <= 0) {
    throw new Error('O prazo de devolução precisa ser um número de dias.');
  }

  return new Date(
    inicio.getFullYear(),
    inicio.getMonth(),
    inicio.getDate() + Math.round(prazo)
  );
}

/**
 * Empréstimo em atraso: ainda aberto e com a data prevista já passada.
 *
 * `hoje` vem por parâmetro para a função continuar pura e testável — data do
 * sistema dentro de função de domínio torna o teste dependente do calendário.
 *
 * Compara só a data, sem hora: devolver no próprio dia do vencimento, às 19h,
 * não é atraso.
 */
function estaAtrasado(emprestimo, hoje) {
  if (!emprestimo) return false;
  if (!semValor_(emprestimo.data_devolucao)) return false;   // já devolvido

  var prevista = comoData_(emprestimo.data_prevista);
  var referencia = comoData_(hoje);
  if (!prevista || !referencia) return false;

  return soData_(prevista).getTime() < soData_(referencia).getTime();
}

/** Quantos dias de atraso. Zero quando está em dia. */
function diasDeAtraso(emprestimo, hoje) {
  if (!estaAtrasado(emprestimo, hoje)) return 0;

  var prevista = soData_(comoData_(emprestimo.data_prevista));
  var referencia = soData_(comoData_(hoje));
  return Math.round((referencia.getTime() - prevista.getTime()) / 86400000);
}

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

/**
 * Célula sem valor. Nome distinto de propósito:  tem um
 *  equivalente, e no escopo global único do Apps Script duas
 * definições do mesmo nome se sobrescrevem em silêncio.
 */
function semValor_(valor) {
  return valor === '' || valor === null || valor === undefined;
}

/** A mesma data, à meia-noite. Para comparar dia com dia, sem hora. */
function soData_(data) {
  return new Date(data.getFullYear(), data.getMonth(), data.getDate());
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
    acharTituloEquivalente: acharTituloEquivalente,
    calcularSituacao: calcularSituacao,
    acharEmprestimoAberto: acharEmprestimoAberto,
    calcularDataPrevista: calcularDataPrevista,
    estaAtrasado: estaAtrasado,
    diasDeAtraso: diasDeAtraso,
    planejarSincronizacao: planejarSincronizacao,
    montarAvisoDeAtrasos: montarAvisoDeAtrasos,
    escolherReuniaoSemTema: escolherReuniaoSemTema,
    SITUACAO_DISPONIVEL: SITUACAO_DISPONIVEL,
    SITUACAO_EMPRESTADO: SITUACAO_EMPRESTADO,
    SITUACAO_BAIXADO: SITUACAO_BAIXADO
  };
}
