# Biblioteca e Agenda — Casa Espírita

Sistema de controle de biblioteca (catálogo, exemplares, empréstimos) e agenda de
palestrantes para uma casa espírita. Voluntário, custo zero, sem servidor.

Especificação completa: @ESPECIFICACAO.md
Plano de execução: @PLANO.md

## Stack

- **Google Apps Script** (runtime V8), JavaScript puro. Sem TypeScript, sem
  framework, sem bundler, sem etapa de build.
- **Google Sheets** como banco de dados (uma planilha, várias abas).
- **HtmlService** para a interface web (HTML + CSS + JS vanilla).
- **clasp** para editar local e publicar (`npx clasp push`).
- **Google Agenda** (página de agendamento nativa) para a inscrição de palestrantes.
- Testes: `node --test` sobre a camada de domínio pura.

## Restrições que não são negociáveis

1. **Custo zero.** Nada que exija plano pago, cartão de crédito ou assinatura.
   Sem AppSheet, sem Firebase, sem Cloud Run, sem banco externo.
2. **Conta Gmail pessoal** (não é Workspace). Consequências práticas:
   - `Session.getActiveUser().getEmail()` retorna vazio. Não dependa disso para
     identificar usuários.
   - Limite de **100 destinatários de e-mail por dia** (`MailApp`).
   - Gatilhos: 90 minutos de execução acumulada por dia, 6 minutos por execução.
3. **Manutenção por não-técnicos.** Quem vai operar isso são voluntários. Toda
   configuração fica na aba `Config` da planilha, nunca hardcoded no código.
4. **LGPD.** A aba `Pessoas` tem telefone e e-mail de frequentadores. A planilha
   não é compartilhada com ninguém além de 2 administradores.

## Regras de arquitetura

- **Separe domínio de I/O.** `src/dominio.js` contém apenas funções puras
  (sem `SpreadsheetApp`, `CalendarApp`, `MailApp`). É a única camada testável
  em node. Todo acesso a planilha vive em `src/planilha.js`.
- **Apps Script não tem módulos.** Os arquivos compartilham um escopo global e
  são concatenados. Não use `import`/`export`/`require`. Para testar em node,
  exporte no rodapé com guarda:
  ```js
  if (typeof module !== 'undefined') { module.exports = { minhaFuncao }; }
  ```
- **Leia e escreva em lote.** `getValues()` / `setValues()` sobre intervalos.
  Nunca `getValue()` dentro de um laço — estoura quota e fica lento.
- **`LockService` em toda escrita** que possa ter concorrência (empréstimo,
  devolução). Timeout de 10s, e falhe com mensagem clara.
- **Nada de IDs hardcoded.** `spreadsheetId`, `calendarId`, e-mail do admin e
  prazo de devolução vêm de `PropertiesService` ou da aba `Config`.
- **Nunca `console.log` de dado pessoal.** Os logs do Apps Script são retidos.

## Vocabulário do domínio (use estes termos no código e na UI)

Português, sempre. O código precisa casar com os nomes das abas e com o que os
voluntários falam.

- **Título** — a obra. Existe mesmo que a casa não tenha nenhum exemplar.
- **Exemplar** — o objeto físico, identificado por um **tombo**.
- **Autor espiritual** vs **médium** — em obra psicografada são pessoas
  diferentes e ambas precisam ser pesquisáveis.
- **Frequentador** — quem pega livro emprestado.
- **Palestrante** — quem fala na reunião pública. É um frequentador com flag.
- **Reunião** — o evento semanal (segunda-feira, horário fixo).
- **Baixa** — retirar um exemplar do acervo (perdido, danificado, doado).

## Convenções

- Comentários e mensagens de UI em português.
- Nomes de função em português (`registrarEmprestimo`, `calcularSituacao`).
- Datas sempre `America/Sao_Paulo`. Grave como objeto Date, formate na exibição.
- Antes de dizer que uma fase está pronta, rode `npm test` e confira os
  critérios de aceite da fase no @PLANO.md.

## O que você (Claude Code) não consegue fazer

Estas etapas são manuais e estão listadas no @PLANO.md. Não tente contorná-las,
não invente credenciais, e pare para pedir quando o plano indicar:

- Criar a conta Google da casa.
- `clasp login` (abre o navegador).
- Habilitar a Apps Script API em script.google.com/home/usersettings.
- Autorizar o script na primeira execução (tela de consentimento OAuth).
- Criar e configurar a página de agendamento no Google Agenda.
- Criar a implantação pública do Web App.
