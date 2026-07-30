# Meu Controle Financeiro

Aplicação web estática de controle financeiro pessoal. Funciona sem conta, backend, banco remoto, API paga, framework ou biblioteca externa. Todos os registros ficam exclusivamente no IndexedDB do navegador usado.

## Recursos

- dashboard mensal com saldos previsto e realizado;
- salário mensal, receitas extras e status recebido/pendente;
- gastos fixos recorrentes com ocorrências independentes por mês, período inclusivo e encerramento seguro;
- vencimento opcional em gastos fixos, com destaque para pendências sem data;
- gastos avulsos com pesquisa, período, filtros, ordenação e duplicação;
- múltiplos perfis financeiros locais, sem login, com troca imediata e visão consolidada;
- categorias e formas de pagamento personalizáveis;
- histórico por seletor de mês;
- relatórios detalhados com filtros combináveis por período, perfil, categoria, pagamento, tipo, status e descrição;
- salário principal como origem padrão de novos gastos, com opção de receita adicional, divisão ou ausência explícita de vínculo;
- saldo utilizado e disponível de cada renda, com aviso quando o valor é ultrapassado;
- relatórios separados para salário, receitas adicionais e visão consolidada de todas as rendas;
- filtros de relatório salvos no navegador, totais filtrados e exportação do resultado em CSV;
- gráficos nativos em Canvas com resumos textuais;
- backup JSON, backup protegido por PBKDF2 + AES-GCM e restauração por mesclagem ou substituição;
- backup de todos os perfis ou somente do perfil atual, com lembrete periódico;
- exportação CSV com ponto e vírgula;
- modo claro, escuro e automático;
- PWA instalável e funcionamento offline após o primeiro acesso;
- dados de demonstração opcionais e removíveis;
- interface em português do Brasil, responsiva e acessível, com navegação inferior e tabelas em cards no celular.

## Privacidade

Os dados não são enviados ao GitHub nem a outro serviço. Não há analytics, telemetria, anúncios, cookies de rastreamento ou integração bancária. Apagar dados do navegador pode apagar os registros. Outro navegador ou dispositivo não recebe os dados automaticamente. Faça backups regulares.

O armazenamento persistente pode ser solicitado em **Configurações**, mas o navegador decide se concede a proteção. Um backup protegido depende da senha escolhida; a aplicação nunca armazena essa senha e não consegue recuperá-la.

## Estrutura

```text
controle-financeiro/
├── index.html
├── styles.css
├── manifest.json
├── sw.js
├── .nojekyll
├── LICENSE
├── README.md
├── icons/
│   ├── icon-192.svg
│   └── icon-512.svg
├── js/
│   ├── app.js
│   ├── calculations.js
│   ├── charts.js
│   ├── database.js
│   ├── export.js
│   ├── funding.js
│   ├── recurring.js
│   └── utils.js
└── tests/
    ├── index.html
    ├── run-node.mjs
    └── tests.js
```

## Modelo de dados

O banco `meu-controle-financeiro` usa IndexedDB, versão 4. As atualizações anteriores são automáticas: registros da versão 1 recebem o perfil **Pessoal** e gastos sem uma origem válida passam a usar o salário principal do respectivo perfil e mês. Nenhum lançamento financeiro, data, status, perfil, valor ou identificador é apagado pela migração. Cada store tem chave primária `id`; os lançamentos incluem `profileId`, `createdAt`, `updatedAt`, `version` e `origin` quando aplicável.

| Store | Finalidade | Índices principais |
|---|---|---|
| `settings` | configurações futuras sincronizadas com o banco | chave `id` |
| `profiles` | perfis financeiros locais | `name` |
| `categories` | nome, ícone, cor, tipo e estado por perfil | `profileId`, `profileActive`, `active`, `name` |
| `paymentMethods` | formas de pagamento por perfil | `profileId`, `profileActive`, `active`, `name` |
| `monthlyIncomes` | salário líquido de cada mês e perfil | `profileId`, `profileMonth`, `month`, `status` |
| `additionalIncomes` | outras receitas por perfil | `profileId`, `profileMonth`, `month`, `date`, `categoryId`, `status` |
| `recurringExpenses` | regras de recorrência por perfil | `profileId`, `profileActive`, `active`, `categoryId`, `startDate` |
| `monthlyExpenseInstances` | cópias mensais históricas dos gastos fixos | `profileId`, `profileMonth`, `month`, `date`, `categoryId`, `status`, `recurringId`, `occurrenceKey` |
| `oneTimeExpenses` | gastos avulsos por perfil | `profileId`, `profileMonth`, `month`, `date`, `categoryId`, `paymentMethodId`, `status` |
| `appMetadata` | versão e metadados técnicos | chave `id` |

Valores monetários são inteiros em centavos. `R$ 32,50` é armazenado como `3250`. O mês de referência usa `AAAA-MM`.

### Origem da renda

Gastos avulsos e ocorrências de gastos fixos usam o salário principal por padrão. Também podem usar uma receita adicional específica, uma divisão exata entre várias rendas ou, mediante confirmação, a opção avançada **Não descontar de nenhuma renda**. As parcelas ficam em `fundingAllocations`; a soma precisa ser igual ao valor do gasto. Um vínculo salarial é criado mesmo quando o salário daquele mês ainda não foi informado, permitindo que o saldo apareça negativo provisoriamente.

Em uma recorrência, a escolha exclusiva do salário é repetida nos próximos meses e ajustada ao valor da ocorrência. Receitas adicionais são lançamentos específicos, portanto escolhas que as utilizam valem somente para a ocorrência daquele mês; nos meses seguintes, o salário volta a ser a origem padrão. A migração é idempotente: vínculos existentes com receitas adicionais ou divisões não são alterados.

Se o valor utilizado ultrapassar a renda disponível, o aplicativo avisa e exige uma segunda confirmação, mas permite salvar quando o excesso for intencional.

O resumo mensal e os relatórios mostram salário previsto e recebido, parcelas pagas e pendentes vinculadas ao salário, saldo e percentual comprometido. As outras receitas exibem total, uso, disponibilidade e percentual, com detalhamento individual. Em gastos divididos, cada bloco contabiliza somente a parcela correspondente, sem duplicar o valor total do gasto.

### Recorrências e histórico

Cada ocorrência fixa usa a chave única `recurringId:mês`. Essa restrição existe no próprio IndexedDB e evita duplicações mesmo se duas rotinas tentarem gerar o mesmo mês. A ocorrência copia descrição, valor, categoria, pagamento e observação da recorrência no momento da geração.

O dia do vencimento pode ficar vazio. Nesse caso, a ocorrência continua no mês de referência, aparece como **Sem vencimento**, não recebe uma data artificial e pode ser marcada como paga normalmente.

As datas inicial e final são interpretadas pelo mês de referência. A data final é inclusiva: uma recorrência encerrada em qualquer dia de dezembro continua válida em dezembro e deixa de gerar ou entrar nos totais a partir de janeiro. Ao antecipar o encerramento, ocorrências pendentes fora do novo período são removidas; registros pagos são preservados no banco e nos backups, mas não entram nas estatísticas de meses inválidos. Remover ou ampliar a data final volta a permitir a geração dos meses válidos.

Editar a recorrência muda os próximos meses ainda não gerados. A opção **Aplicar valores também à ocorrência do mês selecionado** altera a cópia atual. Ocorrências históricas permanecem independentes. Excluir uma recorrência não apaga ocorrências já geradas.

Na tela de gastos fixos, **Editar somente este mês** altera apenas a ocorrência mensal. **Editar gasto fixo completo** abre a regra da recorrência, incluindo período, origem do dinheiro e estado ativo.

### Regras financeiras

- receitas previstas = salário + outras receitas;
- despesas previstas = gastos fixos + gastos avulsos;
- saldo previsto = receitas previstas − todas as despesas previstas;
- saldo realizado = receitas recebidas − despesas pagas;
- meses não carregam saldo automaticamente entre si.

## Executar localmente

Módulos ES, IndexedDB e Service Worker precisam de uma origem HTTP. Abrir `index.html` por `file://` não é suficiente para validar todos os recursos.

Use qualquer servidor estático. Exemplos:

```bash
# Python, se já estiver instalado
python -m http.server 8080

# ou o servidor estático disponível no seu editor
```

Depois abra `http://localhost:8080/controle-financeiro/`, ajustando o caminho conforme a pasta em que o servidor foi iniciado. Para executar os testes, abra `http://localhost:8080/controle-financeiro/tests/`.

Service Worker e instalação PWA funcionam em `localhost` ou em HTTPS. Depois de editar arquivos em produção, atualize `CACHE_VERSION` em `sw.js`; o aplicativo avisará quando a nova versão estiver pronta e só trocará após confirmação.

A versão atual do cache é `controle-financeiro-v4.0.0`. Ela inclui `js/funding.js`, remove caches anteriores na ativação e evita a mistura de JavaScript ou CSS de versões diferentes.

## Publicar gratuitamente no GitHub Pages

1. Entre no GitHub e crie um repositório, por exemplo `controle-financeiro`.
2. Envie **o conteúdo desta pasta** para a raiz do repositório. O arquivo `.nojekyll` também deve ser enviado.
3. Abra **Settings → Pages** no repositório.
4. Em **Build and deployment**, escolha **Deploy from a branch**.
5. Selecione a branch `main`, a pasta `/(root)` e clique em **Save**.
6. Aguarde o GitHub informar o endereço, normalmente `https://SEU-USUARIO.github.io/controle-financeiro/`.
7. Abra o endereço uma vez com internet. Os caminhos relativos fazem a aplicação funcionar nesse subdiretório.
8. Para instalar, use o botão **Instalar app** quando aparecer ou a opção de instalação do navegador.

O repositório hospeda somente os arquivos da aplicação. Os lançamentos ficam no navegador de cada pessoa e não são gravados no repositório.

## Backup e restauração

Em **Backup**:

1. Escolha se deseja incluir todos os perfis ou apenas o perfil atual e clique em **Exportar backup completo** para salvar JSON.
2. Para proteção adicional, marque a opção de senha e use pelo menos 8 caracteres.
3. Guarde o arquivo fora da pasta de downloads se ele for importante.
4. Para restaurar, selecione o JSON e clique em **Revisar arquivo**.
5. Confira o resumo e escolha:
   - **Mesclar**: registros com o mesmo `id` são atualizados, sem duplicação;
   - **Substituir**: apaga os dados atuais e importa apenas o arquivo.
6. Faça um backup atual antes de usar **Substituir**.

Se a senha de um backup protegido for perdida, não há recuperação. A criptografia usa PBKDF2 com SHA-256 e 250.000 iterações para derivar uma chave AES-GCM de 256 bits.

## Exportar CSV

Escolha todos os meses ou apenas o mês selecionado e filtre por receitas/despesas. No relatório, o botão **Exportar resultado em CSV** respeita todos os filtros combinados, incluindo a origem da renda. O arquivo identifica o perfil e mostra a divisão utilizada em cada gasto, usa UTF-8 com BOM e separador `;`, adequado ao padrão de planilhas em português do Brasil.

## Atualizar a aplicação

1. Edite os arquivos.
2. Altere `CACHE_VERSION` em `sw.js` (por exemplo, de `v1.0.0` para `v1.0.1`).
3. Envie as mudanças para a branch publicada.
4. Quando o navegador baixar a nova versão, a aplicação exibirá **Uma nova versão está disponível**.
5. Clique em **Atualizar agora**.

Backups gerados pelo usuário não entram no cache do Service Worker. Os testes também não fazem parte do cache principal.

## Testes

O executor em `tests/` verifica:

- conversões de reais e centavos;
- totais de receitas e despesas;
- saldos previsto e realizado;
- agrupamento por categoria;
- intervalo, geração e ajuste de recorrências;
- recorrências sem vencimento;
- prevenção de ocorrências duplicadas;
- validação e migração de backup antigo;
- mesclagem por identificador;
- filtro mensal;
- soma consolidada de perfis;
- filtros combináveis e resumo de despesas;
- propagação segura do salário em recorrências;
- retorno ao salário padrão depois do mês de uma receita adicional específica;
- filtros por origem da renda;
- resumo de salário, receitas adicionais, divisões e gastos sem vínculo;
- encerramento inclusivo das recorrências por mês;
- limpeza segura de ocorrências futuras pendentes;
- preservação de ocorrências pagas;
- salário padrão para gastos, recorrências e ocorrências;
- divisão exata entre salário e receita adicional;
- migração idempotente do banco e de backups antigos;
- contabilização proporcional de cada origem.

Abra `/tests/` pelo mesmo servidor local. O resultado esperado é `36 de 36 testes passaram`.

Os mesmos testes podem ser executados diretamente com Node.js usando `node tests/run-node.mjs`.

## Compatibilidade e limites

Prioriza versões modernas de Chrome, Edge, Firefox, Safari e navegadores móveis. O botão de instalação depende do suporte do navegador. IndexedDB é obrigatório; se ele estiver desativado ou indisponível, a interface mostrará uma mensagem de erro. Os perfis ficam no mesmo navegador e não sincronizam entre dispositivos. A aplicação não inclui investimentos, juros, parcelamento de fatura ou integração bancária.

Em telas de até 900 px, o cabeçalho usa duas linhas, a navegação principal fica fixa na parte inferior e respeita a área segura do aparelho. Em telas de até 680 px, tabelas viram cards com ações de toque; indicadores usam duas colunas e passam para uma coluna somente abaixo de 350 px. Os filtros dos relatórios ficam em um painel expansível com contador de filtros ativos. Gráficos usam `devicePixelRatio`, `ResizeObserver` e legendas externas para manter a leitura ao girar a tela.

## Licença

MIT. Consulte `LICENSE`.
