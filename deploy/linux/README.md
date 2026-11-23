# Instalação Linux e passagem de operação

Esta instalação roda o painel em um container Docker, mantém os dados fora da imagem e lê os preços em modo somente leitura. A demonstração não deve ser usada como serviço.

## O que fica guardado

- Código e arquivos da interface: `/opt/tabela-digital`.
- Contas, configurações, catálogos, histórico e imagens do painel: `/var/lib/tabela-digital`.
- Montagem somente leitura dos arquivos de preço: `/mnt/tabela-precos`.
- O container não inclui dados privados na imagem; recriar a imagem não apaga o volume de dados.

Não inclua compartilhamentos de RH ou outras pastas nesta instalação ou em seus backups sem uma autorização e um caminho confirmados. O backup incluído aqui cobre somente os dados do painel.

## Pré-requisitos

- Ubuntu com Docker Engine e Docker Compose já configurados. Esta candidata fixa Node.js 26.13.1 LTS; atualize a versão em janela controlada, reconstruindo e verificando a imagem.
- Acesso SMB de **somente leitura** aos arquivos em `\\172.16.104.2\rpdv`.
- IP `10.1.1.250` reservado para o servidor e acesso de rede limitado às TVs e à equipe de suporte.
- Uma conta de Google Drive com espaço para manter dois arquivos de backup criptografados.

O servidor precisa de credenciais SMB para a leitura dos TXT; a leitura anônima não funcionou na checagem. Não coloque a senha do compartilhamento no código, no arquivo `.env` do Compose, nem em comandos salvos no histórico do shell.

## Preparar a fonte de preços

No servidor, um administrador instala o cliente CIFS e cria o arquivo de credenciais protegido:

```sh
sudo apt-get install cifs-utils
sudo install -d -m 0750 /etc/tabela-digital
sudoedit /etc/tabela-digital/toledo.cred
```

O arquivo deve conter o usuário, a senha e, se necessário, o domínio aceito pelo servidor SMB. Depois, proteja-o e monte o compartilhamento **somente leitura**:

```sh
sudo chown root:root /etc/tabela-digital/toledo.cred
sudo chmod 600 /etc/tabela-digital/toledo.cred
sudo install -d -m 0755 /mnt/tabela-precos
sudoedit /etc/fstab
```

Adicionar em `/etc/fstab`:

```fstab
//172.16.104.2/rpdv /mnt/tabela-precos cifs credentials=/etc/tabela-digital/toledo.cred,ro,vers=3.0,iocharset=utf8,_netdev,nofail,x-systemd.automount 0 0
```

Ativar e conferir que a conta que fará a operação consegue ler os dois arquivos:

```sh
sudo systemctl daemon-reload
sudo mount /mnt/tabela-precos
sudo -u tiarapongas test -r /mnt/tabela-precos/Toledo/001/txitens.txt
sudo -u tiarapongas test -r /mnt/tabela-precos/Toledo/002/txitens.txt
```

Os dois comandos `test` devem terminar sem mensagem de erro. Essa montagem só lê o compartilhamento; não grava nem altera os TXT.

## Instalar o painel

Copie o projeto para `/opt/tabela-digital`, preservando `data/state.json` e `data/images`. Mantenha a pasta `data-demo` fora da instalação de produção. O usuário de dentro do container tem UID 1000, portanto os dados precisam permitir gravação a esse UID. Se copiar do Windows, aplique o proprietário no Linux depois da cópia.

```sh
sudo install -d -o 1000 -g 1000 -m 0750 /var/lib/tabela-digital
sudo chown -R 1000:1000 /var/lib/tabela-digital
cd /opt/tabela-digital/deploy/linux
cp .env.example .env
chmod 600 .env
```

Em uma instalação com contas já migradas, mantenha inicialmente o serviço restrito ao servidor e confira os acessos pelo túnel SSH. Em uma instalação vazia, faça o primeiro cadastro diretamente no processo Node local antes de iniciar o container. O cadastro inicial exige acesso de loopback direto e um código no arquivo `setup-code.txt` do diretório de dados. A ponte de rede do Docker e proxies não atendem a esse requisito.

Com o container parado e Node disponível no host, execute como o proprietário do diretório de dados:

```sh
cd /opt/tabela-digital
TABELA_DATA=/var/lib/tabela-digital TABELA_HOST=127.0.0.1 TABELA_PORT=8088 node server.mjs
```

Abra pelo computador de suporte um túnel `ssh -L 8088:127.0.0.1:8088 tiarapongas@10.1.1.250`, visite `http://127.0.0.1:8088` e use o código lido no arquivo protegido do servidor para criar a primeira conta. Após cadastrar, encerre o processo Node e inicie o container sobre o mesmo diretório de dados. A alternativa é provisionar os dados localmente e copiá-los com proprietário e permissões conferidos.

Para uso da equipe e TVs, configure um proxy HTTPS com certificado reconhecido pelos aparelhos e `TABELA_ORIGIN` igual à origem HTTPS. Mantenha a porta Node restrita ao proxy. HTTP em rede permite interceptar as credenciais e deve ficar limitado à verificação de conectividade. As URLs HTTP deste guia servem para consultar a saúde do processo.

O `auto-import.json` copiado do Windows ainda contém caminhos UNC, que o Linux não consegue abrir diretamente. Guarde uma cópia desse arquivo no servidor, confirme os nomes das lojas e então instale o exemplo Linux. Ele associa `001` a Margarida e `002` a Santa Fé:

```sh
sudo install -o 1000 -g 1000 -m 0600 auto-import.example.json /var/lib/tabela-digital/auto-import.json
```

Inicie e confira:

```sh
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 tabela-digital
curl --fail http://10.1.1.250:8088/healthz
```

O container reinicia com o Docker após reinicialização normal do servidor. `healthz` só confirma que o processo web responde; o estado dos arquivos de cada loja aparece no painel. Aguarde a conferência de duas leituras estáveis do arquivo (normalmente até cerca de um minuto) e confirme que as duas lojas ficam sem alerta antes de liberar as TVs.

## Operação diária

O usuário responsável só precisa abrir o endereço do painel, confirmar o estado das duas fontes e usar os links de tela já cadastrados. Os preços são verificados a cada 30 segundos; a TV consulta o servidor sem precisar reiniciar. Se uma fonte ficar indisponível, o último catálogo válido é mantido.

Comandos para quem assumir o suporte:

```sh
cd /opt/tabela-digital/deploy/linux
bash ./status.sh
docker compose ps
docker compose logs --since=1h tabela-digital
curl --fail http://10.1.1.250:8088/healthz
docker compose restart tabela-digital
```

Não execute `docker compose down -v`: isso pode apagar volumes nomeados de outros serviços se o arquivo de instalação for alterado futuramente. Não apague `/var/lib/tabela-digital`; contém todos os dados operacionais do painel.

## Backup criptografado do painel

O script `backup-two.sh` verifica o volume do painel, pausa brevemente somente seu container e captura um snapshot local. Retoma o serviço antes de comprimir e enviar para um remote **crypt** do Rclone no Google Drive. Baixa a cópia enviada para comparar byte a byte e só então remove versões além das duas mais recentes. Em falha, tenta retomar também pela rotina de saída. Reserve espaço para snapshot, arquivo comprimido e confirmação. Se a leitura de confirmação falhar, as versões anteriores não são removidas.

O backup deste projeto inclui o código e os dados do painel para permitir reconstruí-lo. Ele **não inclui o sistema operacional, o conteúdo do compartilhamento RH, nem os arquivos fonte do Toledo**. Os dados incluem credenciais em hash, catálogos, configurações, histórico e imagens. O arquivo é criptografado pelo remote `crypt` antes de chegar ao Drive.

1. Instale Rclone pelo procedimento oficial e configure uma conexão Google Drive (`drive`) e uma camada criptografada (`crypt`) chamada `drive-crypt`. Configure criptografia dos nomes e conteúdos.
2. Guarde as senhas de criptografia fora do servidor e fora do Drive. Sem elas, os arquivos não podem ser restaurados.
3. Crie `/etc/tabela-digital/backup.env` a partir de `backup.env.example`, revise `TABELA_APP_DIR`, `TABELA_DATA_DIR` e `RCLONE_REMOTE`, e aplique `root:root` e modo `600`.
4. Crie `/var/lib/tabela-backup` com proprietário `root:root` e modo `700`. Proteja `/var/lib/tabela-backup/rclone.conf` como `root:root`, modo `600`; use o login Google autorizado. O diretório precisa permitir substituição atômica da configuração para renovar o token OAuth. Ele fica fora dos dados e do backup do painel.
5. Copie `tabela-backup.service` e `tabela-backup.timer` para `/etc/systemd/system/`, ative o timer e execute o serviço manualmente uma vez para conferir o resultado.

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now tabela-backup.timer
sudo systemctl start tabela-backup.service
sudo systemctl status tabela-backup.service --no-pager
sudo journalctl -u tabela-backup.service -n 50 --no-pager
```

Confira no Drive que existem dois arquivos `tabela-digital-*.tar.gz` dentro da pasta do remote criptografado. Faça uma restauração de teste num diretório temporário antes de considerar a rotina pronta:

```sh
tar -tzf backup-de-teste.tar.gz
```

Para restaurar, baixe e descriptografe um arquivo de backup, confira a lista com `tar -tzf`, extraia em um diretório temporário, recoloque `opt/tabela-digital` e `var/lib/tabela-digital` nos caminhos originais, confirme proprietário UID 1000 nos dados, reconstrua o container e verifique as duas lojas e as imagens. Não extraia um backup diretamente por cima de uma instalação ativa.

## Atualização do programa

Guarde uma cópia dos dados antes de atualizar. Atualize o código em `/opt/tabela-digital` sem substituir `/var/lib/tabela-digital`, reconstrua a imagem e valide a saúde e as telas:

```sh
cd /opt/tabela-digital/deploy/linux
docker compose build --pull
docker compose up -d
docker compose ps
curl --fail http://10.1.1.250:8088/healthz
```

Não use atualização automática irrestrita de imagem em produção. Faça atualização controlada e volte à versão anterior se a validação falhar.

## Validação de operação contínua

Siga também [OPERACAO-24H.md](../../OPERACAO-24H.md). O Compose limita os logs e não cria caminhos de montagem ausentes. O watchdog opcional `tabela-watchdog.timer` reinicia exclusivamente o painel rodando e marcado `unhealthy`, respeitando manutenção e intervalo de cinco minutos. Não ativa serviço parado ou pausado.

Mantenha a porta Node em loopback e confira os comandos de saúde no próprio servidor. Antes da liberação, confirme HTTPS aceito pelas TVs, o IP exato do proxy em `TABELA_TRUSTED_PROXIES`, as fontes dentro do container e a restauração. O proxy deve sobrescrever `X-Real-IP`; cabeçalhos de clientes diretos são ignorados.

O pacote de código não contém os perfis importados. Transfira `state.json` e `images` por canal autenticado se for uma instalação nova; não sobrescreva dados atuais no destino. Não migre sessões ou códigos de instalação. Depois adapte somente `auto-import.json` aos caminhos Linux. A versão carregada aparece em `/healthz`.

