# Revisão para operação contínua — versão 1.0.1

## Resultado e limites

Esta versão é uma candidata à publicação. Testes locais não equivalem a 24 horas reais na TV nem comprovam a configuração do servidor de destino.

Um ensaio curto em dados descartáveis fez 30.000 consultas autenticadas, concorrência 20, sem erros. O heap após coleta não cresceu continuamente; RSS atingiu um platô próximo de 230 MB. São medidas deste computador, não do servidor i3. Não apresentar esse ensaio como 24 horas reais.

## Correções nesta candidata

- Até duas leituras pendentes por fonte e três no total. Operação presa no sistema operacional continua contando até realmente terminar; não se cria fila ilimitada. Outras fontes recebem vez em ordem rotativa.
- Estado escrito em temporário exclusivo, sincronização do conteúdo, fechamento e troca atômica. Falha antes da troca preserva o estado anterior. Não substitui UPS, disco saudável e backup.
- SIGTERM/SIGINT aguardam requisições em andamento, fecham conexões ociosas e forçam encerramento em 20 segundos. Docker reserva 30 segundos.
- Logs limitados a três arquivos de 10 MB.
- Watchdog restrito ao container tabela-digital rodando e unhealthy. Respeita pausa, parada e manutenção; espera cinco minutos entre reinícios.
- Backup captura snapshot local com painel brevemente pausado; retoma antes da compressão e transferência e tenta retomar também em falha.
- Rclone mantém sua configuração renovável em diretório de estado protegido e gravável.
- Bind mounts não criam diretórios vazios quando a origem está ausente.
- Apenas IPs de proxy explicitamente confiáveis podem fornecer X-Real-IP ao limite de login.
- /healthz identifica a versão carregada. Confirma resposta HTTP, não atualização das duas fontes.

## Condições obrigatórias para publicar

1. Confirmar acesso ao Ubuntu de destino, serviço existente, portas, proprietário dos dados e espaço livre. Não substituir outro projeto.
2. Guardar cópia consistente dos dados do painel e da versão anterior do código/imagem. Conferir restauração em pasta isolada.
3. Verificar SHA-256 externo do pacote e executar `sha256sum -c SHA256SUMS` na pasta extraída.
4. Construir a imagem no destino e validar Compose. A imagem fixa Node 26.13.1; o build precisa funcionar nessa plataforma.
5. Montar SMB somente leitura ANTES de criar o container. Os dois TXT precisam ser legíveis pelo UID 1000 dentro do container. Após remontagem, pode ser necessário recriar o bind/container.
6. Migrar contas, listas, imagens e parâmetros somente se o destino não contiver dados atuais. O pacote de código exclui data, sessões, senhas e arquivos .env reais.
7. Confirmar HTTPS com certificado aceito pelas TVs e TABELA_ORIGIN igual à origem. Não liberar logins em rede por HTTP; loopback/túnel servem à validação.
8. O proxy deve sobrescrever X-Real-IP com o endereço do cliente. Configurar TABELA_TRUSTED_PROXIES com o IP exato do socket visto pelo Node, sem curingas ou redes inteiras. A porta Node permanece em loopback.
9. Entrar nas duas contas e conferir fontes, listas, preços, fotos e isolamento de cada loja.
10. Conferir timers, logs, saúde, restauração e reinício do container. Reboot do servidor inteiro exige janela e análise dos demais serviços.

## Monitoramento e manutenção

A saúde HTTP e a leitura dos TXT são verificações diferentes. Um TXT ausente não deve provocar uma sequência de reinícios. Operações presas no kernel podem exigir intervenção na montagem ou reinício controlado do painel.

Instale o watchdog depois da validação manual:

```sh
sudo install -m 0644 deploy/linux/tabela-watchdog.service /etc/systemd/system/
sudo install -m 0644 deploy/linux/tabela-watchdog.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now tabela-watchdog.timer
sudo systemctl status tabela-watchdog.timer --no-pager
```

Os serviços assumem código em /opt/tabela-digital. Ajuste ExecStart antes de ativar caso use outro caminho.

Crie /run/tabela-digital/maintenance como root antes de parar/atualizar. Backup e watchdog coordenam operações nesse diretório. Retire o sinal somente após validar e retomar o serviço.

Investigue alertas das fontes: montagem, permissões UID 1000, espaço em disco e logs. A última tabela válida não comprova leitura atual. Reinícios repetidos exigem investigação.

## Backup e retorno à versão anterior

Ative o backup somente após configurar o remote crypt do Rclone e validar uma restauração isolada. OAuth fica em /var/lib/tabela-backup/rclone.conf, root:root, modo 0600, diretório 0700. Esse arquivo não pertence ao pacote nem à cópia enviada ao Drive.

O script verifica que TABELA_DATA_DIR é exatamente o volume /data do container nomeado e só pausa esse painel. Reserve espaço para snapshot sem compressão, arquivo comprimido e download de confirmação. Não inclui RH nem as fontes Toledo.

Em falha de publicação, sinalize manutenção, pare somente o painel novo e restaure o código/imagem anteriores. Preserve os dados compatíveis. Se precisar restaurá-los, pare o painel, extraia a cópia em pasta nova e confira conteúdo, proprietário e permissões antes de trocar o volume. Nunca extraia sobre dados ativos. Confira login, fotos e fontes antes de encerrar manutenção.

## Aceitação física

Mantenha uma TV representativa ligada por um turno com rotação, atualização e queda breve de rede controlada; depois complete 24 horas. Confira suspensão, proteção de tela, retorno de conexão e novo login após 14 dias. Esses comportamentos também dependem de firmware, energia e rede.

Referências: [Docker restart](https://docs.docker.com/engine/containers/start-containers-automatically/), [logs](https://docs.docker.com/engine/logging/drivers/json-file/), [HTTP do Node](https://nodejs.org/api/http.html#serverclosecallback), [configuração do Rclone](https://rclone.org/docs/#config-config-file).
