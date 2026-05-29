import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, set, onValue, push, get } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

/**
 * Thermo Bandapp - App Principal
 */

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
        tempLoginCode: null
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

    initFirebase() {
        try {
            this.app = initializeApp(firebaseConfig);
            this.db = getDatabase(this.app);
            console.log('Firebase conectado correctamente ✅');
            this.listenToBars();
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
            leaveTable: document.getElementById('btn-leave-table'),
            createParty: document.getElementById('btn-create-party-main'),
            addPartyMoney: document.getElementById('btn-party-add-money'),
            addPartyExpense: document.getElementById('btn-party-add-expense'),
            addPartyFriend: document.getElementById('btn-party-add-friend'),
            partyGoHome: document.getElementById('btn-party-go-home'),
            loginSubmit: document.getElementById('btn-login-submit'),
            adminSaveMember: document.getElementById('btn-admin-save-member')
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
        this.buttons.leaveTable.addEventListener('click', () => this.handleLeaveTable());
        document.getElementById('btn-close-modal').addEventListener('click', () => this.closeModal());
        this.display.finishTable.addEventListener('click', () => this.handleFinishTable());
        this.display.addFriendManual.addEventListener('click', () => this.handleAddFriendManual());
        
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
            let html = '';
            for (const [key, data] of Object.entries(members)) {
                html += `
                    <div class="participant-item" style="display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                        <div style="flex: 1; min-width: 150px;">
                            <b>${data.name}</b> <span style="color: var(--text-muted); font-size: 0.9rem;">(Cód: ${data.code})</span>
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
        
        if (!nameInput || !codeInput) return alert('Rellena nombre y código');
        
        try {
            const key = nameInput.toLowerCase();
            await set(ref(this.db, `members/${key}`), {
                name: nameInput,
                code: codeInput
            });
            alert(`Miembro ${nameInput} guardado correctamente.`);
            document.getElementById('admin-member-name').value = '';
            document.getElementById('admin-member-code').value = '';
            this.loadAdminMembers();
            await this.addLog('admin_save_member', { targetUser: nameInput });
        } catch (error) { console.error(error); }
    },

    handleEditMember(name, code) {
        document.getElementById('admin-member-name').value = name;
        document.getElementById('admin-member-code').value = code;
        document.getElementById('admin-member-name').focus();
    },

    async handleDeleteMember(key) {
        if (key === 'fernando') return alert('No puedes eliminar al administrador principal.');
        if (!confirm(`¿Seguro que quieres eliminar al miembro ${key}?`)) return;
        
        try {
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
                    alert('La mesa ha sido cerrada. ¡Hasta la próxima quedada! 🍻');
                    this.state.tableId = null;
                    localStorage.removeItem('thermo_tableId');
                    location.reload();
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
            Object.values(data.participants).forEach(p => {
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
                    <span class="p-amount">${amount.toFixed(2)}€</span>
                `;
                div.onclick = () => this.showParticipantDetail(p.name);
                this.display.participants.appendChild(div);
            });
        }
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
                <span class="item-icon">${item.icon || '🍴'}</span>
                <span class="item-name">${item.name}</span>
                <span class="item-price">${item.price.toFixed(2)}€</span>
            `;
            div.onclick = (e) => {
                if (e.target.classList.contains('btn-edit-small')) return;
                this.showParticipantSelector(item);
            };
            div.querySelector('.btn-edit-small').onclick = (e) => {
                e.stopPropagation();
                this.handleEditProduct(id, item);
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
        const myTotal = allTotals[this.state.user] || 0;
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
        if (!data || !data.orders) return;
        const participants = Object.values(data.participants || {});
        const pInfo = participants.find(p => p.name === name);
        const tableStart = Number(data.createdAt || 0);
        const myJoinTime = Number(pInfo?.joinedAt || tableStart);
        
        let html = `<h3>Consumo de ${name}</h3><div class="detail-list">`;
        let total = 0;
        let hasOrders = false;

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

        // 3. Renderizar Lista de Estado Individual
        const statusContainer = document.getElementById('group-individual-status');
        statusContainer.innerHTML = '<h4>¿Cómo va el reparto?</h4>';
        
        Object.entries(individualDebts).forEach(([name, owed]) => {
            const put = userContributions[name] || 0;
            const balance = put - owed;
            const isSettled = balance >= -0.01;

            const div = document.createElement('div');
            div.className = `status-row ${isSettled ? 'settled' : 'pending'}`;
            div.innerHTML = `
                <span class="name">${name}</span>
                <div class="details">
                    <span>A pagar: ${owed.toFixed(2)}€</span>
                    <span class="balance" style="color: ${balance > 0.01 ? '#3b82f6' : (isSettled ? '#22c55e' : '#f59e0b')}">
                        ${balance > 0.01 ? `Te sobran ${balance.toFixed(2)}€` : (isSettled ? '✓ Pagado' : `Faltan ${(Math.abs(balance)).toFixed(2)}€`)}
                    </span>
                </div>
                <button class="btn-calc-small" onclick="App.showQuickChange('${name}', ${owed})">💸</button>
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
        // No mostrar en modo grupo
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

        // Todos los participantes excepto el pagador
        const entriesToShow = Object.entries(totals).filter(([friendName]) => friendName !== payer);

        const currentPayerInList = this.display.debtsList.dataset.payer;
        
        if (currentPayerInList !== payer) {
            this.display.debtsList.innerHTML = '';
            this.display.debtsList.dataset.payer = payer;
            
            entriesToShow.forEach(([friendName, amount]) => {
                const div = document.createElement('div');
                div.className = `payment-row`;
                div.id = `pay-row-${friendName.replace(/\s/g, '_')}`;
                div.innerHTML = `
                    <div class="p-header"><span>${friendName}</span><span class="p-amount">A pagar: ${amount.toFixed(2)}€</span></div>
                    <div class="p-controls">
                        <input type="number" step="0.01" class="input-payment" placeholder="Paga con..." oninput="App.calculateIndividualChange(this, ${amount}); App.handleIndividualPaymentChange('${payer}', '${friendName.replace(/'/g, "\\'")}', this.value)">
                        <div class="method-options">
                             <button class="method-btn" onclick="App.handleIndividualPaymentChange('${payer}', '${friendName.replace(/'/g, "\\'")}', ${amount})">📲 Bizum</button>
                        </div>
                    </div>
                    <div class="change-result-row" style="margin-top: 0.5rem; min-height: 1.2rem; font-size: 0.9rem; color: var(--primary);"></div>
                `;
                this.display.debtsList.appendChild(div);
            });
        }
        
        entriesToShow.forEach(([friendName, amount]) => {
            const row = document.getElementById(`pay-row-${friendName.replace(/\s/g, '_')}`);
            if (!row) return;
            const input = row.querySelector('.input-payment');
            
            const safeName = friendName.replace(/\./g, '_');
            const paid = settlements[safeName];
            
            if (document.activeElement !== input) {
                if (paid !== undefined && paid !== null && paid !== '') {
                    input.value = paid;
                    this.calculateIndividualChange(input, amount);
                } else {
                    input.value = '';
                    row.querySelector('.change-result-row').innerHTML = '';
                }
            }
        });
    },

    async handleIndividualPaymentChange(payer, friendName, value) {
        const amount = value === '' || value === null ? null : this.parseAmount(value);
        if (amount !== null && isNaN(amount)) return;
        try {
            await set(ref(this.db, `tables/${this.state.tableId}/settlements/${payer}/${friendName.replace(/\./g, '_')}`), amount);
        } catch (error) { console.error(error); }
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

    async handleFinishTable() {
        if (!confirm('¿Cerrar mesa definitivamente?')) return;
        try {
            await set(ref(this.db, `tables/${this.state.tableId}/status`), 'closed');
            await set(ref(this.db, `tables/${this.state.tableId}/finishedAt`), Date.now());
            await this.addLog('finish_table', { tableId: this.state.tableId });
        } catch (error) { console.error(error); }
    },

    async handleAddFriendManual() {
        try {
            const snapshot = await get(ref(this.db, 'members'));
            const members = snapshot.exists() ? Object.values(snapshot.val()) : [];
            const currentParticipants = Object.values(this.state.tableData?.participants || {}).map(p => p.name);
            
            // Filtramos miembros que ya están en la mesa
            const availableMembers = members.filter(m => !currentParticipants.includes(m.name));

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
        const customNameInput = document.getElementById('custom-friend-name').value.trim();
        const selected = [...(this.state.tempSelectionFriends || [])];
        
        if (customNameInput) {
            selected.push(customNameInput);
        }

        if (selected.length === 0) {
            return alert('Selecciona al menos a un miembro o escribe un nombre.');
        }

        this.closeModal();

        try {
            for (const name of selected) {
                const participantRef = ref(this.db, `tables/${this.state.tableId}/participants/${name.replace(/\./g, '_')}`);
                await set(participantRef, { name, role: 'member', status: 'active', joinedAt: Date.now() });
            }
        } catch (error) {
            console.error('Error al añadir amigos:', error);
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
        const customNameInput = document.getElementById('custom-friend-name').value.trim();
        const selected = [...(this.state.tempSelectionFriends || [])];
        
        if (customNameInput) {
            selected.push(customNameInput);
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
