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
