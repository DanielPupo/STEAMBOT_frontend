(() => {
    'use strict';

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

    const CLIENT_BLOCKED_PATTERNS = [
        /\bporn(?:o|ografia|ografico|ografica)?\b/i,
        /\bnudes?\b/i,
        /\bconteudo adulto\b/i,
        /\bconteudo \+18\b/i,
        /\bmaior de 18\b/i,
        /\bsexo explicito\b/i
    ];

    /*
     * Domínios autorizados a enviar o perfil
     * para o chatbot através de postMessage.
     */
    const TRUSTED_PARENT_ORIGINS =
        new Set([
            'https://frontend-xi-taupe-77.vercel.app',

            'http://localhost:3000',
            'http://localhost:19006',
            'http://localhost:8081'
        ]);

    const state = {
        socket: null,

        connected: false,

        processing: false,

        manualDisconnect: false,

        connectErrorShown: false,

        welcomeShown: false,

        role: null,

        userId: null,

        userName: null,

        messageCount: 0,

        sessionStartedAt: null,

        timerId: null,

        responseTimeoutId: null,

        pendingRequestId: null,

        expiredRequestIds:
            new Set()
    };

    const elements = {};

    document.addEventListener(
        'DOMContentLoaded',
        initialize
    );

    // ---------------------------------------------------------------------
    // Inicialização
    // ---------------------------------------------------------------------

    function initialize() {
        cacheElements();

        /*
         * Primeiro tentamos ler um usuário
         * já inserido pelo AstroLearn.
         */
        readUserContext();

        /*
         * Depois ficamos preparados para receber
         * os dados por postMessage.
         */
        bindExternalProfileMessage();

        bindEvents();

        applyRoleToInterface();

        updateCharacterCounter();

        updateControls();

        /*
         * Se o usuário já veio da plataforma,
         * o Sparky inicia automaticamente.
         */
        if (
            state.role
        ) {
            updateConnectionStatus(
                'connecting',
                'Perfil identificado'
            );

            addMessage(
                'system',
                (
                    `Perfil ${
                        ROLE_CONFIG[
                            state.role
                        ].label
                    } identificado. `
                    +
                    'Conectando ao Sparky automaticamente…'
                )
            );

            window.setTimeout(
                startConversation,
                0
            );

            return;
        }

        /*
         * Se abriu o chatbot diretamente,
         * sem passar pela plataforma,
         * ele não escolhe um perfil sozinho.
         */
        updateConnectionStatus(
            'offline',
            'Aguardando autenticação'
        );

        addMessage(
            'system',
            (
                'Aguardando o perfil da sua conta AstroLearn. '
                +
                'Abra o Sparky após fazer login na plataforma.'
            )
        );
    }

    // ---------------------------------------------------------------------
    // Elementos da página
    // ---------------------------------------------------------------------

    function cacheElements() {
        Object.assign(
            elements,
            {
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

                activeProfileChip:
                    document.getElementById(
                        'active-profile-chip'
                    ),

                suggestionGroups:
                    document.querySelectorAll(
                        '[data-suggestion-group]'
                    ),

                quickPromptGroups:
                    document.querySelectorAll(
                        '[data-quick-prompts]'
                    )
            }
        );
    }

    // ---------------------------------------------------------------------
    // Perfil recebido diretamente
    // ---------------------------------------------------------------------

    function readUserContext() {
        const user =
            window.STEAMBOT_USER;

        if (
            !user ||
            typeof user !==
                'object'
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
                user.name ||
                user.nome,
                80
            );
    }

    // ---------------------------------------------------------------------
    // Perfil vindo da plataforma por postMessage
    // ---------------------------------------------------------------------

    function bindExternalProfileMessage() {
        window.addEventListener(
            'message',
            (event) => {

                /*
                 * Só aceitamos mensagens
                 * de domínios conhecidos.
                 */
                if (
                    !TRUSTED_PARENT_ORIGINS.has(
                        event.origin
                    )
                ) {
                    return;
                }

                const payload =
                    event.data;

                if (
                    !payload ||
                    payload.type !==
                        'SPARKY_AUTH_CONTEXT'
                ) {
                    return;
                }

                const user =
                    payload.user;

                if (
                    !user ||
                    typeof user !==
                        'object'
                ) {
                    return;
                }

                const role =
                    normalizeRole(
                        user.role
                    );

                if (
                    !role
                ) {
                    return;
                }

                state.role =
                    role;

                state.userId =
                    safeText(
                        user.id,
                        120
                    );

                state.userName =
                    safeText(
                        user.name ||
                        user.nome,
                        80
                    );

                applyRoleToInterface();

                updateControls();

                /*
                 * Assim que recebe o perfil,
                 * conecta automaticamente.
                 */
                if (
                    !state.socket &&
                    !state.connected
                ) {
                    addMessage(
                        'system',
                        (
                            `Perfil ${
                                ROLE_CONFIG[
                                    state.role
                                ].label
                            } recebido da plataforma. `
                            +
                            'Conectando…'
                        )
                    );

                    startConversation();
                }
            }
        );
    }

    // ---------------------------------------------------------------------
    // Eventos da interface
    // ---------------------------------------------------------------------

    function bindEvents() {
        elements.startButton
            .addEventListener(
                'click',
                startConversation
            );

        elements.disconnectButton
            .addEventListener(
                'click',
                disconnectConversation
            );

        elements.clearButton
            .addEventListener(
                'click',
                () => {
                    clearChat(
                        (
                            'Histórico visual limpo. '
                            +
                            'O contexto da conversa foi mantido.'
                        )
                    );
                }
            );

        elements.newConversationButton
            .addEventListener(
                'click',
                startNewConversation
            );

        elements.sendButton
            .addEventListener(
                'click',
                sendMessage
            );

        elements.messageInput
            .addEventListener(
                'input',
                () => {
                    updateCharacterCounter();

                    resizeComposer();

                    updateControls();
                }
            );

        elements.messageInput
            .addEventListener(
                'keydown',
                (event) => {
                    if (
                        event.key ===
                            'Enter'
                        &&
                        !event.shiftKey
                    ) {
                        event.preventDefault();

                        sendMessage();
                    }
                }
            );

        document
            .querySelectorAll(
                '[data-prompt]'
            )
            .forEach(
                (button) => {
                    button
                        .addEventListener(
                            'click',
                            () => {
                                selectPrompt(
                                    button.dataset
                                        .prompt
                                );
                            }
                        );
                }
            );

        document
            .querySelector(
                '.brand'
            )
            ?.addEventListener(
                'click',
                (event) => {
                    event.preventDefault();

                    elements
                        .messageInput
                        .focus();
                }
            );
    }

    // ---------------------------------------------------------------------
    // Perfil
    // ---------------------------------------------------------------------

    function normalizeRole(
        value
    ) {
        if (
            typeof value !==
                'string'
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
            ].includes(
                role
            )
        ) {
            return 'student';
        }

        if (
            [
                'teacher',
                'professor',
                'professora'
            ].includes(
                role
            )
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
            typeof value !==
                'string'
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
            ?
            normalized.slice(
                0,
                maxLength
            )
            :
            null;
    }

    function buildProfilePayload() {
        return {
            role:
                state.role,

            user_id:
                state.userId,

            user_name:
                state.userName
        };
    }

    // ---------------------------------------------------------------------
    // Atualiza interface conforme o perfil
    // ---------------------------------------------------------------------

    function applyRoleToInterface() {
        const roleConfig =
            state.role
                ?
                ROLE_CONFIG[
                    state.role
                ]
                :
                null;

        /*
         * Sugestões menores.
         */
        elements.suggestionGroups
            .forEach(
                (group) => {
                    group.hidden =
                        !state.role
                        ||
                        group.dataset
                            .suggestionGroup
                        !==
                        state.role;
                }
            );

        /*
         * Sugestões grandes.
         */
        elements.quickPromptGroups
            .forEach(
                (group) => {
                    group.hidden =
                        !state.role
                        ||
                        group.dataset
                            .quickPrompts
                        !==
                        state.role;
                }
            );

        /*
         * O chip é apenas informativo.
         * Não existe mais seleção manual.
         */
        if (
            elements.activeProfileChip
        ) {
            elements
                .activeProfileChip
                .textContent =
                roleConfig?.label
                ||
                'Perfil não identificado';
        }

        elements
            .messageInput
            .placeholder =
            roleConfig?.placeholder
            ||
            (
                'Abra o Sparky pela plataforma '
                +
                'AstroLearn após fazer login…'
            );
    }

    // ---------------------------------------------------------------------
    // Conexão
    // ---------------------------------------------------------------------

    function startConversation() {
        if (
            state.connected
        ) {
            elements
                .messageInput
                .focus();

            return;
        }

        /*
         * Sem perfil vindo da plataforma,
         * não conectamos.
         */
        if (
            !state.role
        ) {
            showToast(
                (
                    'Perfil não identificado. '
                    +
                    'Faça login no AstroLearn e '
                    +
                    'abra o Sparky pela plataforma.'
                ),
                'error'
            );

            return;
        }

        if (
            typeof window.io !==
                'function'
        ) {
            addMessage(
                'error',
                (
                    'Não foi possível carregar '
                    +
                    'o módulo de conexão. '
                    +
                    'Atualize a página e tente novamente.'
                )
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

        elements.sessionTime
            .textContent =
            '00:00';

        updateConnectionStatus(
            'connecting',
            'Conectando ao Sparky…'
        );

        const socket =
            window.io(
                CONFIG.backendUrl,
                {
                    ...CONFIG
                        .socketOptions,

                    auth:
                        buildProfilePayload()
                }
            );

        state.socket =
            socket;

        registerSocketEvents(
            socket
        );

        updateControls();
    }

    // ---------------------------------------------------------------------
    // Eventos Socket.IO
    // ---------------------------------------------------------------------

    function registerSocketEvents(
        socket
    ) {
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

                elements
                    .messageInput
                    .focus();
            }
        );

        socket.on(
            'status_conexao',
            (data) => {
                if (
                    !isCurrentSocket(
                        socket
                    )
                    ||
                    state.welcomeShown
                ) {
                    return;
                }

                syncProfileFromServer(
                    data?.profile
                );

                addMessage(
                    'bot',
                    data?.mensagem_inicial
                    ||
                    (
                        'Olá! Eu sou o Sparky. '
                        +
                        'Como posso ajudar hoje?'
                    )
                );

                state.welcomeShown =
                    true;
            }
        );

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
                    state.manualDisconnect
                    ||
                    reason ===
                        'io client disconnect'
                ) {
                    updateConnectionStatus(
                        'offline',
                        'Sessão encerrada'
                    );

                    elements.sessionLabel
                        .textContent =
                        'Encerrada';
                } else {
                    updateConnectionStatus(
                        'connecting',
                        'Reconectando…'
                    );

                    addMessage(
                        'system',
                        (
                            'A conexão caiu. '
                            +
                            'Tentaremos restabelecê-la automaticamente.'
                        )
                    );
                }

                updateControls();
            }
        );

        socket.on(
            'connect_error',
            (error) => {
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
                    'Falha na autenticação/conexão'
                );

                updateControls();

                if (
                    !state.connectErrorShown
                ) {
                    addMessage(
                        'error',
                        error?.message
                        ||
                        (
                            'Não foi possível conectar ao Sparky. '
                            +
                            'Verifique se seu perfil foi enviado '
                            +
                            'pela plataforma.'
                        )
                    );

                    state.connectErrorShown =
                        true;
                }
            }
        );

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
                    data?.request_id
                    ||
                    null;

                if (
                    requestId
                    &&
                    state.expiredRequestIds
                        .has(
                            requestId
                        )
                ) {
                    return;
                }

                if (
                    requestId
                    &&
                    state.pendingRequestId
                    &&
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
                    data?.request_id
                    ||
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
                    typeof data?.texto !==
                        'string'
                    ||
                    !data.texto.trim()
                ) {
                    addMessage(
                        'error',
                        (
                            'O servidor retornou uma resposta inválida. '
                            +
                            'Tente reformular a pergunta.'
                        )
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
                        allowCopy:
                            true
                    }
                );

                resetPendingRequest();

                setProcessing(
                    false
                );
            }
        );

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
                    data?.mensagem
                    ||
                    (
                        'Nova conversa iniciada. '
                        +
                        'Como posso ajudar?'
                    )
                );

                showToast(
                    'Nova conversa iniciada.'
                );
            }
        );

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
                    data?.request_id
                    ||
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
                    data?.erro
                    ||
                    (
                        'Não foi possível processar '
                        +
                        'sua mensagem. Tente novamente.'
                    )
                );

                resetPendingRequest();

                setProcessing(
                    false
                );
            }
        );

        socket.io.on(
            'reconnect_attempt',
            () => {
                if (
                    isCurrentSocket(
                        socket
                    )
                ) {
                    updateConnectionStatus(
                        'connecting',
                        'Reconectando…'
                    );
                }
            }
        );

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
            }
        );
    }

    // ---------------------------------------------------------------------
    // Sincroniza o perfil recebido pelo servidor
    // ---------------------------------------------------------------------

    function syncProfileFromServer(
        profile
    ) {
        if (
            !profile
            ||
            typeof profile !==
                'object'
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
            )
            ||
            state.userName;

        state.userId =
            safeText(
                profile.user_id,
                120
            )
            ||
            state.userId;

        applyRoleToInterface();
    }

    function isCurrentSocket(
        socket
    ) {
        return (
            socket ===
            state.socket
        );
    }

    // ---------------------------------------------------------------------
    // Desconectar
    // ---------------------------------------------------------------------

    function disconnectConversation() {
        if (
            !state.socket
        ) {
            return;
        }

        state.manualDisconnect =
            true;

        state.socket
            .disconnect();

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

        elements.sessionLabel
            .textContent =
            'Encerrada';

        addMessage(
            'system',
            (
                'Sessão encerrada. '
                +
                'Seu perfil continua vinculado '
                +
                'à conta autenticada.'
            )
        );

        updateControls();
    }

    function destroySocket() {
        if (
            !state.socket
        ) {
            return;
        }

        state.socket
            .removeAllListeners();

        state.socket.io
            ?.removeAllListeners();

        if (
            state.socket.connected
        ) {
            state.socket
                .disconnect();
        }

        state.socket =
            null;
    }

    // ---------------------------------------------------------------------
    // Nova conversa
    // ---------------------------------------------------------------------

    function startNewConversation() {
        if (
            !state.socket
            ||
            !state.connected
            ||
            state.processing
        ) {
            return;
        }

        state.socket.emit(
            'resetar_conversa'
        );
    }

    // ---------------------------------------------------------------------
    // Enviar mensagem
    // ---------------------------------------------------------------------

    function sendMessage() {
        const text =
            elements.messageInput
                .value
                .trim();

        if (
            !text
            ||
            state.processing
        ) {
            return;
        }

        if (
            !state.role
        ) {
            showToast(
                (
                    'Perfil não identificado. '
                    +
                    'Abra o Sparky pela plataforma AstroLearn.'
                ),
                'error'
            );

            return;
        }

        if (
            text.length >
                CONFIG
                    .maxMessageLength
        ) {
            showToast(
                (
                    `A mensagem deve ter até ${
                        CONFIG.maxMessageLength
                    } caracteres.`
                ),
                'error'
            );

            return;
        }

        if (
            !state.socket
            ||
            !state.connected
        ) {
            showToast(
                'O Sparky ainda não está conectado.',
                'error'
            );

            return;
        }

        if (
            containsBlockedContent(
                text
            )
        ) {
            showToast(
                (
                    'Essa mensagem contém conteúdo '
                    +
                    'não permitido na plataforma.'
                ),
                'error'
            );

            addMessage(
                'error',
                (
                    'O Sparky aceita apenas conteúdos '
                    +
                    'apropriados para o ambiente educacional.'
                )
            );

            elements.messageInput
                .value =
                '';

            updateCharacterCounter();

            resizeComposer();

            updateControls();

            return;
        }

        const requestId =
            createRequestId();

        state.pendingRequestId =
            requestId;

        /*
         * A área grande de sugestões desaparece
         * assim que começa a conversa.
         */
        elements.quickStart.hidden =
            true;

        addMessage(
            'user',
            text
        );

        elements.messageInput
            .value =
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

    // ---------------------------------------------------------------------
    // Filtro
    // ---------------------------------------------------------------------

    function containsBlockedContent(
        text
    ) {
        if (
            typeof text !==
                'string'
        ) {
            return false;
        }

        const normalized =
            text
                .normalize(
                    'NFD'
                )
                .replace(
                    /[\u0300-\u036f]/g,
                    ''
                )
                .toLowerCase();

        return CLIENT_BLOCKED_PATTERNS
            .some(
                (pattern) =>
                    pattern.test(
                        normalized
                    )
            );
    }

    // ---------------------------------------------------------------------
    // Sugestões
    // ---------------------------------------------------------------------

    function selectPrompt(
        prompt
    ) {
        if (
            !prompt
            ||
            !state.role
        ) {
            return;
        }

        elements.messageInput
            .value =
            prompt.slice(
                0,
                CONFIG
                    .maxMessageLength
            );

        updateCharacterCounter();

        resizeComposer();

        if (
            !state.connected
        ) {
            startConversation();
        } else {
            elements
                .messageInput
                .focus();
        }

        updateControls();
    }

    // ---------------------------------------------------------------------
    // Request ID
    // ---------------------------------------------------------------------

    function createRequestId() {
        if (
            window.crypto
                ?.randomUUID
        ) {
            return window.crypto
                .randomUUID();
        }

        return (
            `msg-${Date.now()}-${
                Math.random()
                    .toString(36)
                    .slice(
                        2,
                        10
                    )
            }`
        );
    }

    function shouldIgnoreResponse(
        requestId
    ) {
        if (
            !requestId
        ) {
            return false;
        }

        if (
            state.expiredRequestIds
                .has(
                    requestId
                )
        ) {
            return true;
        }

        return Boolean(
            state.pendingRequestId
            &&
            requestId !==
                state.pendingRequestId
        );
    }

    function resetPendingRequest() {
        clearResponseTimeout();

        state.pendingRequestId =
            null;
    }

    // ---------------------------------------------------------------------
    // Mensagens
    // ---------------------------------------------------------------------

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
                ?
                sender
                :
                'bot';

        const message =
            document.createElement(
                'article'
            );

        const safeTextValue =
            String(
                text ??
                ''
            );

        if (
            normalizedSender ===
                'system'
            ||
            normalizedSender ===
                'error'
        ) {
            message.className =
                'message is-system';

            const pill =
                document
                    .createElement(
                        'p'
                    );

            pill.className =
                (
                    `system-pill${
                        normalizedSender ===
                        'error'
                            ?
                            ' is-error'
                            :
                            ''
                    }`
                );

            pill.textContent =
                safeTextValue;

            message.appendChild(
                pill
            );
        } else {
            message.className =
                `message is-${normalizedSender}`;

            const avatar =
                document
                    .createElement(
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
                    ?
                    'EU'
                    :
                    'S+';

            const card =
                document
                    .createElement(
                        'div'
                    );

            card.className =
                'message-card';

            const meta =
                document
                    .createElement(
                        'div'
                    );

            meta.className =
                'message-meta';

            const author =
                document
                    .createElement(
                        'span'
                    );

            author.textContent =
                normalizedSender ===
                    'user'
                    ?
                    'Você'
                    :
                    'Sparky';

            const time =
                document
                    .createElement(
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

            const content =
                document
                    .createElement(
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

            if (
                normalizedSender ===
                    'bot'
                &&
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

            elements.messageCount
                .textContent =
                String(
                    state.messageCount
                );
        }

        elements.chatBox
            .appendChild(
                message
            );

        if (
            state.messageCount >
                0
        ) {
            elements.quickStart.hidden =
                true;
        }

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

    // ---------------------------------------------------------------------
    // Botão copiar
    // ---------------------------------------------------------------------

    function createMessageActions(
        text
    ) {
        const actions =
            document
                .createElement(
                    'div'
                );

        actions.className =
            'message-actions';

        const copyButton =
            document
                .createElement(
                    'button'
                );

        copyButton.type =
            'button';

        copyButton.className =
            'message-action';

        copyButton.textContent =
            'Copiar';

        copyButton
            .addEventListener(
                'click',
                async () => {
                    try {
                        await navigator
                            .clipboard
                            .writeText(
                                text
                            );

                        copyButton
                            .textContent =
                            'Copiado ✓';

                        window.setTimeout(
                            () => {
                                copyButton
                                    .textContent =
                                    'Copiar';
                            },
                            1600
                        );
                    } catch {
                        showToast(
                            (
                                'Não foi possível copiar '
                                +
                                'automaticamente.'
                            ),
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

    // ---------------------------------------------------------------------
    // Markdown seguro
    // ---------------------------------------------------------------------

    function renderSafeMarkdown(
        container,
        text
    ) {
        if (
            window.marked
            &&
            window.DOMPurify
        ) {
            const parsed =
                window.marked.parse(
                    text,
                    {
                        breaks:
                            true,

                        gfm:
                            true
                    }
                );

            container.innerHTML =
                window.DOMPurify
                    .sanitize(
                        parsed,
                        {
                            USE_PROFILES: {
                                html:
                                    true
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

        container.textContent =
            text;
    }

    // ---------------------------------------------------------------------
    // Limpeza
    // ---------------------------------------------------------------------

    function clearChat(
        message = ''
    ) {
        elements.chatBox
            .replaceChildren();

        state.messageCount =
            0;

        elements.messageCount
            .textContent =
            '0';

        elements.quickStart.hidden =
            !state.role;

        if (
            message
        ) {
            addMessage(
                'system',
                message
            );
        }
    }

    // ---------------------------------------------------------------------
    // Processamento
    // ---------------------------------------------------------------------

    function setProcessing(
        processing
    ) {
        state.processing =
            Boolean(
                processing
            );

        elements.typingIndicator
            .hidden =
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
                    ?
                    'Aguarde'
                    :
                    'Enviar';
        }

        if (
            !state.processing
        ) {
            clearResponseTimeout();
        }

        updateControls();
    }

    // ---------------------------------------------------------------------
    // Controles
    // ---------------------------------------------------------------------

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
            state.connected
            &&
            !state.processing
            &&
            hasRole;

        const connecting =
            Boolean(
                state.socket
                &&
                !state.connected
                &&
                !state.manualDisconnect
            );

        elements.messageInput
            .disabled =
            !canWrite;

        elements.sendButton
            .disabled =
            !canWrite
            ||
            !hasText;

        elements.startButton
            .disabled =
            state.connected
            ||
            connecting
            ||
            !hasRole;

        elements.disconnectButton
            .disabled =
            !state.socket;

        elements.newConversationButton
            .disabled =
            !canWrite;
    }

    // ---------------------------------------------------------------------
    // Status
    // ---------------------------------------------------------------------

    function updateConnectionStatus(
        status,
        label
    ) {
        elements.connectionStatus
            .className =
            `connection-badge is-${status}`;

        elements.statusLabel
            .textContent =
            label;
    }

    // ---------------------------------------------------------------------
    // Contador
    // ---------------------------------------------------------------------

    function updateCharacterCounter() {
        const length =
            elements.messageInput
                .value
                .length;

        elements.characterCounter
            .textContent =
            `${length} / ${CONFIG.maxMessageLength}`;
    }

    // ---------------------------------------------------------------------
    // Textarea
    // ---------------------------------------------------------------------

    function resizeComposer() {
        elements.messageInput
            .style
            .height =
            'auto';

        elements.messageInput
            .style
            .height =
            `${
                Math.min(
                    elements.messageInput
                        .scrollHeight,
                    140
                )
            }px`;
    }

    // ---------------------------------------------------------------------
    // Cronômetro
    // ---------------------------------------------------------------------

    function startSessionTimer() {
        if (
            !state.sessionStartedAt
        ) {
            state.sessionStartedAt =
                Date.now();
        }

        elements.sessionLabel
            .textContent =
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
                    Date.now()
                    -
                    state.sessionStartedAt
                )
                /
                1000
            );

        const minutes =
            String(
                Math.floor(
                    elapsedSeconds
                    /
                    60
                )
            )
                .padStart(
                    2,
                    '0'
                );

        const seconds =
            String(
                elapsedSeconds
                %
                60
            )
                .padStart(
                    2,
                    '0'
                );

        elements.sessionTime
            .textContent =
            `${minutes}:${seconds}`;
    }

    // ---------------------------------------------------------------------
    // Timeout
    // ---------------------------------------------------------------------

    function armResponseTimeout(
        requestId
    ) {
        clearResponseTimeout();

        state.responseTimeoutId =
            window.setTimeout(
                () => {

                    if (
                        !state.processing
                        ||
                        state.pendingRequestId !==
                            requestId
                    ) {
                        return;
                    }

                    state.expiredRequestIds
                        .add(
                            requestId
                        );

                    if (
                        state.expiredRequestIds
                            .size >
                        30
                    ) {
                        const oldest =
                            state
                                .expiredRequestIds
                                .values()
                                .next()
                                .value;

                        state.expiredRequestIds
                            .delete(
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
                            'A resposta demorou mais que o esperado. '
                            +
                            'Você pode tentar novamente.'
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

    // ---------------------------------------------------------------------
    // Toast
    // ---------------------------------------------------------------------

    function showToast(
        message,
        type = 'info'
    ) {
        const toast =
            document.createElement(
                'div'
            );

        toast.className =
            (
                `toast${
                    type ===
                    'error'
                        ?
                        ' is-error'
                        :
                        ''
                }`
            );

        toast.textContent =
            message;

        elements.toastRegion
            .appendChild(
                toast
            );

        window.setTimeout(
            () =>
                toast.remove(),
            4500
        );
    }

    // ---------------------------------------------------------------------
    // Horário
    // ---------------------------------------------------------------------

    function formatTime(
        date
    ) {
        return (
            new Intl.DateTimeFormat(
                'pt-BR',
                {
                    hour:
                        '2-digit',

                    minute:
                        '2-digit'
                }
            )
                .format(
                    date
                )
        );
    }
})();