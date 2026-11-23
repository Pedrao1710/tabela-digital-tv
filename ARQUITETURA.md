# Organização do painel

## Servidor

- `server.mjs` monta a aplicação HTTP, valida origem e acesso, e liga as rotas aos módulos.
- `sessions.mjs` controla criação, persistência, validade e revogação das sessões. O relógio pode ser fornecido nos testes; consultas não prorrogam os 14 dias.
- `state.mjs` guarda o estado das lojas e valida suas alterações. Regras de catálogo e operações não pertencem às telas do navegador.
- `catalog.mjs` interpreta o arquivo Toledo e calcula diferenças entre catálogos.
- `auto-import.mjs` acompanha as fontes, verifica leituras estáveis e publica por loja.
- `instance-lock.mjs` impede duas instâncias usando a mesma pasta de dados.
- `weather.mjs` consulta a temperatura mantendo a chave no servidor.
- `reference.mjs` e `bootstrap-stores.mjs` atendem migração e provisionamento; não são necessários para cada requisição.

## Administração no navegador

`admin.html` carrega `admin.js` como módulo. O arquivo principal coordena rotas, estado da sessão, formulários e páginas. As partes reutilizáveis têm responsabilidades separadas:

| Arquivo | Responsabilidade |
| --- | --- |
| `admin-ui.js` | Elementos, campos, avisos, tabelas e marca; sem acesso a contas ou requisições |
| `admin-format.js` | Moeda, datas, busca textual e leitura de valores |
| `admin-client.js` | Requisições, vínculo com a loja, descarte de respostas antigas e prazo de 30 segundos |
| `admin-appearance.js` | Campos, cores e gravação da aparência de cada tela |

O cliente recebe funções que consultam o estado atual. Não mantém outra cópia da sessão. Respostas iniciadas antes de logout são descartadas; uma falha de rede não é tratada como comprovação de revogação. Tanto a conexão quanto a leitura do corpo da resposta ficam dentro do prazo.

Novos arquivos públicos devem ser incluídos explicitamente na lista de recursos de `server.mjs`. Arquivos de dados e configuração privada nunca fazem parte dessa lista.

## Apresentação na TV

`tv.js` e `tv-entry.js` continuam como scripts clássicos, sem depender dos módulos administrativos. Preserve sua sintaxe compatível com ES5.

`tv.css` controla a apresentação, incluindo a coluna vertical de imagens. Os tamanhos configurados e o ajuste automático permanecem no renderer. As alturas das linhas são aplicadas antes das medições para reduzir recálculos de layout.

A TV consulta o servidor periodicamente, renderiza novamente quando a versão muda e conserva preços somente em memória por até 90 segundos sem validação. Dados e imagens exigem sessão e acesso à loja correspondente.

## Dados, desenvolvimento e verificações

As pastas `data` e `data-demo` são diferentes. Os perfis importados ficam em `data`; `--demo` usa a demonstração ilustrativa. Execute apenas uma instância por pasta.

- `npm ci`: instala as ferramentas de desenvolvimento nas versões fixadas.
- `npm run format`: aplica a formatação padronizada ao código.
- `npm run check`: confere sintaxe, executa testes e verifica formatação.

Prettier é uma dependência de desenvolvimento; a aplicação em execução usa os módulos nativos do Node. As verificações e o formatador excluem dados privados, recursos de imagem e artefatos temporários. Testes de alterações usam diretórios temporários, sem gravar nas contas reais.

Uma mudança de organização deve preservar rotas, autorização, campos, nomes das ações e comportamento de erro. Para mudanças visuais, compare a apresentação e os campos com a versão aprovada. A suíte automatizada não substitui a conferência física dos modelos de TV.
