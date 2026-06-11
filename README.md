# 🕐 Que horas o Luiz chega?
> Sistema de apostas estilo Windows 95 para o jogo diário do escritório.

---

## 📁 Estrutura do projeto

```
luiz-arrival/
├── api/
│   └── index.js          ← Backend (Express, serverless na Vercel)
├── public/
│   ├── index.html         ← Frontend (Windows 95 UI)
│   ├── style.css          ← Visual retrô
│   ├── app.js             ← Lógica do frontend
│   └── photos/            ← Fotos dos usuários (você coloca aqui)
│       └── LEIA-ME.txt
├── .env.example           ← Variáveis de ambiente de exemplo
├── .gitignore
├── package.json
├── vercel.json            ← Configuração de roteamento
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

### 1. Clone / copie o projeto

```bash
# Se quiser versionar no GitHub (recomendado):
git init
git add .
git commit -m "primeiro commit"
# Crie um repositório no GitHub e siga as instruções para push
```

### 2. Crie o banco de dados KV na Vercel

1. Acesse [vercel.com](https://vercel.com) → faça login
2. No Dashboard, clique em **Storage** (menu lateral)
3. Clique em **Create Database** → escolha **KV (Redis)**
4. Dê um nome (ex: `luiz-arrival-db`) → clique **Create**
5. Na tela do banco, vá em **`.env.local`** e copie os valores de:
   - `KV_REST_API_URL`
   - `KV_REST_API_TOKEN`

### 3. Faça o deploy

**Via GitHub (mais fácil):**
1. Acesse o Vercel Dashboard → **Add New Project**
2. Importe o repositório do GitHub
3. Em **Environment Variables**, adicione:
   - `KV_REST_API_URL` → valor copiado no passo 2
   - `KV_REST_API_TOKEN` → valor copiado no passo 2
   - `ADMIN_PASSWORD` → senha que só você sabe (ex: `luiz2025`)
4. Clique **Deploy** ✅

**Via CLI:**
```bash
cd luiz-arrival
npm install
vercel login
vercel link          # conecta ao projeto na Vercel
vercel env pull      # baixa as env vars do KV automaticamente (se linkou o banco)
# Adicione manualmente ADMIN_PASSWORD no .env.local
vercel --prod        # faz o deploy
```

### 4. (Opcional) Desenvolvimento local

```bash
cp .env.example .env.local
# Edite .env.local com os valores do KV e a ADMIN_PASSWORD
npm install
vercel dev           # roda localmente em http://localhost:3000
```

---

## 📸 Adicionar fotos dos usuários

Coloque arquivos de imagem na pasta `public/photos/` com os seguintes nomes **exatos**:

| Usuário    | Nome do arquivo  |
|------------|-----------------|
| Ronaldo    | `ronaldo.jpg`   |
| Jorge      | `jorge.jpg`     |
| Alexandre  | `alexandre.jpg` |
| João Paulo | `joaopaulo.jpg` |
| Julio      | `julio.jpg`     |
| Pedro      | `pedro.jpg`     |

- Formatos aceitos: `.jpg`, `.jpeg`, `.png`, `.webp`
- Tamanho recomendado: mínimo 100×100 px (será exibido em 64×64 px)
- Após adicionar, faça um novo commit/deploy

> Para novos usuários cadastrados via formulário, não há foto (exibe só o nome).

---

## 🎮 Como usar

### Fazer uma aposta
1. Clique em **🎯 Fazer Aposta** (ou duplo clique no ícone do desktop)
2. Selecione seu nome na lista
3. Digite sua senha
4. Escolha o horário que acha que o Luiz vai chegar
5. Clique **Apostar!**

> Apostas só são aceitas em **dias úteis** e **antes das 10h** (ou antes de o Luiz chegar).
> Se já apostou hoje, pode atualizar o chute antes do prazo.

### Ver apostas de hoje
- Clique em **📋 Apostas de Hoje** — mostra todos os chutes do dia e resultado se já chegou.

### Histórico
- Clique em **📅 Histórico** — lista dias passados com resultados e rankings.

### Ranking Geral
- Clique em **🏆 Ranking Geral** — ranking acumulado do último mês.

### Registrar chegada do Luiz (Admin)
1. Clique em **🔒 Admin** (via menu Iniciar ou na URL `/admin`)
2. Digite a senha admin
3. Informe o horário de chegada do Luiz
4. Clique **Registrar Chegada** — o sistema calcula automaticamente o ranking do dia

---

## 📊 Sistema de pontuação

| Critério | Detalhes |
|---|---|
| **Pontos diários** | O 1º colocado do dia recebe N pontos (onde N = total de apostadores), 2º recebe N-1, etc. |
| **Ranking geral** | Soma de pontos de todos os dias do último mês |
| **Desempate** | Quem tem menor diferença média (erro médio) fica à frente |
| **Erro médio** | Média da diferença em minutos entre o chute e a chegada real |

---

## 👥 Usuários pré-definidos

| Nome | Senha |
|------|-------|
| Ronaldo | rolando |
| Jorge | jog |
| Alexandre | rock |
| João Paulo | joaoPedro |
| Julio | julho |
| Pedro | pedrao |

Para adicionar novos usuários, use o botão **👤 Novo Usuário** no site.

---

## 🔒 Painel Admin

- URL: qualquer janela → menu Iniciar → Admin
- Senha: definida na variável de ambiente `ADMIN_PASSWORD`
- Funções:
  - Registrar horário de chegada do Luiz (hoje ou data passada)
  - Ver resultado imediato com ranking do dia

---

## 🗄️ Banco de dados (Vercel KV)

- **Gratuito** no plano Hobby da Vercel (até 30.000 req/mês)
- **Zero configuração** — gerenciado pela Vercel
- Armazena apenas os últimos **22 dias úteis** (≈1 mês)
- Dados salvos:
  - `users` — usuários extras cadastrados pelo site
  - `day:YYYY-MM-DD` — apostas e resultado de cada dia
  - `days_index` — índice de datas para consulta do histórico

---

## 🛠️ Personalização

### Trocar usuários pré-definidos
Edite o array `PRESET_USERS` no arquivo `api/index.js`:
```js
const PRESET_USERS = [
  { name: "Novo Nome", password: "senha", photo: "arquivo.jpg" },
  // ...
];
```

### Trocar horário de corte (10h)
Em `api/index.js`, busque por `"10:00"` e altere conforme necessário.

### Trocar tema de cores
Em `public/style.css`, edite as variáveis CSS no `:root`.

---

## ❓ Problemas comuns

| Problema | Solução |
|---|---|
| `KV_REST_API_URL is not defined` | Confirme que as env vars estão configuradas no projeto Vercel |
| Apostas não aparecem | Verifique se o banco KV está vinculado ao projeto |
| Foto não aparece | Confirme o nome exato do arquivo em `public/photos/` |
| `vercel dev` não funciona | Execute `vercel link` primeiro para conectar ao projeto |
