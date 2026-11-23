# Revisão do sistema — 18/11/2026

## Problemas e decisões

- Uma leitura de rede travada deixava uma loja sem nova tentativa: isolar as tentativas e descartar respostas atrasadas para permitir recuperação.
- Duas instâncias com a mesma pasta mantêm cópias independentes em memória e podem sobrescrever dados: garantir exclusão por pasta de dados antes de iniciar.
- Na TV 4:3, imagens e aviso textual desapareciam apesar de configurados: manter ambos visíveis e adaptar o espaço.
- O estado de atualização de preços tinha pouca hierarquia visual no painel: apresentar sucesso, espera e falha com cores e texto, preservando identificação textual.
- Arquivo Toledo parcialmente gravado, mas estável e com mais de metade dos registros, pode ser aceito: depende do processo de gravação da origem ou de uma regra operacional para exclusões; não presumir que exclusões são erro.

Testes e comentários existentes são preservados conforme escolha do usuário.

## Resultado da verificação

- A suíte sequencial passou com 19 testes, incluindo recuperação de fonte travada e a recusa de duas instâncias para a mesma pasta.
- O painel foi conferido no navegador e ambas as lojas confirmaram leitura válida após o reinício.
- Limitações: operações do sistema de arquivos que nunca retornem podem permanecer pendentes; não há confirmação de integridade do gerador para descartar todo arquivo parcialmente gravado; é preciso testar fisicamente a TV e a rede da loja.

## Preparação para hospedagem Linux — 18/11/2026

- O pacote Linux, o Compose, a rota de saúde, o guia de operação e o backup de duas versões foram preparados **no projeto local**. Não fazem parte da implantação em produção.
- Acrescentada uma rota `/healthz` sem dados da loja, para verificar apenas se o processo web responde.
- Criada imagem Docker Node 26 LTS, com usuário sem privilégios, sistema de arquivos raiz somente leitura, limites de recursos, reinício após falha e checagem de saúde.
- Os arquivos de preços entram no container somente leitura. O exemplo Linux associa `Toledo/001` a Margarida e `Toledo/002` a Santa Fé; o compartilhamento de origem permanece inalterado.
- Criado um guia de operação, verificação e restauração. O backup opcional cobre somente os dados do painel, usa remote criptografado do Rclone e mantém duas cópias verificadas no Drive.
- Verificação local: 19 testes passaram. O Compose foi validado no Ubuntu; imagem e container temporários foram construídos para verificar `/healthz` sob usuário sem privilégios e raiz somente leitura.
- Rotação de backup simulada em `/tmp` com destino falso: três execuções mantiveram exatamente duas cópias verificadas; uma falha de verificação preservou essas duas. Nenhum acesso ou escrita foi feito ao Google Drive.
- A implantação temporária feita no servidor por engano foi removida: container, rede do Compose, diretórios do painel e ponto de montagem temporário foram retirados; a porta 8088 está livre. O comando `bash ./status.sh` foi validado durante essa checagem temporária.
- O backup de RH e de outros compartilhamentos foi mantido totalmente fora do escopo e não foi incluído nos arquivos nem nos testes.
