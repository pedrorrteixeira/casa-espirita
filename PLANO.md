# Plano de execução

Contexto e regras: @ESPECIFICACAO.md

Cada fase entrega algo utilizável. Não avance sem bater os critérios de aceite.
Marque `[x]` conforme concluir.

Legenda: 👤 = passo manual do Weldson · 🤖 = passo do Claude Code

---

## Fase 0 — Fundação

Objetivo: repositório funcionando, planilha criada, `clasp push` publicando.

- [ ] 👤 Criar conta Gmail **nova** para a casa. Não usar conta pessoal.
      Guardar a senha com a diretoria, não só com o voluntário.
- [ ] 👤 Habilitar a Apps Script API em `script.google.com/home/usersettings`.
      (Sem isso o `clasp push` falha com erro genérico.)
- [ ] 🤖 Criar a estrutura do repositório (ver "Estrutura de pastas" abaixo),
      com `package.json`, `.gitignore` e `src/appsscript.json`.
- [ ] 👤 `npx clasp login` (abre o navegador — logar na conta **da casa**).
- [ ] 👤 `npx clasp create --type sheets --title "Biblioteca Casa Espírita" --rootDir ./src`
- [ ] 🤖 Escrever `criarEstruturaPlanilha()`: cria as sete abas com cabeçalhos,
      validação de dados nas colunas de lista, fórmulas derivadas, congelamento
      da primeira linha e formatação de datas.
- [ ] 👤 Rodar `criarEstruturaPlanilha()` uma vez no editor e autorizar o script
      na tela de consentimento OAuth.
- [ ] 🤖 Popular a aba `Config` com os valores padrão.

**Aceite:** `npx clasp push` publica sem erro; a planilha existe com as sete
abas, cabeçalhos e validações; `npm test` roda (mesmo sem testes ainda).

---

## Fase 1 — Catálogo e busca

Objetivo: a bibliotecária consegue cadastrar títulos e exemplares, e qualquer
pessoa consegue buscar.

- [ ] 🤖 `dominio.js`: `normalizarTexto()` (minúsculas, sem acento, para busca),
      `montarAutoria()` (resolve autor vs autor espiritual/médium para exibição),
      `buscarTitulos(titulos, termo)` — pura, sem tocar em planilha.
- [ ] 🤖 `test/dominio.test.js` cobrindo busca por título, por autor, por autor
      espiritual, por médium, por série, e busca sem acento
      ("nosso lar" acha "Nosso Lar", "andre luiz" acha "André Luiz").
- [ ] 🤖 `planilha.js`: leitura em lote das abas, cache de 5 min em
      `CacheService` para a lista de títulos.
- [ ] 🤖 `catalogo.js`: `criarTitulo()`, `atualizarTitulo()`, `criarExemplar()`,
      `darBaixaExemplar()`. Com validações das regras 8, 9 e 10.
- [ ] 🤖 Tela de busca em `ui/`: campo único, resultado mostrando título,
      autoria, categoria, e "disponível (2 de 3)" ou "emprestado — previsão dd/mm".
      **Sem nome de quem está com o livro.**
- [ ] 🤖 Tela de cadastro de título e exemplar.
- [ ] 🤖 Botão de busca por ISBN chamando a API do Google Books, com
      preenchimento dos campos e fallback manual silencioso quando não achar.
- [ ] 👤 Cadastrar 20 livros reais do acervo para validar o modelo antes de
      catalogar tudo.

**Aceite:** buscar "andré luiz" retorna a série; buscar "chico" retorna as
psicografias; um título com zero exemplares aparece na busca marcado como não
disponível na casa; a busca pública não expõe nome de nenhum frequentador.

---

## Fase 2 — Empréstimos

Objetivo: substituir o caderno.

- [ ] 🤖 `dominio.js`: `calcularSituacao()`, `calcularDataPrevista()`,
      `estaAtrasado()` — puras, com testes.
- [ ] 🤖 `emprestimos.js`: `registrarEmprestimo()`, `registrarDevolucao()`,
      `renovar()`. Todas dentro de `LockService`, todas gravando na aba `Log`.
- [ ] 🤖 Testes das regras 1, 5, 6 e 7 (inclusive os caminhos de erro:
      exemplar já emprestado, pessoa inativa, devolução sem empréstimo aberto).
- [ ] 🤖 Tela de empréstimo: busca o exemplar pelo tombo, busca a pessoa pelo
      nome, confirma. Duas etapas no máximo — vai ser usada em pé, no celular.
- [ ] 🤖 Tela de devolução: digita o tombo, confirma.
- [ ] 🤖 Tela "livros em atraso" para o atendente.
- [ ] 👤 Etiquetar os exemplares com o número de tombo.

**Aceite:** dois empréstimos simultâneos do mesmo tombo — o segundo falha com
mensagem clara, não grava linha duplicada; devolução preenche a data sem apagar
nada; a aba `Log` registra as três operações.

---

## Fase 3 — Agenda

Objetivo: palestrante se inscreve sozinho e o dado chega na planilha.

- [ ] 👤 Criar o calendário "Reuniões Públicas" na conta da casa.
- [ ] 👤 Criar a página de agendamento: segundas, horário fixo, um slot por data,
      janela de agendamento estendida para 365 dias.
- [ ] 👤 Testar a reserva com dois e-mails diferentes na mesma data e confirmar
      que o segundo não consegue.
- [ ] 👤 Colocar `id_calendario` na aba `Config`.
- [ ] 🤖 `agenda.js`: `sincronizarReunioes()` — lê os eventos do período, faz
      upsert em `Reunioes` por `id_evento_calendar`, resolve `id_palestrante`
      por e-mail, marca como `cancelada` o que sumiu do Agenda.
- [ ] 🤖 Gatilho diário de sincronização.
- [ ] 🤖 Tela de agenda: próximas reuniões, quem palestra, tema, e campo para o
      palestrante ou o admin preencher o tema.

**Aceite:** uma reserva feita na página do Agenda aparece na aba `Reunioes` no
dia seguinte com nome, e-mail e data corretos; cancelar no Agenda marca
`cancelada` sem apagar a linha.

---

## Fase 4 — Automações

- [ ] 🤖 Gatilho diário: **um** e-mail consolidado para o admin com a lista de
      atrasos. Nunca um e-mail por atraso — a cota é de 100/dia.
- [ ] 🤖 Gatilho semanal: e-mail ao palestrante da próxima reunião pedindo o
      tema, se ainda estiver vazio.
- [ ] 🤖 Gatilho mensal: cópia da planilha via `DriveApp` para uma pasta
      `Backups`, nomeada com a data. Manter os 12 últimos.
- [ ] 🤖 Guarda de cota: checar `MailApp.getRemainingDailyQuota()` antes de
      qualquer envio em laço e registrar no `Log` se estourar.

**Aceite:** com três livros atrasados, chega um e-mail só; a pasta `Backups`
recebe a cópia; nenhum gatilho leva mais de 30 segundos.

---

## Fase 5 — Perfis (só se necessário)

Não faça agora. Implementar apenas se o Modelo A da seção 6 da especificação
apertar na prática.

- [ ] 🤖 Link mágico: token em `PropertiesService`, validade de 30 minutos,
      um uso.
- [ ] 🤖 `doGet` lê o perfil de `Pessoas` e renderiza telas conforme
      `consulta` / `atendente` / `bibliotecario` / `admin`.

---

## Estrutura de pastas

```
biblioteca-casa-espirita/
├── CLAUDE.md
├── ESPECIFICACAO.md
├── PLANO.md
├── package.json
├── .gitignore
├── src/
│   ├── appsscript.json
│   ├── Codigo.js          # doGet, roteamento, include()
│   ├── dominio.js         # funções puras — única camada testável em node
│   ├── planilha.js        # todo acesso a SpreadsheetApp
│   ├── catalogo.js
│   ├── emprestimos.js
│   ├── agenda.js
│   ├── gatilhos.js
│   ├── setup.js           # criarEstruturaPlanilha()
│   └── ui/
│       ├── index.html
│       ├── css.html
│       └── js.html
└── test/
    └── dominio.test.js
```

`.gitignore` deve conter no mínimo `node_modules/`, `.clasprc.json` e
`*.local.json`. O `.clasprc.json` guarda credenciais OAuth — nunca versionar.
O `.clasp.json` (que tem só o scriptId) pode ser versionado.

`src/appsscript.json`:

```json
{
  "timeZone": "America/Sao_Paulo",
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "webapp": { "executeAs": "USER_DEPLOYING", "access": "ANYONE_ANONYMOUS" }
}
```

---

## Comandos

```bash
npm test                 # node --test test/
npx clasp push           # publica src/ no projeto Apps Script
npx clasp open           # abre o editor no navegador
npx clasp deploy         # nova implantação (URL nova)
```

Para atualizar o Web App **mantendo a mesma URL**, use "Implantar → Gerenciar
implantações → editar → nova versão" no editor, não `clasp deploy`.

---

## Riscos a vigiar

- **Bus factor.** Se sair da conta da casa e voltar para a pessoal, o projeto
  morre com o voluntário. Confira antes de cada fase.
- **Fórmula derivada vs coluna escrita.** Se em algum momento aparecer código
  gravando `situacao` do exemplar, é bug. A verdade é a aba `Emprestimos`.
- **Escopo.** Não adicione multas, reservas com fila, código de barras ou
  relatório de leitura sem pedir. O sistema precisa ser operável por voluntário.
