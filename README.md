# STEAM+ Sparky — frontend

Interface web estática do laboratório virtual STEAM+. Não exige etapa de compilação.

## Execução local

Sirva a pasta com um servidor HTTP, por exemplo:

```bash
python -m http.server 5500
```

Depois acesse `http://localhost:5500`.

Por padrão, a aplicação usa `https://steambot-backend.onrender.com`. Para apontar para outro ambiente, defina antes de `script.js`:

```html
<script>
  window.STEAMBOT_CONFIG = { backendUrl: "http://localhost:5000" };
</script>
```

## Organização

- `index.html`: estrutura semântica e componentes da interface.
- `style.css`: tokens visuais, layout, componentes e responsividade.
- `script.js`: estado da sessão, Socket.IO, mensagens, sanitização e interações.

As respostas em Markdown são sanitizadas com DOMPurify antes de entrarem no DOM. Mensagens do usuário são sempre renderizadas como texto.
