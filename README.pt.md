# AgentMeter

Aplicação de bandeja para Windows que acompanha os limites de uso das assinaturas de **Claude Code, Codex, Antigravity, Grok e Grok Bot**. Veja suas contas em um Dashboard, um Widget de desktop ou uma Strip compacta, sem gerenciar credenciais em outro serviço na nuvem.

**Versão atual do código: 0.0.1** · Windows 10/11 · Tauri + WebView2 · MIT

[English](./README.md) · [Español](./README.es.md) · [Português](./README.pt.md) · [Italiano](./README.it.md) · [Deutsch](./README.de.md) · [繁體中文](./README.zh-TW.md)

[Recursos](#features) · [Configuração](#installation) · [Contas](#accounts) · [Widget / Strip](#widget-strip) · [Compilar e testar](#development)

<a id="features"></a>
## Recursos

- **Cinco provedores**, com atualizações independentes, mensagens de configuração/estado, leituras em cache e tratamento de novas tentativas e esperas. Um provedor indisponível não bloqueia os demais.
- **Quatro páginas no Dashboard:** Home, Services, Statistics e Settings; barra lateral apenas com ícones, descrições traduzidas, navegação por teclado e nomes acessíveis nos controles.
- **Várias contas Claude/Codex:** perfis isolados, login pelas CLI oficiais, novos terminais específicos de cada conta, cotas/cache/esperas independentes e uma conta selecionada por provedor na Strip.
- **Detalhes das cotas:** períodos informados, percentuais usados/restantes, plano, contagem regressiva para reinicialização, indicadores de ritmo e detalhamento por provedor/produto quando disponível.
- **Widget Neon:** janela transparente, sempre no topo, nomes das contas, anéis percentuais, barras de sessão, colunas 5h/7d alinhadas e pequenas contagens regressivas. Contas adicionais aparecem por rolagem interna.
- **Escala do Widget:** começa em **100%**, ajustável até **300%** em **passos de 25%**, além da escala DPI do Windows. A escala salva não amplia a Strip.
- **Strip compacta:** contas selecionadas e nomes abreviados dos provedores; pode ser arrastada livremente ou fixada acima da barra de tarefas, sem reservar área de trabalho.
- **Controles de visibilidade:** ocultar provedores pausa suas consultas; o grupo Claude+GPT do Antigravity pode ser ocultado/exibido sem alterar as leituras originais.
- **Preferências persistentes:** idioma, exibição usada/restante, modo de visualização, escala do Widget, bloqueio, posições separadas de Widget/Strip e fixação à barra de tarefas.
- **Bandeja e inicialização:** abrir Dashboard, mostrar/ocultar visualizações, bloquear posição, iniciar ao entrar no Windows e sair. A restauração das visualizações salvas é repetida enquanto desktop e monitores inicializam.
- **Temas claro/escuro e cinco idiomas de interface**, aplicados ao Dashboard, Widget, Strip e menu da bandeja. O tema do sistema é seguido até uma escolha explícita.
- **Consultas conservadoras ao Claude:** pausa com Windows inativo/bloqueado, respeita esperas do servidor mesmo após reiniciar e tenta recuperação pela CLI oficial quando um access token é rejeitado.
- **Integração local:** usa sessões existentes de desktop/CLI. Antigravity utiliza seu IDE ou servidor local `agy`; não exige extensão de navegador, conta AgentMeter ou telemetria.

<a id="screenshots"></a>
## Capturas de tela

### Dashboard
<p align="center"><img src="./assets/screenshots/dashboard.png" alt="Dashboard real do AgentMeter no tema escuro" width="644"></p>

### Widget
<p align="center"><img src="./assets/screenshots/widget.png" alt="Widget Neon do AgentMeter com várias contas" width="640"></p>

### Strip
<p align="center"><img src="./assets/screenshots/strip.png" alt="Strip compacta do AgentMeter" width="500"></p>

Capturas reais do **AgentMeter**, não simulações: Dashboard com a largura padrão de 644 px e Widget em 100%. As leituras e os períodos disponíveis dependem das contas conectadas e de seus planos; as imagens não representam cotas fixas de exemplo.

<a id="providers"></a>
## Provedores compatíveis

| Provedor | Informações exibidas quando fornecidas | Fonte necessária |
|---|---|---|
| **Claude** | Limites de sessão/5 horas, semanais e por modelo; plano e reinicializações | Perfil Claude Code com sessão iniciada |
| **Codex** | Sessão/5 horas e períodos semanais ou mensais, conforme plano/conta | Codex Desktop ou perfil Codex CLI com sessão iniciada |
| **Antigravity** | Grupos Gemini e Claude+GPT, com períodos de 5 horas/semanais | Antigravity IDE **ou CLI independente `agy`**, com sessão iniciada e em execução |
| **Grok** | Cota da assinatura e detalhamento por produto quando fornecido | Perfil Grok Build CLI com sessão iniciada |
| **Grok Bot** | Cota semanal independente | Aplicação desktop Grok Bot com sessão iniciada |

AgentMeter mostra os dados disponíveis sem inventar períodos ausentes. Um cartão Codex apenas semanal usa toda a área de cota. O Widget oculta contas/provedores sem leituras utilizáveis; Home pode manter cartões de configuração/erro. Provedores ocultados explicitamente não são consultados.

<a id="installation"></a>
## Instalação e configuração dos provedores

1. Baixe um instalador disponível em [GitHub Releases](https://github.com/carlos-mto/AgentMeter/releases) ou [compile o código atual](#development). Se ainda não houver instalador, compile a partir do código-fonte.
2. Execute o instalador e abra **AgentMeter**. A versão atual gera `AgentMeter_0.0.1_x64-setup.exe` e `agentmeter.exe`.
3. Conclua o login/configuração dos provedores utilizados. Fechar o Dashboard mantém a aplicação na bandeja; **Quit** encerra o processo.

**Windows 10/11 e Microsoft Edge WebView2 Runtime são necessários.** Para compilar, também são necessárias as ferramentas abaixo. Os builds atuais não têm assinatura de código; use arquivos de origem/releases confiáveis.

- **Claude:** instale Claude Code se necessário, execute `claude` e entre na conta. A CLI não precisa continuar aberta nas consultas normais.
- **Codex:** entre no Codex Desktop para a conta atual ou use **Services → Accounts → Sign in** para um perfil CLI separado. A CLI oficial `codex` é necessária para esse botão e **Open CLI**.
- **Antigravity:** mantenha o IDE ou uma sessão de terminal `agy` autenticada em execução. AgentMeter descobre seu servidor em `127.0.0.1`; não há configuração manual de porta/token. Com `agy`, o IDE não é necessário. Se ambos estiverem ativos, o IDE é preferido. Sem nenhum deles, períodos em cache ainda válidos podem permanecer por até 24 horas.
- **Grok Bot:** instale a [aplicação desktop](https://docs.x.ai/grok-bot/get-started) e entre na conta. A cota é independente de Grok/SuperGrok. Reabra quando AgentMeter solicitar novos dados de sessão.
- **Grok:** instale Grok Build e entre na conta uma vez. Reabra se AgentMeter solicitar novos dados de sessão.

Os modelos Gemini continuam disponíveis pelos **grupos de cota do Antigravity**, não como um provedor independente.

<a id="dashboard"></a>
## Navegação no Dashboard

A janela padrão mede **644 × 840 pixels lógicos**. Pode ser reduzida até **380 × 520**, com cartões responsivos e uma **barra de ícones de 68 px**. Passe o cursor sobre um ícone para ver sua descrição traduzida; atalhos de tema e idioma ficam perto da parte inferior.

| Página | Finalidade |
|---|---|
| **Home** | Cartões por provedor/conta, períodos reais, plano/estado, reinicializações, ritmo e detalhamento. Atualização manual e visibilidade das fontes. |
| **Services** | Local único para gerenciar contas, selecionar a conta da Strip, controlar visibilidade, verificar conexão e consultar orientações de configuração. |
| **Statistics** | Tabela do estado atual das cotas, com valores usados/restantes e indicação de cache, respeitando a visibilidade de provedores/grupos. Sem consultas extras, gráficos históricos ou médias entre grupos sem relação. |
| **Settings** | Aparência global, atalhos de idioma e exibição usada/restante; os controles de contas ficam em Services e não são duplicados aqui. |

O **botão de olho Claude+GPT do Antigravity** oculta/restaura esse grupo em todas as visualizações. Quando oculto, Widget/Strip usam os períodos Gemini de **5h / 7d**. A preferência não altera as consultas nem os dados originais do provedor.

<a id="accounts"></a>
## Várias contas Claude e Codex

1. Abra **Services → Accounts**. As contas são agrupadas por provedor.
2. Escolha Claude ou Codex e clique em **Add account**; após o login, a conta mostra o nome de usuário das suas credenciais (até lá é numerada, p. ex. "Conta 2").
3. Deixe o diretório vazio para criar um perfil isolado ou informe um **diretório de configuração absoluto** existente, não um arquivo de credenciais.
4. Use **Sign in** para autenticar pela CLI oficial. AgentMeter não copia credenciais entre perfis.

| Ação / comportamento | Resultado |
|---|---|
| **Open CLI** | Abre um novo terminal apenas com `CLAUDE_CONFIG_DIR` ou `CODEX_HOME` desse perfil; terminais existentes e ambiente global não mudam. |
| **Check accounts** | Consulta perfis habilitados respeitando esperas e agendamento. Claude mantém o intervalo mínimo de seis minutos e a pausa por inatividade/bloqueio. |
| **Selected for Strip** | Seleciona uma conta por provedor na Strip sem ocultar as demais de Home/Statistics/Widget. |
| **Remove** | Remove o registro do perfil, mantendo seus arquivos e sessões em execução. |
| **Current account** | Perfil padrão implícito, que respeita variáveis de ambiente existentes ou `~/.claude` / `~/.codex`; não pode ser removido. |

Cada perfil tem estado de cota/cache/espera independente. Nomes locais disponíveis têm preferência sobre os aliases; o Widget os mostra menores e em minúsculas. Domínios de e-mail e tokens não são exibidos nem armazenados no registro de perfis. Ocultar um provedor pausa todas as suas contas. O botão **Accounts** do Widget abre Services diretamente.

O gerenciamento de várias contas abrange atualmente **somente Claude e Codex**. Outros provedores mantêm o comportamento de conta única; não existe rotação automática de contas.

<a id="widget-strip"></a>
## Widget e Strip

Use os botões da barra lateral ou o menu da bandeja para escolher uma visualização auxiliar.

### Widget

- Sem bordas, transparente e sempre no topo, com o ícone de medidor do AgentMeter e layout Neon.
- Mostra todas as contas Claude/Codex com dados utilizáveis, anéis percentuais, barras de sessão e colunas **5h / 7d** alinhadas. Uma conta apenas semanal deixa a coluna 5h vazia; pequenas contagens regressivas aparecem abaixo das leituras.
- Contas/provedores não configurados ou sem dados utilizáveis são ocultados e reaparecem quando chegam leituras válidas. Linhas adicionais usam rolagem interna.
- Arraste o cabeçalho para mover; use o controle de bloqueio para impedir movimento.
- **− / +** ajusta **100–300%** em **passos de 25%**. O valor é salvo; a escala DPI do Windows também se aplica.
- **Accounts** abre Services; **Open dashboard** abre os detalhes sem ocultar o Widget.

### Strip

- Barra horizontal compacta com uma conta Claude/Codex selecionada por provedor, nomes abreviados, percentuais e descrições de reinicialização ao passar o cursor.
- Como o Widget, oculta provedores cuja conta selecionada ainda não tem uma leitura utilizável (não configurado, indisponível, com erros ou que exigem login); consulte esses estados no Dashboard.
- Mantém sua escala compacta original, independente da ampliação do Widget.
- Arraste fora dos controles para mover. Use o controle de alfinete para mantê-la acima de uma barra de tarefas e arraste até uma área livre dessa barra.
- A fixação não reserva área de trabalho. A sobreposição cede quando a barra de tarefas é ocultada automaticamente ou outra aplicação está em tela cheia.

Widget e Strip salvam **posições separadas**. **Open dashboard** preserva a visibilidade da visualização e a fixação; **Hide** ou desmarcar a opção na bandeja a oculta. Ambos reutilizam dados do Dashboard, sem consultas adicionais de cota.

<a id="tray"></a>
## Bandeja e inicialização automática

Clique com o botão esquerdo no ícone da bandeja para alternar a visibilidade do Dashboard. Com o botão direito, use **Open dashboard**, **Show widget**, **Show strip**, **Lock widget position**, **Launch at startup** e **Quit**.

Ative **Launch at startup** se desejar. Antes de sair, selecione Widget ou Strip caso essa visualização deva retornar ao entrar no Windows. A inicialização usa `--hidden`: o Dashboard permanece fechado e modo, escala e posição são restaurados com novas tentativas enquanto desktop/monitores inicializam. Se nenhuma visualização auxiliar estiver habilitada, iniciar apenas na bandeja é intencional.

<a id="appearance"></a>
## Aparência e idioma

- **Tema:** claro e escuro em toda a aplicação; segue o sistema até uma escolha explícita. O Widget mantém o estilo Neon e a janela transparente; textos e controles não ficam esmaecidos.
- **Exibição da cota:** escolha **Used** ou **Remaining**, de modo consistente no Dashboard, Statistics, Widget e Strip.
- **Idiomas da interface:** **English, Español, Português, Italiano e Deutsch**. Altere **Language** no canto superior direito ou pelo atalho da barra lateral/Settings. A escolha é salva e aplicada também à bandeja.
- No primeiro uso, um idioma compatível do Windows é detectado; caso contrário, usa-se inglês. Nomes dos provedores e diagnósticos técnicos brutos mantêm o texto original.

A documentação está disponível em inglês, espanhol, português, italiano, alemão e chinês tradicional. O README em chinês **não** significa que a interface em chinês esteja implementada.

<a id="privacy"></a>
## Privacidade, dados locais e compatibilidade

Sem telemetria, análise de uso ou conta AgentMeter na nuvem. As consultas acessam os provedores com sessões locais compatíveis; não existe serviço AgentMeter de envio/sincronização de dados.

- AgentMeter lê credenciais de acesso existentes de desktop/CLI quando necessário, mas não utiliza refresh tokens dos provedores. Após um `401` do Claude, tenta recuperação por `claude update` e relê o access token; esse comando pode atualizar o próprio Claude Code.
- Antigravity é consultado pelo servidor local do IDE/`agy`, sem gerenciar uma sessão Google.
- O access token de curta duração do Grok Bot é desbloqueado localmente com Windows DPAPI para a consulta; seu refresh token não é descriptografado, usado, salvo em cache ou enviado pelo AgentMeter.
- Adicionar um perfil não copia credenciais; removê-lo não exclui os arquivos da conta.

A pasta de dados é **`%LOCALAPPDATA%\stackly-agent-manager`**. Diretórios externos das CLI não mudam:

| Local / identidade | Finalidade |
|---|---|
| `accounts.json` | Aliases, caminhos de configuração e contas selecionadas para a Strip, não credenciais. |
| `accounts/<provider>/<id>` | Diretórios padrão de perfis isolados; as CLI oficiais gerenciam suas sessões. |
| `widget.json` | Preferências de visualização/idioma e posições salvas. |
| `provider-cache` | Estado de cotas/esperas e diagnósticos limitados. |

<a id="troubleshooting"></a>
## Resolução de problemas

| Sintoma | O que verificar |
|---|---|
| Provedor/conta ausente do Widget | Habilite o provedor em Services e conclua o login. O Widget precisa de leituras utilizáveis; Home pode mostrar configuração/erro. |
| Widget/Strip não retorna ao entrar no Windows | Ative **Launch at startup** e salve o modo desejado, não apenas Dashboard. Aguarde a recuperação de desktop/monitores; abra pela bandeja se necessário. |
| Grok ausente ou pedindo login | Instale/abra Grok Build, entre na conta e atualize o cartão. AgentMeter não renova o token da CLI por conta própria. |
| Claude limitado pelo servidor | Respeite a contagem regressiva. Atualização manual e **Check accounts** não contornam as esperas; reiniciar não as apaga. |
| Claude não atualiza com Windows inativo/bloqueado | Pausa intencional; ao retomar atividade, as consultas são adiadas para evitar uma sequência imediata. As esperas existentes continuam válidas. |
| Claude rejeita seu access token | A recuperação é tentada pela CLI oficial; se falhar, abra Claude Code e verifique o login. |
| Antigravity solicita um cliente | Mantenha IDE ou sessão `agy` autenticada em execução. Apenas instalar `agy` ou executar `agy --help` não basta. |
| Grok Bot solicita login | Reabra Grok Bot; seu novo access token de curta duração será lido numa consulta posterior. |
| Editor desconhecido no Windows | Os builds não têm assinatura de código; use releases confiáveis ou compile o código-fonte. |

<a id="limitations"></a>
## Limitações

- **Somente Windows**; este projeto não oferece atualmente builds macOS/Linux.
- Os endpoints dos provedores não são documentados; disponibilidade, planos e formatos podem mudar independentemente.
- Statistics é um retrato atual, não um histórico armazenado, relatório de cobrança por tokens ou previsão.
- Perfis de várias contas são compatíveis apenas com Claude/Codex; não há rotação automática.
- Existe uma única janela auxiliar: pode ser movida entre monitores, mas Widget/Strip **não é duplicado automaticamente em todos os monitores/barras de tarefas**.
- Dados em cache são identificados explicitamente e não garantem cotas em tempo real.

<a id="development"></a>
## Compilar e testar o código-fonte

### Requisitos

- Windows 10/11 e WebView2 Runtime.
- **Node.js 22+** com npm, também necessário nos probes nativos opcionais.
- **Rust stable**, com toolchain Windows MSVC.
- Visual Studio / Build Tools com **Desktop development with C++** e Windows 10/11 SDK.

Na raiz do repositório:

```powershell
npm ci
npm run tauri -- dev
```

Compile o instalador Windows:

```powershell
npm run tauri -- build --bundles nsis -- --locked
```

Arquivos gerados para 0.0.1:

```text
src-tauri/target/release/agentmeter.exe
src-tauri/target/release/bundle/nsis/AgentMeter_0.0.1_x64-setup.exe
```

Publicação: `npm run release` (ou `pwsh scripts/release.ps1 -DryRun` para ensaiar) executa os testes, compila o instalador NSIS, cria a tag `v<versão>` e publica o GitHub Release com o instalador e seu SHA-256. Requer `gh auth login`.

Execute os testes automáticos:

```powershell
npm test
cargo test --locked --manifest-path src-tauri/Cargo.toml
```

Os probes nativos opcionais de [Dashboard](./tests/smoke/dashboard.smoke.mjs) e [contas](./tests/smoke/accounts.smoke.mjs) exigem **CDP temporário apenas em loopback**; ele não é necessário no uso normal e não deve permanecer habilitado. Consulte a [arquitetura](./docs/architecture.md) para detalhes de implementação, políticas de consulta e integração nativa.

<a id="project"></a>
## Projeto e licença

- [Arquitetura](./docs/architecture.md)
- [Arquitetura Tauri + Rust + Windows](./docs/tauri-rust-windows-architecture.md)
- [Relatar um problema](https://github.com/carlos-mto/AgentMeter/issues)
- Inspirado em vários projetos e ferramentas da comunidade.

Distribuído sob a [licença MIT](./LICENSE).
