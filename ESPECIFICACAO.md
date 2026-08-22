# Especificação — Biblioteca e Agenda da Casa Espírita

Documento de referência. Contém o modelo de dados, as regras de negócio e o
**porquê** de cada decisão, para que ninguém as desfaça por engano depois.

---

## 1. Contexto

Casa espírita sem estrutura de TI, sem servidor e sem orçamento — vive de
doações. Precisa de três coisas:

1. **Biblioteca** — saber o que a casa tem, com quem está emprestado, e
   responder "vocês têm tal livro?".
2. **Cadastro de pessoas** — frequentadores e palestrantes, cadastro único.
3. **Agenda de reuniões públicas** — toda segunda-feira, horário fixo. As datas
   do ano são abertas de uma vez e os palestrantes se inscrevem sozinhos. O tema
   é definido depois; o horário não.

A responsável pelo acervo é uma pessoa específica, que cataloga e mantém os
títulos. Os demais voluntários apenas registram empréstimo e devolução.

---

## 2. Decisões tomadas (e por quê)

| # | Decisão | Motivo |
|---|---|---|
| D1 | Google Sheets como banco, Apps Script como backend | Único caminho gratuito, hospedado, sem servidor e sem mensalidade |
| D2 | **Não** usar AppSheet | O plano gratuito é só protótipo (10 usuários de teste) e as automações de e-mail já são pagas |
| D3 | Google Forms só para cadastros simples, não para a agenda | O dropdown do Forms não se atualiza sozinho: dois palestrantes pegariam a mesma data |
| D4 | Inscrição de palestrante via **página de agendamento do Google Agenda** | Nativo, gratuito em conta pessoal, e cada horário só pode ser reservado uma vez — resolve concorrência sem código |
| D5 | Separar `Titulos` de `Exemplares` | A casa tem 3 cópias do mesmo livro; e precisa catalogar obras que não possui, para consulta e lista de doação |
| D6 | Uma linha por exemplar físico, com etiqueta de tombo colada no livro | Sem isso é impossível responder "temos disponível?" quando um está emprestado e outro não |
| D7 | `situacao` do exemplar é **fórmula derivada** dos empréstimos abertos | Campo escrito à mão dessincroniza. A verdade é a tabela de empréstimos |
| D8 | Devolução preenche `data_devolucao`, nunca apaga linha | Preserva histórico de circulação de graça |
| D9 | Separar `autor_espiritual` de `medium` | Em acervo espírita, o frequentador pede tanto "um do André Luiz" quanto "um do Chico Xavier" |
| D10 | Sem senha própria. Identidade por link mágico quando necessário | Guardar senha em planilha é risco jurídico e operacional sem ganho |
| D11 | Conta Google **nova**, da casa, não a pessoal do voluntário | Se o voluntário sai, o sistema não morre com ele |
| D12 | Link do sistema publicado atrás de encurtador ou Google Sites | A URL do Web App muda na migração para Workspace; assim não se reensina 40 pessoas |
| D13 | Identificadores **numéricos sequenciais** (`id_titulo`, `id_pessoa`, `id_emprestimo`, `tombo`) | Etiqueta fica "Tombo 142" e a tela de empréstimo pede 3 toques em vez de 8. E `SUMIFS` só resolve `com_quem` se `id_pessoa` for número |
| D14 | Colunas derivadas são **uma `ARRAYFORMULA` na linha 2**, não fórmula por linha | Linha nova recebe o valor sozinha. Nenhum código precisa escrever em coluna derivada, o que torna D7 verificável em vez de ser só disciplina |

### Decisões adiadas

- **Workspace para ONGs**: a casa ainda não tem o CNPJ regularizado. Quando
  tiver (e se tiver OSCIP/CEBAS/UPF/OS), o limite de e-mail sobe de 100 para
  1.500/dia. Até lá, conta Gmail comum.
- **Perfis de acesso via link mágico**: só implementar se o Modelo A
  (compartilhamento direto com 2 pessoas) apertar. Ver seção 6.

---

## 3. Modelo de dados

Uma planilha, sete abas. Coluna A de cada aba de cadastro é o identificador.

### Aba `Config`
Pares chave/valor. Nada de configuração no código.

| chave | exemplo | uso |
|---|---|---|
| `prazo_devolucao_dias` | `21` | prazo padrão de empréstimo |
| `email_admin` | `...@gmail.com` | destinatário dos avisos internos |
| `id_calendario` | `...@group.calendar.google.com` | agenda das reuniões |
| `horario_reuniao` | `19:30` | horário fixo das segundas |
| `nome_casa` | | cabeçalho da interface |

### Aba `Titulos` — a obra
`id_titulo` (PK) · `titulo` · `subtitulo` · `autor` · `autor_espiritual` ·
`medium` · `tradutor` · `editora` · `ano` · `isbn` · `categoria` · `serie` ·
`ordem_na_serie` · `sinopse` · `link_online` · `qtd_exemplares` (fórmula) ·
`qtd_disponiveis` (fórmula) · `observacao`

- `categoria`: doutrinário, romance, infantil, estudo, mediunidade, biografia…
  (validação de dados por lista, não texto livre).
- `autor` é para obras não psicografadas. Em psicografia, preencha
  `autor_espiritual` + `medium` e deixe `autor` vazio.
- A busca deve procurar em `titulo`, `autor`, `autor_espiritual`, `medium` e
  `serie` simultaneamente.
- **Um título pode existir com zero exemplares.** Isso é o recurso, não um bug:
  serve para consulta e alimenta a lista de doações desejadas.

### Aba `Exemplares` — o objeto físico
`tombo` (PK) · `id_titulo` (FK) · `estado` · `doado_por` · `data_entrada` ·
`ativo` · `situacao` (fórmula) · `com_quem` (fórmula) · `previsao_devolucao` (fórmula)

- `estado`: novo, bom, regular, ruim.
- `ativo` = NÃO significa baixa (perdido, danificado, repassado). Nunca apagar linha.
- `com_quem` só aparece nas telas internas. **Nunca na busca pública.**

### Aba `Pessoas`
`id_pessoa` (PK) · `nome` · `telefone` · `email` · `frequentador` · `palestrante` ·
`perfil` · `ativo` · `data_cadastro` · `observacao`

- `perfil`: `consulta` | `atendente` | `bibliotecario` | `admin`.
- Cadastro único: palestrante é uma flag, não uma tabela separada.

### Aba `Emprestimos`
`id_emprestimo` (PK) · `tombo` (FK) · `id_pessoa` (FK) · `data_emprestimo` ·
`data_prevista` · `data_devolucao` · `quem_registrou` · `renovacoes` · `observacao`

- `data_devolucao` vazia = empréstimo em aberto. Essa é a definição.
- O empréstimo aponta para o **tombo**, nunca para o título. É o objeto físico
  que sai pela porta.

### Aba `Reunioes`
`id_reuniao` (PK) · `data` · `horario` · `id_palestrante` (FK) · `nome_reservado` ·
`email_reservado` · `tema` · `status` · `id_evento_calendar` · `data_inscricao`

- Alimentada por sincronização a partir do Google Agenda (ver seção 5).
- `nome_reservado` / `email_reservado` são o que veio da reserva; `id_palestrante`
  é o vínculo com `Pessoas`, resolvido por e-mail quando possível.
- `status`: `vaga_aberta` | `reservada` | `tema_confirmado` | `realizada` | `cancelada`.

### Aba `Sugestoes`
`data` · `id_titulo` (se existir no catálogo) · `titulo_livre` · `quem_pediu` ·
`atendido`

Registra pedidos de livros que a casa não tem. Vira lista de compras quando
aparecer doação em dinheiro.

### Aba `Log`
`data_hora` · `usuario` · `acao` · `entidade` · `id` · `detalhe`

Toda escrita do Web App grava aqui. Sem dado pessoal sensível no `detalhe`.

---

## 4. Regras de negócio

**Empréstimo**
1. Só é possível emprestar exemplar com `ativo` = SIM e sem empréstimo aberto.
2. A validação de disponibilidade e a gravação acontecem dentro do mesmo
   `LockService`. Verificar e depois gravar sem lock é uma condição de corrida.
3. `data_prevista` = `data_emprestimo` + `prazo_devolucao_dias` da aba `Config`.
4. Renovação incrementa `renovacoes` e empurra `data_prevista`. Sem limite rígido
   por enquanto — se houver fila para o título, o atendente decide.
5. Uma pessoa inativa (`ativo` = NÃO) não pode pegar livro.

**Devolução**
6. Preenche `data_devolucao` na linha do empréstimo aberto. Nunca apaga, nunca
   sobrescreve outra coluna.
7. Devolver um exemplar sem empréstimo aberto é erro — mostre mensagem, não
   crie linha.

**Catálogo**
8. Criar exemplar exige `id_titulo` existente. Se o título não existe, o fluxo
   cria o título primeiro.
9. Excluir título com exemplares vinculados é proibido.
10. Baixa de exemplar = `ativo` = NÃO. Nunca `deleteRow`.

**Agenda**
11. Uma reunião por data. Garantido pelo Google Agenda, não pelo código.
12. A sincronização Agenda → planilha é **unidirecional e read-only** do lado
    do Agenda. O código nunca cria nem apaga reserva.
13. `tema` é preenchido depois, pela planilha ou por tela própria. Horário não
    é definido depois — já vem fixo da configuração da página de agendamento.

**Geral**
14. Toda escrita registra `quem_registrou` e grava na aba `Log`.
15. Nenhuma função apaga linha de planilha. Baixa é sempre lógica.

---

## 5. Integração com o Google Agenda

A página de agendamento é criada **manualmente** no Google Agenda da casa:

- Disponibilidade: toda segunda, no horário fixo, um slot por data.
- Janela de agendamento: estender para 365 dias (o padrão é curto e impediria
  abrir o ano inteiro de uma vez).
- O link é distribuído apenas no grupo de palestrantes.

O que o plano gratuito **não** oferece, e por isso vira código:

- Lembrete automático por e-mail → gatilho diário no Apps Script.
- Verificação de e-mail de quem reserva → aceitável, o público é fechado.
- Só uma página de agendamento → suficiente, há um tipo de evento.

**Sincronização**: gatilho diário lê os eventos do calendário no período e
faz upsert na aba `Reunioes` usando `id_evento_calendar` como chave. Eventos
removidos no Agenda viram `status = cancelada` na planilha, não são apagados.

---

## 6. Modelo de acesso

**Modelo A (começar por aqui).** A planilha é compartilhada como editor com a
bibliotecária e um suplente, e com mais ninguém. Intervalos protegidos travam
as abas de fórmula e a aba `Pessoas`. Todos os outros voluntários usam o Web App.

Limitação honesta: aba oculta não é segurança — qualquer editor reexibe.
Por isso o acesso à planilha fica restrito a duas pessoas.

**Modelo B (quando A apertar).** Ninguém acessa a planilha. O Web App é
implantado como "executar como: eu (proprietário)" e escreve com a permissão do
dono; os usuários só abrem uma URL. O controle vira a coluna `perfil` da aba
`Pessoas` e o `doGet` renderiza telas diferentes.

Como em conta Gmail comum o script não identifica o visitante de forma
confiável, o Modelo B exige o **link mágico**: a pessoa informa o e-mail, o
script confere se está em `Pessoas`, gera um token com validade curta em
`PropertiesService` e envia um link. Telas de consulta ficam abertas; telas que
gravam exigem token válido.

**Privacidade nas telas**: a busca pública mostra "emprestado — previsão de
devolução dd/mm". Nunca o nome de quem está com o livro. Esse dado só aparece
nas telas de `atendente` para cima.

---

## 7. Limites conhecidos

- **100 destinatários de e-mail por dia.** Agrupe avisos num único e-mail para
  o admin em vez de disparar um por atraso. Cheque
  `MailApp.getRemainingDailyQuota()` antes de laços de envio.
- **6 minutos por execução, 90 minutos/dia de gatilhos.** Folgado para o
  volume esperado (centenas de livros, dezenas de pessoas), mas mantém a
  disciplina de leitura em lote.
- **A URL do Web App muda** a cada nova implantação com novo ID. Use "gerenciar
  implantações → editar" para manter a mesma URL ao atualizar.
- **API do Google Books** cobre mal edições FEB e LAKE dos anos 70–80, e muitas
  nem têm ISBN. Trate o preenchimento automático como atalho, não como caminho
  principal.
- **`link_online`**: as obras de Kardec são domínio público. Psicografias do
  Chico Xavier, obras do Divaldo Franco e traduções da FEB não são. Apontar
  apenas para fontes oficiais (FEB, federações estaduais, site da editora).
