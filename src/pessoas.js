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

/** Quantos nomes a busca devolve por vez. O resto é contado, não escondido. */
var LIMITE_DE_NOMES = 15;

/**
 * Cadastra uma pessoa. Só o nome é obrigatório — a casa não vai negar livro a
 * quem não quis dar telefone.
 */
function criarPessoa(sessao, dados) {
  var quemRegistrou = exigir_(sessao, 'cadastrar_pessoa').nome;

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

    // Conferido no SERVIDOR, e não só pelo type="email" da tela: o navegador
    // é conveniência, e `google.script.run` é chamável sem passar por ela.
    var email = limparCampo_(dados.email);
    if (email && !ehEmailValido(email)) {
      throw new Error('"' + email + '" não parece um e-mail. Confira, ou deixe em branco.');
    }

    var registro = {
      id_pessoa: proximoId_(ABA_PESSOAS, 'id_pessoa'),
      nome: nome,
      telefone: limparCampo_(dados.telefone),
      email: email,
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
function buscarPessoas(sessao, termo) {
  exigir_(sessao, 'emprestar');

  var alvo = normalizarTexto(termo);
  if (alvo.length < 2) return { pessoas: [], sobraram: 0 };

  var achadas = lerPessoas()
    .filter(function (pessoa) {
      return String(pessoa.ativo).trim() === 'SIM' &&
        normalizarTexto(pessoa.nome).indexOf(alvo) !== -1;
    })
    .sort(function (a, b) {
      return normalizarTexto(a.nome).localeCompare(normalizarTexto(b.nome));
    });

  // Diz quantas ficaram de fora, em vez de cortar calado. Numa casa com cinco
  // "Maria", o atendente precisa saber que a lista está incompleta — senão
  // empresta para a Maria errada achando que era a única.
  return {
    pessoas: achadas.slice(0, LIMITE_DE_NOMES).map(function (pessoa) {
      return { id_pessoa: pessoa.id_pessoa, nome: pessoa.nome };
    }),
    sobraram: Math.max(0, achadas.length - LIMITE_DE_NOMES)
  };
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

/**
 * Ficha de uma pessoa para a tela de edição.
 *
 * NÃO devolve telefone nem e-mail — só se estão preenchidos. O sistema mora
 * numa URL de acesso anônimo, e devolver o contato aqui publicaria a agenda
 * dos frequentadores a quem tiver o link, bastando chamar isto com id 1, 2,
 * 3… É a restrição 4 do CLAUDE.md.
 *
 * Quem precisa LER um telefone abre a planilha. Pela tela dá para trocar, não
 * para consultar.
 */
function verPessoa(sessao, idPessoa) {
  exigir_(sessao, 'editar_pessoa');

  var pessoa = lerPessoa_(idPessoa);
  if (!pessoa) throw new Error('Pessoa não encontrada.');

  return {
    id_pessoa: pessoa.id_pessoa,
    nome: pessoa.nome,
    tem_telefone: limparCampo_(pessoa.telefone) !== '',
    tem_email: limparCampo_(pessoa.email) !== '',
    frequentador: String(pessoa.frequentador).trim() === 'SIM',
    palestrante: String(pessoa.palestrante).trim() === 'SIM',
    ativo: String(pessoa.ativo).trim() === 'SIM',
    observacao: pessoa.observacao
  };
}

/**
 * Altera o cadastro de uma pessoa.
 *
 * Telefone e e-mail só são gravados quando vêm preenchidos: a tela não sabe o
 * valor atual, então string vazia significa "não mexer", e não "apagar". Sem
 * isso, salvar qualquer alteração de nome apagaria o contato de quem tinha.
 *
 * Para apagar de fato, existe `limpar_telefone` / `limpar_email` — explícito,
 * porque apagar contato tem que ser um ato deliberado.
 */
function atualizarPessoa(sessao, idPessoa, mudancas) {
  var quemRegistrou = exigir_(sessao, 'editar_pessoa').nome;

  return comTrava_(function () {
    var pessoa = lerPessoa_(idPessoa);
    if (!pessoa) throw new Error('Pessoa não encontrada.');

    var dados = mudancas || {};
    var aplicar = {};

    if (dados.nome !== undefined) {
      var nome = limparCampo_(dados.nome);
      if (!nome) throw new Error('O nome não pode ficar vazio.');

      // Renomear para o nome de outra pessoa criaria duas fichas idênticas.
      var outra = acharPessoaPeloNome_(nome);
      if (outra && Number(outra.id_pessoa) !== Number(idPessoa)) {
        throw new Error(
          'Já existe outra pessoa chamada "' + outra.nome + '" (nº ' +
          outra.id_pessoa + ').'
        );
      }
      aplicar.nome = nome;
    }

    // Vazio é "não mexer". Quem não vê o valor atual não pode apagá-lo por
    // omissão — foi a decisão de não expor contato na tela que criou isso.
    var telefone = limparCampo_(dados.telefone);
    if (telefone) aplicar.telefone = telefone;
    if (dados.limpar_telefone) aplicar.telefone = '';

    var email = limparCampo_(dados.email);
    if (email && !ehEmailValido(email)) {
      throw new Error('"' + email + '" não parece um e-mail. Confira, ou deixe em branco.');
    }
    if (email) aplicar.email = email;
    if (dados.limpar_email) aplicar.email = '';

    if (dados.frequentador !== undefined) {
      aplicar.frequentador = dados.frequentador ? 'SIM' : 'NÃO';
    }
    if (dados.palestrante !== undefined) {
      aplicar.palestrante = dados.palestrante ? 'SIM' : 'NÃO';
    }
    if (dados.ativo !== undefined) {
      aplicar.ativo = dados.ativo ? 'SIM' : 'NÃO';
    }
    if (dados.observacao !== undefined) {
      aplicar.observacao = limparCampo_(dados.observacao);
    }

    if (Object.keys(aplicar).length === 0) return Number(idPessoa);

    atualizarCelulas_(ABA_PESSOAS, pessoa._linha, aplicar);

    // Quais campos mudaram, nunca os valores: o Log é visível e fica retido.
    registrarLog_(quemRegistrou, 'atualizar', 'pessoa', idPessoa,
      Object.keys(aplicar).join(', '));
    return Number(idPessoa);
  });
}

/**
 * Busca pessoas para a tela de edição — inclusive as inativas.
 *
 * `buscarPessoas` filtra os inativos porque serve ao empréstimo, e pessoa
 * inativa não pega livro (regra 5). Mas justamente quem está inativo é quem
 * alguém vai querer reativar.
 */
function buscarPessoasParaEditar(sessao, termo) {
  exigir_(sessao, 'editar_pessoa');

  var alvo = normalizarTexto(termo);
  if (alvo.length < 2) return [];

  return lerPessoas()
    .filter(function (pessoa) {
      return normalizarTexto(pessoa.nome).indexOf(alvo) !== -1;
    })
    .sort(function (a, b) {
      return normalizarTexto(a.nome).localeCompare(normalizarTexto(b.nome));
    })
    .slice(0, LIMITE_DE_NOMES)
    .map(function (pessoa) {
      return {
        id_pessoa: pessoa.id_pessoa,
        nome: pessoa.nome,
        ativo: String(pessoa.ativo).trim() === 'SIM'
      };
    });
}
