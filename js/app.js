import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, set, onValue, push, get } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

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
        couples: {}
    },

    init() {
        console.log('Thermo Bandapp inicializada 🍻');
        this.initFirebase();
        this.cacheDOM();
        this.bindEvents();
        this.loadLocalSession();
        this.initDecimalNormalizer();
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
        return parseFloat(String(value).replace(',', '.'));
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
            'login-view': document.getElementById('login-view')
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
            leaveTable: document.getElementById('btn-leave-table'),
            createParty: document.getElementById('btn-create-party-main'),
            addPartyMoney: document.getElementById('btn-party-add-money'),
            addPartyExpense: document.getElementById('btn-party-add-expense'),
            addPartyFriend: document.getElementById('btn-party-add-friend'),
            partyGoHome: document.getElementById('btn-party-go-home'),
            loginSubmit: document.getElementById('btn-login-submit'),
            adminSaveMember: document.getElementById('btn-admin-save-member'),
            showTicket: document.getElementById('btn-show-ticket')
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
        this.buttons.leaveTable.addEventListener('click', () => this.handleLeaveTable());
        document.getElementById('btn-close-modal').addEventListener('click', () => this.closeModal());
        this.display.finishTable.addEventListener('click', () => this.handleFinishTable());
        this.display.addFriendManual.addEventListener('click', () => this.handleAddFriendManual());
        if (this.buttons.showTicket) {
            this.buttons.showTicket.addEventListener('click', () => this.handleShowTicket());
        }
        
        this.buttons.createParty.addEventListener('click', () => this.handleCreatePartyFromSetup());
        document.getElementById('btn-join-party-main').addEventListener('click', () => this.handleJoinPartyFromSetup());
        this.buttons.addPartyMoney.addEventListener('click', () => this.handlePartyAddMoney());
        this.buttons.addPartyExpense.addEventListener('click', () => this.handlePartyAddExpense());
        this.buttons.addPartyFriend.addEventListener('click', () => this.handlePartyAddFriend());
        this.buttons.partyGoHome.addEventListener('click', () => this.handlePartyGoHome());
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
        if (headerUserName && this.state.user) {
            headerUserName.textContent = this.state.user;
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

    async handleAddProductMenu() {
        const name = prompt('Nombre del producto (ej: Caña):');
        if (!name) return;
        const price = parseFloat(prompt('Precio (€):', '2.50'));
        if (isNaN(price)) return;
        const icon = prompt('Emoji (opcional):', '🍺');

        const productRef = push(ref(this.db, `tables/${this.state.tableId}/menu`));
        const productData = { name, price, icon };
        await set(productRef, productData);

        // Sincronizar con la biblioteca del bar
        const barName = this.state.tableData.name.split(' (Mesa')[0].trim();
        const barMenuRef = ref(this.db, `bar_menus/${barName.replace(/\s/g, '_')}/${productRef.key}`);
        await set(barMenuRef, productData);
    },

    async handleEditProduct(id, item) {
        const name = prompt('Nuevo nombre:', item.name);
        if (!name) return;
        const price = parseFloat(prompt('Nuevo precio:', item.price));
        if (isNaN(price)) return;
        const icon = prompt('Nuevo emoji:', item.icon);

        const productData = { name, price, icon };
        
        await set(ref(this.db, `tables/${this.state.tableId}/menu/${id}`), productData);

        const barName = this.state.tableData.name.split(' (Mesa')[0].trim();
        await set(ref(this.db, `bar_menus/${barName.replace(/\s/g, '_')}/${id}`), productData);
    },

    async handleDeleteProduct(id, item) {
        if (!confirm(`¿Seguro que quieres borrar el producto "${item.name}" del menú?`)) return;
        try {
            await set(ref(this.db, `tables/${this.state.tableId}/menu/${id}`), null);
            const barName = this.state.tableData.name.split(' (Mesa')[0].trim();
            await set(ref(this.db, `bar_menus/${barName.replace(/\s/g, '_')}/${id}`), null);
        } catch (error) {
            console.error('Error al borrar el producto:', error);
            alert('Error al borrar el producto.');
        }
    },

    async addOrder(product, targetUsers) {
        const users = Array.isArray(targetUsers) ? targetUsers : [targetUsers];
        for (const targetUser of users) {
            const orderRef = push(ref(this.db, `tables/${this.state.tableId}/orders`));
            await set(orderRef, {
                user: targetUser,
                orderedBy: this.state.user,
                productName: product.name,
                price: product.price,
                timestamp: Date.now()
            });
        }
        this.closeModal();
    },

    async handleSharedOrder(product) {
        const qtyStr = prompt(`¿Cuántas unidades de ${product.name} a escote?`, '1');
        if (!qtyStr) return;
        const qty = parseInt(qtyStr);
        if (isNaN(qty) || qty <= 0) return;

        for (let i = 0; i < qty; i++) {
            await this.addOrder(product, 'SHARED');
        }
    },

    async handleDeleteOrder(orderId) {
        if (!confirm('¿Seguro que quieres borrar este pedido?')) return;
        try {
            const orderRef = ref(this.db, `tables/${this.state.tableId}/orders/${orderId}`);
            await set(orderRef, null);
            this.closeModal();
        } catch (error) {
            console.error('Error al borrar pedido:', error);
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

                const partnerName = this.isPartnerAtTable(p.name, participants);
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
                        <div class="p-info">
                            <span class="p-name">${p.name} y ${partnerName} <span class="badge-couple">💑 Pareja</span></span>
                            <div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 0.15rem;">
                                ${p.name}: ${ind1.toFixed(2)}€ · ${partnerName}: ${ind2.toFixed(2)}€
                            </div>
                        </div>
                        <span class="p-amount">${combinedAmount.toFixed(2)}€</span>
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
                        <div class="p-info">
                            <span class="p-name">${p.name} <span class="badge-couple">💑 Pareja</span></span>
                            <div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 0.15rem;">
                                ${p.name}: ${myAmount.toFixed(2)}€ + ${partnerName} <small>(fuera)</small>: ${partnerAmount.toFixed(2)}€
                            </div>
                        </div>
                        <span class="p-amount">${combinedAmount.toFixed(2)}€</span>
                    `;
                    div.onclick = () => this.showCoupleDetail(p.name, partnerName);
                    this.display.participants.appendChild(div);

                } else if (partnerObj && p.status === 'left' && partnerObj.status !== 'left') {
                    // p se fue, la pareja sigue activa → se muestra en la fila del activo, saltar este
                    processedKeys.add(pKey);
                    // NO añadir partnerObj aquí, se procesará cuando le toque en el forEach

                } else {
                    // Individual (sin pareja en la mesa, o ambos fuera)
                    processedKeys.add(pKey);
                    const amount = totals[p.name] || 0;
                    const isLeft = p.status === 'left';
                    const partnerRegistered = this.getPartner(p.name);
                    const div = document.createElement('div');
                    div.className = `participant-item glass ${isLeft ? 'is-left' : ''}`;
                    div.style.cursor = 'pointer';
                    div.innerHTML = `
                        <div class="p-info">
                            <span class="p-name">${p.name} ${isLeft ? '<small>(Fuera)</small>' : ''} ${partnerRegistered && !isLeft ? `<span style="font-size: 0.75rem; color: var(--text-muted); margin-left: 0.25rem;">(💑 ${partnerRegistered})</span>` : ''}</span>
                            <span class="p-role">${p.role === 'admin' ? '🚩' : (isLeft ? '🏁' : '👤')}</span>
                        </div>
                        <span class="p-amount">${amount.toFixed(2)}€</span>
                    `;
                    div.onclick = () => this.showParticipantDetail(p.name);
                    this.display.participants.appendChild(div);
                }
            });
        }
    },

    showCoupleDetail(name1, name2) {
        const data = this.state.tableData;
        if (!data || !data.orders) return;
        
        const getPersonDetail = (name) => {
            const participants = Object.values(data.participants || {});
            const pInfo = participants.find(p => p.name === name);
            const tableStart = Number(data.createdAt || 0);
            const myJoinTime = Number(pInfo?.joinedAt || tableStart);
            let ordersHtml = '';
            let total = 0;
            let count = 0;

            Object.entries(data.orders).forEach(([id, o]) => {
                let price = 0;
                let label = '';
                const orderTime = Number(o.timestamp || tableStart);

                if (o.user === 'SHARED') {
                    if (myJoinTime <= orderTime) {
                        const presentCount = participants.filter(p => Number(p.joinedAt || tableStart) <= orderTime).length || 1;
                        price = Number(o.price) / presentCount;
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
                    ordersHtml += `
                        <div class="detail-row" style="display: flex; justify-content: space-between; padding: 0.4rem 0; border-bottom: 1px solid rgba(255,255,255,0.05);">
                            <span style="font-size: 0.9rem;">${label} ${orderHour ? `<small style="color:var(--text-muted)">(${orderHour})</small>` : ''}</span>
                            <span style="font-weight: 600;">${price.toFixed(2)}€</span>
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

        const html = `
            <h3>Consumo de Pareja: ${name1} y ${name2} 💑</h3>
            <div style="margin: 1rem 0; padding: 0.75rem; background: rgba(236,72,153,0.1); border-radius: var(--radius-sm); border: 1px solid rgba(236,72,153,0.25); text-align: center;">
                <span style="font-size: 0.85rem; color: var(--text-muted);">Total Acumulado Pareja:</span>
                <div style="font-size: 1.6rem; font-weight: 700; color: #f472b6;">${totalCouple.toFixed(2)}€</div>
            </div>
            
            <div style="max-height: 45vh; overflow-y: auto; text-align: left;">
                <h4 style="color: var(--primary); margin-top: 0.8rem; margin-bottom: 0.4rem; font-size: 0.95rem;">Consumos de ${name1} (${d1.total.toFixed(2)}€):</h4>
                <div>${d1.ordersHtml}</div>
                
                <h4 style="color: var(--primary); margin-top: 1rem; margin-bottom: 0.4rem; font-size: 0.95rem;">Consumos de ${name2} (${d2.total.toFixed(2)}€):</h4>
                <div>${d2.ordersHtml}</div>
            </div>

            <div style="margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid var(--glass-border); display: flex; flex-direction: column; gap: 0.6rem;">
                <div style="font-size: 0.85rem; color: var(--text-muted); text-align: center; margin-bottom: 0.2rem;">
                    Gestionar asistencia a la mesa:
                </div>
                <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
                    <button class="btn-secondary" style="flex: 1; min-width: 130px; padding: 0.65rem 0.5rem; font-size: 0.85rem; border-color: rgba(239, 68, 68, 0.4); color: #fca5a5;" onclick="App.kickParticipant('${safeName1}')">
                        🚪 Sacar a ${name1}
                    </button>
                    <button class="btn-secondary" style="flex: 1; min-width: 130px; padding: 0.65rem 0.5rem; font-size: 0.85rem; border-color: rgba(239, 68, 68, 0.4); color: #fca5a5;" onclick="App.kickParticipant('${safeName2}')">
                        🚪 Sacar a ${name2}
                    </button>
                </div>
                <button class="btn-primary" style="background: var(--danger); padding: 0.65rem; font-size: 0.9rem; width: 100%;" onclick="App.kickCouple('${safeName1}', '${safeName2}')">
                    🚪 Sacar a ambos de la mesa
                </button>
                <button onclick="App.closeModal()" class="btn-secondary" style="margin-top: 0.3rem; width: 100%;">
                    Cerrar
                </button>
            </div>
        `;
        this.openModal(html);
    },

    updateMenuUI() {
        const menu = this.state.tableData.menu;
        this.display.menu.innerHTML = '';
        if (!menu) {
            this.display.menu.innerHTML = '<p class="empty-msg">Pulsa "Nuevo" para añadir productos.</p>';
            return;
        }

        Object.entries(menu).forEach(([id, item]) => {
            const div = document.createElement('div');
            div.className = 'menu-item glass';
            div.innerHTML = `
                <button class="btn-edit-small" data-id="${id}">✏️</button>
                <button class="btn-delete-menu-small" data-id="${id}">🗑️</button>
                <span class="item-icon">${item.icon || '🍴'}</span>
                <span class="item-name">${item.name}</span>
                <span class="item-price">${item.price.toFixed(2)}€</span>
            `;
            div.onclick = (e) => {
                if (e.target.classList.contains('btn-edit-small') || e.target.classList.contains('btn-delete-menu-small')) return;
                this.showParticipantSelector(item);
            };
            div.querySelector('.btn-edit-small').onclick = (e) => {
                e.stopPropagation();
                this.handleEditProduct(id, item);
            };
            div.querySelector('.btn-delete-menu-small').onclick = (e) => {
                e.stopPropagation();
                this.handleDeleteProduct(id, item);
            };
            this.display.menu.appendChild(div);
        });
    },

    updateOrdersUI() {
        const orders = this.state.tableData.orders;
        this.display.recentOrders.innerHTML = '';
        if (!orders) return;

        const sortedOrders = Object.entries(orders).sort((a, b) => b[1].timestamp - a[1].timestamp).slice(0, 8);
        sortedOrders.forEach(([id, o]) => {
            const div = document.createElement('div');
            div.className = 'order-row';
            div.innerHTML = `
                <span><b>${o.user === 'SHARED' ? '💎 Todos' : o.user}</b>: ${o.productName}</span>
                <div class="order-actions">
                    <span>${o.price.toFixed(2)}€</span>
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
        const partner = this.isPartnerAtTable(this.state.user);
        const myShareLabelEl = document.querySelector('#my-share + .stat-label');
        if (partner) {
            const partnerTotal = allTotals[partner] || 0;
            myTotal += partnerTotal;
            if (myShareLabelEl) myShareLabelEl.innerHTML = `Tu parte <span class="badge-couple" style="margin-left: 4px;">💑 +${partner}</span>`;
        } else {
            if (myShareLabelEl) myShareLabelEl.textContent = 'Tu parte';
        }

        this.display.totalBill.textContent = `${totalBill.toFixed(2)}€`;
        this.display.myShare.textContent = `${myTotal.toFixed(2)}€`;
    },

    calculateAllIndividualTotals() {
        const data = this.state.tableData;
        if (!data) return {};
        
        const totals = {};
        const participants = Object.values(data.participants || {});
        const tableStart = Number(data.createdAt || 0);
        
        participants.forEach(p => {
            totals[p.name] = 0;
        });
        
        if (data.orders) {
            Object.values(data.orders).forEach(o => {
                const orderTime = Number(o.timestamp || tableStart);
                const price = Number(o.price || 0);

                if (o.user === 'SHARED') {
                    const present = participants.filter(p => Number(p.joinedAt || tableStart) <= orderTime);
                    const count = present.length || 1;
                    const share = price / count;
                    present.forEach(p => totals[p.name] = (totals[p.name] || 0) + share);
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
                if (myJoinTime <= orderTime) {
                    const presentCount = participants.filter(p => Number(p.joinedAt || tableStart) <= orderTime).length || 1;
                    price = Number(o.price) / presentCount;
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
                                <span>${price.toFixed(2)}€</span>
                                <button class="btn-delete-small" onclick="App.handleDeleteOrder('${id}')">🗑️</button>
                            </div>
                        </div>
                        ${metaInfo}
                    </div>
                `;
            }
        });

        if (!hasOrders) html += `<p class="empty-msg">Aún no ha pedido nada.</p>`;
        else html += `<div class="order-row total-row"><span><b>TOTAL</b></span><span><b>${total.toFixed(2)}€</b></span></div>`;
        html += `</div>`;

        if (pInfo?.status === 'active') {
            html += `<button class="btn-primary" style="background: var(--danger); margin-top: 1rem; width: 100%;" onclick="App.kickParticipant('${name.replace(/'/g, "\\'")}')">Sacar de la mesa 🚪</button>`;
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
                html += `<p class="refund-amount">Puedes reclamar ${refundable.toFixed(2)}€ del bote.</p>`;
            }
            html += `<button class="btn-primary" onclick="App.claimRefund('${name}')">Reclamar sobrante</button>`;
        }
        this.openModal(html);
    },

    showParticipantSelector(product) {
        const participants = Object.values(this.state.tableData.participants);
        this.state.tempSelection = [];
        let html = `<h3>¿Para quién es ${product.icon} ${product.name}?</h3><div class="participant-grid">`;
        html += `<button class="participant-btn btn-shared" style="grid-column: span 2;" onclick="App.handleSharedOrder(${JSON.stringify(product).replace(/"/g, '&quot;')})">💎 A Escote (Todos)</button>`;
        participants.forEach(p => {
            const isMe = p.name === this.state.user;
            html += `<button id="p-btn-${p.name.replace(/\s/g, '_')}" class="participant-btn ${isMe ? 'is-me' : ''}" onclick="App.toggleParticipantSelection('${p.name.replace(/'/g, "\\'")}')">${p.name}</button>`;
        });
        html += `</div><button id="btn-confirm-order" class="btn-primary" onclick="App.confirmMultiOrder(${JSON.stringify(product).replace(/"/g, '&quot;')})">Confirmar Pedido (0)</button>`;
        this.openModal(html);
    },

    toggleParticipantSelection(name) {
        const idx = this.state.tempSelection.indexOf(name);
        const btn = document.getElementById(`p-btn-${name.replace(/\s/g, '_')}`);
        if (idx > -1) {
            this.state.tempSelection.splice(idx, 1);
            btn.classList.remove('selected');
        } else {
            this.state.tempSelection.push(name);
            btn.classList.add('selected');
        }
        document.getElementById('btn-confirm-order').textContent = `Confirmar Pedido (${this.state.tempSelection.length})`;
    },

    confirmMultiOrder(product) {
        if (this.state.tempSelection.length === 0) return alert('Selecciona al menos a una persona.');
        this.addOrder(product, this.state.tempSelection);
    },

    handleRepeatRoundSelector() {
        const participants = Object.values(this.state.tableData.participants || {});
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

        this.state.tempRepeatSelection = [];
        
        let html = `<h3>Otra ronda de lo mismo 🔁</h3>`;
        html += `<p class="subtitle" style="margin-bottom: 1rem; text-align: center;">¿Quiénes quieren repetir su último pedido?</p>`;
        html += `<div class="participant-grid">`;
        
        participants.forEach(p => {
            const lastOrder = participantLastOrders[p.name];
            const isMe = p.name === this.state.user;
            const disabled = !lastOrder;
            const detailText = lastOrder ? lastOrder.productName : 'Sin pedidos';
            
            html += `
                <button id="rep-btn-${p.name.replace(/\s/g, '_')}" 
                        class="participant-btn ${isMe && lastOrder ? 'is-me' : ''} ${disabled ? 'disabled' : ''}" 
                        ${disabled ? 'disabled style="opacity: 0.4; cursor: not-allowed;"' : ''} 
                        onclick="App.toggleRepeatSelection('${p.name.replace(/'/g, "\\'")}')">
                    <div style="font-weight: bold;">${p.name}</div>
                    <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.25rem;">${detailText}</div>
                </button>
            `;
        });
        
        html += `</div>`;
        html += `<button id="btn-confirm-repeat" class="btn-primary" onclick="App.confirmRepeatRound(${JSON.stringify(participantLastOrders).replace(/"/g, '&quot;')})">Repetir pedidos (0)</button>`;
        
        this.openModal(html);
    },

    toggleRepeatSelection(name) {
        if (!this.state.tempRepeatSelection) this.state.tempRepeatSelection = [];
        const idx = this.state.tempRepeatSelection.indexOf(name);
        const btn = document.getElementById(`rep-btn-${name.replace(/\s/g, '_')}`);
        if (idx > -1) {
            this.state.tempRepeatSelection.splice(idx, 1);
            btn.classList.remove('selected');
        } else {
            this.state.tempRepeatSelection.push(name);
            btn.classList.add('selected');
        }
        document.getElementById('btn-confirm-repeat').textContent = `Repetir pedidos (${this.state.tempRepeatSelection.length})`;
    },

    async confirmRepeatRound(participantLastOrders) {
        if (!this.state.tempRepeatSelection || this.state.tempRepeatSelection.length === 0) {
            return alert('Selecciona al menos a una persona.');
        }

        try {
            for (const name of this.state.tempRepeatSelection) {
                const lastOrder = participantLastOrders[name];
                if (lastOrder) {
                    const productMock = {
                        name: lastOrder.productName,
                        price: lastOrder.price
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

            const partnerName = this.isPartnerAtTable(p.name, participants);
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
                    breakdown: `Debe ${p.name}: ${owed1.toFixed(2)}€ · Debe ${partnerName}: ${owed2.toFixed(2)}€`
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
                    breakdown: `${p.name}: ${owed1.toFixed(2)}€ + ${partnerName} (fuera): ${owed2.toFixed(2)}€`
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
                    <span>A pagar: <b>${g.owed.toFixed(2)}€</b></span>
                    <span style="font-size: 0.78rem; color: var(--text-muted);">Puesto: ${g.put.toFixed(2)}€</span>
                    <span class="balance" style="color: ${balance > 0.01 ? '#3b82f6' : (isSettled ? '#22c55e' : '#f59e0b')}">
                        ${balance > 0.01 ? `Sobran ${balance.toFixed(2)}€` : (isSettled ? '✓ Pagado' : `Faltan ${(Math.abs(balance)).toFixed(2)}€`)}
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
                    <span>${Number(c.amount).toFixed(2)}€</span>
                    <button class="btn-calc-small" style="font-size: 0.8rem; padding: 0.2rem 0.4rem;" onclick="App.editContribution('${c.id}', ${c.amount}, '${c.user.replace(/'/g, "\\'")}')">✏️</button>
                    <button class="btn-calc-small" style="font-size: 0.8rem; padding: 0.2rem 0.4rem; color: var(--danger);" onclick="App.deleteContribution('${c.id}')">❌</button>
                </div>
            `;
            listContainer.appendChild(div);
        });

        const diff = totalTicket - totalPot;
        document.getElementById('group-total-bill').textContent = `${totalTicket.toFixed(2)}€`;
        document.getElementById('pot-amount').textContent = `${totalPot.toFixed(2)}€`;
        const diffLabel = document.getElementById('pot-diff-label');
        const diffValue = document.getElementById('pot-diff-value');
        const diffContainer = document.getElementById('pot-difference-container');
        
        if (diff > 0.01) {
            diffLabel.textContent = 'Faltan';
            diffValue.textContent = `${diff.toFixed(2)}€`;
            diffContainer.className = 'pot-item status-error';
        } else if (diff < -0.01) {
            diffLabel.textContent = 'Sobran';
            diffValue.textContent = `${Math.abs(diff).toFixed(2)}€`;
            diffContainer.className = 'pot-item status-ok';
        } else {
            diffLabel.textContent = '¡Cuadra!';
            diffValue.textContent = '0.00€';
            diffContainer.className = 'pot-item status-ok';
        }
    },

    showQuickChange(name, owed) {
        const bill = prompt(`¿Cuánto vas a poner?`, '20');
        if (!bill) return;
        const paid = parseFloat(bill);
        if (isNaN(paid)) return;
        
        const change = paid - owed;
        if (change < 0) {
            alert(`¡Ojo! ${paid.toFixed(2)}€ no llega para pagar los ${owed.toFixed(2)}€ que debe.`);
        } else {
            alert(`${name}, tienes que coger ${change.toFixed(2)}€ del bote común.\n\nLuego anota en la app que has puesto tus ${owed.toFixed(2)}€.`);
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

            const partnerName = this.isPartnerAtTable(p.name, participants);
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
                    breakdown: `${p.name} (${amt1.toFixed(2)}€) + ${partnerName} (${amt2.toFixed(2)}€)`
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
                    breakdown: `${p.name} (${amt1.toFixed(2)}€) + ${partnerName} fuera (${amt2.toFixed(2)}€)`
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
                        <span class="p-amount">A pagar: ${unit.amount.toFixed(2)}€</span>
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
            resultElement.innerHTML = `<span style="color: var(--danger)">Faltan ${(Math.abs(change)).toFixed(2)}€</span>`;
        } else if (change === 0) {
            resultElement.innerHTML = `<span style="color: #22c55e">✓ Pagado exacto</span>`;
        } else {
            resultElement.innerHTML = `<span>Cambio: <b>${change.toFixed(2)}€</b></span>`;
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
        if (viewName === 'setup' || viewName === 'login-view' || viewName === 'admin-view') {
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
                const leaveSpan = this.buttons.leaveTable.querySelector('span:first-child');
                if (leaveSpan) leaveSpan.textContent = 'Dejar la fiesta';
            } else {
                barButtons.forEach(b => b.classList.remove('hidden'));
                partyButtons.forEach(b => b.classList.add('hidden'));
                // Restaurar texto a "Dejar la mesa"
                const leaveSpan = this.buttons.leaveTable.querySelector('span:first-child');
                if (leaveSpan) leaveSpan.textContent = 'Dejar la mesa';
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

        const barName = data.name ? data.name.split(' (Mesa')[0].trim() : 'Mesa';
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
                    <span class="t-name">${name} <span style="color: #555; font-size: 0.8em; margin-left: 0.2rem;">(${itemData.price.toFixed(2)}€)</span></span>
                    <span class="t-price">${sum.toFixed(2)}€</span>
                </div>
            `;
        });

        const html = `
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
                        <span>${total.toFixed(2)}€</span>
                    </div>
                </div>
            </div>
            <div class="actions" style="margin-top: 1.5rem;">
                <button onclick="App.closeModal()" class="btn-primary">Cerrar Ticket</button>
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
        // Contar rondas individuales (excluir SHARED)
        const orders = Object.values(data.orders || {});
        const countByUser = {};
        orders.forEach(o => {
            if (o.user && o.user !== 'SHARED') {
                countByUser[o.user] = (countByUser[o.user] || 0) + 1;
            }
        });

        let borrachuzosHTML = '';
        if (Object.keys(countByUser).length === 0) {
            borrachuzosHTML = '<p style="margin:0.5rem 0;">Nadie pidió rondas 😅</p>';
        } else {
            const maxCount = Math.max(...Object.values(countByUser));
            const winners = Object.entries(countByUser)
                .filter(([, c]) => c === maxCount)
                .map(([name]) => name);
            borrachuzosHTML = `
                <p style="font-size:1.1rem;margin:0.5rem 0 0.25rem;">
                    🍺 <strong>${winners.join(', ')}</strong>
                </p>
                <p style="color:#6b7280;font-size:0.85rem;margin:0;">
                    (${maxCount} ronda${maxCount !== 1 ? 's' : ''})
                </p>`;
        }

        const html = `
            <div style="text-align:center;padding:0.5rem 0 1rem;">
                <div style="font-size:2.5rem;margin-bottom:0.5rem;">🎉</div>
                <h2 style="margin:0 0 0.25rem;font-size:1.3rem;">¡Mesa cerrada!</h2>
                <p style="margin:0 0 1rem;color:#6b7280;font-size:0.9rem;">¡Hasta la próxima quedada! 🍻</p>
                <div style="background:#fdf2f8;border:2px solid #ec4899;border-radius:12px;padding:1rem;margin-bottom:1.25rem;">
                    <p style="margin:0 0 0.4rem;font-weight:700;color:#be185d;font-size:1rem;">
                        🏆 Borrachuzo(s) del día:
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

        // Disparar confeti
        if (typeof confetti === 'function') {
            confetti({ particleCount: 160, spread: 90, origin: { y: 0.6 } });
            setTimeout(() => confetti({ particleCount: 80, spread: 120, origin: { y: 0.4 } }), 600);
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
            
            let html = `<h3>Añadir Amigos a la Mesa</h3>`;
            html += `<p class="subtitle" style="margin-bottom: 1rem;">Selecciona los miembros que quieres añadir:</p>`;
            html += `<div class="participant-grid" style="max-height: 40vh; overflow-y: auto;">`;
            
            availableMembers.forEach(m => {
                const safeName = m.name.replace(/'/g, "\\'").replace(/"/g, "&quot;");
                const idName = m.name.replace(/\s/g, '_');
                html += `<button id="f-btn-${idName}" class="participant-btn" onclick="App.toggleFriendSelection('${safeName}')">${m.name}</button>`;
            });
            
            if (availableMembers.length === 0) {
                html += `<p class="empty-msg" style="grid-column: span 2;">Todos los miembros ya están en la mesa.</p>`;
            }
            
            html += `</div>`;
            
            html += `
                <div style="margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid var(--glass-border);">
                    <p class="subtitle" style="margin-bottom: 0.5rem; color: var(--text-main);">¿No es miembro? Añádelo manualmente:</p>
                    <input type="text" id="custom-friend-name" placeholder="Escribe un nombre..." style="margin-bottom: 1rem;">
                </div>
            `;
            
            html += `<button id="btn-confirm-add-friends" class="btn-primary" onclick="App.confirmAddFriends()">Añadir a la mesa (0)</button>`;

            this.openModal(html);
        } catch (error) {
            console.error('Error al cargar miembros:', error);
            alert('Error al conectar con la base de datos.');
        }
    },

    toggleFriendSelection(name) {
        const idx = this.state.tempSelectionFriends.indexOf(name);
        const btn = document.getElementById(`f-btn-${name.replace(/\s/g, '_')}`);
        if (idx > -1) {
            this.state.tempSelectionFriends.splice(idx, 1);
            btn.classList.remove('selected');
        } else {
            this.state.tempSelectionFriends.push(name);
            btn.classList.add('selected');
        }
        
        const count = this.state.tempSelectionFriends.length;
        document.getElementById('btn-confirm-add-friends').textContent = `Añadir a la mesa (${count})`;
    },

    async confirmAddFriends() {
        const customNameInput = document.getElementById('custom-friend-name')?.value.trim();
        const selected = [...(this.state.tempSelectionFriends || [])];
        
        if (customNameInput) {
            // Si se ha escrito un amigo nuevo, preguntamos si es pareja de alguien
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
                    html += `
                        <button class="participant-btn" onclick="App.finalizeAddFriendWithCouple('${safeNewFriend}', '${safeName}', ${safeOtherSelected}, ${isParty})" style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 0.6rem 0.4rem; height: auto;">
                            <span style="font-weight: 600;">${m.name}</span>
                            <small style="font-size: 0.68rem; color: #22c55e;">(Sin pareja)</small>
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
        try {
            // 1. Guardar pareja en Firebase si se seleccionó
            if (partnerName) {
                await this.setCouple(newFriendName, partnerName);
            }
            
            // 2. Registrar el nuevo amigo en members si no existe
            const key = this.normalizeKey(newFriendName);
            const memberSnap = await get(ref(this.db, `members/${key}`));
            if (!memberSnap.exists()) {
                await set(ref(this.db, `members/${key}`), {
                    name: newFriendName,
                    code: `${newFriendName}_Thermobanda`
                });
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
                this.state.partyData = data;
                this.updatePartyUI();
                document.getElementById('party-pot-setup').classList.add('hidden');
                document.getElementById('party-pot-active').classList.remove('hidden');
            }
        });
    },

    updatePartyUI() {
        const data = this.state.partyData;
        const balance = (data.totalCollected || 0) - (data.totalSpent || 0);
        
        document.getElementById('party-code-badge').textContent = `CÓDIGO: ${this.state.partyId}`;
        document.getElementById('party-balance').textContent = `${balance.toFixed(2)}€`;
        document.getElementById('party-total-collected').textContent = `${(data.totalCollected || 0).toFixed(2)}€`;
        document.getElementById('party-total-spent').textContent = `${(data.totalSpent || 0).toFixed(2)}€`;

        // 1. Lista de Participantes
        const friendsContainer = document.getElementById('party-participants-list');
        friendsContainer.innerHTML = '';
        
        // Calcular aportes por persona
        const individualAports = {};
        if (data.participants) {
            Object.values(data.participants).forEach(p => individualAports[p.name] = 0);
        }
        if (data.history) {
            Object.values(data.history).forEach(item => {
                if (item.type === 'income') {
                    const name = item.description.replace('Aporte de ', '');
                    individualAports[name] = (individualAports[name] || 0) + item.amount;
                }
            });
        }

        Object.entries(individualAports).forEach(([name, amount]) => {
            const isCustodian = data.custodian === name;
            const pData = data.participants[name.replace(/\./g, '_')];
            const hasLeft = pData?.status === 'left';
            
            const div = document.createElement('div');
            div.className = `participant-item glass ${hasLeft ? 'is-left' : ''}`;
            div.style.cursor = 'pointer';
            if (hasLeft) {
                div.onclick = () => this.showPartyRefundModal(name);
            } else {
                div.onclick = () => this.showPartyParticipantOptions(name);
            }
            div.innerHTML = `
                <div class="p-info">
                    <span class="p-name">${name} ${isCustodian ? '🚩' : ''} ${hasLeft ? '<small>(Fuera) 💸</small>' : ''}</span>
                </div>
                <div class="p-amount">${amount.toFixed(2)}€</div>
            `;
            friendsContainer.appendChild(div);
        });

        if (Object.keys(individualAports).length === 0) {
            friendsContainer.innerHTML = '<div class="empty-msg">Pulsa en "Añadir Amigo" para empezar la lista</div>';
        }

        // 2. Historial
        const historyContainer = document.getElementById('party-history');
        historyContainer.innerHTML = '';
        
        if (data.history) {
            Object.values(data.history).sort((a,b) => b.timestamp - a.timestamp).forEach(item => {
                const div = document.createElement('div');
                div.className = `history-item ${item.type}`;
                div.innerHTML = `
                    <div class="info">
                        <b>${item.description}</b><br>
                        <small>${new Date(item.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} por ${item.user}</small>
                    </div>
                    <span class="amount">${item.type === 'income' ? '+' : '-'}${item.amount.toFixed(2)}€</span>
                `;
                historyContainer.appendChild(div);
            });
        }
    },
    showPartyParticipantOptions(name) {
        const isCustodian = this.state.partyData?.custodian === name;
        const isMe = name === this.state.user;
        let html = `<h3>👤 ${name}</h3>`;
        html += `<div style="display: flex; flex-direction: column; gap: 0.75rem; margin-top: 1rem;">`;

        if (!isCustodian) {
            html += `<button class="btn-secondary" onclick="App.closeModal(); App.handleTransferCustody('${name}')">🚩 Pasarle la banderola (y el dinero)</button>`;
        }

        if (!isMe) {
            html += `<button class="btn-danger" style="background: rgba(239,68,68,0.15); border-color: rgba(239,68,68,0.4); color: #f87171;" onclick="App.closeModal(); App.markParticipantAsLeft('${name}')">&#128682; Marcar que se ha ido a casa</button>`;
        }

        html += `</div>`;
        this.openModal(html);
    },

    async markParticipantAsLeft(name) {
        if (!confirm(`¿Seguro que quieres marcar a ${name} como que se ha ido?`)) return;
        try {
            const key = name.replace(/\./g, '_');
            const participantRef = ref(this.db, `party_pots/${this.state.partyId}/participants/${key}`);
            const currentData = this.state.partyData?.participants?.[key] || {};
            await set(participantRef, { ...currentData, name, status: 'left', leftAt: Date.now() });
            // Registrar en historial
            const historyRef = push(ref(this.db, `party_pots/${this.state.partyId}/history`));
            await set(historyRef, {
                type: 'system',
                amount: 0,
                description: `🚶 ${name} se fue a casa`,
                user: this.state.user,
                timestamp: Date.now()
            });
        } catch (error) { console.error('Error marcando como ido:', error); }
    },

    showPartyRefundModal(name) {
        const data = this.state.partyData;
        if (!data) return;
        const totalCollected = data.totalCollected || 0;
        const balance = totalCollected - (data.totalSpent || 0);
        const pData = data.participants?.[name.replace(/\./g, '_')];
        const alreadyRefunded = pData?.refunded;

        // Calcular aportes individuales
        const individualAports = {};
        if (data.history) {
            Object.values(data.history).forEach(item => {
                if (item.type === 'income') {
                    const n = item.description.replace('Aporte de ', '');
                    individualAports[n] = (individualAports[n] || 0) + item.amount;
                }
            });
        }
        const aport = individualAports[name] || 0;
        const refundable = (balance > 0 && totalCollected > 0)
            ? (balance * aport) / totalCollected
            : 0;

        let html = `<h3>💸 ${name} se fue antes</h3>`;
        html += `<p style="color: var(--text-muted); margin-bottom: 1rem;">Aportó al bote: <b>${aport.toFixed(2)}€</b></p>`;

        if (alreadyRefunded) {
            html += `<p style="color: var(--success);">✅ Ya reclamó su sobrante.</p>`;
        } else if (refundable > 0.01) {
            html += `
                <div style="background: rgba(99,102,241,0.15); border-radius: 12px; padding: 1rem; margin-bottom: 1rem; text-align: center;">
                    <p style="color: var(--text-muted); font-size: 0.85rem; margin-bottom: 0.3rem;">Le corresponde del sobrante:</p>
                    <span style="font-size: 1.8rem; font-weight: 700; color: #818cf8;">${refundable.toFixed(2)}€</span>
                </div>
                <p style="font-size: 0.82rem; color: var(--text-muted); margin-bottom: 1rem;">
                    Calculado proporcionalmente según su aporte (${aport.toFixed(2)}€ de ${totalCollected.toFixed(2)}€ totales recaudados).
                </p>
                <button class="btn-primary" style="width: 100%;" onclick="App.claimRefund('${name}')">Reclamar ${refundable.toFixed(2)}€</button>
            `;
        } else {
            html += `<p style="color: var(--text-muted);">No hay sobrante para repartir ahora mismo.</p>`;
        }

        this.openModal(html);
    },

    async handlePartyGoHome() {
        const data = this.state.partyData;
        const totalCollected = data.totalCollected || 0;
        const balance = totalCollected - (data.totalSpent || 0);
        
        // Calcular aportes individuales
        const individualAports = {};
        if (data.participants) {
            Object.values(data.participants).forEach(p => individualAports[p.name] = 0);
        }
        if (data.history) {
            Object.values(data.history).forEach(item => {
                if (item.type === 'income') {
                    const name = item.description.replace('Aporte de ', '');
                    individualAports[name] = (individualAports[name] || 0) + item.amount;
                }
            });
        }
        
        const participants = data.participants ? Object.values(data.participants) : [];
        
        let refundHtml = '';
        if (balance > 0.01 && totalCollected > 0 && participants.length > 0) {
            refundHtml = `
                <div class="summary-card glass" style="padding: 1.2rem; border-radius: 15px; margin-bottom: 1.5rem; border-color: rgba(99, 102, 241, 0.4);">
                    <h3 style="text-align: center; margin-bottom: 0.75rem; color: #818cf8; font-size: 1.1rem; display: flex; align-items: center; justify-content: center; gap: 8px;">
                        <span>💸 Reparto Proporcional</span>
                    </h3>
                    <p style="font-size: 0.8rem; color: var(--text-muted); text-align: center; margin-bottom: 0.75rem;">
                        Devolución calculada según el aporte de cada amigo al bote.
                    </p>
                    <div style="max-height: 180px; overflow-y: auto; padding-right: 0.5rem; display: flex; flex-direction: column; gap: 0.35rem;">
            `;
            
            // Ordenar por devolución de mayor a menor
            const sortedParticipants = participants.map(p => {
                const aport = individualAports[p.name] || 0;
                const refund = (balance * aport) / totalCollected;
                return { name: p.name, aport, refund };
            }).sort((a, b) => b.refund - a.refund);
            
            sortedParticipants.forEach(p => {
                refundHtml += `
                    <div style="display: flex; justify-content: space-between; font-size: 0.9rem; padding: 0.35rem 0.5rem; border-radius: 6px; background: rgba(255,255,255,0.02); align-items: center;">
                        <div style="display: flex; flex-direction: column;">
                            <span style="color: var(--text-main); font-weight: 500;">${p.name}</span>
                            <span style="font-size: 0.7rem; color: var(--text-muted);">Aportó: ${p.aport.toFixed(2)}€</span>
                        </div>
                        <span style="color: ${p.refund > 0.01 ? 'var(--success)' : 'var(--text-muted)'}; font-weight: 600;">
                            ${p.refund > 0.01 ? `+${p.refund.toFixed(2)}€` : '0.00€'}
                        </span>
                    </div>
                `;
            });
            
            refundHtml += `
                    </div>
                </div>
            `;
        }
        
        let summaryHtml = `
            <style>#btn-close-modal { display: none !important; }</style>
            <div class="final-summary">
                <h2 style="text-align: center; margin-bottom: 1.5rem;">🎊 Resumen Final 🎊</h2>
                <div class="summary-card glass" style="padding: 1.5rem; border-radius: 15px; margin-bottom: 1.5rem;">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
                        <span>Total Recaudado:</span>
                        <b style="color: var(--success);">${(data.totalCollected || 0).toFixed(2)}€</b>
                    </div>
                    <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
                        <span>Total Gastado:</span>
                        <b style="color: var(--danger);">${(data.totalSpent || 0).toFixed(2)}€</b>
                    </div>
                    <hr style="border: none; border-top: 1px dashed var(--glass-border); margin: 1rem 0;">
                    <div style="display: flex; justify-content: space-between; font-size: 1.2rem;">
                        <span>Sobran en el bote:</span>
                        <b style="color: var(--primary);">${balance.toFixed(2)}€</b>
                    </div>
                </div>
                ${refundHtml}
                <p style="text-align: center; font-size: 0.9rem; color: var(--text-muted); margin-bottom: 1.5rem;">
                    ¡Buena noche, amigos! 👋
                </p>
                <div class="actions" style="display: flex; gap: 1rem;">
                    <button onclick="App.closeModal()" class="btn-secondary" style="flex: 1;">Volver</button>
                    <button onclick="App.handleFinalCloseParty()" class="btn-primary" style="flex: 1;">Cerrar y Salir</button>
                </div>
            </div>
        `;
        
        this.openModal(summaryHtml, true);
    },

    async handleFinalCloseParty() {
        if (!confirm('¿Cerrar la fiesta definitivamente? El código dejará de funcionar.')) return;
        
        try {
            const currentId = this.state.partyId;
            await set(ref(this.db, `party_pots/${currentId}/status`), 'finished');
            
            localStorage.removeItem('thermo_partyId');
            this.state.partyId = null;
            
            await this.addLog('close_party', { partyId: currentId });
            location.reload();
        } catch (error) { console.error('Error cerrando fiesta:', error); }
    },

    async handleTransferCustody(name) {
        if (this.state.partyData.custodian === name) return; // Ya es el custodio
        
        if (!confirm(`¿Quieres pasarle la banderola (y el dinero físico) a ${name}?`)) return;
        
        try {
            await set(ref(this.db, `party_pots/${this.state.partyId}/custodian`), name);
            
            // Añadir al historial
            const historyRef = push(ref(this.db, `party_pots/${this.state.partyId}/history`));
            await set(historyRef, {
                type: 'system',
                amount: 0,
                description: `🚩 El bote pasa a manos de ${name}`,
                user: this.state.user,
                timestamp: Date.now()
            });
        } catch (error) { console.error(error); }
    },

    // Claim refund for a participant who left early
    async claimRefund(name) {
        const data = this.state.partyData;
        const totalCollected = data.totalCollected || 0;
        const balance = totalCollected - (data.totalSpent || 0);
        if (balance <= 0) {
            alert('No hay dinero sobrante para reclamar.');
            return;
        }
        // Calcular aportes individuales
        const individualAports = {};
        if (data.history) {
            Object.values(data.history).forEach(item => {
                if (item.type === 'income') {
                    const contribName = item.description.replace('Aporte de ', '');
                    individualAports[contribName] = (individualAports[contribName] || 0) + item.amount;
                }
            });
        }
        const aport = individualAports[name] || 0;
        const refund = (balance * aport) / totalCollected;
        if (refund <= 0) {
            alert('No hay nada que reclamar para ' + name);
            return;
        }
        // Actualizar total del bote
        const newTotal = totalCollected - refund;
        await set(ref(this.db, `party_pots/${this.state.partyId}/totalCollected`), newTotal);
        // Marcar como reembolsado
        await set(ref(this.db, `party_pots/${this.state.partyId}/participants/${name.replace(/\\./g, '_')}/refunded`), true);
        // Añadir entrada al historial
        const historyRef = push(ref(this.db, `party_pots/${this.state.partyId}/history`));
        await set(historyRef, {
            type: 'refund',
            amount: -refund,
            description: `Reclamo de ${name}`,
            user: this.state.user,
            timestamp: Date.now()
        });
        alert(`${name} ha reclamado ${refund.toFixed(2)}€ del bote.`);
        // Recargar UI
        if (this.listenToParty) {
            this.listenToParty(this.state.partyId);
        } else {
            location.reload();
        }
    },

    async handlePartyAddMoney() {
        const participants = this.state.partyData?.participants
            ? Object.values(this.state.partyData.participants).map(p => p.name)
            : [];

        let optionsHtml = '';
        participants.forEach(name => {
            const selected = name === this.state.user ? 'selected' : '';
            optionsHtml += `<option value="${name}" ${selected}>${name}</option>`;
        });

        const html = `
            <h3>Añadir Fondos al Bote</h3>
            <div style="display: flex; flex-direction: column; gap: 0.75rem; margin-top: 1rem;">
                <div>
                    <label style="font-size:0.85rem; color: var(--text-muted); margin-bottom: 0.3rem; display:block;">¿Quién pone el dinero?</label>
                    <select id="party-money-contributor" style="width: 100%; padding: 0.9rem 1rem; font-size: 1rem; border-radius: var(--radius-sm); border: 1px solid var(--glass-border); background: rgba(0,0,0,0.3); color: white; -webkit-appearance: none; appearance: none;">
                        ${optionsHtml}
                    </select>
                </div>
                <div>
                    <label style="font-size:0.85rem; color: var(--text-muted); margin-bottom: 0.3rem; display:block;">¿Cuánto dinero añade?</label>
                    <input type="number" id="party-money-amount" placeholder="Cantidad (€)" step="0.01" style="width: 100%; padding: 0.9rem 1rem; font-size: 1.1rem;">
                </div>
                <button class="btn-primary" onclick="App.confirmPartyAddMoney()" style="width: 100%; padding: 0.9rem; font-size: 1rem;">Añadir al bote</button>
            </div>
        `;
        this.openModal(html);
    },

    async confirmPartyAddMoney() {
        const friendEl = document.getElementById('party-money-contributor');
        const amountEl = document.getElementById('party-money-amount');
        const friend = friendEl?.value?.trim();
        const amount = this.parseAmount(amountEl?.value);

        if (!friend) return alert('Selecciona quién pone el dinero.');
        if (isNaN(amount) || amount <= 0) return alert('Introduce una cantidad válida.');

        this.closeModal();

        const friends = this.state.partyData?.participants
            ? Object.values(this.state.partyData.participants).map(p => p.name)
            : [];

        if (!friends.includes(friend)) {
            await this.addPartyFriendSilent(friend);
        }

        const historyRef = push(ref(this.db, `party_pots/${this.state.partyId}/history`));
        await set(historyRef, {
            type: 'income',
            amount: amount,
            description: `Aporte de ${friend}`,
            user: this.state.user,
            timestamp: Date.now()
        });

        const newTotal = (this.state.partyData.totalCollected || 0) + amount;
        await set(ref(this.db, `party_pots/${this.state.partyId}/totalCollected`), newTotal);
    },

    async handlePartyAddFriend() {
        try {
            const snapshot = await get(ref(this.db, 'members'));
            const members = snapshot.exists() ? Object.values(snapshot.val()) : [];
            const currentParticipants = Object.values(this.state.partyData?.participants || {}).map(p => p.name);
            
            const availableMembers = members.filter(m => !currentParticipants.includes(m.name));

            this.state.tempSelectionFriends = [];
            
            let html = `<h3>Añadir Amigos al Bote</h3>`;
            html += `<p class="subtitle" style="margin-bottom: 1rem;">Selecciona los miembros que quieres añadir:</p>`;
            html += `<div class="participant-grid" style="max-height: 40vh; overflow-y: auto;">`;
            
            availableMembers.forEach(m => {
                const safeName = m.name.replace(/'/g, "\\'").replace(/"/g, "&quot;");
                const idName = m.name.replace(/\s/g, '_');
                html += `<button id="f-btn-${idName}" class="participant-btn" onclick="App.toggleFriendSelection('${safeName}')">${m.name}</button>`;
            });
            
            if (availableMembers.length === 0) {
                html += `<p class="empty-msg" style="grid-column: span 2;">Todos los miembros ya están en el bote.</p>`;
            }
            
            html += `</div>`;
            
            html += `
                <div style="margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid var(--glass-border);">
                    <p class="subtitle" style="margin-bottom: 0.5rem; color: var(--text-main);">¿No es miembro? Añádelo manualmente:</p>
                    <input type="text" id="custom-friend-name" placeholder="Escribe un nombre..." style="margin-bottom: 1rem;">
                </div>
            `;
            
            html += `<button id="btn-confirm-add-friends" class="btn-primary" onclick="App.confirmPartyAddFriends()">Añadir al bote (0)</button>`;

            this.openModal(html);
        } catch (error) {
            console.error('Error al cargar miembros:', error);
            alert('Error al conectar con la base de datos.');
        }
    },

    async confirmPartyAddFriends() {
        const customNameInput = document.getElementById('custom-friend-name')?.value.trim();
        const selected = [...(this.state.tempSelectionFriends || [])];
        
        if (customNameInput) {
            await this.promptNewFriendCouple(customNameInput, selected, true);
            return;
        }

        if (selected.length === 0) {
            return alert('Selecciona al menos a un miembro o escribe un nombre.');
        }

        this.closeModal();

        try {
            for (const name of selected) {
                await this.addPartyFriendSilent(name);
            }
        } catch (error) {
            console.error('Error al añadir amigos:', error);
        }
    },

    async addPartyFriendSilent(name) {
        const friendRef = ref(this.db, `party_pots/${this.state.partyId}/participants/${name.replace(/\./g, '_')}`);
        await set(friendRef, { name: name, joinedAt: Date.now() });
    },

    async handlePartyAddExpense() {
        const amount = parseFloat(prompt('¿Cuánto ha costado la ronda/gasto?', '15'));
        if (isNaN(amount)) return;
        const desc = prompt('¿En qué se ha gastado? (ej: 4 cervezas)', 'Ronda');
        
        const historyRef = push(ref(this.db, `party_pots/${this.state.partyId}/history`));
        await set(historyRef, {
            type: 'expense',
            amount: amount,
            description: desc,
            user: this.state.user,
            timestamp: Date.now()
        });

        const newTotal = (this.state.partyData.totalSpent || 0) + amount;
        await set(ref(this.db, `party_pots/${this.state.partyId}/totalSpent`), newTotal);
    },

    openModal(html, hideCloseBtn = false) {
        this.display.modalContent.innerHTML = html;
        this.display.modalOverlay.classList.remove('hidden');
        const closeBtn = document.getElementById('btn-close-modal');
        if (closeBtn) closeBtn.style.display = hideCloseBtn ? 'none' : '';
    },

    closeModal() {
        this.display.modalOverlay.classList.add('hidden');
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
                btn.className = 'participant-btn';
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
    }
};

window.App = App;
document.addEventListener('DOMContentLoaded', () => App.init());
