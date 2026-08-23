/**
 * emprestimos.js — o que substitui o caderno.
 *
 * Toda função aqui grava, e portanto: valida dentro de `LockService`, registra
 * na aba `Log`, e nunca apaga linha.
 *
 * A REGRA QUE GOVERNA ESTE ARQUIVO (regra 2)
 * ------------------------------------------
 * Verificar disponibilidade e gravar acontecem dentro do MESMO lock. Checar
 * antes e gravar depois, sem trava, é condição de corrida: dois atendentes
 * emprestando o mesmo tombo ao mesmo tempo passariam os dois na verificação.
 *
 * E a verificação lê a aba `Emprestimos`, não a coluna derivada `situacao`:
 * aquela fórmula é para quem olha a planilha, e pode estar desatualizada no
 * instante da gravação.
 */

/**
 * Empresta um exemplar a uma pessoa.
 *
 * Regras 1, 2, 3 e 5: exemplar ativo, sem empréstimo aberto, pessoa ativa, e
 * data prevista calculada a partir do prazo da aba `Config`.
 */
function registrarEmprestimo(tombo, idPessoa, quemRegistrou, observacao) {
  var alvo = Number(tombo);
  if (!isFinite(alvo)) throw new Error('Informe o número do tombo.');

  var pessoaId = Number(idPessoa);
  if (!isFinite(pessoaId)) throw new Error('Informe quem está levando o livro.');

  var quem = limparCampo_(quemRegistrou);
  if (!quem) throw new Error('Informe quem está registrando o empréstimo.');

  return comTrava_(function () {
    var exemplar = acharExemplar_(alvo);
    if (!exemplar) throw new Error('Tombo ' + alvo + ' não existe.');

    var pessoa = lerPessoa_(pessoaId);
    if (!pessoa) throw new Error('Pessoa não encontrada.');

    // Regra 5. A mensagem não diz o motivo da inatividade — pode ser desde
    // mudança de cidade até pendência, e isso não é assunto do balcão.
    if (String(pessoa.ativo).trim() !== 'SIM') {
      throw new Error(
        pessoa.nome + ' está com o cadastro inativo. Fale com a bibliotecária.'
      );
    }

    // Regras 1 e 2: a checagem e a gravação, no mesmo lock.
    var emprestimos = lerEmprestimos();
    var situacao = calcularSituacao(exemplar, emprestimos);

    if (situacao === SITUACAO_BAIXADO) {
      throw new Error(
        'O exemplar ' + alvo + ' está baixado do acervo e não pode ser emprestado.'
      );
    }
    if (situacao === SITUACAO_EMPRESTADO) {
      var aberto = acharEmprestimoAberto(emprestimos, alvo);
      throw new Error(
        'O exemplar ' + alvo + ' já está emprestado, com devolução prevista ' +
        'para ' + formatarData_(aberto.data_prevista) + '.'
      );
    }

    var hoje = new Date();
    var registro = {
      id_emprestimo: proximoId_(ABA_EMPRESTIMOS, 'id_emprestimo'),
      tombo: alvo,
      id_pessoa: pessoaId,
      data_emprestimo: hoje,
      data_prevista: calcularDataPrevista(hoje, lerConfigNumero('prazo_devolucao_dias', 21)),
      data_devolucao: '',
      quem_registrou: quem,
      renovacoes: 0,
      observacao: limparCampo_(observacao)
    };

    escreverLinha_(ABA_EMPRESTIMOS, registro);
    registrarLog_(quem, 'emprestar', 'exemplar', alvo, 'pessoa ' + pessoaId);

    return {
      id_emprestimo: registro.id_emprestimo,
      tombo: alvo,
      nome: pessoa.nome,
      data_prevista: formatarData_(registro.data_prevista)
    };
  });
}

/**
 * Registra a devolução de um exemplar.
 *
 * Regra 6: preenche `data_devolucao` e nada mais. Não apaga a linha, não mexe
 * em outra coluna — o histórico de circulação sai de graça disso (D8).
 *
 * Regra 7: devolver exemplar sem empréstimo aberto é erro, não cria linha.
 */
function registrarDevolucao(tombo, quemRegistrou) {
  var alvo = Number(tombo);
  if (!isFinite(alvo)) throw new Error('Informe o número do tombo.');

  var quem = limparCampo_(quemRegistrou);
  if (!quem) throw new Error('Informe quem está registrando a devolução.');

  return comTrava_(function () {
    var exemplar = acharExemplar_(alvo);
    if (!exemplar) throw new Error('Tombo ' + alvo + ' não existe.');

    var aberto = acharEmprestimoAberto(lerEmprestimos(), alvo);
    if (!aberto) {
      // Regra 7. Acontece de verdade: alguém devolve na estante e outro
      // registra depois. Dizer isso é mais útil do que "erro".
      throw new Error(
        'O exemplar ' + alvo + ' não está emprestado. Ou já foi devolvido, ou ' +
        'o empréstimo não chegou a ser registrado.'
      );
    }

    var hoje = new Date();
    atualizarCelulas_(ABA_EMPRESTIMOS, aberto._linha, { data_devolucao: hoje });

    var atraso = diasDeAtraso(aberto, hoje);
    registrarLog_(quem, 'devolver', 'exemplar', alvo,
      atraso > 0 ? atraso + ' dia(s) de atraso' : 'em dia');

    var pessoa = lerPessoa_(aberto.id_pessoa);
    return {
      tombo: alvo,
      nome: pessoa ? pessoa.nome : '',
      dias_de_atraso: atraso
    };
  });
}

/**
 * Renova um empréstimo aberto: empurra a data prevista e conta a renovação.
 *
 * Regra 4: sem limite rígido por enquanto. Se houver fila para o título, quem
 * decide é o atendente, olhando a tela — não o código.
 */
function renovar(tombo, quemRegistrou) {
  var alvo = Number(tombo);
  if (!isFinite(alvo)) throw new Error('Informe o número do tombo.');

  var quem = limparCampo_(quemRegistrou);
  if (!quem) throw new Error('Informe quem está registrando a renovação.');

  return comTrava_(function () {
    var aberto = acharEmprestimoAberto(lerEmprestimos(), alvo);
    if (!aberto) {
      throw new Error('O exemplar ' + alvo + ' não está emprestado.');
    }

    // Conta a partir de hoje, não da data prevista antiga: renovar um livro
    // três semanas atrasado daria um prazo novo já vencido.
    var nova = calcularDataPrevista(new Date(), lerConfigNumero('prazo_devolucao_dias', 21));
    var renovacoes = Number(aberto.renovacoes);
    if (!isFinite(renovacoes)) renovacoes = 0;

    atualizarCelulas_(ABA_EMPRESTIMOS, aberto._linha, {
      data_prevista: nova,
      renovacoes: renovacoes + 1
    });

    registrarLog_(quem, 'renovar', 'exemplar', alvo, 'renovação ' + (renovacoes + 1));

    return {
      tombo: alvo,
      data_prevista: formatarData_(nova),
      renovacoes: renovacoes + 1
    };
  });
}

// --- Consultas das telas -----------------------------------------------------

/**
 * O que está com quem, para a tela do atendente.
 *
 * Esta É uma tela interna e PODE mostrar o nome — é a diferença entre a busca
 * pública e o balcão (seção 6). Mas segue sendo montada campo a campo.
 */
function listarEmprestados(somenteAtrasados) {
  var hoje = new Date();
  var pessoas = {};
  lerPessoas().forEach(function (pessoa) {
    pessoas[String(pessoa.id_pessoa)] = pessoa.nome;
  });

  var titulos = {};
  lerTitulos().forEach(function (titulo) {
    titulos[String(titulo.id_titulo)] = titulo;
  });

  var tituloDoTombo = {};
  lerExemplares().forEach(function (exemplar) {
    tituloDoTombo[String(exemplar.tombo)] = titulos[String(exemplar.id_titulo)];
  });

  return lerEmprestimos()
    .filter(function (emprestimo) {
      if (!ehVazio_(emprestimo.data_devolucao)) return false;
      return somenteAtrasados ? estaAtrasado(emprestimo, hoje) : true;
    })
    .map(function (emprestimo) {
      var titulo = tituloDoTombo[String(emprestimo.tombo)];
      return {
        tombo: emprestimo.tombo,
        titulo: titulo ? titulo.titulo : '(título não encontrado)',
        autoria: titulo ? montarAutoria(titulo) : '',
        nome: pessoas[String(emprestimo.id_pessoa)] || '(pessoa não encontrada)',
        data_prevista: formatarData_(emprestimo.data_prevista),
        dias_de_atraso: diasDeAtraso(emprestimo, hoje),
        renovacoes: emprestimo.renovacoes
      };
    })
    .sort(function (a, b) {
      return b.dias_de_atraso - a.dias_de_atraso;   // o mais atrasado primeiro
    });
}

/**
 * Ficha de um tombo para a tela de empréstimo, depois de digitado o número.
 * Diz o que o atendente precisa saber antes de confirmar.
 */
function verExemplar(tombo) {
  var alvo = Number(tombo);
  if (!isFinite(alvo)) throw new Error('Tombo inválido.');

  var exemplar = acharExemplar_(alvo);
  if (!exemplar) throw new Error('Tombo ' + alvo + ' não existe.');

  var emprestimos = lerEmprestimos();
  var situacao = calcularSituacao(exemplar, emprestimos);
  var aberto = acharEmprestimoAberto(emprestimos, alvo);
  var titulo = lerTitulo(exemplar.id_titulo);

  return {
    tombo: alvo,
    titulo: titulo ? titulo.titulo : '(título não encontrado)',
    autoria: titulo ? montarAutoria(titulo) : '',
    edicao: [exemplar.editora, exemplar.ano, exemplar.edicao]
      .filter(function (parte) { return limparCampo_(parte) !== ''; })
      .join(' · '),
    estado: exemplar.estado,
    situacao: situacao,
    com_quem: aberto ? (lerPessoa_(aberto.id_pessoa) || {}).nome || '' : '',
    data_prevista: aberto ? formatarData_(aberto.data_prevista) : '',
    dias_de_atraso: aberto ? diasDeAtraso(aberto, new Date()) : 0
  };
}

function acharExemplar_(tombo) {
  var alvo = Number(tombo);
  var achados = lerExemplares().filter(function (exemplar) {
    return Number(exemplar.tombo) === alvo;
  });
  return achados.length ? achados[0] : null;
}
