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
        partyData: null
    },

    init() {
        console.log('Thermo Bandapp inicializada 🍻');
        this.initFirebase();
        this.cacheDOM();
        this.bindEvents();
        this.loadLocalSession();
    },

    initFirebase() {
        try {
            this.app = initializeApp(firebaseConfig);
            this.db = getDatabase(this.app);
            console.log('Firebase conectado correctamente ✅');
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
            'party-pot': document.getElementById('party-pot-view')
        };
        this.inputs = {
            userName: document.getElementById('user-name'),
            barName: document.getElementById('bar-name'),
            tableNum: document.getElementById('table-num')
        };
        this.buttons = {
            createTable: document.getElementById('btn-create-table'),
            joinTable: document.getElementById('btn-join-table'),
            addProduct: document.getElementById('btn-add-product-menu'),
            leaveTable: document.getElementById('btn-leave-table'),
            createParty: document.getElementById('btn-create-party'),
            addPartyMoney: document.getElementById('btn-party-add-money'),
            addPartyExpense: document.getElementById('btn-party-add-expense')
        };
        this.display = {
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
        
        this.buttons.createParty.addEventListener('click', () => this.handleCreateParty());
        this.buttons.addPartyMoney.addEventListener('click', () => this.handlePartyAddMoney());
        this.buttons.addPartyExpense.addEventListener('click', () => this.handlePartyAddExpense());
        
        document.querySelectorAll('.nav-item').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const view = e.currentTarget.dataset.view;
                document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
                e.currentTarget.classList.add('active');
                this.showView(view);
            });
        });
    },

    loadLocalSession() {
        const savedUser = localStorage.getItem('thermo_user');
        const savedTableId = localStorage.getItem('thermo_tableId');
        const savedPartyId = localStorage.getItem('thermo_partyId');

        if (savedUser) {
            this.inputs.userName.value = savedUser;
            this.state.user = savedUser;
        }

        if (savedTableId && savedUser) {
            this.state.tableId = savedTableId;
            this.showView('summary');
            this.listenToTable(savedTableId);
        } else if (savedPartyId && savedUser) {
            this.state.partyId = savedPartyId;
            this.showView('party-pot');
            this.listenToParty(savedPartyId);
        }
    },

    async handleJoinTable() {
        const code = prompt('Introduce el código de la mesa:');
        if (!code) return;

        const userName = this.inputs.userName.value.trim();
        if (!userName) {
            alert('Por favor, dinos tu nombre primero.');
            return;
        }

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
            } else {
                alert('Ese código de mesa no existe.');
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
            
            if (snapshot.exists()) {
                if (!confirm('Esta mesa ya existe. ¿Quieres unirte a ella en lugar de crear una nueva?')) return;
                const participantRef = ref(this.db, `tables/${tableId}/participants/${userName.replace(/\./g, '_')}`);
                await set(participantRef, { 
                    name: userName, 
                    role: 'member', 
                    status: 'active',
                    joinedAt: Date.now() 
                });
            } else {
                const tableData = {
                    name: `${barName} (Mesa ${tableNum})`,
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

            // PERSISTENCIA: Cargar menú previo del bar si existe
            const barMenuRef = ref(this.db, `bar_menus/${barName.replace(/\s/g, '_')}`);
            const barMenuSnapshot = await get(barMenuRef);
            if (barMenuSnapshot.exists()) {
                await set(ref(this.db, `tables/${tableId}/menu`), barMenuSnapshot.val());
            }

            this.showView('summary');
            this.listenToTable(tableId);
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
                html += `<div class="order-row"><span>${label}</span><div class="order-actions"><span>${price.toFixed(2)}€</span><button class="btn-delete-small" onclick="App.handleDeleteOrder('${id}')">🗑️</button></div></div>`;
            }
        });

        if (!hasOrders) html += `<p class="empty-msg">Aún no ha pedido nada.</p>`;
        else html += `<div class="order-row total-row"><span><b>TOTAL</b></span><span><b>${total.toFixed(2)}€</b></span></div>`;
        html += `</div>`;
        this.openModal(html);
    },

    showParticipantSelector(product) {
        const participants = Object.values(this.state.tableData.participants);
        this.state.tempSelection = [];
        let html = `<h3>¿Para quién es ${product.icon} ${product.name}?</h3><div class="participant-grid">`;
        html += `<button class="participant-btn btn-shared" style="grid-column: span 2;" onclick="App.handleSharedOrder(${JSON.stringify(product).replace(/"/g, '&quot;')})">💎 A Escote (Todos)</button>`;
        participants.forEach(p => {
            const isMe = p.name === this.state.user;
            html += `<button id="p-btn-${p.name.replace(/\s/g, '_')}" class="participant-btn ${isMe ? 'is-me' : ''}" onclick="App.toggleParticipantSelection('${p.name.replace(/'/g, "\\'")}')">${isMe ? '🏠' : '👤'} ${p.name}</button>`;
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
        participants.forEach(p => {
            const btn = document.createElement('div');
            btn.className = 'payer-btn';
            btn.innerHTML = `<span>${p.name}</span> <span>💰</span>`;
            btn.onclick = () => this.selectPayer(p.name, btn);
            this.display.payerSelector.appendChild(btn);
        });

        this.listenToContributions();
    },

    selectPayer(name, element) {
        document.querySelectorAll('.payer-btn').forEach(b => b.classList.remove('selected'));
        element.classList.add('selected');
        document.getElementById('settlement-results').classList.remove('hidden');
        document.getElementById('selected-payer-name').textContent = name;
        this.state.currentPayer = name;
        this.updateChangeAssistantUI();
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
        const amount = parseFloat(document.getElementById('input-pot-amount').value);
        if (isNaN(amount) || amount <= 0) return;
        try {
            const contributionsRef = ref(this.db, `tables/${this.state.tableId}/contributions`);
            await push(contributionsRef, {
                user: this.state.user,
                amount: amount,
                timestamp: Date.now()
            });
            document.getElementById('input-pot-amount').value = '';
        } catch (error) { console.error(error); }
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
        const contributions = Object.values(this.state.contributions || {});
        
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
                    <span>Debe: ${owed.toFixed(2)}€</span>
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
            div.innerHTML = `<span><b>${c.user}</b> puso</span><span>${Number(c.amount).toFixed(2)}€</span>`;
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
        const payer = this.state.currentPayer;
        if (!payer) return;
        const totals = this.calculateAllIndividualTotals();
        this.display.debtsList.innerHTML = '';
        Object.entries(totals).forEach(([friendName, amount]) => {
            if (friendName === payer) return;
            const div = document.createElement('div');
            div.className = `payment-row`;
            div.innerHTML = `
                <div class="p-header"><span>${friendName}</span><span class="p-amount">Debe: ${amount.toFixed(2)}€</span></div>
                <div class="p-controls">
                    <input type="number" step="0.01" class="input-payment" placeholder="Paga con..." oninput="App.calculateIndividualChange(this, ${amount})">
                    <div class="method-options">
                         <button class="method-btn" onclick="const inp=this.closest('.p-controls').querySelector('input'); inp.value=${amount.toFixed(2)}; App.calculateIndividualChange(inp, ${amount})">📲 Bizum</button>
                    </div>
                </div>
                <div class="change-result-row" style="margin-top: 0.5rem; min-height: 1.2rem; font-size: 0.9rem; color: var(--primary);"></div>
            `;
            this.display.debtsList.appendChild(div);
        });
    },

    calculateIndividualChange(inputElement, owed) {
        const paid = parseFloat(inputElement.value);
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
        Object.values(this.views).forEach(v => v?.classList.remove('active'));
        const targetView = document.getElementById(`${viewName}-view`);
        if (targetView) targetView.classList.add('active');
        this.state.currentView = viewName;

        // Gestión de visibilidad de navegación y botón de salida
        if (viewName === 'setup') {
            this.nav.classList.add('hidden');
            this.buttons.leaveTable.classList.add('hidden');
        } else {
            this.nav.classList.remove('hidden');
            this.buttons.leaveTable.classList.remove('hidden');
        }
    },

    async handleLeaveTable() {
        if (!confirm('¿Seguro que quieres dejar la mesa?')) return;
        try {
            if (this.state.tableId && this.state.user) {
                const participantRef = ref(this.db, `tables/${this.state.tableId}/participants/${this.state.user.replace(/\./g, '_')}`);
                await set(participantRef, { ...this.state.tableData.participants[this.state.user.replace(/\./g, '_')], status: 'left' });
            }
            localStorage.removeItem('thermo_tableId');
            location.reload();
        } catch (error) { console.error(error); }
    },

    async handleFinishTable() {
        if (!confirm('¿Cerrar mesa definitivamente?')) return;
        try {
            await set(ref(this.db, `tables/${this.state.tableId}/status`), 'closed');
            await set(ref(this.db, `tables/${this.state.tableId}/finishedAt`), Date.now());
        } catch (error) { console.error(error); }
    },

    async handleAddFriendManual() {
        const name = prompt('Nombre del amigo:');
        if (!name) return;
        try {
            const participantRef = ref(this.db, `tables/${this.state.tableId}/participants/${name.replace(/\./g, '_')}`);
            await set(participantRef, { name, role: 'member', status: 'active', joinedAt: Date.now() });
        } catch (error) { console.error(error); }
    },

    async handleCreateParty() {
        const name = document.getElementById('party-pot-name').value.trim();
        if (!name) return alert('Ponle un nombre al bote');
        
        const partyId = 'PARTY_' + Math.random().toString(36).substr(2, 6).toUpperCase();
        const partyRef = ref(this.db, `party_pots/${partyId}`);
        
        await set(partyRef, {
            name: name,
            createdAt: Date.now(),
            createdBy: this.state.user,
            totalCollected: 0,
            totalSpent: 0,
            history: {}
        });

        this.state.partyId = partyId;
        localStorage.setItem('thermo_partyId', partyId);
        this.listenToParty(partyId);
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
        
        document.getElementById('party-balance').textContent = `${balance.toFixed(2)}€`;
        document.getElementById('party-total-collected').textContent = `${(data.totalCollected || 0).toFixed(2)}€`;
        document.getElementById('party-total-spent').textContent = `${(data.totalSpent || 0).toFixed(2)}€`;

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

    async handlePartyAddMoney() {
        const amount = parseFloat(prompt('¿Cuánto dinero se añade al bote?', '20'));
        if (isNaN(amount)) return;
        const friend = prompt('¿Quién pone el dinero?', this.state.user);
        
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

    openModal(html) {
        this.display.modalContent.innerHTML = html;
        this.display.modalOverlay.classList.remove('hidden');
    },

    closeModal() {
        this.display.modalOverlay.classList.add('hidden');
    }
};

window.App = App;
document.addEventListener('DOMContentLoaded', () => App.init());
