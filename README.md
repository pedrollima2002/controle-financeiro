# Meu Controle Financeiro

Aplicação web estática de controle financeiro pessoal. Funciona sem conta, backend, banco remoto, API paga, framework ou biblioteca externa. Todos os registros ficam exclusivamente no IndexedDB do navegador usado.

## Recursos

- dashboard mensal com saldos previsto e realizado;
- salário mensal, receitas extras e status recebido/pendente;
- gastos fixos recorrentes com ocorrências independentes por mês;
- gastos avulsos com pesquisa, período, filtros, ordenação e duplicação;
- categorias e formas de pagamento personalizáveis;
- histórico por seletor de mês;
- gráficos nativos em Canvas com resumos textuais;
- backup JSON, backup protegido por PBKDF2 + AES-GCM e restauração por mesclagem ou substituição;
- exportação CSV com ponto e vírgula;
- modo claro, escuro e automático;
- PWA instalável e funcionamento offline após o primeiro acesso;
- dados de demonstração opcionais e removíveis;
- interface em português do Brasil, responsiva e acessível.

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
│   ├── recurring.js
│   └── utils.js
└── tests/
    ├── index.html
    └── tests.js
```

## Modelo de dados

O banco `meu-controle-financeiro` usa IndexedDB, versão 1. Cada store tem chave primária `id`; os lançamentos incluem `createdAt`, `updatedAt`, `version` e `origin` quando aplicável.

| Store | Finalidade | Índices principais |
|---|---|---|
| `settings` | configurações futuras sincronizadas com o banco | chave `id` |
| `categories` | nome, ícone, cor, tipo e estado | `active`, `name` |
| `paymentMethods` | formas de pagamento | `active`, `name` |
| `monthlyIncomes` | salário líquido de cada mês | `month`, `status` |
| `additionalIncomes` | outras receitas | `month`, `date`, `categoryId`, `status` |
| `recurringExpenses` | regras de recorrência | `active`, `categoryId`, `startDate` |
| `monthlyExpenseInstances` | cópias mensais históricas dos gastos fixos | `month`, `date`, `categoryId`, `status`, `recurringId`, `occurrenceKey` |
| `oneTimeExpenses` | gastos avulsos | `month`, `date`, `categoryId`, `paymentMethodId`, `status` |
| `appMetadata` | versão e metadados técnicos | chave `id` |

Valores monetários são inteiros em centavos. `R$ 32,50` é armazenado como `3250`. O mês de referência usa `AAAA-MM`.

### Recorrências e histórico

Cada ocorrência fixa usa a chave única `recurringId:mês`. Essa restrição existe no próprio IndexedDB e evita duplicações mesmo se duas rotinas tentarem gerar o mesmo mês. A ocorrência copia descrição, valor, categoria, pagamento e observação da recorrência no momento da geração.

Editar a recorrência muda os próximos meses ainda não gerados. A opção **Aplicar valores também à ocorrência do mês selecionado** altera a cópia atual. Ocorrências históricas permanecem independentes. Excluir uma recorrência não apaga ocorrências já geradas.

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

1. Clique em **Exportar backup completo** para salvar JSON.
2. Para proteção adicional, marque a opção de senha e use pelo menos 8 caracteres.
3. Guarde o arquivo fora da pasta de downloads se ele for importante.
4. Para restaurar, selecione o JSON e clique em **Revisar arquivo**.
5. Confira o resumo e escolha:
   - **Mesclar**: registros com o mesmo `id` são atualizados, sem duplicação;
   - **Substituir**: apaga os dados atuais e importa apenas o arquivo.
6. Faça um backup atual antes de usar **Substituir**.

Se a senha de um backup protegido for perdida, não há recuperação. A criptografia usa PBKDF2 com SHA-256 e 250.000 iterações para derivar uma chave AES-GCM de 256 bits.

## Exportar CSV

Escolha todos os meses ou apenas o mês selecionado e filtre por receitas/despesas. O arquivo usa UTF-8 com BOM e separador `;`, adequado ao padrão de planilhas em português do Brasil.

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
- prevenção de ocorrências duplicadas;
- validação de backup;
- mesclagem por identificador;
- filtro mensal.

Abra `/tests/` pelo mesmo servidor local. O resultado esperado é `12 de 12 testes passaram`.

## Compatibilidade e limites

Prioriza versões modernas de Chrome, Edge, Firefox, Safari e navegadores móveis. O botão de instalação depende do suporte do navegador. IndexedDB é obrigatório; se ele estiver desativado ou indisponível, a interface mostrará uma mensagem de erro. A versão inicial não inclui investimentos, juros, parcelamento de fatura ou integração bancária.

## Licença

MIT. Consulte `LICENSE`.
