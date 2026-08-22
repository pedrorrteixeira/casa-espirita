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
