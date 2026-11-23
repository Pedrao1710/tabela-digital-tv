# Tabela Digital Arapongas

Reimplementação independente dos fluxos observados na Tabela Digital, com painel web e exibição pelo navegador da TV. O projeto roda com Node.js 22 ou posterior e usa arquivos locais para guardar os dados.

## Experimentar

Abra [Iniciar-demonstracao.cmd](Iniciar-demonstracao.cmd) no Windows. Ele inicia a demonstração em segundo plano e abre [o painel local](http://127.0.0.1:8088/) quando estiver pronto. Se já estiver rodando, reutiliza a mesma demonstração. Como alternativa, execute `node server.mjs --demo` nesta pasta e abra o painel local. A conta ilustrativa é `demo@arapongas.local`, senha `demo-arapongas-2026`. Escolha a TV do açougue e acompanhe a rotação. O modo demo usa dados ilustrativos e é restrito à própria máquina. Os perfis importados de Margarida e Santa Fé estão em `data` e são carregados ao iniciar sem `--demo`.

## Colocar em uso

Para hospedar em Linux com Docker, fonte de preços montada somente leitura, reinício automático e rotina de backup criptografado de duas versões, siga o [guia de instalação e operação Linux](deploy/linux/README.md). O guia distingue o backup do painel do backup de outros arquivos do servidor.

1. Execute `node server.mjs` e abra [o painel local](http://127.0.0.1:8088/). Em instalação vazia, leia o código gerado em `data/setup-code.txt` no próprio computador para cadastrar o primeiro responsável e a primeira loja. O código é consumido após o cadastro e a instalação inicial recusa conexões encaminhadas por proxy. Cadastre outras lojas e contas de operação conforme necessário.
2. Confirme a loja ativa. Em **Arquivo de Preços**, selecione seu `txitens.txt`, gere a prévia e confira a amostra, a contagem e os códigos que deixariam de aparecer. Salve para publicar. O histórico permite restaurar um catálogo anterior.
3. Em **Minhas Listas**, escolha os códigos e organize a ordem. Em **Minhas Telas**, associe as listas e copie a URL da TV. Para configurar cores, fontes, letreiro, componentes, imagens, layout e carrossel, use **Configurações**.
4. Em **Minhas Imagens**, envie JPG, PNG ou WebP e escolha as telas. Fotos de produto e fundos de slides também usam essas imagens. O painel aceita produtos manuais, com preço normal e promocional, como complemento ou substituição por código.
5. Hospede o projeto em um computador ou servidor que fique ligado na rede das TVs. Para acesso na rede, use um proxy HTTPS com certificado reconhecido pela TV e defina `TABELA_ORIGIN` para a origem HTTPS escolhida. O Node pode continuar restrito ao endereço local atrás do proxy. A URL copiada pelo painel usa a origem que o navegador abriu.

No PowerShell, configure o ambiente com `$env:TABELA_ORIGIN = 'https://painel.exemplo.interno'` antes de iniciar o servidor. Para um teste HTTP na LAN, após a instalação local, use `$env:TABELA_HOST = '0.0.0.0'` e abra `http://IP-DO-SERVIDOR:8088` na TV. Reserve HTTP para checagem em rede controlada, pois o recurso de manter a tela ativa depende de contexto seguro e logins devem usar HTTPS.

O servidor atende em 127.0.0.1:8088 por padrão. `TABELA_HOST`, `TABELA_PORT`, `TABELA_ORIGIN` e `TABELA_DATA` permitem ajustar a instalação. A pasta `data` guarda o catálogo, parâmetros, contas, telas, histórico e imagens. Faça backup dela com o servidor parado. Rode uma instância por pasta de dados.

Quando existir `auto-import.json` na pasta de dados, o servidor acompanha automaticamente os arquivos Toledo indicados. `TABELA_AUTO_IMPORT_CONFIG` permite apontar para outro arquivo de configuração. As associações antigas por nome são convertidas para identificadores de loja ao iniciar; nomes desconhecidos ou duplicados impedem a inicialização para evitar importar na loja errada. Renomear uma loja não altera seu vínculo. O painel e a TV indicam falhas de leitura, mantendo a última tabela válida. A espera por duas leituras estáveis e a proteção contra redução acima de 50% reduzem o risco de importação incompleta, mas um arquivo parcialmente gravado que permaneça estável e contenha mais da metade dos produtos pode ser aceito.

Para exibir a temperatura ao lado da cidade, configure `TABELA_OPENWEATHER_KEY` no servidor e informe a cidade da loja. A consulta usa o serviço [OpenWeather](https://openweathermap.org/api/current) e envia somente a localização necessária. A chave fica no servidor e a TV continua mostrando preços se a consulta falhar.

## TXT Toledo

Os padrões são posições iniciadas em zero. Código `5,6`, nome `20,50` e preço `12,5`. O arquivo usa preço em centavos. O trecho `06990` significa R$ 69,90. As posições e a codificação são editáveis, inclusive um campo opcional para o preço promocional. O leitor valida o arquivo inteiro antes da troca de catálogo. As listas preservam os códigos cadastrados e voltam a exibir o item se ele reaparecer no catálogo.

A correspondência entre pasta Toledo e loja deve ser configurada pela equipe. A amostra real foi conferida em leitura local, com 1.722 registros em `001` e 1.622 em `002`. A demonstração é independente dos arquivos da rede.

## Teste da TV

Na exibição, as setas esquerda e direita mudam a página, Enter pausa ou retoma os avisos e Voltar/Escape retorna ao seletor de telas. No login e no seletor, as setas para cima e para baixo percorrem os campos e os botões quando o navegador permite capturar essas teclas.

A apresentação usa letras largas e fortes na tabela e preserva as cores de cada tela. O tamanho das letras se adapta às linhas e ao espaço da TV. Em Configurações, deixe os tamanhos em branco para usar o ajuste automático. Tamanhos manuais usam 1920 pixels de largura como referência e continuam limitados ao espaço disponível. O padrão para novas telas é de oito linhas; a última página ocupa toda a altura mesmo quando contém menos produtos.

A foto da loja preenche sempre uma coluna vertical com recorte proporcional, sem deformação nem faixas vazias. As posições horizontal e vertical escolhem qual região da foto aparece; largura e altura percentuais afetam somente as fotos dos produtos nos carrosséis. O antigo layout inferior é apresentado em coluna vertical. O rodapé mostra somente a mensagem em rolagem. Enter pausa ou retoma a mensagem. Status da conexão, contador e controle de pausa ficam no diagnóstico opcional, fora da apresentação normal. O logotipo preserva a proporção da arte original, incluindo no login e na administração. Os créditos dos recursos estão em `public/ASSETS.md`.

A TV atualiza os preços sem reiniciar o navegador. O endereço da tela exige uma sessão autenticada da mesma loja, incluindo as consultas de preços e as imagens. Ao perder a sessão, a TV solicita novo login. A sessão dura 14 dias contados do login, sobrevive ao reinício do servidor e exige nova entrada ao vencer. Consultas durante o uso preservam a data original de vencimento. Sair ou trocar a senha invalida o acesso antes desse prazo.

Durante uma queda curta de conexão, a tabela permanece em memória por até 90 segundos desde a última consulta válida. Após esse prazo a TV oculta os preços até conseguir validar o acesso novamente. O navegador remove o cache persistente de versões antigas. Confira o acesso da TV ao completar as duas semanas.

No controle remoto, digite apenas o endereço do servidor seguido de `/tv`. Entre com a conta da loja e escolha a tela. Esse seletor também funciona em navegadores sem JavaScript moderno. O login feito em `/tv` permite somente exibição, sem liberar alterações administrativas.

Acrescente `?diagnostico=1` ao link da TV para ver conexão, última consulta, contexto seguro e estado do Wake Lock. Em navegadores com suporte, o painel solicita a manutenção da tela ativa e renova a solicitação após voltar ao primeiro plano. A suspensão do aparelho, os temporizadores e as políticas de energia continuam sob controle da TV.

Para homologar, deixe o painel aberto por um turno inteiro em uma Samsung representativa, sem tocar no controle. Anote quando houver escurecimento, proteção de tela, desligamento ou falha de rotação. Publique um TXT de teste, confira a troca sem intervenção e interrompa temporariamente a rede para confirmar a recuperação. Repita para outros navegadores da frota. A interface de TV usa JavaScript compatível com ES5, sem dependências externas.

## Verificação e referência

Execute `node --test`. Os testes cobrem leitura Toledo, prévia sem alteração, rejeição de arquivo trocado, importação, restauração, publicação na TV, imagens, isolamento entre lojas, persistência e revogação de URL.

Para desenvolver, execute `npm ci` e use `npm run check` para conferir sintaxe, testes e formatação em uma chamada. `npm run format` aplica o padrão de dois espaços e aspas simples. As ferramentas não entram nas pastas de dados. A separação dos módulos e as regras de manutenção estão em [ARQUITETURA.md](ARQUITETURA.md).

A análise do REA observou a página de importação, os campos fixos, as listas, as associações e o formulário de aparência por tela. O [script de produtos da referência](https://tabeladigital.com/js/tela-produtos.js) mostra consulta dos preços a cada dez minutos. O [script geral](https://tabeladigital.com/js/geral.js) mostra relógio, checagem de conexão, letreiro e recarregamento periódico. A implementação mantém a rotação e a recuperação de conexão com um fluxo próprio de atualização. A imagem ilustrativa padrão pode ser substituída pela loja.

O código privado do fornecedor e seus dados de produção estão fora do projeto. Vídeos e YouTube foram excluídos do escopo. A troca de senha está no painel. A recuperação por e-mail exige integração de correio e ficou fora desta entrega.
