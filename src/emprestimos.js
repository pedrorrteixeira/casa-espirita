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

/** O que vai em `quem_registrou` e no Log quando a pessoa pega pela estante. */
var QUEM_AUTOATENDIMENTO = 'autoatendimento';

/**
 * Empresta um exemplar a uma pessoa, pelo balcão.
 *
 * As regras moram em `emprestar_`, que a estante também usa: são as mesmas
 * nos dois caminhos, só muda quem registra.
 */
function registrarEmprestimo(sessao, tombo, idPessoa, observacao) {
  var quemRegistrou = exigir_(sessao, 'emprestar').nome;

  var alvo = Number(tombo);
  if (!isFinite(alvo)) throw new Error('Informe o número do tombo.');

  var pessoaId = Number(idPessoa);
  if (!isFinite(pessoaId)) throw new Error('Informe quem está levando o livro.');

  var quem = limparCampo_(quemRegistrou);
  if (!quem) throw new Error('Informe quem está registrando o empréstimo.');

  // Sem limite no balcão: quem decide é o atendente (regra 4).
  var feito = emprestar_(alvo, pessoaId, quem, observacao, null);
  enviarReciboDeEmprestimo_(feito);

  return {
    id_emprestimo: feito.registro.id_emprestimo,
    tombo: alvo,
    nome: feito.pessoa.nome,
    data_prevista: formatarData_(feito.registro.data_prevista)
  };
}

/**
 * A pessoa pega o livro sozinha, pela tela da estante (QR). Pública.
 *
 * Sem sessão, por decisão do Weldson: a pessoa se identifica pelo e-mail ou
 * telefone do cadastro, como em "Meus livros". Em troca, e de propósito:
 *
 *  - há um teto de livros em mãos (`limite_autoatendimento`, no Config);
 *  - vai um aviso por e-mail — é o que denuncia quem registrar em nome de
 *    outro;
 *  - a resposta NÃO traz o nome: digitar um telefone não pode revelar de quem
 *    ele é;
 *  - contato não achado, inativo ou repetido em dois cadastros dão a MESMA
 *    mensagem, para a tela não dizer qual dos três é.
 *
 * Os riscos que ficam de pé estão na ESPECIFICACAO, seção 6.
 */
function pegarLivro(tombo, contato) {
  var alvo = Number(limparCampo_(tombo));
  if (!limparCampo_(tombo) || !isFinite(alvo)) throw new Error('Digite o número do tombo.');

  // Zero desliga a estante sem mexer em código: é o jeito de a casa suspender
  // o autoatendimento se um dia ele der problema.
  var limite = lerConfigNumero('limite_autoatendimento', 1);
  if (limite <= 0) {
    throw new Error('O empréstimo pela estante está desligado. Procure o balcão.');
  }

  var pessoa = acharQuemPega(lerPessoas(), contato);
  if (!pessoa) {
    throw new Error(
      'Não consegui registrar com esse e-mail ou telefone. Confira o que ' +
      'digitou, ou procure o balcão.'
    );
  }

  var feito = emprestar_(alvo, Number(pessoa.id_pessoa), QUEM_AUTOATENDIMENTO, '', limite);
  var avisado = enviarReciboDeEmprestimo_(feito);
  var titulo = lerTitulo(feito.exemplar.id_titulo);

  return {
    titulo: titulo ? nomeDaObra(titulo) : '',
    data_prevista: formatarData_(feito.registro.data_prevista),
    avisado_por_email: avisado
  };
}

/**
 * O livro que a pessoa tem na mão, para a tela da estante. Pública, só lê.
 *
 * Diz se pode pegar e, se não pode, por quê — mas nunca com quem o livro
 * está: a tela abre sem login, e o tombo de um livro emprestado não pode
 * virar "quem está lendo o quê".
 */
function verLivroParaPegar(tombo) {
  var alvo = Number(limparCampo_(tombo));
  if (!limparCampo_(tombo) || !isFinite(alvo)) {
    return { pode_pegar: false, aviso: 'Digite o número do tombo.' };
  }

  var exemplar = acharExemplar_(alvo);
  if (!exemplar) {
    return {
      pode_pegar: false,
      aviso: 'Não achei esse tombo. Confira o número carimbado na última contracapa.'
    };
  }

  var situacao = calcularSituacao(exemplar, lerEmprestimos());
  var titulo = lerTitulo(exemplar.id_titulo);
  var avisos = {};
  avisos[SITUACAO_EMPRESTADO] = 'Este exemplar consta como emprestado. Se ele ' +
    'está na sua mão, leve ao balcão para acertar.';
  avisos[SITUACAO_SO_NA_CASA] = 'Este livro é só para ler na casa: pode ler ' +
    'aqui, mas ele não sai.';
  avisos[SITUACAO_BAIXADO] = 'Este exemplar não está mais no acervo. Leve ao balcão.';

  return {
    tombo: alvo,
    titulo: titulo ? nomeDaObra(titulo) : '(título não encontrado)',
    autoria: titulo ? montarAutoria(titulo) : '',
    edicao: descreverEdicao(exemplar),
    pode_pegar: situacao === SITUACAO_DISPONIVEL,
    aviso: avisos[situacao] || ''
  };
}

/**
 * O empréstimo em si, para o balcão e para a estante.
 *
 * Regras 1 e 2: verifica e grava dentro da mesma trava. Regra 3: a data
 * prevista sai do prazo do Config, calculada uma vez e gravada como valor.
 * Regra 5: pessoa inativa não leva.
 *
 * `limite` é o teto de livros em mãos. Só a estante passa; o balcão passa
 * null. A contagem fica DENTRO da trava: contada fora, duas abas abertas no
 * celular pegariam dois livros com limite 1.
 *
 * Devolve registro, pessoa e exemplar inteiros. Quem chama escolhe o que
 * mostra — e a estante não mostra o nome.
 */
function emprestar_(alvo, pessoaId, quem, observacao, limite) {
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

    if (limite !== null && limite !== undefined) {
      var emMaos = contarEmprestimosAbertos(emprestimos, pessoaId);
      if (emMaos >= limite) {
        throw new Error(
          'Você já está com ' + (emMaos === 1 ? '1 livro' : emMaos + ' livros') +
          ' da biblioteca. Para levar outro, devolva o anterior, ou procure ' +
          'alguém da casa no balcão.'
        );
      }
    }

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
    // A tela já esconde o botão, mas `google.script.run` é chamável do console.
    if (situacao === SITUACAO_SO_NA_CASA) {
      throw new Error(
        'O exemplar ' + alvo + ' é só para ler na casa e não pode ser emprestado.'
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

    return { registro: registro, pessoa: pessoa, exemplar: exemplar };
  });
}

/**
 * Avisa por e-mail que a pessoa pegou um livro — em todo empréstimo, balcão e
 * estante, por decisão do Weldson.
 *
 * Na estante é o que denuncia quem registrar em nome de outro; no balcão é a
 * data de devolução por escrito. Chamado DEPOIS da trava: e-mail leva um
 * segundo, e a trava segura o sistema inteiro enquanto isso.
 *
 * Falhar aqui não desfaz nada nem estoura: o empréstimo já está gravado, e
 * estourar faria o balcão dizer "não consegui" de um livro que já saiu. Pessoa
 * sem e-mail simplesmente não recebe. Devolve se o aviso foi.
 */
function enviarReciboDeEmprestimo_(feito) {
  var email = limparCampo_(feito.pessoa.email);
  if (!email) return false;

  try {
    var titulo = lerTitulo(feito.exemplar.id_titulo);
    var livro = titulo ? '"' + nomeDaObra(titulo) + '"' : 'o livro';
    var url = limparCampo_(lerConfig('url_sistema', ''));

    return enviarEmail_(
      email,
      'Você pegou um livro da biblioteca',
      [
        'Olá, ' + feito.pessoa.nome + '.',
        '',
        'Você pegou ' + livro + ' (tombo ' + feito.registro.tombo + ') em ' +
          formatarData_(feito.registro.data_emprestimo) + '.',
        'Devolva até ' + formatarData_(feito.registro.data_prevista) + '.',
        '',
        url
          ? 'Para ver seus prazos, abra ' + url + ' e toque em "Meus livros".'
          : 'Para ver seus prazos, abra o sistema da biblioteca e toque em "Meus livros".',
        '',
        'Se não foi você que pegou este livro, avise no balcão da biblioteca.',
        '',
        '—',
        'Sistema da biblioteca. Não responda a este e-mail.'
      ].join('\n'),
      'aviso de empréstimo'
    );
  } catch (erro) {
    // Sem a mensagem do erro: a do MailApp costuma trazer o endereço, e o Log
    // não recebe dado pessoal.
    registrarLog_('sistema', 'erro', 'email', feito.registro.tombo,
      'aviso de empréstimo não enviado');
    return false;
  }
}

/**
 * Registra a devolução de um exemplar.
 *
 * Regra 6: preenche `data_devolucao` e nada mais. Não apaga a linha, não mexe
 * em outra coluna — o histórico de circulação sai de graça disso (D8).
 *
 * Regra 7: devolver exemplar sem empréstimo aberto é erro, não cria linha.
 */
function registrarDevolucao(sessao, tombo) {
  var quemRegistrou = exigir_(sessao, 'devolver').nome;

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
function renovar(sessao, tombo) {
  var quemRegistrou = exigir_(sessao, 'renovar').nome;

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
function listarEmprestados(sessao, somenteAtrasados) {
  exigir_(sessao, 'ver_atrasos');
  return emprestadosAgora_(somenteAtrasados);
}

/**
 * A mesma lista, sem guarda. Uso interno.
 *
 * Existe porque o gatilho de atraso precisa dela e não tem sessão — ninguém
 * está logado às 5h da manhã. Separar a leitura da permissão é o que evita o
 * alternativa ruim: dar ao gatilho uma sessão eterna, que viraria uma chave
 * mestra guardada em algum lugar.
 *
 * Sufixo `_`: o Apps Script não expõe função com underscore final a
 * `google.script.run`, então isto não é alcançável do navegador.
 */
function emprestadosAgora_(somenteAtrasados) {
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
        titulo: titulo ? nomeDaObra(titulo) : '(título não encontrado)',
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
 *
 * É também o que carrega a tela "Alterar exemplar", por isso traz os campos
 * que ela edita (`editora`, `ano`, `numero_edicao`, `estado`, `so_na_casa`,
 * `observacao`) além do resumo para leitura. A edição vem duas vezes:
 * `edicao` é a frase para ler ("FEB · 1978 · 3ª ed."), `numero_edicao` é o
 * que está gravado, para o campo da tela.
 */
function verExemplar(sessao, tombo) {
  exigir_(sessao, 'ver_com_quem');

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
    titulo: titulo ? nomeDaObra(titulo) : '(título não encontrado)',
    autoria: titulo ? montarAutoria(titulo) : '',
    // "FEB · 2022 · 34ª ed.", e não "FEB · 2022 · 34": o número solto não
    // diz que é a edição. A mesma redação do relatório do acervo.
    edicao: descreverEdicao(exemplar),
    editora: limparCampo_(exemplar.editora),
    ano: limparCampo_(exemplar.ano),
    numero_edicao: limparCampo_(exemplar.edicao),
    estado: exemplar.estado,
    so_na_casa: soParaLerNaCasa(exemplar),
    observacao: limparCampo_(exemplar.observacao),
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

/**
 * Os empréstimos de um frequentador, achado por e-mail ou telefone.
 *
 * NÃO exige sessão, por decisão do Weldson: parte dos frequentadores não tem
 * e-mail, e link mágico deixaria essa gente de fora. Em troca:
 *
 *  - devolve SÓ livro e prazo, nada de nome, telefone ou e-mail;
 *  - não diz se o contato existe. Contato certo sem empréstimo e contato
 *    inexistente respondem igual, para a tela não virar lista telefônica.
 *
 * A consequência que fica de pé, e que é decisão consciente: quem souber o
 * telefone de alguém vê o que essa pessoa está lendo. Numa casa espírita isso
 * não é neutro — escolha de livro revela luto, doença, dependência. Se um dia
 * incomodar, o link mágico dos voluntários serve aqui sem mudar mais nada.
 */
function meusEmprestimos(contato) {
  var vazio = { emprestimos: [], recado: 'Nenhum empréstimo em aberto para esse contato.' };

  if (!normalizarContato(contato)) return vazio;

  var eu = null;
  lerPessoas().forEach(function (pessoa) {
    if (eu) return;
    if (mesmoContato(contato, pessoa.email) || mesmoContato(contato, pessoa.telefone)) {
      eu = pessoa;
    }
  });
  if (!eu) return vazio;

  var hoje = new Date();
  var porTombo = {};
  lerExemplares().forEach(function (exemplar) {
    porTombo[String(exemplar.tombo)] = exemplar;
  });

  var titulos = {};
  lerTitulos().forEach(function (titulo) {
    titulos[String(titulo.id_titulo)] = titulo;
  });

  var meus = lerEmprestimos()
    .filter(function (emprestimo) {
      return Number(emprestimo.id_pessoa) === Number(eu.id_pessoa) &&
        ehVazio_(emprestimo.data_devolucao);
    })
    .map(function (emprestimo) {
      var exemplar = porTombo[String(emprestimo.tombo)];
      var titulo = exemplar ? titulos[String(exemplar.id_titulo)] : null;
      return {
        tombo: emprestimo.tombo,
        titulo: titulo ? nomeDaObra(titulo) : '(título não encontrado)',
        autoria: titulo ? montarAutoria(titulo) : '',
        data_prevista: formatarData_(emprestimo.data_prevista),
        dias_de_atraso: diasDeAtraso(emprestimo, hoje)
      };
    })
    .sort(function (a, b) { return b.dias_de_atraso - a.dias_de_atraso; });

  if (!meus.length) return vazio;
  return { emprestimos: meus, recado: '' };
}
