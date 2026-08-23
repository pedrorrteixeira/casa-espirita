/**
 * pessoas.js — cadastro de frequentadores e palestrantes.
 *
 * Não estava na estrutura original do PLANO.md. Apareceu na Fase 2: a fase diz
 * "busca a pessoa pelo nome", mas nada preenchia a aba `Pessoas`, e sem isso
 * não há a quem emprestar.
 *
 * Cadastro único: palestrante é uma flag, não uma tabela separada.
 *
 * ATENÇÃO — LGPD. Esta aba tem telefone e e-mail de frequentadores. Nada aqui
 * pode acabar numa tela pública: a busca de pessoa só existe para as telas de
 * empréstimo, e o `Log` nunca recebe nome, só id.
 */

/**
 * Cadastra uma pessoa. Só o nome é obrigatório — a casa não vai negar livro a
 * quem não quis dar telefone.
 */
function criarPessoa(dados, quemRegistrou) {
  var nome = limparCampo_(dados && dados.nome);
  if (!nome) throw new Error('O nome é obrigatório.');

  return comTrava_(function () {
    var repetida = acharPessoaPeloNome_(nome);
    if (repetida) {
      throw new Error(
        'Já existe "' + repetida.nome + '" cadastrado (nº ' + repetida.id_pessoa +
        '). Use a pessoa existente, ou acrescente um sobrenome para distinguir.'
      );
    }

    var registro = {
      id_pessoa: proximoId_(ABA_PESSOAS, 'id_pessoa'),
      nome: nome,
      telefone: limparCampo_(dados.telefone),
      email: limparCampo_(dados.email),
      frequentador: dados.frequentador === false ? 'NÃO' : 'SIM',
      palestrante: dados.palestrante ? 'SIM' : 'NÃO',
      perfil: 'consulta',
      ativo: 'SIM',
      data_cadastro: new Date(),
      observacao: limparCampo_(dados.observacao)
    };

    escreverLinha_(ABA_PESSOAS, registro);
    // Sem nome no detalhe: o Log é visível a quem abre a planilha e fica
    // retido. Id basta para auditar.
    registrarLog_(quemRegistrou, 'criar', 'pessoa', registro.id_pessoa, '');
    return registro.id_pessoa;
  });
}

/**
 * Procura pessoas pelo nome, para a tela de empréstimo.
 *
 * Devolve APENAS id e nome. Telefone e e-mail não saem daqui: quem empresta
 * precisa identificar a pessoa, não ter a agenda dela.
 *
 * Exige dois caracteres para não devolver o cadastro inteiro a cada tecla.
 */
function buscarPessoas(termo) {
  var alvo = normalizarTexto(termo);
  if (alvo.length < 2) return [];

  return lerPessoas()
    .filter(function (pessoa) {
      return String(pessoa.ativo).trim() === 'SIM' &&
        normalizarTexto(pessoa.nome).indexOf(alvo) !== -1;
    })
    .sort(function (a, b) {
      return normalizarTexto(a.nome).localeCompare(normalizarTexto(b.nome));
    })
    .slice(0, 15)
    .map(function (pessoa) {
      return { id_pessoa: pessoa.id_pessoa, nome: pessoa.nome };
    });
}

/** Pessoa com nome equivalente, ou null. Compara normalizado. */
function acharPessoaPeloNome_(nome) {
  var alvo = normalizarTexto(nome);
  var iguais = lerPessoas().filter(function (pessoa) {
    return normalizarTexto(pessoa.nome) === alvo;
  });
  return iguais.length ? iguais[0] : null;
}

/** Pessoa pelo id, ou null. Uso interno — devolve a linha inteira. */
function lerPessoa_(idPessoa) {
  var alvo = Number(idPessoa);
  var achadas = lerPessoas().filter(function (pessoa) {
    return Number(pessoa.id_pessoa) === alvo;
  });
  return achadas.length ? achadas[0] : null;
}
