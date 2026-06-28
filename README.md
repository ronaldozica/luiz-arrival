# 🕐 Que horas o Luiz chega?
> Sistema de apostas estilo Windows 95 para o jogo diário do escritório — com loja, conquistas, rankings e minigames.

---

## 📁 Estrutura do projeto

```
luiz-arrival/
├── api/
│   ├── index.js              ← Backend (Express, serverless na Vercel)
│   ├── routes/                ← auth, bets, admin, game-rank, leaderboards,
│   │                            store, profile, achievements
│   └── lib/                   ← redis, session, users, cache, jogos,
│                                conquistas, itens da loja, etc.
├── public/
│   ├── index.html             ← Frontend (Windows 95 UI)
│   ├── style.css              ← Visual retrô
│   ├── js/
│   │   ├── app.js             ← Lógica principal do frontend
│   │   └── snake.js, aimtrainer.js, minesweeper.js, sudoku.js, spider.js,
│   │       notepad.js, calculator.js, paint.js  ← minigames e apps
│   └── assets/                ← fotos, wallpapers, ícones
├── .env.local                 ← Variáveis de ambiente (não versionado)
├── .gitignore
├── package.json
├── vercel.json                ← Configuração de roteamento
└── README.md
```

---

## ⚙️ Pré-requisitos

- [Node.js 18+](https://nodejs.org/)
- [Conta na Vercel](https://vercel.com/) (gratuita)
- [Vercel CLI](https://vercel.com/docs/cli): `npm i -g vercel`
- Uma conta no GitHub (recomendado para deploy)

---

## 🚀 Passo a passo: Deploy na Vercel

### 1. Crie o banco de dados KV na Vercel

1. Acesse [vercel.com](https://vercel.com) → faça login
2. No Dashboard, clique em **Storage** (menu lateral)
3. Clique em **Create Database** → escolha **KV (Redis)**
4. Dê um nome (ex: `luiz-arrival-db`) → clique **Create**
5. Copie os valores de `KV_REST_API_URL` e `KV_REST_API_TOKEN`

### 2. Gere o hash da senha de admin

A senha do painel admin nunca é armazenada em texto puro — só o hash bcrypt:

```bash
node -e "const b=require('bcryptjs'); console.log(b.hashSync('SUA_SENHA_FORTE', 12))"
```

Guarde o resultado para usar como `ADMIN_PASSWORD_HASH`.

### 3. Faça o deploy

**Via GitHub (mais fácil):**
1. Acesse o Vercel Dashboard → **Add New Project**
2. Importe o repositório do GitHub
3. Em **Environment Variables**, adicione:
   - `KV_REST_API_URL`
   - `KV_REST_API_TOKEN`
   - `ADMIN_PASSWORD_HASH` → hash gerado no passo anterior
4. Clique **Deploy** ✅

**Via CLI:**
```bash
cd luiz-arrival
npm install
vercel login
vercel link          # conecta ao projeto na Vercel
vercel env pull       # baixa as env vars do KV automaticamente (se linkou o banco)
# Adicione manualmente ADMIN_PASSWORD_HASH no .env.local
vercel --prod         # faz o deploy
```

### 4. Desenvolvimento local

```bash
npm install
vercel dev            # roda localmente em http://localhost:3000, lendo .env.local
```

---

## 🎮 Como usar

### Apostas
- **🎯 Fazer Aposta** — escolha o horário que acha que o Luiz vai chegar (dias úteis, antes das 10h ou antes da chegada real). Dá pra atualizar o chute antes do prazo.
- **📋 Apostas abertas** / **📅 Histórico** / **🏆 Ranking** — acompanhe o dia atual, dias passados e o ranking semanal/geral.
- **🔒 Admin** → registra o horário real de chegada e calcula o ranking do dia automaticamente.

### Cadastro e login
- Não há mais usuários fixos no código — qualquer um se cadastra pelo botão **👤 Novo Usuário**, com senha (hash bcrypt). Esqueceu a senha? Tem fluxo de redefinição via senha temporária liberada pelo admin.

### Minigames
- 🐍 **Snake 95**, 💣 **Campo Minado**, 🔢 **Sudoku**, 🔫 **Aim Trainer** (teste de mira/reação) e 🕷️ **Paciência Spider** — cada um com ranking próprio por dificuldade, ganha LuizCoins™ ao jogar (com teto diário) e desbloqueia conquistas.
- **🎮 Rank Jogos**, **🏅 Top 1 dos Jogos** e **🎖️ Rank de Conquistas** — rankings agregados entre todos os jogos.
- Pontuações são protegidas contra trapaça: cada partida usa um token de rodada emitido pelo servidor, que valida se o tempo decorrido é compatível com o score enviado antes de aceitar o resultado.

### Loja e perfil
- **🛒 Loja** — troque LuizCoins™ por cores de nome, emojis de ranking e GIFs especiais.
- **🏅 Conquistas** — destrave badges e exiba sua favorita ao lado do nome.
- **🧑‍🎨 Perfil** — personalize como seu nome aparece nos rankings.

### Outros apps
- 📝 Bloco de Notas, 🧮 Calculadora, 🎨 Paint 95 — utilitários decorativos do desktop.

---

## 📊 Sistema de pontuação (apostas)

| Critério | Detalhes |
|---|---|
| **Pontos diários** | O 1º colocado do dia recebe N pontos (onde N = total de apostadores), 2º recebe N-1, etc. |
| **Ranking semanal/geral** | Soma/média de pontos por dia jogado |
| **Desempate** | Quem tem menor diferença em relação ao horário real fica à frente |
| **Anti-sniping** | Apostas feitas muito perto do horário real de chegada não contam para pódio/precisão |

Detalhes completos (inclusive da economia da loja e cálculo de moedas) estão no app **📐 Regras de Pontuação**, dentro do próprio site.

---

## 👥 Usuários

Não há mais lista fixa de usuários ou senhas no código/documentação — todo cadastro é feito pelo próprio site (botão **👤 Novo Usuário**), com senha protegida por hash bcrypt. O admin pode resetar senhas esquecidas via senha temporária.

---

## 🔒 Painel Admin

- Acesso: menu Iniciar → Admin
- Senha: validada contra `ADMIN_PASSWORD_HASH` (variável de ambiente, nunca texto puro)
- Funções: registrar chegada do Luiz, gerenciar usuários e senhas temporárias, ajustar LuizCoins, remover registros de ranking suspeitos de trapaça (por jogo/dificuldade), consultar saldo geral.

---

## 🗄️ Banco de dados (Vercel KV)

- **Gratuito** no plano Hobby da Vercel/Upstash
- **Zero configuração** — gerenciado pela Vercel
- Leituras pesadas (rankings agregados, histórico) são cacheadas sob chaves dedicadas (`api/lib/cache.js`) para minimizar o consumo de comandos do plano gratuito

---

## 🛠️ Personalização

### Trocar tema de cores
Em `public/style.css`, edite as variáveis CSS no `:root`.

### Trocar horário de corte das apostas (10h)
Em `api/routes/bets.js`, busque por `"10:00"`.

### Itens da loja
Edite `STORE_ITEMS` em `api/lib/store-items.js` (preços antigos ficam preservados em `LEGACY_STORE_PRICES` — não altere esses valores, eles só existem para não mudar retroativamente o que já foi pago).

---

## ❓ Problemas comuns

| Problema | Solução |
|---|---|
| `KV_REST_API_URL is not defined` | Confirme que as env vars estão configuradas no projeto Vercel/`.env.local` |
| Login de admin não funciona | Confirme que `ADMIN_PASSWORD_HASH` é um hash bcrypt válido, não a senha em texto puro |
| Apostas não aparecem | Verifique se o banco KV está vinculado ao projeto |
| `vercel dev` não funciona | Execute `vercel link` primeiro para conectar ao projeto |
