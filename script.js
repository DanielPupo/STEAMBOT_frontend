(() => {
    'use strict';

    // -------------------------------------------------------------------------
    // Configuração
    // -------------------------------------------------------------------------

    const CONFIG = Object.freeze({
        backendUrl:
            window.STEAMBOT_CONFIG?.backendUrl ||
            'https://steambot-backend.onrender.com',

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

    const ROLE_CONFIG = Object.freeze({
        student: {
            label: 'Aluno',
            placeholder:
                'Pergunte sobre montagem, sensores, programação ou projetos…'
        },

        teacher: {
            label: 'Professor',
            placeholder:
                'Pergunte sobre aulas, projetos maker, rubricas ou organização de equipes…'
        }
    });

    // -------------------------------------------------------------------------
    // Filtro simples do frontend
    //
    // IMPORTANTE:
    // O filtro principal continua sendo o backend.
    // Este filtro serve apenas para feedback imediato.
    // -------------------------------------------------------------------------

    const CLIENT_BLOCKED_PATTERNS = [
        /\bporn(?:o|ografia|ográfico|ográfica)?\b/i,
        /\bnudes?\b/i,
        /\bconteúdo adulto\b/i,
        /\bconteúdo \+18\b/i,
        /\bmaior de 18\b/i,
        /\bsexo explícito\b/i
    ];

    function containsBlockedContent(text) {
        if (typeof text !== 'string') {
            return false;
        }

        const normalized = text
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase();

        return CLIENT_BLOCKED_PATTERNS.some(
            (pattern) => pattern.test(normalized)
        );
    }

    // -------------------------------------------------------------------------
    // Estado da interface
    // -------------------------------------------------------------------------

    const state = {
        socket: null,

        connected: false,
        processing: false,

        manualDisconnect: false,
        connectErrorShown: false,
        welcomeShown: false,

        // Perfil
        role: null,
        userId: null,
        userName: null,

        // Estatísticas
        messageCount: 0,

        // Cronômetro
        sessionStartedAt: null,
        timerId: null,

        // Requisição atual
        responseTimeoutId: null,
        pendingRequestId: null,

        // IDs que já expiraram.
        expiredRequestIds: new Set()
    };

    const elements = {};

    document.addEventListener(
        'DOMContentLoaded',
        initialize
    );

    // -------------------------------------------------------------------------
    // Inicialização
    // -------------------------------------------------------------------------

    function initialize() {
        cacheElements();

        readUserContext();

        bindEvents();

        applyRoleToInterface();

        updateConnectionStatus(
            'offline',
            'Aguardando início'
        );

        updateControls();

        addMessage(
            'system',
            'Ambiente pronto. Escolha seu perfil e inicie o Sparky.'
        );
    }

    // -------------------------------------------------------------------------
    // Elementos HTML
    // -------------------------------------------------------------------------

    function cacheElements() {
        Object.assign(elements, {
            chatBox:
                document.getElementById(
                    'chat-box'
                ),

            messageInput:
                document.getElementById(
                    'message-input'
                ),

            sendButton:
                document.getElementById(
                    'send-button'
                ),

            connectionStatus:
                document.getElementById(
                    'connection-status'
                ),

            statusLabel:
                document.querySelector(
                    '#connection-status .status-label'
                ),

            startButton:
                document.getElementById(
                    'iniciarBtn'
                ),

            disconnectButton:
                document.getElementById(
                    'encerrarBtn'
                ),

            clearButton:
                document.getElementById(
                    'limparBtn'
                ),

            newConversationButton:
                document.getElementById(
                    'novaConversaBtn'
                ),

            quickStart:
                document.getElementById(
                    'quick-start'
                ),

            typingIndicator:
                document.getElementById(
                    'typing-indicator'
                ),

            characterCounter:
                document.getElementById(
                    'char-counter'
                ),

            messageCount:
                document.getElementById(
                    'message-count'
                ),

            sessionTime:
                document.getElementById(
                    'session-time'
                ),

            sessionLabel:
                document.getElementById(
                    'session-label'
                ),

            toastRegion:
                document.getElementById(
                    'toast-region'
                ),

            profileLabel:
                document.getElementById(
                    'profile-label'
                ),

            activeProfileChip:
                document.getElementById(
                    'active-profile-chip'
                ),

            profileButtons:
                document.querySelectorAll(
                    '[data-profile]'
                ),

            suggestionGroups:
                document.querySelectorAll(
                    '[data-suggestion-group]'
                ),

            quickPromptGroups:
                document.querySelectorAll(
                    '[data-quick-prompts]'
                )
        });
    }

    // -------------------------------------------------------------------------
    // Contexto vindo do sistema principal
    // -------------------------------------------------------------------------

    /**
     * Quando o AstroLearn possuir login integrado,
     * poderá enviar o usuário desta maneira:
     *
     * window.STEAMBOT_USER = {
     *     id: '123',
     *     name: 'Daniel',
     *     role: 'student'
     * };
     *
     * Nesse cenário, futuramente podemos remover
     * completamente a escolha manual de perfil.
     */

    function readUserContext() {
        const user =
            window.STEAMBOT_USER;

        if (
            !user ||
            typeof user !== 'object'
        ) {
            return;
        }

        state.role =
            normalizeRole(
                user.role
            );

        state.userId =
            safeText(
                user.id,
                120
            );

        state.userName =
            safeText(
                user.name,
                80
            );
    }

    // -------------------------------------------------------------------------
    // Eventos da interface
    // -------------------------------------------------------------------------

    function bindEvents() {
        // Iniciar
        elements.startButton.addEventListener(
            'click',
            startConversation
        );

        // Desconectar
        elements.disconnectButton.addEventListener(
            'click',
            disconnectConversation
        );

        // Limpar tela
        elements.clearButton.addEventListener(
            'click',
            () => {
                clearChat(
                    'Histórico visual limpo. O contexto da conversa foi mantido.'
                );
            }
        );

        // Nova conversa
        elements.newConversationButton.addEventListener(
            'click',
            startNewConversation
        );

        // Enviar
        elements.sendButton.addEventListener(
            'click',
            sendMessage
        );

        // Campo de mensagem
        elements.messageInput.addEventListener(
            'input',
            () => {
                updateCharacterCounter();
                resizeComposer();
                updateControls();
            }
        );

        // Enter envia.
        // Shift + Enter quebra linha.
        elements.messageInput.addEventListener(
            'keydown',
            (event) => {
                if (
                    event.key === 'Enter' &&
                    !event.shiftKey
                ) {
                    event.preventDefault();

                    sendMessage();
                }
            }
        );

        // Sugestões.
        document
            .querySelectorAll(
                '[data-prompt]'
            )
            .forEach(
                (button) => {
                    button.addEventListener(
                        'click',
                        () => {
                            selectPrompt(
                                button.dataset.prompt
                            );
                        }
                    );
                }
            );

        // Perfil.
        elements.profileButtons.forEach(
            (button) => {
                button.addEventListener(
                    'click',
                    () => {
                        selectRole(
                            button.dataset.profile
                        );
                    }
                );
            }
        );

        // Logo.
        document
            .querySelector('.brand')
            ?.addEventListener(
                'click',
                (event) => {
                    event.preventDefault();

                    elements.startButton.focus();
                }
            );
    }

    // -------------------------------------------------------------------------
    // Perfil
    // -------------------------------------------------------------------------

    function normalizeRole(value) {
        if (
            typeof value !== 'string'
        ) {
            return null;
        }

        const role =
            value
                .trim()
                .toLowerCase();

        if (
            [
                'student',
                'aluno',
                'aluna'
            ].includes(role)
        ) {
            return 'student';
        }

        if (
            [
                'teacher',
                'professor',
                'professora'
            ].includes(role)
        ) {
            return 'teacher';
        }

        return null;
    }

    function safeText(
        value,
        maxLength
    ) {
        if (
            typeof value !== 'string'
        ) {
            return null;
        }

        const normalized =
            value
                .trim()
                .replace(
                    /\s+/g,
                    ' '
                );

        return normalized
            ? normalized.slice(
                0,
                maxLength
            )
            : null;
    }

    // -------------------------------------------------------------------------
    // Escolha do perfil
    // -------------------------------------------------------------------------

    function selectRole(role) {
        const normalizedRole =
            normalizeRole(role);

        if (!normalizedRole) {
            return;
        }

        /**
         * REGRA PRINCIPAL:
         *
         * Se existir uma conexão ou tentativa de conexão,
         * o perfil não poderá mais ser alterado.
         *
         * Para trocar, o usuário precisa clicar em
         * "Desconectar".
         */
        if (
            state.connected ||
            state.socket
        ) {
            showToast(
                'Encerre a sessão atual antes de trocar de perfil.',
                'error'
            );

            return;
        }

        state.role =
            normalizedRole;

        applyRoleToInterface();

        updateControls();
    }

    function buildProfilePayload() {
        return {
            role: state.role,
            user_id: state.userId,
            user_name: state.userName
        };
    }

    // -------------------------------------------------------------------------
    // Atualiza interface conforme perfil
    // -------------------------------------------------------------------------

    function applyRoleToInterface() {
        const roleConfig =
            state.role
                ? ROLE_CONFIG[
                    state.role
                ]
                : null;

        // Botões de perfil.
        elements.profileButtons.forEach(
            (button) => {
                const isActive =
                    button.dataset.profile
                    === state.role;

                button.classList.toggle(
                    'is-active',
                    isActive
                );

                button.setAttribute(
                    'aria-pressed',
                    String(isActive)
                );
            }
        );

        // Sugestões inferiores.
        elements.suggestionGroups.forEach(
            (group) => {
                group.hidden =
                    !state.role ||
                    group.dataset.suggestionGroup
                    !== state.role;
            }
        );

        // Sugestões iniciais.
        elements.quickPromptGroups.forEach(
            (group) => {
                const visibleRole =
                    state.role ||
                    'student';

                group.hidden =
                    group.dataset.quickPrompts
                    !== visibleRole;
            }
        );

        // Texto do perfil na sidebar.
        if (
            elements.profileLabel
        ) {
            elements.profileLabel.textContent =
                roleConfig?.label ||
                'Não definido';
        }

        // Chip no topo.
        if (
            elements.activeProfileChip
        ) {
            elements.activeProfileChip.textContent =
                roleConfig?.label ||
                'Escolha um perfil';
        }

        // Placeholder.
        elements.messageInput.placeholder =
            roleConfig?.placeholder ||
            'Escolha um perfil e inicie o Sparky…';
    }

    // -------------------------------------------------------------------------
    // Conexão Socket.IO
    // -------------------------------------------------------------------------

    function startConversation() {
        // Já conectado.
        if (
            state.connected
        ) {
            elements.messageInput.focus();

            return;
        }

        // Sem perfil.
        if (
            !state.role
        ) {
            showToast(
                'Escolha Aluno ou Professor antes de iniciar.',
                'error'
            );

            elements
                .profileButtons[0]
                ?.focus();

            return;
        }

        // Socket.IO não carregou.
        if (
            typeof window.io
            !== 'function'
        ) {
            addMessage(
                'error',
                'Não foi possível carregar o módulo de conexão. Atualize a página e tente novamente.'
            );

            showToast(
                'Módulo de conexão indisponível.',
                'error'
            );

            return;
        }

        destroySocket();

        resetPendingRequest();

        state.manualDisconnect =
            false;

        state.connectErrorShown =
            false;

        state.welcomeShown =
            false;

        state.sessionStartedAt =
            null;

        elements.sessionTime.textContent =
            '00:00';

        updateConnectionStatus(
            'connecting',
            'Conectando ao Sparky…'
        );

        // O perfil é enviado UMA VEZ,
        // no momento da conexão.
        const socket =
            window.io(
                CONFIG.backendUrl,
                {
                    ...CONFIG.socketOptions,

                    auth:
                        buildProfilePayload()
                }
            );

        state.socket =
            socket;

        registerSocketEvents(
            socket
        );

        /**
         * Assim que state.socket recebe um valor,
         * updateControls() bloqueia os botões
         * Aluno/Professor.
         */
        updateControls();
    }

    // -------------------------------------------------------------------------
    // Eventos do Socket
    // -------------------------------------------------------------------------

    function registerSocketEvents(
        socket
    ) {
        // ---------------------------------------------------------------------
        // Conectado
        // ---------------------------------------------------------------------

        socket.on(
            'connect',
            () => {
                if (
                    !isCurrentSocket(
                        socket
                    )
                ) {
                    return;
                }

                state.connected =
                    true;

                state.connectErrorShown =
                    false;

                startSessionTimer();

                updateConnectionStatus(
                    'online',
                    'Sparky conectado'
                );

                updateControls();

                elements.messageInput.focus();
            }
        );

        // ---------------------------------------------------------------------
        // Mensagem inicial
        // ---------------------------------------------------------------------

        socket.on(
            'status_conexao',
            (data) => {
                if (
                    !isCurrentSocket(
                        socket
                    ) ||
                    state.welcomeShown
                ) {
                    return;
                }

                syncProfileFromServer(
                    data?.profile
                );

                addMessage(
                    'bot',
                    data?.mensagem_inicial ||
                    (
                        'Olá! Eu sou o Sparky. ' +
                        'Como posso ajudar hoje?'
                    )
                );

                state.welcomeShown =
                    true;
            }
        );

        // ---------------------------------------------------------------------
        // Compatibilidade com evento de perfil atualizado
        //
        // O frontend não envia mais esse evento.
        // O backend também deve bloquear alterações.
        // ---------------------------------------------------------------------

        socket.on(
            'perfil_atualizado',
            (data) => {
                if (
                    !isCurrentSocket(
                        socket
                    )
                ) {
                    return;
                }

                syncProfileFromServer(
                    data?.profile
                );

                resetPendingRequest();

                clearChat();

                addMessage(
                    'bot',
                    data?.mensagem ||
                    (
                        'Perfil atualizado. ' +
                        'Como posso ajudar?'
                    )
                );
            }
        );

        // ---------------------------------------------------------------------
        // Desconectado
        // ---------------------------------------------------------------------

        socket.on(
            'disconnect',
            (reason) => {
                if (
                    !isCurrentSocket(
                        socket
                    )
                ) {
                    return;
                }

                state.connected =
                    false;

                setProcessing(
                    false
                );

                stopSessionTimer();

                resetPendingRequest();

                if (
                    state.manualDisconnect ||
                    reason ===
                    'io client disconnect'
                ) {
                    updateConnectionStatus(
                        'offline',
                        'Sessão encerrada'
                    );

                    elements.sessionLabel.textContent =
                        'Encerrada';
                } else {
                    updateConnectionStatus(
                        'connecting',
                        'Reconectando…'
                    );

                    addMessage(
                        'system',
                        'A conexão caiu. Tentaremos restabelecê-la automaticamente.'
                    );
                }

                updateControls();
            }
        );

        // ---------------------------------------------------------------------
        // Erro de conexão
        // ---------------------------------------------------------------------

        socket.on(
            'connect_error',
            () => {
                if (
                    !isCurrentSocket(
                        socket
                    )
                ) {
                    return;
                }

                state.connected =
                    false;

                updateConnectionStatus(
                    'offline',
                    'Servidor indisponível'
                );

                updateControls();

                if (
                    !state.connectErrorShown
                ) {
                    addMessage(
                        'error',
                        'Não foi possível alcançar o Sparky. O servidor pode estar iniciando ou indisponível.'
                    );

                    showToast(
                        'Falha ao conectar com o servidor.',
                        'error'
                    );

                    state.connectErrorShown =
                        true;
                }
            }
        );

        // ---------------------------------------------------------------------
        // Status da IA
        // ---------------------------------------------------------------------

        socket.on(
            'status_bot',
            (data) => {
                if (
                    !isCurrentSocket(
                        socket
                    )
                ) {
                    return;
                }

                const requestId =
                    data?.request_id ||
                    null;

                // Requisição já expirou.
                if (
                    requestId &&
                    state.expiredRequestIds.has(
                        requestId
                    )
                ) {
                    return;
                }

                // Resposta pertence a outra requisição.
                if (
                    requestId &&
                    state.pendingRequestId &&
                    requestId !==
                    state.pendingRequestId
                ) {
                    return;
                }

                setProcessing(
                    data?.status ===
                    'processando'
                );
            }
        );

        // ---------------------------------------------------------------------
        // Resposta do Sparky
        // ---------------------------------------------------------------------

        socket.on(
            'nova_mensagem',
            (data) => {
                if (
                    !isCurrentSocket(
                        socket
                    )
                ) {
                    return;
                }

                const requestId =
                    data?.request_id ||
                    null;

                if (
                    shouldIgnoreResponse(
                        requestId
                    )
                ) {
                    return;
                }

                clearResponseTimeout();

                if (
                    typeof data?.texto
                    !== 'string' ||
                    !data.texto.trim()
                ) {
                    addMessage(
                        'error',
                        'O servidor retornou uma resposta inválida. Tente reformular a pergunta.'
                    );

                    resetPendingRequest();

                    setProcessing(
                        false
                    );

                    return;
                }

                addMessage(
                    'bot',
                    data.texto,
                    {
                        allowCopy: true
                    }
                );

                resetPendingRequest();

                setProcessing(
                    false
                );
            }
        );

        // ---------------------------------------------------------------------
        // Nova conversa
        // ---------------------------------------------------------------------

        socket.on(
            'conversa_resetada',
            (data) => {
                if (
                    !isCurrentSocket(
                        socket
                    )
                ) {
                    return;
                }

                resetPendingRequest();

                syncProfileFromServer(
                    data?.profile
                );

                clearChat();

                state.welcomeShown =
                    true;

                addMessage(
                    'bot',
                    data?.mensagem ||
                    (
                        'Nova conversa iniciada. ' +
                        'Como posso ajudar?'
                    )
                );

                showToast(
                    'Nova conversa iniciada.'
                );
            }
        );

        // ---------------------------------------------------------------------
        // Erro do backend
        // ---------------------------------------------------------------------

        socket.on(
            'erro',
            (data) => {
                if (
                    !isCurrentSocket(
                        socket
                    )
                ) {
                    return;
                }

                const requestId =
                    data?.request_id ||
                    null;

                if (
                    shouldIgnoreResponse(
                        requestId
                    )
                ) {
                    return;
                }

                clearResponseTimeout();

                addMessage(
                    'error',
                    data?.erro ||
                    (
                        'Não foi possível processar sua mensagem. ' +
                        'Tente novamente.'
                    )
                );

                resetPendingRequest();

                setProcessing(
                    false
                );
            }
        );

        // ---------------------------------------------------------------------
        // Tentativa de reconexão
        // ---------------------------------------------------------------------

        socket.io.on(
            'reconnect_attempt',
            () => {
                if (
                    !isCurrentSocket(
                        socket
                    )
                ) {
                    return;
                }

                updateConnectionStatus(
                    'connecting',
                    'Reconectando…'
                );
            }
        );

        // ---------------------------------------------------------------------
        // Reconexão falhou
        // ---------------------------------------------------------------------

        socket.io.on(
            'reconnect_failed',
            () => {
                if (
                    !isCurrentSocket(
                        socket
                    )
                ) {
                    return;
                }

                destroySocket();

                state.connected =
                    false;

                resetPendingRequest();

                updateConnectionStatus(
                    'offline',
                    'Não foi possível reconectar'
                );

                updateControls();

                showToast(
                    'Reconexão esgotada. Use “Iniciar Sparky” para tentar novamente.',
                    'error'
                );
            }
        );
    }

    // -------------------------------------------------------------------------
    // Sincronização de perfil
    // -------------------------------------------------------------------------

    function syncProfileFromServer(
        profile
    ) {
        if (
            !profile ||
            typeof profile !== 'object'
        ) {
            return;
        }

        const serverRole =
            normalizeRole(
                profile.role
            );

        if (
            serverRole
        ) {
            state.role =
                serverRole;
        }

        state.userName =
            safeText(
                profile.user_name,
                80
            ) ||
            state.userName;

        state.userId =
            safeText(
                profile.user_id,
                120
            ) ||
            state.userId;

        applyRoleToInterface();
    }

    // -------------------------------------------------------------------------
    // Verifica socket atual
    // -------------------------------------------------------------------------

    function isCurrentSocket(
        socket
    ) {
        return (
            socket ===
            state.socket
        );
    }

    // -------------------------------------------------------------------------
    // Desconectar
    // -------------------------------------------------------------------------

    function disconnectConversation() {
        if (
            !state.socket
        ) {
            return;
        }

        state.manualDisconnect =
            true;

        state.socket.disconnect();

        destroySocket();

        state.connected =
            false;

        setProcessing(
            false
        );

        stopSessionTimer();

        resetPendingRequest();

        updateConnectionStatus(
            'offline',
            'Sessão encerrada'
        );

        elements.sessionLabel.textContent =
            'Encerrada';

        addMessage(
            'system',
            'Sessão encerrada. Agora você pode trocar o perfil ou iniciar novamente.'
        );

        /**
         * Depois de destroySocket(),
         * state.socket = null.
         *
         * Portanto updateControls()
         * libera novamente os botões
         * Aluno / Professor.
         */
        updateControls();
    }

    // -------------------------------------------------------------------------
    // Destruir socket
    // -------------------------------------------------------------------------

    function destroySocket() {
        if (
            !state.socket
        ) {
            return;
        }

        state.socket.removeAllListeners();

        state.socket.io?.removeAllListeners();

        if (
            state.socket.connected
        ) {
            state.socket.disconnect();
        }

        state.socket =
            null;
    }

    // -------------------------------------------------------------------------
    // Nova conversa
    // -------------------------------------------------------------------------

    function startNewConversation() {
        if (
            !state.socket ||
            !state.connected ||
            state.processing
        ) {
            return;
        }

        /**
         * Nova conversa NÃO troca o perfil.
         * O perfil só muda após desconectar.
         */
        state.socket.emit(
            'resetar_conversa'
        );
    }

    // -------------------------------------------------------------------------
    // Enviar mensagem
    // -------------------------------------------------------------------------

    function sendMessage() {
        const text =
            elements.messageInput
                .value
                .trim();

        // Nada para enviar.
        if (
            !text ||
            state.processing
        ) {
            return;
        }

        // Perfil não escolhido.
        if (
            !state.role
        ) {
            showToast(
                'Escolha seu perfil antes de enviar uma mensagem.',
                'error'
            );

            return;
        }

        // Mensagem muito grande.
        if (
            text.length >
            CONFIG.maxMessageLength
        ) {
            showToast(
                `A mensagem deve ter até ${CONFIG.maxMessageLength} caracteres.`,
                'error'
            );

            return;
        }

        // Sem conexão.
        if (
            !state.socket ||
            !state.connected
        ) {
            showToast(
                'Inicie o Sparky antes de enviar uma mensagem.',
                'error'
            );

            return;
        }

        // ---------------------------------------------------------------------
        // Moderação simples do frontend
        // ---------------------------------------------------------------------

        if (
            containsBlockedContent(
                text
            )
        ) {
            showToast(
                'Essa mensagem contém conteúdo não permitido na plataforma.',
                'error'
            );

            addMessage(
                'error',
                'O Sparky aceita apenas conteúdos apropriados para o ambiente educacional.'
            );

            elements.messageInput.value =
                '';

            updateCharacterCounter();

            resizeComposer();

            updateControls();

            return;
        }

        // ---------------------------------------------------------------------
        // Request ID
        // ---------------------------------------------------------------------

        const requestId =
            createRequestId();

        state.pendingRequestId =
            requestId;

        /**
         * Quando o usuário envia a primeira
         * mensagem, escondemos as sugestões
         * grandes para priorizar o chat.
         */
        elements.quickStart.hidden =
            true;

        addMessage(
            'user',
            text
        );

        elements.messageInput.value =
            '';

        updateCharacterCounter();

        resizeComposer();

        setProcessing(
            true
        );

        state.socket.emit(
            'enviar_mensagem',
            {
                mensagem:
                    text,

                request_id:
                    requestId
            }
        );

        armResponseTimeout(
            requestId
        );
    }

    // -------------------------------------------------------------------------
    // Sugestões
    // -------------------------------------------------------------------------

    function selectPrompt(
        prompt
    ) {
        if (
            !prompt
        ) {
            return;
        }

        if (
            !state.role
        ) {
            showToast(
                'Escolha Aluno ou Professor para usar as sugestões.',
                'error'
            );

            return;
        }

        elements.messageInput.value =
            prompt.slice(
                0,
                CONFIG.maxMessageLength
            );

        updateCharacterCounter();

        resizeComposer();

        if (
            !state.connected
        ) {
            startConversation();

            if (
                state.role
            ) {
                showToast(
                    'Sugestão preparada. Aguarde a conexão para enviar.'
                );
            }
        } else {
            elements.messageInput.focus();
        }

        updateControls();
    }

    // -------------------------------------------------------------------------
    // Request ID
    // -------------------------------------------------------------------------

    function createRequestId() {
        if (
            window.crypto?.randomUUID
        ) {
            return (
                window.crypto.randomUUID()
            );
        }

        return (
            `msg-${Date.now()}-${Math.random()
                .toString(36)
                .slice(2, 10)
            }`
        );
    }

    // -------------------------------------------------------------------------
    // Ignorar respostas antigas
    // -------------------------------------------------------------------------

    function shouldIgnoreResponse(
        requestId
    ) {
        /**
         * Compatibilidade com backend antigo.
         */
        if (
            !requestId
        ) {
            return false;
        }

        if (
            state.expiredRequestIds.has(
                requestId
            )
        ) {
            return true;
        }

        return Boolean(
            state.pendingRequestId &&
            requestId !==
            state.pendingRequestId
        );
    }

    function resetPendingRequest() {
        clearResponseTimeout();

        state.pendingRequestId =
            null;
    }

    // -------------------------------------------------------------------------
    // Mensagens
    // -------------------------------------------------------------------------

    function addMessage(
        sender,
        text,
        options = {}
    ) {
        const validSenders = [
            'user',
            'bot',
            'system',
            'error'
        ];

        const normalizedSender =
            validSenders.includes(
                sender
            )
                ? sender
                : 'bot';

        const message =
            document.createElement(
                'article'
            );

        const safeTextValue =
            String(
                text ?? ''
            );

        // ---------------------------------------------------------------------
        // Sistema / erro
        // ---------------------------------------------------------------------

        if (
            normalizedSender ===
            'system' ||
            normalizedSender ===
            'error'
        ) {
            message.className =
                'message is-system';

            const pill =
                document.createElement(
                    'p'
                );

            pill.className =
                `system-pill${
                    normalizedSender ===
                    'error'
                        ? ' is-error'
                        : ''
                }`;

            pill.textContent =
                safeTextValue;

            message.appendChild(
                pill
            );
        }

        // ---------------------------------------------------------------------
        // Usuário / bot
        // ---------------------------------------------------------------------

        else {
            message.className =
                `message is-${normalizedSender}`;

            // Avatar.
            const avatar =
                document.createElement(
                    'span'
                );

            avatar.className =
                'avatar';

            avatar.setAttribute(
                'aria-hidden',
                'true'
            );

            avatar.textContent =
                normalizedSender ===
                'user'
                    ? 'EU'
                    : 'S+';

            // Card.
            const card =
                document.createElement(
                    'div'
                );

            card.className =
                'message-card';

            // -----------------------------------------------------------------
            // Cabeçalho da mensagem
            // -----------------------------------------------------------------

            const meta =
                document.createElement(
                    'div'
                );

            meta.className =
                'message-meta';

            const author =
                document.createElement(
                    'span'
                );

            author.textContent =
                normalizedSender ===
                'user'
                    ? 'Você'
                    : 'Sparky';

            const time =
                document.createElement(
                    'time'
                );

            const now =
                new Date();

            time.dateTime =
                now.toISOString();

            time.textContent =
                formatTime(
                    now
                );

            meta.append(
                author,
                time
            );

            // -----------------------------------------------------------------
            // Conteúdo
            // -----------------------------------------------------------------

            const content =
                document.createElement(
                    'div'
                );

            content.className =
                'message-content';

            if (
                normalizedSender ===
                'bot'
            ) {
                renderSafeMarkdown(
                    content,
                    safeTextValue
                );
            } else {
                content.textContent =
                    safeTextValue;
            }

            card.append(
                meta,
                content
            );

            // -----------------------------------------------------------------
            // Copiar resposta
            // -----------------------------------------------------------------

            if (
                normalizedSender ===
                'bot' &&
                options.allowCopy
            ) {
                card.appendChild(
                    createMessageActions(
                        safeTextValue
                    )
                );
            }

            message.append(
                avatar,
                card
            );

            state.messageCount +=
                1;

            elements.messageCount.textContent =
                String(
                    state.messageCount
                );
        }

        elements.chatBox.appendChild(
            message
        );

        /**
         * Assim que houver uma mensagem real
         * de usuário/bot, as sugestões grandes
         * desaparecem.
         */
        elements.quickStart.hidden =
            state.messageCount >
            0;

        requestAnimationFrame(
            () => {
                message.scrollIntoView({
                    behavior:
                        'smooth',

                    block:
                        'nearest'
                });
            }
        );
    }

    // -------------------------------------------------------------------------
    // Ações das respostas
    // -------------------------------------------------------------------------

    function createMessageActions(
        text
    ) {
        const actions =
            document.createElement(
                'div'
            );

        actions.className =
            'message-actions';

        const copyButton =
            document.createElement(
                'button'
            );

        copyButton.type =
            'button';

        copyButton.className =
            'message-action';

        copyButton.textContent =
            'Copiar';

        copyButton.addEventListener(
            'click',
            async () => {
                try {
                    await navigator.clipboard
                        .writeText(
                            text
                        );

                    copyButton.textContent =
                        'Copiado ✓';

                    window.setTimeout(
                        () => {
                            copyButton.textContent =
                                'Copiar';
                        },
                        1600
                    );
                } catch {
                    showToast(
                        'Não foi possível copiar automaticamente.',
                        'error'
                    );
                }
            }
        );

        actions.appendChild(
            copyButton
        );

        return actions;
    }

    // -------------------------------------------------------------------------
    // Markdown seguro
    // -------------------------------------------------------------------------

    function renderSafeMarkdown(
        container,
        text
    ) {
        if (
            window.marked &&
            window.DOMPurify
        ) {
            const parsed =
                window.marked.parse(
                    text,
                    {
                        breaks: true,
                        gfm: true
                    }
                );

            container.innerHTML =
                window.DOMPurify.sanitize(
                    parsed,
                    {
                        USE_PROFILES: {
                            html: true
                        },

                        FORBID_TAGS: [
                            'style',
                            'iframe',
                            'form',
                            'input',
                            'button',
                            'script'
                        ],

                        FORBID_ATTR: [
                            'style',
                            'onerror',
                            'onclick',
                            'onload'
                        ]
                    }
                );

            // Links abrem de forma segura.
            container
                .querySelectorAll(
                    'a'
                )
                .forEach(
                    (link) => {
                        link.target =
                            '_blank';

                        link.rel =
                            'noopener noreferrer';
                    }
                );

            return;
        }

        /**
         * Fallback caso as bibliotecas
         * externas não carreguem.
         */
        container.textContent =
            text;
    }

    // -------------------------------------------------------------------------
    // Limpar chat
    // -------------------------------------------------------------------------

    function clearChat(
        message = ''
    ) {
        elements.chatBox
            .replaceChildren();

        state.messageCount =
            0;

        elements.messageCount.textContent =
            '0';

        /**
         * Volta a mostrar as sugestões.
         * addMessage(bot) poderá escondê-las
         * novamente depois.
         */
        elements.quickStart.hidden =
            false;

        if (
            message
        ) {
            addMessage(
                'system',
                message
            );
        }
    }

    // -------------------------------------------------------------------------
    // Estado "Sparky está respondendo"
    // -------------------------------------------------------------------------

    function setProcessing(
        processing
    ) {
        state.processing =
            Boolean(
                processing
            );

        elements.typingIndicator.hidden =
            !state.processing;

        const label =
            elements.sendButton
                .querySelector(
                    'span:first-child'
                );

        if (
            label
        ) {
            label.textContent =
                state.processing
                    ? 'Aguarde'
                    : 'Enviar';
        }

        if (
            !state.processing
        ) {
            clearResponseTimeout();
        }

        updateControls();
    }

    // -------------------------------------------------------------------------
    // Botões / controles
    // -------------------------------------------------------------------------

    function updateControls() {
        const hasText =
            Boolean(
                elements.messageInput
                    .value
                    .trim()
            );

        const hasRole =
            Boolean(
                state.role
            );

        const canWrite =
            state.connected &&
            !state.processing &&
            hasRole;

        const connecting =
            Boolean(
                state.socket &&
                !state.connected &&
                !state.manualDisconnect
            );

        /**
         * Enquanto existir socket,
         * o perfil permanece travado.
         *
         * Isso inclui:
         * - conectando;
         * - conectado;
         * - tentando reconectar.
         */
        const profileLocked =
            Boolean(
                state.connected ||
                state.socket
            );

        // Campo.
        elements.messageInput.disabled =
            !canWrite;

        // Botão enviar.
        elements.sendButton.disabled =
            !canWrite ||
            !hasText;

        // Iniciar.
        elements.startButton.disabled =
            state.connected ||
            connecting ||
            !hasRole;

        // Desconectar.
        elements.disconnectButton.disabled =
            !state.socket;

        // Nova conversa.
        elements.newConversationButton.disabled =
            !canWrite;

        // ---------------------------------------------------------------------
        // PERFIL BLOQUEADO
        // ---------------------------------------------------------------------

        elements.profileButtons.forEach(
            (button) => {
                button.disabled =
                    profileLocked;

                button.setAttribute(
                    'aria-disabled',
                    String(
                        profileLocked
                    )
                );

                button.title =
                    profileLocked
                        ? 'Desconecte o Sparky para trocar de perfil.'
                        : 'Selecionar este perfil.';
            }
        );
    }

    // -------------------------------------------------------------------------
    // Status de conexão
    // -------------------------------------------------------------------------

    function updateConnectionStatus(
        status,
        label
    ) {
        elements.connectionStatus.className =
            `connection-badge is-${status}`;

        elements.statusLabel.textContent =
            label;
    }

    // -------------------------------------------------------------------------
    // Contador de caracteres
    // -------------------------------------------------------------------------

    function updateCharacterCounter() {
        const length =
            elements.messageInput
                .value
                .length;

        elements.characterCounter.textContent =
            `${length} / ${CONFIG.maxMessageLength}`;
    }

    // -------------------------------------------------------------------------
    // Altura automática do textarea
    // -------------------------------------------------------------------------

    function resizeComposer() {
        elements.messageInput.style.height =
            'auto';

        elements.messageInput.style.height =
            `${Math.min(
                elements.messageInput.scrollHeight,
                140
            )}px`;
    }

    // -------------------------------------------------------------------------
    // Cronômetro
    // -------------------------------------------------------------------------

    function startSessionTimer() {
        if (
            !state.sessionStartedAt
        ) {
            state.sessionStartedAt =
                Date.now();
        }

        elements.sessionLabel.textContent =
            'Em andamento';

        updateSessionTimer();

        if (
            !state.timerId
        ) {
            state.timerId =
                window.setInterval(
                    updateSessionTimer,
                    1000
                );
        }
    }

    function stopSessionTimer() {
        if (
            state.timerId
        ) {
            window.clearInterval(
                state.timerId
            );
        }

        state.timerId =
            null;
    }

    function updateSessionTimer() {
        if (
            !state.sessionStartedAt
        ) {
            return;
        }

        const elapsedSeconds =
            Math.floor(
                (
                    Date.now() -
                    state.sessionStartedAt
                ) / 1000
            );

        const minutes =
            String(
                Math.floor(
                    elapsedSeconds /
                    60
                )
            ).padStart(
                2,
                '0'
            );

        const seconds =
            String(
                elapsedSeconds %
                60
            ).padStart(
                2,
                '0'
            );

        elements.sessionTime.textContent =
            `${minutes}:${seconds}`;
    }

    // -------------------------------------------------------------------------
    // Timeout da resposta
    // -------------------------------------------------------------------------

    function armResponseTimeout(
        requestId
    ) {
        clearResponseTimeout();

        state.responseTimeoutId =
            window.setTimeout(
                () => {
                    // Outra requisição assumiu.
                    if (
                        !state.processing ||
                        state.pendingRequestId !==
                        requestId
                    ) {
                        return;
                    }

                    /**
                     * Marca como expirado para que
                     * uma resposta atrasada seja ignorada.
                     */
                    state.expiredRequestIds.add(
                        requestId
                    );

                    /**
                     * Evita crescimento infinito.
                     */
                    if (
                        state.expiredRequestIds.size >
                        30
                    ) {
                        const oldest =
                            state.expiredRequestIds
                                .values()
                                .next()
                                .value;

                        state.expiredRequestIds.delete(
                            oldest
                        );
                    }

                    state.pendingRequestId =
                        null;

                    setProcessing(
                        false
                    );

                    addMessage(
                        'error',
                        (
                            'A resposta demorou mais que o esperado. ' +
                            'Você pode tentar novamente; ' +
                            'se a resposta antiga chegar depois, ' +
                            'ela será ignorada.'
                        )
                    );
                },

                CONFIG.responseTimeoutMs
            );
    }

    function clearResponseTimeout() {
        if (
            state.responseTimeoutId
        ) {
            window.clearTimeout(
                state.responseTimeoutId
            );
        }

        state.responseTimeoutId =
            null;
    }

    // -------------------------------------------------------------------------
    // Toast
    // -------------------------------------------------------------------------

    function showToast(
        message,
        type = 'info'
    ) {
        const toast =
            document.createElement(
                'div'
            );

        toast.className =
            `toast${
                type === 'error'
                    ? ' is-error'
                    : ''
            }`;

        toast.textContent =
            message;

        elements.toastRegion.appendChild(
            toast
        );

        window.setTimeout(
            () => {
                toast.remove();
            },
            4500
        );
    }

    // -------------------------------------------------------------------------
    // Horário
    // -------------------------------------------------------------------------

    function formatTime(
        date
    ) {
        return (
            new Intl.DateTimeFormat(
                'pt-BR',
                {
                    hour: '2-digit',
                    minute: '2-digit'
                }
            ).format(
                date
            )
        );
    }
})();