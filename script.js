// ============================================================
// CONFIGURAÇÕES
// ============================================================

const URL_BACKEND = 'https://steambot-backend.onrender.com';


// ============================================================
// INICIALIZAÇÃO
// ============================================================

document.addEventListener('DOMContentLoaded', () => {

    let socket = null;
    let isProcessing = false;

    const chatBox = document.getElementById('chat-box');
    const messageInput = document.getElementById('message-input');
    const sendButton = document.getElementById('send-button');
    const connectionStatus = document.getElementById('connection-status');

    const iniciarBtn = document.getElementById('iniciarBtn');
    const encerrarBtn = document.getElementById('encerrarBtn');
    const limparBtn = document.getElementById('limparBtn');


    // ========================================================
    // MENSAGENS
    // ========================================================

    function addMessageToChat(sender, text, type = 'normal') {

        const messageElement = document.createElement('div');

        messageElement.classList.add('message');

        if (sender.toLowerCase() === 'user') {
            messageElement.classList.add('user-message');
            sender = 'Você';

        } else if (sender.toLowerCase() === 'bot') {
            messageElement.classList.add('bot-message');
            sender = 'Sparky';

        } else {
            messageElement.classList.add('status-message');
        }


        if (type === 'error') {
            messageElement.classList.add('error-text');
            sender = 'Erro';
        }


        if (type === 'status') {
            messageElement.classList.add('status-text');
            sender = 'Laboratório';
        }


        const senderSpan = document.createElement('strong');

        senderSpan.textContent = `${sender}: `;

        messageElement.appendChild(senderSpan);


        const textSpan = document.createElement('span');


        if (type === 'normal') {

            // O marked transforma Markdown em HTML.
            textSpan.innerHTML = marked.parse(text);

        } else {

            textSpan.textContent = text;
        }


        messageElement.appendChild(textSpan);

        chatBox.appendChild(messageElement);

        chatBox.scrollTop = chatBox.scrollHeight;
    }


    // ========================================================
    // CONTROLE DO CHAT
    // ========================================================

    function setChatEnabled(enabled) {

        messageInput.disabled = !enabled;
        sendButton.disabled = !enabled;

        if (!enabled) {
            isProcessing = false;
        }
    }


    function setProcessing(processing) {

        isProcessing = processing;

        if (processing) {

            messageInput.disabled = true;
            sendButton.disabled = true;
            sendButton.textContent = 'Sparky...';

        } else {

            const connected = socket && socket.connected;

            messageInput.disabled = !connected;
            sendButton.disabled = !connected;
            sendButton.textContent = 'Enviar';
        }
    }


    // ========================================================
    // ESTADO INICIAL
    // ========================================================

    setChatEnabled(false);

    connectionStatus.textContent = 'Aguardando Inicialização';
    connectionStatus.className = 'status-offline';

    addMessageToChat(
        'Status',
        'Seja bem-vindo ao STEAM+ Hub. Clique em "Iniciar Sparky" para ativar o assistente.',
        'status'
    );


    // ========================================================
    // INICIAR CONVERSA
    // ========================================================

    function iniciarConversa() {

        if (socket && socket.connected) {
            return;
        }


        connectionStatus.textContent = 'Conectando...';
        connectionStatus.className = 'status-offline';

        setChatEnabled(false);


        socket = io(URL_BACKEND, {

            transports: ['websocket', 'polling'],

            reconnection: true,

            reconnectionAttempts: 5,

            reconnectionDelay: 1000,

            reconnectionDelayMax: 5000,

            timeout: 15000
        });


        // ====================================================
        // CONECTADO
        // ====================================================

        socket.on('connect', () => {

            console.log(
                'Socket conectado:',
                socket.id
            );


            connectionStatus.textContent = 'Sparky Conectado';

            connectionStatus.className = 'status-online';


            addMessageToChat(
                'Status',
                'Conexão estabelecida com a Central STEAM+.',
                'status'
            );


            setChatEnabled(true);
        });


        // ====================================================
        // DESCONECTADO
        // ====================================================

        socket.on('disconnect', (reason) => {

            console.warn(
                'Socket desconectado:',
                reason
            );


            connectionStatus.textContent = 'Desconectado';

            connectionStatus.className = 'status-offline';


            setChatEnabled(false);


            if (reason !== 'io client disconnect') {

                addMessageToChat(
                    'Status',
                    'A conexão foi interrompida. O sistema tentará reconectar automaticamente.',
                    'status'
                );
            }
        });


        // ====================================================
        // ERRO DE CONEXÃO
        // ====================================================

        socket.on('connect_error', (error) => {

            console.error(
                'Erro Socket.IO:',
                error
            );


            connectionStatus.textContent = 'Erro de Conexão';

            connectionStatus.className = 'status-offline';


            setChatEnabled(false);


            addMessageToChat(
                'Status',
                'Não foi possível conectar ao servidor do Sparky.',
                'status'
            );
        });


        // ====================================================
        // STATUS DA CONEXÃO
        // ====================================================

        socket.on('status_conexao', (data) => {

            console.log(
                'Status recebido:',
                data
            );
        });


        // ====================================================
        // STATUS DO BOT
        // ====================================================

        socket.on('status_bot', (data) => {

            if (!data) {
                return;
            }


            if (data.status === 'processando') {

                setProcessing(true);

            } else if (data.status === 'concluido') {

                setProcessing(false);
            }
        });


        // ====================================================
        // NOVA MENSAGEM
        // ====================================================

        socket.on('nova_mensagem', (data) => {

            console.log(
                'Resposta recebida:',
                data
            );


            if (!data || !data.texto) {
                console.error(
                    'Resposta inválida recebida do backend.'
                );

                return;
            }


            addMessageToChat(
                data.remetente,
                data.texto
            );


            setProcessing(false);
        });


        // ====================================================
        // ERROS DO BACKEND
        // ====================================================

        socket.on('erro', (data) => {

            console.error(
                'Erro retornado pelo backend:',
                data
            );


            const mensagemErro =
                data?.erro ||
                'Ocorreu um erro ao processar sua mensagem.';


            addMessageToChat(
                'Erro',
                mensagemErro,
                'error'
            );


            setProcessing(false);
        });
    }


    // ========================================================
    // ENCERRAR CONVERSA
    // ========================================================

    function encerrarConversa() {

        if (!socket) {
            return;
        }


        if (socket.connected) {
            socket.disconnect();
        }


        setChatEnabled(false);

        connectionStatus.textContent = 'Sessão Encerrada';

        connectionStatus.className = 'status-offline';


        addMessageToChat(
            'Status',
            'Sua sessão com o Sparky foi encerrada.',
            'status'
        );
    }


    // ========================================================
    // LIMPAR CHAT
    // ========================================================

    function limparTela() {

        chatBox.innerHTML = '';

        addMessageToChat(
            'Status',
            'Histórico visual da conversa limpo.',
            'status'
        );
    }


    // ========================================================
    // ENVIAR MENSAGEM
    // ========================================================

    function sendMessageToServer() {

        const messageText =
            messageInput.value.trim();


        if (messageText === '') {
            return;
        }


        if (isProcessing) {
            return;
        }


        if (!socket || !socket.connected) {

            addMessageToChat(
                'Erro',
                'Conexão indisponível no momento.',
                'error'
            );

            return;
        }


        // Mostra imediatamente a mensagem do usuário.
        addMessageToChat(
            'user',
            messageText
        );


        // Limpa o campo.
        messageInput.value = '';


        // Informa que estamos esperando o Sparky.
        setProcessing(true);


        // Envia para o backend.
        socket.emit(
            'enviar_mensagem',
            {
                mensagem: messageText
            }
        );
    }


    // ========================================================
    // EVENTOS
    // ========================================================

    iniciarBtn.addEventListener(
        'click',
        iniciarConversa
    );


    encerrarBtn.addEventListener(
        'click',
        encerrarConversa
    );


    limparBtn.addEventListener(
        'click',
        limparTela
    );


    sendButton.addEventListener(
        'click',
        sendMessageToServer
    );


    messageInput.addEventListener(
        'keypress',
        (event) => {

            if (event.key === 'Enter') {
                sendMessageToServer();
            }
        }
    );

});