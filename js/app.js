import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, set, onValue, push, get, update } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

/**
 * Thermo Bandapp - App Principal
 */

const DEFAULT_COUPLES = [
    ['Fernando', 'Esther'],
    ['Pedro', 'Tina'],
    ['Karlos', 'Ana'],
    ['Jose', 'Belen'],
    ['David', 'Rosa'],
    ['Antonio', 'Pili']
];

const App = {
    state: {
        user: null,
        tableId: null,
        tableData: null,
        currentView: 'setup',
        tempSelection: [],
        currentPayer: null,
        allTotals: {},
        settleMode: 'single',
        contributions: {},
        partyId: null,
        partyData: null,
        tempLoginName: null,
        tempLoginCode: null,
        couples: {},
        theme: 'dark',
        fontSize: 'small',
        historyTables: [],
        historyParties: [],
        historyCurrentTab: 'tables',
        historySearchQuery: '',
        previousView: 'setup',
        historyActiveDetailTab: 'ticket',
        historyActivePartyDetailTab: 'balances'
    },

    init() {
        console.log('Thermo Bandapp inicializada 🍻');
        this.initTheme();
        this.initFontSize();
        this.initFirebase();
        this.cacheDOM();
        this.bindEvents();
        this.loadLocalSession();
        this.initDecimalNormalizer();
        this.initScrollFades();
    },

    initTheme() {
        const savedTheme = localStorage.getItem('thermo_theme') || 'dark';
        this.applyTheme(savedTheme);
    },

    toggleTheme() {
        const newTheme = this.state.theme === 'dark' ? 'light' : 'dark';
        this.applyTheme(newTheme);
    },

    applyTheme(theme) {
        this.state.theme = theme;
        localStorage.setItem('thermo_theme', theme);
        const iconEl = document.getElementById('theme-toggle-icon');
        const toggleBtn = document.getElementById('btn-toggle-theme');

        if (theme === 'light') {
            document.body.classList.remove('dark-theme');
            document.body.classList.add('light-theme');
            if (iconEl) iconEl.textContent = '🌙';
            if (toggleBtn) toggleBtn.title = 'Cambiar a Modo Oscuro';
        } else {
            document.body.classList.remove('light-theme');
            document.body.classList.add('dark-theme');
            if (iconEl) iconEl.textContent = '☀️';
            if (toggleBtn) toggleBtn.title = 'Cambiar a Modo Claro';
        }
    },

    // Inicializa el sistema de tamaño de fuente
    initFontSize() {
        const savedSize = localStorage.getItem('thermo_font_size') || 'small';
        this.applyFontSize(savedSize);

        // Re-calibrar según orientación o tamaño de pantalla
        window.addEventListener('resize', () => {
            if (this.state.fontSize) {
                this.applyFontSize(this.state.fontSize, false);
            }
        });
    },

    setFontSize(size) {
        if (!['small', 'medium', 'large'].includes(size)) size = 'small';
        this.applyFontSize(size);
    },

    // Evalúa el dispositivo y calcula factores de crecimiento proporcionados (máximo +10%)
    getDeviceFontCalibration(size) {
        const width = window.innerWidth || document.documentElement.clientWidth || 390;
        
        if (size === 'small') {
            return { rootScale: 1.0 };
        }

        // Calibración adaptativa según pantalla
        let maxBoost = 1.10; // Aumento máximo del 10%
        let midBoost = 1.05; // Aumento medio del 5%

        if (width <= 360) {
            // Dispositivos compactos: factor calibrado para evitar desbordes
            maxBoost = 1.08;
            midBoost = 1.04;
        } else if (width <= 400) {
            maxBoost = 1.095;
            midBoost = 1.048;
        }

        if (size === 'medium') {
            return {
                rootScale: 1 + (midBoost - 1) * 0.65
            };
        }

        // size === 'large': Escala base que junto al boost de pequeños alcanza hasta el 10% máximo
        return {
            rootScale: 1 + (maxBoost - 1) * 0.68
        };
    },

    applyFontSize(size, save = true) {
        this.state.fontSize = size;
        if (save) {
            localStorage.setItem('thermo_font_size', size);
        }

        const cal = this.getDeviceFontCalibration(size);
        document.documentElement.style.setProperty('--root-font-scale', cal.rootScale);
        document.documentElement.setAttribute('data-font-size', size);

        // Actualizar visualmente los botones del selector
        const buttons = document.querySelectorAll('.font-size-btn');
        buttons.forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-size') === size);
        });
    },

    // Convierte comas en puntos en todos los inputs numéricos de la app
    initDecimalNormalizer() {
        document.addEventListener('input', (e) => {
            const el = e.target;
            if (el.tagName === 'INPUT' && (el.type === 'number' || el.inputMode === 'decimal')) {
                const val = el.value;
                if (val.includes(',')) {
                    el.value = val.replace(',', '.');
                }
            }
        }, true);
    },

    // Helper: parsea un string numérico aceptando tanto punto como coma decimal
    parseAmount(value) {
        if (value === null || value === undefined || value === '') return NaN;
        return parseFloat(String(value).trim().replace(',', '.'));
    },

    // Helper: formatea un número usando siempre la coma decimal para pantalla (ej: 2.5 -> "2,50")
    formatPrice(value) {
        const num = Number(value);
        if (isNaN(num)) return '0,00';
        return num.toFixed(2).replace('.', ',');
    },

    // Helper: formatea número con símbolo de euro (ej: 2.5 -> "2,50€")
    formatEuro(value) {
        return `${this.formatPrice(value)}€`;
    },

    // Helper: obtiene el nombre base del bar a partir del nombre de la mesa
    getBarName() {
        const rawName = this.state.tableData?.name || '';
        if (!rawName) return 'Bar';
        // Quita sufijos de fecha o mesa: ej "La Tasca (07/10/2026)" o "La Tasca (Mesa 01)"
        return rawName.split(' (')[0].trim() || 'Bar';
    },

    // Normaliza nombres para búsqueda sin tildes ni mayúsculas (ej: Belén -> belen, José -> jose)
    normalizeKey(name) {
        if (!name) return '';
        return String(name).trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    },

    // Obtiene el nombre de la pareja de una persona (o null si no tiene)
    getPartner(name) {
        if (!name) return null;
        const key = this.normalizeKey(name);
        if (this.state.couples && this.state.couples[key]) {
            return this.state.couples[key];
        }
        for (const [p1, p2] of DEFAULT_COUPLES) {
            if (this.normalizeKey(p1) === key) return p2;
            if (this.normalizeKey(p2) === key) return p1;
        }
        return null;
    },

    // Comprueba si dos personas son pareja
    areCouple(name1, name2) {
        if (!name1 || !name2) return false;
        const partner = this.getPartner(name1);
        return partner && this.normalizeKey(partner) === this.normalizeKey(name2);
    },

    // Comprueba si la pareja de alguien está actualmente en la mesa y activa
    isPartnerAtTable(name, participants = null) {
        const partner = this.getPartner(name);
        if (!partner) return null;
        const parts = participants || Object.values(this.state.tableData?.participants || {});
        const partnerPart = parts.find(p => p.status !== 'left' && this.normalizeKey(p.name) === this.normalizeKey(partner));
        return partnerPart ? partnerPart.name : null;
    },

    // Comprueba si la pareja de alguien está registrada en la fiesta (y opcionalmente si sigue activa)
    isPartnerInParty(name, participants = null, onlyActive = false) {
        const partner = this.getPartner(name);
        if (!partner) return null;
        const parts = participants || Object.values(this.state.partyData?.participants || {});
        const partnerPart = parts.find(p => {
            if (this.normalizeKey(p.name) !== this.normalizeKey(partner)) return false;
            if (onlyActive && p.status === 'left') return false;
            return true;
        });
        return partnerPart ? partnerPart.name : null;
    },

    // Guarda o desvincula una pareja en Firebase bidireccionalmente
    async setCouple(name1, name2) {
        if (!name1) return;
        const k1 = this.normalizeKey(name1);
        if (!name2) {
            const oldPartner = this.getPartner(name1);
            await set(ref(this.db, `couples/${k1}`), null);
            if (oldPartner) {
                await set(ref(this.db, `couples/${this.normalizeKey(oldPartner)}`), null);
            }
            if (this.state.couples) {
                delete this.state.couples[k1];
                if (oldPartner) delete this.state.couples[this.normalizeKey(oldPartner)];
            }
            return;
        }

        const k2 = this.normalizeKey(name2);
        const old1 = this.getPartner(name1);
        const old2 = this.getPartner(name2);

        const promises = [
            set(ref(this.db, `couples/${k1}`), name2),
            set(ref(this.db, `couples/${k2}`), name1)
        ];
        if (old1 && this.normalizeKey(old1) !== k2) {
            promises.push(set(ref(this.db, `couples/${this.normalizeKey(old1)}`), null));
        }
        if (old2 && this.normalizeKey(old2) !== k1) {
            promises.push(set(ref(this.db, `couples/${this.normalizeKey(old2)}`), null));
        }
        await Promise.all(promises);

        if (this.state.couples) {
            this.state.couples[k1] = name2;
            this.state.couples[k2] = name1;
        }
    },

    // Escucha en tiempo real los cambios de parejas en Firebase
    listenToCouples() {
        const couplesRef = ref(this.db, 'couples');
        onValue(couplesRef, async (snapshot) => {
            if (!snapshot.exists()) {
                console.log('Inicializando parejas por defecto en Firebase...');
                await this.seedDefaultCouples();
                return;
            }
            this.state.couples = snapshot.val() || {};
            // Re-renderizar vistas activas
            if (this.state.tableData) {
                this.calculateTotals();
                this.updateSummaryUI();
                if (this.state.currentView === 'settle') {
                    if (this.state.settleMode === 'group') this.updatePotUI();
                    else this.updateChangeAssistantUI();
                }
            }
            if (this.state.currentView === 'admin-view') {
                this.loadAdminMembers();
            }
        });
    },

    async seedDefaultCouples() {
        const initial = {};
        for (const [p1, p2] of DEFAULT_COUPLES) {
            initial[this.normalizeKey(p1)] = p2;
            initial[this.normalizeKey(p2)] = p1;
        }
        try {
            await set(ref(this.db, 'couples'), initial);
            this.state.couples = initial;
        } catch (e) {
            console.error('Error sembrando parejas:', e);
            this.state.couples = initial;
        }
    },

    initFirebase() {
        try {
            this.app = initializeApp(firebaseConfig);
            this.db = getDatabase(this.app);
            console.log('Firebase conectado correctamente ✅');
            this.listenToBars();
            this.listenToCouples();
        } catch (error) {
            console.error('Error al conectar con Firebase:', error);
            alert('Error de conexión con la base de datos.');
        }
    },

    cacheDOM() {
        this.views = {
            setup: document.getElementById('setup-view'),
            summary: document.getElementById('summary-view'),
            order: document.getElementById('order-view'),
            settle: document.getElementById('settle-view'),
            'party-pot': document.getElementById('party-pot-view'),
            'admin-view': document.getElementById('admin-view'),
            'login-view': document.getElementById('login-view'),
            'history-view': document.getElementById('history-view')
        };
        this.inputs = {
            userName: document.getElementById('user-name'),
            userNameParty: document.getElementById('user-name-party'),
            loginUser: document.getElementById('login-user'),
            loginCode: document.getElementById('login-code'),
            barName: document.getElementById('bar-name'),
            tableNum: document.getElementById('table-num'),
            btnToggleBarDropdown: document.getElementById('btn-toggle-bar-dropdown'),
            barDropdownList: document.getElementById('bar-dropdown-list')
        };
        this.buttons = {
            createTable: document.getElementById('btn-create-table'),
            joinTable: document.getElementById('btn-join-table'),
            addProduct: document.getElementById('btn-add-product-menu'),
            repeatRound: document.getElementById('btn-repeat-round'),
            reorderMenu: document.getElementById('btn-reorder-menu'),
            leaveTable: document.getElementById('btn-leave-table'),
            createParty: document.getElementById('btn-create-party-main'),
            partySettlements: document.getElementById('btn-party-settlements'),
            addPartyExpense: document.getElementById('btn-party-add-expense'),
            addPartyFriend: document.getElementById('btn-party-add-friend'),
            partyGoHome: document.getElementById('btn-party-go-home'),
            loginSubmit: document.getElementById('btn-login-submit'),
            adminSaveMember: document.getElementById('btn-admin-save-member'),
            showTicket: document.getElementById('btn-show-ticket'),
            auditTicket: document.getElementById('btn-audit-ticket')
        };
        this.display = {
            adminPanelBtn: document.getElementById('admin-panel-btn'),
            adminMembersList: document.getElementById('admin-members-list'),
            tableName: document.getElementById('display-table-name'),
            tableCode: document.getElementById('display-table-code'),
            participants: document.getElementById('participants-container'),
            menu: document.getElementById('menu-container'),
            recentOrders: document.getElementById('recent-orders-container'),
            totalBill: document.getElementById('total-bill'),
            myShare: document.getElementById('my-share'),
            modalOverlay: document.getElementById('modal-overlay'),
            modalContent: document.getElementById('modal-content'),
            payerSelector: document.getElementById('payer-selector-container'),
            debtsList: document.getElementById('change-assistant-list'),
            finishTable: document.getElementById('btn-finish-table'),
            addFriendManual: document.getElementById('btn-add-friend-manual')
        };
        this.nav = document.querySelector('.main-nav');
    },

    bindEvents() {
        this.buttons.createTable.addEventListener('click', () => this.handleCreateTable());
        this.buttons.joinTable.addEventListener('click', () => this.handleJoinTable());
        this.buttons.addProduct.addEventListener('click', () => this.handleAddProductMenu());
        if (this.buttons.repeatRound) {
            this.buttons.repeatRound.addEventListener('click', () => this.handleRepeatRoundSelector());
        }
        if (this.buttons.reorderMenu) {
            this.buttons.reorderMenu.addEventListener('click', () => this.handleOpenReorderMenuModal());
        }
        this.buttons.leaveTable.addEventListener('click', () => this.handleLeaveTable());
        document.getElementById('btn-close-modal').addEventListener('click', () => this.closeModal());

        // Prevenir que el scroll del modal se transmita a la ventana de fondo (Scroll Chaining)
        if (this.display.modalOverlay) {
            let touchStartY = 0;

            this.display.modalOverlay.addEventListener('touchstart', (e) => {
                if (e.touches && e.touches.length === 1) {
                    touchStartY = e.touches[0].clientY;
                }
            }, { passive: true });

            this.display.modalOverlay.addEventListener('touchmove', (e) => {
                // Si el toque es sobre el fondo oscurecido o un área no scrollable, bloquear totalmente
                if (e.target === this.display.modalOverlay) {
                    e.preventDefault();
                    return;
                }

                // Buscar el contenedor scrollable más cercano
                let el = e.target;
                let scrollableEl = null;
                while (el && el !== this.display.modalOverlay) {
                    const style = window.getComputedStyle(el);
                    const overflowY = style.overflowY;
                    if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight) {
                        scrollableEl = el;
                        break;
                    }
                    el = el.parentElement;
                }

                // Si se toca un elemento que no scrollea (cabecera, pestañas, botones...), bloquear scroll
                if (!scrollableEl) {
                    e.preventDefault();
                    return;
                }

                // Si está en un contenedor scrolleable pero llega a los topes, evitar que transmita el scroll al fondo
                if (e.touches && e.touches.length === 1) {
                    const currentY = e.touches[0].clientY;
                    const deltaY = currentY - touchStartY;
                    const isAtTop = scrollableEl.scrollTop <= 0;
                    const isAtBottom = scrollableEl.scrollTop + scrollableEl.clientHeight >= scrollableEl.scrollHeight - 1;

                    if (isAtTop && deltaY > 0) {
                        e.preventDefault();
                        return;
                    }
                    if (isAtBottom && deltaY < 0) {
                        e.preventDefault();
                        return;
                    }
                }
            }, { passive: false });

            // En dispositivos con rueda de ratón o trackpad, evitar que el scroll escape del modal
            this.display.modalOverlay.addEventListener('wheel', (e) => {
                let el = e.target;
                let scrollableEl = null;
                while (el && el !== this.display.modalOverlay) {
                    const style = window.getComputedStyle(el);
                    const overflowY = style.overflowY;
                    if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight) {
                        scrollableEl = el;
                        break;
                    }
                    el = el.parentElement;
                }
                if (!scrollableEl) {
                    e.preventDefault();
                    return;
                }
                const isAtTop = scrollableEl.scrollTop <= 0;
                const isAtBottom = scrollableEl.scrollTop + scrollableEl.clientHeight >= scrollableEl.scrollHeight - 1;
                if ((isAtTop && e.deltaY < 0) || (isAtBottom && e.deltaY > 0)) {
                    e.preventDefault();
                }
            }, { passive: false });
        }
        this.display.finishTable.addEventListener('click', () => this.handleFinishTable());
        this.display.addFriendManual.addEventListener('click', () => this.handleAddFriendManual());
        if (this.buttons.showTicket) {
            this.buttons.showTicket.addEventListener('click', () => this.handleShowTicket());
        }
        if (this.buttons.auditTicket) {
            this.buttons.auditTicket.addEventListener('click', () => this.startTicketAudit());
        }
        const ticketCamInput = document.getElementById('ticket-camera-input');
        if (ticketCamInput) {
            ticketCamInput.addEventListener('change', (e) => {
                if (e.target.files && e.target.files[0]) {
                    this.handleTicketPhotoSelected(e.target.files[0]);
                    e.target.value = '';
                }
            });
        }
        
        if (this.buttons.createParty) {
            this.buttons.createParty.addEventListener('click', () => this.handleCreatePartyFromSetup());
        }
        document.getElementById('btn-join-party-main')?.addEventListener('click', () => this.handleJoinPartyFromSetup());
        if (this.buttons.partySettlements) {
            this.buttons.partySettlements.addEventListener('click', () => this.handlePartyGoHome());
        }
        if (this.buttons.addPartyExpense) {
            this.buttons.addPartyExpense.addEventListener('click', () => this.handlePartyAddExpense());
        }
        if (this.buttons.addPartyFriend) {
            this.buttons.addPartyFriend.addEventListener('click', () => this.handlePartyAddFriend());
        }
        if (this.buttons.partyGoHome) {
            this.buttons.partyGoHome.addEventListener('click', () => this.handlePartyGoHome());
        }
        this.buttons.loginSubmit.addEventListener('click', () => this.handleLogin());
        if (this.buttons.adminSaveMember) {
            this.buttons.adminSaveMember.addEventListener('click', () => this.handleSaveMember());
        }

        document.querySelectorAll('.nav-item').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const view = e.currentTarget.dataset.view;
                document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
                e.currentTarget.classList.add('active');
                this.showView(view);
            });
        });

        // Combobox de Selección de Bar
        if (this.inputs.btnToggleBarDropdown) {
            this.inputs.btnToggleBarDropdown.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleBarDropdown();
            });
        }

        if (this.inputs.barName) {
            this.inputs.barName.addEventListener('click', (e) => {
                e.stopPropagation();
                this.openBarDropdown();
            });
            this.inputs.barName.addEventListener('input', (e) => {
                this.openBarDropdown();
                this.updateBarsDropdownUI(e.target.value);
            });
        }

        // Cerrar dropdown al hacer clic fuera
        document.addEventListener('click', (e) => {
            if (this.inputs.barDropdownList && !e.target.closest('.bar-combobox')) {
                this.closeBarDropdown();
            }
        });

        // Edición de nombre de mesa
        const editTableBtn = document.getElementById('btn-edit-table-name');
        if (editTableBtn) {
            editTableBtn.addEventListener('click', () => this.handleRenameTable());
        }
    },

    switchSetupMode(mode, element) {
        console.log('Cambiando a modo nuclear:', mode);
        
        // 1. Botones
        document.querySelectorAll('.mode-tab').forEach(t => t.classList.remove('active'));
        element.classList.add('active');

        // 2. Formularios
        const barForm = document.getElementById('setup-form-bar');
        const partyForm = document.getElementById('setup-form-party');
        
        if (mode === 'bar') {
            barForm.classList.remove('hidden');
            partyForm.classList.add('hidden');
        } else {
            barForm.classList.add('hidden');
            partyForm.classList.remove('hidden');
        }
    },

    loadLocalSession() {
        const savedUser = localStorage.getItem('thermo_user');
        const savedTableId = localStorage.getItem('thermo_tableId');
        const savedPartyId = localStorage.getItem('thermo_partyId');
        const isAuth = localStorage.getItem('thermo_auth');

        // Si no hay login, forzamos login y NO seguimos
        if (!isAuth) {
            console.log('No hay sesión de miembro. Bloqueando en login-view.');
            this.showView('login-view');
            return;
        }

        console.log('Sesión de miembro detectada:', savedUser);

        if (savedUser) {
            this.state.user = savedUser;
            this.updateHeaderUser();
            this.inputs.userName.value = savedUser;
            if (this.inputs.userNameParty) this.inputs.userNameParty.value = savedUser;
            
            if (savedUser.toLowerCase() === 'fernando') {
                this.display.adminPanelBtn.classList.remove('hidden');
            } else {
                this.display.adminPanelBtn.classList.add('hidden');
            }
        }

        if (savedTableId && savedUser) {
            this.state.tableId = savedTableId;
            this.showView('summary');
            this.listenToTable(savedTableId);
        } else if (savedPartyId && savedUser) {
            this.state.partyId = savedPartyId;
            this.showView('party-pot');
            this.listenToParty(savedPartyId);
        } else {
            // Si está logueado pero no hay mesa/fiesta, va al setup
            this.showView('setup');
        }
    },

    async handleLogin() {
        const user = this.state.tempLoginName || '';
        const code = this.inputs.loginCode.value.trim();
 
        if (!user) return alert('Por favor, selecciona primero un miembro.');
        if (!code) return alert('Rellena el código de administrador.');
 
        if (user.toLowerCase() !== 'fernando') {
            await this.executeDirectLogin(user);
            return;
        }
 
        try {
            if (code === this.state.tempLoginCode) {
                this.state.user = user;
                this.updateHeaderUser();
                localStorage.setItem('thermo_user', user);
                localStorage.setItem('thermo_auth', 'true');
                
                // Auto-rellenar en los formularios
                this.inputs.userName.value = user;
                if (this.inputs.userNameParty) this.inputs.userNameParty.value = user;
                
                this.display.adminPanelBtn.classList.remove('hidden');
                
                await this.addLog('login', { user: user, type: 'admin' });
                this.showView('setup');
            } else {
                alert('Código secreto incorrecto. Acceso denegado.');
            }
        } catch (error) { console.error(error); }
    },

    updateHeaderUser() {
        const headerUserName = document.getElementById('header-user-name');
        if (headerUserName) {
            headerUserName.textContent = this.state.user ? `· ${this.state.user}` : '';
        }
        // Actualizar el nombre en el botón "Cambiar de miembro"
        const switchName = document.getElementById('switch-member-name');
        if (switchName && this.state.user) {
            switchName.textContent = this.state.user;
        }
    },

    async addLog(action, details = {}) {
        const date = new Date().toISOString().split('T')[0];
        const logRef = push(ref(this.db, `logs/${date}`));
        await set(logRef, {
            timestamp: Date.now(),
            user: this.state.user || 'anonymous',
            action,
            ...details
        });
    },

    // --- FUNCIONES DE ADMINISTRACIÓN ---
    async showAdminView() {
        if (this.state.user !== 'Fernando') return; // Seguridad extra
        this.showView('admin-view');
        this.loadAdminMembers();
    },

    async loadAdminMembers() {
        try {
            const snapshot = await get(ref(this.db, 'members'));
            if (!snapshot.exists()) {
                this.display.adminMembersList.innerHTML = '<p>No hay miembros registrados.</p>';
                return;
            }
            
            const members = snapshot.val();
            const partnerSelect = document.getElementById('admin-member-partner');
            if (partnerSelect) {
                const currentSelected = partnerSelect.value;
                let optHtml = '<option value="">Sin pareja (Soltero/a)</option>';
                const sortedAll = Object.values(members).sort((a, b) => a.name.localeCompare(b.name));
                sortedAll.forEach(m => {
                    optHtml += `<option value="${m.name}">${m.name}</option>`;
                });
                partnerSelect.innerHTML = optHtml;
                partnerSelect.value = currentSelected || '';
            }

            let html = '';
            const sortedEntries = Object.entries(members).sort((a, b) => a[1].name.localeCompare(b[1].name));
            for (const [key, data] of sortedEntries) {
                const partner = this.getPartner(data.name);
                html += `
                    <div class="participant-item" style="display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                        <div style="flex: 1; min-width: 150px;">
                            <b>${data.name}</b> <span style="color: var(--text-muted); font-size: 0.9rem;">(Cód: ${data.code})</span>
                            ${partner ? `<span class="badge-couple" style="margin-left: 0.4rem;">💑 con ${partner}</span>` : ''}
                        </div>
                        <div style="display: flex; gap: 0.5rem;">
                            <button class="btn-secondary" onclick="App.handleEditMember('${data.name}', '${data.code}')" style="padding: 0.2rem 0.5rem; font-size: 0.8rem; background: rgba(255,255,255,0.1); border: 1px solid var(--glass-border);">Editar ✏️</button>
                            <button class="btn-leave" onclick="App.handleDeleteMember('${key}')" style="padding: 0.2rem 0.5rem; font-size: 0.8rem; margin: 0;">Eliminar 🗑️</button>
                        </div>
                    </div>
                `;
            }
            this.display.adminMembersList.innerHTML = html;
        } catch (error) { console.error(error); }
    },

    async handleSaveMember() {
        const nameInput = document.getElementById('admin-member-name').value.trim();
        const codeInput = document.getElementById('admin-member-code').value.trim();
        const partnerInput = document.getElementById('admin-member-partner')?.value.trim() || '';
        
        if (!nameInput || !codeInput) return alert('Rellena nombre y código');
        
        try {
            const key = this.normalizeKey(nameInput);
            await set(ref(this.db, `members/${key}`), {
                name: nameInput,
                code: codeInput
            });
            await this.setCouple(nameInput, partnerInput || null);

            alert(`Miembro ${nameInput} guardado correctamente.`);
            document.getElementById('admin-member-name').value = '';
            document.getElementById('admin-member-code').value = '';
            if (document.getElementById('admin-member-partner')) {
                document.getElementById('admin-member-partner').value = '';
            }
            this.loadAdminMembers();
            await this.addLog('admin_save_member', { targetUser: nameInput, partner: partnerInput });
        } catch (error) { console.error(error); }
    },

    handleEditMember(name, code) {
        document.getElementById('admin-member-name').value = name;
        document.getElementById('admin-member-code').value = code;
        const partnerSelect = document.getElementById('admin-member-partner');
        if (partnerSelect) {
            const partner = this.getPartner(name);
            partnerSelect.value = partner || '';
        }
        document.getElementById('admin-member-name').focus();
    },

    async handleDeleteMember(key) {
        if (key === 'fernando') return alert('No puedes eliminar al administrador principal.');
        if (!confirm(`¿Seguro que quieres eliminar al miembro ${key}?`)) return;
        
        try {
            const snapshot = await get(ref(this.db, `members/${key}`));
            const memberName = snapshot.exists() ? snapshot.val().name : key;
            await this.setCouple(memberName, null);
            await set(ref(this.db, `members/${key}`), null);
            this.loadAdminMembers();
            await this.addLog('admin_delete_member', { targetUser: key });
        } catch (error) { console.error(error); }
    },

    // --- FIN ADMINISTRACIÓN ---

    async handleJoinTable() {
        const userName = this.inputs.userName.value.trim();
        if (!userName) {
            alert('Por favor, dinos tu nombre primero.');
            return;
        }

        try {
            const tablesRef = ref(this.db, 'tables');
            const snapshot = await get(tablesRef);
            let activeTables = [];
            
            if (snapshot.exists()) {
                const allTables = snapshot.val();
                for (const [code, data] of Object.entries(allTables)) {
                    if (data.status === 'active') {
                        activeTables.push({ code, name: data.name, createdAt: data.createdAt });
                    }
                }
            }

            if (activeTables.length === 0) {
                alert('No hay mesas abiertas en este momento.');
                return;
            }

            activeTables.sort((a, b) => b.createdAt - a.createdAt);

            let html = `<h3>Mesas Abiertas</h3><div class="list-container" style="display:flex; flex-direction:column; gap:0.5rem; margin-top:1rem;">`;
            activeTables.forEach(t => {
                html += `<button class="btn-secondary" onclick="App.joinSpecificTable('${t.code}')">${t.name}</button>`;
            });
            html += `</div>`;
            this.openModal(html);

        } catch (error) {
            console.error('Error al obtener mesas:', error);
            alert('Error al conectar con la base de datos.');
        }
    },

    async joinSpecificTable(code) {
        this.closeModal();
        const userName = this.inputs.userName.value.trim();
        const tableRef = ref(this.db, `tables/${code}`);

        try {
            const snapshot = await get(tableRef);
            if (snapshot.exists()) {
                const participantRef = ref(this.db, `tables/${code}/participants/${userName.replace(/\./g, '_')}`);
                await set(participantRef, { 
                    name: userName, 
                    role: 'member', 
                    status: 'active',
                    joinedAt: Date.now() 
                });
                
                this.state.user = userName;
                this.state.tableId = code;
                localStorage.setItem('thermo_user', userName);
                localStorage.setItem('thermo_tableId', code);
                
                this.showView('summary');
                this.listenToTable(code);
            }
        } catch (error) {
            console.error('Error al unirse:', error);
        }
    },

    async handleCreateTable() {
        const userName = this.inputs.userName.value.trim();
        const barName = this.inputs.barName.value.trim();
        const tableNum = this.inputs.tableNum.value.trim() || '01';

        if (!userName || !barName) {
            alert('Por favor, rellena tu nombre y el del bar.');
            return;
        }

        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const tableId = `${barName.replace(/\s/g, '')}${dateStr}${tableNum.padStart(2, '0')}`;

        try {
            const tableRef = ref(this.db, `tables/${tableId}`);
            const snapshot = await get(tableRef);
            
            if (snapshot.exists() && snapshot.val().status !== 'closed') {
                if (!confirm('Esta mesa ya existe y está activa. ¿Quieres unirte a ella en lugar de crear una nueva?')) return;
                const participantRef = ref(this.db, `tables/${tableId}/participants/${userName.replace(/\./g, '_')}`);
                await set(participantRef, { 
                    name: userName, 
                    role: 'member', 
                    status: 'active',
                    joinedAt: Date.now() 
                });
            } else {
                // Se crea nueva mesa (si estaba cerrada, se sobreescribe limpiando la cuenta)

                const dateFormatted = new Date().toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
                const tableData = {
                    name: `${barName} (${dateFormatted})`,
                    creator: userName,
                    createdAt: Date.now(),
                    status: 'active',
                    participants: {
                        [userName.replace(/\./g, '_')]: { 
                            name: userName, 
                            role: 'admin', 
                            status: 'active',
                            joinedAt: Date.now() 
                        }
                    }
                };
                await set(tableRef, tableData);
            }

            this.state.user = userName;
            this.state.tableId = tableId;
            localStorage.setItem('thermo_user', userName);
            localStorage.setItem('thermo_tableId', tableId);

            // Guardar automáticamente en el listado de bares si no existe
            const barExists = Object.values(this.state.bars || {}).some(
                b => b.name.toLowerCase().trim() === barName.toLowerCase().trim()
            );
            if (!barExists) {
                const newBarRef = push(ref(this.db, 'bars'));
                await set(newBarRef, { name: barName });
            }

            // PERSISTENCIA: Cargar menú previo del bar si existe
            const barMenuRef = ref(this.db, `bar_menus/${barName.replace(/\s/g, '_')}`);
            const barMenuSnapshot = await get(barMenuRef);
            if (barMenuSnapshot.exists()) {
                await set(ref(this.db, `tables/${tableId}/menu`), barMenuSnapshot.val());
            }

            this.showView('summary');
            this.listenToTable(tableId);
            await this.addLog('create_table', { tableId, barName, tableNum });
        } catch (error) {
            console.error('Error al crear la mesa:', error);
            alert('Error al conectar con la base de datos.');
        }
    },

    handleAddProductMenu() {
        if (!this.state.tableId) {
            alert('No hay ninguna mesa activa.');
            return;
        }

        const html = `
            <div style="display: flex; flex-direction: column; gap: 0.85rem; text-align: left;">
                <h3 style="margin-bottom: 0;">➕ Añadir Producto al Menú</h3>
                
                <div>
                    <label style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.35rem; display: block;">Nombre del producto</label>
                    <input type="text" id="product-name-input" placeholder="Ej: Caña, Ración de bravas..." onkeydown="if(event.key==='Enter') App.confirmSaveNewProduct()" style="width: 100%; padding: 0.75rem 0.9rem; font-size: 1rem; box-sizing: border-box;">
                </div>

                <div style="display: flex; gap: 0.75rem;">
                    <div style="flex: 1;">
                        <label style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.35rem; display: block;">Precio (€)</label>
                        <input type="text" id="product-price-input" placeholder="Ej: 2,50" value="2,50" onkeydown="if(event.key==='Enter') App.confirmSaveNewProduct()" style="width: 100%; padding: 0.75rem 0.9rem; font-size: 1rem; box-sizing: border-box;">
                    </div>
                    <div style="width: 85px;">
                        <label style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.35rem; display: block;">Emoji</label>
                        <input type="text" id="product-icon-input" value="🍺" style="width: 100%; padding: 0.75rem 0.9rem; font-size: 1.15rem; text-align: center; box-sizing: border-box;">
                    </div>
                </div>

                <div>
                    <label style="font-size: 0.78rem; color: var(--text-muted); margin-bottom: 0.25rem; display: block;">Sugerencias de emoji:</label>
                    <div style="display: flex; gap: 0.35rem; flex-wrap: wrap;">
                        ${['🍺', '🍷', '🍹', '☕', '🥤', '🍟', '🧀', '🥩', '🍕', '🍴'].map(e => `
                            <button type="button" class="btn-icon-small" onclick="document.getElementById('product-icon-input').value = '${e}'" style="padding: 0.3rem 0.5rem; font-size: 1rem;">${e}</button>
                        `).join('')}
                    </div>
                </div>

                <div style="display: flex; gap: 0.75rem;">
                    <div style="flex: 1;">
                        <label style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.35rem; display: block;">Graduación (% vol)</label>
                        <input type="number" id="product-alcohol-input" step="0.1" min="0" max="100" placeholder="Ej: 5.0" onkeydown="if(event.key==='Enter') App.confirmSaveNewProduct()" style="width: 100%; padding: 0.75rem 0.9rem; font-size: 1rem; box-sizing: border-box;">
                    </div>
                    <div style="flex: 1;">
                        <label style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.35rem; display: block;">Centilitros (cl)</label>
                        <input type="number" id="product-cl-input" step="1" min="0" max="1000" placeholder="Ej: 33" onkeydown="if(event.key==='Enter') App.confirmSaveNewProduct()" style="width: 100%; padding: 0.75rem 0.9rem; font-size: 1rem; box-sizing: border-box;">
                    </div>
                </div>

                <div>
                    <label style="font-size: 0.78rem; color: var(--text-muted); margin-bottom: 0.25rem; display: block;">Atajos rápidos de bebida:</label>
                    <div style="display: flex; gap: 0.35rem; flex-wrap: wrap;">
                        <button type="button" class="btn-icon-small" onclick="App.setAlcoholPreset(5, 20, '🍺', false)" style="padding: 0.25rem 0.45rem; font-size: 0.75rem;">🍺 Caña (5% · 20cl)</button>
                        <button type="button" class="btn-icon-small" onclick="App.setAlcoholPreset(5, 33, '🍺', false)" style="padding: 0.25rem 0.45rem; font-size: 0.75rem;">🍺 Tercio (5% · 33cl)</button>
                        <button type="button" class="btn-icon-small" onclick="App.setAlcoholPreset(13, 15, '🍷', false)" style="padding: 0.25rem 0.45rem; font-size: 0.75rem;">🍷 Vino (13% · 15cl)</button>
                        <button type="button" class="btn-icon-small" onclick="App.setAlcoholPreset(40, 5, '🥃', false)" style="padding: 0.25rem 0.45rem; font-size: 0.75rem;">🥃 Chupito (40% · 5cl)</button>
                        <button type="button" class="btn-icon-small" onclick="App.setAlcoholPreset(12, 30, '🍹', false)" style="padding: 0.25rem 0.45rem; font-size: 0.75rem;">🍹 Cubata (12% · 30cl)</button>
                        <button type="button" class="btn-icon-small" onclick="App.setAlcoholPreset(0, 0, '🥤', false)" style="padding: 0.25rem 0.45rem; font-size: 0.75rem;">🥤 Sin alcohol (0%)</button>
                    </div>
                </div>

                <label style="display: flex; align-items: flex-start; gap: 0.65rem; cursor: pointer; user-select: none; padding: 0.75rem; background: rgba(255,255,255,0.05); border: 1px solid var(--glass-border); border-radius: var(--radius-sm); margin-top: 0.25rem;">
                    <input type="checkbox" id="product-escote-chk" style="width: 1.2rem; height: 1.2rem; accent-color: var(--primary); cursor: pointer; margin-top: 0.15rem;">
                    <span style="font-size: 0.88rem; line-height: 1.35;">
                        <strong>💎 Permitir pedir a escote</strong><br>
                        <span style="color: var(--text-muted); font-size: 0.78rem;">Habilita el botón para compartir este producto entre todos en la mesa (raciones, botellas, picoteo...).</span>
                    </span>
                </label>

                <button class="btn-primary" onclick="App.confirmSaveNewProduct()" style="width: 100%; padding: 0.85rem; font-size: 1rem; font-weight: 700; margin-top: 0.5rem;">Guardar Producto</button>
            </div>
        `;

        this.openModal(html);
        setTimeout(() => document.getElementById('product-name-input')?.focus(), 80);
    },

    async confirmSaveNewProduct() {
        if (!this.state.tableId) return;

        const nameInput = document.getElementById('product-name-input')?.value.trim();
        if (!nameInput) return alert('Escribe el nombre del producto.');

        const priceInput = document.getElementById('product-price-input')?.value.trim();
        const price = this.parseAmount(priceInput);
        if (isNaN(price) || price < 0) return alert('Precio inválido.');

        const iconInput = document.getElementById('product-icon-input')?.value.trim() || '🍴';
        const allowEscote = document.getElementById('product-escote-chk')?.checked ?? false;

        const alcoholInput = document.getElementById('product-alcohol-input')?.value.trim();
        const alcohol = alcoholInput !== '' && !isNaN(alcoholInput) ? Math.max(0, parseFloat(alcoholInput)) : 0;

        const clInput = document.getElementById('product-cl-input')?.value.trim();
        const cl = clInput !== '' && !isNaN(clInput) ? Math.max(0, parseFloat(clInput)) : 0;

        this.closeModal();

        try {
            const currentCount = Object.keys(this.state.tableData?.menu || {}).length;
            const productRef = push(ref(this.db, `tables/${this.state.tableId}/menu`));
            const productData = {
                name: nameInput,
                price,
                icon: iconInput,
                allowEscote: Boolean(allowEscote),
                alcohol,
                cl,
                order: currentCount
            };
            await set(productRef, productData);

            if (Array.isArray(this.state.tableData?.menuOrder)) {
                const newMenuOrder = [...this.state.tableData.menuOrder, productRef.key];
                await set(ref(this.db, `tables/${this.state.tableId}/menuOrder`), newMenuOrder);
            }

            // Sincronizar con la biblioteca del bar
            const barName = this.getBarName();
            if (barName) {
                const barMenuRef = ref(this.db, `bar_menus/${barName.replace(/\s/g, '_')}/${productRef.key}`);
                await set(barMenuRef, productData);
            }
        } catch (error) {
            console.error('Error al guardar el producto:', error);
            alert('Error al guardar el producto en la base de datos.');
        }
    },

    handleEditProduct(id, item) {
        if (!this.state.tableId) return;

        const safeName = (item.name || '').replace(/"/g, '&quot;');
        const safeIcon = (item.icon || '🍴').replace(/"/g, '&quot;');
        const isEscoteChecked = Boolean(item.allowEscote);

        const html = `
            <div style="display: flex; flex-direction: column; gap: 0.85rem; text-align: left;">
                <h3 style="margin-bottom: 0;">✏️ Editar Producto</h3>
                
                <div>
                    <label style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.35rem; display: block;">Nombre del producto</label>
                    <input type="text" id="edit-product-name-input" value="${safeName}" onkeydown="if(event.key==='Enter') App.confirmSaveEditProduct('${id}')" style="width: 100%; padding: 0.75rem 0.9rem; font-size: 1rem; box-sizing: border-box;">
                </div>

                <div style="display: flex; gap: 0.75rem;">
                    <div style="flex: 1;">
                        <label style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.35rem; display: block;">Precio (€)</label>
                        <input type="text" id="edit-product-price-input" value="${this.formatPrice(item.price)}" onkeydown="if(event.key==='Enter') App.confirmSaveEditProduct('${id}')" style="width: 100%; padding: 0.75rem 0.9rem; font-size: 1rem; box-sizing: border-box;">
                    </div>
                    <div style="width: 85px;">
                        <label style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.35rem; display: block;">Emoji</label>
                        <input type="text" id="edit-product-icon-input" value="${safeIcon}" style="width: 100%; padding: 0.75rem 0.9rem; font-size: 1.15rem; text-align: center; box-sizing: border-box;">
                    </div>
                </div>

                <div>
                    <label style="font-size: 0.78rem; color: var(--text-muted); margin-bottom: 0.25rem; display: block;">Sugerencias de emoji:</label>
                    <div style="display: flex; gap: 0.35rem; flex-wrap: wrap;">
                        ${['🍺', '🍷', '🍹', '☕', '🥤', '🍟', '🧀', '🥩', '🍕', '🍴'].map(e => `
                            <button type="button" class="btn-icon-small" onclick="document.getElementById('edit-product-icon-input').value = '${e}'" style="padding: 0.3rem 0.5rem; font-size: 1rem;">${e}</button>
                        `).join('')}
                    </div>
                </div>

                <div style="display: flex; gap: 0.75rem;">
                    <div style="flex: 1;">
                        <label style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.35rem; display: block;">Graduación (% vol)</label>
                        <input type="number" id="edit-product-alcohol-input" step="0.1" min="0" max="100" value="${item.alcohol !== undefined ? item.alcohol : ''}" placeholder="Ej: 5.0" onkeydown="if(event.key==='Enter') App.confirmSaveEditProduct('${id}')" style="width: 100%; padding: 0.75rem 0.9rem; font-size: 1rem; box-sizing: border-box;">
                    </div>
                    <div style="flex: 1;">
                        <label style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.35rem; display: block;">Centilitros (cl)</label>
                        <input type="number" id="edit-product-cl-input" step="1" min="0" max="1000" value="${item.cl !== undefined ? item.cl : ''}" placeholder="Ej: 33" onkeydown="if(event.key==='Enter') App.confirmSaveEditProduct('${id}')" style="width: 100%; padding: 0.75rem 0.9rem; font-size: 1rem; box-sizing: border-box;">
                    </div>
                </div>

                <div>
                    <label style="font-size: 0.78rem; color: var(--text-muted); margin-bottom: 0.25rem; display: block;">Atajos rápidos de bebida:</label>
                    <div style="display: flex; gap: 0.35rem; flex-wrap: wrap;">
                        <button type="button" class="btn-icon-small" onclick="App.setAlcoholPreset(5, 20, '🍺', true)" style="padding: 0.25rem 0.45rem; font-size: 0.75rem;">🍺 Caña (5% · 20cl)</button>
                        <button type="button" class="btn-icon-small" onclick="App.setAlcoholPreset(5, 33, '🍺', true)" style="padding: 0.25rem 0.45rem; font-size: 0.75rem;">🍺 Tercio (5% · 33cl)</button>
                        <button type="button" class="btn-icon-small" onclick="App.setAlcoholPreset(13, 15, '🍷', true)" style="padding: 0.25rem 0.45rem; font-size: 0.75rem;">🍷 Vino (13% · 15cl)</button>
                        <button type="button" class="btn-icon-small" onclick="App.setAlcoholPreset(40, 5, '🥃', true)" style="padding: 0.25rem 0.45rem; font-size: 0.75rem;">🥃 Chupito (40% · 5cl)</button>
                        <button type="button" class="btn-icon-small" onclick="App.setAlcoholPreset(12, 30, '🍹', true)" style="padding: 0.25rem 0.45rem; font-size: 0.75rem;">🍹 Cubata (12% · 30cl)</button>
                        <button type="button" class="btn-icon-small" onclick="App.setAlcoholPreset(0, 0, '🥤', true)" style="padding: 0.25rem 0.45rem; font-size: 0.75rem;">🥤 Sin alcohol (0%)</button>
                    </div>
                </div>

                <label style="display: flex; align-items: flex-start; gap: 0.65rem; cursor: pointer; user-select: none; padding: 0.75rem; background: rgba(255,255,255,0.05); border: 1px solid var(--glass-border); border-radius: var(--radius-sm); margin-top: 0.25rem;">
                    <input type="checkbox" id="edit-product-escote-chk" ${isEscoteChecked ? 'checked' : ''} style="width: 1.2rem; height: 1.2rem; accent-color: var(--primary); cursor: pointer; margin-top: 0.15rem;">
                    <span style="font-size: 0.88rem; line-height: 1.35;">
                        <strong>💎 Permitir pedir a escote</strong><br>
                        <span style="color: var(--text-muted); font-size: 0.78rem;">Habilita el botón para compartir este producto entre todos en la mesa (raciones, botellas, picoteo...).</span>
                    </span>
                </label>

                <div style="font-size: 0.78rem; color: var(--text-muted); line-height: 1.35; padding: 0.5rem 0.65rem; background: rgba(99, 102, 241, 0.08); border: 1px solid rgba(99, 102, 241, 0.2); border-radius: var(--radius-sm); margin-top: 0.25rem;">
                    💡 Si modificas el precio o el nombre, las consumiciones ya pedidas en las mesas abiertas se recalcularán automáticamente con el nuevo precio.
                </div>

                <button class="btn-primary" onclick="App.confirmSaveEditProduct('${id}')" style="width: 100%; padding: 0.85rem; font-size: 1rem; font-weight: 700; margin-top: 0.5rem;">Guardar Cambios</button>
            </div>
        `;

        this.openModal(html);
        setTimeout(() => document.getElementById('edit-product-name-input')?.focus(), 80);
    },

    setAlcoholPreset(alcohol, cl, emoji, isEdit = false) {
        const prefix = isEdit ? 'edit-product-' : 'product-';
        const alcEl = document.getElementById(`${prefix}alcohol-input`);
        const clEl = document.getElementById(`${prefix}cl-input`);
        const iconEl = document.getElementById(`${prefix}icon-input`);
        if (alcEl) alcEl.value = (alcohol !== null && alcohol !== undefined) ? alcohol : '';
        if (clEl) clEl.value = (cl !== null && cl !== undefined) ? cl : '';
        if (iconEl && emoji) iconEl.value = emoji;
    },

    async confirmSaveEditProduct(id) {
        if (!this.state.tableId) return;

        const nameInput = document.getElementById('edit-product-name-input')?.value.trim();
        if (!nameInput) return alert('Escribe el nombre del producto.');

        const priceInput = document.getElementById('edit-product-price-input')?.value.trim();
        const price = this.parseAmount(priceInput);
        if (isNaN(price) || price < 0) return alert('Precio inválido.');

        const iconInput = document.getElementById('edit-product-icon-input')?.value.trim() || '🍴';
        const allowEscote = document.getElementById('edit-product-escote-chk')?.checked ?? false;

        const alcoholInput = document.getElementById('edit-product-alcohol-input')?.value.trim();
        const alcohol = alcoholInput !== '' && !isNaN(alcoholInput) ? Math.max(0, parseFloat(alcoholInput)) : 0;

        const clInput = document.getElementById('edit-product-cl-input')?.value.trim();
        const cl = clInput !== '' && !isNaN(clInput) ? Math.max(0, parseFloat(clInput)) : 0;

        const oldProduct = this.state.tableData?.menu?.[id] || {};
        const oldName = oldProduct.name || '';
        const oldPrice = Number(oldProduct.price || 0);

        this.closeModal();

        try {
            const existingOrder = oldProduct.order !== undefined ? oldProduct.order : 0;
            const productData = {
                name: nameInput,
                price,
                icon: iconInput,
                allowEscote: Boolean(allowEscote),
                alcohol,
                cl,
                order: existingOrder
            };

            const barName = this.getBarName();
            const updates = {};

            // 1. Menú de la mesa actual
            updates[`tables/${this.state.tableId}/menu/${id}`] = productData;

            // 2. Menú de plantilla del bar
            if (barName) {
                updates[`bar_menus/${barName.replace(/\s/g, '_')}/${id}`] = productData;
            }

            // 3. Recalcular consumiciones en la mesa actual
            const priceChanged = oldPrice !== price;
            const nameChanged = Boolean(oldName && oldName !== nameInput);

            if (this.state.tableData?.orders) {
                for (const [orderId, order] of Object.entries(this.state.tableData.orders)) {
                    const matchById = order.productId && order.productId === id;
                    const matchByName = (order.productName === oldName) || (order.productName === nameInput);

                    if (matchById || matchByName) {
                        if (order.price !== price) {
                            updates[`tables/${this.state.tableId}/orders/${orderId}/price`] = price;
                        }
                        if (nameChanged && order.productName !== nameInput) {
                            updates[`tables/${this.state.tableId}/orders/${orderId}/productName`] = nameInput;
                        }
                        if (!order.productId) {
                            updates[`tables/${this.state.tableId}/orders/${orderId}/productId`] = id;
                        }
                    }
                }
            }

            // 4. Buscar y actualizar otras mesas abiertas si pertenecen al mismo bar o tienen este producto
            try {
                const tablesSnap = await get(ref(this.db, 'tables'));
                if (tablesSnap.exists()) {
                    const allTables = tablesSnap.val();
                    const currentBarKey = barName ? barName.toLowerCase() : '';

                    for (const [tId, tData] of Object.entries(allTables)) {
                        if (tId === this.state.tableId) continue;
                        if (tData.status !== 'active') continue;

                        const tBarName = tData.name ? tData.name.split(' (')[0].trim().toLowerCase() : '';
                        const isSameBar = currentBarKey && tBarName === currentBarKey;
                        const hasProductInMenu = Boolean(tData.menu && tData.menu[id]);

                        if (isSameBar || hasProductInMenu) {
                            updates[`tables/${tId}/menu/${id}`] = productData;

                            if (tData.orders) {
                                for (const [orderId, order] of Object.entries(tData.orders)) {
                                    const matchById = order.productId && order.productId === id;
                                    const matchByName = (order.productName === oldName) || (order.productName === nameInput);

                                    if (matchById || matchByName) {
                                        if (order.price !== price) {
                                            updates[`tables/${tId}/orders/${orderId}/price`] = price;
                                        }
                                        if (nameChanged && order.productName !== nameInput) {
                                            updates[`tables/${tId}/orders/${orderId}/productName`] = nameInput;
                                        }
                                        if (!order.productId) {
                                            updates[`tables/${tId}/orders/${orderId}/productId`] = id;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            } catch (snapErr) {
                console.warn('Error comprobando otras mesas abiertas:', snapErr);
            }

            await update(ref(this.db), updates);

        } catch (error) {
            console.error('Error al modificar el producto:', error);
            alert('Error al modificar el producto.');
        }
    },

    async handleDeleteProduct(id, item) {
        if (!this.state.tableId) return;
        if (!confirm(`¿Seguro que quieres borrar el producto "${item.name}" del menú?`)) return;
        try {
            await set(ref(this.db, `tables/${this.state.tableId}/menu/${id}`), null);
            const barName = this.getBarName();
            if (barName) {
                await set(ref(this.db, `bar_menus/${barName.replace(/\s/g, '_')}/${id}`), null);
            }
        } catch (error) {
            console.error('Error al borrar el producto:', error);
            alert('Error al borrar el producto.');
        }
    },

    async addOrder(product, targetUsers) {
        const users = Array.isArray(targetUsers) ? targetUsers : [targetUsers];
        for (const targetUser of users) {
            const orderRef = push(ref(this.db, `tables/${this.state.tableId}/orders`));
            const orderData = {
                user: targetUser,
                orderedBy: this.state.user,
                productName: product.name,
                price: product.price,
                timestamp: Date.now()
            };
            if (product.id) {
                orderData.productId = product.id;
            }
            if (product.alcohol !== undefined && product.alcohol !== null) {
                orderData.alcohol = Number(product.alcohol) || 0;
            }
            if (product.cl !== undefined && product.cl !== null) {
                orderData.cl = Number(product.cl) || 0;
            }
            await set(orderRef, orderData);
        }
        this.closeModal();
    },

    async handleSharedOrder(product) {
        const qtyStr = prompt(`¿Cuántas unidades de ${product.name} a escote?`, '1');
        if (!qtyStr) return;
        const qty = parseInt(qtyStr);
        if (isNaN(qty) || qty <= 0) return;

        this.state.currentOrderProduct = null;
        this.state.tempSelection = [];

        for (let i = 0; i < qty; i++) {
            await this.addOrder(product, 'SHARED');
        }
    },

    // Obtiene los participantes actuales que comparten un pedido a escote
    getOrderBeneficiaries(o) {
        if (!o || o.user !== 'SHARED') return [];
        if (Array.isArray(o.beneficiaries) && o.beneficiaries.length > 0) {
            return [...o.beneficiaries];
        }
        const data = this.state.tableData || {};
        const participants = Object.values(data.participants || {});
        const tableStart = Number(data.createdAt || 0);
        const orderTime = Number(o.timestamp || tableStart);
        const present = participants.filter(p => Number(p.joinedAt || tableStart) <= orderTime);
        const list = (present.length > 0 ? present : participants).map(p => p.name);
        return list.length > 0 ? list : participants.map(p => p.name);
    },

    // Obtiene todos los candidatos posibles en la mesa para compartir un escote
    getAllSharedOrderCandidates(o) {
        const participants = Object.values(this.state.tableData?.participants || {});
        const tableStart = Number(this.state.tableData?.createdAt || 0);
        const orderTime = Number(o?.timestamp || tableStart);
        const presentNames = participants
            .filter(p => Number(p.joinedAt || tableStart) <= orderTime)
            .map(p => p.name);
        const existingBeneficiaries = Array.isArray(o?.beneficiaries) ? o.beneficiaries : [];
        const allCandidatesSet = new Set([...presentNames, ...existingBeneficiaries]);
        if (allCandidatesSet.size === 0) {
            participants.forEach(p => allCandidatesSet.add(p.name));
        }
        return Array.from(allCandidatesSet);
    },

    async handleDeleteOrder(orderId, currentContextUser = null) {
        const order = this.state.tableData?.orders?.[orderId];
        if (!order) return;

        // Si es pedido individual
        if (order.user !== 'SHARED') {
            if (!confirm(`¿Seguro que quieres borrar ${order.productName} (${this.formatEuro(order.price)}) de ${order.user}?`)) return;
            try {
                const orderRef = ref(this.db, `tables/${this.state.tableId}/orders/${orderId}`);
                await set(orderRef, null);
                this.closeModal();
            } catch (error) {
                console.error('Error al borrar pedido:', error);
            }
            return;
        }

        // Si es pedido a escote: preguntar si borrar para todos o para algunos en concreto
        const beneficiaries = this.getOrderBeneficiaries(order);
        this.showDeleteSharedOrderModal(orderId, order, beneficiaries, currentContextUser);
    },

    showDeleteSharedOrderModal(orderId, order, beneficiaries, currentContextUser = null) {
        const price = Number(order.price || 0);
        const count = beneficiaries.length;
        const perPerson = count > 0 ? price / count : price;

        let html = `
            <div style="text-align: left;">
                <h3 style="margin-bottom: 0.35rem; display: flex; align-items: center; gap: 0.5rem;">
                    <span>🗑️ Borrar pedido a escote</span>
                </h3>
                <div style="background: rgba(255, 255, 255, 0.04); border: 1px solid var(--glass-border); border-radius: var(--radius-sm); padding: 0.75rem 0.9rem; margin-bottom: 1rem;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.25rem;">
                        <b style="font-size: 1.05rem; color: var(--text-main);">${order.productName}</b>
                        <b style="font-size: 1.05rem; color: var(--primary);">${this.formatEuro(price)}</b>
                    </div>
                    <div style="font-size: 0.8rem; color: var(--text-muted);">
                        Actualmente entre <b>${count} persona${count !== 1 ? 's' : ''}</b> (${this.formatEuro(perPerson)} cada una)
                    </div>
                </div>

                <p style="font-size: 0.92rem; color: var(--text-main); margin-bottom: 1.15rem;">
                    ¿Quieres borrar este artículo para <b>todos</b> o solo para <b>algunos en concreto</b>?
                </p>

                <div style="display: flex; flex-direction: column; gap: 0.65rem;">
        `;

        // Opción rápida si se abrió desde el detalle de un participante
        if (currentContextUser && beneficiaries.includes(currentContextUser)) {
            const safeUser = currentContextUser.replace(/'/g, "\\'").replace(/"/g, '&quot;');
            const newCount = count - 1;
            const newPerPerson = newCount > 0 ? price / newCount : price;
            html += `
                <button class="btn-primary" onclick="App.removeSingleUserFromSharedOrder('${orderId}', '${safeUser}')" style="width: 100%; padding: 0.85rem; font-size: 0.95rem; text-align: left; display: flex; justify-content: space-between; align-items: center; background: rgba(99, 102, 241, 0.2); border: 1px solid var(--primary); color: #ffffff;">
                    <span>👤 Borrar solo para <b>${currentContextUser}</b></span>
                    <small style="font-size: 0.78rem; opacity: 0.9;">${newCount > 0 ? `resto: ${this.formatEuro(newPerPerson)}/p` : 'elimina'}</small>
                </button>
            `;
        }

        html += `
                    <button class="btn-secondary" onclick="App.showSharedOrderCustomSplitModal('${orderId}')" style="width: 100%; padding: 0.85rem; font-size: 0.95rem; text-align: left; display: flex; align-items: center; justify-content: space-between;">
                        <span>👥 Borrar para algunos en concreto...</span>
                        <span style="font-size: 0.85rem; color: var(--text-muted);">Elegir quiénes ➔</span>
                    </button>

                    <button class="btn-danger" onclick="App.confirmDeleteSharedOrderForEveryone('${orderId}')" style="width: 100%; padding: 0.85rem; font-size: 0.95rem; text-align: left; background: rgba(239, 68, 68, 0.15); border-color: rgba(239, 68, 68, 0.4); color: #f87171;">
                        ❌ Borrar para todos (eliminar pedido por completo)
                    </button>

                    <button class="btn-secondary" onclick="App.closeModal()" style="width: 100%; padding: 0.6rem; font-size: 0.88rem; margin-top: 0.25rem;">
                        Cancelar
                    </button>
                </div>
            </div>
        `;

        this.openModal(html);
    },

    async confirmDeleteSharedOrderForEveryone(orderId) {
        const order = this.state.tableData?.orders?.[orderId];
        const name = order?.productName || 'este pedido';
        if (!confirm(`¿Seguro que quieres borrar ${name} para todos? El pedido desaparecerá de la mesa.`)) return;

        try {
            const orderRef = ref(this.db, `tables/${this.state.tableId}/orders/${orderId}`);
            await set(orderRef, null);
            this.closeModal();
        } catch (error) {
            console.error('Error al borrar pedido para todos:', error);
        }
    },

    async removeSingleUserFromSharedOrder(orderId, userName) {
        const order = this.state.tableData?.orders?.[orderId];
        if (!order) return;
        const currentBeneficiaries = this.getOrderBeneficiaries(order);
        const remaining = currentBeneficiaries.filter(n => n !== userName);
        const orderRef = ref(this.db, `tables/${this.state.tableId}/orders/${orderId}`);

        if (remaining.length === 0) {
            if (!confirm(`Al borrar a ${userName}, no queda nadie en el escote. Se eliminará el pedido (${order.productName}) por completo de la mesa. ¿Continuar?`)) return;
        } else {
            if (!confirm(`¿Seguro que quieres borrar a ${userName} de este pedido a escote (${order.productName})?`)) return;
        }

        try {
            if (remaining.length === 0) {
                await set(orderRef, null);
            } else {
                await update(orderRef, { beneficiaries: remaining });
            }
            this.closeModal();
        } catch (error) {
            console.error('Error al quitar usuario del escote:', error);
        }
    },

    showSharedOrderCustomSplitModal(orderId) {
        const order = this.state.tableData?.orders?.[orderId];
        if (!order) return;

        const candidates = this.getAllSharedOrderCandidates(order);
        const currentBeneficiaries = this.getOrderBeneficiaries(order);
        this.state.tempSharedOrderBeneficiaries = [...currentBeneficiaries];

        const price = Number(order.price || 0);
        const isAllSelected = candidates.length > 0 && candidates.every(c => this.state.tempSharedOrderBeneficiaries.includes(c));

        const generateButtons = () => {
            return candidates.map(name => {
                const isSelected = this.state.tempSharedOrderBeneficiaries.includes(name);
                const safeName = name.replace(/'/g, "\\'").replace(/"/g, '&quot;');
                const idName = name.replace(/\s/g, '_').replace(/\./g, '_');
                const sizeClass = this.getNameLengthClass(name);
                return `
                    <button type="button" id="split-btn-${idName}" 
                        class="participant-btn ${sizeClass} ${isSelected ? 'selected' : ''}" 
                        onclick="App.toggleSharedOrderBeneficiary('${safeName}', '${orderId}')" 
                        style="padding: 0.65rem 0.35rem; border-radius: var(--radius-sm); transform: none !important;">
                        ${name}
                    </button>
                `;
            }).join('');
        };

        const html = `
            <div style="text-align: left; display: flex; flex-direction: column; gap: 0.85rem;">
                <h3 style="margin-bottom: 0;">👥 Repartir escote: ${order.productName}</h3>
                <div style="background: rgba(255, 255, 255, 0.04); border: 1px solid var(--glass-border); border-radius: var(--radius-sm); padding: 0.65rem 0.85rem; display: flex; justify-content: space-between; align-items: center;">
                    <span style="color: var(--text-muted); font-size: 0.88rem;">Importe total del artículo:</span>
                    <b style="font-size: 1.15rem; color: var(--primary);">${this.formatEuro(price)}</b>
                </div>

                <div>
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                        <label style="font-size: 0.85rem; color: var(--text-muted); margin: 0;">¿Quiénes pagan este artículo?</label>
                        <div class="selector-switch-group">
                            <button type="button" id="switch-shared-all" class="selector-switch-btn ${isAllSelected ? 'active' : ''}" onclick="App.toggleAllSharedOrderBeneficiaries(true, '${orderId}')">Todos</button>
                            <button type="button" id="switch-shared-none" class="selector-switch-btn ${this.state.tempSharedOrderBeneficiaries.length === 0 ? 'active' : ''}" onclick="App.toggleAllSharedOrderBeneficiaries(false, '${orderId}')">Ninguno</button>
                        </div>
                    </div>
                    <div id="shared-split-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.65rem; max-height: 38vh; overflow-y: auto; overflow-x: hidden; padding: 0.2rem; box-sizing: border-box;">
                        ${generateButtons()}
                    </div>
                </div>

                <div id="shared-split-summary-box" style="background: rgba(99, 102, 241, 0.12); border: 1px solid rgba(99, 102, 241, 0.3); border-radius: var(--radius-sm); padding: 0.75rem; text-align: center;">
                    <span id="shared-split-count" style="font-size: 0.82rem; color: var(--text-muted); display: block; margin-bottom: 0.2rem;">Calculando...</span>
                    <div id="shared-split-amount" style="font-size: 1.35rem; font-weight: 700; color: var(--primary);">0,00€</div>
                </div>

                <div style="display: flex; flex-direction: column; gap: 0.5rem; margin-top: 0.25rem;">
                    <button id="btn-save-shared-split" class="btn-primary" onclick="App.confirmSaveSharedOrderSplit('${orderId}')" style="width: 100%; padding: 0.95rem; font-size: 1.05rem; font-weight: 700;">
                        Guardar reparto
                    </button>
                    <button class="btn-secondary" onclick="App.closeModal()" style="width: 100%; padding: 0.65rem; font-size: 0.9rem;">
                        Cancelar
                    </button>
                </div>
            </div>
        `;

        this.openModal(html);
        this.updateSharedOrderCustomSplitUIState(orderId);
    },

    toggleSharedOrderBeneficiary(name, orderId) {
        if (!this.state.tempSharedOrderBeneficiaries) return;
        const idx = this.state.tempSharedOrderBeneficiaries.indexOf(name);
        if (idx > -1) {
            this.state.tempSharedOrderBeneficiaries.splice(idx, 1);
        } else {
            this.state.tempSharedOrderBeneficiaries.push(name);
        }
        this.updateSharedOrderCustomSplitUIState(orderId);
    },

    toggleAllSharedOrderBeneficiaries(selectAll, orderId) {
        const order = this.state.tableData?.orders?.[orderId];
        if (!order) return;
        const allCandidates = this.getAllSharedOrderCandidates(order);
        this.state.tempSharedOrderBeneficiaries = selectAll ? [...allCandidates] : [];
        this.updateSharedOrderCustomSplitUIState(orderId);
    },

    updateSharedOrderCustomSplitUIState(orderId) {
        const order = this.state.tableData?.orders?.[orderId];
        if (!order) return;
        const candidates = this.getAllSharedOrderCandidates(order);
        const selected = this.state.tempSharedOrderBeneficiaries || [];
        const count = selected.length;
        const price = Number(order.price || 0);

        candidates.forEach(name => {
            const idName = name.replace(/\s/g, '_').replace(/\./g, '_');
            const btn = document.getElementById(`split-btn-${idName}`);
            if (btn) {
                btn.classList.toggle('selected', selected.includes(name));
            }
        });

        const switchAll = document.getElementById('switch-shared-all');
        const switchNone = document.getElementById('switch-shared-none');
        if (switchAll) switchAll.classList.toggle('active', count === candidates.length && candidates.length > 0);
        if (switchNone) switchNone.classList.toggle('active', count === 0);

        const countEl = document.getElementById('shared-split-count');
        const amountEl = document.getElementById('shared-split-amount');
        const saveBtn = document.getElementById('btn-save-shared-split');

        if (count === 0) {
            if (countEl) countEl.textContent = 'Nadie seleccionado';
            if (amountEl) {
                amountEl.textContent = 'Se borrará el pedido';
                amountEl.style.color = 'var(--danger)';
            }
            if (saveBtn) {
                saveBtn.textContent = '❌ Borrar pedido completo';
                saveBtn.style.background = 'var(--danger)';
            }
        } else if (count === 1) {
            if (countEl) countEl.textContent = `Lo pagará solo 1 persona (${selected[0]})`;
            if (amountEl) {
                amountEl.textContent = this.formatEuro(price);
                amountEl.style.color = 'var(--primary)';
            }
            if (saveBtn) {
                saveBtn.textContent = `💾 Guardar (paga ${selected[0]} íntegro)`;
                saveBtn.style.background = '';
            }
        } else {
            const perPerson = price / count;
            if (countEl) countEl.textContent = `Repartido entre ${count} personas`;
            if (amountEl) {
                amountEl.textContent = `${this.formatEuro(perPerson)} cada una`;
                amountEl.style.color = 'var(--primary)';
            }
            if (saveBtn) {
                saveBtn.textContent = `💾 Guardar reparto (${this.formatEuro(perPerson)}/p)`;
                saveBtn.style.background = '';
            }
        }
    },

    async confirmSaveSharedOrderSplit(orderId) {
        const selected = this.state.tempSharedOrderBeneficiaries || [];
        const orderRef = ref(this.db, `tables/${this.state.tableId}/orders/${orderId}`);

        if (selected.length === 0) {
            if (!confirm('Al no seleccionar a nadie, el pedido se eliminará de la mesa. ¿Continuar?')) return;
            try {
                await set(orderRef, null);
                this.closeModal();
            } catch (error) {
                console.error('Error al borrar pedido:', error);
            }
            return;
        }

        const order = this.state.tableData?.orders?.[orderId];
        const currentBeneficiaries = order ? this.getOrderBeneficiaries(order) : [];
        const removedUsers = currentBeneficiaries.filter(u => !selected.includes(u));
        if (removedUsers.length > 0) {
            const removedText = removedUsers.length === 1 ? `a "${removedUsers[0]}"` : `a ${removedUsers.join(', ')}`;
            if (!confirm(`¿Seguro que quieres quitar ${removedText} de este reparto a escote?`)) return;
        }

        try {
            await update(orderRef, { beneficiaries: selected });
            this.closeModal();
        } catch (error) {
            console.error('Error al guardar reparto de escote:', error);
        }
    },

    listenToTable(tableId) {
        const tableRef = ref(this.db, `tables/${tableId}`);
        onValue(tableRef, (snapshot) => {
            const data = snapshot.val();
            if (data) {
                if (data.status === 'closed' && this.state.tableId) {
                    this.state.tableId = null; // evitar re-trigger
                    localStorage.removeItem('thermo_tableId');
                    this.showBorrachuzoModal(data); // confeti + borrachuzos (recarga dentro)
                    return;
                }
                this.state.tableData = data;

                // Auto-cerrar si todos se han ido
                const participants = Object.values(data.participants || {});
                const everyoneLeft = participants.length > 0 && participants.every(p => p.status === 'left');
                if (everyoneLeft && data.status === 'active') {
                    set(ref(this.db, `tables/${this.state.tableId}/status`), 'closed');
                    return;
                }

                this.updateSummaryUI();
                this.updateMenuUI();
                this.updateOrdersUI();
                if (this.state.currentView === 'settle') {
                    this.updateChangeAssistantUI();
                }
                if (this.state.isAuditModalOpen) {
                    this.renderTicketAuditModal();
                }
            }
        });
    },

    updateSummaryUI() {
        const data = this.state.tableData;
        if (!data) return;
        this.display.tableName.textContent = data.name;
        this.display.tableCode.textContent = `Código: ${this.state.tableId}`;
        
        const totals = this.calculateAllIndividualTotals();
        this.display.participants.innerHTML = '';
        if (data.participants) {
            const participants = Object.values(data.participants);
            const processedKeys = new Set();

            participants.forEach(p => {
                const pKey = this.normalizeKey(p.name);
                if (processedKeys.has(pKey)) return;

                // Usar getPartner (ignora status) para encontrar pareja aunque se haya ido
                const partnerName = this.getPartner(p.name);
                const partnerObj = partnerName ? participants.find(x => this.normalizeKey(x.name) === this.normalizeKey(partnerName)) : null;

                if (partnerObj && partnerObj.status !== 'left' && p.status !== 'left') {
                    // Ambos activos → fila de pareja combinada
                    processedKeys.add(pKey);
                    processedKeys.add(this.normalizeKey(partnerName));

                    const ind1 = totals[p.name] || 0;
                    const ind2 = totals[partnerName] || 0;
                    const combinedAmount = ind1 + ind2;

                    const div = document.createElement('div');
                    div.className = `participant-item glass is-couple`;
                    div.style.cursor = 'pointer';
                    div.innerHTML = `
                        <div class="p-info" style="display: flex; flex-direction: column; align-items: flex-start; gap: 0.25rem;">
                            <span class="p-name">${p.name} y ${partnerName} <span class="badge-couple">💑 Pareja</span></span>
                            <div style="font-size: 0.78rem; color: var(--text-muted); line-height: 1.35;">
                                <div>${p.name}: ${this.formatEuro(ind1)}</div>
                                <div>${partnerName}: ${this.formatEuro(ind2)}</div>
                            </div>
                        </div>
                        <span class="p-amount">${this.formatEuro(combinedAmount)}</span>
                    `;
                    div.onclick = () => this.showCoupleDetail(p.name, partnerName);
                    this.display.participants.appendChild(div);

                } else if (partnerObj && p.status !== 'left' && partnerObj.status === 'left') {
                    // p activo, pareja se fue → absorber deuda del que se fue
                    processedKeys.add(pKey);
                    processedKeys.add(this.normalizeKey(partnerName));

                    const myAmount = totals[p.name] || 0;
                    const partnerAmount = totals[partnerName] || 0;
                    const combinedAmount = myAmount + partnerAmount;

                    const div = document.createElement('div');
                    div.className = `participant-item glass is-couple`;
                    div.style.cursor = 'pointer';
                    div.innerHTML = `
                        <div class="p-info" style="display: flex; flex-direction: column; align-items: flex-start; gap: 0.25rem;">
                            <span class="p-name">${p.name} <span class="badge-couple">💑 Pareja</span></span>
                            <div style="font-size: 0.78rem; color: var(--text-muted); line-height: 1.35;">
                                <div>${p.name}: ${this.formatEuro(myAmount)}</div>
                                <div>${partnerName} <small style="color:#f87171;">(fuera)</small>: ${this.formatEuro(partnerAmount)}</div>
                            </div>
                        </div>
                        <span class="p-amount">${this.formatEuro(combinedAmount)}</span>
                    `;
                    div.onclick = () => this.showCoupleDetail(p.name, partnerName);
                    this.display.participants.appendChild(div);

                } else if (partnerObj && p.status === 'left' && partnerObj.status !== 'left') {
                    // p se fue, la pareja sigue activa → se procesará cuando le toque al activo
                    processedKeys.add(pKey);

                } else {
                    // Individual (sin pareja en la mesa, o ambos fuera)
                    processedKeys.add(pKey);
                    const amount = totals[p.name] || 0;
                    const isLeft = p.status === 'left';
                    const div = document.createElement('div');
                    div.className = `participant-item glass ${isLeft ? 'is-left' : ''}`;
                    div.style.cursor = 'pointer';
                    div.innerHTML = `
                        <div class="p-info">
                            <span class="p-name">${p.name} ${isLeft ? '<small>(Fuera)</small>' : ''}</span>
                            <span class="p-role">${p.role === 'admin' ? '🚩' : (isLeft ? '🏁' : '👤')}</span>
                        </div>
                        <span class="p-amount">${this.formatEuro(amount)}</span>
                    `;
                    div.onclick = () => this.showParticipantDetail(p.name);
                    this.display.participants.appendChild(div);
                }
            });
        }
    },

    showCoupleDetail(name1, name2) {
        const data = this.state.tableData;
        if (!data) return;
        
        const getPersonDetail = (name) => {
            const participants = Object.values(data.participants || {});
            const pInfo = participants.find(p => p.name === name);
            const tableStart = Number(data.createdAt || 0);
            const myJoinTime = Number(pInfo?.joinedAt || tableStart);
            let ordersHtml = '';
            let total = 0;
            let count = 0;

            Object.entries(data.orders || {}).forEach(([id, o]) => {
                let price = 0;
                let label = '';
                const orderTime = Number(o.timestamp || tableStart);

                if (o.user === 'SHARED') {
                    const targets = this.getOrderBeneficiaries(o);
                    if (targets.includes(name)) {
                        price = Number(o.price) / (targets.length || 1);
                        label = `(Escote) ${o.productName}`;
                    }
                } else if (o.user === name) {
                    price = Number(o.price);
                    label = o.productName;
                }

                if (price > 0) {
                    count++;
                    total += price;
                    const orderHour = o.timestamp ? new Date(o.timestamp).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : '';
                    const orderedByStr = o.orderedBy ? `por ${o.orderedBy}` : '';
                    const timeStr = orderHour ? ` a las ${orderHour}` : '';
                    const metaInfo = (orderedByStr || timeStr) ? `<div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.15rem; width: 100%; text-align: left;">Pedida ${orderedByStr}${timeStr}</div>` : '';

                    ordersHtml += `
                        <div class="order-row" style="flex-direction: column; align-items: flex-start; padding: 0.5rem 0;">
                            <div style="display: flex; justify-content: space-between; width: 100%; align-items: center;">
                                <span>${label}</span>
                                <div class="order-actions" style="display: flex; align-items: center; gap: 0.5rem;">
                                    <span style="font-weight: 600;">${this.formatEuro(price)}</span>
                                    <button class="btn-delete-small" onclick="App.handleDeleteOrder('${id}', '${name.replace(/'/g, "\\'")}')" title="Borrar pedido">🗑️</button>
                                </div>
                            </div>
                            ${metaInfo}
                        </div>
                    `;
                }
            });
            return { ordersHtml: ordersHtml || '<p style="color:var(--text-muted); font-size: 0.85rem; padding: 0.4rem 0;">Sin pedidos individuales.</p>', total, count };
        };

        const d1 = getPersonDetail(name1);
        const d2 = getPersonDetail(name2);
        const totalCouple = d1.total + d2.total;
        const safeName1 = name1.replace(/'/g, "\\'");
        const safeName2 = name2.replace(/'/g, "\\'");

            const participants = Object.values(data.participants || {});
            const p1Info = participants.find(p => p.name === name1);
            const p2Info = participants.find(p => p.name === name2);
            const p1Active = p1Info?.status !== 'left';
            const p2Active = p2Info?.status !== 'left';

            const html = `
            <h3>Consumo de Pareja: ${name1} y ${name2} 💑</h3>
            <div style="margin: 1rem 0; padding: 0.75rem; background: rgba(236,72,153,0.1); border-radius: var(--radius-sm); border: 1px solid rgba(236,72,153,0.25); text-align: center;">
                <span style="font-size: 0.85rem; color: var(--text-muted);">Total Acumulado Pareja:</span>
                <div style="font-size: 1.6rem; font-weight: 700; color: #f472b6;">${this.formatEuro(totalCouple)}</div>
            </div>
            
            <div style="max-height: 45vh; overflow-y: auto; text-align: left;">
                <h4 style="color: var(--primary); margin-top: 0.8rem; margin-bottom: 0.4rem; font-size: 0.95rem;">Consumos de ${name1} (${this.formatEuro(d1.total)})${!p1Active ? ' <small style="color:#f87171;">(Fuera)</small>' : ''}:</h4>
                <div>${d1.ordersHtml}</div>
                
                <h4 style="color: var(--primary); margin-top: 1rem; margin-bottom: 0.4rem; font-size: 0.95rem;">Consumos de ${name2} (${this.formatEuro(d2.total)})${!p2Active ? ' <small style="color:#f87171;">(Fuera)</small>' : ''}:</h4>
                <div>${d2.ordersHtml}</div>
            </div>

            <div style="margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid var(--glass-border); display: flex; flex-direction: column; gap: 0.6rem;">
                <div style="font-size: 0.85rem; color: var(--text-muted); text-align: center; margin-bottom: 0.2rem;">
                    Gestionar asistencia a la mesa:
                </div>
                <div style="display: flex; flex-direction: column; gap: 0.6rem;">
                    ${p1Active ? `
                        <button type="button" class="btn-leave-home" onclick="App.kickParticipant('${safeName1}')">
                            🚪 ${name1} se va a casa
                        </button>
                    ` : `
                        <div style="padding: 0.75rem 0.5rem; font-size: 0.88rem; text-align: center; color: var(--text-muted); background: rgba(255,255,255,0.03); border-radius: var(--radius-sm);">
                            ${name1} ya se fue a casa
                        </div>
                    `}
                    ${p2Active ? `
                        <button type="button" class="btn-leave-home" onclick="App.kickParticipant('${safeName2}')">
                            🚪 ${name2} se va a casa
                        </button>
                    ` : `
                        <div style="padding: 0.75rem 0.5rem; font-size: 0.88rem; text-align: center; color: var(--text-muted); background: rgba(255,255,255,0.03); border-radius: var(--radius-sm);">
                            ${name2} ya se fue a casa
                        </div>
                    `}
                    ${(p1Active && p2Active) ? `
                        <button type="button" class="btn-leave-home primary-danger" onclick="App.kickCouple('${safeName1}', '${safeName2}')">
                            🚪🚪 Se van ambos a casa
                        </button>
                    ` : ''}
                </div>
                <button onclick="App.closeModal()" class="btn-secondary" style="margin-top: 0.3rem; width: 100%;">
                    Cerrar
                </button>
            </div>
        `;
        this.openModal(html);
    },

    getOrderedMenuItems() {
        const menu = this.state.tableData?.menu;
        if (!menu) return [];

        const entries = Object.entries(menu);
        const menuOrder = this.state.tableData?.menuOrder;

        if (Array.isArray(menuOrder) && menuOrder.length > 0) {
            return entries.sort((a, b) => {
                const idxA = menuOrder.indexOf(a[0]);
                const idxB = menuOrder.indexOf(b[0]);
                const valA = idxA !== -1 ? idxA : (a[1].order !== undefined ? a[1].order : 9999);
                const valB = idxB !== -1 ? idxB : (b[1].order !== undefined ? b[1].order : 9999);
                if (valA !== valB) return valA - valB;
                return (a[1].name || '').localeCompare(b[1].name || '');
            });
        }

        const hasOrderProp = entries.some(([, item]) => item.order !== undefined);
        if (hasOrderProp) {
            return entries.sort((a, b) => {
                const valA = a[1].order !== undefined ? a[1].order : 9999;
                const valB = b[1].order !== undefined ? b[1].order : 9999;
                if (valA !== valB) return valA - valB;
                return (a[1].name || '').localeCompare(b[1].name || '');
            });
        }

        return entries;
    },

    updateMenuUI() {
        const orderedEntries = this.getOrderedMenuItems();
        this.display.menu.innerHTML = '';
        if (orderedEntries.length === 0) {
            this.display.menu.innerHTML = '<p class="empty-msg">Pulsa "Nuevo" para añadir productos.</p>';
            return;
        }

        orderedEntries.forEach(([id, item]) => {
            const alcoholBadge = (item.alcohol > 0 || item.cl > 0)
                ? `<span class="badge-escote" style="background: rgba(245, 158, 11, 0.15); color: #d97706; border: 1px solid rgba(245, 158, 11, 0.3); font-size: 0.72rem; padding: 0.15rem 0.4rem; border-radius: 4px; margin-top: 0.15rem;">🍺 ${item.alcohol > 0 ? item.alcohol + '%' : ''}${item.alcohol > 0 && item.cl > 0 ? ' · ' : ''}${item.cl > 0 ? item.cl + 'cl' : ''}</span>`
                : '';
            const div = document.createElement('div');
            div.className = 'menu-item glass';
            div.setAttribute('data-id', id);
            div.setAttribute('draggable', 'true');
            div.innerHTML = `
                <button class="btn-edit-small" data-id="${id}">✏️</button>
                <button class="btn-delete-menu-small" data-id="${id}">🗑️</button>
                <span class="item-icon">${item.icon || '🍴'}</span>
                <span class="item-name">${item.name}</span>
                <span class="item-price">${this.formatEuro(item.price)}</span>
                ${item.allowEscote ? '<span class="badge-escote">💎 A Escote</span>' : ''}
                ${alcoholBadge}
            `;
            div.onclick = (e) => {
                if (e.target.classList.contains('btn-edit-small') || e.target.classList.contains('btn-delete-menu-small')) return;
                this.showParticipantSelector({ ...item, id });
            };
            div.querySelector('.btn-edit-small').onclick = (e) => {
                e.stopPropagation();
                this.handleEditProduct(id, item);
            };
            div.querySelector('.btn-delete-menu-small').onclick = (e) => {
                e.stopPropagation();
                this.handleDeleteProduct(id, item);
            };

            // Drag and drop en escritorio
            div.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('text/plain', id);
                div.classList.add('dragging');
            });
            div.addEventListener('dragend', () => {
                div.classList.remove('dragging');
            });
            div.addEventListener('dragover', (e) => {
                e.preventDefault();
                div.classList.add('drag-over');
            });
            div.addEventListener('dragleave', () => {
                div.classList.remove('drag-over');
            });
            div.addEventListener('drop', (e) => {
                e.preventDefault();
                div.classList.remove('drag-over');
                const draggedId = e.dataTransfer.getData('text/plain');
                if (draggedId && draggedId !== id) {
                    this.reorderMenuCardDrop(draggedId, id);
                }
            });

            this.display.menu.appendChild(div);
        });
    },

    async reorderMenuCardDrop(draggedId, targetId) {
        const orderedEntries = this.getOrderedMenuItems();
        const currentIds = orderedEntries.map(([id]) => id);
        const fromIndex = currentIds.indexOf(draggedId);
        const toIndex = currentIds.indexOf(targetId);
        if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return;

        currentIds.splice(fromIndex, 1);
        currentIds.splice(toIndex, 0, draggedId);

        await this.saveMenuOrder(currentIds);
    },

    handleOpenReorderMenuModal() {
        if (!this.state.tableId) return;
        const orderedEntries = this.getOrderedMenuItems();
        if (orderedEntries.length <= 1) {
            return alert('Necesitas al menos 2 productos para reordenar.');
        }

        this.state.tempMenuOrder = orderedEntries.map(([id, item]) => ({ id, ...item }));
        this.renderReorderMenuModal();
    },

    renderReorderMenuModal() {
        const items = this.state.tempMenuOrder || [];

        let listHtml = '';
        items.forEach((item, index) => {
            const isFirst = index === 0;
            const isLast = index === items.length - 1;

            listHtml += `
                <div class="reorder-item-row" data-index="${index}" style="display: flex; align-items: center; justify-content: space-between; gap: 0.6rem; padding: 0.65rem 0.8rem; background: rgba(255, 255, 255, 0.05); border: 1px solid var(--glass-border); border-radius: var(--radius-sm); margin-bottom: 0.45rem; user-select: none;">
                    <div style="display: flex; align-items: center; gap: 0.6rem; flex: 1; overflow: hidden;">
                        <span style="font-size: 0.82rem; font-weight: 700; color: var(--text-muted); width: 1.3rem; text-align: center;">${index + 1}</span>
                        <span style="font-size: 1.4rem;">${item.icon || '🍴'}</span>
                        <div style="display: flex; flex-direction: column; overflow: hidden; text-align: left;">
                            <span style="font-weight: 600; font-size: 0.95rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--text-main, #ffffff);">${item.name}</span>
                            <span style="font-size: 0.78rem; color: var(--text-muted);">${this.formatEuro(item.price)}</span>
                        </div>
                    </div>
                    <div style="display: flex; gap: 0.35rem; align-items: center;">
                        <button type="button" class="btn-icon-small" onclick="App.moveReorderItem(${index}, -1)" ${isFirst ? 'disabled style="opacity: 0.25; cursor: default; padding: 0.4rem 0.6rem;"' : 'style="padding: 0.4rem 0.6rem; font-size: 0.95rem; font-weight: bold;"'} title="Subir">▲</button>
                        <button type="button" class="btn-icon-small" onclick="App.moveReorderItem(${index}, 1)" ${isLast ? 'disabled style="opacity: 0.25; cursor: default; padding: 0.4rem 0.6rem;"' : 'style="padding: 0.4rem 0.6rem; font-size: 0.95rem; font-weight: bold;"'} title="Bajar">▼</button>
                    </div>
                </div>
            `;
        });

        const html = `
            <div style="text-align: left;">
                <h3 style="margin-bottom: 0.2rem;">⇅ Ordenar Tarjetas</h3>
                <p style="font-size: 0.82rem; color: var(--text-muted); margin-bottom: 0.75rem;">
                    Usa las flechas ▲ ▼ para mover los artículos al orden que desees.
                </p>

                <div style="display: flex; gap: 0.35rem; margin-bottom: 0.75rem; flex-wrap: wrap;">
                    <span style="font-size: 0.75rem; color: var(--text-muted); align-self: center; margin-right: 0.2rem;">Atajos:</span>
                    <button type="button" class="btn-icon-small" onclick="App.sortReorderTemp('az')" style="padding: 0.25rem 0.5rem; font-size: 0.75rem;">🔤 A - Z</button>
                    <button type="button" class="btn-icon-small" onclick="App.sortReorderTemp('price-asc')" style="padding: 0.25rem 0.5rem; font-size: 0.75rem;">💶 Precio: Menor a Mayor</button>
                    <button type="button" class="btn-icon-small" onclick="App.sortReorderTemp('price-desc')" style="padding: 0.25rem 0.5rem; font-size: 0.75rem;">💶 Precio: Mayor a Menor</button>
                </div>

                <div id="reorder-list-container" style="max-height: 50vh; overflow-y: auto; padding-right: 0.2rem;">
                    ${listHtml}
                </div>

                <div style="display: flex; gap: 0.6rem; margin-top: 1rem;">
                    <button type="button" class="btn-primary" onclick="App.confirmSaveMenuOrder()" style="flex: 1; padding: 0.8rem; font-weight: 700; font-size: 0.95rem;">
                        Guardar Orden
                    </button>
                    <button type="button" class="btn-secondary" onclick="App.closeModal()" style="padding: 0.8rem 1rem;">
                        Cancelar
                    </button>
                </div>
            </div>
        `;

        this.openModal(html);
    },

    moveReorderItem(index, direction) {
        const items = this.state.tempMenuOrder;
        if (!items) return;
        const targetIndex = index + direction;
        if (targetIndex < 0 || targetIndex >= items.length) return;

        const temp = items[index];
        items[index] = items[targetIndex];
        items[targetIndex] = temp;

        this.renderReorderMenuModal();
    },

    sortReorderTemp(type) {
        const items = this.state.tempMenuOrder;
        if (!items) return;

        if (type === 'az') {
            items.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        } else if (type === 'price-asc') {
            items.sort((a, b) => Number(a.price || 0) - Number(b.price || 0));
        } else if (type === 'price-desc') {
            items.sort((a, b) => Number(b.price || 0) - Number(a.price || 0));
        }

        this.renderReorderMenuModal();
    },

    async confirmSaveMenuOrder() {
        if (!this.state.tableId || !this.state.tempMenuOrder) return;
        const newOrderIds = this.state.tempMenuOrder.map(item => item.id);
        this.closeModal();
        await this.saveMenuOrder(newOrderIds);
    },

    async saveMenuOrder(newOrderIds) {
        if (!this.state.tableId || !newOrderIds || newOrderIds.length === 0) return;

        try {
            const barName = this.getBarName();
            const updates = {};

            updates[`tables/${this.state.tableId}/menuOrder`] = newOrderIds;
            newOrderIds.forEach((id, idx) => {
                updates[`tables/${this.state.tableId}/menu/${id}/order`] = idx;
            });

            if (barName) {
                const barKey = barName.replace(/\s/g, '_');
                updates[`bar_menus/${barKey}_order`] = newOrderIds;
                newOrderIds.forEach((id, idx) => {
                    updates[`bar_menus/${barKey}/${id}/order`] = idx;
                });
            }

            if (this.state.tableData) {
                this.state.tableData.menuOrder = newOrderIds;
                if (this.state.tableData.menu) {
                    newOrderIds.forEach((id, idx) => {
                        if (this.state.tableData.menu[id]) {
                            this.state.tableData.menu[id].order = idx;
                        }
                    });
                }
            }

            await update(ref(this.db), updates);
            this.updateMenuUI();
        } catch (error) {
            console.error('Error al guardar el nuevo orden del menú:', error);
            alert('Error al guardar el nuevo orden del menú.');
        }
    },

    updateOrdersUI() {
        const orders = this.state.tableData.orders;
        this.display.recentOrders.innerHTML = '';
        if (!orders) return;

        const sortedOrders = Object.entries(orders).sort((a, b) => b[1].timestamp - a[1].timestamp).slice(0, 8);
        sortedOrders.forEach(([id, o]) => {
            let userLabel = o.user;
            if (o.user === 'SHARED') {
                const targets = this.getOrderBeneficiaries(o);
                const candidates = this.getAllSharedOrderCandidates(o);
                if (targets.length === candidates.length && candidates.length > 0) {
                    userLabel = '💎 Todos';
                } else {
                    userLabel = `💎 Escote (${targets.length} pers.)`;
                }
            }
            const div = document.createElement('div');
            div.className = 'order-row';
            div.innerHTML = `
                <span><b>${userLabel}</b>: ${o.productName}</span>
                <div class="order-actions">
                    <span>${this.formatEuro(o.price)}</span>
                    <button class="btn-delete-small" onclick="App.handleDeleteOrder('${id}')">🗑️</button>
                </div>
            `;
            this.display.recentOrders.appendChild(div);
        });
        this.calculateTotals();
    },

    calculateTotals() {
        const data = this.state.tableData;
        if (!data || !data.orders || !data.participants) return;
        const allTotals = this.calculateAllIndividualTotals();
        let totalBill = 0;
        Object.values(data.orders).forEach(o => totalBill += o.price);
        
        let myTotal = allTotals[this.state.user] || 0;
        // Usar getPartner para acumular deuda aunque la pareja se haya ido
        const partnerName = this.getPartner(this.state.user);
        const participants = Object.values(data.participants || {});
        const partnerInTable = partnerName ? participants.find(p => this.normalizeKey(p.name) === this.normalizeKey(partnerName)) : null;
        const myShareLabelEl = document.querySelector('#my-share + .stat-label');
        if (partnerInTable) {
            const partnerTotal = allTotals[partnerInTable.name] || 0;
            myTotal += partnerTotal;
            const isPartnerLeft = partnerInTable.status === 'left';
            if (myShareLabelEl) myShareLabelEl.innerHTML = `Tu parte <span class="badge-couple" style="margin-left: 4px;">💑 +${partnerInTable.name}${isPartnerLeft ? ' <small style="color:#f87171;">(fuera)</small>' : ''}</span>`;
        } else {
            if (myShareLabelEl) myShareLabelEl.textContent = 'Tu parte';
        }

        this.display.totalBill.textContent = this.formatEuro(totalBill);
        this.display.myShare.textContent = this.formatEuro(myTotal);
    },

    calculateAllIndividualTotals() {
        const data = this.state.tableData;
        if (!data) return {};
        
        const totals = {};
        const participants = Object.values(data.participants || {});
        
        participants.forEach(p => {
            totals[p.name] = 0;
        });
        
        if (data.orders) {
            Object.values(data.orders).forEach(o => {
                const price = Number(o.price || 0);

                if (o.user === 'SHARED') {
                    const targets = this.getOrderBeneficiaries(o);
                    const count = targets.length || 1;
                    const share = price / count;
                    targets.forEach(targetName => {
                        if (totals.hasOwnProperty(targetName)) {
                            totals[targetName] = (totals[targetName] || 0) + share;
                        }
                    });
                } else if (totals.hasOwnProperty(o.user)) {
                    totals[o.user] = (totals[o.user] || 0) + price;
                }
            });
        }
        return totals;
    },

    showParticipantDetail(name) {
        const data = this.state.tableData;
        if (!data) return;
        const participants = Object.values(data.participants || {});
        const pInfo = participants.find(p => p.name === name);
        const tableStart = Number(data.createdAt || 0);
        const myJoinTime = Number(pInfo?.joinedAt || tableStart);
        
        let html = `<h3>Consumo de ${name}</h3><div class="detail-list">`;
        let total = 0;
        let hasOrders = false;

        Object.entries(data.orders || {}).forEach(([id, o]) => {
            let price = 0;
            let label = '';
            const orderTime = Number(o.timestamp || tableStart);

            if (o.user === 'SHARED') {
                const targets = this.getOrderBeneficiaries(o);
                if (targets.includes(name)) {
                    price = Number(o.price) / (targets.length || 1);
                    label = `(Escote) ${o.productName}`;
                }
            } else if (o.user === name) {
                price = Number(o.price);
                label = o.productName;
            }

            if (price > 0) {
                hasOrders = true;
                total += price;
                const orderHour = o.timestamp ? new Date(o.timestamp).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : '';
                const orderedByStr = o.orderedBy ? `por ${o.orderedBy}` : '';
                const timeStr = orderHour ? ` a las ${orderHour}` : '';
                const metaInfo = (orderedByStr || timeStr) ? `<div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.15rem; width: 100%; text-align: left;">Pedida ${orderedByStr}${timeStr}</div>` : '';
                
                html += `
                    <div class="order-row" style="flex-direction: column; align-items: flex-start; padding: 0.6rem 0;">
                        <div style="display: flex; justify-content: space-between; width: 100%; align-items: center;">
                            <span>${label}</span>
                            <div class="order-actions">
                                <span>${this.formatEuro(price)}</span>
                                <button class="btn-delete-small" onclick="App.handleDeleteOrder('${id}', '${name.replace(/'/g, "\\'")}')">🗑️</button>
                            </div>
                        </div>
                        ${metaInfo}
                    </div>
                `;
            }
        });

        if (!hasOrders) html += `<p class="empty-msg">Aún no ha pedido nada.</p>`;
        else html += `<div class="order-row total-row"><span><b>TOTAL</b></span><span><b>${this.formatEuro(total)}</b></span></div>`;
        html += `</div>`;

        if (pInfo?.status === 'active') {
            html += `<button type="button" class="btn-leave-home" style="margin-top: 1rem;" onclick="App.kickParticipant('${name.replace(/'/g, "\\'")}')">🚪 Marcar que se ha ido a casa</button>`;
        }

        // Si el participante se ha ido y no ha reclamado, ofrecer botón de reclamo y mostrar monto disponible
        if (pInfo?.status === 'left' && !pInfo?.refunded) {
            // Calcular monto reembolsable
            const partyData = this.state.partyData;
            const totalCollected = partyData.totalCollected || 0;
            const balance = totalCollected - (partyData.totalSpent || 0);
            let refundable = 0;
            if (balance > 0) {
                const individualAports = {};
                if (partyData.history) {
                    Object.values(partyData.history).forEach(item => {
                        if (item.type === 'income') {
                            const contribName = item.description.replace('Aporte de ', '');
                            individualAports[contribName] = (individualAports[contribName] || 0) + item.amount;
                        }
                    });
                }
                const aport = individualAports[name] || 0;
                refundable = (balance * aport) / totalCollected;
            }
            if (refundable > 0) {
                html += `<p class="refund-amount">Puedes reclamar ${this.formatEuro(refundable)} del bote.</p>`;
            }
            html += `<button class="btn-primary" onclick="App.claimRefund('${name}')">Reclamar sobrante</button>`;
        }
        this.openModal(html);
    },

    getNameLengthClass(name) {
        if (!name || typeof name !== 'string') return 'name-medium';
        const trimmed = name.trim();
        const words = trimmed.split(/\s+/);
        const maxWordLength = Math.max(...words.map(w => w.length));
        const totalLength = trimmed.length;

        if (maxWordLength > 11 || totalLength > 15) return 'name-xlong';
        if (maxWordLength > 8 || totalLength > 11) return 'name-long';
        if (maxWordLength > 6 || totalLength > 8) return 'name-medium';
        return 'name-short';
    },

    showParticipantSelector(product) {
        const participants = Object.values(this.state.tableData.participants || {})
            .filter(p => p.status !== 'left');
        this.state.tempSelection = [];
        this.state.currentOrderProduct = product;
        this.state.currentSelectorParticipants = participants.map(p => p.name);

        let html = `<h3>¿Para quién es ${product.icon || '🍴'} ${product.name}?</h3>`;

        if (product.allowEscote) {
            html += `
                <div style="margin-top: 0.85rem; margin-bottom: 0.5rem;">
                    <button class="participant-btn btn-shared" style="width: 100%; padding: 0.85rem;" onclick="App.handleSharedOrder(${JSON.stringify(product).replace(/"/g, '&quot;')})">
                        💎 A Escote (Todos)
                    </button>
                </div>
            `;
        }

        html += `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 0.85rem; margin-bottom: 0.35rem;">
                <span style="font-size: 0.82rem; color: var(--text-muted); font-weight: 500;">Asignar a cada uno:</span>
                <div class="selector-switch-group">
                    <button type="button" id="switch-select-all" class="selector-switch-btn" onclick="App.toggleAllParticipants(true)">Todos</button>
                    <button type="button" id="switch-select-none" class="selector-switch-btn active" onclick="App.toggleAllParticipants(false)">Ninguno</button>
                </div>
            </div>
        `;

        html += `<div class="participant-grid" style="margin-top: 0.5rem; margin-bottom: 0.85rem;">`;
        participants.forEach(p => {
            const isMe = p.name === this.state.user;
            const idName = p.name.replace(/\s/g, '_').replace(/\./g, '_');
            const sizeClass = this.getNameLengthClass(p.name);
            html += `<button id="p-btn-${idName}" class="participant-btn ${sizeClass} ${isMe ? 'is-me' : ''}" onclick="App.toggleParticipantSelection('${p.name.replace(/'/g, "\\'")}')">${p.name}</button>`;
        });
        html += `</div>`;
        html += `<p style="text-align: center; font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.4rem;">Marca los nombres y pulsa <b>Volver</b></p>`;

        this.openModal(html);
        this.updateParticipantSelectorReturnBtn();
    },

    updateParticipantSelectorReturnBtn() {
        const closeBtn = document.getElementById('btn-close-modal');
        if (!closeBtn) return;
        const count = (this.state.tempSelection || []).length;
        if (count > 0) {
            closeBtn.textContent = `Volver (${count} ${count === 1 ? 'pedido' : 'pedidos'})`;
            closeBtn.className = 'btn-primary';
        } else {
            closeBtn.textContent = 'Volver';
            closeBtn.className = 'btn-secondary';
        }
    },

    toggleAllParticipants(selectAll) {
        const participants = this.state.currentSelectorParticipants || [];
        const switchAll = document.getElementById('switch-select-all');
        const switchNone = document.getElementById('switch-select-none');

        if (selectAll) {
            this.state.tempSelection = [...participants];
            participants.forEach(name => {
                const idName = name.replace(/\s/g, '_').replace(/\./g, '_');
                const btn = document.getElementById(`p-btn-${idName}`);
                if (btn) btn.classList.add('selected');
            });
            if (switchAll) switchAll.classList.add('active');
            if (switchNone) switchNone.classList.remove('active');
        } else {
            this.state.tempSelection = [];
            participants.forEach(name => {
                const idName = name.replace(/\s/g, '_').replace(/\./g, '_');
                const btn = document.getElementById(`p-btn-${idName}`);
                if (btn) btn.classList.remove('selected');
            });
            if (switchAll) switchAll.classList.remove('active');
            if (switchNone) switchNone.classList.add('active');
        }

        this.updateParticipantSelectorReturnBtn();
    },

    toggleParticipantSelection(name) {
        const idx = this.state.tempSelection.indexOf(name);
        const idName = name.replace(/\s/g, '_').replace(/\./g, '_');
        const btn = document.getElementById(`p-btn-${idName}`);
        if (idx > -1) {
            this.state.tempSelection.splice(idx, 1);
            if (btn) btn.classList.remove('selected');
        } else {
            this.state.tempSelection.push(name);
            if (btn) btn.classList.add('selected');
        }

        // Actualizar el estado visual del switch Todos / Ninguno
        const total = (this.state.currentSelectorParticipants || []).length;
        const count = this.state.tempSelection.length;
        const switchAll = document.getElementById('switch-select-all');
        const switchNone = document.getElementById('switch-select-none');
        if (switchAll) switchAll.classList.toggle('active', count === total && total > 0);
        if (switchNone) switchNone.classList.toggle('active', count === 0);

        this.updateParticipantSelectorReturnBtn();
    },

    confirmMultiOrder(product) {
        if (!this.state.tempSelection || this.state.tempSelection.length === 0) return alert('Selecciona al menos a una persona.');
        this.addOrder(product, this.state.tempSelection);
    },

    handleRepeatRoundSelector() {
        const participants = Object.values(this.state.tableData.participants || {})
            .filter(p => p.status !== 'left');
        if (participants.length === 0) return alert('No hay participantes en la mesa.');

        const orders = Object.values(this.state.tableData.orders || {});
        const participantLastOrders = {};
        participants.forEach(p => {
            const userOrders = orders.filter(o => o.user === p.name);
            if (userOrders.length > 0) {
                userOrders.sort((a, b) => b.timestamp - a.timestamp);
                participantLastOrders[p.name] = userOrders[0];
            } else {
                participantLastOrders[p.name] = null;
            }
        });

        const eligibleParticipants = participants.filter(p => !!participantLastOrders[p.name]).map(p => p.name);
        this.state.currentRepeatParticipants = eligibleParticipants;
        this.state.tempRepeatSelection = [];
        
        let html = `<h3>Otra ronda de lo mismo 🔁</h3>`;
        html += `<p class="subtitle" style="margin-bottom: 0.85rem; text-align: center;">¿Quiénes quieren repetir su último pedido?</p>`;
        
        html += `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 0.5rem; margin-bottom: 0.5rem;">
                <span style="font-size: 0.82rem; color: var(--text-muted); font-weight: 500;">Seleccionar:</span>
                <div class="selector-switch-group">
                    <button type="button" id="switch-repeat-all" class="selector-switch-btn" onclick="App.toggleAllRepeatParticipants(true)">Todos</button>
                    <button type="button" id="switch-repeat-none" class="selector-switch-btn active" onclick="App.toggleAllRepeatParticipants(false)">Ninguno</button>
                </div>
            </div>
        `;

        html += `<div class="participant-grid" style="margin-top: 0.5rem; margin-bottom: 1.25rem;">`;
        
        participants.forEach(p => {
            const lastOrder = participantLastOrders[p.name];
            const isMe = p.name === this.state.user;
            const disabled = !lastOrder;
            const detailText = lastOrder ? lastOrder.productName : 'Sin pedidos';
            const idName = p.name.replace(/\s/g, '_').replace(/\./g, '_');
            const sizeClass = this.getNameLengthClass(p.name);
            
            html += `
                <button id="rep-btn-${idName}" 
                        class="participant-btn ${sizeClass} ${isMe && lastOrder ? 'is-me' : ''} ${disabled ? 'disabled' : ''}" 
                        ${disabled ? 'disabled style="opacity: 0.4; cursor: not-allowed;"' : ''} 
                        onclick="App.toggleRepeatSelection('${p.name.replace(/'/g, "\\'")}')">
                    <div style="font-weight: bold; font-size: inherit;">${p.name}</div>
                    <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.25rem;">${detailText}</div>
                </button>
            `;
        });
        
        html += `</div>`;
        html += `<button id="btn-confirm-repeat" class="btn-primary" onclick="App.confirmRepeatRound(${JSON.stringify(participantLastOrders).replace(/"/g, '&quot;')})">Repetir pedidos (0)</button>`;
        
        this.openModal(html);
    },

    toggleAllRepeatParticipants(selectAll) {
        const eligible = this.state.currentRepeatParticipants || [];
        const switchAll = document.getElementById('switch-repeat-all');
        const switchNone = document.getElementById('switch-repeat-none');

        if (selectAll) {
            this.state.tempRepeatSelection = [...eligible];
            eligible.forEach(name => {
                const idName = name.replace(/\s/g, '_').replace(/\./g, '_');
                const btn = document.getElementById(`rep-btn-${idName}`);
                if (btn) btn.classList.add('selected');
            });
            if (switchAll) switchAll.classList.toggle('active', eligible.length > 0);
            if (switchNone) switchNone.classList.toggle('active', eligible.length === 0);
        } else {
            this.state.tempRepeatSelection = [];
            eligible.forEach(name => {
                const idName = name.replace(/\s/g, '_').replace(/\./g, '_');
                const btn = document.getElementById(`rep-btn-${idName}`);
                if (btn) btn.classList.remove('selected');
            });
            if (switchAll) switchAll.classList.remove('active');
            if (switchNone) switchNone.classList.add('active');
        }

        const confirmBtn = document.getElementById('btn-confirm-repeat');
        if (confirmBtn) {
            confirmBtn.textContent = `Repetir pedidos (${this.state.tempRepeatSelection.length})`;
        }
    },

    toggleRepeatSelection(name) {
        if (!this.state.tempRepeatSelection) this.state.tempRepeatSelection = [];
        const idx = this.state.tempRepeatSelection.indexOf(name);
        const idName = name.replace(/\s/g, '_').replace(/\./g, '_');
        const btn = document.getElementById(`rep-btn-${idName}`);
        if (idx > -1) {
            this.state.tempRepeatSelection.splice(idx, 1);
            if (btn) btn.classList.remove('selected');
        } else {
            this.state.tempRepeatSelection.push(name);
            if (btn) btn.classList.add('selected');
        }

        // Actualizar el estado visual del switch Todos / Ninguno
        const total = (this.state.currentRepeatParticipants || []).length;
        const count = this.state.tempRepeatSelection.length;
        const switchAll = document.getElementById('switch-repeat-all');
        const switchNone = document.getElementById('switch-repeat-none');
        if (switchAll) switchAll.classList.toggle('active', count === total && total > 0);
        if (switchNone) switchNone.classList.toggle('active', count === 0);

        const confirmBtn = document.getElementById('btn-confirm-repeat');
        if (confirmBtn) {
            confirmBtn.textContent = `Repetir pedidos (${count})`;
        }
    },

    async confirmRepeatRound(participantLastOrders) {
        if (!this.state.tempRepeatSelection || this.state.tempRepeatSelection.length === 0) {
            return alert('Selecciona al menos a una persona.');
        }

        try {
            const menuEntries = Object.entries(this.state.tableData?.menu || {});
            for (const name of this.state.tempRepeatSelection) {
                const lastOrder = participantLastOrders[name];
                if (lastOrder) {
                    const match = menuEntries.find(([mId, mItem]) => 
                        (lastOrder.productId && mId === lastOrder.productId) || mItem.name === lastOrder.productName
                    );
                    const productMock = {
                        id: match ? match[0] : (lastOrder.productId || null),
                        name: match ? match[1].name : lastOrder.productName,
                        price: match ? match[1].price : lastOrder.price,
                        alcohol: (match && match[1].alcohol !== undefined) ? match[1].alcohol : (lastOrder.alcohol || 0),
                        cl: (match && match[1].cl !== undefined) ? match[1].cl : (lastOrder.cl || 0)
                    };
                    await this.addOrder(productMock, name);
                }
            }
            this.closeModal();
        } catch (error) {
            console.error('Error al repetir la ronda:', error);
            alert('Error al repetir la ronda.');
        }
    },

    initSettleView() {
        const participants = Object.values(this.state.tableData.participants);
        this.display.payerSelector.innerHTML = '';
        
        const potContributorSelect = document.getElementById('pot-contributor');
        if (potContributorSelect) {
            potContributorSelect.innerHTML = '';
            participants.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.name;
                opt.textContent = p.name;
                if (p.name === this.state.user) opt.selected = true;
                potContributorSelect.appendChild(opt);
            });
        }

        participants.forEach(p => {
            const btn = document.createElement('div');
            btn.className = 'payer-btn';
            btn.innerHTML = `<span>${p.name}</span> <span>💰</span>`;
            btn.onclick = () => this.selectPayer(p.name);
            this.display.payerSelector.appendChild(btn);
        });

        this.listenToContributions();
        this.updateChangeAssistantUI();
    },

    async selectPayer(name) {
        if (!name) return;
        try {
            await set(ref(this.db, `tables/${this.state.tableId}/currentPayer`), name);
        } catch (e) { console.error(e); }
    },

    setSettleMode(mode) {
        this.state.settleMode = mode;
        document.getElementById('mode-single-payer').classList.toggle('active', mode === 'single');
        document.getElementById('mode-group-pay').classList.toggle('active', mode === 'group');
        document.getElementById('single-payer-section').classList.toggle('hidden', mode === 'group');
        document.getElementById('group-pay-section').classList.toggle('hidden', mode === 'single');
        document.getElementById('settlement-results').classList.toggle('hidden', mode === 'group');
        if (mode === 'group') this.updatePotUI();
    },

    async addContribution() {
        const amount = this.parseAmount(document.getElementById('input-pot-amount').value);
        const potContributorEl = document.getElementById('pot-contributor');
        const targetUser = potContributorEl && potContributorEl.value ? potContributorEl.value : this.state.user;
        
        if (isNaN(amount) || amount <= 0) return;
        try {
            const contributionsRef = ref(this.db, `tables/${this.state.tableId}/contributions`);
            await push(contributionsRef, {
                user: targetUser,
                amount: amount,
                registeredBy: this.state.user,
                timestamp: Date.now()
            });
            document.getElementById('input-pot-amount').value = '';
        } catch (error) { console.error(error); }
    },

    async editContribution(id, currentAmount, user) {
        const newAmount = prompt(`Modificar aportación de ${user}:`, currentAmount);
        if (newAmount === null) return;
        const amount = this.parseAmount(newAmount);
        if (isNaN(amount) || amount <= 0) {
            alert('Cantidad inválida.');
            return;
        }
        try {
            await set(ref(this.db, `tables/${this.state.tableId}/contributions/${id}/amount`), amount);
        } catch (error) { console.error('Error editando', error); }
    },

    async deleteContribution(id) {
        if (!confirm('¿Seguro que quieres borrar este aporte?')) return;
        try {
            await set(ref(this.db, `tables/${this.state.tableId}/contributions/${id}`), null);
        } catch (error) { console.error('Error borrando', error); }
    },

    listenToContributions() {
        const contributionsRef = ref(this.db, `tables/${this.state.tableId}/contributions`);
        onValue(contributionsRef, (snapshot) => {
            this.state.contributions = snapshot.val() || {};
            this.updatePotUI();
        });
    },

    updatePotUI() {
        const data = this.state.tableData;
        if (!data) return;

        let totalTicket = 0;
        if (data.orders) Object.values(data.orders).forEach(o => totalTicket += Number(o.price));

        // 1. Calcular aportaciones por usuario
        const userContributions = {};
        let totalPot = 0;
        const contributions = Object.entries(this.state.contributions || {}).map(([id, c]) => ({ ...c, id }));
        
        contributions.forEach(c => {
            totalPot += Number(c.amount);
            userContributions[c.user] = (userContributions[c.user] || 0) + Number(c.amount);
        });

        // 2. Calcular deudas individuales
        const individualDebts = this.calculateAllIndividualTotals();
        const participants = Object.values(data.participants || {});

        // 3. Renderizar Lista de Estado Individual y Parejas
        const statusContainer = document.getElementById('group-individual-status');
        statusContainer.innerHTML = '<h4>¿Cómo va el reparto?</h4>';

        const processedKeys = new Set();
        const groups = [];

        participants.forEach(p => {
            if (p.status === 'left') return;
            const pKey = this.normalizeKey(p.name);
            if (processedKeys.has(pKey)) return;

            const partnerName = this.getPartner(p.name);
            const partnerObj = partnerName ? participants.find(x => this.normalizeKey(x.name) === this.normalizeKey(partnerName)) : null;

            if (partnerObj && partnerObj.status !== 'left') {
                // Pareja ambos activos en la mesa
                processedKeys.add(pKey);
                processedKeys.add(this.normalizeKey(partnerName));
                const owed1 = individualDebts[p.name] || 0;
                const owed2 = individualDebts[partnerName] || 0;
                const put1 = userContributions[p.name] || 0;
                const put2 = userContributions[partnerName] || 0;

                groups.push({
                    displayName: `${p.name} y ${partnerName}`,
                    isCouple: true,
                    owed: owed1 + owed2,
                    put: put1 + put2,
                    names: [p.name, partnerName],
                    breakdown: `Debe ${p.name}: ${this.formatEuro(owed1)} · Debe ${partnerName}: ${this.formatEuro(owed2)}`
                });
            } else if (partnerObj && partnerObj.status === 'left') {
                // p activo, pareja se fue → absorber deuda del que se fue
                processedKeys.add(pKey);
                processedKeys.add(this.normalizeKey(partnerName));
                const owed1 = individualDebts[p.name] || 0;
                const owed2 = individualDebts[partnerName] || 0;
                const put1 = userContributions[p.name] || 0;
                const put2 = userContributions[partnerName] || 0;

                groups.push({
                    displayName: p.name,
                    isCouple: true,
                    owed: owed1 + owed2,
                    put: put1 + put2,
                    names: [p.name, partnerName],
                    breakdown: `${p.name}: ${this.formatEuro(owed1)} + ${partnerName} (fuera): ${this.formatEuro(owed2)}`
                });
            } else {
                processedKeys.add(pKey);
                const owed = individualDebts[p.name] || 0;
                const put = userContributions[p.name] || 0;
                groups.push({
                    displayName: p.name,
                    isCouple: false,
                    owed: owed,
                    put: put,
                    names: [p.name],
                    breakdown: ''
                });
            }
        });

        groups.forEach(g => {
            const balance = g.put - g.owed;
            const isSettled = balance >= -0.01;

            const div = document.createElement('div');
            div.className = `status-row ${isSettled ? 'settled' : 'pending'} ${g.isCouple ? 'is-couple' : ''}`;
            div.innerHTML = `
                <div class="name-col" style="flex: 1; text-align: left;">
                    <span class="name" style="font-weight: 600;">${g.displayName} ${g.isCouple ? '<span class="badge-couple">💑 Pareja</span>' : ''}</span>
                    ${g.breakdown ? `<div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.15rem;">${g.breakdown}</div>` : ''}
                </div>
                <div class="details" style="display: flex; flex-direction: column; align-items: flex-end; gap: 0.15rem;">
                    <span>A pagar: <b>${this.formatEuro(g.owed)}</b></span>
                    <span style="font-size: 0.78rem; color: var(--text-muted);">Puesto: ${this.formatEuro(g.put)}</span>
                    <span class="balance" style="color: ${balance > 0.01 ? '#3b82f6' : (isSettled ? '#22c55e' : '#f59e0b')}">
                        ${balance > 0.01 ? `Sobran ${this.formatEuro(balance)}` : (isSettled ? '✓ Pagado' : `Faltan ${this.formatEuro(Math.abs(balance))}`)}
                    </span>
                </div>
                <button class="btn-calc-small" onclick="App.showQuickChange('${g.displayName.replace(/'/g, "\\'")}', ${g.owed})">💸</button>
            `;
            statusContainer.appendChild(div);
        });

        // 4. Renderizar Lista de Historial de Contribuciones
        const listContainer = document.getElementById('contributions-list');
        listContainer.innerHTML = '<h4>Historial de aportes</h4>';
        contributions.sort((a, b) => b.timestamp - a.timestamp).forEach(c => {
            const div = document.createElement('div');
            div.className = 'contribution-item';
            div.innerHTML = `
                <span><b>${c.user}</b> puso</span>
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                    <span>${this.formatEuro(c.amount)}</span>
                    <button class="btn-calc-small" style="font-size: 0.8rem; padding: 0.2rem 0.4rem;" onclick="App.editContribution('${c.id}', ${c.amount}, '${c.user.replace(/'/g, "\\'")}')">✏️</button>
                    <button class="btn-calc-small" style="font-size: 0.8rem; padding: 0.2rem 0.4rem; color: var(--danger);" onclick="App.deleteContribution('${c.id}')">❌</button>
                </div>
            `;
            listContainer.appendChild(div);
        });

        const diff = totalTicket - totalPot;
        document.getElementById('group-total-bill').textContent = this.formatEuro(totalTicket);
        document.getElementById('pot-amount').textContent = this.formatEuro(totalPot);
        const diffLabel = document.getElementById('pot-diff-label');
        const diffValue = document.getElementById('pot-diff-value');
        const diffContainer = document.getElementById('pot-difference-container');
        
        if (diff > 0.01) {
            diffLabel.textContent = 'Faltan';
            diffValue.textContent = this.formatEuro(diff);
            diffContainer.className = 'pot-item status-error';
        } else if (diff < -0.01) {
            diffLabel.textContent = 'Sobran';
            diffValue.textContent = this.formatEuro(Math.abs(diff));
            diffContainer.className = 'pot-item status-ok';
        } else {
            diffLabel.textContent = '¡Cuadra!';
            diffValue.textContent = this.formatEuro(0);
            diffContainer.className = 'pot-item status-ok';
        }
    },

    showQuickChange(name, owed) {
        const billInput = prompt(`¿Cuánto vas a poner?`, '20');
        if (!billInput) return;
        const paid = this.parseAmount(billInput);
        if (isNaN(paid)) return;
        
        const change = paid - owed;
        if (change < 0) {
            alert(`¡Ojo! ${this.formatEuro(paid)} no llega para pagar los ${this.formatEuro(owed)} que debe.`);
        } else {
            alert(`${name}, tienes que coger ${this.formatEuro(change)} del bote común.\n\nLuego anota en la app que has puesto tus ${this.formatEuro(owed)}.`);
        }
    },

    updateChangeAssistantUI() {
        if (this.state.settleMode === 'group') return;

        const payer = this.state.tableData?.currentPayer;
        if (!payer) return;
        this.state.currentPayer = payer;
        
        document.querySelectorAll('.payer-btn').forEach(b => {
            const spanName = b.querySelector('span').textContent;
            if (spanName === payer) b.classList.add('selected');
            else b.classList.remove('selected');
        });
        document.getElementById('settlement-results').classList.remove('hidden');
        document.getElementById('selected-payer-name').textContent = payer;

        const totals = this.calculateAllIndividualTotals();
        const settlements = this.state.tableData?.settlements?.[payer] || {};
        const participants = Object.values(this.state.tableData?.participants || {});

        // Pareja del pagador en la mesa (si está)
        const payerPartner = this.isPartnerAtTable(payer, participants);

        // Agrupar en unidades de cobro (parejas activas e individuales)
        const processedKeys = new Set();
        processedKeys.add(this.normalizeKey(payer));
        if (payerPartner) {
            processedKeys.add(this.normalizeKey(payerPartner));
        }

        const paymentUnits = [];

        participants.forEach(p => {
            if (p.status === 'left') return;
            const pKey = this.normalizeKey(p.name);
            if (processedKeys.has(pKey)) return;

            const partnerName = this.getPartner(p.name);
            const partnerObj = partnerName ? participants.find(x => this.normalizeKey(x.name) === this.normalizeKey(partnerName)) : null;

            if (partnerObj && partnerObj.status !== 'left') {
                // Pareja ambos activos en la mesa
                processedKeys.add(pKey);
                processedKeys.add(this.normalizeKey(partnerName));
                const amt1 = totals[p.name] || 0;
                const amt2 = totals[partnerName] || 0;
                const combinedAmount = amt1 + amt2;

                paymentUnits.push({
                    unitId: `${p.name}_y_${partnerName}`.replace(/\s/g, '_'),
                    storageKey: `${p.name}_${partnerName}`.replace(/\./g, '_'),
                    displayName: `${p.name} y ${partnerName}`,
                    isCouple: true,
                    names: [p.name, partnerName],
                    amount: combinedAmount,
                    breakdown: `${p.name} (${this.formatEuro(amt1)}) + ${partnerName} (${this.formatEuro(amt2)})`
                });
            } else if (partnerObj && partnerObj.status === 'left') {
                // p activo, pareja se fue → absorber deuda del que se fue
                processedKeys.add(pKey);
                processedKeys.add(this.normalizeKey(partnerName));
                const amt1 = totals[p.name] || 0;
                const amt2 = totals[partnerName] || 0;
                const combinedAmount = amt1 + amt2;

                paymentUnits.push({
                    unitId: p.name.replace(/\s/g, '_'),
                    storageKey: `${p.name}_${partnerName}`.replace(/\./g, '_'),
                    displayName: p.name,
                    isCouple: true,
                    names: [p.name, partnerName],
                    amount: combinedAmount,
                    breakdown: `${p.name} (${this.formatEuro(amt1)}) + ${partnerName} fuera (${this.formatEuro(amt2)})`
                });
            } else {
                // Individual
                processedKeys.add(pKey);
                paymentUnits.push({
                    unitId: p.name.replace(/\s/g, '_'),
                    storageKey: p.name.replace(/\./g, '_'),
                    displayName: p.name,
                    isCouple: false,
                    names: [p.name],
                    amount: totals[p.name] || 0,
                    breakdown: ''
                });
            }
        });

        const currentPayerInList = this.display.debtsList.dataset.payer;
        
        if (currentPayerInList !== payer) {
            this.display.debtsList.innerHTML = '';
            this.display.debtsList.dataset.payer = payer;

            if (payerPartner) {
                const partnerNotice = document.createElement('div');
                partnerNotice.style.cssText = 'font-size: 0.85rem; color: #f472b6; background: rgba(236,72,153,0.12); border: 1px solid rgba(236,72,153,0.25); border-radius: var(--radius-sm); padding: 0.5rem 0.8rem; margin-bottom: 0.85rem; text-align: center;';
                partnerNotice.innerHTML = `💑 <b>${payerPartner}</b> (pareja de ${payer}) no debe nada, pagan juntos.`;
                this.display.debtsList.appendChild(partnerNotice);
            }
            
            paymentUnits.forEach((unit) => {
                const div = document.createElement('div');
                div.className = `payment-row ${unit.isCouple ? 'is-couple' : ''}`;
                div.id = `pay-row-${unit.unitId}`;
                div.innerHTML = `
                    <div class="p-header">
                        <div style="text-align: left;">
                            <span style="font-weight: 600;">${unit.displayName}</span>
                            ${unit.isCouple ? `<span class="badge-couple" style="margin-left: 4px;">💑 Pareja</span>` : ''}
                            ${unit.breakdown ? `<div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.1rem;">${unit.breakdown}</div>` : ''}
                        </div>
                        <span class="p-amount">A pagar: ${this.formatEuro(unit.amount)}</span>
                    </div>
                    <div class="p-controls">
                        <input type="number" step="0.01" class="input-payment" placeholder="${unit.isCouple ? 'Pagan con...' : 'Paga con...'}" oninput="App.calculateIndividualChange(this, ${unit.amount}); App.handleUnitPaymentChange('${payer}', '${unit.storageKey}', this.value, ['${unit.names.join("','")}'])">
                        <div class="method-options">
                             <button class="method-btn" onclick="App.handleUnitPaymentChange('${payer}', '${unit.storageKey}', ${unit.amount}, ['${unit.names.join("','")}'])">📲 Bizum</button>
                        </div>
                    </div>
                    <div class="change-result-row" style="margin-top: 0.5rem; min-height: 1.2rem; font-size: 0.9rem; color: var(--primary);"></div>
                `;
                this.display.debtsList.appendChild(div);
            });
        }
        
        paymentUnits.forEach((unit) => {
            const row = document.getElementById(`pay-row-${unit.unitId}`);
            if (!row) return;
            const input = row.querySelector('.input-payment');
            
            let paid = settlements[unit.storageKey];
            if (paid === undefined && unit.isCouple) {
                const p1 = settlements[unit.names[0].replace(/\./g, '_')];
                const p2 = settlements[unit.names[1].replace(/\./g, '_')];
                if (p1 !== undefined || p2 !== undefined) {
                    paid = (Number(p1 || 0) + Number(p2 || 0)) || undefined;
                }
            }
            
            if (document.activeElement !== input) {
                if (paid !== undefined && paid !== null && paid !== '') {
                    input.value = paid;
                    this.calculateIndividualChange(input, unit.amount);
                } else {
                    input.value = '';
                    row.querySelector('.change-result-row').innerHTML = '';
                }
            }
        });
    },

    async handleUnitPaymentChange(payer, storageKey, value, names = []) {
        const amount = value === '' || value === null ? null : this.parseAmount(value);
        if (amount !== null && isNaN(amount)) return;
        try {
            await set(ref(this.db, `tables/${this.state.tableId}/settlements/${payer}/${storageKey}`), amount);
            // Si es pareja, sincronizar los nombres individuales para consistencia
            if (names && names.length === 2) {
                const k1 = names[0].replace(/\./g, '_');
                const k2 = names[1].replace(/\./g, '_');
                await set(ref(this.db, `tables/${this.state.tableId}/settlements/${payer}/${k1}`), amount);
                await set(ref(this.db, `tables/${this.state.tableId}/settlements/${payer}/${k2}`), null);
            }
            this.updateChangeAssistantUI();
        } catch (error) { console.error(error); }
    },

    async handleIndividualPaymentChange(payer, friendName, value) {
        await this.handleUnitPaymentChange(payer, friendName.replace(/\./g, '_'), value, [friendName]);
    },

    calculateIndividualChange(inputElement, owed) {
        const paid = this.parseAmount(inputElement.value);
        const resultElement = inputElement.closest('.payment-row').querySelector('.change-result-row');
        if (isNaN(paid)) { resultElement.innerHTML = ''; return; }
        const change = Math.round((paid - owed) * 100) / 100;
        if (change < 0) {
            resultElement.innerHTML = `<span style="color: var(--danger)">Faltan ${this.formatEuro(Math.abs(change))}</span>`;
        } else if (change === 0) {
            resultElement.innerHTML = `<span style="color: #22c55e">✓ Pagado exacto</span>`;
        } else {
            resultElement.innerHTML = `<span>Cambio: <b>${this.formatEuro(change)}</b></span>`;
        }
    },

    showView(viewName) {
        if (viewName === 'settle') this.initSettleView();
        if (viewName === 'login-view') {
            this.loadLoginMembers();
            const codeGroup = document.getElementById('login-admin-code-group');
            if (codeGroup) codeGroup.classList.add('hidden');
            const loginSubtitle = document.getElementById('login-subtitle');
            if (loginSubtitle) loginSubtitle.textContent = `Selecciona tu miembro de la banda para entrar`;
            // Limpiar selección previa
            document.querySelectorAll('#login-members-grid .participant-btn').forEach(btn => btn.classList.remove('selected'));
        }
        if (viewName === 'setup') {
            // Actualizar el nombre del usuario en el botón de cambio de miembro
            this.updateHeaderUser();
        }
        Object.values(this.views).forEach(v => v?.classList.remove('active'));
        
        const targetView = this.views[viewName];
        if (targetView) targetView.classList.add('active');
        this.state.currentView = viewName;

        // Gestión de visibilidad de navegación y botones contextuales
        if (viewName === 'setup' || viewName === 'login-view' || viewName === 'admin-view' || viewName === 'history-view') {
            this.nav.classList.add('hidden');
            this.buttons.leaveTable.classList.add('hidden');
        } else {
            this.nav.classList.remove('hidden');
            this.buttons.leaveTable.classList.remove('hidden');

            // Mostrar/Ocultar botones según modo
            const barButtons = document.querySelectorAll('.nav-bar-only');
            const partyButtons = document.querySelectorAll('.nav-party-only');
            
            if (viewName === 'party-pot') {
                barButtons.forEach(b => b.classList.add('hidden'));
                partyButtons.forEach(b => b.classList.remove('hidden'));
                // Cambiar texto del botón a "Dejar la fiesta"
                const targetWord = document.getElementById('leave-target-word');
                if (targetWord) targetWord.textContent = 'fiesta';
                else {
                    const leaveSpan = this.buttons.leaveTable.querySelector('span:first-child');
                    if (leaveSpan) leaveSpan.textContent = 'Dejar la fiesta';
                }
            } else {
                barButtons.forEach(b => b.classList.remove('hidden'));
                partyButtons.forEach(b => b.classList.add('hidden'));
                // Restaurar texto a "Dejar la mesa"
                const targetWord = document.getElementById('leave-target-word');
                if (targetWord) targetWord.textContent = 'mesa';
                else {
                    const leaveSpan = this.buttons.leaveTable.querySelector('span:first-child');
                    if (leaveSpan) leaveSpan.textContent = 'Dejar la mesa';
                }
            }
        }
    },

    async handleLeaveTable() {
        if (!confirm('¿Seguro que quieres salir?')) return;
        try {
            if (this.state.tableId && this.state.user) {
                const participantRef = ref(this.db, `tables/${this.state.tableId}/participants/${this.state.user.replace(/\./g, '_')}`);
                await set(participantRef, { ...this.state.tableData.participants[this.state.user.replace(/\./g, '_')], status: 'left' });
            }
            localStorage.removeItem('thermo_tableId');
            localStorage.removeItem('thermo_partyId');
            location.reload();
        } catch (error) { console.error(error); }
    },

    async kickParticipant(name) {
        if (!confirm(`¿Seguro que quieres sacar a "${name}" de la mesa?`)) return;
        try {
            const key = name.replace(/\./g, '_');
            const participantRef = ref(this.db, `tables/${this.state.tableId}/participants/${key}`);
            const currentParticipant = this.state.tableData.participants[key];
            await set(participantRef, { ...currentParticipant, status: 'left' });
            
            this.closeModal();
            
            if (name === this.state.user) {
                localStorage.removeItem('thermo_tableId');
                localStorage.removeItem('thermo_partyId');
                location.reload();
            } else {
                alert(`"${name}" ha sido sacado de la mesa.`);
            }
        } catch (error) {
            console.error('Error al sacar de la mesa:', error);
            alert('Error al sacar de la mesa.');
        }
    },

    async kickCouple(name1, name2) {
        if (!confirm(`¿Seguro que quieres sacar a ${name1} y ${name2} de la mesa?`)) return;
        try {
            const key1 = name1.replace(/\./g, '_');
            const key2 = name2.replace(/\./g, '_');
            const p1 = this.state.tableData.participants[key1] || {};
            const p2 = this.state.tableData.participants[key2] || {};

            await Promise.all([
                set(ref(this.db, `tables/${this.state.tableId}/participants/${key1}`), { ...p1, status: 'left' }),
                set(ref(this.db, `tables/${this.state.tableId}/participants/${key2}`), { ...p2, status: 'left' })
            ]);

            this.closeModal();

            if (name1 === this.state.user || name2 === this.state.user) {
                localStorage.removeItem('thermo_tableId');
                localStorage.removeItem('thermo_partyId');
                location.reload();
            } else {
                alert(`${name1} y ${name2} han sido sacados de la mesa.`);
            }
        } catch (error) {
            console.error('Error al sacar a la pareja de la mesa:', error);
            alert('Error al sacar a la pareja de la mesa.');
        }
    },

    async handleShowTicket() {
        const data = this.state.tableData;
        if (!data || !data.orders) {
            alert('No hay pedidos en la mesa para generar un ticket.');
            return;
        }

        const barName = this.getBarName();
        const dateObj = new Date();
        const dateStr = dateObj.toLocaleDateString() + ' ' + dateObj.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});

        const orders = Object.values(data.orders);
        const items = {};
        let total = 0;

        orders.forEach(o => {
            if (!items[o.productName]) {
                items[o.productName] = { qty: 0, price: Number(o.price) };
            }
            items[o.productName].qty++;
            total += Number(o.price);
        });

        let itemsHtml = '';
        Object.entries(items).forEach(([name, itemData]) => {
            const sum = itemData.qty * itemData.price;
            itemsHtml += `
                <div class="ticket-row">
                    <span class="t-qty">${itemData.qty}x</span>
                    <span class="t-name">${name} <span style="color: #555; font-size: 0.8em; margin-left: 0.2rem;">(${this.formatEuro(itemData.price)})</span></span>
                    <span class="t-price">${this.formatEuro(sum)}</span>
                </div>
            `;
        });

        const html = `
            <div class="modal-summary-shell">
                <div class="modal-summary-body scroll-fade-bottom">
                    <div class="ticket-receipt">
                        <div class="ticket-header">
                            <h3>${barName}</h3>
                            <p>${dateStr}</p>
                            <p>--------------------------------</p>
                        </div>
                        <div class="ticket-body">
                            ${itemsHtml}
                        </div>
                        <div class="ticket-footer">
                            <p>--------------------------------</p>
                            <div class="ticket-total">
                                <span>TOTAL</span>
                                <span>${this.formatEuro(total)}</span>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="modal-summary-footer">
                    <button onclick="App.startTicketAudit()" class="btn-secondary" style="border-color: var(--primary); background: rgba(99, 102, 241, 0.15); font-weight: 600; padding: 0.65rem; border-radius: 8px;">📸 Cuadrar con Ticket del Bar</button>
                    <button onclick="App.closeModal()" class="btn-primary" style="padding: 0.65rem; border-radius: 8px;">Cerrar Ticket</button>
                </div>
            </div>
        `;

        this.openModal(html, true);
    },

    async handleFinishTable() {
        if (!confirm('¿Cerrar mesa definitivamente?')) return;
        try {
            await set(ref(this.db, `tables/${this.state.tableId}/status`), 'closed');
            await set(ref(this.db, `tables/${this.state.tableId}/finishedAt`), Date.now());
            await this.addLog('finish_table', { tableId: this.state.tableId });
        } catch (error) { console.error(error); }
    },

    showBorrachuzoModal(data) {
        const orders = Object.values(data.orders || {});
        const menu = data.menu || {};

        // Calcular alcohol puro consumido por usuario y conteo de consumiciones
        const alcoholByUser = {};
        const countByUser = {};
        let tableHasAlcoholData = false;

        orders.forEach(o => {
            if (!o) return;

            // Determinar graduación y centilitros
            let alcohol = (o.alcohol !== undefined && o.alcohol !== null) ? Number(o.alcohol) : null;
            let cl = (o.cl !== undefined && o.cl !== null) ? Number(o.cl) : null;

            // Si la orden no tiene alcohol o cl, buscar en el menú
            if (alcohol === null || cl === null) {
                const menuItem = (o.productId && menu[o.productId]) 
                    ? menu[o.productId] 
                    : Object.values(menu).find(m => m.name === o.productName);
                if (menuItem) {
                    if (alcohol === null && menuItem.alcohol !== undefined && menuItem.alcohol !== null) {
                        alcohol = Number(menuItem.alcohol);
                    }
                    if (cl === null && menuItem.cl !== undefined && menuItem.cl !== null) {
                        cl = Number(menuItem.cl);
                    }
                }
            }

            alcohol = Number(alcohol || 0);
            cl = Number(cl || 0);

            // Alcohol puro en cl: cl * (% / 100)
            const pureAlcohol = cl > 0 && alcohol > 0 ? (cl * (alcohol / 100)) : 0;
            if (pureAlcohol > 0) {
                tableHasAlcoholData = true;
            }

            // Distribuir consumo
            if (o.user === 'SHARED') {
                // Escote compartido: repartir entre beneficiarios
                let beneficiaries = [];
                if (Array.isArray(o.beneficiaries) && o.beneficiaries.length > 0) {
                    beneficiaries = o.beneficiaries;
                } else {
                    const participants = Object.values(data.participants || {});
                    const tableStart = Number(data.createdAt || 0);
                    const orderTime = Number(o.timestamp || tableStart);
                    const present = participants.filter(p => Number(p.joinedAt || tableStart) <= orderTime);
                    beneficiaries = (present.length > 0 ? present : participants).map(p => p.name);
                }
                if (beneficiaries.length > 0) {
                    const splitAlcohol = pureAlcohol / beneficiaries.length;
                    beneficiaries.forEach(u => {
                        alcoholByUser[u] = (alcoholByUser[u] || 0) + splitAlcohol;
                        countByUser[u] = (countByUser[u] || 0) + (1 / beneficiaries.length);
                    });
                }
            } else if (o.user) {
                alcoholByUser[o.user] = (alcoholByUser[o.user] || 0) + pureAlcohol;
                countByUser[o.user] = (countByUser[o.user] || 0) + 1;
            }
        });

        let borrachuzosHTML = '';
        let titulo = 'Borrachuzo del día';

        if (tableHasAlcoholData) {
            // Ordenar de mayor a menor consumo de alcohol
            const drinkers = Object.entries(alcoholByUser)
                .filter(([, pureCl]) => pureCl > 0.05)
                .sort((a, b) => b[1] - a[1]);

            if (drinkers.length === 0) {
                borrachuzosHTML = '<p style="margin:0.5rem 0;color:#374151;">¡Hoy todos sobrios! Nadie bebió alcohol 😇</p>';
            } else {
                const maxAlcohol = drinkers[0][1];
                // Tolerancia de 0.05 cl para considerar empates
                const winners = drinkers.filter(([, pureCl]) => Math.abs(pureCl - maxAlcohol) < 0.05).map(([name]) => name);
                titulo = winners.length > 1 ? 'Borrachuzos del día' : 'Borrachuzo del día';

                // Equivalencia orientativa en cañas estándar (20cl a 5% = 1cl de alcohol puro)
                const equivCanas = (maxAlcohol / 1.0).toFixed(1).replace('.0', '');

                borrachuzosHTML = `
                    <p style="font-size:1.25rem;margin:0.5rem 0 0.2rem;color:#111827;font-weight:800;">
                        🍺 ${winners.join(', ')}
                    </p>
                    <p style="color:#d97706;font-size:1.05rem;margin:0 0 0.35rem;font-weight:700;">
                        ${maxAlcohol.toFixed(1)} cl <span style="font-size:0.9rem;color:#4b5563;font-weight:600;">(≈ ${equivCanas} cañas)</span>
                    </p>
                `;

                if (drinkers.length > 1) {
                    borrachuzosHTML += `
                        <div style="margin-top: 0.75rem; border-top: 1px dashed rgba(236, 72, 153, 0.3); padding-top: 0.6rem; text-align: left;">
                            <p style="font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.5px; color: #9d174d; font-weight: 700; margin: 0 0 0.4rem;">
                                📊 Ranking de consumo:
                            </p>
                            <div style="display: flex; flex-direction: column; gap: 0.35rem;">
                                ${drinkers.slice(0, 5).map(([name, pureCl], idx) => {
                                    const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx + 1}º`;
                                    const canas = (pureCl / 1.0).toFixed(1).replace('.0', '');
                                    return `
                                        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.88rem; background: #ffffff; padding: 0.4rem 0.6rem; border-radius: 8px; border: 1px solid rgba(0,0,0,0.06); box-shadow: 0 1px 2px rgba(0,0,0,0.04);">
                                            <span style="color: #111827 !important; font-weight: 700; display: flex; align-items: center; gap: 0.4rem;">
                                                <span style="font-size: 1rem;">${medal}</span>
                                                <span style="color: #111827 !important;">${name}</span>
                                            </span>
                                            <span style="font-weight: 700; color: #d97706;">
                                                ${pureCl.toFixed(1)} cl <span style="font-size: 0.78rem; color: #6b7280; font-weight: 500;">(≈${canas}🍺)</span>
                                            </span>
                                        </div>
                                    `;
                                }).join('')}
                            </div>
                        </div>
                    `;
                }
            }
        } else {
            // Fallback: conteo tradicional por rondas
            const countEntries = Object.entries(countByUser).filter(([, c]) => c > 0);
            if (countEntries.length === 0) {
                borrachuzosHTML = '<p style="margin:0.5rem 0;color:#374151;">Nadie pidió rondas 😅</p>';
            } else {
                const maxCount = Math.max(...countEntries.map(([, c]) => c));
                const winners = countEntries
                    .filter(([, c]) => c === maxCount)
                    .map(([name]) => name);
                titulo = winners.length > 1 ? 'Borrachuzos del día' : 'Borrachuzo del día';
                borrachuzosHTML = `
                    <p style="font-size:1.15rem;margin:0.5rem 0 0.25rem;color:#111827;font-weight:800;">
                        🍺 <strong>${winners.join(', ')}</strong>
                    </p>
                    <p style="color:#4b5563;font-size:0.9rem;margin:0;font-weight:600;">
                        (${maxCount} ronda${maxCount !== 1 ? 's' : ''})
                    </p>`;
            }
        }

        const html = `
            <div style="text-align:center;padding:0.5rem 0 1rem;">
                <div style="font-size:2.5rem;margin-bottom:0.5rem;">🎉</div>
                <h2 style="margin:0 0 0.25rem;font-size:1.3rem;color:#ffffff;">¡Mesa cerrada!</h2>
                <p style="margin:0 0 1rem;color:#9ca3af;font-size:0.9rem;">¡Hasta la próxima quedada! 🍻</p>
                <div style="background:#fdf2f8;border:2px solid #ec4899;border-radius:12px;padding:1rem;margin-bottom:1.25rem;">
                    <p style="margin:0 0 0.4rem;font-weight:700;color:#be185d;font-size:1rem;">
                        🏆 ${titulo}:
                    </p>
                    ${borrachuzosHTML}
                </div>
                <button onclick="App._closeBorrachuzoModal()"
                    style="background:#ec4899;color:#fff;border:none;border-radius:8px;
                           padding:0.65rem 2rem;font-size:1rem;cursor:pointer;font-weight:600;">
                    ¡Hasta luego! 👋
                </button>
            </div>`;

        this.openModal(html, true);

        // Disparar confeti por encima del modal (z-index > 1000)
        if (typeof confetti === 'function') {
            confetti({ particleCount: 160, spread: 90, origin: { y: 0.6 }, zIndex: 1100 });
            setTimeout(() => confetti({ particleCount: 80, spread: 120, origin: { y: 0.4 }, zIndex: 1100 }), 600);
        }
    },

    _closeBorrachuzoModal() {
        this.closeModal();
        location.reload();
    },

    async handleAddFriendManual() {
        try {
            const snapshot = await get(ref(this.db, 'members'));
            const members = snapshot.exists() ? Object.values(snapshot.val()) : [];
            const activeParticipants = Object.values(this.state.tableData?.participants || {})
                .filter(p => p.status === 'active')
                .map(p => p.name);
            
            // Filtramos miembros que ya están activos en la mesa
            const availableMembers = members.filter(m => !activeParticipants.includes(m.name));

            this.state.tempSelectionFriends = [];
            this.state.tempAvailableTableMembers = availableMembers.map(m => m.name);
            
            let html = `<h3>Añadir Amigos a la Mesa</h3>`;
            html += `<p class="subtitle" style="margin-bottom: 0.75rem;">Toca un amigo para añadirlo o quitarlo directamente:</p>`;

            // Botones de selección rápida: Chicos, Chicas, Switch Todos/Ninguno
            html += `
                <div style="display: flex; gap: 0.45rem; align-items: center; flex-wrap: wrap; margin-bottom: 0.85rem;">
                    <button type="button" class="filter-pill filter-pill-boys" onclick="App.setTableFriendsQuickFilter('chicos')">
                        👦 Chicos
                    </button>
                    <button type="button" class="filter-pill filter-pill-girls" onclick="App.setTableFriendsQuickFilter('chicas')">
                        👧 Chicas
                    </button>
                    <div class="selector-switch-group">
                        <button type="button" id="switch-table-friend-all" class="selector-switch-btn" onclick="App.setTableFriendsQuickFilter('todos')">Todos</button>
                        <button type="button" id="switch-table-friend-none" class="selector-switch-btn active" onclick="App.setTableFriendsQuickFilter('ninguno')">Ninguno</button>
                    </div>
                </div>
            `;

            html += `<div class="participant-grid" style="max-height: 40vh; overflow-y: auto;">`;
            
            availableMembers.forEach(m => {
                const safeName = m.name.replace(/'/g, "\\'").replace(/"/g, "&quot;");
                const idName = m.name.replace(/\s/g, '_').replace(/\./g, '_');
                const sizeClass = this.getNameLengthClass(m.name);
                html += `<button id="tf-btn-${idName}" class="participant-btn ${sizeClass}" onclick="App.toggleTableFriendDirect('${safeName}')">${m.name}</button>`;
            });
            
            if (availableMembers.length === 0) {
                html += `<p class="empty-msg" style="grid-column: span 2;">Todos los miembros ya están en la mesa.</p>`;
            }
            
            html += `</div>`;

            html += `
                <div style="margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid var(--glass-border);">
                    <p class="subtitle" style="margin-bottom: 0.5rem; color: var(--text-main);">¿No es miembro? Añádelo manualmente:</p>
                    <input type="text" id="custom-friend-name" placeholder="Escribe un nombre..." style="margin-bottom: 0.75rem;">
                    <label style="display: flex; align-items: center; gap: 0.65rem; cursor: pointer; user-select: none; padding: 0.55rem 0.75rem; background: rgba(255,255,255,0.05); border: 1px solid var(--glass-border); border-radius: var(--radius-sm); margin-bottom: 0.75rem;">
                        <input type="checkbox" id="chk-permanent-member" style="width: 1.1rem; height: 1.1rem; accent-color: var(--primary); cursor: pointer;">
                        <span style="font-size: 0.88rem; line-height: 1.35;">
                            <strong>Miembro permanente</strong><br>
                            <span style="color: var(--text-muted); font-size: 0.78rem;">Se da de alta en la banda para futuras quedadas. Si no, solo participa en esta mesa.</span>
                        </span>
                    </label>
                    <button class="btn-secondary" onclick="App.confirmTableCustomFriend()" style="width: 100%;">Añadir nombre escrito</button>
                </div>
            `;

            this.openModal(html);
        } catch (error) {
            console.error('Error al cargar miembros:', error);
            alert('Error al conectar con la base de datos.');
        }
    },

    async toggleTableFriendDirect(name) {
        const idName = name.replace(/\s/g, '_').replace(/\./g, '_');
        const btn = document.getElementById(`tf-btn-${idName}`);
        const isSelected = this.state.tempSelectionFriends.includes(name);

        if (isSelected) {
            if (!confirm(`¿Seguro que quieres quitar a "${name}" de la mesa?`)) return;
            // Apagar y quitar de la mesa
            const idx = this.state.tempSelectionFriends.indexOf(name);
            this.state.tempSelectionFriends.splice(idx, 1);
            if (btn) btn.classList.remove('selected');
            await this.removeTableFriendSilent(name);
        } else {
            // Encender y añadir a la mesa
            this.state.tempSelectionFriends.push(name);
            if (btn) btn.classList.add('selected');
            await this.addFriendsToTable([name]);
        }

        // Actualizar el estado visual del switch Todos / Ninguno
        const total = (this.state.tempAvailableTableMembers || []).length;
        const count = this.state.tempSelectionFriends.length;
        const switchAll = document.getElementById('switch-table-friend-all');
        const switchNone = document.getElementById('switch-table-friend-none');
        if (switchAll) switchAll.classList.toggle('active', count === total && total > 0);
        if (switchNone) switchNone.classList.toggle('active', count === 0);
    },

    async setTableFriendsQuickFilter(filterType) {
        const boysList = ['Antonio', 'Caba', 'David', 'Jose', 'Edu', 'Pedro', 'Karlos', 'Fernando'].map(n => n.toLowerCase());
        const available = this.state.tempAvailableTableMembers || [];

        let targetNames = [];
        if (filterType === 'chicos') {
            targetNames = available.filter(name => boysList.includes(name.trim().toLowerCase()));
        } else if (filterType === 'chicas') {
            targetNames = available.filter(name => !boysList.includes(name.trim().toLowerCase()));
        } else if (filterType === 'todos') {
            targetNames = [...available];
        } else if (filterType === 'ninguno') {
            targetNames = [];
        }

        const prevSelection = this.state.tempSelectionFriends || [];
        const toAdd = targetNames.filter(name => !prevSelection.includes(name));
        const toRemove = prevSelection.filter(name => !targetNames.includes(name));

        if (toRemove.length > 0) {
            const namesText = toRemove.length === 1 ? `a "${toRemove[0]}"` : `a ${toRemove.length} amigos (${toRemove.join(', ')})`;
            if (!confirm(`¿Seguro que quieres quitar de la mesa ${namesText}?`)) {
                // Restaurar switch visual según la selección actual
                const total = available.length;
                const count = (this.state.tempSelectionFriends || []).length;
                const switchAll = document.getElementById('switch-table-friend-all');
                const switchNone = document.getElementById('switch-table-friend-none');
                if (switchAll) switchAll.classList.toggle('active', count === total && total > 0);
                if (switchNone) switchNone.classList.toggle('active', count === 0);
                return;
            }
        }

        this.state.tempSelectionFriends = [...targetNames];

        available.forEach(name => {
            const idName = name.replace(/\s/g, '_').replace(/\./g, '_');
            const btn = document.getElementById(`tf-btn-${idName}`);
            if (btn) {
                if (targetNames.includes(name)) {
                    btn.classList.add('selected');
                } else {
                    btn.classList.remove('selected');
                }
            }
        });

        // Actualizar el estado visual del switch Todos / Ninguno
        const total = available.length;
        const count = targetNames.length;
        const switchAll = document.getElementById('switch-table-friend-all');
        const switchNone = document.getElementById('switch-table-friend-none');
        if (switchAll) switchAll.classList.toggle('active', count === total && total > 0);
        if (switchNone) switchNone.classList.toggle('active', count === 0);

        if (toAdd.length > 0) {
            await this.addFriendsToTable(toAdd);
        }
        for (const name of toRemove) {
            await this.removeTableFriendSilent(name);
        }
    },

    async confirmTableBatchAddFriends() {
        this.closeModal();
    },

    async confirmTableCustomFriend() {
        const customNameInput = document.getElementById('custom-friend-name')?.value.trim();
        const permanent = document.getElementById('chk-permanent-member')?.checked ?? true;
        if (!customNameInput) return alert('Escribe un nombre para añadir.');

        this.state.tempNewFriendPermanent = permanent;
        await this.promptNewFriendCouple(customNameInput, [], false);
    },

    async removeTableFriendSilent(name) {
        try {
            const key = name.replace(/\./g, '_');
            const participantRef = ref(this.db, `tables/${this.state.tableId}/participants/${key}`);
            await set(participantRef, null);
        } catch (error) {
            console.error('Error al retirar amigo de la mesa silenciosamente:', error);
        }
    },

    toggleFriendSelection(name) {
        const idx = this.state.tempSelectionFriends.indexOf(name);
        const btn = document.getElementById(`f-btn-${name.replace(/\s/g, '_')}`);
        if (idx > -1) {
            this.state.tempSelectionFriends.splice(idx, 1);
            if (btn) btn.classList.remove('selected');
        } else {
            this.state.tempSelectionFriends.push(name);
            if (btn) btn.classList.add('selected');
        }
        
        const count = this.state.tempSelectionFriends.length;
        const confirmBtn = document.getElementById('btn-confirm-add-friends');
        if (confirmBtn) {
            const isParty = this.state.currentView === 'party-pot' || Boolean(this.state.partyId);
            confirmBtn.textContent = isParty ? `Añadir al bote (${count})` : `Añadir a la mesa (${count})`;
        }
    },

    async confirmAddFriends() {
        const customNameInput = document.getElementById('custom-friend-name')?.value.trim();
        const selected = [...(this.state.tempSelectionFriends || [])];
        const permanent = document.getElementById('chk-permanent-member')?.checked ?? true;
        
        if (customNameInput) {
            // Si se ha escrito un amigo nuevo, guardamos la opción de permanente y preguntamos si es pareja de alguien
            this.state.tempNewFriendPermanent = permanent;
            await this.promptNewFriendCouple(customNameInput, selected, false);
            return;
        }

        if (selected.length === 0) {
            return alert('Selecciona al menos a un miembro o escribe un nombre.');
        }

        this.closeModal();
        await this.addFriendsToTable(selected);
    },

    async promptNewFriendCouple(newFriendName, otherSelected = [], isParty = false) {
        try {
            const snapshot = await get(ref(this.db, 'members'));
            const members = snapshot.exists() ? Object.values(snapshot.val()) : [];
            const sortedMembers = members.sort((a, b) => a.name.localeCompare(b.name));
            const safeNewFriend = newFriendName.replace(/'/g, "\\'").replace(/"/g, '&quot;');
            const safeOtherSelected = JSON.stringify(otherSelected).replace(/"/g, '&quot;');

            // Filtrar solo las personas que NO tienen pareja actualmente (estén en la mesa o no)
            const availableCandidates = sortedMembers.filter(m => {
                if (this.normalizeKey(m.name) === this.normalizeKey(newFriendName)) return false;
                const partner = this.getPartner(m.name);
                return !partner; // Excluir a cualquiera que ya tenga pareja
            });

            let html = `
                <div style="text-align: center;">
                    <div style="font-size: 2.2rem; margin-bottom: 0.25rem;">💑</div>
                    <h3 style="margin-bottom: 0.5rem;">¿${newFriendName} es pareja de alguien?</h3>
                    <p class="subtitle" style="margin-bottom: 1.25rem; font-size: 0.88rem;">
                        Muchos somos matrimonios y uno paga lo del otro. Si es pareja de alguien, se acumularán sus consumos de ahora en adelante.
                    </p>

                    <div style="margin-bottom: 1.25rem;">
                        <button class="btn-primary" onclick="App.finalizeAddFriendWithCouple('${safeNewFriend}', '', ${safeOtherSelected}, ${isParty})" style="width: 100%; padding: 0.85rem; font-size: 0.95rem; background: rgba(255,255,255,0.1); border: 1px solid var(--glass-border);">
                            👤 No, viene solo/a (Sin pareja)
                        </button>
                    </div>
            `;

            if (availableCandidates.length > 0) {
                html += `
                    <p class="subtitle" style="font-size: 0.82rem; color: var(--text-muted); margin-bottom: 0.75rem;">
                        O selecciona a su pareja en la banda:
                    </p>
                    <div class="participant-grid" style="max-height: 35vh; overflow-y: auto;">
                `;

                availableCandidates.forEach(m => {
                    const safeName = m.name.replace(/'/g, "\\'").replace(/"/g, '&quot;');
                    const sizeClass = this.getNameLengthClass(m.name);
                    html += `
                        <button class="participant-btn ${sizeClass}" onclick="App.finalizeAddFriendWithCouple('${safeNewFriend}', '${safeName}', ${safeOtherSelected}, ${isParty})" style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 0.6rem 0.35rem; height: auto;">
                            <span style="font-weight: 700;">${m.name}</span>
                            <small style="font-size: 0.72rem; color: #22c55e;">(Sin pareja)</small>
                        </button>
                    `;
                });

                html += `</div>`;
            } else {
                html += `
                    <p class="empty-msg" style="font-size: 0.85rem; margin-top: 0.5rem; color: var(--text-muted);">
                        No hay miembros disponibles sin pareja en la banda.
                    </p>
                `;
            }

            html += `
                </div>
            `;

            this.openModal(html);
        } catch (e) {
            console.error(e);
            if (isParty) {
                for (const n of [newFriendName, ...otherSelected]) await this.addPartyFriendSilent(n);
                this.closeModal();
            } else {
                this.closeModal();
                await this.addFriendsToTable([newFriendName, ...otherSelected]);
            }
        }
    },

    async finalizeAddFriendWithCouple(newFriendName, partnerName, otherSelected = [], isParty = false) {
        // Leer si se quiere dar de alta permanente (guardado en state por confirmAddFriends/confirmPartyAddFriends)
        const permanent = this.state.tempNewFriendPermanent !== false;
        this.state.tempNewFriendPermanent = undefined; // limpiar

        try {
            // 1. Guardar pareja en Firebase si se seleccionó (solo si es permanente)
            if (partnerName && permanent) {
                await this.setCouple(newFriendName, partnerName);
            }
            
            // 2. Registrar el nuevo amigo en members solo si es miembro permanente
            if (permanent) {
                const key = this.normalizeKey(newFriendName);
                const memberSnap = await get(ref(this.db, `members/${key}`));
                if (!memberSnap.exists()) {
                    await set(ref(this.db, `members/${key}`), {
                        name: newFriendName,
                        code: `${newFriendName}_Thermobanda`
                    });
                }
            }

            // 3. Preparar lista de amigos a añadir
            const toAdd = [newFriendName, ...otherSelected];

            if (isParty) {
                if (partnerName) {
                    const isPartnerInParty = Object.values(this.state.partyData?.participants || {})
                        .some(p => this.normalizeKey(p.name) === this.normalizeKey(partnerName));
                    if (!isPartnerInParty && !toAdd.some(n => this.normalizeKey(n) === this.normalizeKey(partnerName))) {
                        if (confirm(`¿Quieres añadir también a su pareja ${partnerName} al bote ahora?`)) {
                            toAdd.push(partnerName);
                        }
                    }
                }
                this.closeModal();
                for (const name of toAdd) {
                    await this.addPartyFriendSilent(name);
                }
            } else {
                if (partnerName) {
                    const isPartnerInTable = Object.values(this.state.tableData?.participants || {})
                        .some(p => p.status === 'active' && this.normalizeKey(p.name) === this.normalizeKey(partnerName));
                    if (!isPartnerInTable && !toAdd.some(n => this.normalizeKey(n) === this.normalizeKey(partnerName))) {
                        if (confirm(`¿Quieres añadir también a su pareja ${partnerName} a la mesa ahora?`)) {
                            toAdd.push(partnerName);
                        }
                    }
                }
                this.closeModal();
                await this.addFriendsToTable(toAdd);
            }
        } catch (error) {
            console.error('Error al finalizar alta con pareja:', error);
            this.closeModal();
            if (isParty) {
                for (const n of [newFriendName, ...otherSelected]) await this.addPartyFriendSilent(n);
            } else {
                await this.addFriendsToTable([newFriendName, ...otherSelected]);
            }
        }
    },

    async addFriendsToTable(names) {
        try {
            for (const name of names) {
                const participantRef = ref(this.db, `tables/${this.state.tableId}/participants/${name.replace(/\./g, '_')}`);
                await set(participantRef, { name, role: 'member', status: 'active', joinedAt: Date.now() });
            }
        } catch (error) {
            console.error('Error al añadir amigos a la mesa:', error);
        }
    },

    async handleCreatePartyFromSetup() {
        const userName = document.getElementById('user-name-party').value.trim();
        const partyName = document.getElementById('party-name-input').value.trim();
        if (!userName || !partyName) return alert('Rellena todos los campos');

        this.state.user = userName;
        localStorage.setItem('thermo_user', userName);

        // El código es el propio nombre (en mayúsculas y sin espacios)
        const partyId = partyName.toUpperCase().replace(/\s+/g, '');
        const partyRef = ref(this.db, `party_pots/${partyId}`);
        
        await set(partyRef, {
            name: partyName,
            createdAt: Date.now(),
            createdBy: userName,
            totalCollected: 0,
            totalSpent: 0,
            custodian: userName,
            participants: {
                [userName.replace(/\./g, '_')]: { name: userName, joinedAt: Date.now() }
            },
            history: {}
        });

        this.state.partyId = partyId;
        localStorage.setItem('thermo_partyId', partyId);
        this.listenToParty(partyId);
        this.showView('party-pot');
        await this.addLog('create_party', { partyId, partyName });
    },

    async handleJoinPartyFromSetup() {
        const userName = document.getElementById('user-name-party').value.trim();
        if (!userName) return alert('Dinos tu nombre primero');
        
        try {
            const partiesRef = ref(this.db, 'party_pots');
            const snapshot = await get(partiesRef);
            let activeParties = [];
            
            if (snapshot.exists()) {
                const allParties = snapshot.val();
                for (const [code, data] of Object.entries(allParties)) {
                    if (data.status !== 'finished') {
                        activeParties.push({ code, name: data.name, createdAt: data.createdAt });
                    }
                }
            }

            if (activeParties.length === 0) {
                alert('No hay botes de fiesta abiertos en este momento.');
                return;
            }

            activeParties.sort((a, b) => b.createdAt - a.createdAt);

            let html = `<h3>Botes Abiertos</h3><div class="list-container" style="display:flex; flex-direction:column; gap:0.5rem; margin-top:1rem;">`;
            activeParties.forEach(p => {
                html += `<button class="btn-secondary" onclick="App.joinSpecificParty('${p.code}')">${p.name}</button>`;
            });
            html += `</div>`;
            this.openModal(html);

        } catch (error) {
            console.error('Error al obtener fiestas:', error);
        }
    },

    async joinSpecificParty(code) {
        this.closeModal();
        const userName = document.getElementById('user-name-party').value.trim();
        
        this.state.user = userName;
        localStorage.setItem('thermo_user', userName);

        const partyRef = ref(this.db, `party_pots/${code}`);
        const snapshot = await get(partyRef);
        
        if (snapshot.exists()) {
            this.state.partyId = code;
            localStorage.setItem('thermo_partyId', code);
            this.listenToParty(code);
            this.showView('party-pot');
        }
    },

    listenToParty(partyId) {
        const partyRef = ref(this.db, `party_pots/${partyId}`);
        onValue(partyRef, (snapshot) => {
            const data = snapshot.val();
            if (data) {
                if (data.status === 'finished' && this.state.partyId) {
                    this.state.partyId = null;
                    localStorage.removeItem('thermo_partyId');
                    this.showPartyBorrachuzoModal(data);
                    return;
                }
                this.state.partyData = data;
                this.updatePartyUI();
                document.getElementById('party-pot-setup').classList.add('hidden');
                document.getElementById('party-pot-active').classList.remove('hidden');
            }
        });
    },

    updatePartyUI() {
        const data = this.state.partyData || {};
        const balances = this.calculatePartyBalances();
        
        const codeBadge = document.getElementById('party-code-badge');
        if (codeBadge) codeBadge.textContent = `CÓDIGO: ${this.state.partyId}`;
        
        const totalSpentEl = document.getElementById('party-total-spent');
        if (totalSpentEl) totalSpentEl.textContent = this.formatEuro(balances.totalSpent || 0);

        const totalRoundsEl = document.getElementById('party-total-rounds-count');
        if (totalRoundsEl) totalRoundsEl.textContent = balances.roundCount || 0;

        // Balance del usuario actual o de su pareja
        const myBalanceEl = document.getElementById('party-my-balance');
        const myBalanceLabelEl = document.getElementById('party-my-balance-label');
        if (myBalanceEl && myBalanceLabelEl) {
            const myUnit = balances.units.find(u => u.names.includes(this.state.user));
            if (myUnit) {
                const net = myUnit.net;
                if (net > 0.01) {
                    myBalanceEl.textContent = `+${this.formatEuro(net)}`;
                    myBalanceEl.style.color = '#4ade80';
                    myBalanceLabelEl.textContent = 'Te deben';
                } else if (net < -0.01) {
                    myBalanceEl.textContent = `-${this.formatEuro(Math.abs(net))}`;
                    myBalanceEl.style.color = '#f87171';
                    myBalanceLabelEl.textContent = 'Debes pagar';
                } else {
                    myBalanceEl.textContent = '0,00€';
                    myBalanceEl.style.color = 'var(--text-muted)';
                    myBalanceLabelEl.textContent = 'En paz';
                }
            } else {
                myBalanceEl.textContent = '0,00€';
                myBalanceEl.style.color = 'var(--text-muted)';
                myBalanceLabelEl.textContent = 'Mi Balance';
            }
        }

        // 1. Lista de Participantes y Balances
        const friendsContainer = document.getElementById('party-participants-list');
        if (friendsContainer) {
            friendsContainer.innerHTML = '';
            
            balances.units.forEach(u => {
                const div = document.createElement('div');
                const hasLeft = u.hasLeft;
                div.className = `participant-item glass ${u.isCouple ? 'is-couple' : ''} ${hasLeft ? 'is-left' : ''}`;
                div.style.cursor = 'pointer';
                div.onclick = () => {
                    if (u.isCouple) {
                        this.showPartyCoupleOptions(u.p1, u.p2);
                    } else {
                        this.showPartyParticipantOptions(u.p1);
                    }
                };

                let netBadge = '';
                if (u.net > 0.01) {
                    netBadge = `<div class="p-amount" style="color: #4ade80; font-weight: 700; font-size: 1.05rem;">+${this.formatEuro(u.net)}</div><small style="font-size: 0.7rem; color: #4ade80; display: block;">le deben</small>`;
                } else if (u.net < -0.01) {
                    netBadge = `<div class="p-amount" style="color: #f87171; font-weight: 700; font-size: 1.05rem;">-${this.formatEuro(Math.abs(u.net))}</div><small style="font-size: 0.7rem; color: #f87171; display: block;">debe pagar</small>`;
                } else {
                    netBadge = `<div class="p-amount" style="color: var(--text-muted); font-weight: 700; font-size: 1.05rem;">0,00€</div><small style="font-size: 0.7rem; color: var(--text-muted); display: block;">en paz</small>`;
                }

                let subtitle = '';
                const uPaidSettlement = (balances.settlementPaid?.[u.p1] || 0) + (u.isCouple ? (balances.settlementPaid?.[u.p2] || 0) : 0);
                const uReceivedSettlement = (balances.settlementReceived?.[u.p1] || 0) + (u.isCouple ? (balances.settlementReceived?.[u.p2] || 0) : 0);

                if (u.isCouple) {
                    subtitle = `Pagaron: <b>${this.formatEuro(u.paid)}</b> | Consumieron: <b>${this.formatEuro(u.spent)}</b>`;
                    if (uPaidSettlement > 0) subtitle += ` | Reembolsado: <b>+${this.formatEuro(uPaidSettlement)}</b>`;
                    if (uReceivedSettlement > 0) subtitle += ` | Cobrado: <b>-${this.formatEuro(uReceivedSettlement)}</b>`;
                    if (u.oneLeft) {
                        subtitle += `<br><span style="color:#f87171; font-size: 0.7rem;">(${u.leftName} fuera)</span>`;
                    }
                } else {
                    subtitle = `Pagó: <b>${this.formatEuro(u.paid)}</b> | Consumió: <b>${this.formatEuro(u.spent)}</b>`;
                    if (uPaidSettlement > 0) subtitle += ` | Reembolsado: <b>+${this.formatEuro(uPaidSettlement)}</b>`;
                    if (uReceivedSettlement > 0) subtitle += ` | Cobrado: <b>-${this.formatEuro(uReceivedSettlement)}</b>`;
                }

                div.innerHTML = `
                    <div class="p-info" style="display: flex; flex-direction: column; align-items: flex-start; gap: 0.2rem; min-width: 0; flex: 1;">
                        <span class="p-name" style="display: flex; align-items: center; gap: 0.35rem; flex-wrap: wrap;">
                            ${u.displayName}
                            ${u.isCouple ? '<span class="badge-couple">💑 Pareja</span>' : ''}
                            ${hasLeft ? '<small style="color: #f87171;">(Fuera) 🚶</small>' : ''}
                        </span>
                        <small style="font-size: 0.75rem; color: var(--text-muted); line-height: 1.3;">
                            ${subtitle}
                        </small>
                    </div>
                    <div style="text-align: right; flex-shrink: 0; margin-left: 0.5rem;">
                        ${netBadge}
                    </div>
                `;
                friendsContainer.appendChild(div);
            });

            if (balances.units.length === 0) {
                friendsContainer.innerHTML = '<div class="empty-msg">Pulsa en "➕ Añadir Amigo" para empezar la lista</div>';
            }
        }

        // 2. Historial de Gastos y Rondas
        const historyContainer = document.getElementById('party-history');
        if (historyContainer) {
            historyContainer.innerHTML = '';
            
            if (data.history) {
                Object.entries(data.history).sort((a,b) => b[1].timestamp - a[1].timestamp).forEach(([id, item]) => {
                    const div = document.createElement('div');
                    div.className = `history-item ${item.type}`;
                    const isExpense = item.type === 'expense';
                    const isIncome = item.type === 'income';
                    const isSystem = item.type === 'system';
                    const isSettlement = item.type === 'settlement';

                    if (isSystem) {
                        div.innerHTML = `
                            <div class="info" style="text-align: center; width: 100%;">
                                <span>${item.description}</span>
                                <small style="display: block; font-size: 0.72rem; color: var(--text-muted); margin-top: 0.15rem;">${new Date(item.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</small>
                            </div>
                        `;
                    } else if (isSettlement) {
                        const timeStr = new Date(item.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
                        div.innerHTML = `
                            <div class="info" style="flex: 1; min-width: 0; padding-right: 0.5rem;">
                                <b style="font-size: 0.95rem; color: #34d399;">🤝 Reembolso Pagado</b><br>
                                <span style="font-size: 0.85rem; color: var(--text-main);">${item.from} ➔ ${item.to}</span>
                                <small style="font-size: 0.75rem; color: var(--text-muted); line-height: 1.35; display: block; margin-top: 0.15rem;">
                                    Anotado por <b style="color: var(--primary-light);">${item.user || 'Desconocido'}</b> (${timeStr})
                                </small>
                            </div>
                            <div style="display: flex; align-items: center; gap: 0.4rem; flex-shrink: 0;">
                                <span class="amount" style="color: #34d399; font-size: 1rem; font-weight: 700;">
                                    ${this.formatEuro(item.amount)}
                                </span>
                                <button class="btn-icon-small" title="Anular reembolso" onclick="App.handlePartyDeleteSettlement('${id}')" style="padding: 0.2rem 0.35rem; font-size: 0.85rem; border-radius: var(--radius-sm); background: rgba(239,68,68,0.15); border: 1px solid rgba(239,68,68,0.3); color: #f87171;">🗑️</button>
                            </div>
                        `;
                    } else {
                        const payer = item.payer || item.user || 'Desconocido';
                        const splitCount = Array.isArray(item.beneficiaries) && item.beneficiaries.length > 0 ? item.beneficiaries.length : null;
                        const splitText = splitCount ? ` · Dividido entre ${splitCount} pers.` : '';
                        const timeStr = new Date(item.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});

                        div.innerHTML = `
                            <div class="info" style="flex: 1; min-width: 0; padding-right: 0.5rem;">
                                <b style="font-size: 0.95rem;">${item.description || 'Gasto'}</b><br>
                                <small style="font-size: 0.75rem; color: var(--text-muted); line-height: 1.35; display: block; margin-top: 0.15rem;">
                                    Pagó: <b style="color: var(--primary-light);">${payer}</b>${splitText} (${timeStr})
                                </small>
                            </div>
                            <div style="display: flex; align-items: center; gap: 0.4rem; flex-shrink: 0;">
                                <span class="amount" style="color: ${isExpense ? 'var(--danger)' : 'var(--success)'}; font-size: 1rem;">
                                    ${isExpense ? '-' : '+'}${this.formatEuro(item.amount)}
                                </span>
                                ${isExpense ? `
                                    <button class="btn-icon-small" title="Editar gasto" onclick="App.handlePartyEditExpense('${id}')" style="padding: 0.2rem 0.35rem; font-size: 0.85rem; border-radius: var(--radius-sm); background: rgba(255,255,255,0.06); border: 1px solid var(--glass-border);">✏️</button>
                                    <button class="btn-icon-small" title="Borrar gasto" onclick="App.handlePartyDeleteExpense('${id}')" style="padding: 0.2rem 0.35rem; font-size: 0.85rem; border-radius: var(--radius-sm); background: rgba(239,68,68,0.15); border: 1px solid rgba(239,68,68,0.3); color: #f87171;">🗑️</button>
                                ` : ''}
                                ${isIncome ? `
                                    <button class="btn-icon-small" title="Borrar aporte" onclick="App.handlePartyDeleteIncome('${id}')" style="padding: 0.2rem 0.35rem; font-size: 0.85rem; border-radius: var(--radius-sm); background: rgba(239,68,68,0.15); border: 1px solid rgba(239,68,68,0.3); color: #f87171;">🗑️</button>
                                ` : ''}
                            </div>
                        `;
                    }
                    historyContainer.appendChild(div);
                });
            }
        }
    },

    showPartyParticipantOptions(name) {
        const partnerInParty = this.isPartnerInParty(name);
        if (partnerInParty) {
            return this.showPartyCoupleOptions(name, partnerInParty);
        }
        const balances = this.calculatePartyBalances();
        const paid = balances.paid[name] || 0;
        const spent = balances.spent[name] || 0;
        const sPaid = balances.settlementPaid?.[name] || 0;
        const sReceived = balances.settlementReceived?.[name] || 0;
        const net = balances.netBalances?.[name] !== undefined ? balances.netBalances[name] : ((paid - spent) + sPaid - sReceived);
        const pData = this.state.partyData?.participants?.[name.replace(/\./g, '_')];
        const hasLeft = pData?.status === 'left';

        let netText = '';
        if (net > 0.01) {
            netText = `<span style="color: #4ade80; font-weight: 700;">+${this.formatEuro(net)} (Le deben)</span>`;
        } else if (net < -0.01) {
            netText = `<span style="color: #f87171; font-weight: 700;">-${this.formatEuro(Math.abs(net))} (Debe pagar)</span>`;
        } else {
            netText = `<span style="color: var(--text-muted); font-weight: 700;">0,00€ (En paz)</span>`;
        }

        let html = `<h3>👤 ${name} ${hasLeft ? '<small style="color:#f87171;">(Fuera)</small>' : ''}</h3>`;
        html += `
            <div style="background: rgba(255,255,255,0.04); border-radius: 10px; padding: 0.85rem; margin: 1rem 0; font-size: 0.9rem;">
                <div style="display:flex; justify-content:space-between; margin-bottom: 0.35rem;">
                    <span style="color: var(--text-muted);">Total pagado:</span>
                    <b>${this.formatEuro(paid)}</b>
                </div>
                <div style="display:flex; justify-content:space-between; margin-bottom: 0.35rem;">
                    <span style="color: var(--text-muted);">Total consumido:</span>
                    <b>${this.formatEuro(spent)}</b>
                </div>
                ${sPaid > 0 ? `
                <div style="display:flex; justify-content:space-between; margin-bottom: 0.35rem; color: #34d399;">
                    <span>Reembolsos pagados:</span>
                    <b>+${this.formatEuro(sPaid)}</b>
                </div>` : ''}
                ${sReceived > 0 ? `
                <div style="display:flex; justify-content:space-between; margin-bottom: 0.35rem; color: #60a5fa;">
                    <span>Reembolsos cobrados:</span>
                    <b>-${this.formatEuro(sReceived)}</b>
                </div>` : ''}
                <div style="display:flex; justify-content:space-between; border-top: 1px dashed var(--glass-border); padding-top: 0.35rem;">
                    <span style="color: var(--text-muted);">Balance neto:</span>
                    ${netText}
                </div>
            </div>
            <div style="display: flex; flex-direction: column; gap: 0.75rem;">
        `;

        if (!hasLeft) {
            html += `<button type="button" class="btn-leave-home" onclick="App.closeModal(); App.markParticipantAsLeft('${name}')">🚪 Marcar que se ha ido a casa</button>`;
        } else {
            html += `<button type="button" class="btn-secondary" style="min-height: 48px; padding: 0.85rem; font-size: 0.95rem; font-weight: 600;" onclick="App.closeModal(); App.markParticipantAsActive('${name}')">🔄 Volver a marcar como presente</button>`;
        }
        html += `<button type="button" class="btn-secondary" style="min-height: 44px; padding: 0.75rem;" onclick="App.closeModal()">Cerrar</button>`;
        html += `</div>`;
        this.openModal(html);
    },

    showPartyCoupleOptions(name1, name2) {
        const balances = this.calculatePartyBalances();
        const p1Data = this.state.partyData?.participants?.[name1.replace(/\./g, '_')];
        const p2Data = this.state.partyData?.participants?.[name2.replace(/\./g, '_')];
        const isLeft1 = p1Data?.status === 'left';
        const isLeft2 = p2Data?.status === 'left';

        const p1Paid = balances.paid[name1] || 0;
        const p2Paid = balances.paid[name2] || 0;
        const p1Spent = balances.spent[name1] || 0;
        const p2Spent = balances.spent[name2] || 0;

        const totalPaid = p1Paid + p2Paid;
        const totalSpent = p1Spent + p2Spent;
        const unit = balances.units.find(u => u.names.includes(name1));
        const net = unit ? unit.net : (totalPaid - totalSpent);
        const sPaid = unit ? unit.settlementPaid : ((balances.settlementPaid?.[name1] || 0) + (balances.settlementPaid?.[name2] || 0));
        const sReceived = unit ? unit.settlementReceived : ((balances.settlementReceived?.[name1] || 0) + (balances.settlementReceived?.[name2] || 0));

        let netText = '';
        if (net > 0.01) {
            netText = `<span style="color: #4ade80; font-weight: 700;">+${this.formatEuro(net)} (Les deben)</span>`;
        } else if (net < -0.01) {
            netText = `<span style="color: #f87171; font-weight: 700;">-${this.formatEuro(Math.abs(net))} (Deben pagar)</span>`;
        } else {
            netText = `<span style="color: var(--text-muted); font-weight: 700;">0,00€ (En paz)</span>`;
        }

        let html = `<h3>💑 Pareja: ${name1} y ${name2}</h3>`;
        html += `
            <div style="background: rgba(255,255,255,0.04); border-radius: 10px; padding: 0.85rem; margin: 1rem 0; font-size: 0.9rem;">
                <div style="display:flex; justify-content:space-between; margin-bottom: 0.35rem;">
                    <span style="color: var(--text-muted);">Pagado conjunto:</span>
                    <b>${this.formatEuro(totalPaid)}</b>
                </div>
                <div style="display:flex; justify-content:space-between; margin-bottom: 0.35rem; font-size: 0.78rem; color: var(--text-muted); padding-left: 0.5rem;">
                    <span>↳ ${name1}: ${this.formatEuro(p1Paid)} | ${name2}: ${this.formatEuro(p2Paid)}</span>
                </div>
                <div style="display:flex; justify-content:space-between; margin-bottom: 0.35rem;">
                    <span style="color: var(--text-muted);">Consumido conjunto:</span>
                    <b>${this.formatEuro(totalSpent)}</b>
                </div>
                <div style="display:flex; justify-content:space-between; margin-bottom: 0.35rem; font-size: 0.78rem; color: var(--text-muted); padding-left: 0.5rem;">
                    <span>↳ ${name1}: ${this.formatEuro(p1Spent)} | ${name2}: ${this.formatEuro(p2Spent)}</span>
                </div>
                ${sPaid > 0 ? `
                <div style="display:flex; justify-content:space-between; margin-bottom: 0.35rem; color: #34d399;">
                    <span>Reembolsos pagados:</span>
                    <b>+${this.formatEuro(sPaid)}</b>
                </div>` : ''}
                ${sReceived > 0 ? `
                <div style="display:flex; justify-content:space-between; margin-bottom: 0.35rem; color: #60a5fa;">
                    <span>Reembolsos cobrados:</span>
                    <b>-${this.formatEuro(sReceived)}</b>
                </div>` : ''}
                <div style="display:flex; justify-content:space-between; border-top: 1px dashed var(--glass-border); padding-top: 0.35rem;">
                    <span style="color: var(--text-muted);">Balance conjunto:</span>
                    ${netText}
                </div>
            </div>
            <div style="display: flex; flex-direction: column; gap: 0.75rem;">
        `;

        if (!isLeft1 && !isLeft2) {
            // Ambos presentes
            html += `<button type="button" class="btn-leave-home" onclick="App.closeModal(); App.markParticipantAsLeft('${name1}')">🚪 Se va solo/a ${name1}</button>`;
            html += `<button type="button" class="btn-leave-home" onclick="App.closeModal(); App.markParticipantAsLeft('${name2}')">🚪 Se va solo/a ${name2}</button>`;
            html += `<button type="button" class="btn-leave-home primary-danger" onclick="App.closeModal(); App.markCoupleAsLeft('${name1}', '${name2}')">🚪🚪 Se van ambos a casa</button>`;
        } else if (isLeft1 && isLeft2) {
            // Ambos fuera
            html += `<p style="color:#ef4444; text-align:center; font-size:0.9rem; font-weight:600;">Ambos se han retirado de la fiesta.</p>`;
            html += `<button type="button" class="btn-secondary" style="min-height: 48px; padding: 0.85rem; font-size: 0.95rem; font-weight: 600;" onclick="App.closeModal(); App.markCoupleAsActive('${name1}', '${name2}')">🔄 Marcar a ambos de vuelta</button>`;
        } else {
            // Uno presente, uno fuera
            const activeName = isLeft1 ? name2 : name1;
            const leftName = isLeft1 ? name1 : name2;
            html += `<p style="color:#ef4444; font-size:0.9rem; text-align:center; font-weight:600;">${leftName} ya se fue a casa. ${activeName} sigue en la fiesta.</p>`;
            html += `<button type="button" class="btn-leave-home" onclick="App.closeModal(); App.markParticipantAsLeft('${activeName}')">🚪 ${activeName} también se va a casa</button>`;
            html += `<button type="button" class="btn-secondary" style="min-height: 48px; padding: 0.85rem; font-size: 0.95rem; font-weight: 600;" onclick="App.closeModal(); App.markParticipantAsActive('${leftName}')">🔄 ${leftName} vuelve a estar presente</button>`;
        }

        html += `<button type="button" class="btn-secondary" style="min-height: 44px; padding: 0.75rem;" onclick="App.closeModal()">Cerrar</button>`;
        html += `</div>`;
        this.openModal(html);
    },

    async markCoupleAsLeft(name1, name2) {
        if (!confirm(`¿Seguro que quieres marcar a ${name1} y ${name2} como que se han ido?`)) return;
        try {
            const key1 = name1.replace(/\./g, '_');
            const key2 = name2.replace(/\./g, '_');
            const currentData1 = this.state.partyData?.participants?.[key1] || {};
            const currentData2 = this.state.partyData?.participants?.[key2] || {};
            await set(ref(this.db, `party_pots/${this.state.partyId}/participants/${key1}`), {
                ...currentData1, name: name1, status: 'left', leftAt: Date.now()
            });
            await set(ref(this.db, `party_pots/${this.state.partyId}/participants/${key2}`), {
                ...currentData2, name: name2, status: 'left', leftAt: Date.now()
            });

            const historyRef = push(ref(this.db, `party_pots/${this.state.partyId}/history`));
            await set(historyRef, {
                type: 'system',
                amount: 0,
                description: `🚶 ${name1} y ${name2} se fueron a casa`,
                user: this.state.user,
                timestamp: Date.now()
            });

            this.showPartyRefundModal(name1);
        } catch (error) { console.error('Error marcando pareja como ida:', error); }
    },

    async markParticipantAsLeft(name) {
        if (!confirm(`¿Seguro que quieres marcar a ${name} como que se ha ido?`)) return;
        try {
            const key = name.replace(/\./g, '_');
            const participantRef = ref(this.db, `party_pots/${this.state.partyId}/participants/${key}`);
            const currentData = this.state.partyData?.participants?.[key] || {};
            await set(participantRef, { ...currentData, name, status: 'left', leftAt: Date.now() });
            
            const historyRef = push(ref(this.db, `party_pots/${this.state.partyId}/history`));
            await set(historyRef, {
                type: 'system',
                amount: 0,
                description: `🚶 ${name} se fue a casa`,
                user: this.state.user,
                timestamp: Date.now()
            });

            this.showPartyRefundModal(name);
        } catch (error) { console.error('Error marcando como ido:', error); }
    },

    async markParticipantAsActive(name) {
        if (!confirm(`¿Volver a marcar a ${name} como presente en la fiesta?`)) return;
        try {
            const key = name.replace(/\./g, '_');
            const participantRef = ref(this.db, `party_pots/${this.state.partyId}/participants/${key}`);
            const currentData = this.state.partyData?.participants?.[key] || {};
            await set(participantRef, { ...currentData, name, status: 'active', leftAt: null });

            const historyRef = push(ref(this.db, `party_pots/${this.state.partyId}/history`));
            await set(historyRef, {
                type: 'system',
                amount: 0,
                description: `👋 ${name} se volvió a unir a la fiesta`,
                user: this.state.user,
                timestamp: Date.now()
            });
        } catch (error) { console.error('Error reactivando participante:', error); }
    },

    async markCoupleAsActive(name1, name2) {
        if (!confirm(`¿Volver a marcar a ${name1} y ${name2} como presentes en la fiesta?`)) return;
        try {
            const key1 = name1.replace(/\./g, '_');
            const key2 = name2.replace(/\./g, '_');
            const currentData1 = this.state.partyData?.participants?.[key1] || {};
            const currentData2 = this.state.partyData?.participants?.[key2] || {};
            await set(ref(this.db, `party_pots/${this.state.partyId}/participants/${key1}`), {
                ...currentData1, name: name1, status: 'active', leftAt: null
            });
            await set(ref(this.db, `party_pots/${this.state.partyId}/participants/${key2}`), {
                ...currentData2, name: name2, status: 'active', leftAt: null
            });

            const historyRef = push(ref(this.db, `party_pots/${this.state.partyId}/history`));
            await set(historyRef, {
                type: 'system',
                amount: 0,
                description: `👋 ${name1} y ${name2} se volvieron a unir a la fiesta`,
                user: this.state.user,
                timestamp: Date.now()
            });
        } catch (error) { console.error('Error reactivando pareja:', error); }
    },

    calculatePartyBalances() {
        const data = this.state.partyData || {};
        const allParticipants = data.participants ? Object.values(data.participants) : [];
        const participantNames = allParticipants.map(p => p.name);

        const paid = {};
        const spent = {};
        const settlementPaid = {};
        const settlementReceived = {};
        const settlements = [];

        participantNames.forEach(n => {
            paid[n] = 0;
            spent[n] = 0;
            settlementPaid[n] = 0;
            settlementReceived[n] = 0;
        });

        let totalSpent = 0;
        let roundCount = 0;

        if (data.history) {
            Object.entries(data.history).forEach(([histId, item]) => {
                if (item.type === 'expense') {
                    const amount = Number(item.amount || 0);
                    totalSpent += amount;
                    roundCount++;

                    // Quién lo ha pagado
                    const payer = item.payer || item.user || (participantNames[0] || 'Desconocido');
                    if (paid[payer] === undefined) paid[payer] = 0;
                    paid[payer] += amount;

                    // Entre quiénes se divide
                    let targets = Array.isArray(item.beneficiaries) && item.beneficiaries.length > 0
                        ? item.beneficiaries
                        : participantNames;

                    if (targets.length === 0 && participantNames.length > 0) {
                        targets = participantNames;
                    }

                    if (targets.length > 0) {
                        const split = amount / targets.length;
                        targets.forEach(target => {
                            if (spent[target] === undefined) spent[target] = 0;
                            spent[target] += split;
                        });
                    }
                } else if (item.type === 'income') {
                    // Soporte retrocompatible si una fiesta anterior tenía ingresos registrados
                    const amount = Number(item.amount || 0);
                    const name = item.description?.replace('Aporte de ', '').trim() || item.user;
                    if (name) {
                        if (paid[name] === undefined) paid[name] = 0;
                        paid[name] += amount;
                    }
                } else if (item.type === 'settlement') {
                    const amount = Number(item.amount || 0);
                    settlements.push({ id: histId, ...item, amount });

                    // Atribuir pagos de reembolsos a participantes individuales
                    const fromList = Array.isArray(item.fromNames) && item.fromNames.length > 0
                        ? item.fromNames
                        : (participantNames.includes(item.from) ? [item.from] : (item.from ? item.from.split(' y ').map(s => s.trim()) : []));
                    
                    const toList = Array.isArray(item.toNames) && item.toNames.length > 0
                        ? item.toNames
                        : (participantNames.includes(item.to) ? [item.to] : (item.to ? item.to.split(' y ').map(s => s.trim()) : []));

                    if (fromList.length > 0) {
                        const fromSplit = amount / fromList.length;
                        fromList.forEach(name => {
                            if (settlementPaid[name] === undefined) settlementPaid[name] = 0;
                            settlementPaid[name] += fromSplit;
                        });
                    }

                    if (toList.length > 0) {
                        const toSplit = amount / toList.length;
                        toList.forEach(name => {
                            if (settlementReceived[name] === undefined) settlementReceived[name] = 0;
                            settlementReceived[name] += toSplit;
                        });
                    }
                }
            });
        }

        // Agrupar en unidades financieras (parejas en fiesta e individuales)
        const processedKeys = new Set();
        const units = [];

        allParticipants.forEach(p => {
            const pKey = this.normalizeKey(p.name);
            if (processedKeys.has(pKey)) return;

            const partnerName = this.getPartner(p.name);
            const partnerObj = partnerName
                ? allParticipants.find(x => this.normalizeKey(x.name) === this.normalizeKey(partnerName))
                : null;

            if (partnerObj) {
                // Ambos miembros de la pareja están en la fiesta
                processedKeys.add(pKey);
                processedKeys.add(this.normalizeKey(partnerName));

                const p1 = p.name;
                const p2 = partnerObj.name;
                const p1Paid = paid[p1] || 0;
                const p2Paid = paid[p2] || 0;
                const p1Spent = spent[p1] || 0;
                const p2Spent = spent[p2] || 0;

                const p1SettlementPaid = settlementPaid[p1] || 0;
                const p2SettlementPaid = settlementPaid[p2] || 0;
                const p1SettlementReceived = settlementReceived[p1] || 0;
                const p2SettlementReceived = settlementReceived[p2] || 0;

                const unitPaid = p1Paid + p2Paid;
                const unitSpent = p1Spent + p2Spent;
                const unitSettlementPaid = p1SettlementPaid + p2SettlementPaid;
                const unitSettlementReceived = p1SettlementReceived + p2SettlementReceived;
                const unitNet = (unitPaid - unitSpent) + unitSettlementPaid - unitSettlementReceived;

                const p1Left = p.status === 'left';
                const p2Left = partnerObj.status === 'left';
                const bothLeft = p1Left && p2Left;
                const oneLeft = (p1Left && !p2Left) || (!p1Left && p2Left);
                const activeName = p1Left ? p2 : p1;
                const leftName = p1Left ? p1 : p2;

                units.push({
                    unitId: `${p1}_${p2}`.replace(/\s/g, '_'),
                    displayName: oneLeft ? `${activeName} y ${leftName}` : `${p1} y ${p2}`,
                    shortName: oneLeft ? activeName : `${p1} y ${p2}`,
                    isCouple: true,
                    names: [p1, p2],
                    activeNames: bothLeft ? [] : (oneLeft ? [activeName] : [p1, p2]),
                    leftNames: bothLeft ? [p1, p2] : (oneLeft ? [leftName] : []),
                    hasLeft: bothLeft,
                    oneLeft: oneLeft,
                    activeName: oneLeft ? activeName : null,
                    leftName: oneLeft ? leftName : null,
                    p1,
                    p2,
                    p1Paid,
                    p2Paid,
                    p1Spent,
                    p2Spent,
                    settlementPaid: unitSettlementPaid,
                    settlementReceived: unitSettlementReceived,
                    paid: unitPaid,
                    spent: unitSpent,
                    net: unitNet
                });
            } else {
                // Individual (sin pareja en la fiesta)
                processedKeys.add(pKey);
                const pPaid = paid[p.name] || 0;
                const pSpent = spent[p.name] || 0;
                const pSettlementPaid = settlementPaid[p.name] || 0;
                const pSettlementReceived = settlementReceived[p.name] || 0;
                const pNet = (pPaid - pSpent) + pSettlementPaid - pSettlementReceived;
                const hasLeft = p.status === 'left';

                units.push({
                    unitId: p.name.replace(/\s/g, '_'),
                    displayName: p.name,
                    shortName: p.name,
                    isCouple: false,
                    names: [p.name],
                    activeNames: hasLeft ? [] : [p.name],
                    leftNames: hasLeft ? [p.name] : [],
                    hasLeft: hasLeft,
                    oneLeft: false,
                    activeName: hasLeft ? null : p.name,
                    leftName: hasLeft ? p.name : null,
                    p1: p.name,
                    p2: null,
                    p1Paid: pPaid,
                    p2Paid: 0,
                    p1Spent: pSpent,
                    p2Spent: 0,
                    settlementPaid: pSettlementPaid,
                    settlementReceived: pSettlementReceived,
                    paid: pPaid,
                    spent: pSpent,
                    net: pNet
                });
            }
        });

        // Cálculo de liquidación óptima por Bizum entre unidades
        const debts = [];
        const debtors = [];
        const creditors = [];

        units.forEach(u => {
            if (u.net < -0.01) {
                debtors.push({ name: u.shortName || u.displayName, amount: Math.abs(u.net), unit: u });
            } else if (u.net > 0.01) {
                creditors.push({ name: u.shortName || u.displayName, amount: u.net, unit: u });
            }
        });

        debtors.sort((a, b) => b.amount - a.amount);
        creditors.sort((a, b) => b.amount - a.amount);

        let dIdx = 0;
        let cIdx = 0;
        while (dIdx < debtors.length && cIdx < creditors.length) {
            const debtor = debtors[dIdx];
            const creditor = creditors[cIdx];
            const transfer = Math.min(debtor.amount, creditor.amount);

            if (transfer > 0.01) {
                debts.push({
                    from: debtor.name,
                    fromNames: debtor.unit ? debtor.unit.names : [debtor.name],
                    to: creditor.name,
                    toNames: creditor.unit ? creditor.unit.names : [creditor.name],
                    amount: transfer
                });
            }

            debtor.amount -= transfer;
            creditor.amount -= transfer;

            if (debtor.amount <= 0.01) dIdx++;
            if (creditor.amount <= 0.01) cIdx++;
        }

        const netBalances = {};
        participantNames.forEach(n => {
            const u = units.find(unit => unit.names.includes(n));
            if (u) {
                netBalances[n] = u.net;
            } else {
                netBalances[n] = (paid[n] || 0) - (spent[n] || 0) + (settlementPaid[n] || 0) - (settlementReceived[n] || 0);
            }
        });

        return {
            totalSpent,
            roundCount,
            paid,
            spent,
            settlementPaid,
            settlementReceived,
            settlements,
            netBalances,
            debts,
            units,
            participants: allParticipants
        };
    },

    showPartyRefundModal(name) {
        const balances = this.calculatePartyBalances();
        const unit = balances.units.find(u => u.names.includes(name));
        if (!unit) return;

        const isCouple = unit.isCouple;
        const paid = unit.paid;
        const spent = unit.spent;
        const net = unit.net;

        let title = isCouple ? `💸 Pareja: ${unit.p1} y ${unit.p2}` : `💸 Saldo de ${name}`;
        let html = `<h3>${title}</h3>`;

        if (isCouple && unit.oneLeft) {
            html += `
                <div style="background: rgba(234,179,8,0.12); border: 1px solid rgba(234,179,8,0.3); border-radius: 10px; padding: 0.75rem; margin-bottom: 0.85rem; font-size: 0.85rem; color: #fde047;">
                    ℹ️ <b>${unit.activeName}</b> sigue en la fiesta consumiendo. La liquidación definitiva se calculará al cerrar la fiesta.
                </div>
            `;
        }

        html += `
            <div style="background: rgba(255,255,255,0.03); border-radius: 10px; padding: 0.85rem; margin-bottom: 1rem; font-size: 0.9rem;">
                <div style="display:flex; justify-content:space-between; margin-bottom: 0.35rem;">
                    <span style="color: var(--text-muted);">${isCouple ? 'Pagaron en total:' : 'Pagó en total:'}</span>
                    <b>${this.formatEuro(paid)}</b>
                </div>
                ${isCouple ? `
                    <div style="display:flex; justify-content:space-between; margin-bottom: 0.35rem; font-size: 0.78rem; color: var(--text-muted); padding-left: 0.5rem;">
                        <span>↳ ${unit.p1}: ${this.formatEuro(unit.p1Paid)} | ${unit.p2}: ${this.formatEuro(unit.p2Paid)}</span>
                    </div>
                ` : ''}
                <div style="display:flex; justify-content:space-between; margin-bottom: 0.35rem;">
                    <span style="color: var(--text-muted);">${isCouple ? 'Consumieron en rondas:' : 'Consumió en rondas:'}</span>
                    <b style="color: #f87171;">${this.formatEuro(spent)}</b>
                </div>
                ${isCouple ? `
                    <div style="display:flex; justify-content:space-between; margin-bottom: 0.35rem; font-size: 0.78rem; color: var(--text-muted); padding-left: 0.5rem;">
                        <span>↳ ${unit.p1}: ${this.formatEuro(unit.p1Spent)} | ${unit.p2}: ${this.formatEuro(unit.p2Spent)}</span>
                    </div>
                ` : ''}
                ${unit.settlementPaid > 0 ? `
                    <div style="display:flex; justify-content:space-between; margin-bottom: 0.35rem; color: #34d399;">
                        <span>Reembolsos pagados:</span>
                        <b>+${this.formatEuro(unit.settlementPaid)}</b>
                    </div>
                ` : ''}
                ${unit.settlementReceived > 0 ? `
                    <div style="display:flex; justify-content:space-between; margin-bottom: 0.35rem; color: #60a5fa;">
                        <span>Reembolsos cobrados:</span>
                        <b>-${this.formatEuro(unit.settlementReceived)}</b>
                    </div>
                ` : ''}
                <div style="display:flex; justify-content:space-between; border-top: 1px dashed var(--glass-border); padding-top: 0.35rem;">
                    <span style="color: var(--text-muted);">Balance neto:</span>
                    <b style="color: ${net > 0 ? '#4ade80' : (net < 0 ? '#f87171' : 'var(--text-muted)')};">${net >= 0 ? '+' : ''}${this.formatEuro(net)}</b>
                </div>
            </div>
        `;

        if (net > 0.01) {
            html += `
                <div style="background: rgba(74, 222, 128, 0.12); border: 1px solid rgba(74, 222, 128, 0.3); border-radius: 12px; padding: 1rem; margin-bottom: 1rem; text-align: center;">
                    <p style="color: #4ade80; font-size: 0.85rem; margin-bottom: 0.3rem;">El grupo le debe dinero:</p>
                    <span style="font-size: 1.8rem; font-weight: 700; color: #4ade80;">+${this.formatEuro(net)}</span>
                    <p style="color: var(--text-muted); font-size: 0.82rem; margin-top: 0.5rem;">
                        Al finalizar la noche se calcularán los Bizums correspondientes para devolverle este saldo.
                    </p>
                </div>
            `;
        } else if (net < -0.01) {
            html += `
                <div style="background: rgba(239,68,68,0.12); border: 1px solid rgba(239,68,68,0.3); border-radius: 12px; padding: 1rem; margin-bottom: 1rem; text-align: center;">
                    <p style="color: #fca5a5; font-size: 0.85rem; margin-bottom: 0.3rem;">Debe abonar de su consumo:</p>
                    <span style="font-size: 1.8rem; font-weight: 700; color: #ef4444;">-${this.formatEuro(Math.abs(net))}</span>
                    <p style="font-size: 0.8rem; color: var(--text-muted); margin-top: 0.5rem;">
                        Debe transferir esta cantidad por Bizum para dejar liquidada su parte.
                    </p>
                    <button class="btn-primary" style="width: 100%; margin-top: 0.75rem; font-size: 0.88rem; padding: 0.6rem;" onclick="App.closeModal(); App.handlePartyGoHome()">⚖️ Ver y saldar reembolsos</button>
                </div>
            `;
        } else {
            html += `<p style="color: var(--text-muted); text-align: center; margin-bottom: 1rem;">Está en paz con el grupo (consumió exactamente lo que pagó).</p>`;
        }

        html += `<button class="btn-primary" style="width: 100%;" onclick="App.closeModal()">Entendido</button>`;
        this.openModal(html);
    },

    async handlePartyGoHome() {
        const data = this.state.partyData;
        if (!data) return;
        const balances = this.calculatePartyBalances();
        const { totalSpent, roundCount, debts, units, settlements } = balances;
        
        // 1. Bloque de Bizums para liquidar cuentas
        let debtsHtml = '';
        if (debts && debts.length > 0) {
            debtsHtml = `
                <div class="summary-card glass" style="padding: 1.2rem; border-radius: 15px; margin-bottom: 1.5rem; border: 1.5px solid rgba(236, 72, 153, 0.5); background: rgba(236, 72, 153, 0.05);">
                    <h3 style="text-align: center; margin-bottom: 0.4rem; color: #f472b6; font-size: 1.1rem; display: flex; align-items: center; justify-content: center; gap: 8px;">
                        <span>📱 Bizums para dejarlo 100% cuadrado</span>
                    </h3>
                    <p style="font-size: 0.8rem; color: var(--text-muted); text-align: center; margin-bottom: 0.85rem;">
                        Pagos recomendados para liquidar todas las deudas con el mínimo número de transferencias:
                    </p>
                    <div style="display: flex; flex-direction: column; gap: 0.65rem;">
            `;

            debts.forEach(d => {
                const safeFrom = (d.from || '').replace(/'/g, "\\'");
                const safeTo = (d.to || '').replace(/'/g, "\\'");
                const safeFromNames = (d.fromNames || []).join(',');
                const safeToNames = (d.toNames || []).join(',');

                debtsHtml += `
                    <div style="display: flex; flex-direction: column; gap: 0.5rem; padding: 0.75rem 0.85rem; border-radius: 10px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.08);">
                        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.92rem; flex-wrap: wrap; gap: 0.35rem;">
                            <div style="display: flex; align-items: center; gap: 0.45rem; flex-wrap: wrap;">
                                <b style="color: #f87171;">${d.from}</b>
                                <span style="color: var(--text-muted); font-size: 0.8rem;">le hace Bizum a</span>
                                <b style="color: #60a5fa;">${d.to}</b>
                            </div>
                            <span style="font-weight: 700; color: #f43f5e; font-size: 1.1rem; white-space: nowrap;">
                                ${this.formatEuro(d.amount)}
                            </span>
                        </div>
                        <div style="display: flex; justify-content: flex-end; margin-top: 0.2rem;">
                            <button type="button" class="btn-sm" onclick="App.handlePartyMarkDebtPaid('${safeFrom}', '${safeTo}', ${d.amount}, '${safeFromNames}', '${safeToNames}')" style="background: rgba(16, 185, 129, 0.2); border: 1px solid #10b981; color: #34d399; font-weight: 600; padding: 0.4rem 0.85rem; border-radius: 6px; font-size: 0.84rem; cursor: pointer; display: flex; align-items: center; gap: 6px;">
                                <span>✓</span> Marcar como pagado
                            </button>
                        </div>
                    </div>
                `;
            });

            debtsHtml += `
                    </div>
                    <button type="button" class="btn-secondary" onclick="App.showPartyManualRefundModal()" style="width: 100%; margin-top: 0.75rem; font-size: 0.85rem; padding: 0.5rem;">
                        ➕ Registrar otro reembolso manual
                    </button>
                </div>
            `;
        } else {
            debtsHtml = `
                <div class="summary-card glass" style="padding: 1.2rem; border-radius: 15px; margin-bottom: 1.5rem; text-align: center;">
                    <span style="font-size: 2rem; display: block; margin-bottom: 0.35rem;">🎉</span>
                    <h3 style="color: #4ade80; margin-bottom: 0.35rem;">¡Cuentas Cuadradas!</h3>
                    <p style="font-size: 0.85rem; color: var(--text-muted); margin: 0;">No hay deudas pendientes entre los participantes.</p>
                    <button type="button" class="btn-secondary" onclick="App.showPartyManualRefundModal()" style="margin-top: 0.85rem; font-size: 0.82rem; padding: 0.45rem 0.85rem;">
                        ➕ Registrar reembolso manual
                    </button>
                </div>
            `;
        }

        // 1.5. Bloque de Reembolsos ya pagados
        let settledHtml = '';
        if (settlements && settlements.length > 0) {
            settledHtml = `
                <div class="summary-card glass" style="padding: 1.1rem; border-radius: 15px; margin-bottom: 1.5rem; border: 1.5px solid rgba(16, 185, 129, 0.45); background: rgba(16, 185, 129, 0.05);">
                    <h3 style="text-align: center; margin-bottom: 0.35rem; color: #34d399; font-size: 1.05rem; display: flex; align-items: center; justify-content: center; gap: 8px;">
                        <span>✅ Reembolsos Pagados (${settlements.length})</span>
                    </h3>
                    <p style="font-size: 0.78rem; color: var(--text-muted); text-align: center; margin-bottom: 0.75rem;">
                        Reembolsos y transferencias que ya han sido saldados:
                    </p>
                    <div style="display: flex; flex-direction: column; gap: 0.5rem;">
            `;

            settlements.forEach(s => {
                settledHtml += `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.6rem 0.8rem; border-radius: 8px; background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.06); font-size: 0.88rem;">
                        <div style="display: flex; flex-direction: column;">
                            <div style="display: flex; align-items: center; gap: 0.35rem; flex-wrap: wrap;">
                                <b style="color: #a7f3d0;">${s.from}</b>
                                <span style="color: var(--text-muted); font-size: 0.78rem;">pagó a</span>
                                <b style="color: #93c5fd;">${s.to}</b>
                            </div>
                            <small style="color: var(--text-muted); font-size: 0.72rem;">${new Date(s.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</small>
                        </div>
                        <div style="display: flex; align-items: center; gap: 0.6rem;">
                            <span style="font-weight: 700; color: #34d399; font-size: 1rem;">
                                ${this.formatEuro(s.amount)}
                            </span>
                            <button class="btn-icon-small" title="Deshacer reembolso" onclick="App.handlePartyDeleteSettlement('${s.id}')" style="padding: 0.25rem 0.45rem; font-size: 0.8rem; border-radius: var(--radius-sm); background: rgba(239,68,68,0.15); border: 1px solid rgba(239,68,68,0.3); color: #f87171;">🗑️</button>
                        </div>
                    </div>
                `;
            });

            settledHtml += `
                    </div>
                </div>
            `;
        }

        // 2. Bloque de Desglose por Persona / Pareja
        let breakdownHtml = '';
        if (units && units.length > 0) {
            breakdownHtml = `
                <div class="summary-card glass" style="padding: 1.2rem; border-radius: 15px; margin-bottom: 1.5rem; border-color: rgba(99, 102, 241, 0.4);">
                    <h3 style="text-align: center; margin-bottom: 0.5rem; color: #a5b4fc; font-size: 1.1rem;">
                        📊 Balance de Cada Uno
                    </h3>
                    <div style="max-height: 220px; overflow-y: auto; padding-right: 0.35rem; display: flex; flex-direction: column; gap: 0.45rem;">
            `;

            units.forEach(u => {
                let badge = '';
                if (u.net > 0.01) {
                    badge = `<span style="color: #4ade80; font-weight: 700;">+${this.formatEuro(u.net)} <small style="font-size:0.7rem;">(le deben)</small></span>`;
                } else if (u.net < -0.01) {
                    badge = `<span style="color: #f87171; font-weight: 700;">-${this.formatEuro(Math.abs(u.net))} <small style="font-size:0.7rem;">(debe)</small></span>`;
                } else {
                    badge = `<span style="color: var(--text-muted); font-weight: 700;">0,00€ <small style="font-size:0.7rem;">(en paz)</small></span>`;
                }

                let subDetails = `Pagó: ${this.formatEuro(u.paid)} | Consumió: ${this.formatEuro(u.spent)}`;
                if (u.settlementPaid > 0) subDetails += ` | Reembolsó: +${this.formatEuro(u.settlementPaid)}`;
                if (u.settlementReceived > 0) subDetails += ` | Cobró: -${this.formatEuro(u.settlementReceived)}`;

                breakdownHtml += `
                    <div style="display: flex; justify-content: space-between; font-size: 0.88rem; padding: 0.55rem 0.65rem; border-radius: 8px; background: rgba(255,255,255,0.03); align-items: center;">
                        <div style="display: flex; flex-direction: column;">
                            <span style="color: var(--text-main); font-weight: 600;">${u.displayName} ${u.isCouple ? '<span class="badge-couple">💑 Pareja</span>' : ''}</span>
                            <span style="font-size: 0.72rem; color: var(--text-muted);">
                                ${subDetails}
                            </span>
                        </div>
                        <div style="text-align: right; flex-shrink: 0; margin-left: 0.5rem;">
                            ${badge}
                        </div>
                    </div>
                `;
            });

            breakdownHtml += `
                    </div>
                </div>
            `;
        }
        
        let summaryHtml = `
            <style>#btn-close-modal { display: none !important; }</style>
            <div class="modal-summary-shell final-summary">
                <div class="modal-summary-header">
                    <h2 style="text-align: center; margin-bottom: 0.5rem; font-size: 1.15rem;">⚖️ Liquidación de la Fiesta ⚖️</h2>
                    <div class="summary-card glass" style="padding: 0.85rem 1rem; border-radius: 12px; margin-bottom: 0.25rem;">
                        <div style="display: flex; justify-content: space-between; margin-bottom: 0.35rem; font-size: 1rem;">
                            <span>Total Gastado:</span>
                            <b style="color: var(--primary); font-size: 1.15rem;">${this.formatEuro(totalSpent)}</b>
                        </div>
                        <div style="display: flex; justify-content: space-between; font-size: 0.82rem; color: var(--text-muted);">
                            <span>Total de Gastos / Rondas:</span>
                            <b>${roundCount}</b>
                        </div>
                    </div>
                </div>
                <div class="modal-summary-body scroll-fade-bottom">
                    ${debtsHtml}
                    ${settledHtml}
                    ${breakdownHtml}
                </div>
                <div class="modal-summary-footer">
                    <div class="modal-summary-footer-row">
                        <button onclick="App.closeModal()" class="btn-secondary" style="flex: 1; padding: 0.65rem; border-radius: 8px;">Volver a la fiesta</button>
                        <button onclick="App.handleFinalCloseParty()" class="btn-primary" style="flex: 1; padding: 0.65rem; border-radius: 8px;">Finalizar Fiesta</button>
                    </div>
                </div>
            </div>
        `;
        
        this.openModal(summaryHtml, true);
    },

    async handlePartyMarkDebtPaid(from, to, defaultAmount, fromNamesStr, toNamesStr) {
        const input = prompt(`¿Cuánto ha pagado ${from} a ${to}? (€):`, Number(defaultAmount || 0).toFixed(2));
        if (input === null) return;
        const amount = this.parseAmount(input);
        if (isNaN(amount) || amount <= 0) {
            alert('Por favor introduce un importe válido.');
            return;
        }

        try {
            const fromNames = fromNamesStr ? fromNamesStr.split(',') : [from];
            const toNames = toNamesStr ? toNamesStr.split(',') : [to];

            const historyRef = push(ref(this.db, `party_pots/${this.state.partyId}/history`));
            await set(historyRef, {
                type: 'settlement',
                amount: amount,
                from: from,
                to: to,
                fromNames: fromNames,
                toNames: toNames,
                description: `Reembolso: ${from} pagó a ${to}`,
                user: this.state.user || 'Desconocido',
                timestamp: Date.now()
            });

            this.handlePartyGoHome();
        } catch (error) {
            console.error('Error registrando reembolso:', error);
            alert('Error al registrar el pago del reembolso.');
        }
    },

    async handlePartyDeleteSettlement(historyId) {
        if (!confirm('¿Seguro que quieres anular este pago de reembolso? La deuda volverá a quedar pendiente.')) return;
        try {
            const itemRef = ref(this.db, `party_pots/${this.state.partyId}/history/${historyId}`);
            await set(itemRef, null);
            this.handlePartyGoHome();
        } catch (error) {
            console.error('Error anulando reembolso:', error);
            alert('Error al anular el reembolso.');
        }
    },

    showPartyManualRefundModal() {
        const balances = this.calculatePartyBalances();
        const units = balances.units || [];
        if (units.length < 2) {
            alert('Se necesitan al menos dos participantes para registrar un reembolso.');
            return;
        }

        const optionsHtml = units.map(u => `<option value="${u.shortName || u.displayName}">${u.displayName}</option>`).join('');

        const html = `
            <div style="display: flex; flex-direction: column; gap: 1rem; text-align: left;">
                <h3 style="margin-bottom: 0;">🤝 Anotar Reembolso Manual</h3>
                <div>
                    <label style="font-size:0.85rem; color: var(--text-muted); margin-bottom: 0.35rem; display:block;">¿Quién paga el reembolso? (Deudor)</label>
                    <select id="manual-refund-from" style="width: 100%; padding: 0.75rem; border-radius: var(--radius-sm); background: var(--bg-card); color: var(--text-main); border: 1px solid var(--glass-border); font-size: 1rem;">
                        ${optionsHtml}
                    </select>
                </div>
                <div>
                    <label style="font-size:0.85rem; color: var(--text-muted); margin-bottom: 0.35rem; display:block;">¿Quién recibe el dinero? (Acreedor)</label>
                    <select id="manual-refund-to" style="width: 100%; padding: 0.75rem; border-radius: var(--radius-sm); background: var(--bg-card); color: var(--text-main); border: 1px solid var(--glass-border); font-size: 1rem;">
                        ${optionsHtml}
                    </select>
                </div>
                <div>
                    <label style="font-size:0.85rem; color: var(--text-muted); margin-bottom: 0.35rem; display:block;">Importe transferido (€)</label>
                    <input type="number" id="manual-refund-amount" placeholder="Ej: 10.00" step="0.01" style="width: 100%; padding: 0.85rem 1rem; font-size: 1.15rem; box-sizing: border-box;">
                </div>
                <div style="display: flex; gap: 0.5rem; margin-top: 0.5rem;">
                    <button class="btn-secondary" onclick="App.handlePartyGoHome()" style="flex: 1;">Volver</button>
                    <button class="btn-primary" onclick="App.confirmPartyManualRefund()" style="flex: 1;">Guardar Pago</button>
                </div>
            </div>
        `;
        this.openModal(html);
        setTimeout(() => {
            const toSel = document.getElementById('manual-refund-to');
            if (toSel && toSel.options.length > 1) {
                toSel.selectedIndex = 1;
            }
        }, 50);
    },

    async confirmPartyManualRefund() {
        const fromSel = document.getElementById('manual-refund-from');
        const toSel = document.getElementById('manual-refund-to');
        const amountEl = document.getElementById('manual-refund-amount');

        const from = fromSel?.value;
        const to = toSel?.value;
        const amount = this.parseAmount(amountEl?.value);

        if (!from || !to) {
            alert('Selecciona quién paga y quién recibe.');
            return;
        }
        if (from === to) {
            alert('El pagador y el receptor no pueden ser la misma persona.');
            return;
        }
        if (isNaN(amount) || amount <= 0) {
            alert('Introduce un importe válido mayor que 0.');
            return;
        }

        const balances = this.calculatePartyBalances();
        const fromUnit = balances.units.find(u => (u.shortName || u.displayName) === from);
        const toUnit = balances.units.find(u => (u.shortName || u.displayName) === to);

        const fromNames = fromUnit ? fromUnit.names : [from];
        const toNames = toUnit ? toUnit.names : [to];

        try {
            const historyRef = push(ref(this.db, `party_pots/${this.state.partyId}/history`));
            await set(historyRef, {
                type: 'settlement',
                amount: amount,
                from: from,
                to: to,
                fromNames: fromNames,
                toNames: toNames,
                description: `Reembolso: ${from} pagó a ${to}`,
                user: this.state.user || 'Desconocido',
                timestamp: Date.now()
            });

            this.handlePartyGoHome();
        } catch (error) {
            console.error('Error registrando reembolso manual:', error);
            alert('Error al registrar el reembolso.');
        }
    },

    async handleFinalCloseParty() {
        if (!confirm('¿Cerrar la fiesta definitivamente? El código dejará de funcionar.')) return;
        
        try {
            const currentId = this.state.partyId;
            const currentData = this.state.partyData || {};
            await set(ref(this.db, `party_pots/${currentId}/status`), 'finished');
            
            localStorage.removeItem('thermo_partyId');
            this.state.partyId = null;
            
            await this.addLog('close_party', { partyId: currentId });
            this.showPartyBorrachuzoModal(currentData);
        } catch (error) { console.error('Error cerrando fiesta:', error); }
    },

    showPartyBorrachuzoModal(data) {
        // Contabilizar rondas/consumos por amigo
        const roundCount = {};
        const spentByUser = {};
        const participants = data?.participants ? Object.values(data.participants).map(p => p.name) : [];

        participants.forEach(name => {
            roundCount[name] = 0;
            spentByUser[name] = 0;
        });

        if (data?.history) {
            Object.values(data.history).forEach(item => {
                if (item.type === 'expense') {
                    const amount = item.amount || 0;
                    let targets = Array.isArray(item.beneficiaries) && item.beneficiaries.length > 0
                        ? item.beneficiaries
                        : participants;

                    if (targets.length === 0 && participants.length > 0) {
                        targets = participants;
                    }

                    if (targets.length > 0) {
                        const split = amount / targets.length;
                        targets.forEach(target => {
                            roundCount[target] = (roundCount[target] || 0) + 1;
                            spentByUser[target] = (spentByUser[target] || 0) + split;
                        });
                    }
                }
            });
        }

        let borrachuzosHTML = '';
        let titulo = 'Borrachuzo de la noche';
        const activeUsersWithRounds = Object.entries(roundCount).filter(([, count]) => count > 0);

        if (activeUsersWithRounds.length === 0) {
            borrachuzosHTML = '<p style="margin:0.5rem 0;color:#374151;">¡Nadie se apuntó a ninguna ronda! 😇</p>';
        } else {
            const maxRounds = Math.max(...activeUsersWithRounds.map(([, count]) => count));
            const winners = activeUsersWithRounds
                .filter(([, count]) => count === maxRounds)
                .map(([name]) => name);

            titulo = winners.length > 1 ? 'Borrachuzos de la noche' : 'Borrachuzo de la noche';
            const winnerSpent = winners.map(w => `${w} (${this.formatEuro(spentByUser[w] || 0)})`).join(', ');

            borrachuzosHTML = `
                <p style="font-size:1.15rem;margin:0.5rem 0 0.25rem;color:#111827;">
                    🍺 <strong>${winners.join(', ')}</strong>
                </p>
                <p style="color:#6b7280;font-size:0.85rem;margin:0;">
                    ${maxRounds} ronda${maxRounds !== 1 ? 's' : ''} contabilizada${maxRounds !== 1 ? 's' : ''}
                </p>
                <p style="color:#9ca3af;font-size:0.75rem;margin:0.25rem 0 0;">
                    Consumo: ${winnerSpent}
                </p>`;
        }

        const html = `
            <div style="text-align:center;padding:0.5rem 0 1rem;">
                <div style="font-size:2.5rem;margin-bottom:0.5rem;">🎉</div>
                <h2 style="margin:0 0 0.25rem;font-size:1.3rem;color:#111827;">¡Fiesta cerrada!</h2>
                <p style="margin:0 0 1rem;color:#6b7280;font-size:0.9rem;">¡Buena noche, amigos! 🥳🍻</p>
                <div style="background:#fdf2f8;border:2px solid #ec4899;border-radius:12px;padding:1rem;margin-bottom:1.25rem;">
                    <p style="margin:0 0 0.4rem;font-weight:700;color:#be185d;font-size:1rem;">
                        🏆 ${titulo}:
                    </p>
                    ${borrachuzosHTML}
                </div>
                <button onclick="App._closeBorrachuzoModal()"
                    style="background:#ec4899;color:#fff;border:none;border-radius:8px;
                           padding:0.65rem 2rem;font-size:1rem;cursor:pointer;font-weight:600;">
                    ¡Hasta luego! 👋
                </button>
            </div>`;

        this.openModal(html, true);

        // Disparar confeti por encima del modal (z-index > 1000)
        if (typeof confetti === 'function') {
            confetti({ particleCount: 160, spread: 90, origin: { y: 0.6 }, zIndex: 1100 });
            setTimeout(() => confetti({ particleCount: 80, spread: 120, origin: { y: 0.4 }, zIndex: 1100 }), 600);
        }
    },



    async handlePartyAddFriend() {
        try {
            const snapshot = await get(ref(this.db, 'members'));
            const members = snapshot.exists() ? Object.values(snapshot.val()) : [];
            const activeParticipants = Object.values(this.state.partyData?.participants || {})
                .filter(p => p.status !== 'left')
                .map(p => p.name);
            
            const availableMembers = members.filter(m => !activeParticipants.includes(m.name));

            this.state.tempSelectionFriends = [];
            this.state.tempAvailablePartyMembers = availableMembers.map(m => m.name);
            
            let html = `<h3>Añadir Amigos a la Fiesta</h3>`;
            html += `<p class="subtitle" style="margin-bottom: 0.75rem;">Toca un amigo para añadirlo o quitarlo directamente:</p>`;

            // Botones de selección rápida: Chicos, Chicas, Switch Todos/Ninguno
            html += `
                <div style="display: flex; gap: 0.45rem; align-items: center; flex-wrap: wrap; margin-bottom: 0.85rem;">
                    <button type="button" class="filter-pill filter-pill-boys" onclick="App.setPartyFriendsQuickFilter('chicos')">
                        👦 Chicos
                    </button>
                    <button type="button" class="filter-pill filter-pill-girls" onclick="App.setPartyFriendsQuickFilter('chicas')">
                        👧 Chicas
                    </button>
                    <div class="selector-switch-group">
                        <button type="button" id="switch-party-friend-all" class="selector-switch-btn" onclick="App.setPartyFriendsQuickFilter('todos')">Todos</button>
                        <button type="button" id="switch-party-friend-none" class="selector-switch-btn active" onclick="App.setPartyFriendsQuickFilter('ninguno')">Ninguno</button>
                    </div>
                </div>
            `;

            html += `<div class="participant-grid" style="max-height: 40vh; overflow-y: auto;">`;
            
            availableMembers.forEach(m => {
                const safeName = m.name.replace(/'/g, "\\'").replace(/"/g, "&quot;");
                const idName = m.name.replace(/\s/g, '_').replace(/\./g, '_');
                const sizeClass = this.getNameLengthClass(m.name);
                html += `<button id="f-btn-${idName}" class="participant-btn ${sizeClass}" onclick="App.togglePartyFriendDirect('${safeName}')">${m.name}</button>`;
            });
            
            if (availableMembers.length === 0) {
                html += `<p class="empty-msg" style="grid-column: span 2;">Todos los miembros ya están en la fiesta.</p>`;
            }
            
            html += `</div>`;

            html += `
                <div style="margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid var(--glass-border);">
                    <p class="subtitle" style="margin-bottom: 0.5rem; color: var(--text-main);">¿No es miembro? Añádelo manualmente:</p>
                    <input type="text" id="custom-friend-name" placeholder="Escribe un nombre..." style="margin-bottom: 0.75rem;">
                    <label style="display: flex; align-items: center; gap: 0.65rem; cursor: pointer; user-select: none; padding: 0.55rem 0.75rem; background: rgba(255,255,255,0.05); border: 1px solid var(--glass-border); border-radius: var(--radius-sm); margin-bottom: 0.75rem;">
                        <input type="checkbox" id="chk-permanent-member" style="width: 1.1rem; height: 1.1rem; accent-color: var(--primary); cursor: pointer;">
                        <span style="font-size: 0.88rem; line-height: 1.35;">
                            <strong>Miembro permanente</strong><br>
                            <span style="color: var(--text-muted); font-size: 0.78rem;">Se da de alta en la banda para futuras quedadas. Si no, solo participa en esta fiesta.</span>
                        </span>
                    </label>
                    <button class="btn-secondary" onclick="App.confirmPartyCustomFriend()" style="width: 100%;">Añadir nombre escrito</button>
                </div>
            `;

            this.openModal(html);
        } catch (error) {
            console.error('Error al cargar miembros:', error);
            alert('Error al conectar con la base de datos.');
        }
    },

    async togglePartyFriendDirect(name) {
        const idName = name.replace(/\s/g, '_').replace(/\./g, '_');
        const btn = document.getElementById(`f-btn-${idName}`);
        const isSelected = this.state.tempSelectionFriends.includes(name);

        if (isSelected) {
            if (!confirm(`¿Seguro que quieres quitar a "${name}" de la fiesta?`)) return;
            // Apagar y quitar del bote
            const idx = this.state.tempSelectionFriends.indexOf(name);
            this.state.tempSelectionFriends.splice(idx, 1);
            if (btn) btn.classList.remove('selected');
            await this.removePartyFriendSilent(name);
        } else {
            // Encender y añadir al bote
            this.state.tempSelectionFriends.push(name);
            if (btn) btn.classList.add('selected');
            await this.addPartyFriendSilent(name);
        }

        // Actualizar el estado visual del switch Todos / Ninguno
        const total = (this.state.tempAvailablePartyMembers || []).length;
        const count = this.state.tempSelectionFriends.length;
        const switchAll = document.getElementById('switch-party-friend-all');
        const switchNone = document.getElementById('switch-party-friend-none');
        if (switchAll) switchAll.classList.toggle('active', count === total && total > 0);
        if (switchNone) switchNone.classList.toggle('active', count === 0);
    },

    async setPartyFriendsQuickFilter(filterType) {
        const boysList = ['Antonio', 'Caba', 'David', 'Jose', 'Edu', 'Pedro', 'Karlos', 'Fernando'].map(n => n.toLowerCase());
        const available = this.state.tempAvailablePartyMembers || [];

        let targetNames = [];
        if (filterType === 'chicos') {
            targetNames = available.filter(name => boysList.includes(name.trim().toLowerCase()));
        } else if (filterType === 'chicas') {
            targetNames = available.filter(name => !boysList.includes(name.trim().toLowerCase()));
        } else if (filterType === 'todos') {
            targetNames = [...available];
        } else if (filterType === 'ninguno') {
            targetNames = [];
        }

        const prevSelection = this.state.tempSelectionFriends || [];
        const toAdd = targetNames.filter(name => !prevSelection.includes(name));
        const toRemove = prevSelection.filter(name => !targetNames.includes(name));

        if (toRemove.length > 0) {
            const namesText = toRemove.length === 1 ? `a "${toRemove[0]}"` : `a ${toRemove.length} amigos (${toRemove.join(', ')})`;
            if (!confirm(`¿Seguro que quieres quitar de la fiesta ${namesText}?`)) {
                // Restaurar switch visual
                const total = available.length;
                const count = (this.state.tempSelectionFriends || []).length;
                const switchAll = document.getElementById('switch-party-friend-all');
                const switchNone = document.getElementById('switch-party-friend-none');
                if (switchAll) switchAll.classList.toggle('active', count === total && total > 0);
                if (switchNone) switchNone.classList.toggle('active', count === 0);
                return;
            }
        }

        this.state.tempSelectionFriends = [...targetNames];

        // Actualizar visual de los botones
        available.forEach(name => {
            const idName = name.replace(/\s/g, '_').replace(/\./g, '_');
            const btn = document.getElementById(`f-btn-${idName}`);
            if (btn) {
                if (targetNames.includes(name)) {
                    btn.classList.add('selected');
                } else {
                    btn.classList.remove('selected');
                }
            }
        });

        // Actualizar el estado visual del switch Todos / Ninguno
        const total = available.length;
        const count = targetNames.length;
        const switchAll = document.getElementById('switch-party-friend-all');
        const switchNone = document.getElementById('switch-party-friend-none');
        if (switchAll) switchAll.classList.toggle('active', count === total && total > 0);
        if (switchNone) switchNone.classList.toggle('active', count === 0);

        for (const name of toAdd) {
            await this.addPartyFriendSilent(name);
        }
        for (const name of toRemove) {
            await this.removePartyFriendSilent(name);
        }
    },

    async confirmPartyBatchAddFriends() {
        this.closeModal();
    },

    async confirmPartyCustomFriend() {
        const customNameInput = document.getElementById('custom-friend-name')?.value.trim();
        const permanent = document.getElementById('chk-permanent-member')?.checked ?? true;
        if (!customNameInput) return alert('Escribe un nombre para añadir.');

        this.state.tempNewFriendPermanent = permanent;
        await this.promptNewFriendCouple(customNameInput, [], true);
    },

    async removePartyFriendSilent(name) {
        try {
            const key = name.replace(/\./g, '_');
            const participantRef = ref(this.db, `party_pots/${this.state.partyId}/participants/${key}`);
            await set(participantRef, null);
        } catch (error) {
            console.error('Error al retirar amigo silenciosamente:', error);
        }
    },

    async addPartyFriendSilent(name) {
        const key = name.replace(/\./g, '_');
        const friendRef = ref(this.db, `party_pots/${this.state.partyId}/participants/${key}`);
        const currentData = this.state.partyData?.participants?.[key] || {};
        const { status, leftAt, ...restData } = currentData;
        await set(friendRef, { ...restData, name: name, joinedAt: Date.now(), status: 'active' });
    },

    async handlePartyAddExpense() {
        const allParticipants = this.state.partyData?.participants
            ? Object.values(this.state.partyData.participants)
            : [];
        const activeParticipants = allParticipants
            .filter(p => p.status !== 'left')
            .map(p => p.name);
        const participants = activeParticipants.length > 0
            ? activeParticipants
            : allParticipants.map(p => p.name);

        if (participants.length === 0) {
            alert('Primero añade participantes a la fiesta con el botón "+ Añadir Amigo".');
            return;
        }

        // Por defecto todos los amigos seleccionados
        this.state.tempPartyExpenseFriends = [...participants];
        // Por defecto el usuario actual como pagador si está en la fiesta, o el primero
        this.state.tempPartyExpensePayer = (participants.includes(this.state.user))
            ? this.state.user
            : participants[0];

        const generatePayerButtons = () => {
            return participants.map(name => {
                const isSelected = (this.state.tempPartyExpensePayer === name);
                const safeName = name.replace(/'/g, "\\'").replace(/"/g, "&quot;");
                const idName = name.replace(/\s/g, '_').replace(/\./g, '_');
                const sizeClass = this.getNameLengthClass(name);
                return `<button type="button" id="pe-payer-btn-${idName}" class="participant-btn ${sizeClass} ${isSelected ? 'selected' : ''}" onclick="App.setPartyExpensePayer('${safeName}')" style="padding: 0.65rem 0.35rem; border-radius: var(--radius-sm); transform: none !important;">${name}</button>`;
            }).join('');
        };

        const generateBeneficiaryButtons = () => {
            return participants.map(name => {
                const isSelected = this.state.tempPartyExpenseFriends.includes(name);
                const safeName = name.replace(/'/g, "\\'").replace(/"/g, "&quot;");
                const idName = name.replace(/\s/g, '_').replace(/\./g, '_');
                const sizeClass = this.getNameLengthClass(name);
                return `<button type="button" id="pe-btn-${idName}" class="participant-btn ${sizeClass} ${isSelected ? 'selected' : ''}" onclick="App.togglePartyExpenseFriend('${safeName}')" style="padding: 0.65rem 0.35rem; border-radius: var(--radius-sm); transform: none !important;">${name}</button>`;
            }).join('');
        };

        const isAllSelected = participants.length > 0 && this.state.tempPartyExpenseFriends.length === participants.length;

        const html = `
            <div style="display: flex; flex-direction: column; gap: 1rem; text-align: left;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0;">
                    <h3 style="margin: 0;">💸 Anotar Gasto</h3>
                    <button type="button" onclick="App.cancelPartyAddExpense()" style="background: none; border: none; font-size: 1.4rem; color: var(--text-muted); cursor: pointer; padding: 0 0.35rem; line-height: 1;" title="Cerrar sin guardar">✕</button>
                </div>
                <div>
                    <label style="font-size:0.85rem; color: var(--text-muted); margin-bottom: 0.35rem; display:block;">¿Cuánto ha costado? (€)</label>
                    <input type="number" id="party-expense-amount" placeholder="Ej: 15.00" step="0.01" style="width: 100%; padding: 0.85rem 1rem; font-size: 1.15rem; box-sizing: border-box;" oninput="App.updatePartyExpenseFriendsUIState()" onkeydown="if(event.key === 'Enter') App.confirmPartyAddExpense()">
                </div>
                <div>
                    <label style="font-size:0.85rem; color: var(--text-muted); margin-bottom: 0.35rem; display:block;">¿En qué se ha gastado?</label>
                    <input type="text" id="party-expense-desc" placeholder="" value="" style="width: 100%; padding: 0.85rem 1rem; font-size: 1rem; box-sizing: border-box;" onkeydown="if(event.key === 'Enter') App.confirmPartyAddExpense()">
                </div>
                <div>
                    <label style="font-size:0.85rem; color: var(--text-muted); margin-bottom: 0.45rem; display:block;">¿Quién lo ha pagado? 💳</label>
                    <div id="party-expense-payer-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.55rem; max-height: 25vh; overflow-y: auto; overflow-x: hidden; padding: 0.2rem; box-sizing: border-box;">
                        ${generatePayerButtons()}
                    </div>
                </div>
                <div>
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.45rem;">
                        <label style="font-size:0.85rem; color: var(--text-muted); margin: 0;">¿Entre quiénes se divide? 👥</label>
                        <div class="selector-switch-group">
                            <button type="button" id="switch-party-expense-all" class="selector-switch-btn ${isAllSelected ? 'active' : ''}" onclick="App.toggleAllPartyExpenseFriends(true)">Todos</button>
                            <button type="button" id="switch-party-expense-none" class="selector-switch-btn ${this.state.tempPartyExpenseFriends.length === 0 ? 'active' : ''}" onclick="App.toggleAllPartyExpenseFriends(false)">Ninguno</button>
                        </div>
                    </div>
                    <div id="party-expense-friends-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.55rem; max-height: 28vh; overflow-y: auto; overflow-x: hidden; padding: 0.2rem; box-sizing: border-box;">
                        ${generateBeneficiaryButtons()}
                    </div>
                    <div id="party-expense-split-preview" style="background: rgba(99, 102, 241, 0.12); border: 1px solid rgba(99, 102, 241, 0.25); border-radius: 8px; padding: 0.6rem 0.8rem; font-size: 0.85rem; text-align: center; color: #c7d2fe; margin-top: 0.6rem;">
                        Pagado por <b>${this.state.tempPartyExpensePayer}</b> · Dividido entre <b>${participants.length}</b> personas
                    </div>
                </div>
                <div style="text-align: center; margin-top: 0.15rem;">
                    <button type="button" onclick="App.cancelPartyAddExpense()" style="background: none; border: none; color: var(--text-muted); font-size: 0.82rem; text-decoration: underline; cursor: pointer;">Cancelar sin guardar</button>
                </div>
            </div>
        `;
        this.state.isPartyAddExpenseModal = true;
        this.openModal(html);
        const closeBtn = document.getElementById('btn-close-modal');
        if (closeBtn) {
            closeBtn.textContent = 'Anotar gasto y volver';
            closeBtn.className = 'btn-primary';
            closeBtn.style.padding = '0.95rem';
            closeBtn.style.fontSize = '1.05rem';
            closeBtn.style.fontWeight = '700';
        }
        setTimeout(() => {
            this.updatePartyExpenseFriendsUIState();
            const descEl = document.getElementById('party-expense-desc');
            if (descEl) {
                descEl.value = '';
                descEl.placeholder = '';
            }
        }, 50);
    },

    cancelPartyAddExpense() {
        this.state.isPartyAddExpenseModal = false;
        this.closeModal();
    },

    setPartyExpensePayer(name) {
        this.state.tempPartyExpensePayer = name;
        const grid = document.getElementById('party-expense-payer-grid');
        if (grid) {
            const buttons = grid.querySelectorAll('button');
            buttons.forEach(btn => btn.classList.remove('selected'));
            const idName = name.replace(/\s/g, '_').replace(/\./g, '_');
            const targetBtn = document.getElementById(`pe-payer-btn-${idName}`);
            if (targetBtn) targetBtn.classList.add('selected');
        }
        this.updatePartyExpenseFriendsUIState();
    },

    togglePartyExpenseFriend(name) {
        if (!this.state.tempPartyExpenseFriends) this.state.tempPartyExpenseFriends = [];
        const idx = this.state.tempPartyExpenseFriends.indexOf(name);
        const idName = name.replace(/\s/g, '_').replace(/\./g, '_');
        const btn = document.getElementById(`pe-btn-${idName}`);

        if (idx > -1) {
            this.state.tempPartyExpenseFriends.splice(idx, 1);
            if (btn) btn.classList.remove('selected');
        } else {
            this.state.tempPartyExpenseFriends.push(name);
            if (btn) btn.classList.add('selected');
        }
        this.updatePartyExpenseFriendsUIState();
    },

    toggleAllPartyExpenseFriends(selectAll) {
        const participants = this.state.partyData?.participants
            ? Object.values(this.state.partyData.participants).map(p => p.name)
            : [];

        if (selectAll !== undefined) {
            this.state.tempPartyExpenseFriends = selectAll ? [...participants] : [];
        } else {
            if (this.state.tempPartyExpenseFriends.length === participants.length) {
                this.state.tempPartyExpenseFriends = [];
            } else {
                this.state.tempPartyExpenseFriends = [...participants];
            }
        }

        participants.forEach(name => {
            const idName = name.replace(/\s/g, '_').replace(/\./g, '_');
            const btn = document.getElementById(`pe-btn-${idName}`);
            if (btn) {
                if (this.state.tempPartyExpenseFriends.includes(name)) {
                    btn.classList.add('selected');
                } else {
                    btn.classList.remove('selected');
                }
            }
        });
        this.updatePartyExpenseFriendsUIState();
    },

    updatePartyExpenseFriendsUIState() {
        const participants = this.state.partyData?.participants
            ? Object.values(this.state.partyData.participants).map(p => p.name)
            : [];
        const selected = this.state.tempPartyExpenseFriends || [];
        const count = selected.length;
        const total = participants.length;
        const switchAll = document.getElementById('switch-party-expense-all');
        const switchNone = document.getElementById('switch-party-expense-none');
        if (switchAll) switchAll.classList.toggle('active', count === total && total > 0);
        if (switchNone) switchNone.classList.toggle('active', count === 0);

        const amountEl = document.getElementById('party-expense-amount');
        const amount = this.parseAmount(amountEl?.value) || 0;
        const payer = this.state.tempPartyExpensePayer || 'Nadie';

        const previewEl = document.getElementById('party-expense-split-preview');
        if (previewEl) {
            if (count === 0) {
                previewEl.innerHTML = `⚠️ <span style="color:#f87171;">Selecciona al menos a una persona para dividir el gasto.</span>`;
            } else if (amount > 0) {
                const perPerson = amount / count;
                previewEl.innerHTML = `💳 Pagado por <b>${payer}</b><br><span style="font-size: 1.05rem; font-weight:700; color: #a5b4fc;">${this.formatEuro(perPerson)}</span> / persona (${count} pers.)`;
            } else {
                previewEl.innerHTML = `💳 Pagado por <b>${payer}</b> · Dividido entre <b>${count}</b> personas`;
            }
        }
    },

    async confirmPartyAddExpense() {
        const amountEl = document.getElementById('party-expense-amount');
        const descEl = document.getElementById('party-expense-desc');
        const amount = this.parseAmount(amountEl?.value);
        let desc = descEl?.value?.trim() || 'Gasto';
        const payer = this.state.tempPartyExpensePayer;

        if (isNaN(amount) || amount <= 0) {
            alert('Por favor introduce un importe válido (o pulsa ✕ para cancelar).');
            return;
        }

        if (!payer) {
            alert('Por favor indica quién ha pagado este gasto.');
            return;
        }

        const participants = this.state.partyData?.participants
            ? Object.values(this.state.partyData.participants).map(p => p.name)
            : [];
        const selected = [...(this.state.tempPartyExpenseFriends || [])];

        if (participants.length > 0 && selected.length === 0) {
            alert('Debes seleccionar al menos a una persona entre las que se divide el gasto.');
            return;
        }

        const isAll = participants.length === 0 || selected.length === participants.length;
        if (!isAll) {
            desc += ` (${selected.join(', ')})`;
        }

        this.state.isPartyAddExpenseModal = false;
        this.closeModal();

        const historyRef = push(ref(this.db, `party_pots/${this.state.partyId}/history`));
        await set(historyRef, {
            type: 'expense',
            amount: amount,
            description: desc,
            payer: payer,
            beneficiaries: selected,
            user: this.state.user,
            timestamp: Date.now()
        });

        // Recalcular totalSpent a partir del historial actualizado
        const histSnap = await get(ref(this.db, `party_pots/${this.state.partyId}/history`));
        let newTotal = 0;
        if (histSnap.exists()) {
            Object.values(histSnap.val()).forEach(item => {
                if (item.type === 'expense') newTotal += Number(item.amount || 0);
            });
        } else {
            newTotal = (this.state.partyData?.totalSpent || 0) + amount;
        }
        await set(ref(this.db, `party_pots/${this.state.partyId}/totalSpent`), newTotal);
    },

    async handlePartyDeleteExpense(historyId) {
        if (!confirm('¿Seguro que quieres borrar este gasto?')) return;
        try {
            const expenseRef = ref(this.db, `party_pots/${this.state.partyId}/history/${historyId}`);
            await set(expenseRef, null);

            // Recalcular totalSpent a partir del historial actualizado
            const histSnap = await get(ref(this.db, `party_pots/${this.state.partyId}/history`));
            let newTotalSpent = 0;
            if (histSnap.exists()) {
                Object.values(histSnap.val()).forEach(item => {
                    if (item.type === 'expense') {
                        newTotalSpent += Number(item.amount || 0);
                    }
                });
            }
            await set(ref(this.db, `party_pots/${this.state.partyId}/totalSpent`), newTotalSpent);
        } catch (error) {
            console.error('Error al borrar gasto:', error);
            alert('Error al borrar el gasto.');
        }
    },

    async handlePartyEditExpense(historyId) {
        const item = this.state.partyData?.history?.[historyId];
        if (!item) return alert('No se encontró el gasto a editar.');

        const activeParticipants = this.state.partyData?.participants
            ? Object.values(this.state.partyData.participants)
                .filter(p => p.status !== 'left')
                .map(p => p.name)
            : [];

        // Si el item tiene beneficiarios, asegurarse de incluir también a los que estuvieran en él aunque ahora estén inactivos
        const existingBeneficiaries = Array.isArray(item.beneficiaries) && item.beneficiaries.length > 0
            ? item.beneficiaries
            : activeParticipants;

        const allAvailableForEdit = Array.from(new Set([...activeParticipants, ...existingBeneficiaries]));

        this.state.tempPartyExpenseFriends = [...existingBeneficiaries];
        this.state.tempPartyExpensePayer = item.payer || item.user || allAvailableForEdit[0] || '';

        // Limpiar sufijo "(Nombre1, Nombre2)" de la descripción para el input
        let cleanDesc = item.description || '';
        if (cleanDesc.includes('(')) {
            cleanDesc = cleanDesc.substring(0, cleanDesc.lastIndexOf('(')).trim();
        }

        const generatePayerButtons = () => {
            if (allAvailableForEdit.length === 0) {
                return '<p class="empty-msg" style="width: 100%;">No hay participantes.</p>';
            }
            return allAvailableForEdit.map(name => {
                const isSelected = (this.state.tempPartyExpensePayer === name);
                const safeName = name.replace(/'/g, "\\'").replace(/"/g, "&quot;");
                const idName = name.replace(/\s/g, '_').replace(/\./g, '_');
                const sizeClass = this.getNameLengthClass(name);
                return `<button type="button" id="pe-payer-btn-${idName}" class="participant-btn ${sizeClass} ${isSelected ? 'selected' : ''}" onclick="App.setPartyExpensePayer('${safeName}')" style="padding: 0.65rem 0.35rem; border-radius: var(--radius-sm); transform: none !important;">${name}</button>`;
            }).join('');
        };

        const generateFriendButtons = () => {
            if (allAvailableForEdit.length === 0) {
                return '<p class="empty-msg" style="width: 100%;">No hay participantes.</p>';
            }
            return allAvailableForEdit.map(name => {
                const isSelected = this.state.tempPartyExpenseFriends.includes(name);
                const safeName = name.replace(/'/g, "\\'").replace(/"/g, "&quot;");
                const idName = name.replace(/\s/g, '_').replace(/\./g, '_');
                const sizeClass = this.getNameLengthClass(name);
                return `<button type="button" id="pe-btn-${idName}" class="participant-btn ${sizeClass} ${isSelected ? 'selected' : ''}" onclick="App.togglePartyExpenseFriend('${safeName}')" style="padding: 0.65rem 0.35rem; border-radius: var(--radius-sm); transform: none !important;">${name}</button>`;
            }).join('');
        };

        const isAllSelected = allAvailableForEdit.length > 0 && this.state.tempPartyExpenseFriends.length === allAvailableForEdit.length;

        const html = `
            <div style="display: flex; flex-direction: column; gap: 1rem; text-align: left;">
                <h3 style="margin-bottom: 0;">✏️ Modificar Gasto / Ronda</h3>
                <div>
                    <label style="font-size:0.85rem; color: var(--text-muted); margin-bottom: 0.35rem; display:block;">Importe (€)</label>
                    <input type="number" id="party-expense-amount" value="${Number(item.amount || 0).toFixed(2)}" step="0.01" style="width: 100%; padding: 0.85rem 1rem; font-size: 1.15rem; box-sizing: border-box;" oninput="App.updatePartyExpenseFriendsUIState()">
                </div>
                <div>
                    <label style="font-size:0.85rem; color: var(--text-muted); margin-bottom: 0.35rem; display:block;">Concepto / Descripción</label>
                    <input type="text" id="party-expense-desc" value="${cleanDesc}" style="width: 100%; padding: 0.85rem 1rem; font-size: 1rem; box-sizing: border-box;">
                </div>
                <div>
                    <label style="font-size:0.85rem; color: var(--text-muted); margin-bottom: 0.45rem; display:block;">¿Quién lo ha pagado? 💳</label>
                    <div id="party-expense-payer-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.55rem; max-height: 25vh; overflow-y: auto; overflow-x: hidden; padding: 0.2rem; box-sizing: border-box;">
                        ${generatePayerButtons()}
                    </div>
                </div>
                <div>
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.45rem;">
                        <label style="font-size:0.85rem; color: var(--text-muted); margin: 0;">¿Entre quiénes se divide? 👥</label>
                        <div class="selector-switch-group">
                            <button type="button" id="switch-party-expense-all" class="selector-switch-btn ${isAllSelected ? 'active' : ''}" onclick="App.toggleAllPartyExpenseFriends(true)">Todos</button>
                            <button type="button" id="switch-party-expense-none" class="selector-switch-btn ${this.state.tempPartyExpenseFriends.length === 0 ? 'active' : ''}" onclick="App.toggleAllPartyExpenseFriends(false)">Ninguno</button>
                        </div>
                    </div>
                    <div id="party-expense-friends-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.55rem; max-height: 28vh; overflow-y: auto; overflow-x: hidden; padding: 0.2rem; box-sizing: border-box;">
                        ${generateFriendButtons()}
                    </div>
                    <div id="party-expense-split-preview" style="background: rgba(99, 102, 241, 0.12); border: 1px solid rgba(99, 102, 241, 0.25); border-radius: 8px; padding: 0.6rem 0.8rem; font-size: 0.85rem; text-align: center; color: #c7d2fe; margin-top: 0.6rem;">
                        Pagado por <b>${this.state.tempPartyExpensePayer}</b> · Dividido entre <b>${this.state.tempPartyExpenseFriends.length}</b> personas
                    </div>
                </div>
                <button class="btn-primary" onclick="App.confirmPartySaveEditedExpense('${historyId}')" style="width: 100%; padding: 0.95rem; font-size: 1.05rem; font-weight: 700; margin-top: 0.25rem;">Guardar Cambios</button>
            </div>
        `;
        this.openModal(html);
        setTimeout(() => this.updatePartyExpenseFriendsUIState(), 50);
    },

    async confirmPartySaveEditedExpense(historyId) {
        const item = this.state.partyData?.history?.[historyId];
        if (!item) return;

        const amountEl = document.getElementById('party-expense-amount');
        const descEl = document.getElementById('party-expense-desc');
        const amount = this.parseAmount(amountEl?.value);
        let desc = descEl?.value?.trim() || 'Gasto';
        const payer = this.state.tempPartyExpensePayer || item.payer || item.user;

        if (isNaN(amount) || amount <= 0) {
            alert('Por favor introduce un importe válido.');
            return;
        }

        const participants = this.state.partyData?.participants
            ? Object.values(this.state.partyData.participants).map(p => p.name)
            : [];
        const selected = [...(this.state.tempPartyExpenseFriends || [])];

        if (participants.length > 0 && selected.length === 0) {
            alert('Debes seleccionar al menos a una persona para este gasto.');
            return;
        }

        const isAll = participants.length === 0 || selected.length === participants.length;
        if (!isAll) {
            desc += ` (${selected.join(', ')})`;
        }

        this.closeModal();

        try {
            const expenseRef = ref(this.db, `party_pots/${this.state.partyId}/history/${historyId}`);
            await set(expenseRef, {
                ...item,
                amount: amount,
                description: desc,
                payer: payer,
                beneficiaries: selected,
                editedAt: Date.now()
            });

            // Recalcular totalSpent a partir del historial actualizado
            const histSnap = await get(ref(this.db, `party_pots/${this.state.partyId}/history`));
            let newTotalSpent = 0;
            if (histSnap.exists()) {
                Object.values(histSnap.val()).forEach(h => {
                    if (h.type === 'expense') {
                        newTotalSpent += Number(h.amount || 0);
                    }
                });
            }
            await set(ref(this.db, `party_pots/${this.state.partyId}/totalSpent`), newTotalSpent);
        } catch (error) {
            console.error('Error al guardar gasto editado:', error);
            alert('Error al guardar los cambios del gasto.');
        }
    },

    async handlePartyDeleteIncome(historyId) {
        if (!confirm('¿Seguro que quieres borrar este aporte?')) return;
        try {
            const incomeRef = ref(this.db, `party_pots/${this.state.partyId}/history/${historyId}`);
            await set(incomeRef, null);

            // Recalcular totalCollected a partir del historial actualizado
            const histSnap = await get(ref(this.db, `party_pots/${this.state.partyId}/history`));
            let newTotalCollected = 0;
            if (histSnap.exists()) {
                Object.values(histSnap.val()).forEach(item => {
                    if (item.type === 'income') {
                        newTotalCollected += Number(item.amount || 0);
                    }
                });
            }
            await set(ref(this.db, `party_pots/${this.state.partyId}/totalCollected`), newTotalCollected);
        } catch (error) {
            console.error('Error al borrar aporte:', error);
            alert('Error al borrar el aporte.');
        }
    },

    async handlePartyEditIncome(historyId) {
        const item = this.state.partyData?.history?.[historyId];
        if (!item) return alert('No se encontró el aporte a editar.');

        const currentFriend = (item.description || '').replace('Aporte de ', '').trim();
        const participants = this.state.partyData?.participants
            ? Object.values(this.state.partyData.participants).map(p => p.name)
            : [];

        if (currentFriend && !participants.includes(currentFriend)) {
            participants.push(currentFriend);
        }

        let optionsHtml = '';
        participants.forEach(name => {
            const selected = name === currentFriend ? 'selected' : '';
            optionsHtml += `<option value="${name}" ${selected}>${name}</option>`;
        });

        const html = `
            <div style="display: flex; flex-direction: column; gap: 1rem; text-align: left;">
                <h3 style="margin-bottom: 0;">✏️ Modificar Aporte al Bote</h3>
                <div>
                    <label style="font-size:0.85rem; color: var(--text-muted); margin-bottom: 0.35rem; display:block;">¿Quién puso el dinero?</label>
                    <select id="party-edit-money-friend" style="width: 100%; padding: 0.85rem 1rem; font-size: 1rem; border-radius: var(--radius-sm); border: 1px solid var(--glass-border); background: rgba(0,0,0,0.3); color: white; -webkit-appearance: none; appearance: none; box-sizing: border-box;">
                        ${optionsHtml}
                    </select>
                </div>
                <div>
                    <label style="font-size:0.85rem; color: var(--text-muted); margin-bottom: 0.35rem; display:block;">Cantidad aportada (€)</label>
                    <input type="number" id="party-edit-money-amount" value="${Number(item.amount || 0).toFixed(2)}" step="0.01" style="width: 100%; padding: 0.85rem 1rem; font-size: 1.15rem; box-sizing: border-box;">
                </div>
                <button class="btn-primary" onclick="App.confirmPartySaveEditedIncome('${historyId}')" style="width: 100%; padding: 0.95rem; font-size: 1.05rem; font-weight: 700; margin-top: 0.25rem;">Guardar Cambios</button>
            </div>
        `;
        this.openModal(html);
    },

    async confirmPartySaveEditedIncome(historyId) {
        const item = this.state.partyData?.history?.[historyId];
        if (!item) return;

        const friendEl = document.getElementById('party-edit-money-friend');
        const amountEl = document.getElementById('party-edit-money-amount');
        const friend = friendEl?.value?.trim();
        const amount = this.parseAmount(amountEl?.value);

        if (!friend) return alert('Selecciona quién puso el dinero.');
        if (isNaN(amount) || amount <= 0) return alert('Introduce una cantidad válida.');

        this.closeModal();

        try {
            const incomeRef = ref(this.db, `party_pots/${this.state.partyId}/history/${historyId}`);
            await set(incomeRef, {
                ...item,
                amount: amount,
                description: `Aporte de ${friend}`,
                editedAt: Date.now()
            });

            // Recalcular totalCollected a partir del historial actualizado
            const histSnap = await get(ref(this.db, `party_pots/${this.state.partyId}/history`));
            let newTotalCollected = 0;
            if (histSnap.exists()) {
                Object.values(histSnap.val()).forEach(h => {
                    if (h.type === 'income') {
                        newTotalCollected += Number(h.amount || 0);
                    }
                });
            }
            await set(ref(this.db, `party_pots/${this.state.partyId}/totalCollected`), newTotalCollected);
        } catch (error) {
            console.error('Error al guardar aporte editado:', error);
            alert('Error al guardar los cambios del aporte.');
        }
    },

    openModal(html, hideCloseBtn = false) {
        document.body.classList.add('modal-open');
        this.display.modalContent.innerHTML = html;
        this.display.modalOverlay.classList.remove('hidden');
        const closeBtn = document.getElementById('btn-close-modal');
        if (closeBtn) {
            closeBtn.style.display = hideCloseBtn ? 'none' : '';
            if (!this.state.currentOrderProduct && !this.state.isPartyAddExpenseModal) {
                closeBtn.textContent = 'Volver';
                closeBtn.className = 'btn-secondary';
                closeBtn.style.padding = '';
                closeBtn.style.fontSize = '';
                closeBtn.style.fontWeight = '';
            }
        }
        this.initScrollFades();
    },

    closeModal() {
        if (this.state.isPartyAddExpenseModal) {
            this.confirmPartyAddExpense();
            return;
        }

        this.state.isAuditModalOpen = false;
        this.state.isPartyAddExpenseModal = false;
        const orderProduct = this.state.currentOrderProduct;
        const selectedParticipants = (this.state.tempSelection && this.state.tempSelection.length > 0)
            ? [...this.state.tempSelection]
            : null;

        // Reset state
        this.state.currentOrderProduct = null;
        this.state.tempSelection = [];

        const closeBtn = document.getElementById('btn-close-modal');
        if (closeBtn) {
            closeBtn.textContent = 'Volver';
            closeBtn.className = 'btn-secondary';
            closeBtn.style.padding = '';
            closeBtn.style.fontSize = '';
            closeBtn.style.fontWeight = '';
        }

        this.display.modalOverlay.classList.add('hidden');
        document.body.classList.remove('modal-open');

        if (orderProduct && selectedParticipants && selectedParticipants.length > 0) {
            this.addOrder(orderProduct, selectedParticipants);
        }
    },

    // --- MÉTODOS DE SCROLL FADE INFERIOR Y SCROLLBARS ---
    updateScrollFade(el) {
        if (!el) return;
        const hasOverflow = el.scrollHeight > (el.clientHeight + 4);
        if (!hasOverflow) {
            el.removeAttribute('data-scroll-bottom');
            return;
        }
        const isAtBottom = (el.scrollTop + el.clientHeight) >= (el.scrollHeight - 6);
        el.setAttribute('data-scroll-bottom', isAtBottom ? 'false' : 'true');
    },

    attachScrollFade(el) {
        if (!el) return;
        el.classList.add('scroll-fade-bottom');
        if (!el._scrollFadeInit) {
            el._scrollFadeInit = true;
            const handler = () => this.updateScrollFade(el);
            el.addEventListener('scroll', handler, { passive: true });

            if (window.ResizeObserver) {
                const ro = new ResizeObserver(() => this.updateScrollFade(el));
                ro.observe(el);
            }
        }

        this.updateScrollFade(el);
        setTimeout(() => this.updateScrollFade(el), 60);
        setTimeout(() => this.updateScrollFade(el), 250);
    },

    initScrollFades() {
        const selectors = [
            '.modal-summary-body',
            '#modal-content',
            '.participant-grid',
            '.ticket-body',
            '#history-list-container'
        ];
        document.querySelectorAll(selectors.join(', ')).forEach(el => this.attachScrollFade(el));
    },

    // --- MÉTODOS DEL COMBOBOX DE BARES ---
    listenToBars() {
        const barsRef = ref(this.db, 'bars');
        onValue(barsRef, (snapshot) => {
            this.state.bars = snapshot.val() || {};
            this.updateBarsDropdownUI(this.inputs.barName ? this.inputs.barName.value : '');
        });
    },

    updateBarsDropdownUI(filterText = '') {
        const listEl = this.inputs.barDropdownList;
        if (!listEl) return;
        listEl.innerHTML = '';

        const filter = filterText.toLowerCase().trim();
        const bars = Object.entries(this.state.bars || {});

        const filteredBars = bars.filter(([id, b]) => {
            return b.name.toLowerCase().includes(filter);
        });

        if (filteredBars.length === 0) {
            listEl.innerHTML = '<div class="dropdown-item empty-msg" style="padding: 0.75rem 1rem;">No hay bares que coincidan</div>';
            return;
        }

        filteredBars.forEach(([id, b]) => {
            const item = document.createElement('div');
            item.className = 'dropdown-item';
            
            const textSpan = document.createElement('span');
            textSpan.className = 'dropdown-item-text';
            textSpan.textContent = b.name;
            textSpan.onclick = (e) => {
                e.stopPropagation();
                this.inputs.barName.value = b.name;
                this.closeBarDropdown();
            };

            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'dropdown-item-actions';

            const btnEdit = document.createElement('button');
            btnEdit.type = 'button';
            btnEdit.className = 'btn-action-small';
            btnEdit.innerHTML = '✏️';
            btnEdit.onclick = (e) => {
                e.stopPropagation();
                this.handleEditBar(id, b.name);
            };

            const btnDelete = document.createElement('button');
            btnDelete.type = 'button';
            btnDelete.className = 'btn-action-small delete';
            btnDelete.innerHTML = '🗑️';
            btnDelete.onclick = (e) => {
                e.stopPropagation();
                this.handleDeleteBar(id, b.name);
            };

            actionsDiv.appendChild(btnEdit);
            actionsDiv.appendChild(btnDelete);

            item.appendChild(textSpan);
            item.appendChild(actionsDiv);

            listEl.appendChild(item);
        });
    },

    async handleEditBar(id, oldName) {
        const newName = prompt(`Modificar nombre del bar "${oldName}":`, oldName);
        if (!newName || newName.trim() === '' || newName.trim() === oldName) return;

        const trimmedNewName = newName.trim();
        const oldKey = oldName.replace(/\s/g, '_');
        const newKey = trimmedNewName.replace(/\s/g, '_');

        try {
            // 1. Actualizar el nombre en la lista de bares
            await set(ref(this.db, `bars/${id}`), { name: trimmedNewName });
            
            // 2. Si hay menú guardado en el antiguo key, migrarlo al nuevo key
            if (oldKey !== newKey) {
                const oldMenuRef = ref(this.db, `bar_menus/${oldKey}`);
                const snapshot = await get(oldMenuRef);
                if (snapshot.exists()) {
                    await set(ref(this.db, `bar_menus/${newKey}`), snapshot.val());
                    await set(oldMenuRef, null);
                }
            }
            alert(`El bar se ha actualizado a "${trimmedNewName}" correctamente.`);
        } catch (error) {
            console.error('Error al editar bar:', error);
            alert('Error al actualizar el bar en la base de datos.');
        }
    },

    async handleDeleteBar(id, barName) {
        if (!confirm(`¿Seguro que quieres borrar el bar "${barName}"? Esto eliminará también su menú predeterminado guardado.`)) return;

        try {
            await set(ref(this.db, `bars/${id}`), null);
            const menuKey = barName.replace(/\s/g, '_');
            await set(ref(this.db, `bar_menus/${menuKey}`), null);
            alert(`El bar "${barName}" ha sido eliminado.`);
        } catch (error) {
            console.error('Error al eliminar bar:', error);
            alert('Error al eliminar el bar de la base de datos.');
        }
    },

    toggleBarDropdown() {
        const dropdown = this.inputs.barDropdownList;
        const toggleBtn = this.inputs.btnToggleBarDropdown;
        if (!dropdown) return;
        
        const isOpen = dropdown.classList.contains('open');
        if (isOpen) {
            this.closeBarDropdown();
        } else {
            this.openBarDropdown();
        }
    },

    openBarDropdown() {
        const dropdown = this.inputs.barDropdownList;
        const toggleBtn = this.inputs.btnToggleBarDropdown;
        if (!dropdown) return;

        dropdown.classList.add('open');
        if (toggleBtn) toggleBtn.classList.add('open');
        this.updateBarsDropdownUI(this.inputs.barName ? this.inputs.barName.value : '');
    },

    closeBarDropdown() {
        const dropdown = this.inputs.barDropdownList;
        const toggleBtn = this.inputs.btnToggleBarDropdown;
        if (!dropdown) return;

        dropdown.classList.remove('open');
        if (toggleBtn) toggleBtn.classList.remove('open');
    },

    async handleRenameTable() {
        if (!this.state.tableId || !this.state.tableData) return;
        
        const currentName = this.state.tableData.name || '';
        const newName = prompt("Cambiar el nombre de la mesa:", currentName);
        if (!newName || newName.trim() === '' || newName.trim() === currentName) return;

        const trimmedNewName = newName.trim();
        try {
            await set(ref(this.db, `tables/${this.state.tableId}/name`), trimmedNewName);
            await this.addLog('rename_table', { tableId: this.state.tableId, oldName: currentName, newName: trimmedNewName });
        } catch (error) {
            console.error('Error al cambiar el nombre de la mesa:', error);
            alert('Error al actualizar el nombre de la mesa en la base de datos.');
        }
    },

    // --- MÉTODOS DE ACCESO SIMPLIFICADO ---
    async loadLoginMembers() {
        const gridEl = document.getElementById('login-members-grid');
        if (!gridEl) return;
        
        try {
            const snapshot = await get(ref(this.db, 'members'));
            if (!snapshot.exists()) {
                gridEl.innerHTML = '<p class="empty-msg">No hay miembros registrados.</p>';
                return;
            }
            
            const members = snapshot.val();
            gridEl.innerHTML = '';
            
            // Ordenar alfabéticamente para que se vea premium
            const sortedMembers = Object.entries(members).sort((a, b) => a[1].name.localeCompare(b[1].name));
            
            sortedMembers.forEach(([key, data]) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                const sizeClass = this.getNameLengthClass(data.name);
                btn.className = `participant-btn ${sizeClass}`;
                if (data.name.toLowerCase() === 'fernando') {
                    btn.classList.add('is-me'); // estilo destacado
                }
                btn.textContent = data.name;
                btn.onclick = () => this.handleLoginMemberClick(data.name, data.code);
                gridEl.appendChild(btn);
            });
        } catch (error) {
            console.error('Error al cargar miembros para login:', error);
            gridEl.innerHTML = '<p class="empty-msg">Error al conectar con la base de datos.</p>';
        }
    },

    async handleLoginMemberClick(name, officialCode) {
        this.state.tempLoginName = name;
        this.state.tempLoginCode = officialCode;
        
        const codeGroup = document.getElementById('login-admin-code-group');
        const loginSubtitle = document.getElementById('login-subtitle');

        document.querySelectorAll('#login-members-grid .participant-btn').forEach(btn => {
            if (btn.textContent === name) {
                btn.classList.add('selected');
            } else {
                btn.classList.remove('selected');
            }
        });

        if (name.toLowerCase() === 'fernando') {
            if (codeGroup) codeGroup.classList.remove('hidden');
            if (loginSubtitle) loginSubtitle.textContent = `Introduce el código para verificar que eres Fernando:`;
            const codeInput = document.getElementById('login-code');
            if (codeInput) {
                codeInput.value = '';
                codeInput.focus();
            }
        } else {
            if (codeGroup) codeGroup.classList.add('hidden');
            if (loginSubtitle) loginSubtitle.textContent = `Selecciona tu miembro de la banda para entrar`;
            
            await this.executeDirectLogin(name);
        }
    },

    async executeDirectLogin(name) {
        try {
            this.state.user = name;
            this.updateHeaderUser();
            localStorage.setItem('thermo_user', name);
            localStorage.setItem('thermo_auth', 'true');
            
            this.inputs.userName.value = name;
            if (this.inputs.userNameParty) this.inputs.userNameParty.value = name;
            
            this.display.adminPanelBtn.classList.add('hidden');
            
            await this.addLog('login', { user: name, type: 'direct' });
            this.showView('setup');
        } catch (e) {
            console.error(e);
        }
    },

    // ==========================================
    // CUADRE DE CUENTA Y ESCANEO DE TICKETS CON IA (GEMINI)
    // ==========================================

    getGeminiApiKey() {
        const raw = localStorage.getItem('thermobanda_gemini_key') || this.state.tableData?.geminiApiKey || null;
        return raw ? String(raw).trim() : null;
    },

    showGeminiApiKeyModal() {
        const currentKey = this.getGeminiApiKey() || '';
        const safeKey = currentKey ? currentKey.replace(/"/g, '&quot;') : '';

        const html = `
            <div style="text-align: left;">
                <h3 style="margin-bottom: 0.4rem; display: flex; align-items: center; gap: 0.5rem;">
                    <span>📸 Escaneo de Tickets con IA</span>
                </h3>
                <p style="font-size: 0.88rem; color: var(--text-muted); line-height: 1.45; margin-bottom: 0.85rem;">
                    Para leer y desglosar automáticamente los tickets del bar con <b>Google Gemini</b>, introduce tu API Key gratuita de Google.
                </p>

                <div style="background: rgba(99, 102, 241, 0.08); border: 1px solid rgba(99, 102, 241, 0.25); border-radius: var(--radius-sm); padding: 0.75rem 0.85rem; margin-bottom: 1rem; font-size: 0.8rem; line-height: 1.45; color: var(--text-main);">
                    💡 <b>¿Cómo conseguirla 100% gratis en 1 minuto?</b><br>
                    1. Entra en <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" style="color: var(--primary); font-weight: 700; text-decoration: underline;">Google AI Studio</a> con tu cuenta de Google.<br>
                    2. Pulsa en <b>"Create API key"</b> y copia el texto (suele empezar por <code>AQ...</code> o <code>AIza...</code>).<br>
                    3. Pégalo aquí abajo. Solo necesitas configurarlo una vez.
                </div>

                <div style="margin-bottom: 0.9rem;">
                    <label style="font-size: 0.82rem; color: var(--text-muted); display: block; margin-bottom: 0.35rem; font-weight: 600;">Google Gemini API Key:</label>
                    <input type="text" id="input-gemini-key" value="${safeKey}" placeholder="Pega aquí tu clave (AQ... o AIza...)" autocomplete="off" spellcheck="false" style="width: 100%; padding: 0.75rem 0.85rem; font-size: 0.92rem; box-sizing: border-box; border-radius: var(--radius-sm); border: 1px solid var(--glass-border); background: rgba(0,0,0,0.2); color: var(--text-main); font-family: monospace;">
                </div>

                <label style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.82rem; color: var(--text-muted); margin-bottom: 1.25rem; cursor: pointer; user-select: none;">
                    <input type="checkbox" id="chk-share-gemini-key" checked style="width: 1.1rem; height: 1.1rem; accent-color: var(--primary);">
                    <span>Compartir esta clave con los miembros de esta mesa</span>
                </label>

                <div style="display: flex; gap: 0.6rem;">
                    <button class="btn-primary" onclick="App.saveGeminiApiKey()" style="flex: 1; padding: 0.8rem; font-weight: 700;">💾 Guardar y Escanear</button>
                    <button class="btn-secondary" onclick="App.closeModal()" style="padding: 0.8rem 1rem;">Cancelar</button>
                </div>
            </div>
        `;
        this.openModal(html);
        setTimeout(() => document.getElementById('input-gemini-key')?.focus(), 80);
    },

    saveGeminiApiKey() {
        const input = document.getElementById('input-gemini-key');
        const key = input ? input.value.trim() : '';
        if (!key) return alert('Por favor, introduce una API Key válida.');

        localStorage.setItem('thermobanda_gemini_key', key);

        const shareChk = document.getElementById('chk-share-gemini-key');
        if (shareChk && shareChk.checked && this.state.tableId) {
            set(ref(this.db, `tables/${this.state.tableId}/geminiApiKey`), key).catch(console.error);
        }

        this.closeModal();
        setTimeout(() => this.triggerCameraScan(), 120);
    },

    startTicketAudit() {
        if (!this.state.tableId) return alert('No hay ninguna mesa activa.');

        const hasKey = Boolean(this.getGeminiApiKey());
        const hasExistingScan = Boolean(this.state.scannedTicketData?.items?.length);

        if (hasExistingScan) {
            const html = `
                <div style="text-align: left;">
                    <h3 style="margin-bottom: 0.4rem;">📸 Cuadre con Ticket del Bar</h3>
                    <p style="font-size: 0.88rem; color: var(--text-muted); margin-bottom: 1.15rem;">
                        Ya tienes un ticket escaneado en esta sesión (${this.state.scannedTicketData.items.length} artículos leídos). ¿Qué prefieres hacer?
                    </p>
                    <div style="display: flex; flex-direction: column; gap: 0.65rem;">
                        <button class="btn-primary" onclick="App.renderTicketAuditModal()" style="padding: 0.85rem; font-weight: 700; text-align: center;">
                            👁️ Ver Cuadre Actual
                        </button>
                        <button class="btn-secondary" onclick="App.triggerCameraScan()" style="padding: 0.85rem; text-align: center;">
                            📷 Hacer Nueva Foto al Ticket
                        </button>
                        <button class="btn-secondary" onclick="App.showGeminiApiKeyModal()" style="font-size: 0.82rem; opacity: 0.85; padding: 0.65rem;">
                            ⚙️ Configurar Clave API Gemini
                        </button>
                    </div>
                </div>
            `;
            this.openModal(html);
            return;
        }

        if (!hasKey) {
            this.showGeminiApiKeyModal();
            return;
        }

        this.triggerCameraScan();
    },

    triggerCameraScan() {
        const input = document.getElementById('ticket-camera-input');
        if (input) {
            input.click();
        } else {
            alert('No se encontró el selector de cámara en la página.');
        }
    },

    async handleTicketPhotoSelected(file) {
        if (!file || !file.type.startsWith('image/')) {
            return alert('Por favor, selecciona una fotografía válida del ticket.');
        }

        const apiKey = this.getGeminiApiKey();
        if (!apiKey) {
            this.showGeminiApiKeyModal();
            return;
        }

        this.openModal(`
            <div style="text-align: center; padding: 1.5rem 0.5rem;">
                <div class="loader" style="margin: 0 auto 1.25rem;"></div>
                <h3 style="margin-bottom: 0.4rem;">📸 Analizando ticket con IA...</h3>
                <p id="audit-loading-status" style="font-size: 0.88rem; color: var(--text-muted); line-height: 1.45;">
                    Optimizando fotografía del ticket...
                </p>
            </div>
        `, true);

        try {
            const statusEl = document.getElementById('audit-loading-status');

            const base64Data = await this.resizeImageToBase64(file, 1280, 0.85);
            this.state.scannedTicketImageUrl = `data:image/jpeg;base64,${base64Data}`;

            if (statusEl) statusEl.textContent = 'Leyendo consumiciones y precios con Google Gemini...';

            const prompt = `Eres un asistente experto en contabilidad de hostelería y auditoría de tickets de bar y restaurante.
Analiza con total precisión esta imagen del ticket / cuenta física.
Extrae todos los artículos, consumiciones o conceptos cobrados.

Devuelve estrictamente un objeto JSON con esta estructura exacta:
{
  "establishment": "Nombre del bar o restaurante si es visible, o vacío",
  "items": [
    {
      "name": "Nombre claro y reconocible del producto (ej: Caña, Doble, Café con leche, Bravas)",
      "qty": 3,
      "unitPrice": 2.50,
      "totalPrice": 7.50
    }
  ],
  "total": 24.50
}

Reglas obligatorias:
- "qty" debe ser un número entero o decimal (si no se indica cantidad, pon 1).
- "unitPrice" y "totalPrice" deben ser números (sin símbolo €). Si solo aparece el total del renglón, divide entre la cantidad.
- Si hay conceptos globales como "Terraza", "Pan/Servicio", "Suplemento", inclúyelos como un artículo más.
- NO incluyas subtotales parciales, base imponible ni desglose de IVA como artículos.
- "total" debe ser el importe final a pagar del ticket.`;

            const parsed = await this.callGeminiVision(apiKey, base64Data, prompt);

            if (!parsed || !Array.isArray(parsed.items) || parsed.items.length === 0) {
                throw new Error('No se detectaron artículos en el ticket. Asegúrate de que la foto esté bien enfocada e iluminada.');
            }

            parsed.items = parsed.items.map(item => {
                const qty = Math.max(1, Number(item.qty || 1));
                const totalPrice = Number(item.totalPrice || (qty * Number(item.unitPrice || 0)));
                const unitPrice = Number(item.unitPrice || (qty > 0 ? totalPrice / qty : totalPrice));
                return {
                    name: String(item.name || 'Artículo').trim(),
                    qty,
                    unitPrice: Math.round(unitPrice * 100) / 100,
                    totalPrice: Math.round(totalPrice * 100) / 100
                };
            });

            if (!parsed.total) {
                parsed.total = parsed.items.reduce((acc, it) => acc + it.totalPrice, 0);
            }
            parsed.total = Math.round(Number(parsed.total) * 100) / 100;

            this.state.scannedTicketData = parsed;
            this.state.isAuditModalOpen = true;
            this.renderTicketAuditModal();

        } catch (error) {
            console.error('Error procesando ticket:', error);
            const isKeyError = error.message && (
                error.message.toLowerCase().includes('api') || 
                error.message.toLowerCase().includes('clave') ||
                error.message.toLowerCase().includes('key') ||
                error.message.toLowerCase().includes('google')
            );
            let errorHtml = `
                <div style="text-align: left;">
                    <h3 style="color: var(--danger); margin-bottom: 0.5rem;">⚠️ No se pudo leer el ticket</h3>
                    <p style="font-size: 0.88rem; color: var(--text-main); margin-bottom: 1rem; line-height: 1.45;">
                        ${error.message || 'Ocurrió un error inesperado al procesar la fotografía.'}
                    </p>
                    <div style="display: flex; flex-direction: column; gap: 0.6rem;">
                        <button class="btn-primary" onclick="App.triggerCameraScan()">📷 Intentar Otra Foto</button>
                        <button class="btn-secondary" onclick="App.showGeminiApiKeyModal()">⚙️ Revisar / Cambiar Clave API</button>
                        <button class="btn-secondary" onclick="App.closeModal()">Cerrar</button>
                    </div>
                </div>
            `;
            this.openModal(errorHtml);
        }
    },

    resizeImageToBase64(file, maxDimension = 1280, quality = 0.85) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    let w = img.width;
                    let h = img.height;
                    if (w > maxDimension || h > maxDimension) {
                        if (w > h) {
                            h = Math.round((h * maxDimension) / w);
                            w = maxDimension;
                        } else {
                            w = Math.round((w * maxDimension) / h);
                            h = maxDimension;
                        }
                    }
                    const canvas = document.createElement('canvas');
                    canvas.width = w;
                    canvas.height = h;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, w, h);
                    const dataUrl = canvas.toDataURL('image/jpeg', quality);
                    const base64 = dataUrl.split(',')[1];
                    resolve(base64);
                };
                img.onerror = () => reject(new Error('No se pudo cargar la imagen para optimizarla.'));
                img.src = e.target.result;
            };
            reader.onerror = () => reject(new Error('Error al leer el archivo de fotografía.'));
            reader.readAsDataURL(file);
        });
    },

    async callGeminiVision(apiKey, base64Data, promptText) {
        const cleanKey = String(apiKey || '').trim();
        if (!cleanKey) {
            throw new Error('API Key no encontrada. Por favor, pulsa en "Revisar Clave API" para configurarla.');
        }

        const headers = {
            'Content-Type': 'application/json',
            'x-goog-api-key': cleanKey
        };

        // 1. Descubrir los modelos habilitados para esta API Key mediante ListModels
        let candidateModels = [
            'models/gemini-3.8-flash',
            'models/gemini-3.0-flash',
            'models/gemini-2.0-flash',
            'models/gemini-1.5-flash'
        ];

        try {
            const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(cleanKey)}`;
            const listRes = await fetch(listUrl, { headers });
            if (listRes.ok) {
                const listData = await listRes.json();
                const available = (listData.models || [])
                    .filter(m => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
                    .map(m => m.name);

                // Excluir modelos obsoletos para nuevos usuarios como gemini-2.5-flash
                const activeAvailable = available.filter(m => !m.includes('gemini-2.5') && !m.includes('gemini-1.0'));

                // Separar los modelos flash y ordenarlos de más reciente a más antiguo (ej. 3.8 > 2.0 > 1.5)
                const flashModels = activeAvailable.filter(m => m.toLowerCase().includes('flash'));
                flashModels.sort((a, b) => b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' }));

                const otherModels = activeAvailable.filter(m => !m.toLowerCase().includes('flash'));
                otherModels.sort((a, b) => b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' }));

                candidateModels = [
                    'models/gemini-3.8-flash',
                    ...flashModels.filter(m => m !== 'models/gemini-3.8-flash'),
                    ...otherModels
                ];
            } else {
                const errData = await listRes.json().catch(() => ({}));
                const errMsg = errData.error?.message || `HTTP ${listRes.status}`;
                const lower = errMsg.toLowerCase();
                if (listRes.status === 400 || lower.includes('api key') || lower.includes('api_key') || lower.includes('invalid')) {
                    throw new Error('La API Key de Gemini no es válida o está incompleta. Pulsa en "Revisar Clave API" y asegúrate de copiar la clave entera de Google AI Studio.');
                }
            }
        } catch (e) {
            if (e.message && (e.message.includes('API Key') || e.message.includes('Google AI Studio'))) {
                throw e;
            }
        }

        // 2. Intentar llamar a los modelos candidatos en orden de prioridad
        let lastError = null;
        for (let i = 0; i < candidateModels.length; i++) {
            const targetModel = candidateModels[i];
            const modelPath = targetModel.startsWith('models/') ? targetModel : `models/${targetModel}`;
            const url = `https://generativelanguage.googleapis.com/v1beta/${modelPath}:generateContent?key=${encodeURIComponent(cleanKey)}`;

            try {
                const res = await fetch(url, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                        contents: [{
                            parts: [
                                { text: promptText },
                                {
                                    inlineData: {
                                        mimeType: 'image/jpeg',
                                        data: base64Data
                                    }
                                }
                            ]
                        }],
                        generationConfig: {
                            temperature: 0.1,
                            responseMimeType: 'application/json'
                        }
                    })
                });

                if (!res.ok) {
                    const errData = await res.json().catch(() => ({}));
                    const errMsg = errData.error?.message || `HTTP ${res.status}`;
                    const lower = errMsg.toLowerCase();

                    if (res.status === 400 && (lower.includes('api key') || lower.includes('api_key') || lower.includes('invalid'))) {
                        throw new Error('La API Key de Gemini no es válida o ha caducado. Pulsa en "Revisar Clave API" para comprobarla.');
                    }

                    // Si Google recomienda un modelo específico (ej. "Please update your code to use models/gemini-3.8-flash")
                    const matches = [...errMsg.matchAll(/models\/([a-zA-Z0-9.-]+)/g)];
                    if (matches.length > 1 && matches[1][1]) {
                        const recommendedModel = `models/${matches[1][1]}`;
                        if (!candidateModels.includes(recommendedModel)) {
                            candidateModels.splice(i + 1, 0, recommendedModel);
                        }
                    }

                    // Si el modelo ya no está disponible para nuevos usuarios o 404, seguir con el siguiente modelo
                    lastError = new Error(`Error de Gemini (${modelPath}): ${errMsg}`);
                    continue;
                }

                const data = await res.json();
                const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
                if (!text) throw new Error('Gemini no devolvió texto de respuesta.');

                let cleaned = text.trim();
                if (cleaned.startsWith('```json')) cleaned = cleaned.replace(/^```json\s*/i, '').replace(/```\s*$/i, '');
                else if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```\s*/, '').replace(/```\s*$/i, '');

                return JSON.parse(cleaned);

            } catch (err) {
                lastError = err;
                if (err.message && err.message.includes('API Key de Gemini')) throw err;
            }
        }

        throw lastError || new Error('No se pudo procesar el ticket con los modelos disponibles de Gemini.');
    },

    matchTicketWithApp(ticketItems = [], appOrders = {}) {
        const appMap = new Map();

        Object.entries(appOrders).forEach(([orderId, o]) => {
            const rawName = o.productName || 'Varios';
            const norm = this.normalizeKey(rawName);
            if (!appMap.has(norm)) {
                appMap.set(norm, {
                    name: rawName,
                    norm,
                    qty: 0,
                    unitPrice: Number(o.price || 0),
                    totalPrice: 0,
                    consumers: {},
                    orderIds: []
                });
            }
            const entry = appMap.get(norm);
            entry.qty += 1;
            entry.totalPrice += Number(o.price || 0);
            entry.orderIds.push(orderId);

            const consumerName = o.user === 'SHARED' ? '💎 A escote' : o.user;
            entry.consumers[consumerName] = (entry.consumers[consumerName] || 0) + 1;
        });

        const matches = [];
        const matchedAppKeys = new Set();

        ticketItems.forEach((tItem, tIndex) => {
            const tNorm = this.normalizeKey(tItem.name);
            let bestKey = null;

            if (appMap.has(tNorm) && !matchedAppKeys.has(tNorm)) {
                bestKey = tNorm;
            } else {
                for (const [aNorm] of appMap.entries()) {
                    if (matchedAppKeys.has(aNorm)) continue;
                    if (aNorm.includes(tNorm) || tNorm.includes(aNorm)) {
                        bestKey = aNorm;
                        break;
                    }
                }
            }

            const tQty = Number(tItem.qty || 1);
            const tUnitPrice = Number(tItem.unitPrice || (tItem.totalPrice ? tItem.totalPrice / tQty : 0));
            const tTotalPrice = Number(tItem.totalPrice || (tQty * tUnitPrice));

            if (bestKey) {
                matchedAppKeys.add(bestKey);
                const aData = appMap.get(bestKey);
                const qtyDiff = tQty - aData.qty;
                const priceDiff = tTotalPrice - aData.totalPrice;

                matches.push({
                    ticketIndex: tIndex,
                    ticketItem: { ...tItem, qty: tQty, unitPrice: tUnitPrice, totalPrice: tTotalPrice },
                    appItem: aData,
                    displayName: aData.name || tItem.name,
                    tQty,
                    aQty: aData.qty,
                    qtyDiff,
                    priceDiff,
                    unitPrice: tUnitPrice || aData.unitPrice,
                    consumers: aData.consumers,
                    status: qtyDiff === 0 ? 'BALANCED' : (qtyDiff > 0 ? 'MISSING_IN_APP' : 'EXTRA_IN_APP')
                });
            } else {
                matches.push({
                    ticketIndex: tIndex,
                    ticketItem: { ...tItem, qty: tQty, unitPrice: tUnitPrice, totalPrice: tTotalPrice },
                    appItem: null,
                    displayName: tItem.name,
                    tQty,
                    aQty: 0,
                    qtyDiff: tQty,
                    priceDiff: tTotalPrice,
                    unitPrice: tUnitPrice,
                    consumers: {},
                    status: 'MISSING_IN_APP'
                });
            }
        });

        for (const [aNorm, aData] of appMap.entries()) {
            if (!matchedAppKeys.has(aNorm)) {
                matches.push({
                    ticketIndex: null,
                    ticketItem: null,
                    appItem: aData,
                    displayName: aData.name,
                    tQty: 0,
                    aQty: aData.qty,
                    qtyDiff: -aData.qty,
                    priceDiff: -aData.totalPrice,
                    unitPrice: aData.unitPrice,
                    consumers: aData.consumers,
                    status: 'EXTRA_IN_APP'
                });
            }
        }

        return matches;
    },

    renderTicketAuditModal() {
        if (!this.state.scannedTicketData) return;
        this.state.isAuditModalOpen = true;

        const ticketData = this.state.scannedTicketData;
        const appOrders = this.state.tableData?.orders || {};
        const matches = this.matchTicketWithApp(ticketData.items, appOrders);

        let ticketSum = 0;
        ticketData.items.forEach(it => ticketSum += Number(it.totalPrice || 0));
        let appSum = 0;
        Object.values(appOrders).forEach(o => appSum += Number(o.price || 0));

        const grandDiff = Math.round((ticketSum - appSum) * 100) / 100;
        const isPerfect = Math.abs(grandDiff) < 0.05 && matches.every(m => m.qtyDiff === 0);

        const mismatched = matches.filter(m => m.status !== 'BALANCED');
        const balanced = matches.filter(m => m.status === 'BALANCED');

        let bannerHtml = '';
        if (isPerfect) {
            bannerHtml = `
                <div class="audit-banner success">
                    🎉 <b>¡Enhorabuena! La cuenta está 100% cuadrada con el ticket del bar.</b><br>
                    Todos los artículos y cantidades coinciden exactamente.
                </div>
            `;
        } else if (grandDiff > 0) {
            bannerHtml = `
                <div class="audit-banner danger">
                    🔴 <b>Descuadre: El ticket del bar suma ${this.formatEuro(grandDiff)} MÁS que la app.</b><br>
                    Faltan consumiciones por apuntar. Revisa abajo los botones de asignación rápida.
                </div>
            `;
        } else {
            bannerHtml = `
                <div class="audit-banner warning">
                    🟠 <b>Descuadre: La app suma ${this.formatEuro(Math.abs(grandDiff))} MÁS que el ticket.</b><br>
                    Se apuntó algo de más en la mesa o el bar no lo ha cobrado.
                </div>
            `;
        }

        const renderItemCard = (m) => {
            const isMissing = m.status === 'MISSING_IN_APP';
            const isExtra = m.status === 'EXTRA_IN_APP';
            const isBalanced = m.status === 'BALANCED';

            let badgeClass = isBalanced ? 'balanced' : (isMissing ? 'missing' : 'extra');
            let badgeText = isBalanced
                ? '✓ Cuadrado'
                : (isMissing ? `Faltan ${m.qtyDiff} en app (+${this.formatEuro(m.priceDiff)})` : `Sobran ${Math.abs(m.qtyDiff)} en app (-${this.formatEuro(Math.abs(m.priceDiff))})`);

            const consumerEntries = Object.entries(m.consumers);
            let consumersLine = '';
            if (consumerEntries.length > 0) {
                const listStr = consumerEntries.map(([name, count]) => `<b>${name}</b> (${count})`).join(', ');
                consumersLine = `<div class="audit-consumers-line">👥 Pedido en la app por: ${listStr}</div>`;
            } else if (isMissing) {
                consumersLine = `<div class="audit-consumers-line" style="color:#f87171;">⚠️ Nadie en la mesa ha apuntado este artículo.</div>`;
            }

            let actionsHtml = '';
            const safeName = m.displayName.replace(/'/g, "\\'").replace(/"/g, '&quot;');
            const safePrice = Number(m.unitPrice || 0);

            if (isMissing) {
                let quickPills = '';
                consumerEntries.forEach(([cName]) => {
                    const cleanUser = cName === '💎 A escote' ? 'SHARED' : cName;
                    const safeUser = cleanUser.replace(/'/g, "\\'").replace(/"/g, '&quot;');
                    quickPills += `
                        <button class="audit-pill-btn" onclick="App.addAuditOrder('${safeName}', ${safePrice}, '${safeUser}')">
                            + ${cName}
                        </button>
                    `;
                });

                if (!m.consumers['💎 A escote']) {
                    quickPills += `
                        <button class="audit-pill-btn pill-shared" onclick="App.addAuditOrder('${safeName}', ${safePrice}, 'SHARED')">
                            + 💎 A escote
                        </button>
                    `;
                }

                quickPills += `
                    <button class="audit-pill-btn" onclick="App.showAuditAssignPicker('${safeName}', ${safePrice})" style="background: rgba(255,255,255,0.06); border-color: var(--glass-border);">
                        👤 Asignar a...
                    </button>
                `;

                actionsHtml = `
                    <div style="font-size: 0.76rem; color: var(--text-muted); margin-top: 0.4rem; font-weight: 600;">¿Quién se tomó lo que falta?</div>
                    <div class="audit-action-pills">${quickPills}</div>
                `;
            } else if (isExtra) {
                let removePills = '';
                consumerEntries.forEach(([cName]) => {
                    const cleanUser = cName === '💎 A escote' ? 'SHARED' : cName;
                    const safeUser = cleanUser.replace(/'/g, "\\'").replace(/"/g, '&quot;');
                    removePills += `
                        <button class="audit-pill-btn pill-remove" onclick="App.removeAuditOrder('${safeName}', '${safeUser}')">
                            - Quitar a ${cName}
                        </button>
                    `;
                });

                actionsHtml = `
                    <div style="font-size: 0.76rem; color: var(--text-muted); margin-top: 0.4rem; font-weight: 600;">Quitar de la app (sobrante):</div>
                    <div class="audit-action-pills">${removePills}</div>
                `;
            }

            let ticketQtyControls = '';
            if (m.ticketIndex !== null && m.ticketIndex !== undefined) {
                ticketQtyControls = `
                    <span style="font-size: 0.76rem; color: var(--text-muted); margin-left: 0.4rem;">
                        Ticket: 
                        <button class="audit-qty-btn" onclick="App.adjustAuditTicketItemQty(${m.ticketIndex}, -1)" title="Restar 1 en ticket">-</button>
                        <b>${m.tQty}</b>
                        <button class="audit-qty-btn" onclick="App.adjustAuditTicketItemQty(${m.ticketIndex}, 1)" title="Sumar 1 en ticket">+</button>
                    </span>
                `;
            }

            return `
                <div class="audit-item-card ${isBalanced ? 'is-balanced' : (isMissing ? 'is-missing' : 'is-extra')}">
                    <div class="audit-item-header">
                        <div>
                            <b style="font-size: 0.95rem; color: var(--text-main);">${m.displayName}</b>
                            <span style="font-size: 0.8rem; color: var(--text-muted); margin-left: 0.35rem;">(${this.formatEuro(m.unitPrice)})</span>
                        </div>
                        <span class="audit-badge ${badgeClass}">${badgeText}</span>
                    </div>
                    <div style="font-size: 0.82rem; margin-bottom: 0.35rem; display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            ${ticketQtyControls || `<span style="color:var(--text-muted); font-size: 0.76rem;">Ticket: <b>0</b></span>`}
                            <span style="margin: 0 0.4rem; color: var(--text-muted);">|</span>
                            <span style="font-size: 0.76rem; color: var(--text-muted);">App: <b>${m.aQty}</b> (${this.formatEuro(m.aQty * m.unitPrice)})</span>
                        </div>
                    </div>
                    ${consumersLine}
                    ${actionsHtml}
                </div>
            `;
        };

        const establishmentName = ticketData.establishment ? ` (${ticketData.establishment})` : '';

        const html = `
            <div class="audit-container">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <h3 style="margin: 0;">⚖️ Cuadre de Cuenta${establishmentName}</h3>
                </div>

                <div class="audit-summary-grid">
                    <div class="audit-summary-card">
                        <div class="audit-summary-label">Ticket Bar</div>
                        <div class="audit-summary-value" style="color: var(--primary);">${this.formatEuro(ticketSum)}</div>
                    </div>
                    <div class="audit-summary-card">
                        <div class="audit-summary-label">Total App</div>
                        <div class="audit-summary-value">${this.formatEuro(appSum)}</div>
                    </div>
                    <div class="audit-summary-card" style="border-color: ${isPerfect ? 'rgba(34,197,94,0.5)' : (grandDiff > 0 ? 'rgba(239,68,68,0.5)' : 'rgba(245,158,11,0.5)')};">
                        <div class="audit-summary-label">Diferencia</div>
                        <div class="audit-summary-value" style="color: ${isPerfect ? '#4ade80' : (grandDiff > 0 ? '#f87171' : '#fbbf24')};">
                            ${grandDiff > 0 ? '+' : ''}${this.formatEuro(grandDiff)}
                        </div>
                    </div>
                </div>

                ${bannerHtml}

                ${this.state.scannedTicketImageUrl ? `
                    <div style="margin-bottom: 0.25rem;">
                        <button onclick="App.toggleAuditPhotoPreview()" class="btn-secondary" style="width: 100%; padding: 0.45rem 0.75rem; font-size: 0.78rem; display: flex; justify-content: space-between; align-items: center;">
                            <span>📷 Ver foto del ticket escaneado</span>
                            <span id="audit-photo-toggle-icon">▼</span>
                        </button>
                        <div id="audit-photo-container" style="display: none; margin-top: 0.5rem; text-align: center; background: #000; border-radius: var(--radius-sm); overflow: hidden; max-height: 240px;">
                            <img src="${this.state.scannedTicketImageUrl}" alt="Ticket Bar" style="max-width: 100%; height: auto; max-height: 240px; object-fit: contain;">
                        </div>
                    </div>
                ` : ''}

                <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 0.25rem;">
                    <span style="font-size: 0.85rem; font-weight: 700; color: var(--text-main);">
                        ${mismatched.length > 0 ? `⚠️ Artículos con descuadre (${mismatched.length}):` : '✅ Todos los artículos cuadran'}
                    </span>
                    <button onclick="App.promptAddManualTicketItem()" style="background: none; border: none; color: var(--primary); font-size: 0.78rem; font-weight: 600; cursor: pointer; text-decoration: underline;">
                        + Añadir renglón al ticket
                    </button>
                </div>

                <div style="max-height: 48vh; overflow-y: auto; padding-right: 2px;">
                    ${mismatched.map(m => renderItemCard(m)).join('')}

                    ${balanced.length > 0 ? `
                        <div style="margin-top: 0.85rem; margin-bottom: 0.45rem; font-size: 0.82rem; font-weight: 700; color: #4ade80;">
                            ✓ Artículos perfectamente cuadrados (${balanced.length}):
                        </div>
                        ${balanced.map(m => renderItemCard(m)).join('')}
                    ` : ''}
                </div>

                <div style="display: flex; gap: 0.5rem; margin-top: 0.5rem; border-top: 1px solid var(--glass-border); padding-top: 0.75rem;">
                    <button class="btn-secondary" onclick="App.triggerCameraScan()" style="flex: 1; padding: 0.75rem; font-size: 0.85rem;">
                        🔄 Nueva foto
                    </button>
                    <button class="btn-secondary" onclick="App.showGeminiApiKeyModal()" style="padding: 0.75rem 0.85rem; font-size: 0.85rem;" title="Configurar clave Gemini">
                        ⚙️
                    </button>
                    <button class="btn-primary" onclick="App.closeModal()" style="flex: 1.2; padding: 0.75rem; font-weight: 700; font-size: 0.85rem;">
                        ${isPerfect ? '🎉 Listo' : 'Cerrar'}
                    </button>
                </div>
            </div>
        `;

        this.openModal(html);
    },

    toggleAuditPhotoPreview() {
        const container = document.getElementById('audit-photo-container');
        const icon = document.getElementById('audit-photo-toggle-icon');
        if (!container) return;
        if (container.style.display === 'none') {
            container.style.display = 'block';
            if (icon) icon.textContent = '▲';
        } else {
            container.style.display = 'none';
            if (icon) icon.textContent = '▼';
        }
    },

    async addAuditOrder(productName, price, targetUser) {
        if (!this.state.tableId) return;
        try {
            const orderRef = push(ref(this.db, `tables/${this.state.tableId}/orders`));
            await set(orderRef, {
                user: targetUser,
                orderedBy: this.state.user || 'Admin',
                productName: productName,
                price: Number(price || 0),
                timestamp: Date.now()
            });
        } catch (error) {
            console.error('Error añadiendo pedido desde auditoría:', error);
            alert('Error al añadir la consumición.');
        }
    },

    async removeAuditOrder(productName, targetUser) {
        if (!this.state.tableId) return;
        const targetLabel = targetUser === 'SHARED' ? 'a escote' : targetUser;
        if (!confirm(`¿Seguro que quieres borrar una consumición de "${productName}" de ${targetLabel}?`)) return;
        try {
            const orders = Object.entries(this.state.tableData?.orders || {});
            const normTarget = this.normalizeKey(productName);
            const matches = orders
                .filter(([id, o]) => (o.user === targetUser || (targetUser === 'SHARED' && o.user === 'SHARED')) && this.normalizeKey(o.productName) === normTarget)
                .sort((a, b) => (b[1].timestamp || 0) - (a[1].timestamp || 0));

            if (matches.length > 0) {
                const [orderId] = matches[0];
                const orderRef = ref(this.db, `tables/${this.state.tableId}/orders/${orderId}`);
                await set(orderRef, null);
            } else {
                alert(`No se encontró ningún pedido reciente de ${productName} para ${targetUser}.`);
            }
        } catch (error) {
            console.error('Error eliminando pedido desde auditoría:', error);
            alert('Error al retirar la consumición.');
        }
    },

    adjustAuditTicketItemQty(index, delta) {
        if (!this.state.scannedTicketData?.items?.[index]) return;
        const item = this.state.scannedTicketData.items[index];
        if (delta < 0 && (item.qty || 1) <= 1) {
            if (!confirm(`¿Seguro que quieres borrar "${item.name}" del ticket escaneado?`)) return;
        }
        const newQty = Math.max(0, (item.qty || 1) + delta);
        if (newQty === 0) {
            this.state.scannedTicketData.items.splice(index, 1);
        } else {
            item.qty = newQty;
            const unitPrice = item.unitPrice || 0;
            item.totalPrice = Math.round(newQty * unitPrice * 100) / 100;
        }
        this.renderTicketAuditModal();
    },

    promptAddManualTicketItem() {
        const name = prompt('Nombre del artículo del ticket:');
        if (!name || !name.trim()) return;
        const qtyStr = prompt('Cantidad en el ticket:', '1');
        const qty = parseInt(qtyStr) || 1;
        const priceStr = prompt('Precio total (€):', '0');
        const price = this.parseAmount(priceStr) || 0;

        if (!this.state.scannedTicketData) {
            this.state.scannedTicketData = { items: [], total: 0 };
        }

        this.state.scannedTicketData.items.push({
            name: name.trim(),
            qty,
            unitPrice: Math.round((price / (qty || 1)) * 100) / 100,
            totalPrice: price
        });
        this.renderTicketAuditModal();
    },

    showAuditAssignPicker(productName, price) {
        const participants = Object.values(this.state.tableData?.participants || {})
            .filter(p => p.status !== 'left');

        const safeName = productName.replace(/'/g, "\\'").replace(/"/g, '&quot;');

        let buttonsHtml = `
            <button class="participant-btn btn-shared" style="width: 100%; padding: 0.85rem; margin-bottom: 0.75rem;" onclick="App.addAuditOrder('${safeName}', ${price}, 'SHARED'); App.renderTicketAuditModal();">
                💎 A Escote (Todos)
            </button>
            <div class="participant-grid" style="margin-bottom: 1rem;">
        `;

        participants.forEach(p => {
            const safeUser = p.name.replace(/'/g, "\\'").replace(/"/g, '&quot;');
            const sizeClass = this.getNameLengthClass(p.name);
            buttonsHtml += `
                <button class="participant-btn ${sizeClass}" onclick="App.addAuditOrder('${safeName}', ${price}, '${safeUser}'); App.renderTicketAuditModal();">
                    ${p.name}
                </button>
            `;
        });
        buttonsHtml += `</div>`;

        const html = `
            <div style="text-align: left;">
                <h3 style="margin-bottom: 0.4rem;">➕ Asignar ${productName} (${this.formatEuro(price)})</h3>
                <p style="font-size: 0.88rem; color: var(--text-muted); margin-bottom: 1rem;">
                    Selecciona a quién se le suma esta consumición en la cuenta:
                </p>
                ${buttonsHtml}
                <button class="btn-secondary" onclick="App.renderTicketAuditModal()" style="width: 100%;">Volver al Cuadre</button>
            </div>
        `;

        this.openModal(html);
    },

    // ==========================================
    // HISTORIAL Y ARCHIVO DE QUEDADAS (MESAS Y FIESTAS)
    // ==========================================

    showHistoryView() {
        if (this.state.currentView !== 'history-view') {
            this.state.previousView = this.state.currentView || 'setup';
        }
        this.showView('history-view');
        this.loadHistory();
    },

    closeHistoryView() {
        const target = this.state.previousView || 'setup';
        this.showView(target);
    },

    switchHistoryTab(tab) {
        this.state.historyCurrentTab = tab;
        const tabTables = document.getElementById('history-tab-tables');
        const tabParties = document.getElementById('history-tab-parties');
        if (tabTables) tabTables.classList.toggle('active', tab === 'tables');
        if (tabParties) tabParties.classList.toggle('active', tab === 'parties');
        this.renderHistoryList();
    },

    filterHistory() {
        const input = document.getElementById('history-search-input');
        this.state.historySearchQuery = (input ? input.value : '').toLowerCase().trim();
        this.renderHistoryList();
    },

    extractDateFromTableId(id) {
        if (!id || typeof id !== 'string') return null;
        const m = id.match(/(\d{4})(\d{2})(\d{2})/);
        if (m) {
            const year = parseInt(m[1], 10);
            const month = parseInt(m[2], 10) - 1;
            const day = parseInt(m[3], 10);
            const d = new Date(year, month, day, 21, 0, 0);
            return isNaN(d.getTime()) ? null : d.getTime();
        }
        return null;
    },

    formatDateTime(timestamp) {
        if (!timestamp) return 'Fecha no registrada';
        const d = new Date(timestamp);
        if (isNaN(d.getTime())) return 'Fecha no registrada';
        return d.toLocaleDateString('es-ES', {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    },

    calculateHistoricalTableSummary(tableData) {
        const orders = Object.values(tableData.orders || {});
        const participants = Object.values(tableData.participants || {});
        const totalBill = orders.reduce((sum, o) => sum + (Number(o.price) || 0), 0);

        const userTotals = {};
        const userOrders = {};
        const alcoholByUser = {};

        participants.forEach(p => {
            if (p && p.name) {
                userTotals[p.name] = 0;
                userOrders[p.name] = [];
                alcoholByUser[p.name] = 0;
            }
        });

        const ticketItems = {};

        orders.forEach(o => {
            if (!o) return;
            const price = Number(o.price) || 0;
            const pName = o.productName || 'Consumición';

            if (!ticketItems[pName]) {
                ticketItems[pName] = { qty: 0, price: price, total: 0 };
            }
            ticketItems[pName].qty += 1;
            ticketItems[pName].total += price;

            // Alcohol puro
            const pureCl = (Number(o.cl) > 0 && Number(o.alcohol) > 0)
                ? (Number(o.cl) * (Number(o.alcohol) / 100))
                : 0;

            if (o.user === 'SHARED') {
                let bens = Array.isArray(o.beneficiaries) && o.beneficiaries.length > 0
                    ? o.beneficiaries
                    : participants.map(p => p.name);
                if (bens.length === 0) bens = ['Todos'];
                const share = price / bens.length;
                const shareAlc = pureCl / bens.length;
                bens.forEach(u => {
                    userTotals[u] = (userTotals[u] || 0) + share;
                    if (!userOrders[u]) userOrders[u] = [];
                    userOrders[u].push({ name: `${pName} (Escote)`, price: share, isShared: true });
                    alcoholByUser[u] = (alcoholByUser[u] || 0) + shareAlc;
                });
            } else if (o.user) {
                userTotals[o.user] = (userTotals[o.user] || 0) + price;
                if (!userOrders[o.user]) userOrders[o.user] = [];
                userOrders[o.user].push({ name: pName, price: price, isShared: false });
                alcoholByUser[o.user] = (alcoholByUser[o.user] || 0) + pureCl;
            }
        });

        const drinkers = Object.entries(alcoholByUser)
            .filter(([, cl]) => cl > 0.05)
            .sort((a, b) => b[1] - a[1]);

        return { totalBill, userTotals, userOrders, ticketItems, drinkers };
    },

    async loadHistory(forceRefresh = false) {
        const container = document.getElementById('history-list-container');
        if (container) {
            container.innerHTML = `
                <div style="text-align: center; padding: 2rem 1rem;">
                    <div class="loader" style="margin: 0 auto 1rem;"></div>
                    <p style="color: var(--text-muted); font-size: 0.9rem;">Cargando quedadas de Firebase...</p>
                </div>
            `;
        }

        try {
            // 1. Cargar mesas
            const tablesSnap = await get(ref(this.db, 'tables'));
            const tablesList = [];
            if (tablesSnap.exists()) {
                const allTables = tablesSnap.val();
                for (const [id, tData] of Object.entries(allTables)) {
                    if (!tData || id === 'null') continue;
                    const date = tData.finishedAt || tData.createdAt || this.extractDateFromTableId(id) || Date.now();
                    const orders = Object.values(tData.orders || {});
                    const totalAmount = orders.reduce((s, o) => s + (Number(o.price) || 0), 0);
                    const participantNames = Object.values(tData.participants || {}).map(p => p.name || '').filter(Boolean);

                    let topDrinker = null;
                    const alcMap = {};
                    orders.forEach(o => {
                        if (o && o.user && o.user !== 'SHARED' && Number(o.cl) > 0 && Number(o.alcohol) > 0) {
                            const clPure = Number(o.cl) * (Number(o.alcohol) / 100);
                            alcMap[o.user] = (alcMap[o.user] || 0) + clPure;
                        }
                    });
                    const sortedDrinkers = Object.entries(alcMap).sort((a, b) => b[1] - a[1]);
                    if (sortedDrinkers.length > 0) {
                        topDrinker = `${sortedDrinkers[0][0]} (${sortedDrinkers[0][1].toFixed(1)} cl)`;
                    }

                    tablesList.push({
                        id,
                        name: tData.name || id,
                        status: tData.status || 'closed',
                        date,
                        totalAmount,
                        participantCount: participantNames.length,
                        orderCount: orders.length,
                        participants: participantNames,
                        topDrinker,
                        raw: tData
                    });
                }
            }

            tablesList.sort((a, b) => b.date - a.date);
            this.state.historyTables = tablesList;

            // 2. Cargar fiestas
            const partiesSnap = await get(ref(this.db, 'party_pots'));
            const partiesList = [];
            if (partiesSnap.exists()) {
                const allParties = partiesSnap.val();
                for (const [id, pData] of Object.entries(allParties)) {
                    if (!pData || id === 'null') continue;
                    const date = pData.finishedAt || pData.createdAt || Date.now();
                    const history = Object.values(pData.history || {});
                    const expenses = history.filter(h => h.type === 'expense');
                    const incomes = history.filter(h => h.type === 'income');

                    const partyBalances = this.calculatePartyBalances(pData);
                    const totalSpent = partyBalances.totalSpent !== undefined 
                        ? Number(partyBalances.totalSpent) 
                        : (pData.totalSpent !== undefined ? Number(pData.totalSpent) : expenses.reduce((s, h) => s + (Number(h.amount) || 0), 0));
                    const totalDebts = (partyBalances.debts || []).reduce((s, d) => s + (Number(d.amount) || 0), 0);
                    const totalPaid = Math.max(0, totalSpent - totalDebts);

                    const participantNames = Object.values(pData.participants || {}).map(p => p.name || '').filter(Boolean);

                    partiesList.push({
                        id,
                        name: pData.name || id,
                        status: pData.status || 'finished',
                        date,
                        totalSpent,
                        totalPaid,
                        totalDebts,
                        participantCount: participantNames.length,
                        expenseCount: expenses.length,
                        participants: participantNames,
                        raw: pData
                    });
                }
            }

            partiesList.sort((a, b) => b.date - a.date);
            this.state.historyParties = partiesList;

            const badgeTables = document.getElementById('history-badge-tables');
            const badgeParties = document.getElementById('history-badge-parties');
            if (badgeTables) badgeTables.textContent = `(${tablesList.length})`;
            if (badgeParties) badgeParties.textContent = `(${partiesList.length})`;

            this.renderHistoryList();
        } catch (error) {
            console.error('Error cargando historial de Firebase:', error);
            if (container) {
                container.innerHTML = `
                    <div style="text-align: center; padding: 2rem 1rem; color: #ef4444;">
                        <p style="font-weight: 700; margin-bottom: 0.5rem;">⚠️ Error de conexión</p>
                        <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 1rem;">No se pudo conectar con Firebase para leer el historial.</p>
                        <button class="btn-primary" onclick="App.loadHistory(true)" style="padding: 0.5rem 1rem;">Reintentar</button>
                    </div>
                `;
            }
        }
    },

    renderHistoryList() {
        const container = document.getElementById('history-list-container');
        if (!container) return;

        const isTables = this.state.historyCurrentTab === 'tables';
        const rawList = isTables ? this.state.historyTables : this.state.historyParties;
        const q = this.state.historySearchQuery;

        const filtered = rawList.filter(item => {
            if (!q) return true;
            const nameMatch = (item.name || '').toLowerCase().includes(q);
            const idMatch = (item.id || '').toLowerCase().includes(q);
            const dateMatch = this.formatDateTime(item.date).toLowerCase().includes(q);
            const partMatch = (item.participants || []).some(p => p.toLowerCase().includes(q));
            return nameMatch || idMatch || dateMatch || partMatch;
        });

        if (filtered.length === 0) {
            container.innerHTML = `
                <div style="text-align: center; padding: 2.5rem 1rem;">
                    <div style="font-size: 2.5rem; margin-bottom: 0.5rem;">${isTables ? '🍻' : '🍹'}</div>
                    <p style="font-weight: 600; color: var(--text-main); margin-bottom: 0.25rem;">
                        ${q ? 'No se encontraron quedadas' : (isTables ? 'Aún no hay mesas registradas' : 'Aún no hay fiestas registradas')}
                    </p>
                    <p style="font-size: 0.82rem; color: var(--text-muted);">
                        ${q ? `No hay coincidencias con "${q}". Prueba con otro término.` : 'Cuando se cierren mesas o finalicen fiestas en la app, aparecerán aquí para consultarlas.'}
                    </p>
                </div>
            `;
            return;
        }

        let html = '';
        filtered.forEach(item => {
            const dateStr = this.formatDateTime(item.date);
            const isClosed = item.status === 'closed' || item.status === 'finished';

            if (isTables) {
                html += `
                    <div class="history-card glass" onclick="App.showHistoryTableDetail('${item.id}')" style="background: rgba(255,255,255,0.05); border: 1px solid var(--glass-border); border-radius: var(--radius-md); padding: 0.85rem 1rem; cursor: pointer; text-align: left;">
                        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem;">
                            <div style="flex: 1; overflow: hidden;">
                                <div style="display: flex; align-items: center; gap: 0.45rem; flex-wrap: wrap;">
                                    <span style="font-size: 1.25rem;">🍻</span>
                                    <span style="font-weight: 700; font-size: 1rem; color: var(--text-main, #ffffff);">${item.name}</span>
                                    <span style="font-size: 0.72rem; padding: 0.15rem 0.45rem; border-radius: 4px; font-weight: 600; ${isClosed ? 'background: rgba(107, 114, 128, 0.2); color: #9ca3af;' : 'background: rgba(16, 185, 129, 0.2); color: #34d399;'}">
                                        ${isClosed ? '🔒 Cerrada' : '🟢 Activa'}
                                    </span>
                                </div>
                                <div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 0.25rem;">
                                    📅 ${dateStr}
                                </div>
                            </div>
                            <div style="display: flex; align-items: center; gap: 0.5rem;">
                                <div style="text-align: right; white-space: nowrap;">
                                    <div style="font-size: 1.15rem; font-weight: 800; color: #10b981;">
                                        ${this.formatEuro(item.totalAmount)}
                                    </div>
                                    <div style="font-size: 0.72rem; color: var(--text-muted);">
                                        total
                                    </div>
                                </div>
                                <button type="button" class="btn-delete-small" onclick="event.stopPropagation(); App.deleteTableFromHistory('${item.id}')" title="Borrar mesa de Firebase" style="padding: 0.35rem 0.5rem; font-size: 0.95rem; border-radius: 6px; background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.35); color: #ef4444; cursor: pointer;">
                                    🗑️
                                </button>
                            </div>
                        </div>

                        <div style="display: flex; gap: 0.35rem; flex-wrap: wrap; margin-top: 0.6rem; align-items: center;">
                            <span style="font-size: 0.75rem; background: rgba(99, 102, 241, 0.15); color: #818cf8; padding: 0.18rem 0.45rem; border-radius: 4px; font-weight: 600;">
                                👥 ${item.participantCount} personas
                            </span>
                            <span style="font-size: 0.75rem; background: rgba(255, 255, 255, 0.08); color: var(--text-muted); padding: 0.18rem 0.45rem; border-radius: 4px;">
                                🛒 ${item.orderCount} consumiciones
                            </span>
                            ${item.topDrinker ? `
                                <span style="font-size: 0.75rem; background: rgba(245, 158, 11, 0.15); color: #fbbf24; padding: 0.18rem 0.45rem; border-radius: 4px; font-weight: 600;">
                                    🏆 ${item.topDrinker}
                                </span>
                            ` : ''}
                        </div>
                    </div>
                `;
            } else {
                html += `
                    <div class="history-card glass" onclick="App.showHistoryPartyDetail('${item.id}')" style="background: rgba(255,255,255,0.05); border: 1px solid var(--glass-border); border-radius: var(--radius-md); padding: 0.85rem 1rem; cursor: pointer; text-align: left;">
                        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem;">
                            <div style="flex: 1; overflow: hidden;">
                                <div style="display: flex; align-items: center; gap: 0.45rem; flex-wrap: wrap;">
                                    <span style="font-size: 1.25rem;">🍹</span>
                                    <span style="font-weight: 700; font-size: 1rem; color: var(--text-main, #ffffff);">${item.name}</span>
                                    <span style="font-size: 0.72rem; padding: 0.15rem 0.45rem; border-radius: 4px; font-weight: 600; ${isClosed ? 'background: rgba(107, 114, 128, 0.2); color: #9ca3af;' : 'background: rgba(16, 185, 129, 0.2); color: #34d399;'}">
                                        ${isClosed ? '🔒 Finalizada' : '🟢 En curso'}
                                    </span>
                                </div>
                                <div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 0.25rem;">
                                    📅 ${dateStr}
                                </div>
                            </div>
                            <div style="display: flex; align-items: center; gap: 0.5rem;">
                                <div style="text-align: right; white-space: nowrap;">
                                    <div style="font-size: 1.15rem; font-weight: 800; color: #f59e0b;">
                                        ${this.formatEuro(item.totalSpent)}
                                    </div>
                                    <div style="font-size: 0.72rem; color: var(--text-muted);">
                                        gastado
                                    </div>
                                </div>
                                <button type="button" class="btn-delete-small" onclick="event.stopPropagation(); App.deletePartyFromHistory('${item.id}')" title="Borrar fiesta de Firebase" style="padding: 0.35rem 0.5rem; font-size: 0.95rem; border-radius: 6px; background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.35); color: #ef4444; cursor: pointer;">
                                    🗑️
                                </button>
                            </div>
                        </div>

                        <div style="display: flex; gap: 0.35rem; flex-wrap: wrap; margin-top: 0.6rem; align-items: center;">
                            <span style="font-size: 0.75rem; background: rgba(16, 185, 129, 0.15); color: #34d399; padding: 0.18rem 0.45rem; border-radius: 4px; font-weight: 600;">
                                ✅ Pagado: ${this.formatEuro(item.totalPaid !== undefined ? item.totalPaid : item.totalSpent)}
                            </span>
                            ${item.totalDebts > 0.01 ? `
                                <span style="font-size: 0.75rem; background: rgba(99, 102, 241, 0.15); color: #818cf8; padding: 0.18rem 0.45rem; border-radius: 4px; font-weight: 600;">
                                    ⚖️ Deudas: ${this.formatEuro(item.totalDebts)}
                                </span>
                            ` : ''}
                            <span style="font-size: 0.75rem; background: rgba(255, 255, 255, 0.08); color: var(--text-muted); padding: 0.18rem 0.45rem; border-radius: 4px;">
                                👥 ${item.participantCount} amigos
                            </span>
                            <span style="font-size: 0.75rem; background: rgba(255, 255, 255, 0.08); color: var(--text-muted); padding: 0.18rem 0.45rem; border-radius: 4px;">
                                🛒 ${item.expenseCount} gastos
                            </span>
                        </div>
                    </div>
                `;
            }
        });

        container.innerHTML = html;
        this.initScrollFades();
    },

    showHistoryTableDetail(tableId) {
        const item = this.state.historyTables.find(t => t.id === tableId);
        if (!item || !item.raw) return alert('No se encontraron datos para esta mesa.');

        this.state.historyActiveDetailTab = this.state.historyActiveDetailTab || 'ticket';
        this.renderHistoryTableDetailModal(item);
    },

    switchHistoryModalTab(tab, tableId) {
        this.state.historyActiveDetailTab = tab;
        const item = this.state.historyTables.find(t => t.id === tableId);
        if (item) this.renderHistoryTableDetailModal(item);
    },

    renderHistoryTableDetailModal(item) {
        const raw = item.raw;
        const summary = this.calculateHistoricalTableSummary(raw);
        const dateStr = this.formatDateTime(item.date);
        const currentTab = this.state.historyActiveDetailTab || 'ticket';

        let bodyHtml = '';

        if (currentTab === 'ticket') {
            const ticketEntries = Object.entries(summary.ticketItems);
            if (ticketEntries.length === 0) {
                bodyHtml = '<p style="text-align: center; color: var(--text-muted); padding: 1.5rem 0;">No se registraron consumiciones en el ticket.</p>';
            } else {
                bodyHtml = `
                    <div style="background: rgba(0,0,0,0.2); border-radius: var(--radius-sm); padding: 0.75rem;">
                        <table style="width: 100%; border-collapse: collapse; font-size: 0.88rem; text-align: left;">
                            <thead>
                                <tr style="border-bottom: 1px solid var(--glass-border); color: var(--text-muted); font-size: 0.78rem;">
                                    <th style="padding: 0.4rem 0.2rem;">Cant.</th>
                                    <th style="padding: 0.4rem 0.2rem;">Artículo</th>
                                    <th style="padding: 0.4rem 0.2rem; text-align: right;">Precio</th>
                                    <th style="padding: 0.4rem 0.2rem; text-align: right;">Total</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${ticketEntries.map(([name, data]) => `
                                    <tr style="border-bottom: 1px solid rgba(255,255,255,0.04);">
                                        <td style="padding: 0.5rem 0.2rem; font-weight: 700; color: var(--primary);">${data.qty}x</td>
                                        <td style="padding: 0.5rem 0.2rem; font-weight: 600;">${name}</td>
                                        <td style="padding: 0.5rem 0.2rem; text-align: right; color: var(--text-muted);">${this.formatEuro(data.price)}</td>
                                        <td style="padding: 0.5rem 0.2rem; text-align: right; font-weight: 700;">${this.formatEuro(data.total)}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                `;
            }
        } else if (currentTab === 'cuentas') {
            const userEntries = Object.entries(summary.userTotals).sort((a, b) => b[1] - a[1]);
            if (userEntries.length === 0) {
                bodyHtml = '<p style="text-align: center; color: var(--text-muted); padding: 1.5rem 0;">No hay participantes registrados.</p>';
            } else {
                bodyHtml = `
                    <div style="display: flex; flex-direction: column; gap: 0.6rem;">
                        ${userEntries.map(([name, total]) => {
                            const orders = summary.userOrders[name] || [];
                            return `
                                <div style="background: rgba(255,255,255,0.04); border: 1px solid var(--glass-border); border-radius: var(--radius-sm); padding: 0.65rem 0.8rem; text-align: left;">
                                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.35rem;">
                                        <span style="font-weight: 700; font-size: 0.95rem; color: var(--text-main);">${name}</span>
                                        <span style="font-weight: 800; font-size: 1rem; color: #10b981;">${this.formatEuro(total)}</span>
                                    </div>
                                    <div style="font-size: 0.78rem; color: var(--text-muted); line-height: 1.4;">
                                        ${orders.length > 0 ? orders.map(o => `${o.name} (${this.formatEuro(o.price)})`).join(' · ') : 'Sin pedidos directos'}
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                `;
            }
        } else if (currentTab === 'borrachuzo') {
            if (summary.drinkers.length === 0) {
                bodyHtml = `
                    <div style="text-align: center; padding: 2rem 1rem;">
                        <span style="font-size: 2.5rem;">😇</span>
                        <p style="font-weight: 600; margin-top: 0.5rem;">¡Todos sobrios en esta mesa!</p>
                        <p style="font-size: 0.8rem; color: var(--text-muted);">No se registraron bebidas con graduación alcohólica.</p>
                    </div>
                `;
            } else {
                const maxAlc = summary.drinkers[0][1];
                const winners = summary.drinkers.filter(([, cl]) => Math.abs(cl - maxAlc) < 0.05).map(([n]) => n);
                const equivCanas = (maxAlc / 1.0).toFixed(1).replace('.0', '');

                bodyHtml = `
                    <div style="background: #fdf2f8; border: 2px solid #ec4899; border-radius: 12px; padding: 1rem; margin-bottom: 0.85rem; text-align: center;">
                        <p style="margin: 0 0 0.35rem; font-weight: 700; color: #be185d; font-size: 0.95rem;">
                            🏆 ${winners.length > 1 ? 'Borrachuzos' : 'Borrachuzo'}:
                        </p>
                        <p style="font-size: 1.25rem; margin: 0 0 0.25rem; color: #111827; font-weight: 800;">
                            🍺 ${winners.join(', ')}
                        </p>
                        <p style="color: #d97706; font-size: 1rem; margin: 0; font-weight: 700;">
                            ${maxAlc.toFixed(1)} cl <span style="font-size: 0.85rem; color: #4b5563; font-weight: 600;">(≈ ${equivCanas} cañas)</span>
                        </p>
                    </div>

                    <div style="display: flex; flex-direction: column; gap: 0.35rem;">
                        ${summary.drinkers.map(([name, pureCl], idx) => {
                            const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx + 1}º`;
                            const canas = (pureCl / 1.0).toFixed(1).replace('.0', '');
                            return `
                                <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.88rem; background: #ffffff; padding: 0.4rem 0.6rem; border-radius: 8px; border: 1px solid rgba(0,0,0,0.06); box-shadow: 0 1px 2px rgba(0,0,0,0.04);">
                                    <span style="color: #111827 !important; font-weight: 700; display: flex; align-items: center; gap: 0.4rem;">
                                        <span>${medal}</span>
                                        <span style="color: #111827 !important;">${name}</span>
                                    </span>
                                    <span style="font-weight: 700; color: #d97706;">
                                        ${pureCl.toFixed(1)} cl <span style="font-size: 0.78rem; color: #6b7280; font-weight: 500;">(≈${canas}🍺)</span>
                                    </span>
                                </div>
                            `;
                        }).join('')}
                    </div>
                `;
            }
        }

        const modalHtml = `
            <div class="modal-summary-shell">
                <div class="modal-summary-header">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem; margin-bottom: 0.35rem;">
                        <div>
                            <div style="display: flex; align-items: center; gap: 0.4rem;">
                                <span style="font-size: 1.3rem;">🍻</span>
                                <h3 style="margin: 0; font-size: 1.15rem; color: var(--text-main);">${item.name}</h3>
                            </div>
                            <div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 0.2rem;">
                                📅 ${dateStr}
                            </div>
                        </div>
                        <div style="text-align: right;">
                            <span style="font-size: 1.25rem; font-weight: 800; color: #10b981;">${this.formatEuro(summary.totalBill)}</span>
                            <div style="font-size: 0.7rem; color: var(--text-muted);">total cuenta</div>
                        </div>
                    </div>

                    <div style="display: inline-block; font-size: 0.72rem; padding: 0.2rem 0.55rem; background: rgba(99, 102, 241, 0.12); color: #818cf8; border-radius: 4px; font-weight: 600; margin-bottom: 0.65rem;">
                        🔒 Mesa Archivada en Firebase
                    </div>

                    <!-- Sub-pestañas -->
                    <div style="display: flex; gap: 0.35rem; margin-bottom: 0.5rem;">
                        <button type="button" class="modal-subtab-btn ${currentTab === 'ticket' ? 'active' : ''}" onclick="App.switchHistoryModalTab('ticket', '${item.id}')">
                            🧾 Ticket (${Object.keys(summary.ticketItems).length})
                        </button>
                        <button type="button" class="modal-subtab-btn ${currentTab === 'cuentas' ? 'active' : ''}" onclick="App.switchHistoryModalTab('cuentas', '${item.id}')">
                            👥 Cuentas (${Object.keys(summary.userTotals).length})
                        </button>
                        <button type="button" class="modal-subtab-btn ${currentTab === 'borrachuzo' ? 'active' : ''}" onclick="App.switchHistoryModalTab('borrachuzo', '${item.id}')">
                            🏆 Borrachuzo
                        </button>
                    </div>
                </div>

                <!-- Contenido con scroll independiente -->
                <div class="modal-summary-body scroll-fade-bottom">
                    ${bodyHtml}
                </div>

                <!-- Botones inferiores SIEMPRE visibles -->
                <div class="modal-summary-footer">
                    <button type="button" class="btn-primary" onclick="App.copyTableSummaryWhatsApp('${item.id}')" style="width: 100%; padding: 0.65rem; font-size: 0.88rem; font-weight: 700; background: #25D366; border: none; color: #ffffff; border-radius: 8px;">
                        📋 Copiar WhatsApp
                    </button>
                    <div class="modal-summary-footer-row">
                        <button type="button" class="btn-secondary" onclick="App.deleteTableFromHistory('${item.id}')" style="flex: 1; padding: 0.65rem 0.75rem; font-size: 0.88rem; background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.4); color: #ef4444; font-weight: 600; border-radius: 8px;">
                            🗑️ Borrar
                        </button>
                        <button type="button" class="btn-secondary" onclick="App.closeModal()" style="flex: 1.3; padding: 0.65rem 1rem; font-size: 0.88rem; font-weight: 700; border-radius: 8px;">
                            Cerrar
                        </button>
                    </div>
                </div>
            </div>
        `;

        this.openModal(modalHtml, true);
    },

    showHistoryPartyDetail(partyId) {
        const item = this.state.historyParties.find(p => p.id === partyId);
        if (!item || !item.raw) return alert('No se encontraron datos para esta fiesta.');

        this.state.historyActivePartyDetailTab = this.state.historyActivePartyDetailTab || 'balances';
        this.renderHistoryPartyDetailModal(item);
    },

    switchHistoryPartyModalTab(tab, partyId) {
        this.state.historyActivePartyDetailTab = tab;
        const item = this.state.historyParties.find(p => p.id === partyId);
        if (item) this.renderHistoryPartyDetailModal(item);
    },

    renderHistoryPartyDetailModal(item) {
        const raw = item.raw;
        const history = Object.values(raw.history || {}).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        const expenses = history.filter(h => h.type === 'expense');
        const settlements = history.filter(h => h.type === 'settlement');
        const incomes = history.filter(h => h.type === 'income');
        const dateStr = this.formatDateTime(item.date);
        const currentTab = this.state.historyActivePartyDetailTab || 'balances';

        // Usar cálculo financiero unificado de la fiesta
        const partyBalances = this.calculatePartyBalances(raw);
        const totalSpent = partyBalances.totalSpent !== undefined 
            ? Number(partyBalances.totalSpent) 
            : (item.totalSpent !== undefined ? Number(item.totalSpent) : expenses.reduce((s, h) => s + (Number(h.amount) || 0), 0));
        const totalDebts = (partyBalances.debts || []).reduce((s, d) => s + (Number(d.amount) || 0), 0);
        const totalPaid = Math.max(0, totalSpent - totalDebts);
        const debtsAmount = Math.max(0, totalSpent - totalPaid);

        let bodyHtml = '';

        if (currentTab === 'balances') {
            bodyHtml = `
                <div class="party-summary-grid" style="display: flex; gap: 0.5rem; margin-bottom: 0.85rem; text-align: center;">
                    <div class="party-summary-cell cell-spent" style="flex: 1; padding: 0.5rem; background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.25); border-radius: 6px;">
                        <span style="font-size: 0.72rem; color: #fbbf24; font-weight: 600; display: block;">Gastado</span>
                        <span style="font-weight: 800; font-size: 1rem; color: #f59e0b;">${this.formatEuro(totalSpent)}</span>
                    </div>
                    <div class="party-summary-cell cell-paid" style="flex: 1; padding: 0.5rem; background: rgba(16, 185, 129, 0.12); border: 1px solid rgba(16, 185, 129, 0.25); border-radius: 6px;">
                        <span style="font-size: 0.72rem; color: #34d399; font-weight: 600; display: block;">Pagado</span>
                        <span style="font-weight: 800; font-size: 1rem; color: #10b981;">${this.formatEuro(totalPaid)}</span>
                    </div>
                    <div class="party-summary-cell cell-debts" style="flex: 1; padding: 0.5rem; background: rgba(99, 102, 241, 0.12); border: 1px solid rgba(99, 102, 241, 0.25); border-radius: 6px;">
                        <span style="font-size: 0.72rem; color: #818cf8; font-weight: 600; display: block;">Deudas</span>
                        <span style="font-weight: 800; font-size: 1rem; color: #a5b4fc;">${this.formatEuro(debtsAmount)}</span>
                    </div>
                </div>

                ${partyBalances.debts && partyBalances.debts.length > 0 ? `
                    <div style="background: rgba(99, 102, 241, 0.08); border: 1px solid rgba(99, 102, 241, 0.25); border-radius: 8px; padding: 0.6rem 0.75rem; margin-bottom: 0.75rem;">
                        <span style="font-size: 0.75rem; text-transform: uppercase; font-weight: 700; color: #818cf8; display: block; margin-bottom: 0.35rem;">
                            ⚖️ Deudas pendientes de liquidar:
                        </span>
                        <div style="display: flex; flex-direction: column; gap: 0.25rem;">
                            ${partyBalances.debts.map(d => `
                                <div style="display: flex; justify-content: space-between; font-size: 0.85rem;">
                                    <span style="color: var(--text-main);"><b>${d.from}</b> debe pagar a <b>${d.to}</b></span>
                                    <b style="color: #ef4444;">${this.formatEuro(d.amount)}</b>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                ` : ''}

                <div style="display: flex; flex-direction: column; gap: 0.45rem;">
                    ${partyBalances.units.map(u => {
                        const isPlus = u.net >= 0.01;
                        const isMinus = u.net <= -0.01;
                        const color = isPlus ? '#10b981' : (isMinus ? '#ef4444' : 'var(--text-muted)');
                        const label = isPlus ? `Le deben ${this.formatEuro(u.net)}` : (isMinus ? `Debe ${this.formatEuro(Math.abs(u.net))}` : 'En paz (0 €)');
                        let subDetails = `Pagó: ${this.formatEuro(u.paid)} · Consumió: ${this.formatEuro(u.spent)}`;
                        if (u.settlementPaid > 0) subDetails += ` · Reembolsó: +${this.formatEuro(u.settlementPaid)}`;
                        if (u.settlementReceived > 0) subDetails += ` · Cobró: -${this.formatEuro(u.settlementReceived)}`;
                        return `
                            <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.04); border: 1px solid var(--glass-border); border-radius: var(--radius-sm); padding: 0.55rem 0.75rem;">
                                <div>
                                    <span style="font-weight: 700; font-size: 0.92rem; color: var(--text-main);">${u.displayName} ${u.isCouple ? '<span class="badge-couple">💑 Pareja</span>' : ''}</span>
                                    <div style="font-size: 0.74rem; color: var(--text-muted);">
                                        ${subDetails}
                                    </div>
                                </div>
                                <div style="text-align: right; font-weight: 800; font-size: 0.92rem; color: ${color};">
                                    ${label}
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            `;
        } else if (currentTab === 'expenses') {
            if (expenses.length === 0) {
                bodyHtml = '<p style="text-align: center; color: var(--text-muted); padding: 1.5rem 0;">No hay gastos registrados en esta fiesta.</p>';
            } else {
                bodyHtml = `
                    <div style="display: flex; flex-direction: column; gap: 0.5rem;">
                        ${expenses.map(exp => `
                            <div style="background: rgba(255,255,255,0.04); border: 1px solid var(--glass-border); border-radius: var(--radius-sm); padding: 0.6rem 0.8rem; text-align: left;">
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.2rem;">
                                    <span style="font-weight: 600; font-size: 0.92rem;">${exp.description || 'Gasto'}</span>
                                    <span style="font-weight: 800; font-size: 0.95rem; color: #ef4444;">-${this.formatEuro(exp.amount || 0)}</span>
                                </div>
                                <div style="font-size: 0.75rem; color: var(--text-muted);">
                                    ${exp.payer ? `Pagado por <b>${exp.payer}</b>` : ''} 
                                    ${exp.beneficiaries ? `(${exp.beneficiaries.length} beneficiarios)` : '(Todos)'}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                `;
            }
        } else if (currentTab === 'settlements' || currentTab === 'incomes') {
            if (settlements.length === 0 && incomes.length === 0) {
                bodyHtml = '<p style="text-align: center; color: var(--text-muted); padding: 1.5rem 0;">No hay pagos ni reembolsos registrados.</p>';
            } else if (settlements.length > 0) {
                bodyHtml = `
                    <div style="display: flex; flex-direction: column; gap: 0.5rem;">
                        ${settlements.map(s => `
                            <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.04); border: 1px solid var(--glass-border); border-radius: var(--radius-sm); padding: 0.6rem 0.8rem;">
                                <div>
                                    <span style="font-weight: 700; font-size: 0.92rem; color: var(--text-main);"><b>${s.from}</b> pagó a <b>${s.to}</b></span>
                                    <div style="font-size: 0.74rem; color: var(--text-muted);">${s.description || 'Reembolso liquidado'}</div>
                                </div>
                                <span style="font-weight: 800; font-size: 0.95rem; color: #10b981;">+${this.formatEuro(s.amount || 0)}</span>
                            </div>
                        `).join('')}
                    </div>
                `;
            } else {
                bodyHtml = `
                    <div style="display: flex; flex-direction: column; gap: 0.5rem;">
                        ${incomes.map(inc => `
                            <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.04); border: 1px solid var(--glass-border); border-radius: var(--radius-sm); padding: 0.6rem 0.8rem;">
                                <div>
                                    <span style="font-weight: 700; font-size: 0.92rem;">${inc.friend || inc.user || 'Amigo'}</span>
                                    <div style="font-size: 0.74rem; color: var(--text-muted);">${inc.description || 'Aporte al bote'}</div>
                                </div>
                                <span style="font-weight: 800; font-size: 0.95rem; color: #10b981;">+${this.formatEuro(inc.amount || 0)}</span>
                            </div>
                        `).join('')}
                    </div>
                `;
            }
        }

        const modalHtml = `
            <div class="modal-summary-shell">
                <div class="modal-summary-header">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem; margin-bottom: 0.35rem;">
                        <div>
                            <div style="display: flex; align-items: center; gap: 0.4rem;">
                                <span style="font-size: 1.3rem;">🍹</span>
                                <h3 style="margin: 0; font-size: 1.15rem; color: var(--text-main);">${item.name}</h3>
                            </div>
                            <div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 0.2rem;">
                                📅 ${dateStr}
                            </div>
                        </div>
                        <div style="text-align: right;">
                            <span style="font-size: 1.25rem; font-weight: 800; color: #f59e0b;">${this.formatEuro(totalSpent)}</span>
                            <div style="font-size: 0.7rem; color: var(--text-muted);">gastado total</div>
                        </div>
                    </div>

                    <div style="display: inline-block; font-size: 0.72rem; padding: 0.2rem 0.55rem; background: rgba(245, 158, 11, 0.12); color: #fbbf24; border-radius: 4px; font-weight: 600; margin-bottom: 0.65rem;">
                        🔒 Fiesta Archivada en Firebase
                    </div>

                    <!-- Sub-pestañas -->
                    <div style="display: flex; gap: 0.35rem; margin-bottom: 0.5rem;">
                        <button type="button" class="modal-subtab-btn ${currentTab === 'balances' ? 'active' : ''}" onclick="App.switchHistoryPartyModalTab('balances', '${item.id}')">
                            ⚖️ Saldos (${partyBalances.units.length})
                        </button>
                        <button type="button" class="modal-subtab-btn ${currentTab === 'expenses' ? 'active' : ''}" onclick="App.switchHistoryPartyModalTab('expenses', '${item.id}')">
                            🛒 Gastos (${expenses.length})
                        </button>
                        ${settlements.length > 0 ? `
                            <button type="button" class="modal-subtab-btn ${currentTab === 'settlements' ? 'active' : ''}" onclick="App.switchHistoryPartyModalTab('settlements', '${item.id}')">
                                💳 Pagos (${settlements.length})
                            </button>
                        ` : (incomes.length > 0 ? `
                            <button type="button" class="modal-subtab-btn ${currentTab === 'incomes' ? 'active' : ''}" onclick="App.switchHistoryPartyModalTab('incomes', '${item.id}')">
                                💰 Bote (${incomes.length})
                            </button>
                        ` : '')}
                    </div>
                </div>

                <!-- Contenido con scroll independiente -->
                <div class="modal-summary-body scroll-fade-bottom">
                    ${bodyHtml}
                </div>

                <!-- Botones inferiores SIEMPRE visibles -->
                <div class="modal-summary-footer">
                    <button type="button" class="btn-primary" onclick="App.copyPartySummaryWhatsApp('${item.id}')" style="width: 100%; padding: 0.65rem; font-size: 0.88rem; font-weight: 700; background: #25D366; border: none; color: #ffffff; border-radius: 8px;">
                        📋 Copiar WhatsApp
                    </button>
                    <div class="modal-summary-footer-row">
                        <button type="button" class="btn-secondary" onclick="App.deletePartyFromHistory('${item.id}')" style="flex: 1; padding: 0.65rem 0.75rem; font-size: 0.88rem; background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.4); color: #ef4444; font-weight: 600; border-radius: 8px;">
                            🗑️ Borrar
                        </button>
                        <button type="button" class="btn-secondary" onclick="App.closeModal()" style="flex: 1.3; padding: 0.65rem 1rem; font-size: 0.88rem; font-weight: 700; border-radius: 8px;">
                            Cerrar
                        </button>
                    </div>
                </div>
            </div>
        `;

        this.openModal(modalHtml, true);
    },

    async copyTableSummaryWhatsApp(tableId) {
        const item = this.state.historyTables.find(t => t.id === tableId);
        if (!item || !item.raw) return;

        const summary = this.calculateHistoricalTableSummary(item.raw);
        const dateStr = this.formatDateTime(item.date);

        let text = `🍻 *RESUMEN DE CUENTA - ${item.name.toUpperCase()}*\n`;
        text += `📅 Fecha: ${dateStr}\n`;
        text += `💶 *Total cuenta:* ${this.formatEuro(summary.totalBill)}\n\n`;

        text += `👥 *CUENTAS POR PERSONA:*\n`;
        Object.entries(summary.userTotals)
            .sort((a, b) => b[1] - a[1])
            .forEach(([user, tot]) => {
                text += `• ${user}: ${this.formatEuro(tot)}\n`;
            });

        if (summary.drinkers.length > 0) {
            const maxAlc = summary.drinkers[0][1];
            const winners = summary.drinkers.filter(([, cl]) => Math.abs(cl - maxAlc) < 0.05).map(([n]) => n);
            const equiv = (maxAlc / 1.0).toFixed(1).replace('.0', '');
            text += `\n🏆 *Borrachuzo del día:* ${winners.join(', ')} (${maxAlc.toFixed(1)} cl · ≈${equiv} cañas)\n`;
        }

        text += `\n_Generado con Thermo Bandapp_ 📱`;

        try {
            await navigator.clipboard.writeText(text);
            alert('¡Resumen de la mesa copiado al portapapeles! Listo para pegar en WhatsApp 📋');
        } catch (e) {
            prompt('Copia el resumen para WhatsApp:', text);
        }
    },

    async copyPartySummaryWhatsApp(partyId) {
        const item = this.state.historyParties.find(p => p.id === partyId);
        if (!item || !item.raw) return;

        const partyBalances = this.calculatePartyBalances(item.raw);
        const totalSpent = partyBalances.totalSpent !== undefined 
            ? Number(partyBalances.totalSpent) 
            : (item.totalSpent !== undefined ? Number(item.totalSpent) : 0);
        const totalDebts = (partyBalances.debts || []).reduce((s, d) => s + (Number(d.amount) || 0), 0);
        const totalPaid = Math.max(0, totalSpent - totalDebts);

        const dateStr = this.formatDateTime(item.date);
        let text = `🍹 *RESUMEN DE FIESTA - ${item.name.toUpperCase()}*\n`;
        text += `📅 Fecha: ${dateStr}\n`;
        text += `💸 Gastado: ${this.formatEuro(totalSpent)}\n`;
        text += `✅ Pagado: ${this.formatEuro(totalPaid)}\n`;
        text += `⚖️ Deudas: ${this.formatEuro(totalDebts)}\n\n`;

        if (partyBalances.debts && partyBalances.debts.length > 0) {
            text += `*DEUDAS PENDIENTES:*\n`;
            partyBalances.debts.forEach(d => {
                text += `• ${d.from} debe ${this.formatEuro(d.amount)} a ${d.to}\n`;
            });
            text += `\n`;
        }

        text += `_Generado con Thermo Bandapp_ 📱`;

        try {
            await navigator.clipboard.writeText(text);
            alert('¡Resumen de la fiesta copiado al portapapeles! Listo para pegar en WhatsApp 📋');
        } catch (e) {
            prompt('Copia el resumen para WhatsApp:', text);
        }
    },

    async deleteTableFromHistory(tableId) {
        const item = this.state.historyTables.find(t => t.id === tableId);
        const name = item ? item.name : tableId;

        if (!confirm(`⚠️ ¿Seguro que quieres borrar la mesa "${name}" definitivamente de Firebase?\n\nEsta acción eliminará todos sus pedidos y datos para siempre.`)) {
            return;
        }

        try {
            await set(ref(this.db, `tables/${tableId}`), null);
            await this.addLog('delete_table', { tableId, name });

            if (this.state.tableId === tableId) {
                this.state.tableId = null;
                this.state.tableData = null;
                localStorage.removeItem('thermo_tableId');
            }

            this.state.historyTables = this.state.historyTables.filter(t => t.id !== tableId);

            const badgeTables = document.getElementById('history-badge-tables');
            if (badgeTables) badgeTables.textContent = `(${this.state.historyTables.length})`;

            this.closeModal();
            this.renderHistoryList();
        } catch (error) {
            console.error('Error al borrar la mesa de Firebase:', error);
            alert('Error al borrar la mesa de la base de datos.');
        }
    },

    async deletePartyFromHistory(partyId) {
        const item = this.state.historyParties.find(p => p.id === partyId);
        const name = item ? item.name : partyId;

        if (!confirm(`⚠️ ¿Seguro que quieres borrar la fiesta "${name}" definitivamente de Firebase?\n\nEsta acción eliminará su bote, gastos y saldos para siempre.`)) {
            return;
        }

        try {
            await set(ref(this.db, `party_pots/${partyId}`), null);
            await this.addLog('delete_party', { partyId, name });

            if (this.state.partyId === partyId) {
                this.state.partyId = null;
                this.state.partyData = null;
                localStorage.removeItem('thermo_partyId');
            }

            this.state.historyParties = this.state.historyParties.filter(p => p.id !== partyId);

            const badgeParties = document.getElementById('history-badge-parties');
            if (badgeParties) badgeParties.textContent = `(${this.state.historyParties.length})`;

            this.closeModal();
            this.renderHistoryList();
        } catch (error) {
            console.error('Error al borrar la fiesta de Firebase:', error);
            alert('Error al borrar la fiesta de la base de datos.');
        }
    }
};

window.App = App;
document.addEventListener('DOMContentLoaded', () => App.init());
