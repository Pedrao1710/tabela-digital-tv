# Revisão de acesso de 22 de novembro de 2026

O painel, as consultas de preços e as imagens exigem sessão no servidor. Cada sessão fica vinculada à conta e à loja ativa. O endereço da TV identifica uma tela da loja e precisa ser acompanhado de uma sessão válida. Operadores permanecem vinculados à própria loja.

O login de TV permite exibição. Alterações, importações e a administração requerem login pelo painel. As senhas são verificadas com scrypt e comparação de tempo constante. As sessões usam identificadores aleatórios, cookie HttpOnly e SameSite Strict. Configure a origem HTTPS para ativar o atributo Secure e o HSTS.

O primeiro cadastro exige acesso local direto e código de instalação gerado no diretório de dados. Novas contas criadas pelo provisionamento exigem senha de 10 a 128 caracteres. A troca de senha invalida as sessões da conta e emite outro identificador para a sessão atual.

As tentativas de login estão limitadas a 12 por endereço de conexão em 15 minutos. Atrás de proxy, o endereço considerado é o do proxy. A infraestrutura precisa aplicar limites por cliente e controlar as conexões antes do Node. Os cabeçalhos encaminhados pelo cliente nunca autorizam instalação inicial.

As sessões expiram em 14 dias contados do login, mesmo com uso contínuo. O servidor persiste apenas o hash SHA-256 do token em `sessions.json`, com escrita atômica e permissões restritas. O cookie contém o token aleatório original e dura as mesmas duas semanas. Reinícios preservam a sessão dentro desse prazo. A sessão também fica vinculada à impressão digital do hash da senha e deixa de valer quando a senha muda, inclusive se houver falha de gravação da lista de revogações.

Na TV, uma queda de rede preserva dados somente em memória por até 90 segundos após a última validação. O cache persistente de preços de versões anteriores é removido. Uma revogação ou expiração é percebida na próxima consulta, normalmente em até 30 segundos com rede disponível.

## Publicação e operação

As correções foram feitas e verificadas na cópia local do projeto. A publicação requer HTTPS com certificado aceito pelas TVs, origem configurada, dados com permissões restritas e a conferência da entrada em cada aparelho. A primeira configuração de uma instalação vazia em Docker deve ocorrer diretamente dentro do container ou ser provisionada localmente antes da exposição pelo proxy.

O guia Linux existente contém exemplos HTTP para checagem da rede. Use HTTPS para credenciais de produção. O transporte HTTP não oferece sigilo das senhas. As atualizações de sistema, Node, certificados e as restaurações de backup fazem parte da operação ao longo dos anos.

Os testes automatizados usam diretórios temporários e verificam sessão, isolamento de lojas, escopo da TV, revogação, origem de formulário, código de instalação, limite de tentativas e fluxo de importação. A revisão de TV cobriu o login nativo e o seletor, renderização Full HD (1920 × 1080), HD (1280 × 720), nomes longos, doze linhas e preços promocionais. As capturas estão em `.qa/tv-final-1080.jpg` e `.qa/tv-login-final.jpg`. A homologação nos modelos físicos de TV e em uma instalação HTTPS permanece necessária.

## Revisão de 23 de novembro de 2026

A apresentação foi corrigida usando as contas importadas, em vez da demonstração: foto em coluna vertical preenchida, logo proporcional, tipografia legível, última página sem área vazia e rodapé somente com a mensagem. Elementos técnicos são mantidos no diagnóstico opcional. O editor descreve os modos de carrossel e o recorte das imagens sem oferecer disposição inferior sem efeito.

A administração e o seletor agora consultam a validade da sessão a cada 30 segundos e ao voltar à aba, removendo os dados e diálogos quando o servidor confirma o vencimento. Respostas iniciadas antes de uma troca de loja são descartadas. Limites de senha também aparecem antes do envio do formulário.
