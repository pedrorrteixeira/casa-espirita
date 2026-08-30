/**
 * fundacao.test.js — Fase 0.
 *
 * Guarda duas regras de arquitetura que, sem teste, só existem como comentário
 * no CLAUDE.md e quebram em silêncio.
 *
 * Os testes de domínio ficam em test/dominio.test.js, na Fase 1.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const SRC = path.join(RAIZ, 'src');

test('appsscript.json tem a configuração que o Apps Script espera', () => {
  const bruto = fs.readFileSync(path.join(SRC, 'appsscript.json'), 'utf8');
  const manifesto = JSON.parse(bruto);

  // Datas erradas por fuso são o bug mais caro deste projeto.
  assert.equal(manifesto.timeZone, 'America/Sao_Paulo');
  assert.equal(manifesto.runtimeVersion, 'V8');

  // O clasp create sobrescreve este arquivo e come o bloco webapp.
  // Sem ele a implantação não aceita acesso anônimo.
  assert.ok(manifesto.webapp, 'falta o bloco webapp');
  assert.equal(manifesto.webapp.executeAs, 'USER_DEPLOYING');
  assert.equal(manifesto.webapp.access, 'ANYONE_ANONYMOUS');
});

test('o acesso ao calendário é somente leitura — regra 12 no OAuth', () => {
  // A regra 12 diz que a sincronização é unidirecional: o código lê o Agenda e
  // nunca cria nem apaga evento. Com `calendar.readonly` isso deixa de ser
  // disciplina e passa a ser impossível — um `createEvent` escrito por engano
  // falha na camada de permissão, não em revisão de código.
  const manifesto = JSON.parse(
    fs.readFileSync(path.join(SRC, 'appsscript.json'), 'utf8'));
  const escopos = manifesto.oauthScopes || [];

  assert.ok(escopos.includes('https://www.googleapis.com/auth/calendar.readonly'),
    'falta o escopo de leitura do calendário');

  for (const amplo of ['https://www.googleapis.com/auth/calendar',
                       'https://www.google.com/calendar/feeds']) {
    assert.equal(escopos.includes(amplo), false,
      `escopo de escrita no calendário (${amplo}) viola a regra 12`);
  }
});

test('todo serviço do Google usado em src/ tem escopo declarado', () => {
  // Escopo declarado a menos = erro de permissão em produção, como aconteceu
  // com o CalendarApp. A menos, porque declarar o manifesto desliga a
  // detecção automática do Apps Script.
  const manifesto = JSON.parse(
    fs.readFileSync(path.join(SRC, 'appsscript.json'), 'utf8'));
  const escopos = (manifesto.oauthScopes || []).join(' ');

  const exigidos = {
    SpreadsheetApp: 'spreadsheets',
    CalendarApp: 'calendar',
    DriveApp: 'drive',
    UrlFetchApp: 'script.external_request',
    ScriptApp: 'script.scriptapp',
    MailApp: 'script.send_mail'
  };

  const fontes = listarJs(SRC).map((a) => fs.readFileSync(a, 'utf8')).join('\n');
  const faltando = [];

  for (const [servico, escopo] of Object.entries(exigidos)) {
    if (fontes.includes(servico + '.') && !escopos.includes(escopo)) {
      faltando.push(`${servico} usado, mas falta escopo com "${escopo}"`);
    }
  }

  assert.deepEqual(faltando, [], faltando.join('\n'));
});

test('nenhum arquivo de src/ usa módulos — Apps Script não tem', () => {
  // Apps Script concatena os arquivos num escopo global único. import/export
  // quebram o push; require quebra em tempo de execução. A única exceção é a
  // guarda de exportação do rodapé, que só roda em node.
  const guarda = /if\s*\(\s*typeof\s+module\s*!==\s*['"]undefined['"]\s*\)/;
  const proibido = /^\s*(?:import\s|export\s|export\{|(?:const|let|var)\s+.*=\s*require\()/;

  const problemas = [];
  for (const arquivo of listarJs(SRC)) {
    const linhas = fs.readFileSync(arquivo, 'utf8').split(/\r?\n/);
    linhas.forEach((linha, i) => {
      if (!proibido.test(linha)) return;
      if (guarda.test(linha)) return;
      problemas.push(`${path.relative(RAIZ, arquivo)}:${i + 1}: ${linha.trim()}`);
    });
  }

  assert.deepEqual(problemas, [], `uso de módulos em src/:\n${problemas.join('\n')}`);
});

function listarJs(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entrada) => {
    const caminho = path.join(dir, entrada.name);
    if (entrada.isDirectory()) return listarJs(caminho);
    return entrada.name.endsWith('.js') ? [caminho] : [];
  });
}

test('planilha.js e setup.js concordam sobre quais colunas são fórmula', () => {
  // Este teste existe por causa de um bug real: planilha.js tratava "derivada"
  // como fronteira ("tudo a partir da coluna 16") em vez de conjunto. Em
  // Titulos as fórmulas ficam no MEIO — P e Q — e observacao, em R, volta a
  // ser escrita normal. O resultado foi recusar gravar a observação de
  // qualquer título, e só apareceu quando alguém tentou cadastrar um livro.
  //
  // Acrescentar uma coluna de fórmula em setup.js sem atualizar planilha.js
  // reintroduziria a mesma classe de bug, em silêncio.
  const { ESTRUTURA_ABAS } = require('../src/setup.js');
  const { COLUNAS_DERIVADAS } = require('../src/planilha.js');

  for (const aba of ESTRUTURA_ABAS) {
    const naSetup = Object.keys(aba.formulas || {}).map(Number).sort((a, b) => a - b);
    const naPlanilha = (COLUNAS_DERIVADAS[aba.nome] || []).slice().sort((a, b) => a - b);

    assert.deepEqual(naPlanilha, naSetup,
      `a aba ${aba.nome} tem fórmula nas colunas [${naSetup}] segundo setup.js, ` +
      `mas planilha.js conhece [${naPlanilha}]`);
  }
});

test('nenhuma coluna de fórmula é escrita por catalogo.js', () => {
  // A recusa de escrita mora em planilha.js, mas o nome do campo vem de quem
  // chama. Se catalogo.js montar um registro com `situacao` ou
  // `qtd_exemplares`, o erro só aparece em produção.
  const { ESTRUTURA_ABAS } = require('../src/setup.js');

  const derivadas = new Set();
  for (const aba of ESTRUTURA_ABAS) {
    for (const coluna of Object.keys(aba.formulas || {})) {
      derivadas.add(aba.cabecalhos[Number(coluna) - 1]);
    }
  }

  const catalogo = fs.readFileSync(path.join(SRC, 'catalogo.js'), 'utf8');
  const problemas = [];
  for (const campo of derivadas) {
    // Procura o campo como chave de objeto: `situacao:` ou `'situacao':`.
    if (new RegExp(`^\s*'?${campo}'?\s*:`, 'm').test(catalogo)) {
      problemas.push(campo);
    }
  }

  assert.deepEqual(problemas, [],
    `catalogo.js monta registro com coluna derivada: ${problemas.join(', ')}`);
});

test('as fórmulas apontam para as colunas certas de Exemplares', () => {
  // As ARRAYFORMULA referenciam colunas por LETRA. Reordenar cabeçalhos sem
  // reescrever as fórmulas quebra tudo em silêncio: a situação de todo
  // exemplar viraria lixo e nenhum erro seria levantado. Aconteceu na
  // migração para o modelo de edições, quando `ativo` foi de F para I.
  const setup = require('../src/setup.js');
  const { ESTRUTURA_ABAS } = setup;

  const exemplares = ESTRUTURA_ABAS.find((a) => a.nome === 'Exemplares');
  const titulos = ESTRUTURA_ABAS.find((a) => a.nome === 'Titulos');

  const letra = (cabecalhos, campo) => {
    const i = cabecalhos.indexOf(campo);
    assert.notEqual(i, -1, `a coluna ${campo} sumiu`);
    return String.fromCharCode(65 + i);   // só vale até Z, e as abas cabem
  };

  const fonte = fs.readFileSync(path.join(SRC, 'setup.js'), 'utf8');

  // situacao lê `ativo` da própria aba
  const colAtivo = letra(exemplares.cabecalhos, 'ativo');
  assert.ok(fonte.includes(`IF(${colAtivo}2:${colAtivo}<>"SIM","baixado"`),
    `F_SITUACAO devia ler ativo em ${colAtivo}, e não lê`);

  // qtd_exemplares conta os ativos de Exemplares
  assert.ok(fonte.includes(`Exemplares!$${colAtivo}$2:$${colAtivo},"SIM"`),
    `F_QTD_EXEMPLARES devia contar Exemplares!${colAtivo}, e não conta`);

  // qtd_disponiveis lê a coluna situacao de Exemplares
  const colSituacao = letra(exemplares.cabecalhos, 'situacao');
  assert.ok(fonte.includes(`Exemplares!$${colSituacao}$2:$${colSituacao},"disponível"`),
    `F_QTD_DISPONIVEIS devia ler Exemplares!${colSituacao}, e não lê`);

  // as duas abas usam a coluna A como chave nas fórmulas
  assert.equal(exemplares.cabecalhos[0], 'tombo');
  assert.equal(titulos.cabecalhos[0], 'id_titulo');
});

test('o destaque de reunião duplicada aponta para data e status', () => {
  // Mesma armadilha das ARRAYFORMULA: a formatação condicional referencia
  // colunas por letra. Reordenar os cabeçalhos de Reunioes sem reescrever a
  // fórmula faria o destaque comparar as colunas erradas — e um conflito de
  // data passaria despercebido, que é justamente o que ele existe para pegar.
  const { ESTRUTURA_ABAS } = require('../src/setup.js');
  const reunioes = ESTRUTURA_ABAS.find((a) => a.nome === 'Reunioes');

  assert.ok(reunioes.destaques && reunioes.destaques.length,
    'Reunioes perdeu o destaque de data duplicada');

  const letra = (campo) => {
    const i = reunioes.cabecalhos.indexOf(campo);
    assert.notEqual(i, -1, `a coluna ${campo} sumiu`);
    return String.fromCharCode(65 + i);
  };

  const formula = reunioes.destaques[0].formula;
  const colData = letra('data');
  const colStatus = letra('status');

  assert.ok(formula.includes(`$${colData}$2:$${colData}`),
    `devia contar pela coluna ${colData} (data)`);
  assert.ok(formula.includes(`$${colStatus}$2:$${colStatus}`),
    `devia filtrar pela coluna ${colStatus} (status)`);
});

test('nenhum nome global é declarado em dois arquivos de src/', () => {
  // Apps Script concatena tudo num escopo global só. Duas definições do mesmo
  // nome não dão erro: a última silenciosamente vence, e qual é a última
  // depende da ordem de concatenação. Já aconteceu aqui com LOCK_ESPERA_MS,
  // e por pouco não aconteceu com ehVazio_ — que existe em planilha.js e por
  // isso se chama semValor_ em dominio.js.
  const declaracoes = new Map();

  for (const arquivo of listarJs(SRC)) {
    const nome = path.basename(arquivo);
    const texto = fs.readFileSync(arquivo, 'utf8');
    const achados = texto.matchAll(/^(?:function|var|let|const)\s+(\w+)/gm);

    for (const [, simbolo] of achados) {
      if (!declaracoes.has(simbolo)) declaracoes.set(simbolo, []);
      const onde = declaracoes.get(simbolo);
      if (!onde.includes(nome)) onde.push(nome);
    }
  }

  const colisoes = [...declaracoes]
    .filter(([, arquivos]) => arquivos.length > 1)
    .map(([simbolo, arquivos]) => `${simbolo}: ${arquivos.join(' e ')}`);

  assert.deepEqual(colisoes, [],
    `mesmo nome declarado em arquivos diferentes:\n${colisoes.join('\n')}`);
});

test('nenhuma declaração ficou engolida por um comentário', () => {
  // node --check não pega isto: um `var X = 1` dentro de um bloco /* */ é
  // comentário válido, o arquivo compila, e X fica indefinido em tempo de
  // execução. Aconteceu com LIMITE_DE_NOMES — a busca de pessoa passaria a
  // devolver lista vazia, sem erro nenhum.
  const problemas = [];

  for (const arquivo of listarJs(SRC)) {
    const texto = fs.readFileSync(arquivo, 'utf8');
    const semComentarios = texto.replace(/\/\*[\s\S]*?\*\//g, '');

    const declaradas = [...texto.matchAll(/^(?:var|function)\s+(\w+)/gm)]
      .map(([, nome]) => nome);
    const vivas = new Set([...semComentarios.matchAll(/^(?:var|function)\s+(\w+)/gm)]
      .map(([, nome]) => nome));

    for (const nome of declaradas) {
      if (!vivas.has(nome)) {
        problemas.push(`${path.basename(arquivo)}: "${nome}" está dentro de um comentário`);
      }
    }
  }

  assert.deepEqual(problemas, [], problemas.join('\n'));
});

test('o JavaScript das telas compila', () => {
  // `npm test` conferia src/*.js e ignorava o script dentro de ui/js.html —
  // que é metade do sistema. Uma quebra de sintaxe ali passava por todos os
  // testes e ia para produção. Aconteceu duas vezes.
  //
  // `new Function` analisa sem executar, então `document` e `google.script.run`
  // não precisam existir aqui.
  const html = fs.readFileSync(path.join(SRC, 'ui', 'js.html'), 'utf8');
  const script = /<script>([\s\S]*)<\/script>/.exec(html);

  assert.ok(script, 'ui/js.html perdeu o bloco <script>');

  try {
    new Function(script[1]);
  } catch (erro) {
    assert.fail(`ui/js.html não compila: ${erro.message}`);
  }
});

test('as telas não montam HTML por concatenação de texto', () => {
  // Título de livro e nome de pessoa são digitados por gente e podem conter
  // < e &. innerHTML com texto vindo do servidor é injeção esperando acontecer.
  // Limpar com innerHTML = '' é seguro e continua permitido.
  const html = fs.readFileSync(path.join(SRC, 'ui', 'js.html'), 'utf8');
  const suspeitas = [];

  html.split(/\r?\n/).forEach((linha, i) => {
    if (!/\.innerHTML\s*=/.test(linha)) return;
    if (/\.innerHTML\s*=\s*''\s*;/.test(linha)) return;   // só limpando
    suspeitas.push(`ui/js.html:${i + 1}: ${linha.trim()}`);
  });

  assert.deepEqual(suspeitas, [],
    `innerHTML com conteúdo:\n${suspeitas.join('\n')}`);
});

test('toda função que grava exige sessão', () => {
  // A guarda é a única proteção real: `google.script.run` é chamável do
  // console do navegador, e esconder botão não impede nada. Uma função de
  // escrita sem `exigir_` é um buraco aberto a quem tiver o link.
  //
  // As exceções abaixo são deliberadas e cada uma tem motivo escrito no
  // próprio arquivo. Acrescentar nome a esta lista é decisão consciente.
  const SEM_SESSAO = new Set([
    'pedirAcesso',        // é a porta de entrada; responde igual ache ou não
    'abrirSessao',        // troca o código de uso único pela sessão
    'encerrarSessao',     // sair não precisa de permissão
    'verSessao',          // valida a própria sessão
    'meusEmprestimos',    // decisão do Weldson: contato basta, sem token
    'criarEstruturaPlanilha', 'popularConfigPadrao',   // menu da planilha,
    'sincronizarReunioes', 'sincronizarAgora',         // que já exige ser
    'instalarGatilhos', 'verGatilhos',                 // editor dela
    'diagnosticarGoogleBooks', 'diagnosticarAgenda',
    'gatilhoDiario', 'gatilhoSemanal', 'gatilhoMensal',
    'avisarAtrasos', 'cobrarTema', 'fazerBackup',
    'testarAvisoDeAtrasos', 'testarCobrancaDeTema', 'testarBackup',
    'limparSessoesVencidas'
  ]);

  // Uma função "grava" quando chama algo que escreve na planilha.
  const ESCRITAS = /escreverLinha_|atualizarCelulas_|appendRow|setValue/;

  const problemas = [];

  for (const arquivo of listarJs(SRC)) {
    const texto = fs.readFileSync(arquivo, 'utf8');
    // Corpo de cada função de topo, até a próxima declaração de topo.
    const partes = texto.split(/^function\s+/m).slice(1);

    for (const parte of partes) {
      const nome = /^(\w+)/.exec(parte)[1];
      if (nome.endsWith('_')) continue;          // interna, não é endpoint
      if (SEM_SESSAO.has(nome)) continue;
      if (!ESCRITAS.test(parte)) continue;       // não grava

      if (!/exigir_\(/.test(parte)) {
        problemas.push(`${path.basename(arquivo)}: ${nome}() grava sem exigir_()`);
      }
    }
  }

  assert.deepEqual(problemas, [], problemas.join('\n'));
});

test('o manual acompanha as telas que existem', () => {
  // O manual mora dentro do sistema justamente para não envelhecer em
  // silêncio. Mas morar junto não basta: alguém tem que perceber quando ele
  // ficou para trás. Isto compara as duas listas mais propensas a divergir —
  // as abas do sistema e as que o manual descreve.
  //
  // Um manual que descreve uma tela que não existe mais é pior que manual
  // nenhum: manda o voluntário procurar um botão fantasma e o convence de que
  // ele é que está errado.
  const html = fs.readFileSync(path.join(SRC, 'ui', 'index.html'), 'utf8');
  const manual = fs.readFileSync(path.join(SRC, 'ui', 'manual.html'), 'utf8');

  // Rótulo de cada aba, como o voluntário lê na tela.
  const abas = [...html.matchAll(/data-visao="[a-z]+"[^>]*>([^<]+)</g)]
    .map(([, rotulo]) => rotulo.trim());

  // A própria aba Manual não se descreve, e Buscar é o estado inicial: quem
  // abre o sistema já está nela, sem precisar de instrução.
  const dispensadas = new Set(['Manual', 'Buscar']);

  const faltando = abas
    .filter((aba) => !dispensadas.has(aba))
    .filter((aba) => !manual.includes(`<kbd>${aba}</kbd>`));

  assert.deepEqual(faltando, [],
    `estas abas existem mas o manual não as menciona: ${faltando.join(', ')}`);
});

test('toda visão fica dentro do <main>', () => {
  // O manual chegou a ficar FORA do <main>, e por isso não herdava a
  // centralização — aparecia colado na borda esquerda enquanto o resto do
  // sistema ficava no meio da tela. Passou despercebido porque o conteúdo
  // estava certo; só a posição estava errada.
  const html = fs.readFileSync(path.join(SRC, 'ui', 'index.html'), 'utf8');

  const abre = html.indexOf('<main>');
  const fecha = html.indexOf('</main>');
  assert.ok(abre !== -1 && fecha > abre, 'index.html perdeu o <main>');

  const foraDoMain = [];

  // As que estão escritas no próprio index.html.
  for (const achado of html.matchAll(/<section id="(visao-[\w-]+)"/g)) {
    if (achado.index < abre || achado.index > fecha) foraDoMain.push(achado[1]);
  }

  // E as que chegam por include — o caso que escapou da primeira versão deste
  // teste, e justamente o que tinha quebrado. A seção mora no arquivo incluído,
  // então procurá-la no index.html não encontra nada; o que importa é onde a
  // CHAMADA do include está.
  for (const achado of html.matchAll(/include\('ui\/([\w-]+)'\)/g)) {
    const incluido = path.join(SRC, 'ui', `${achado[1]}.html`);
    if (!fs.existsSync(incluido)) continue;
    if (!/class="visao/.test(fs.readFileSync(incluido, 'utf8'))) continue;
    if (achado.index < abre || achado.index > fecha) foraDoMain.push(`ui/${achado[1]}`);
  }

  assert.deepEqual(foraDoMain, [],
    `estas visões estão fora do <main> e não vão herdar o layout: ${foraDoMain.join(', ')}`);
});
