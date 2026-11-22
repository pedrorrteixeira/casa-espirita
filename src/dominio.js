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
 * Obras já cadastradas com título igual ou parecido com o que se vai
 * cadastrar. É AVISO, não trava: a tela mostra e a bibliotecária decide.
 *
 * Duplicata acontece porque a casa recebe a segunda cópia do mesmo livro meses
 * depois, e quem cataloga não lembra que já entrou. O resultado é o acervo
 * dizendo "1 exemplar" duas vezes em vez de "2 exemplares", e a busca
 * devolvendo a mesma obra repetida.
 *
 * O que identifica a obra é TÍTULO + SUBTÍTULO, e só isso — regra do Weldson.
 * O "Estudo Sistematizado da Doutrina Espírita" existe como programa
 * fundamental e como programa complementar: mesmo título, mesma organizadora,
 * livros diferentes. O subtítulo é o que os separa.
 *
 * A autoria não entra, nem para separar nem para juntar. Comparar autoria
 * deixava passar o mesmo livro grafado de dois jeitos — o pré-cadastro grava
 * "Francisco Cândido Xavier (Chico Xavier)", o Google devolve "Francisco
 * Cândido Xavier" — e "Nosso Lar" entrava duas vezes sem aviso nenhum.
 *
 * Três graus, nesta ordem:
 *
 *  1. `mesmo_titulo` — título e subtítulo iguais. É o caso que a tela confirma
 *     antes de gravar.
 *  2. `comeca_igual` — um é o começo do outro, palavra inteira. Pega o
 *     subtítulo que o Google cola no título ("Nosso Lar: a vida no mundo
 *     espiritual") e mostra os volumes de uma obra a quem digitou só o título.
 *     Só vale se o mais curto tiver duas palavras ou mais; com uma só,
 *     "Renúncia" puxaria toda obra que começa por ela.
 *  3. `quase_igual` — uma ou duas letras de diferença, o erro de digitação.
 *     "Paulo e Estevao" sem o acento já cai no 1; isto pega "Noso Lar". Mas
 *     não quando o que muda é um número: "Tomo I" e "Tomo II" diferem numa
 *     letra e são livros diferentes.
 *
 * Pontuação não conta ("Nosso Lar" = "Nosso Lar."), nem acento, nem caixa —
 * nem onde termina o título e começa o subtítulo.
 * `ignorarId` tira da conta a própria obra, para a tela de alterar.
 */
function acharTitulosParecidos(titulos, candidato, ignorarId, limite) {
  var chave = chaveDeObra_(candidato);
  if (chave.length < 3) return [];

  var achados = [];
  (titulos || []).forEach(function (existente) {
    if (ignorarId !== undefined && ignorarId !== null &&
        Number(existente.id_titulo) === Number(ignorarId)) return;

    var outra = chaveDeObra_(existente);
    if (!outra) return;

    var motivo = grauDeParecenca_(chave, outra);
    if (motivo) achados.push({ titulo: existente, motivo: motivo });
  });

  var peso = { mesmo_titulo: 0, comeca_igual: 1, quase_igual: 2 };
  achados.sort(function (a, b) {
    return peso[a.motivo] - peso[b.motivo] ||
      normalizarTexto(nomeDaObra(a.titulo)).localeCompare(normalizarTexto(nomeDaObra(b.titulo)));
  });

  return achados.slice(0, limite || 5);
}

/** Título e subtítulo reduzidos ao que importa para comparar: sem acento,
 *  caixa nem pontuação. */
function chaveDeObra_(obra) {
  if (!obra) return '';
  return normalizarTexto(limpar_(obra.titulo) + ' ' + limpar_(obra.subtitulo))
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function grauDeParecenca_(a, b) {
  if (a === b) return 'mesmo_titulo';

  var curta = a.length <= b.length ? a : b;
  var longa = curta === a ? b : a;
  if (curta.indexOf(' ') !== -1 && longa.indexOf(curta + ' ') === 0) return 'comeca_igual';

  // Título curto não tem folga para erro: "Lar" e "Luz" diferem numa letra e
  // não são o mesmo livro.
  if (curta.length < 6) return null;
  if (soMudaONumero_(a, b)) return null;
  var folga = curta.length < 15 ? 1 : 2;
  if (longa.length - curta.length > folga) return null;
  return distanciaDeEdicao_(a, b, folga) <= folga ? 'quase_igual' : null;
}

/**
 * Os dois diferem só em número — "Tomo I" e "Tomo II", "Revista Espírita
 * 1858" e "1859"? Então são volumes, não erro de digitação.
 */
function soMudaONumero_(a, b) {
  var partesA = a.split(' ');
  var partesB = b.split(' ');
  if (partesA.length !== partesB.length) return false;

  var numeral = /^(?:\d+|m{0,3}(?:cm|cd|d?c{0,3})(?:xc|xl|l?x{0,3})(?:ix|iv|v?i{0,3}))$/;
  var mudou = false;
  for (var i = 0; i < partesA.length; i++) {
    if (partesA[i] === partesB[i]) continue;
    if (!numeral.test(partesA[i]) || !numeral.test(partesB[i])) return false;
    mudou = true;
  }
  return mudou;
}

/**
 * Quantas letras trocar, pôr ou tirar para ir de um texto ao outro
 * (Levenshtein). Para de contar quando passa do `teto` — só interessa saber se
 * é perto, e o catálogo tem centenas de títulos para comparar a cada consulta.
 */
function distanciaDeEdicao_(a, b, teto) {
  var anterior = [];
  for (var j = 0; j <= b.length; j++) anterior.push(j);

  for (var i = 1; i <= a.length; i++) {
    var atual = [i];
    var menorDaLinha = i;
    for (var k = 1; k <= b.length; k++) {
      var custo = a.charAt(i - 1) === b.charAt(k - 1) ? 0 : 1;
      var valor = Math.min(anterior[k] + 1, atual[k - 1] + 1, anterior[k - 1] + custo);
      atual.push(valor);
      if (valor < menorDaLinha) menorDaLinha = valor;
    }
    if (menorDaLinha > teto) return teto + 1;
    anterior = atual;
  }
  return anterior[b.length];
}

/**
 * O nome da obra como quem está com o livro na mão o reconhece: título e
 * subtítulo juntos.
 *
 * Só o título não basta para distinguir volumes. O "Estudo Sistematizado da
 * Doutrina Espírita" tem tomo I e tomo II, e o que separa um do outro está no
 * subtítulo — escondê-lo põe o exemplar no tomo errado, com o tombo errado na
 * etiqueta.
 */
function nomeDaObra(titulo) {
  if (!titulo) return '';
  var nome = limpar_(titulo.titulo);
  var subtitulo = limpar_(titulo.subtitulo);
  return subtitulo ? nome + ' — ' + subtitulo : nome;
}

/**
 * Lê na busca um número de obra ou de tombo.
 *
 * Só número ("142") procura nos dois: quem digita sabe o que o número é, mas
 * a busca não, e mostrar os dois — cada um com o seu rótulo — custa uma linha.
 * Com o prefixo, procura só um: "tombo 142", "t142", "obra 142", "nº 142",
 * "#142".
 *
 * Devolve null quando o termo não é um número — e aí é busca de texto comum.
 */
function lerNumeroDaBusca(termo) {
  var texto = normalizarTexto(termo);
  if (!texto) return null;

  var achado = /^(\d+)$/.exec(texto);
  if (achado) return { numero: Number(achado[1]), obra: true, tombo: true };

  achado = /^(?:tombo|t)\s*[.:#-]?\s*(\d+)$/.exec(texto);
  if (achado) return { numero: Number(achado[1]), obra: false, tombo: true };

  achado = /^(?:obra|id|#|n[º°o.])\s*(?:n[º°o.]\s*)?[.:#-]?\s*(\d+)$/.exec(texto);
  if (achado) return { numero: Number(achado[1]), obra: true, tombo: false };

  return null;
}

/**
 * Acha a obra pelo número dela e o exemplar pelo tombo.
 *
 * Devolve uma lista de `{ tipo, numero, titulo, exemplar }`, com o tombo
 * antes: é o número que está na etiqueta, e o mais provável de alguém
 * digitar. Quando o tombo e a obra de mesmo número dão no mesmo livro, ele
 * aparece uma vez só.
 *
 * Exemplar cuja obra não existe não aparece — não há o que mostrar dele.
 */
function buscarPorNumero(titulos, exemplares, termo) {
  var pedido = lerNumeroDaBusca(termo);
  if (!pedido) return [];

  var porId = {};
  (titulos || []).forEach(function (titulo) {
    porId[Number(titulo.id_titulo)] = titulo;
  });

  var achados = [];
  var vistas = {};

  if (pedido.tombo) {
    (exemplares || []).forEach(function (exemplar) {
      if (Number(exemplar.tombo) !== pedido.numero) return;
      var titulo = porId[Number(exemplar.id_titulo)];
      if (!titulo) return;
      vistas[Number(titulo.id_titulo)] = true;
      achados.push({ tipo: 'tombo', numero: pedido.numero, titulo: titulo, exemplar: exemplar });
    });
  }

  if (pedido.obra && porId[pedido.numero] && !vistas[pedido.numero]) {
    achados.push({ tipo: 'obra', numero: pedido.numero, titulo: porId[pedido.numero] });
  }

  return achados;
}

/**
 * Um exemplar, do jeito que a busca pública pode mostrar: tombo, edição,
 * situação e previsão de volta.
 *
 * Lista branca, como `resumirDisponibilidade`: o exemplar chega com
 * `com_quem` preenchido, e isto simplesmente não olha para o campo. Quem
 * digitar o tombo de um livro emprestado descobre quando ele volta, nunca com
 * quem está (seção 6 da especificação).
 */
function resumirExemplarParaBusca(exemplar) {
  var ativo = String(exemplar && exemplar.ativo).trim() === 'SIM';
  var situacao = ativo ? limpar_(exemplar.situacao) : SITUACAO_BAIXADO;
  var emprestado = normalizarTexto(situacao) === normalizarTexto(SITUACAO_EMPRESTADO);

  return {
    tombo: Number(exemplar && exemplar.tombo),
    edicao: descreverEdicao(exemplar),
    situacao: situacao,
    previsao: emprestado ? comoData_(exemplar.previsao_devolucao) : null
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
 * Perfis de acesso, do menor para o maior (seção 6).
 *
 * A ordem É a hierarquia: quem tem um perfil pode tudo o que os anteriores
 * podem. Listar assim, e não escrever a permissão de cada tela em cada perfil,
 * evita a tabela que ninguém mantém e que acaba com um buraco no meio.
 */
var PERFIS = ['consulta', 'atendente', 'bibliotecario', 'admin'];

/**
 * O que cada ação exige, no mínimo.
 *
 * A separação atendente/bibliotecario não é desconfiança: é a seção 1 da
 * especificação. Quem cataloga responde pelo acervo, e catalogação errada é
 * difícil de desfazer; quem está de plantão só precisa entregar e receber
 * livro.
 */
var EXIGENCIA = {
  emprestar: 'atendente',
  devolver: 'atendente',
  renovar: 'atendente',
  ver_atrasos: 'atendente',
  ver_com_quem: 'atendente',

  cadastrar_obra: 'bibliotecario',
  editar_obra: 'bibliotecario',
  dar_baixa: 'bibliotecario',
  cadastrar_pessoa: 'bibliotecario',
  editar_pessoa: 'bibliotecario',

  definir_tema: 'atendente',
  sincronizar: 'admin',
  ver_log: 'admin',
  mudar_perfil: 'admin'
};

/**
 * Diz se um perfil alcança uma ação.
 *
 * Ação desconhecida devolve `false`, nunca `true`. Um erro de digitação no
 * nome da ação tem que fechar a porta, não abrir — é a diferença entre uma
 * tela quebrada e um vazamento.
 */
function podeFazer(perfil, acao) {
  var exigido = EXIGENCIA[acao];
  if (!exigido) return false;

  var tem = PERFIS.indexOf(limpar_(perfil));
  var precisa = PERFIS.indexOf(exigido);
  if (tem === -1 || precisa === -1) return false;

  return tem >= precisa;
}

/**
 * O texto parece um e-mail?
 *
 * Deliberadamente permissiva. Validar e-mail com rigor é impossível — a regra
 * de verdade tem centenas de linhas e ainda assim recusa endereços válidos.
 * O que se quer aqui é pegar o erro humano: falta de arroba, espaço no meio,
 * domínio sem ponto. Endereço estranho mas legítimo passa, e passar é o certo:
 * o custo de recusar o e-mail de um frequentador é ele ficar sem aviso de
 * atraso.
 */
function ehEmailValido(texto) {
  var alvo = limpar_(texto);
  if (!alvo) return false;
  if (/\s/.test(alvo)) return false;

  var partes = alvo.split('@');
  if (partes.length !== 2) return false;
  if (!partes[0]) return false;

  var dominio = partes[1];
  if (dominio.indexOf('.') === -1) return false;
  if (/^[.-]|[.-]$/.test(dominio)) return false;
  if (dominio.indexOf('..') !== -1) return false;

  // Depois do último ponto tem que haver letra: "casa@exemplo.c" não existe.
  return /\.[A-Za-z]{2,}$/.test(dominio);
}

/**
 * Escreve o telefone no formato que se lê no Brasil.
 *
 * A máscara é só APRESENTAÇÃO: quem compara é , que joga
 * fora tudo que não é dígito. Por isso a máscara pode mudar sem quebrar nada
 * do que já está gravado — e por isso ela pode ser generosa com número torto,
 * devolvendo o que veio em vez de recusar.
 */
function formatarTelefone(texto) {
  var d = limpar_(texto).replace(/\D/g, '');

  // Tira o 55 do país só quando o que sobra ainda é um número brasileiro.
  if (d.length > 11 && d.indexOf('55') === 0) d = d.slice(2);
  d = d.slice(0, 11);

  if (d.length <= 2) return d;
  if (d.length <= 6) return '(' + d.slice(0, 2) + ') ' + d.slice(2);

  // 11 dígitos é celular (9 na frente); 10 é fixo.
  var corte = d.length > 10 ? 7 : 6;
  return '(' + d.slice(0, 2) + ') ' + d.slice(2, corte) + '-' + d.slice(corte);
}

/**
 * Reduz e-mail ou telefone à forma comparável.
 *
 * Telefone é digitado de sete jeitos — com DDD, sem, com parênteses, com
 * traço, com o 9 na frente. Guarda só os dígitos, e compara pelos últimos
 * oito: é o que sobrevive a ter ou não DDD e o nono dígito.
 */
function normalizarContato(texto) {
  var bruto = limpar_(texto);
  if (!bruto) return '';

  if (bruto.indexOf('@') !== -1) return normalizarTexto(bruto);

  var digitos = bruto.replace(/\D/g, '');
  if (digitos.length < 8) return '';
  return digitos.slice(-8);
}

/** Os dois contatos são a mesma pessoa? */
function mesmoContato(a, b) {
  var na = normalizarContato(a);
  var nb = normalizarContato(b);
  return na !== '' && na === nb;
}

/**
 * Quem está pegando o livro na estante, pelo e-mail ou telefone digitado.
 *
 * Contato e não nome, por decisão do Weldson: a tela da estante é pública, e
 * uma busca por nome ali viraria a lista de quem frequenta a casa. É a mesma
 * regra de "Meus livros".
 *
 * Devolve a pessoa só quando há EXATAMENTE uma. Zero é contato errado; duas é
 * a família que divide o telefone — e escolher uma delas às cegas poria o
 * livro no nome de quem não pegou. Pessoa inativa não conta (regra 5).
 */
function acharQuemPega(pessoas, contato) {
  if (!normalizarContato(contato)) return null;

  var achadas = (pessoas || []).filter(function (pessoa) {
    return String(pessoa.ativo).trim() === 'SIM' &&
      (mesmoContato(contato, pessoa.email) || mesmoContato(contato, pessoa.telefone));
  });
  return achadas.length === 1 ? achadas[0] : null;
}

/** Quantos livros a pessoa tem em mãos agora. Aberto = sem `data_devolucao`. */
function contarEmprestimosAbertos(emprestimos, idPessoa) {
  var alvo = Number(idPessoa);
  return (emprestimos || []).filter(function (emprestimo) {
    return Number(emprestimo.id_pessoa) === alvo && semValor_(emprestimo.data_devolucao);
  }).length;
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
// Livro raro ou frágil: pode ser lido na casa, mas não sai por empréstimo.
// Não é "consulta" porque esse já é o nome de um perfil.
var SITUACAO_SO_NA_CASA = 'só para ler na casa';

/**
 * Situação de um exemplar, calculada a partir dos empréstimos.
 *
 * NÃO lê a coluna derivada `situacao`. Aquela fórmula é para quem olha a
 * planilha; para decidir se pode emprestar, ela não serve: dentro de uma
 * gravação a fórmula pode ainda não ter recalculado, e a decisão sairia de um
 * valor velho. A verdade é a aba `Emprestimos` (D7), e é o que isto lê.
 *
 * "Emprestado" vem antes de "só para ler na casa": um livro marcado enquanto
 * está fora continua emprestado até voltar, e a ficha do balcão tem que
 * continuar oferecendo a devolução.
 */
function calcularSituacao(exemplar, emprestimos) {
  if (!exemplar) return null;
  if (String(exemplar.ativo).trim() !== 'SIM') return SITUACAO_BAIXADO;

  if (acharEmprestimoAberto(emprestimos, exemplar.tombo)) return SITUACAO_EMPRESTADO;
  return soParaLerNaCasa(exemplar) ? SITUACAO_SO_NA_CASA : SITUACAO_DISPONIVEL;
}

/**
 * O exemplar está marcado como só para ler na casa?
 *
 * Só `NÃO` em `emprestavel` restringe. Vazio é linha cadastrada antes de a
 * coluna existir, e esses livros sempre puderam sair — tratar vazio como
 * restrição trancaria o acervo inteiro no dia da mudança. Maiúscula não
 * importa, como no `=` da planilha, que a fórmula de `situacao` usa.
 */
function soParaLerNaCasa(exemplar) {
  return !!exemplar && String(exemplar.emprestavel).trim().toUpperCase() === 'NÃO';
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
 *
 * `so_na_casa` conta os exemplares que não saem. Eles entram em `total`,
 * porque estão na estante, mas nunca em `disponiveis`. O estado do título só
 * vira `so_na_casa` quando nenhum exemplar pode sair: se um sai, a resposta
 * para "posso levar?" é a dele.
 */
function resumirDisponibilidade(exemplares) {
  var ativos = (exemplares || []).filter(function (exemplar) {
    return String(exemplar.ativo).trim() === 'SIM';
  });

  var comSituacao = function (situacao) {
    return ativos.filter(function (exemplar) {
      return normalizarTexto(exemplar.situacao) === normalizarTexto(situacao);
    });
  };
  var disponiveis = comSituacao(SITUACAO_DISPONIVEL);
  var soNaCasa = comSituacao(SITUACAO_SO_NA_CASA);

  var previsao = null;
  ativos.forEach(function (exemplar) {
    var data = comoData_(exemplar.previsao_devolucao);
    if (data && (previsao === null || data < previsao)) previsao = data;
  });

  var estado;
  if (ativos.length === 0) estado = 'sem_exemplar';
  else if (disponiveis.length > 0) estado = 'disponivel';
  else if (soNaCasa.length === ativos.length) estado = 'so_na_casa';
  else estado = 'emprestado';

  return {
    estado: estado,
    total: ativos.length,
    disponiveis: disponiveis.length,
    so_na_casa: soNaCasa.length,
    previsao: previsao
  };
}

/**
 * O acervo físico, obra por obra, com os exemplares de cada uma embaixo.
 *
 * Só entra obra com exemplar ativo. É a relação do que está na casa, não do
 * catálogo: as centenas de obras pré-cadastradas sem exemplar (D5) afogariam
 * as que existem, e o papel viraria lista de doação. Exemplar baixado fica
 * fora pela mesma razão, mas é contado no resumo — e o exemplar cuja obra
 * não existe também, para a conta fechar com a planilha em vez de sumir.
 *
 * A situação vem dos empréstimos (`calcularSituacao`), não da coluna de
 * fórmula. E o relatório NÃO diz com quem está o livro: papel impresso
 * circula e fica esquecido em mesa, e numa casa espírita a escolha de livro
 * revela luto e doença (PLANO.md, Fase 5). Quem precisa do nome tem a aba
 * Atrasos.
 *
 * `previsao` sai como Date; quem chama formata.
 */
function montarRelatorioDoAcervo(titulos, exemplares, emprestimos) {
  var resumo = {
    obras: 0, exemplares: 0, disponiveis: 0, emprestados: 0, so_na_casa: 0,
    baixados: 0, sem_obra: 0
  };

  var porTitulo = {};
  (exemplares || []).forEach(function (exemplar) {
    if (String(exemplar.ativo).trim() !== 'SIM') { resumo.baixados++; return; }
    var id = Number(exemplar.id_titulo);
    if (!porTitulo[id]) porTitulo[id] = [];
    porTitulo[id].push(exemplar);
  });

  var obras = [];
  (titulos || []).forEach(function (titulo) {
    var id = Number(titulo.id_titulo);
    var meus = porTitulo[id];
    if (!meus) return;
    delete porTitulo[id];   // o que sobrar no fim não tem obra

    var linhas = meus
      .slice()
      .sort(function (a, b) { return Number(a.tombo) - Number(b.tombo); })
      .map(function (exemplar) {
        var situacao = calcularSituacao(exemplar, emprestimos);
        var aberto = situacao === SITUACAO_EMPRESTADO
          ? acharEmprestimoAberto(emprestimos, exemplar.tombo)
          : null;

        if (situacao === SITUACAO_EMPRESTADO) resumo.emprestados++;
        else if (situacao === SITUACAO_SO_NA_CASA) resumo.so_na_casa++;
        else resumo.disponiveis++;

        return {
          tombo: Number(exemplar.tombo),
          edicao: descreverEdicao(exemplar),
          estado: limpar_(exemplar.estado),
          situacao: situacao,
          previsao: aberto ? comoData_(aberto.data_prevista) : null,
          observacao: limpar_(exemplar.observacao)
        };
      });

    resumo.exemplares += linhas.length;
    obras.push({
      id_titulo: id,
      titulo: limpar_(titulo.titulo),
      subtitulo: limpar_(titulo.subtitulo),
      autoria: montarAutoria(titulo),
      categoria: limpar_(titulo.categoria),
      serie: limpar_(titulo.serie),
      ordem_na_serie: limpar_(titulo.ordem_na_serie),
      exemplares: linhas
    });
  });

  Object.keys(porTitulo).forEach(function (id) {
    resumo.sem_obra += porTitulo[id].length;
  });

  obras.sort(function (a, b) {
    return normalizarTexto(nomeDaObra(a)).localeCompare(normalizarTexto(nomeDaObra(b))) ||
      a.id_titulo - b.id_titulo;
  });
  resumo.obras = obras.length;

  return { resumo: resumo, obras: obras };
}

/**
 * Editora, ano e edição de um exemplar numa linha: "FEB Editora · 1978 ·
 * 3ª ed.". A edição é gravada só com o número (a tela só aceita dígito), e
 * "3" solto no meio da linha não diz o que é.
 */
function descreverEdicao(exemplar) {
  var edicao = limpar_(exemplar && exemplar.edicao);
  if (/^\d+$/.test(edicao)) edicao += 'ª ed.';

  return [limpar_(exemplar && exemplar.editora), limpar_(exemplar && exemplar.ano), edicao]
    .filter(function (parte) { return parte !== ''; })
    .join(' · ');
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

/**
 * Os campos pesquisáveis, normalizados e juntos num texto só.
 *
 * O subtítulo entra porque é ele que separa volumes de mesmo título: quem
 * procura "programa complementar" quer aquele, e não o fundamental.
 */
function camposDeBusca_(titulo) {
  return normalizarTexto([
    titulo.titulo,
    titulo.subtitulo,
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
  // O que a casa tem vem primeiro, antes de qualquer outro critério.
  //
  // Não era assim, e não precisava ser enquanto o catálogo só tinha o que
  // está na estante. Com o pré-cadastro do acervo base, buscar "emmanuel"
  // passou a devolver oitenta obras em ordem alfabética, e as quatro que o
  // frequentador pode levar para casa hoje ficavam perdidas no meio.
  //
  // A pergunta que a busca existe para responder é "vocês têm?". Título sem
  // exemplar continua aparecendo — é o D5, alimenta a lista de doações — mas
  // depois, e separado.
  var naCasaA = temNaCasa_(a) ? 0 : 1;
  var naCasaB = temNaCasa_(b) ? 0 : 1;
  if (naCasaA !== naCasaB) return naCasaA - naCasaB;

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

  // Com o subtítulo: dois volumes de mesmo título saem sempre na mesma ordem.
  return normalizarTexto(nomeDaObra(a)).localeCompare(normalizarTexto(nomeDaObra(b)));
}

/**
 * A casa tem algum exemplar desta obra?
 *
 * `qtd_exemplares`, e não `qtd_disponiveis`: livro emprestado continua sendo
 * da casa. Quem quer saber se pode levar hoje lê a linha de disponibilidade,
 * que é outra coisa.
 */
function temNaCasa_(titulo) {
  return Number(titulo && titulo.qtd_exemplares) > 0;
}

function casaNoTitulo_(titulo, palavras) {
  var alvo = normalizarTexto(nomeDaObra(titulo));
  return palavras.every(function (palavra) {
    return alvo.indexOf(palavra) !== -1;
  });
}

function numeroOuNulo_(valor) {
  if (valor === null || valor === undefined || String(valor).trim() === '') return null;
  var numero = Number(valor);
  return isFinite(numero) ? numero : null;
}


/**
 * O perfil existe na escada?
 *
 * Confere no servidor, e não só na validação de dados da planilha: aquela
 * também barra `setValues`, mas só se estiver na coluna certa, e com uma
 * mensagem que não diz o campo. É a mesma razão pela qual `criarExemplar`
 * confere o estado.
 */
function perfilValido(perfil) {
  return PERFIS.indexOf(limpar_(perfil)) !== -1;
}

/**
 * Sobra algum admin ativo se ESTA pessoa deixar de ser um?
 *
 * A tela de perfis existe para a casa não depender da planilha. Se o único
 * admin puder se rebaixar — ou se desativar — pela tela, ela produz
 * exatamente a dependência que veio remover, e num momento pior: ninguém mais
 * consegue promover ninguém, e a saída é abrir a planilha, que é o que só duas
 * pessoas conseguem fazer.
 *
 * Pessoa inativa não conta como admin: ela não entra no sistema.
 */
function sobraOutroAdmin(pessoas, idPessoa) {
  return (pessoas || []).some(function (pessoa) {
    return limpar_(pessoa.perfil) === 'admin' &&
      String(pessoa.ativo).trim() === 'SIM' &&
      Number(pessoa.id_pessoa) !== Number(idPessoa);
  });
}

if (typeof module !== 'undefined') {
  module.exports = {
    normalizarTexto: normalizarTexto,
    montarAutoria: montarAutoria,
    buscarTitulos: buscarTitulos,
    separarAutoria: separarAutoria,
    resumirDisponibilidade: resumirDisponibilidade,
    montarRelatorioDoAcervo: montarRelatorioDoAcervo,
    descreverEdicao: descreverEdicao,
    resumirEdicoes: resumirEdicoes,
    acharTitulosParecidos: acharTitulosParecidos,
    nomeDaObra: nomeDaObra,
    lerNumeroDaBusca: lerNumeroDaBusca,
    buscarPorNumero: buscarPorNumero,
    resumirExemplarParaBusca: resumirExemplarParaBusca,
    calcularSituacao: calcularSituacao,
    soParaLerNaCasa: soParaLerNaCasa,
    acharEmprestimoAberto: acharEmprestimoAberto,
    calcularDataPrevista: calcularDataPrevista,
    estaAtrasado: estaAtrasado,
    diasDeAtraso: diasDeAtraso,
    planejarSincronizacao: planejarSincronizacao,
    PERFIS: PERFIS,
    EXIGENCIA: EXIGENCIA,
    podeFazer: podeFazer,
    perfilValido: perfilValido,
    sobraOutroAdmin: sobraOutroAdmin,
    ehEmailValido: ehEmailValido,
    formatarTelefone: formatarTelefone,
    normalizarContato: normalizarContato,
    mesmoContato: mesmoContato,
    acharQuemPega: acharQuemPega,
    contarEmprestimosAbertos: contarEmprestimosAbertos,
    montarAvisoDeAtrasos: montarAvisoDeAtrasos,
    escolherReuniaoSemTema: escolherReuniaoSemTema,
    SITUACAO_DISPONIVEL: SITUACAO_DISPONIVEL,
    SITUACAO_EMPRESTADO: SITUACAO_EMPRESTADO,
    SITUACAO_BAIXADO: SITUACAO_BAIXADO,
    SITUACAO_SO_NA_CASA: SITUACAO_SO_NA_CASA
  };
}
