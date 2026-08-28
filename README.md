# STEAM+ Sparky — frontend

Interface web estática do laboratório virtual STEAM+. Não exige etapa de compilação.

## Execução local

Sirva a pasta com um servidor HTTP, por exemplo:

```bash
python -m http.server 5500
```

Depois acesse `http://localhost:5500`.

Por padrão, a aplicação usa `https://steambot-backend.onrender.com`. A plataforma autenticada também deve fornecer o perfil da conta antes de `script.js`:

```html
<script>
  window.STEAMBOT_CONFIG = {
    backendUrl: "http://localhost:5000",
    currentUser: { role: "student" } // ou "teacher"
  };
</script>
```

O perfil não é escolhido na interface. Valores ausentes ou desconhecidos usam o modo
`student`, evitando que opções de professor apareçam por engano. Em produção, preencha
`currentUser.role` usando os dados da sessão autenticada, nunca por parâmetro de URL.

## Organização

- `index.html`: estrutura semântica e componentes da interface.
- `style.css`: tokens visuais, layout, componentes e responsividade.
- `script.js`: estado da sessão, perfil autenticado, Socket.IO, mensagens, XP, sanitização e interações.

As respostas em Markdown são sanitizadas com DOMPurify antes de entrarem no DOM. Mensagens do usuário são sempre renderizadas como texto.
