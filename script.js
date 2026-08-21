(() => {
    'use strict';

    const CONFIG = Object.freeze({
        backendUrl: window.STEAMBOT_CONFIG?.backendUrl || 'https://steambot-backend.onrender.com',
        maxMessageLength: 1500,
        responseTimeoutMs: 60000,
        socketOptions: {
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionAttempts: 6,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            timeout: 20000
        }
    });

    const state = {
        socket: null,
        connected: false,
        processing: false,
        manualDisconnect: false,
        connectErrorShown: false,
        welcomeShown: false,
        messageCount: 0,
        sessionStartedAt: null,
        timerId: null,
        responseTimeoutId: null
    };

    const elements = {};

    document.addEventListener('DOMContentLoaded', initialize);

    function initialize() {
        Object.assign(elements, {
            chatBox: document.getElementById('chat-box'),
            messageInput: document.getElementById('message-input'),
            sendButton: document.getElementById('send-button'),
            connectionStatus: document.getElementById('connection-status'),
            statusLabel: document.querySelector('#connection-status .status-label'),
            startButton: document.getElementById('iniciarBtn'),
            disconnectButton: document.getElementById('encerrarBtn'),
            clearButton: document.getElementById('limparBtn'),
            newConversationButton: document.getElementById('novaConversaBtn'),
            quickStart: document.getElementById('quick-start'),
            typingIndicator: document.getElementById('typing-indicator'),
            characterCounter: document.getElementById('char-counter'),
            messageCount: document.getElementById('message-count'),
            sessionTime: document.getElementById('session-time'),
            sessionLabel: document.getElementById('session-label'),
            toastRegion: document.getElementById('toast-region')
        });

        bindEvents();
        updateConnectionStatus('offline', 'Aguardando início');
        updateControls();
        addMessage('system', 'Ambiente pronto. Inicie o Sparky ou escolha uma sugestão para começar.');
    }

    function bindEvents() {
        elements.startButton.addEventListener('click', startConversation);
        elements.disconnectButton.addEventListener('click', disconnectConversation);
        elements.clearButton.addEventListener('click', () => clearChat('Histórico visual limpo. O contexto do Sparky foi mantido.'));
        elements.newConversationButton.addEventListener('click', startNewConversation);
        elements.sendButton.addEventListener('click', sendMessage);

        elements.messageInput.addEventListener('input', () => {
            updateCharacterCounter();
            resizeComposer();
            updateControls();
        });

        elements.messageInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                sendMessage();
            }
        });

        document.querySelectorAll('[data-prompt]').forEach((button) => {
            button.addEventListener('click', () => selectPrompt(button.dataset.prompt));
        });

        document.querySelector('.brand').addEventListener('click', (event) => {
            event.preventDefault();
            elements.startButton.focus();
        });
    }

    function startConversation() {
        if (state.connected) {
            elements.messageInput.focus();
            return;
        }

        if (typeof window.io !== 'function') {
            addMessage('error', 'Não foi possível carregar o módulo de conexão. Atualize a página e tente novamente.');
            showToast('Módulo de conexão indisponível.', 'error');
            return;
        }

        destroySocket();
        state.manualDisconnect = false;
        state.connectErrorShown = false;
        state.welcomeShown = false;
        state.sessionStartedAt = null;
        elements.sessionTime.textContent = '00:00';
        updateConnectionStatus('connecting', 'Conectando ao Sparky…');

        const socket = window.io(CONFIG.backendUrl, CONFIG.socketOptions);
        state.socket = socket;
        registerSocketEvents(socket);
        updateControls();
    }

    function registerSocketEvents(socket) {
        socket.on('connect', () => {
            if (socket !== state.socket) return;

            state.connected = true;
            state.connectErrorShown = false;
            startSessionTimer();
            updateConnectionStatus('online', 'Sparky conectado');
            updateControls();
            elements.messageInput.focus();
        });

        socket.on('status_conexao', (data) => {
            if (socket !== state.socket || state.welcomeShown) return;

            const welcome = data?.mensagem_inicial
                || 'Olá! Antes de começar, conte para mim: você é aluno(a) ou professor(a) de STEAM+?';

            addMessage('bot', welcome);
            state.welcomeShown = true;
        });

        socket.on('disconnect', (reason) => {
            if (socket !== state.socket) return;

            state.connected = false;
            setProcessing(false);
            stopSessionTimer();

            if (state.manualDisconnect || reason === 'io client disconnect') {
                updateConnectionStatus('offline', 'Sessão encerrada');
                elements.sessionLabel.textContent = 'Encerrada';
            } else {
                updateConnectionStatus('connecting', 'Reconectando…');
                addMessage('system', 'A conexão caiu. Tentaremos restabelecê-la automaticamente.');
            }

            updateControls();
        });

        socket.on('connect_error', () => {
            if (socket !== state.socket) return;

            state.connected = false;
            updateConnectionStatus('offline', 'Servidor indisponível');
            updateControls();

            if (!state.connectErrorShown) {
                addMessage('error', 'Não foi possível alcançar o Sparky. O servidor pode estar iniciando; tente novamente em instantes.');
                showToast('Falha ao conectar com o servidor.', 'error');
                state.connectErrorShown = true;
            }
        });

        socket.on('status_bot', (data) => {
            if (socket !== state.socket) return;
            setProcessing(data?.status === 'processando');
        });

        socket.on('nova_mensagem', (data) => {
            if (socket !== state.socket) return;

            clearResponseTimeout();
            if (!data || typeof data.texto !== 'string' || !data.texto.trim()) {
                addMessage('error', 'O servidor retornou uma resposta inválida. Tente reformular a pergunta.');
                setProcessing(false);
                return;
            }

            addMessage('bot', data.texto);
            setProcessing(false);
        });

        socket.on('conversa_resetada', (data) => {
            if (socket !== state.socket) return;

            clearChat();
            state.welcomeShown = true;
            addMessage('bot', data?.mensagem || 'Nova conversa iniciada. Você é aluno(a) ou professor(a)?');
            showToast('Nova conversa iniciada.');
        });

        socket.on('erro', (data) => {
            if (socket !== state.socket) return;

            clearResponseTimeout();
            addMessage('error', data?.erro || 'Não foi possível processar sua mensagem. Tente novamente.');
            setProcessing(false);
        });

        socket.io.on('reconnect_attempt', () => {
            if (socket !== state.socket) return;
            updateConnectionStatus('connecting', 'Reconectando…');
        });

        socket.io.on('reconnect_failed', () => {
            if (socket !== state.socket) return;
            destroySocket();
            state.connected = false;
            updateConnectionStatus('offline', 'Não foi possível reconectar');
            updateControls();
            showToast('Reconexão esgotada. Use “Iniciar Sparky” para tentar novamente.', 'error');
        });
    }

    function disconnectConversation() {
        if (!state.socket) return;

        state.manualDisconnect = true;
        state.socket.disconnect();
        destroySocket();
        state.connected = false;
        setProcessing(false);
        stopSessionTimer();
        updateConnectionStatus('offline', 'Sessão encerrada');
        elements.sessionLabel.textContent = 'Encerrada';
        addMessage('system', 'Sessão encerrada com segurança. Você pode iniciar novamente quando quiser.');
        updateControls();
    }

    function destroySocket() {
        if (!state.socket) return;

        state.socket.removeAllListeners();
        state.socket.io?.removeAllListeners();
        if (state.socket.connected) state.socket.disconnect();
        state.socket = null;
    }

    function startNewConversation() {
        if (!state.socket || !state.connected || state.processing) return;
        state.socket.emit('resetar_conversa');
    }

    function sendMessage() {
        const text = elements.messageInput.value.trim();

        if (!text || state.processing) return;
        if (text.length > CONFIG.maxMessageLength) {
            showToast(`A mensagem deve ter até ${CONFIG.maxMessageLength} caracteres.`, 'error');
            return;
        }
        if (!state.socket || !state.connected) {
            showToast('Inicie o Sparky antes de enviar uma mensagem.', 'error');
            return;
        }

        addMessage('user', text);
        elements.messageInput.value = '';
        updateCharacterCounter();
        resizeComposer();
        setProcessing(true);
        state.socket.emit('enviar_mensagem', { mensagem: text });
        armResponseTimeout();
    }

    function selectPrompt(prompt) {
        if (!prompt) return;

        elements.messageInput.value = prompt.slice(0, CONFIG.maxMessageLength);
        updateCharacterCounter();
        resizeComposer();

        if (!state.connected) {
            startConversation();
            showToast('Sugestão preparada. Aguarde a conexão para enviar.');
        } else {
            elements.messageInput.focus();
        }
        updateControls();
    }

    function addMessage(sender, text) {
        const normalizedSender = ['user', 'bot', 'system', 'error'].includes(sender) ? sender : 'bot';
        const message = document.createElement('article');
        const safeText = String(text ?? '');

        if (normalizedSender === 'system' || normalizedSender === 'error') {
            message.className = 'message is-system';
            const pill = document.createElement('p');
            pill.className = `system-pill${normalizedSender === 'error' ? ' is-error' : ''}`;
            pill.textContent = safeText;
            message.appendChild(pill);
        } else {
            message.className = `message is-${normalizedSender}`;
            const avatar = document.createElement('span');
            avatar.className = 'avatar';
            avatar.setAttribute('aria-hidden', 'true');
            avatar.textContent = normalizedSender === 'user' ? 'EU' : 'S+';

            const card = document.createElement('div');
            card.className = 'message-card';
            const meta = document.createElement('div');
            meta.className = 'message-meta';
            meta.innerHTML = `<span>${normalizedSender === 'user' ? 'Você' : 'Sparky'}</span><time>${formatTime(new Date())}</time>`;

            const content = document.createElement('div');
            content.className = 'message-content';
            if (normalizedSender === 'bot') {
                renderSafeMarkdown(content, safeText);
            } else {
                content.textContent = safeText;
            }

            card.append(meta, content);
            message.append(avatar, card);
            state.messageCount += 1;
            elements.messageCount.textContent = String(state.messageCount);
        }

        elements.chatBox.appendChild(message);
        elements.quickStart.hidden = state.messageCount > 1;
        requestAnimationFrame(() => message.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
    }

    function renderSafeMarkdown(container, text) {
        if (window.marked && window.DOMPurify) {
            const parsed = window.marked.parse(text, { breaks: true, gfm: true });
            container.innerHTML = window.DOMPurify.sanitize(parsed, {
                USE_PROFILES: { html: true },
                FORBID_TAGS: ['style', 'iframe', 'form', 'input', 'button'],
                FORBID_ATTR: ['style']
            });

            container.querySelectorAll('a').forEach((link) => {
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
            });
            return;
        }

        container.textContent = text;
    }

    function clearChat(message = '') {
        elements.chatBox.replaceChildren();
        state.messageCount = 0;
        elements.messageCount.textContent = '0';
        elements.quickStart.hidden = false;
        if (message) addMessage('system', message);
    }

    function setProcessing(processing) {
        state.processing = Boolean(processing);
        elements.typingIndicator.hidden = !state.processing;
        elements.sendButton.querySelector('span:first-child').textContent = state.processing ? 'Aguarde' : 'Enviar';
        if (!state.processing) clearResponseTimeout();
        updateControls();
    }

    function updateControls() {
        const hasText = Boolean(elements.messageInput.value.trim());
        const canWrite = state.connected && !state.processing;

        elements.messageInput.disabled = !canWrite;
        elements.sendButton.disabled = !canWrite || !hasText;
        elements.startButton.disabled = state.connected || Boolean(state.socket && !state.manualDisconnect);
        elements.disconnectButton.disabled = !state.socket;
        elements.newConversationButton.disabled = !canWrite;
    }

    function updateConnectionStatus(status, label) {
        elements.connectionStatus.className = `connection-badge is-${status}`;
        elements.statusLabel.textContent = label;
    }

    function updateCharacterCounter() {
        const length = elements.messageInput.value.length;
        elements.characterCounter.textContent = `${length} / ${CONFIG.maxMessageLength}`;
    }

    function resizeComposer() {
        elements.messageInput.style.height = 'auto';
        elements.messageInput.style.height = `${Math.min(elements.messageInput.scrollHeight, 140)}px`;
    }

    function startSessionTimer() {
        if (!state.sessionStartedAt) state.sessionStartedAt = Date.now();
        elements.sessionLabel.textContent = 'Em andamento';
        updateSessionTimer();
        if (!state.timerId) state.timerId = window.setInterval(updateSessionTimer, 1000);
    }

    function stopSessionTimer() {
        if (state.timerId) window.clearInterval(state.timerId);
        state.timerId = null;
    }

    function updateSessionTimer() {
        if (!state.sessionStartedAt) return;
        const elapsedSeconds = Math.floor((Date.now() - state.sessionStartedAt) / 1000);
        const minutes = String(Math.floor(elapsedSeconds / 60)).padStart(2, '0');
        const seconds = String(elapsedSeconds % 60).padStart(2, '0');
        elements.sessionTime.textContent = `${minutes}:${seconds}`;
    }

    function armResponseTimeout() {
        clearResponseTimeout();
        state.responseTimeoutId = window.setTimeout(() => {
            if (!state.processing) return;
            setProcessing(false);
            addMessage('error', 'A resposta está demorando mais que o esperado. Verifique a conexão e tente novamente.');
        }, CONFIG.responseTimeoutMs);
    }

    function clearResponseTimeout() {
        if (state.responseTimeoutId) window.clearTimeout(state.responseTimeoutId);
        state.responseTimeoutId = null;
    }

    function showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast${type === 'error' ? ' is-error' : ''}`;
        toast.textContent = message;
        elements.toastRegion.appendChild(toast);
        window.setTimeout(() => toast.remove(), 4500);
    }

    function formatTime(date) {
        return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(date);
    }
})();
