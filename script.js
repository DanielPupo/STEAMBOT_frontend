// Atualize para a URL do seu backend no Render
const URL_BACKEND = ''; 

document.addEventListener('DOMContentLoaded', () => {
    let socket = null;

    const chatBox = document.getElementById('chat-box');
    const messageInput = document.getElementById('message-input');
    const sendButton = document.getElementById('send-button');
    const connectionStatus = document.getElementById('connection-status');
    const iniciarBtn = document.getElementById('iniciarBtn');
    const encerrarBtn = document.getElementById('encerrarBtn');
    const limparBtn = document.getElementById('limparBtn');

    let userSessionId = null;

    // Adiciona mensagens no chat com estética limpa e funcional
    function addMessageToChat(sender, text, type = 'normal') {
        const messageElement = document.createElement('div');
        messageElement.classList.add('message');

        if (sender.toLowerCase() === 'user') {
            messageElement.classList.add('user-message');
            sender = 'Você';
        } else if (sender.toLowerCase() === 'bot') {
            messageElement.classList.add('bot-message');
            sender = "Sparky";
        } else {
            messageElement.classList.add('status-message');
        }

        if (type === 'error') {
            messageElement.classList.add('error-text');
            sender = 'Erro';
        } else if (type === 'status') {
            messageElement.classList.add('status-text');
            sender = 'Laboratório';
        }

        const senderSpan = document.createElement('strong');
        senderSpan.textContent = `${sender}: `;
        messageElement.appendChild(senderSpan);

        const textSpan = document.createElement('span');
        
        if (type === 'normal') {
            textSpan.innerHTML = marked.parse(text);
        } else {
            textSpan.textContent = text;
        }
        
        messageElement.appendChild(textSpan);
        chatBox.appendChild(messageElement);
        chatBox.scrollTop = chatBox.scrollHeight;
    }

    function setChatEnabled(enabled) {
        messageInput.disabled = !enabled;
        sendButton.disabled = !enabled;
    }

    // Estado inicial de espera
    setChatEnabled(false);
    connectionStatus.textContent = 'Aguardando Inicialização';
    connectionStatus.className = 'status-offline';
    addMessageToChat('Status', 'Seja bem-vindo ao STEAM+ Hub. Clique em "Iniciar Sparky" para ativar o assistente.', 'status');

    // Conectar ao servidor Socket.IO
    function iniciarConversa() {
        if (socket && socket.connected) return;

        // Adicionado parâmetros de estabilidade para funcionar perfeitamente no Render e Vercel
        socket = io(URL_BACKEND, {
            transports: ['websocket', 'polling'],
            secure: true
        });

        socket.on('connect', () => {
            connectionStatus.textContent = 'Sparky Conectado';
            connectionStatus.className = 'status-online';
            addMessageToChat('Status', 'Conexão estabelecida com a Central STEAM+.', 'status');
            setChatEnabled(true);
        });

        socket.on('disconnect', () => {
            connectionStatus.textContent = 'Sessão Encerrada';
            connectionStatus.className = 'status-offline';
            addMessageToChat('Status', 'Sua sessão com o Sparky foi encerrada.', 'status');
            setChatEnabled(false);
        });

        socket.on('connect_error', (error) => {
            connectionStatus.textContent = 'Erro de Conexão';
            connectionStatus.className = 'status-offline';
            addMessageToChat('Status', 'Não foi possível conectar ao servidor do Sparky. Verifique a internet ou o backend.', 'status');
            setChatEnabled(false);
            console.error('Socket.IO connect_error:', error);
        });

        socket.on('connect_timeout', () => {
            connectionStatus.textContent = 'Tempo Esgotado';
            connectionStatus.className = 'status-offline';
            addMessageToChat('Status', 'A conexão demorou demais. Tente novamente mais tarde.', 'status');
            setChatEnabled(false);
        });

        socket.on('status_conexao', (data) => {
            if (data.session_id) { userSessionId = data.session_id; }
        });

        socket.on('nova_mensagem', (data) => {
            addMessageToChat(data.remetente, data.texto);
        });

        socket.on('erro', (data) => {
            addMessageToChat('Erro', data.erro, 'error');
        });
    }

    function encerrarConversa() {
        if (socket && socket.connected) {
            socket.disconnect();
            setChatEnabled(false);
        }
    }

    function limparTela() {
        chatBox.innerHTML = '';
        addMessageToChat('Status', 'Histórico de mensagens limpo.', 'status');
    }

    function sendMessageToServer() {
        const messageText = messageInput.value.trim();
        if (messageText === '') return;

        if (socket && socket.connected) {
            addMessageToChat('user', messageText);
            socket.emit('enviar_mensagem', { mensagem: messageText });
            messageInput.value = '';
            messageInput.focus();
        } else {
            addMessageToChat('Erro', 'Conexão indisponível no momento.', 'error');
        }
    }

    iniciarBtn.addEventListener('click', iniciarConversa);
    encerrarBtn.addEventListener('click', encerrarConversa);
    limparBtn.addEventListener('click', limparTela);
    sendButton.addEventListener('click', sendMessageToServer);

    messageInput.addEventListener('keypress', (event) => {
        if (event.key === 'Enter') { sendMessageToServer(); }
    });
});