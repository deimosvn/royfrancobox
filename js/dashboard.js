/**
 * ROY FRANCO BOX — Dashboard JavaScript
 * All data is read from / written to Firebase Firestore.
 * Loaded as <script type="module"> from dashboard.html.
 * ============================================================ */

import {
    auth,
    db,
    onAuthChange,
    logoutAdmin       as fbLogout,
    onStudentsChange,
    addStudent,
    updateStudent,
    deleteStudentById,
    registerStudentAttendance,
    onPaymentsChange,
    addPayment,
    markPaymentPaid,
    onFinancesChange,
    addFinanceEntry,
    getSettings,
    saveSettingsDoc,
    saveRegistrationCode,
    getRegistrationCode,
    onClassesChange,
    addClassDoc,
    updateClassDoc,
    deleteClassDoc,
    formatDate,
    formatMXN,
} from './firebase.js';

// ── Active real-time unsubscribers ─────────────────────────────
const unsubscribers = [];
// ── Plan metadata ──────────────────────────────────────────────
const PLAN_LABELS = { diario: 'Por Clase', semanal: 'Semanal', mensual: 'Mensual' };
const PLAN_EXPIRY_DAYS = { semanal: 7, mensual: 30 };

let currentPricing = { diario: 100, semanal: 300, mensual: 700, personal: 200 };

/** Returns YYYY-MM-DD expiry string, or '' if no fixed expiry (e.g. per-class). */
function calcExpiryDate(startDate, plan) {
    const days = PLAN_EXPIRY_DAYS[plan];
    if (!startDate || !days) return '';
    const dt = new Date(startDate);
    dt.setDate(dt.getDate() + days);
    return dt.toISOString().split('T')[0];
}

/** Returns integer days until expiryDate (negative = already expired), or null if no date. */
function daysUntilExpiry(expiryDate) {
    if (!expiryDate) return null;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const exp   = new Date(expiryDate); exp.setHours(0, 0, 0, 0);
    return Math.round((exp - today) / 86400000);
}
// ── Auth guard ─────────────────────────────────────────────────
onAuthChange(user => {
    if (!user) {
        unsubscribers.forEach(fn => fn());
        window.location.replace('index.html');
        return;
    }
    const nameEl = document.getElementById('adminUserName');
    if (nameEl) nameEl.textContent = user.displayName || user.email.split('@')[0];
    initDashboard();
});

// ── Bootstrap real-time listeners once ────────────────────────
let dashboardInitialised = false;
let _allFinances = [];
let _allClasses  = [];

function initDashboard() {
    if (dashboardInitialised) return;
    dashboardInitialised = true;

    // Students
    unsubscribers.push(
        onStudentsChange(students => {
            _allStudents = students;
            renderStudentsTable(students);
            renderDashboardStats(students);
            renderPendingPaymentsWidget(students);
            renderClassesToday(students);
            renderProgressList(students);
            renderBirthdays(students);
            renderEnrolledStudentsList(students);
            renderIndivWaList(students);
        })
    );

    // Payments
    unsubscribers.push(
        onPaymentsChange(payments => {
            renderPaymentsTable(payments);
            renderPaymentsStats(payments);
            updateFullFinancesStats(payments, _allFinances);
            renderActivityFeed(payments);
        })
    );

    // Classes
    unsubscribers.push(
        onClassesChange(classes => {
            _allClasses = classes;
            renderAllClasses(classes, _allStudents);
            renderClassesToday(_allStudents);
        })
    );

    // Finances
    unsubscribers.push(
        onFinancesChange(finances => {
            _allFinances = finances;
            renderFinancesTable(finances);
            updateFullFinancesStats(_latestPayments, finances);
        })
    );
    // Settings (Pricing and Gym Info)
    unsubscribers.push(
        getSettings('pricing', (prices) => {
            if (prices) {
                currentPricing = { ...currentPricing, ...prices };
                const pMensual = document.getElementById('settingsPriceMensual');
                const pSemanal = document.getElementById('settingsPriceSemanal');
                const pDiario  = document.getElementById('settingsPriceDiario');
                const pPersonal = document.getElementById('settingsPricePersonal');
                if (pMensual) pMensual.value = prices.mensual || '';
                if (pSemanal) pSemanal.value = prices.semanal || '';
                if (pDiario)  pDiario.value  = prices.diario  || '';
                if (pPersonal) pPersonal.value = prices.personal || '';
            }
        })
    );
    unsubscribers.push(
        getSettings('gymInfo', (info) => {
            if (info) {
                const name = document.getElementById('settingsGymName');
                const phone = document.getElementById('settingsPhone');
                const email = document.getElementById('settingsEmail');
                const addr = document.getElementById('settingsAddress');
                if (name) name.value = info.name || '';
                if (phone) phone.value = info.phone || '';
                if (email) email.value = info.email || '';
                if (addr) addr.value = info.address || '';
            }
        })
    );
    unsubscribers.push(
        getSettings('notifications', (prefs) => {
            if (prefs) {
                const rem3 = document.getElementById('notifReminder3Days');
                const remDay = document.getElementById('notifReminderDay');
                const birth = document.getElementById('notifBirthday');
                const welc = document.getElementById('notifWelcome');
                if (rem3) rem3.checked = prefs.reminder3Days ?? true;
                if (remDay) remDay.checked = prefs.reminderDay ?? true;
                if (birth) birth.checked = prefs.birthday ?? false;
                if (welc) welc.checked = prefs.welcome ?? true;
            }
        })
    );
}

// ══════════════════════════════════════════════════════════════
//  SIDEBAR & NAVIGATION
// ══════════════════════════════════════════════════════════════

window.toggleAdminSidebar = function () {
    const sidebar = document.getElementById('adminSidebar');
    const overlay = document.getElementById('sidebarOverlay');
    sidebar.classList.toggle('active');
    overlay.classList.toggle('active');
    document.body.style.overflow = sidebar.classList.contains('active') ? 'hidden' : '';
};

// Close sidebar on mobile when menu item clicked
document.querySelectorAll('.sidebar-menu-item').forEach(item => {
    item.addEventListener('click', function () {
        if (window.innerWidth <= 1024) {
            const sidebar = document.getElementById('adminSidebar');
            const overlay = document.getElementById('sidebarOverlay');
            if (sidebar?.classList.contains('active')) {
                sidebar.classList.remove('active');
                overlay?.classList.remove('active');
                document.body.style.overflow = '';
            }
        }
    });
});

window.showAdminPanel = function (panelName) {
    document.querySelectorAll('.admin-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.sidebar-menu-item').forEach(i => i.classList.remove('active'));

    document.getElementById('panel-' + panelName)?.classList.add('active');
    document.querySelectorAll('.sidebar-menu-item').forEach(item => {
        const oc = item.getAttribute('onclick') || '';
        if (oc.includes("'" + panelName + "'") || oc.includes('"' + panelName + '"')) {
            item.classList.add('active');
        }
    });

    const titles = {
        dashboard:     'Dashboard',
        students:      'Gestión de Alumnos',
        classes:       'Clases',
        schedule:      'Horarios',
        payments:      'Pagos',
        finances:      'Finanzas',
        reports:       'Reportes',
        messages:      'Mensajes',

        inventory:     'Inventario',
        events:        'Eventos',
        progress:      'Progreso Alumnos',
        settings:      'Configuración',
        backup:        'Respaldos',
    };
    const titleEl = document.getElementById('adminPageTitle');
    if (titleEl) titleEl.textContent = titles[panelName] || 'Dashboard';

    if (window.innerWidth < 1024) {
        document.getElementById('adminSidebar')?.classList.remove('active');
    }
};

// ══════════════════════════════════════════════════════════════
//  LOGOUT
// ══════════════════════════════════════════════════════════════

window.logoutAdmin = async function () {
    unsubscribers.forEach(fn => fn());
    await fbLogout();
    window.location.replace('index.html');
};

// ══════════════════════════════════════════════════════════════
//  DASHBOARD STATS
// ══════════════════════════════════════════════════════════════

function renderDashboardStats(students) {
    const active       = students.filter(s => s.remainingClasses > 0).length;
    const expired      = students.filter(s => s.remainingClasses <= 0).length;
    const expiringSoon = students.filter(s => {
        const d = daysUntilExpiry(s.expiryDate);
        return d !== null && d >= 0 && d <= 5;
    }).length;
    const thisMonth    = new Date().getMonth();
    const newThisMonth = students.filter(s => {
        if (!s.createdAt) return false;
        const d = s.createdAt.toDate ? s.createdAt.toDate() : new Date(s.createdAt.seconds * 1000);
        return d.getMonth() === thisMonth;
    }).length;

    const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    weekStart.setHours(0, 0, 0, 0);
    const weeklyClasses = students.filter(s => {
        if (!Array.isArray(s.attendanceHistory) || s.attendanceHistory.length === 0) return false;
        return s.attendanceHistory.some(dateStr => new Date(dateStr) >= weekStart);
    }).length;

    // Update dashboard date
    const dateEl = document.getElementById('dashDate');
    if (dateEl) {
        const now = new Date();
        dateEl.textContent = now.toLocaleDateString('es-MX', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
    }
    set('statActiveStudents',  active);
    set('statWeeklyClasses',   weeklyClasses);
    set('statNewStudents',     newThisMonth);
    set('statExpiredStudents', expired);
    set('sidebarStudentCount', active);

    const pendingCount = document.getElementById('pendingPaymentsCount');
    if (pendingCount) pendingCount.textContent = `${expired + expiringSoon} pendientes`;

    // Sidebar badge
    const badge = document.querySelector('.sidebar-menu-item[onclick*="students"] .badge-count');
    if (badge) badge.textContent = active;

    if (typeof window.updateNotificationsDropdown === 'function') {
        window.updateNotificationsDropdown(students);
    }
}

// ══════════════════════════════════════════════════════════════
//  PENDING PAYMENTS WIDGET (dashboard panel)
// ══════════════════════════════════════════════════════════════

function renderPendingPaymentsWidget(students) {
    // Legacy: keep for compatibility — calls the new card renderer
    renderPendingAlertsCards(students);
}

function renderPendingAlertsCards(students) {
    const list = document.getElementById('pending-alerts-list');
    if (!list) return;

    const alerts = students.filter(s => {
        if (s.remainingClasses <= 0) return true;
        const d = daysUntilExpiry(s.expiryDate);
        return d !== null && d <= 5;
    }).sort((a, b) => {
        const da = daysUntilExpiry(a.expiryDate) ?? -99;
        const db = daysUntilExpiry(b.expiryDate) ?? -99;
        return da - db;
    });

    const pendingCount = document.getElementById('pendingPaymentsCount');
    if (pendingCount) pendingCount.textContent = alerts.length ? `${alerts.length} alerta${alerts.length > 1 ? 's' : ''}` : '✓ Al día';

    if (alerts.length === 0) {
        list.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;gap:.5rem;padding:2rem;color:var(--success);">
            <i class="fas fa-check-circle" style="font-size:2rem;"></i>
            <span style="font-weight:600;font-size:.95rem;">¡Todo al día!</span>
            <span style="font-size:.82rem;color:var(--text-gray);">Sin pagos urgentes</span>
        </div>`;
        return;
    }

    list.innerHTML = alerts.map(s => {
        const initials  = (s.name || '?').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
        const phone     = (s.phone || '').replace(/\D/g, '');
        const intlPhone = phone.startsWith('52') ? phone : '521' + phone;
        const amount    = currentPricing[s.plan] || 700;
        const days      = daysUntilExpiry(s.expiryDate);
        const planLabel = PLAN_LABELS[s.plan] || capitalize(s.plan || '');

        let urgencyClass, urgencyLabel;
        if (s.remainingClasses <= 0 && (days === null || days < 0)) {
            urgencyClass = 'alert-item--expired'; urgencyLabel = 'Vencido';
        } else if (days !== null && days < 0) {
            urgencyClass = 'alert-item--expired'; urgencyLabel = 'Vencido';
        } else if (days !== null && days === 0) {
            urgencyClass = 'alert-item--today'; urgencyLabel = 'Vence hoy';
        } else if (days !== null && days <= 3) {
            urgencyClass = 'alert-item--soon'; urgencyLabel = `${days}d`;
        } else {
            urgencyClass = 'alert-item--warn'; urgencyLabel = `${days}d`;
        }

        const daysForMsg = days !== null ? days : 0;
        return `
        <div class="alert-item ${urgencyClass}">
            <div class="alert-item-avatar">${initials}</div>
            <div class="alert-item-info">
                <span class="alert-item-name">${esc(s.name)}</span>
                <span class="alert-item-meta">${planLabel} · $${amount}</span>
            </div>
            <div class="alert-item-badge">${urgencyLabel}</div>
            <div class="alert-item-actions">
                <button class="btn btn-whatsapp btn-sm" onclick="sendWhatsAppReminder('${intlPhone}','${esc(s.name)}','${amount}','${daysForMsg}')" title="WhatsApp">
                    <i class="fab fa-whatsapp"></i>
                </button>
                <button class="btn btn-primary btn-sm" onclick="openRenewModal('${s.id}')" title="Renovar">
                    <i class="fas fa-sync-alt"></i>
                </button>
            </div>
        </div>`;
    }).join('');
}

// ══════════════════════════════════════════════════════════════
//  ENROLLED STUDENTS LIST (main dashboard card)
// ══════════════════════════════════════════════════════════════

let _enrolledAll = [];

function renderEnrolledStudentsList(students) {
    _enrolledAll = students;
    _renderEnrolledFiltered();
}

function _renderEnrolledFiltered() {
    const list   = document.getElementById('enrolledStudentsList');
    const label  = document.getElementById('enrolledCountLabel');
    if (!list) return;

    const search = (document.getElementById('enrolledSearch')?.value || '').toLowerCase();
    const status = document.getElementById('enrolledFilterStatus')?.value || '';

    let filtered = _enrolledAll.filter(s => {
        if (search && !(s.name || '').toLowerCase().includes(search)) return false;
        const days = daysUntilExpiry(s.expiryDate);
        if (status === 'activo')   return s.remainingClasses > 0 && (days === null || days > 5);
        if (status === 'vencido')  return s.remainingClasses <= 0 || (days !== null && days < 0);
        if (status === 'urgente') {
            if (s.remainingClasses <= 0) return true;
            return days !== null && days <= 5;
        }
        return true;
    });

    // Sort: expired first → expiring soon (by days) → active (alphabetical)
    filtered.sort((a, b) => {
        const da = daysUntilExpiry(a.expiryDate) ?? -999;
        const db = daysUntilExpiry(b.expiryDate) ?? -999;
        const expA = a.remainingClasses <= 0;
        const expB = b.remainingClasses <= 0;
        if (expA && !expB) return -1;
        if (!expA && expB) return  1;
        if (da <= 5 && db > 5) return -1;
        if (da > 5 && db <= 5) return  1;
        if (da <= 5 && db <= 5) return da - db;
        return (a.name || '').localeCompare(b.name || '', 'es');
    });

    if (label) label.textContent = `(${filtered.length})`;

    if (filtered.length === 0) {
        list.innerHTML = `<p style="text-align:center;color:var(--text-gray);padding:2rem;">Sin alumnos con ese filtro.</p>`;
        return;
    }

    const planColors = { diario:'#F59E0B', semanal:'#3B82F6', mensual:'#10B981' };

    list.innerHTML = filtered.map(s => {
        const initials  = (s.name || '?').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
        const planLabel = PLAN_LABELS[s.plan] || capitalize(s.plan || '');
        const planColor = planColors[s.plan] || '#6B7280';
        const days      = daysUntilExpiry(s.expiryDate);
        const phone     = (s.phone || '').replace(/\D/g, '');
        const intlPhone = phone.startsWith('52') ? phone : '521' + phone;
        const amount    = currentPricing[s.plan] || 700;
        const total     = s.totalClasses || 1;
        const remaining = Math.max(0, s.remainingClasses || 0);
        const usedPct   = Math.round((1 - remaining / total) * 100);
        const barClr    = remaining <= 0 ? '#EF4444' : remaining <= 3 ? '#F59E0B' : '#10B981';

        // Status tag
        let statusTag, statusRow = '';
        if (s.remainingClasses <= 0) {
            statusTag = `<span class="enroll-badge enroll-badge--expired">Vencido</span>`;
        } else if (days !== null && days <= 0) {
            statusTag = `<span class="enroll-badge enroll-badge--expired">Vence hoy</span>`;
        } else if (days !== null && days <= 3) {
            statusTag = `<span class="enroll-badge enroll-badge--soon">${days}d</span>`;
        } else if (days !== null && days <= 7) {
            statusTag = `<span class="enroll-badge enroll-badge--warn">${days}d</span>`;
        } else {
            statusTag = `<span class="enroll-badge enroll-badge--ok">Activo</span>`;
        }

        // WA button only for urgent
        const showWa = s.remainingClasses <= 0 || (days !== null && days <= 5);
        const waBtn  = showWa
            ? `<button class="btn btn-whatsapp btn-xs enroll-action" onclick="sendWhatsAppReminder('${intlPhone}','${esc(s.name)}','${amount}','${days ?? 0}')" title="WhatsApp"><i class="fab fa-whatsapp"></i></button>`
            : '';
        const renewBtn = s.remainingClasses <= 0
            ? `<button class="btn btn-primary btn-xs enroll-action" onclick="openRenewModal('${s.id}')" title="Renovar"><i class="fas fa-sync-alt"></i></button>`
            : `<button class="btn btn-secondary btn-xs enroll-action" onclick="attendStudent('${s.id}')" title="Registrar clase"><i class="fas fa-check"></i></button>`;

        return `
        <div class="enroll-row">
            <div class="enroll-avatar" style="background:${planColor}1a;color:${planColor};">${initials}</div>
            <div class="enroll-body">
                <div class="enroll-top">
                    <span class="enroll-name">${esc(s.name)}</span>
                    ${statusTag}
                </div>
                <div class="enroll-meta">
                    <span class="enroll-plan" style="color:${planColor};">${planLabel}</span>
                    <span class="enroll-classes">${remaining}/${total} clases</span>
                    ${s.schedule ? `<span class="enroll-schedule"><i class="fas fa-clock"></i> ${esc(s.schedule)}</span>` : ''}
                </div>
                <div class="enroll-progress">
                    <div class="enroll-bar" style="width:${usedPct}%;background:${barClr};"></div>
                </div>
            </div>
            <div class="enroll-actions">
                ${renewBtn}
                ${waBtn}
            </div>
        </div>`;
    }).join('');
}

window.filterEnrolledList = function () {
    _renderEnrolledFiltered();
};

// ══════════════════════════════════════════════════════════════
//  ALL CLASSES (panel-classes) — DYNAMIC RENDER
// ══════════════════════════════════════════════════════════════

/** Returns students whose schedule text matches the class schedule or name */
function getClassEnrolled(cls, students) {
    const sch  = (cls.schedule || '').trim().toLowerCase();
    const name = (cls.name || '').trim().toLowerCase();
    return students.filter(s => {
        const sSch = (s.schedule || '').trim().toLowerCase();
        return sSch && (sSch === sch || sSch === name);
    });
}

function buildClassCard(cls, students) {
    const enrolled  = getClassEnrolled(cls, students);
    const cap       = cls.capacity || 20;
    const pct       = Math.min(100, Math.round(enrolled.length / cap * 100));
    const h         = parseInt(((cls.schedule || '12').match(/\d+/) || ['12'])[0]);
    const isMorning = h >= 5 && h < 12;

    const barColor = pct >= 90 ? 'var(--danger)' : pct >= 70 ? 'var(--warning)' : 'var(--success)';
    const pctBadgeClass = pct >= 90 ? 'badge-danger' : pct >= 70 ? 'badge-warning' : 'badge-success';

    const levelMap   = { todos: 'Todos los niveles', principiante: 'Principiante', intermedio: 'Intermedio', avanzado: 'Avanzado' };
    const levelLabel = levelMap[cls.level] || cls.level || 'Todos los niveles';
    const levelIcon  = { todos: 'fa-users', principiante: 'fa-seedling', intermedio: 'fa-dumbbell', avanzado: 'fa-fire' }[cls.level] || 'fa-users';

    // Avatar stack (top 4 enrolled)
    const avatarStack = enrolled.slice(0, 4).map(s => {
        const init = (s.name || '?').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
        return `<div class="cls-avatar-chip">${init}</div>`;
    }).join('');
    const avatarExtra = enrolled.length > 4
        ? `<div class="cls-avatar-chip cls-avatar-extra">+${enrolled.length - 4}</div>`
        : '';

    const timeLabel = isMorning ? 'Mañana' : 'Tarde/Noche';
    const timeBadge = isMorning
        ? `<span class="cls-time-badge cls-time-morning"><i class="fas fa-sun"></i> ${timeLabel}</span>`
        : `<span class="cls-time-badge cls-time-night"><i class="fas fa-moon"></i> ${timeLabel}</span>`;

    return `
    <div class="cls-card" data-level="${cls.level || 'todos'}" data-hour="${h}" data-name="${esc(cls.name).toLowerCase()}">
        <div class="cls-card-accent" style="background:${isMorning ? 'linear-gradient(135deg,#F59E0B,#D97706)' : 'linear-gradient(135deg,#6366F1,#4F46E5)'};"></div>
        <div class="cls-card-body">
            <!-- Header row -->
            <div class="cls-header">
                <div class="cls-icon ${isMorning ? 'cls-icon-morning' : 'cls-icon-night'}">
                    <i class="fas ${isMorning ? 'fa-sun' : 'fa-moon'}"></i>
                </div>
                <div class="cls-title-block">
                    <h3 class="cls-name">${esc(cls.name)}</h3>
                    <div class="cls-meta">
                        <span><i class="fas fa-clock"></i> ${esc(cls.schedule)}</span>
                        ${cls.days ? `<span><i class="fas fa-calendar-week"></i> ${esc(cls.days)}</span>` : ''}
                    </div>
                </div>
                ${timeBadge}
            </div>

            <!-- Info chips -->
            <div class="cls-chips">
                <span class="cls-chip"><i class="fas fa-user-tie"></i> ${esc(cls.instructor || 'Roy Franco')}</span>
                <span class="cls-chip"><i class="fas ${levelIcon}"></i> ${levelLabel}</span>
            </div>

            <!-- Capacity bar -->
            <div class="cls-capacity-block">
                <div class="cls-capacity-labels">
                    <span style="font-weight:700;color:var(--text-dark);">${enrolled.length} / ${cap} alumnos</span>
                    <span class="badge ${pctBadgeClass}" style="font-size:.7rem;">${pct}%</span>
                </div>
                <div class="cls-cap-track">
                    <div class="cls-cap-fill" style="width:${pct}%;background:${barColor};"></div>
                </div>
            </div>

            <!-- Avatar stack -->
            <div class="cls-avatar-row">
                <div class="cls-avatar-stack">${avatarStack}${avatarExtra}</div>
                ${enrolled.length === 0
                    ? `<span style="color:var(--text-gray);font-size:.8rem;">Sin alumnos inscritos</span>`
                    : `<span style="color:var(--text-gray);font-size:.8rem;">${enrolled.length === 1 ? '1 alumno inscrito' : enrolled.length + ' alumnos inscritos'}</span>`
                }
            </div>

            ${cls.description ? `<p class="cls-desc">${esc(cls.description)}</p>` : ''}

            <!-- Actions -->
            <div class="cls-actions">
                <button class="btn btn-primary btn-sm cls-btn-manage" onclick="manageClass('${cls.id}')">
                    <i class="fas fa-users"></i> Ver Alumnos
                </button>
                <button class="btn btn-secondary btn-sm" onclick="deleteClass('${cls.id}','${esc(cls.name)}')" title="Eliminar clase">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </div>
    </div>`;
}

function renderAllClasses(classes, students) {
    const grid = document.getElementById('allClassesGrid');
    if (!grid) return;

    // Update stats
    const getHour   = c => parseInt(((c.schedule || '12').match(/\d+/) || ['12'])[0]);
    const morning   = classes.filter(c => { const h = getHour(c); return h >= 5 && h < 12; });
    const afternoon = classes.filter(c => { const h = getHour(c); return h >= 12; });
    let totalE = 0, totalC = 0;
    classes.forEach(c => { totalE += getClassEnrolled(c, students).length; totalC += c.capacity || 20; });
    const avgPct = totalC > 0 ? Math.round(totalE / totalC * 100) : 0;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('statTotalClasses',    classes.length);
    set('statClassesMorning',  morning.length);
    set('statClassesAfternoon', afternoon.length);
    set('statClassesAvgPct',   avgPct + '%');

    if (classes.length === 0) {
        grid.innerHTML = `
        <div class="classes-empty-state">
            <i class="fas fa-calendar-times" style="font-size:3rem;color:var(--text-gray);margin-bottom:1rem;"></i>
            <h3 style="color:var(--text-dark);margin-bottom:.5rem;">No hay clases registradas</h3>
            <p style="color:var(--text-gray);margin-bottom:1.5rem;">Crea tu primera clase con el botón <b>Nueva Clase</b></p>
            <button class="btn btn-primary" onclick="openAddClassModal()"><i class="fas fa-plus"></i> Nueva Clase</button>
        </div>`;
        return;
    }

    grid.innerHTML = classes.map(cls => buildClassCard(cls, students)).join('');
    // Re-apply any active filters
    applyClassFilters();
}

// Filter classes in the grid
function applyClassFilters() {
    const q     = (document.getElementById('classSearchInput')?.value || '').toLowerCase();
    const level = document.getElementById('classLevelFilter')?.value || '';
    const time  = document.getElementById('classTimeFilter')?.value || '';
    const cards = document.querySelectorAll('.cls-card');
    let visible = 0;
    cards.forEach(card => {
        const name = card.dataset.name || '';
        const lv   = card.dataset.level || '';
        const hour = parseInt(card.dataset.hour || '12');
        const matchQ   = !q     || name.includes(q) || (card.querySelector('.cls-chips')?.textContent.toLowerCase().includes(q));
        const matchLvl = !level || lv === level;
        const matchT   = !time
            || (time === 'morning'   && hour >= 5 && hour < 12)
            || (time === 'afternoon' && hour >= 12);
        card.style.display = (matchQ && matchLvl && matchT) ? '' : 'none';
        if (matchQ && matchLvl && matchT) visible++;
    });
    // Show no-results message
    const grid = document.getElementById('allClassesGrid');
    const noRes = grid?.querySelector('.cls-no-results');
    if (visible === 0 && cards.length > 0) {
        if (!noRes) {
            const d = document.createElement('div');
            d.className = 'cls-no-results';
            d.innerHTML = '<i class="fas fa-search"></i><p>No se encontraron clases con ese filtro</p>';
            grid.appendChild(d);
        }
    } else {
        noRes?.remove();
    }
}

window.filterClasses = applyClassFilters;

window.deleteClass = async function (id, name) {
    if (!confirm(`¿Eliminar la clase "${name}"? Esta acción no se puede deshacer.`)) return;
    try {
        await deleteClassDoc(id);
        showNotification(`Clase "${name}" eliminada`, 'success');
    } catch (err) {
        showNotification('Error al eliminar: ' + err.message, 'error');
    }
};

window.manageClass = function (classId) {
    const cls = _allClasses.find(c => c.id === classId);
    if (!cls) { showNotification('Clase no encontrada', 'error'); return; }

    const enrolled = getClassEnrolled(cls, _allStudents);
    const cap      = cls.capacity || 20;
    const pct      = Math.min(100, Math.round(enrolled.length / cap * 100));
    const clr      = pct >= 90 ? '#EF4444' : pct >= 70 ? '#F59E0B' : '#10B981';
    const levelMap = { todos: 'Todos los niveles', principiante: 'Principiante', intermedio: 'Intermedio', avanzado: 'Avanzado' };

    const titleEl = document.getElementById('manageClassTitle');
    const infoEl  = document.getElementById('manageClassInfo');
    const stuEl   = document.getElementById('manageClassStudents');
    if (!titleEl || !infoEl || !stuEl) return;

    titleEl.textContent = cls.name;
    infoEl.innerHTML = `
        <div style="display:flex;gap:1rem;flex-wrap:wrap;margin-bottom:.75rem;font-size:.88rem;color:var(--text-gray);">
            <span><i class="fas fa-clock"></i> ${esc(cls.schedule)}</span>
            ${cls.days ? `<span><i class="fas fa-calendar"></i> ${esc(cls.days)}</span>` : ''}
            <span><i class="fas fa-user-tie"></i> ${esc(cls.instructor || 'Roy Franco')}</span>
            <span><i class="fas fa-layer-group"></i> ${levelMap[cls.level] || cls.level || 'Todos'}</span>
        </div>
        <div style="display:flex;align-items:center;gap:.75rem;background:var(--surface);border-radius:10px;padding:.75rem 1rem;margin-bottom:1rem;">
            <div style="font-size:1.5rem;font-weight:800;color:${clr};">${pct}%</div>
            <div style="flex:1;">
                <div style="font-size:.8rem;color:var(--text-gray);margin-bottom:.3rem;">Ocupación: ${enrolled.length} / ${cap} lugares</div>
                <div class="capacity-bar" style="height:8px;"><div class="capacity-fill" style="width:${pct}%;background:${clr};"></div></div>
            </div>
        </div>`;

    stuEl.innerHTML = enrolled.length === 0
        ? `<p style="text-align:center;color:var(--text-gray);padding:1.5rem;">Sin alumnos inscritos en este horario.<br><small>Los alumnos con horario "<b>${esc(cls.schedule)}</b>" aparecerán aquí.</small></p>`
        : enrolled.map(s => {
            const initials  = (s.name || '?').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
            const statColor = s.remainingClasses > 0 ? '#10B981' : '#EF4444';
            const statTxt   = s.remainingClasses > 0 ? 'Activo' : 'Vencido';
            return `
            <div style="display:flex;align-items:center;gap:.75rem;padding:.65rem 0;border-bottom:1px solid var(--border);">
                <div class="avatar" style="min-width:36px;width:36px;height:36px;font-size:.82rem;">${initials}</div>
                <div style="flex:1;min-width:0;">
                    <div style="font-weight:600;font-size:.9rem;">${esc(s.name)}</div>
                    <div style="font-size:.8rem;color:var(--text-gray);">${PLAN_LABELS[s.plan] || s.plan} &middot; ${s.remainingClasses} clases restantes</div>
                </div>
                <span style="font-size:.75rem;font-weight:700;color:${statColor};background:${statColor}22;padding:.2rem .5rem;border-radius:4px;white-space:nowrap;">
                    ${statTxt}
                </span>
            </div>`;
        }).join('');

    document.getElementById('manageClassModal')?.classList.add('active');
};

// ══════════════════════════════════════════════════════════════
//  TODAY'S CLASSES WIDGET
// ══════════════════════════════════════════════════════════════

function renderClassesToday(students) {
    const grid     = document.getElementById('classesTodayGrid');
    const subtitle = document.getElementById('classesTodaySubtitle');
    if (!grid) return;

    const active = students.filter(s => s.remainingClasses > 0);

    if (active.length === 0) {
        grid.innerHTML = `<div style="text-align:center;color:var(--text-gray);padding:2.5rem 1rem;">
            <i class="fas fa-calendar-times" style="font-size:2rem;opacity:.4;display:block;margin-bottom:.75rem;"></i>
            Sin alumnos activos registrados</div>`;
        if (subtitle) subtitle.textContent = '';
        return;
    }

    // Group by schedule slot, sort slots by hour
    const bySchedule = {};
    active.forEach(s => {
        const slot = s.schedule || 'Sin horario';
        if (!bySchedule[slot]) bySchedule[slot] = [];
        bySchedule[slot].push(s);
    });

    const slots = Object.keys(bySchedule).sort((a, b) => {
        const ha = parseInt((a.match(/\d+/) || ['0'])[0]);
        const hb = parseInt((b.match(/\d+/) || ['0'])[0]);
        return ha - hb;
    });

    if (subtitle) subtitle.textContent = `${slots.length} horario${slots.length !== 1 ? 's' : ''} · ${active.length} alumno${active.length !== 1 ? 's' : ''}`;

    grid.innerHTML = slots.map(slot => {
        const list = bySchedule[slot];
        const cls  = _allClasses.find(c =>
            (c.schedule || '').trim().toLowerCase() === slot.trim().toLowerCase() ||
            (c.name     || '').trim().toLowerCase() === slot.trim().toLowerCase()
        );
        const cap     = cls?.capacity || 20;
        const pct     = Math.min(100, Math.round(list.length / cap * 100));
        const barClr  = pct >= 90 ? '#EF4444' : pct >= 70 ? '#F59E0B' : '#10B981';
        const hour    = parseInt((slot.match(/\d+/) || ['12'])[0]);
        const isMorn  = hour >= 5 && hour < 12;
        const timeIcon = isMorn ? 'fa-sun' : 'fa-moon';
        const timeClr  = isMorn ? '#F59E0B' : '#6366F1';

        const studentRows = list.slice(0, 8).map(s => {
            const init     = (s.name || '?').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
            const planClr  = { diario:'#F59E0B', semanal:'#3B82F6', mensual:'#10B981' }[s.plan] || '#6B7280';
            const planLbl  = PLAN_LABELS[s.plan] || capitalize(s.plan || '');
            const daysLeft = daysUntilExpiry(s.expiryDate);
            const statDot  = (daysLeft !== null && daysLeft >= 0)
                ? `<span class="today-student-dot today-dot--active"></span>`
                : `<span class="today-student-dot today-dot--expired"></span>`;
            return `
            <div class="today-student-row">
                <div class="today-student-av" style="background:${planClr}22;color:${planClr};">${init}</div>
                <div class="today-student-info">
                    <span class="today-student-name">${esc(s.name)}</span>
                    <span class="today-student-plan">${planLbl}</span>
                </div>
                ${statDot}
            </div>`;
        }).join('');

        const extraCount = list.length > 8 ? `
            <p style="text-align:center;font-size:.78rem;color:var(--text-gray);padding:.5rem 0;margin:0;">
                +${list.length - 8} alumnos más
            </p>` : '';

        const clsName = cls?.name ? `<span class="today-slot-clsname">${esc(cls.name)}</span>` : '';

        return `
        <div class="today-slot-card">
            <div class="today-slot-hdr">
                <div class="today-slot-time">
                    <i class="fas ${timeIcon}" style="color:${timeClr};"></i>
                    <span>${esc(slot)}</span>
                    ${clsName}
                </div>
                <span class="today-slot-count">${list.length}/${cap}</span>
            </div>
            <div class="today-slot-bar">
                <div class="today-slot-fill" style="width:${pct}%;background:${barClr};"></div>
            </div>
            <div class="today-slot-students">
                ${studentRows}
                ${extraCount}
            </div>
        </div>`;
    }).join('');
}

// ══════════════════════════════════════════════════════════════
//  RECENT ACTIVITY FEED
// ══════════════════════════════════════════════════════════════

/** Cache latest payments for the activity feed */
let _latestPayments = [];

function renderActivityFeed(payments) {
    _latestPayments = payments;
    const feed = document.getElementById('activityFeed');
    if (!feed) return;

    // Show last 5 payments as activity items
    const recent = [...payments]
        .sort((a, b) => {
            const ta = a.createdAt?.seconds || 0;
            const tb = b.createdAt?.seconds || 0;
            return tb - ta;
        })
        .slice(0, 5);

    if (recent.length === 0) {
        feed.innerHTML = `<p style="text-align:center;color:var(--text-gray);padding:1rem;">Sin actividad reciente.</p>`;
        return;
    }

    const iconMap = { income: 'green fa-dollar-sign', expense: 'red fa-minus-circle' };

    feed.innerHTML = recent.map(p => `
    <div class="activity-item">
        <div class="activity-icon blue"><i class="fas fa-credit-card"></i></div>
        <div class="activity-content">
            <h4>Pago ${p.status === 'Pagado' ? 'recibido' : 'pendiente'}</h4>
            <p>${esc(p.studentName)} — ${formatMXN(p.amount || 0)} (${capitalize(p.plan || '')})</p>
            <small style="color:var(--text-gray);">${formatDate(p.createdAt)}</small>
        </div>
    </div>`).join('');
}

// ══════════════════════════════════════════════════════════════
//  BIRTHDAYS WIDGET
// ══════════════════════════════════════════════════════════════

function renderBirthdays(students) {
    const list = document.getElementById('birthdayList');
    if (!list) return;

    const thisMonth = new Date().getMonth() + 1; // 1-12
    const withBday  = students.filter(s => {
        if (!s.birthday) return false;
        const [, m] = s.birthday.split('-').map(Number); // expects YYYY-MM-DD
        return m === thisMonth;
    });

    if (withBday.length === 0) {
        list.innerHTML = `<p style="text-align:center;color:var(--text-gray);padding:1rem;">Sin cumplea&ntilde;os registrados este mes.<br><small>Agrega fecha de nacimiento al registrar alumnos.</small></p>`;
        return;
    }

    list.innerHTML = withBday.map(s => {
        const initials = (s.name || '?').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
        const phone    = (s.phone || '').replace(/\D/g, '');
        const intlPhone = phone.startsWith('52') ? phone : '521' + phone;
        const dayPart  = s.birthday ? s.birthday.slice(8) : '?';
        const months   = ['','Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
        const monNum   = parseInt(s.birthday?.slice(5, 7) || '1', 10);
        return `
        <div class="birthday-item">
            <div class="birthday-avatar">${initials}</div>
            <div class="birthday-info">
                <h4>${esc(s.name)}</h4>
                <p>Cumple el ${dayPart} de ${months[monNum]}</p>
            </div>
            <button class="btn btn-whatsapp btn-sm" onclick="sendBirthdayWish('${intlPhone}','${esc(s.name)}')">
                <i class="fab fa-whatsapp"></i> Felicitar
            </button>
        </div>`;
    }).join('');
}

// ══════════════════════════════════════════════════════════════
//  PROGRESS PANEL
// ══════════════════════════════════════════════════════════════

function renderProgressList(students) {
    const list = document.getElementById('progressList');
    if (!list) return;

    if (students.length === 0) {
        list.innerHTML = `<p style="text-align:center;color:var(--text-gray);padding:2rem;">Sin alumnos registrados.</p>`;
        return;
    }

    list.innerHTML = students.map(s => {
        const initials    = (s.name || '?').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
        const startDate   = s.startDate || (s.createdAt ? formatDate(s.createdAt) : '—');
        const attendCount = Array.isArray(s.attendanceHistory) ? s.attendanceHistory.length : 0;
        return `
        <div class="progress-item">
            <div class="progress-avatar">${initials}</div>
            <div class="progress-info">
                <h4>${esc(s.name)}</h4>
                <p>Nivel: ${capitalize(s.level || '—')} | Inicio: ${esc(startDate)}</p>
                <div class="progress-stats">
                    <span><i class="fas fa-calendar-check"></i> ${attendCount} clases asistidas</span>
                    <span><i class="fas fa-layer-group"></i> ${capitalize(s.plan || '—')}</span>
                    <span><i class="fas fa-ticket-alt"></i> ${s.remainingClasses}/${s.totalClasses} restantes</span>
                </div>
            </div>
            <div class="progress-actions">
                <button class="btn btn-primary btn-sm" onclick="attendStudent('${s.id}')">
                    <i class="fas fa-check"></i> Asistencia
                </button>
            </div>
        </div>`;
    }).join('');
}

// ══════════════════════════════════════════════════════════════
//  FINANCES TABLE & STATS
// ══════════════════════════════════════════════════════════════

function renderFinancesTable(finances) {
    const tbody = document.getElementById('financesTableBody');
    if (!tbody) return;

    if (finances.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--text-gray);padding:2rem;">Sin movimientos registrados.</td></tr>`;
        return;
    }

    const sorted = [...finances].sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    tbody.innerHTML = sorted.map(f => {
        const isIncome = f.type === 'income';
        const amtStr   = isIncome ? `+${formatMXN(f.amount)}` : `-${formatMXN(f.amount)}`;
        const clr      = isIncome ? 'var(--success)' : 'var(--danger)';
        const badge    = isIncome
            ? '<span class="badge badge-success">Ingreso</span>'
            : '<span class="badge badge-danger">Gasto</span>';
        const label    = f.studentName ? `${f.concept} — ${f.studentName}` : f.concept;
        const method   = f.paymentMethod ? `<span style="font-size:.75rem;color:var(--text-gray);">${esc(f.paymentMethod)}</span>` : '';
        const noteTxt  = f.notes ? esc(f.notes) : '';
        return `
        <tr>
            <td>${formatDate(f.createdAt)}</td>
            <td>${esc(label)}<br>${method}</td>
            <td>${badge}</td>
            <td style="font-size:.8rem;color:var(--text-gray);max-width:160px;">${noteTxt}</td>
            <td style="color:${clr};font-weight:600;">${amtStr}</td>
        </tr>`;
    }).join('');
}

function updateFullFinancesStats(payments, finances) {
    const now   = new Date();
    const month = now.getMonth();
    const year  = now.getFullYear();

    const inMonth = d => {
        if (!d) return false;
        const dt = d.toDate ? d.toDate() : new Date(d.seconds * 1000);
        return dt.getMonth() === month && dt.getFullYear() === year;
    };

    // Income: sum of paid payments this month + finance income entries
    const payIncome   = (payments || []).filter(p => p.status === 'Pagado' && inMonth(p.createdAt)).reduce((a, p) => a + (p.amount || 0), 0);
    const finIncome   = (finances  || []).filter(f => f.type === 'income'  && inMonth(f.createdAt)).reduce((a, f) => a + (f.amount || 0), 0);
    const finExpense  = (finances  || []).filter(f => f.type === 'expense' && inMonth(f.createdAt)).reduce((a, f) => a + (f.amount || 0), 0);
    const totalIncome = payIncome + finIncome;
    const balance     = totalIncome - finExpense;

    set('statFinanceIncome',  formatMXN(totalIncome));
    set('statFinanceExpense', formatMXN(finExpense));
    set('statFinanceBalance', formatMXN(balance));
}

/** Full students array used for filtering */
let _allStudents = [];

function renderStudentsTable(students) {
    _allStudents = students;
    applyStudentsFilter(students);
}

function applyStudentsFilter(students) {
    const level  = document.getElementById('filterLevel')?.value  || '';
    const plan   = document.getElementById('filterPlan')?.value   || '';
    const status = document.getElementById('filterStatus')?.value || '';

    const filtered = students.filter(s => {
        if (level  && s.level  !== level)  return false;
        if (plan   && s.plan   !== plan)   return false;
        if (status === 'activo'    && s.remainingClasses <= 0) return false;
        if (status === 'inactivo'  && s.remainingClasses >  0) return false;
        if (status === 'pendiente') {
            const d = daysUntilExpiry(s.expiryDate);
            if (!(d !== null && d <= 5)) return false;
        }
        return true;
    });

    const tbody = document.getElementById('studentsTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--text-gray);padding:2rem;">Sin alumnos registrados.</td></tr>`;
        return;
    }

    filtered.forEach(s => tbody.insertAdjacentHTML('beforeend', buildStudentRow(s)));
}

function buildStudentRow(s) {
    const initials    = (s.name || '?').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
    const planLabel   = PLAN_LABELS[s.plan] || capitalize(s.plan || '');
    const levelLabel  = capitalize(s.level || '');

    const daysLeft    = daysUntilExpiry(s.expiryDate);
    let timeLeftText  = 'Sin fecha';
    let timeColor     = 'var(--text-gray)';
    let statusCls     = 'badge-danger';
    let statusTxt     = 'Vencido';

    if (daysLeft !== null) {
        if (daysLeft >= 0) {
            timeLeftText = daysLeft === 0 ? 'Vence hoy' : `${daysLeft} día(s)`;
            timeColor = daysLeft <= 5 ? 'var(--warning)' : 'var(--success)';
            statusCls = 'badge-success';
            statusTxt = 'Activo';
        } else {
            timeLeftText = `Venció hace ${Math.abs(daysLeft)} día(s)`;
            timeColor = 'var(--danger)';
        }
    }

    return `
    <tr id="student-row-${s.id}">
        <td>
            <div class="student-info-cell">
                <div class="avatar">${initials}</div>
                <div class="info">
                    <h4>${esc(s.name)}</h4>
                    <p>${levelLabel}</p>
                </div>
            </div>
        </td>
        <td>${esc(s.phone)}</td>
        <td><span class="badge badge-warning">${esc(s.schedule)}</span></td>
        <td>${planLabel}</td>
        <td>
            <div style="display:flex;align-items:center;gap:.5rem;">
                <strong style="color:${timeColor}; font-size: 0.9rem; min-width: 100px;">${timeLeftText}</strong>
                <button class="btn btn-success btn-sm" onclick="openRenewModal('${s.id}')" title="Agregar tiempo">
                    <i class="fas fa-plus"></i> Tiempo
                </button>
            </div>
        </td>
        <td><span class="badge ${statusCls}">${statusTxt}</span></td>
        <td>
            <div class="action-btns">
                <button class="btn btn-info btn-sm"    onclick="viewStudent('${s.id}')"           title="Ver"><i class="fas fa-eye"></i></button>
                <button class="btn btn-warning btn-sm" onclick="editStudent('${s.id}')"           title="Editar"><i class="fas fa-edit"></i></button>
                <button class="btn btn-whatsapp btn-sm" onclick="openCustomWhatsApp('${s.id}')"   title="WhatsApp personalizado"><i class="fab fa-whatsapp"></i></button>
                <button class="btn btn-danger btn-sm"  onclick="deleteStudent('${s.id}')"         title="Eliminar"><i class="fas fa-trash"></i></button>
            </div>
        </td>
    </tr>`;
}

window.filterStudents = function () {
    applyStudentsFilter(_allStudents);
};

window.exportStudents = function () {
    const rows = [['Nombre','Teléfono','Email','Nivel','Plan','Horario','Clases Restantes','Estado','Fecha Registro']];
    _allStudents.forEach(s => {
        rows.push([
            s.name, s.phone, s.email, s.level, s.plan, s.schedule,
            `${s.remainingClasses}/${s.totalClasses}`,
            s.remainingClasses > 0 ? 'Activo' : 'Vencido',
            formatDate(s.createdAt),
        ]);
    });
    const csv = rows.map(r => r.map(v => `"${(v||'').toString().replace(/"/g,'""')}"`).join(',')).join('\n');
    const a   = Object.assign(document.createElement('a'), {
        href:     'data:text/csv;charset=utf-8,' + encodeURIComponent('\uFEFF' + csv),
        download: `alumnos_${new Date().toISOString().slice(0,10)}.csv`,
    });
    a.click();
    showNotification('Lista de alumnos exportada', 'success');
};

// ── Add student modal ──────────────────────────────────────────

window.openAddStudentModal = function () {
    document.getElementById('addStudentModal').classList.add('active');
};

window.closeAdminModal = function (id) {
    document.getElementById(id)?.classList.remove('active');
};

window.updateClassesPreview = function () {
    const plan       = document.getElementById('newStudentPlan')?.value;
    const previewBox = document.getElementById('classesPreviewBox');
    const previewNum = document.getElementById('classesPreviewNumber');
    const previewTxt = document.getElementById('classesPreviewText');
    if (!previewBox) return;

    const map = {
        diario:  { classes: 1,  desc: '1 clase única',              color: '#F59E0B' },
        semanal: { classes: 5,  desc: '5 clases · vence en 7 días',   color: '#3B82F6' },
        mensual: { classes: 22, desc: '22 clases · vence en 30 días', color: '#10B981' },
    };
    const info = map[plan];
    if (info) {
        previewBox.style.display = 'block';
        previewNum.textContent   = info.classes;
        previewNum.style.color   = info.color;
        const startDate = document.getElementById('newStudentStartDate')?.value;
        const expiry    = calcExpiryDate(startDate, plan);
        previewTxt.textContent = expiry ? `${info.desc} (${expiry})` : info.desc;
    } else {
        previewBox.style.display = 'none';
    }
};

window.saveNewStudent = async function (e) {
    e.preventDefault();
    const btn = e.target.querySelector('[type=submit]') || e.submitter;
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }

    const classesByPlan = { diario: 1, semanal: 5, mensual: 22 };
    const plan          = document.getElementById('newStudentPlan').value;
    const totalClasses  = classesByPlan[plan] || 1;
    const startDate     = document.getElementById('newStudentStartDate').value;
    const expiryDate    = calcExpiryDate(startDate, plan);

    try {
        await addStudent({
            name:              document.getElementById('newStudentName').value.trim(),
            email:             document.getElementById('newStudentEmail').value.trim(),
            phone:             document.getElementById('newStudentPhone').value.trim(),
            level:             document.getElementById('newStudentLevel').value,
            plan,
            schedule:          document.getElementById('newStudentSchedule').value.trim(),
            startDate,
            expiryDate,
            birthday:          document.getElementById('newStudentBirthday')?.value || '',
            paymentMethod:     document.getElementById('newStudentPaymentMethod').value,
            receiptCode:       document.getElementById('newStudentReceiptCode')?.value?.trim() || '',
            notes:             document.getElementById('newStudentNotes')?.value?.trim() || '',
            totalClasses,
            remainingClasses:  totalClasses,
            attendanceHistory: [],
            status:            'Activo',
        });
        
        // Auto-register finance income for semanal/mensual plans
        let paymentMsg = '';
        const planLabel = PLAN_LABELS[plan] || plan;
        const amt = currentPricing[plan] || 0;
        
        if ((plan === 'semanal' || plan === 'mensual') && amt > 0) {
            const payMethod = document.getElementById('newStudentPaymentMethod')?.value || '';
            const conceptMap = { mensual: 'Mensualidad', semanal: 'Plan Semanal', diario: 'Pase Diario' };
            const concept = conceptMap[plan] || 'Ingreso';
            const noteStr = `${concept} — ${payMethod || 'No especificado'}`;
            try {
                const studentName = document.getElementById('newStudentName').value.trim();
                await addFinanceEntry('income', concept, amt, noteStr, studentName);
                paymentMsg = ` • Pago de ${amt} MXN registrado automáticamente`;
            } catch (_) { /* non-blocking */ }
        }
        
        showNotification(`✓ Alumno registrado — ${planLabel} (${totalClasses} clase${totalClasses > 1 ? 's' : ''})${paymentMsg}`, 'success');
        closeAdminModal('addStudentModal');
        document.getElementById('addStudentForm').reset();
        document.getElementById('classesPreviewBox').style.display = 'none';
    } catch (err) {
        showNotification('Error al guardar: ' + err.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Registrar Alumno'; }
    }
};

// ── Attendance ─────────────────────────────────────────────────

window.attendStudent = async function (id) {
    try {
        await registerStudentAttendance(id);
        showNotification('Asistencia registrada', 'success');
    } catch (err) {
        showNotification(err.message, 'error');
    }
};

// ── View / Edit / Delete ───────────────────────────────────────

window.viewStudent = function (id) {
    const s = _allStudents.find(x => x.id === id);
    if (!s) return;
    const fields = {
        viewStudentName:     s.name || '—',
        viewStudentEmail:    s.email || '—',
        viewStudentPhone:    s.phone || '—',
        viewStudentLevel:    capitalize(s.level || '—'),
        viewStudentPlan:     PLAN_LABELS[s.plan] || capitalize(s.plan || '—'),
        viewStudentSchedule: s.schedule || '—',
        viewStudentClasses:  s.remainingClasses + ' / ' + s.totalClasses,
        viewStudentStatus:   s.remainingClasses > 0 ? 'Activo' : 'Vencido',
        viewStudentStart:    s.startDate || '—',
        viewStudentExpiry:   s.expiryDate || '—',
        viewStudentBirthday: s.birthday || '—',
        viewStudentAttended: (Array.isArray(s.attendanceHistory) ? s.attendanceHistory.length : 0) + ' clases',
        viewStudentNotes:    s.notes || '—',
    };
    Object.entries(fields).forEach(([elId, val]) => set(elId, val));
    document.getElementById('viewStudentModal')?.classList.add('active');
};

window.editStudent = function (id) {
    const s = _allStudents.find(x => x.id === id);
    if (!s) return;
    const m = document.getElementById('editStudentModal');
    if (!m) return;
    document.getElementById('editStudentId').value        = s.id;
    document.getElementById('editStudentName').value      = s.name || '';
    document.getElementById('editStudentEmail').value     = s.email || '';
    document.getElementById('editStudentPhone').value     = s.phone || '';
    document.getElementById('editStudentLevel').value     = s.level || '';
    document.getElementById('editStudentPlan').value      = s.plan || '';
    document.getElementById('editStudentSchedule').value  = s.schedule || '';
    document.getElementById('editStudentStartDate').value = s.startDate || '';
    document.getElementById('editStudentBirthday').value  = s.birthday || '';
    document.getElementById('editStudentNotes').value     = s.notes || '';
    document.getElementById('editStudentClasses').value   = s.remainingClasses != null ? s.remainingClasses : 0;
    m.classList.add('active');
};

window.saveEditStudent = async function (e) {
    e.preventDefault();
    const btn = e.submitter || e.target.querySelector('[type=submit]');
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }
    const id        = document.getElementById('editStudentId').value;
    const plan      = document.getElementById('editStudentPlan').value;
    const startDate = document.getElementById('editStudentStartDate').value;
    const oldPlan   = _allStudents.find(s => s.id === id)?.plan || '';
    try {
        await updateStudent(id, {
            name:             document.getElementById('editStudentName').value.trim(),
            email:            document.getElementById('editStudentEmail').value.trim(),
            phone:            document.getElementById('editStudentPhone').value.trim(),
            level:            document.getElementById('editStudentLevel').value,
            plan,
            schedule:         document.getElementById('editStudentSchedule').value.trim(),
            startDate,
            expiryDate:       calcExpiryDate(startDate, plan),
            birthday:         document.getElementById('editStudentBirthday').value,
            notes:            document.getElementById('editStudentNotes').value.trim(),
            remainingClasses: parseInt(document.getElementById('editStudentClasses').value) || 0,
        });
        
        // Auto-register payment if plan changed to semanal/mensual
        if (plan !== oldPlan && (plan === 'semanal' || plan === 'mensual')) {
            const amt = currentPricing[plan] || 0;
            const conceptMap = { mensual: 'Mensualidad', semanal: 'Plan Semanal' };
            const concept = conceptMap[plan] || 'Ingreso';
            const studentName = document.getElementById('editStudentName').value.trim();
            if (amt > 0) {
                try {
                    await addFinanceEntry('income', concept, amt, `${concept} (cambio de plan)`, studentName);
                    showNotification(`Alumno actualizado — Pago de ${concept} registrado ($${amt} MXN)`, 'success');
                } catch (_) {
                    showNotification('Alumno actualizado (error al registrar pago)', 'warning');
                }
            } else {
                showNotification('Alumno actualizado correctamente', 'success');
            }
        } else {
            showNotification('Alumno actualizado correctamente', 'success');
        }
        closeAdminModal('editStudentModal');
    } catch (err) {
        showNotification('Error al actualizar: ' + err.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Guardar Cambios'; }
    }
};

window.deleteStudent = async function (id) {
    if (!confirm('¿Eliminar este alumno? Esta acción no se puede deshacer.')) return;
    try {
        await deleteStudentById(id);
        showNotification('Alumno eliminado', 'success');
    } catch (err) {
        showNotification('Error al eliminar: ' + err.message, 'error');
    }
};

// ══════════════════════════════════════════════════════════════
//  PAYMENTS
// ══════════════════════════════════════════════════════════════

function renderPaymentsTable(payments) {
    const tbody = document.getElementById('paymentsTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (payments.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--text-gray);padding:2rem;">Sin pagos registrados.</td></tr>`;
        return;
    }

    payments.forEach(p => {
        const initials   = (p.studentName || '?').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
        const statusCls  = p.status === 'Pagado' ? 'badge-success' : 'badge-warning';
        tbody.insertAdjacentHTML('beforeend', `
        <tr>
            <td>
                <div class="student-info-cell">
                    <div class="avatar">${initials}</div>
                    <div class="info"><h4>${esc(p.studentName)}</h4></div>
                </div>
            </td>
            <td>${capitalize(p.plan || '')}</td>
            <td><strong>${formatMXN(p.amount)}</strong></td>
            <td>${formatDate(p.createdAt)}</td>
            <td>${capitalize(p.method || '')}</td>
            <td>
                <div style="display:flex;align-items:center;gap:.5rem;">
                    <span class="badge ${statusCls}">${p.status || 'Pendiente'}</span>
                    ${p.status !== 'Pagado'
                        ? `<button class="btn btn-success btn-sm" onclick="paymentMarkPaid('${p.id}')"><i class="fas fa-check"></i></button>`
                        : ''}
                </div>
            </td>
        </tr>`);
    });
}

function renderPaymentsStats(payments) {
    const now       = new Date();
    const thisMonth = payments.filter(p => {
        if (!p.createdAt) return false;
        const d = p.createdAt.toDate ? p.createdAt.toDate() : new Date(p.createdAt.seconds * 1000);
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });

    const monthlyTotal  = thisMonth.reduce((acc, p) => acc + (p.amount || 0), 0);
    const pendingTotal  = payments.filter(p => p.status !== 'Pagado').reduce((acc, p) => acc + (p.amount || 0), 0);

    set('statMonthlyIncome',   formatMXN(monthlyTotal));
    set('statPendingPayments', formatMXN(pendingTotal));
    set('statDashboardIncome', formatMXN(monthlyTotal));
}

window.paymentMarkPaid = async function (id) {
    try {
        await markPaymentPaid(id);
        showNotification('Pago marcado como pagado', 'success');
    } catch (err) {
        showNotification('Error: ' + err.message, 'error');
    }
};

window.openAddPaymentModal = function () {
    const sel = document.getElementById('paymentStudentSelect');
    if (sel) {
        sel.innerHTML = '<option value="">Seleccionar alumno</option>' +
            _allStudents.map(s => `<option value="${esc(s.name)}" data-plan="${s.plan}">${esc(s.name)}</option>`).join('');
        sel.onchange = function () {
            const opt = sel.selectedOptions[0];
            const planEl = document.getElementById('paymentPlan');
            if (opt && opt.dataset.plan && planEl) planEl.value = opt.dataset.plan;
            const amtEl = document.getElementById('paymentAmount');
            if (opt && opt.dataset.plan && amtEl && !amtEl.value) amtEl.value = currentPricing[opt.dataset.plan] || '';
        };
    }
    document.getElementById('addPaymentModal')?.classList.add('active');
};

window.saveNewPayment = async function (e) {
    e.preventDefault();
    const btn = e.submitter || e.target.querySelector('[type=submit]');
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }
    const studentName = document.getElementById('paymentStudentSelect')?.value?.trim() ||
                        document.getElementById('paymentStudentManual')?.value?.trim();
    const amount  = parseFloat(document.getElementById('paymentAmount')?.value || '0');
    const plan    = document.getElementById('paymentPlan')?.value || 'mensual';
    const method  = document.getElementById('paymentMethod')?.value || 'efectivo';
    const notes   = document.getElementById('paymentNotes')?.value?.trim() || '';
    if (!studentName) {
        showNotification('Selecciona o escribe el nombre del alumno', 'error');
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Registrar Pago'; }
        return;
    }
    if (!amount || amount <= 0) {
        showNotification('Ingresa un monto válido', 'error');
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Registrar Pago'; }
        return;
    }
    try {
        await addPayment({ studentName, amount, plan, method, notes, status: 'Pagado' });
        showNotification('Pago registrado correctamente', 'success');
        closeAdminModal('addPaymentModal');
        document.getElementById('addPaymentForm')?.reset();
    } catch (err) {
        showNotification('Error: ' + err.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Registrar Pago'; }
    }
};

// ══════════════════════════════════════════════════════════════
//  FINANCES
// ══════════════════════════════════════════════════════════════

function renderFinancesStats(payments) {
    updateFullFinancesStats(payments, _allFinances);
}

window.registerIncome = async function () {
    const conceptEl  = document.getElementById('incomeConceptSelect');
    const amountEl   = document.getElementById('incomeAmountInput');
    const studentEl  = document.getElementById('incomeStudentInput');
    const notesEl    = document.getElementById('incomeNotesInput');
    const methodEl   = document.getElementById('incomeMethodSelect');

    const concept = conceptEl?.value || 'mensualidad';
    const amount  = parseFloat(amountEl?.value || '0');
    const student = studentEl?.value?.trim() || '';
    const notes   = notesEl?.value?.trim()   || '';
    const method  = methodEl?.value?.trim()  || '';

    if (!amount || amount <= 0) { showNotification('Ingresa un monto válido', 'error'); return; }

    try {
        const fullNotes = [notes, method ? `Forma de pago: ${method}` : ''].filter(Boolean).join(' — ');
        await addFinanceEntry('income', concept, amount, fullNotes, student);
        if (amountEl)  amountEl.value  = '';
        if (studentEl) studentEl.value = '';
        if (notesEl)   notesEl.value   = '';
        showNotification(`Ingreso de $${formatMXN(amount)} registrado`, 'success');
    } catch (err) {
        showNotification('Error: ' + err.message, 'error');
    }
};

window.registerExpense = async function () {
    const conceptEl   = document.getElementById('expenseConceptInput');
    const amountEl    = document.getElementById('expenseAmountInput');
    const providerEl  = document.getElementById('expenseNotesInput');   // "Proveedor" field
    const extraNotesEl = document.getElementById('expenseExtraNotesInput'); // optional extra notes

    const concept = conceptEl?.value || 'Gasto';
    const amount  = parseFloat(amountEl?.value || '0');
    const notes   = [providerEl?.value?.trim(), extraNotesEl?.value?.trim()].filter(Boolean).join(' — ');

    if (!amount || amount <= 0) { showNotification('Ingresa un monto válido', 'error'); return; }

    try {
        await addFinanceEntry('expense', concept, amount, notes);
        if (amountEl)    amountEl.value    = '';
        if (providerEl)  providerEl.value  = '';
        if (extraNotesEl) extraNotesEl.value = '';
        showNotification(`Gasto de ${formatMXN(amount)} registrado`, 'success');
    } catch (err) {
        showNotification('Error: ' + err.message, 'error');
    }
};

window.exportFinances = function () {
    const now     = new Date();
    const dateStr = now.toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' });
    const month   = now.getMonth();
    const year    = now.getFullYear();
    const inMonth = d => {
        if (!d) return false;
        const dt = d.toDate ? d.toDate() : new Date(d.seconds * 1000);
        return dt.getMonth() === month && dt.getFullYear() === year;
    };
    const sorted   = [..._allFinances].sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    const income   = sorted.filter(f => f.type === 'income');
    const expense  = sorted.filter(f => f.type === 'expense');
    const totIn    = income.reduce((a, f) => a + (f.amount || 0), 0);
    const totEx    = expense.reduce((a, f) => a + (f.amount || 0), 0);
    const balance  = totIn - totEx;

    const rowsHtml = sorted.map(f => {
        const isInc = f.type === 'income';
        const label = f.studentName ? `${f.concept} — ${f.studentName}` : f.concept;
        const sign  = isInc ? '+' : '-';
        const color = isInc ? '#10B981' : '#EF4444';
        const type  = isInc ? 'Ingreso' : 'Gasto';
        const dt    = f.createdAt ? (f.createdAt.toDate ? f.createdAt.toDate() : new Date(f.createdAt.seconds * 1000)) : null;
        const dateF = dt ? dt.toLocaleDateString('es-MX') : '—';
        return `<tr>
            <td>${dateF}</td>
            <td>${label.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</td>
            <td>${(f.paymentMethod || '').replace(/&/g,'&amp;') || '—'}</td>
            <td style="color:${color};">${type}</td>
            <td>${(f.notes || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') || '—'}</td>
            <td style="color:${color};font-weight:700;text-align:right;">${sign}$${f.amount?.toLocaleString('es-MX') || '0'}</td>
        </tr>`;
    }).join('');

    const html = `<!DOCTYPE html><html lang="es"><head>
        <meta charset="UTF-8">
        <title>Reporte Financiero — ${dateStr}</title>
        <style>
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body { font-family: Arial, sans-serif; font-size: 12px; color: #111; background: #fff; padding: 2rem; }
            .hdr { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 3px solid #E63946; padding-bottom: 1rem; margin-bottom: 1.5rem; }
            .title { font-size: 22px; font-weight: 800; color: #E63946; letter-spacing: 2px; }
            .subtitle { font-size: 11px; color: #666; }
            .stats { display: grid; grid-template-columns: repeat(3,1fr); gap: 10px; margin-bottom: 1.5rem; }
            .stat { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; text-align: center; }
            .stat strong { display: block; font-size: 18px; font-weight: 800; }
            .stat span { font-size: 10px; color: #666; }
            .green { color: #10B981; } .red { color: #EF4444; } .blue { color: #3B82F6; }
            table { width: 100%; border-collapse: collapse; font-size: 11px; }
            th { background: #0F172A; color: #fff; padding: 7px 8px; text-align: left; }
            td { padding: 5px 8px; border-bottom: 1px solid #e2e8f0; }
            tr:nth-child(even) td { background: #f8fafc; }
            .footer { margin-top: 1.5rem; padding-top: .75rem; border-top: 1px solid #e2e8f0; font-size: 10px; color: #999; text-align: center; }
        </style>
    </head><body>
        <div class="hdr">
            <div>
                <div class="title">🥊 BOXEO FRANCO</div>
                <div class="subtitle">Reporte Financiero Completo</div>
            </div>
            <div class="subtitle">Generado: ${dateStr}</div>
        </div>
        <div class="stats">
            <div class="stat"><strong class="green">$${totIn.toLocaleString('es-MX')}</strong><span>Total Ingresos</span></div>
            <div class="stat"><strong class="red">$${totEx.toLocaleString('es-MX')}</strong><span>Total Gastos</span></div>
            <div class="stat"><strong class="${balance >= 0 ? 'green' : 'red'}">${balance >= 0 ? '+' : ''}$${Math.abs(balance).toLocaleString('es-MX')}</strong><span>Balance Neto</span></div>
        </div>
        <table>
            <thead><tr><th>Fecha</th><th>Concepto</th><th>Método</th><th>Tipo</th><th>Notas</th><th style="text-align:right;">Monto</th></tr></thead>
            <tbody>${rowsHtml}</tbody>
        </table>
        <div class="footer">Reporte generado por sistema Boxeo Franco · ${dateStr}</div>
        <script>window.onload = () => window.print();<\/script>
    </body></html>`;

    const w = window.open('', '_blank', 'width=900,height=700');
    if (!w) { showNotification('Activa las ventanas emergentes para exportar', 'warning'); return; }
    w.document.write(html);
    w.document.close();
    showNotification('Reporte financiero generado — guarda como PDF con Ctrl+P', 'success');
};

// ══════════════════════════════════════════════════════════════
//  RENEW SUBSCRIPTION
// ══════════════════════════════════════════════════════════════

window.openRenewModal = function (id) {
    const s = _allStudents.find(x => x.id === id);
    if (!s) return;
    document.getElementById('renewStudentId').value   = id;
    document.getElementById('renewStudentName').textContent = s.name;
    document.getElementById('renewPlan').value        = s.plan || 'mensual';
    document.getElementById('renewStartDate').value   = new Date().toISOString().split('T')[0];
    document.getElementById('renewPaymentMethod').value = '';
    document.getElementById('renewModal')?.classList.add('active');
};

window.saveRenew = async function (e) {
    e.preventDefault();
    const btn = e.submitter || e.target.querySelector('[type=submit]');
    if (btn) { btn.disabled = true; btn.textContent = 'Renovando…'; }

    const id      = document.getElementById('renewStudentId').value;
    const plan    = document.getElementById('renewPlan').value;
    const start   = document.getElementById('renewStartDate').value;
    const method  = document.getElementById('renewPaymentMethod').value;
    const classesByPlan = { diario: 1, semanal: 5, mensual: 22 };
    const totalCls  = classesByPlan[plan] || 1;
    const expiryDate = calcExpiryDate(start, plan);
    const s = _allStudents.find(x => x.id === id);

    try {
        await updateStudent(id, {
            plan,
            startDate:        start,
            expiryDate,
            totalClasses:     totalCls,
            remainingClasses: totalCls,
            status:           'Activo',
        });
        // Register income
        const concept = { mensual: 'Mensualidad', semanal: 'Plan Semanal', diario: 'Pase Diario' }[plan] || 'Renovación';
        const amt     = currentPricing[plan] || 0;
        const noteStr = `Renovación — ${method || 'No especificado'}`;
        if (amt > 0) await addFinanceEntry('income', concept, amt, noteStr, s?.name || '');
        showNotification(`Suscripción renovada — Plan ${PLAN_LABELS[plan]}`, 'success');
        closeAdminModal('renewModal');
    } catch (err) {
        showNotification('Error: ' + err.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-sync-alt"></i> Renovar'; }
    }
};

// ══════════════════════════════════════════════════════════════
//  CUSTOM WHATSAPP MESSAGE
// ══════════════════════════════════════════════════════════════

window.openCustomWhatsApp = function (id) {
    const s = _allStudents.find(x => x.id === id);
    if (!s) return;
    document.getElementById('customWaStudentId').value     = id;
    document.getElementById('customWaStudentName').textContent = s.name;
    const days = daysUntilExpiry(s.expiryDate);
    const amt  = currentPricing[s.plan] || 700;
    // pre-fill default message
    let defaultMsg = `¡Hola ${s.name}! 🥊

`;
    if (s.remainingClasses <= 0 || (days !== null && days <= 3)) {
        defaultMsg += `Te recordamos que tu plan *${PLAN_LABELS[s.plan]}* ${days !== null && days >= 0 ? `vence en *${days} día(s)*` : 'ha *vencido*'}.

¡Renueva para seguir entrenando! 💪
📞 686 348 4588`;
    } else {
        defaultMsg += `¡Gracias por ser parte de la familia Boxeo Franco! 💪

Cualquier duda estamos para ayudarte.
📞 686 348 4588`;
    }
    document.getElementById('customWaText').value = defaultMsg;
    document.getElementById('customWaModal')?.classList.add('active');
};

window.sendCustomWa = function () {
    const id  = document.getElementById('customWaStudentId').value;
    const msg = document.getElementById('customWaText')?.value?.trim();
    if (!msg) { showNotification('Escribe un mensaje', 'warning'); return; }
    const s = _allStudents.find(x => x.id === id);
    if (!s) return;
    const phone     = (s.phone || '').replace(/\D/g, '');
    if (!phone) { showNotification('El alumno no tiene teléfono registrado', 'error'); return; }
    const intlPhone = phone.startsWith('52') ? phone : '521' + phone;
    window.open(`https://wa.me/${intlPhone}?text=${encodeURIComponent(msg)}`, '_blank');
    showNotification(`Mensaje abierto para ${s.name}`, 'success');
    closeAdminModal('customWaModal');
};

// ══════════════════════════════════════════════════════════════
//  SETTINGS
// ══════════════════════════════════════════════════════════════

window.saveSettings = async function () {
    const data = {
        gymName:  document.getElementById('settingsGymName')?.value?.trim()  || '',
        phone:    document.getElementById('settingsPhone')?.value?.trim()     || '',
        address:  document.getElementById('settingsAddress')?.value?.trim()   || '',
        email:    document.getElementById('settingsEmail')?.value?.trim()     || '',
        schedule: document.getElementById('settingsSchedule')?.value?.trim()  || '',
    };
    try {
        await saveSettingsDoc(data);
        showNotification('Configuración guardada', 'success');
    } catch (err) {
        showNotification('Error: ' + err.message, 'error');
    }
};

window.updateAdminCredentials = function () {
    showNotification('Para cambiar contraseña usa Firebase Console → Authentication', 'success');
};

// ── Secret code management ─────────────────────────────────────

window.toggleSecretCodeVisibility = function () {
    const input   = document.getElementById('secretCodeInput');
    const icon    = document.getElementById('secretCodeEyeIcon');
    const visible = input.type === 'text';
    input.type    = visible ? 'password' : 'text';
    icon.className = visible ? 'fas fa-eye' : 'fas fa-eye-slash';
};

window.saveSecretCode = async function () {
    const code   = document.getElementById('secretCodeInput')?.value?.trim();
    const status = document.getElementById('secretCodeStatus');
    if (!code) {
        if (status) { status.textContent = 'Escribe un código primero.'; status.style.color = 'var(--danger)'; }
        return;
    }
    try {
        await saveRegistrationCode(code);
        if (status) { status.textContent = '✓ Código guardado correctamente.'; status.style.color = 'var(--success)'; }
        showNotification('Código secreto actualizado', 'success');
    } catch (err) {
        if (status) { status.textContent = 'Error: ' + err.message; status.style.color = 'var(--danger)'; }
        showNotification('Error al guardar código', 'error');
    }
};

// ── Load settings on startup ───────────────────────────────────
async function loadSettings() {
    try {
        const s = await getSettings();
        if (s) {
            ['gymName','phone','address','email','schedule'].forEach(f => {
                const el = document.getElementById('settings' + f.charAt(0).toUpperCase() + f.slice(1));
                if (el && s[f]) el.value = s[f];
            });
        }
    } catch (_) { /* settings doc may not exist yet */ }

    try {
        const code     = await getRegistrationCode();
        const codeEl   = document.getElementById('secretCodeInput');
        const statusEl = document.getElementById('secretCodeStatus');
        if (codeEl) {
            if (code) {
                codeEl.value = code;
                if (statusEl) { statusEl.textContent = '✓ Código configurado.'; statusEl.style.color = 'var(--success)'; }
            } else {
                if (statusEl) { statusEl.textContent = '⚠ Sin código — cualquier persona podría registrarse.'; statusEl.style.color = 'var(--warning)'; }
            }
        }
    } catch (_) { /* ignore */ }
}
loadSettings();

// ══════════════════════════════════════════════════════════════
//  MESSAGES / WHATSAPP
// ══════════════════════════════════════════════════════════════

window.useTemplate = function (type) {
    const templates = {
        recordatorio: `¡Hola {nombre}! 🥊\n\nTe recordamos que tu pago de *{monto}* vence el *{fecha_vencimiento}*.\n\nPor favor realiza tu pago a tiempo.\n\n¡Gracias! 💪`,
        cancelacion:  `¡Hola {nombre}! 🥊\n\nLas clases del día *[FECHA]* han sido canceladas por *[MOTIVO]*.\n\nSe reanudarán el *[FECHA]*. ¡Disculpa las molestias!`,
        promocion:    `¡Hola {nombre}! 🥊\n\n¡Promoción especial para ti!\n\n*[DESCRIPCIÓN]*\n\nVálido hasta *[FECHA]* 💪`,
        evento:       `¡Hola {nombre}! 🥊\n\n🏆 *[NOMBRE DEL EVENTO]*\n📅 Fecha: *[FECHA]*\n📍 Lugar: *[LUGAR]*\n\n¡Te esperamos! 🎉`,
    };
    const el = document.getElementById('massMessageText');
    if (el) el.value = templates[type] || '';
    showNotification('Plantilla cargada', 'success');
};

window.sendMassWhatsApp = function () {
    const msg        = document.getElementById('massMessageText')?.value?.trim();
    const recipients = document.getElementById('messageRecipients')?.value || 'todos';
    if (!msg) { showNotification('Escribe un mensaje primero', 'warning'); return; }

    let targets = _allStudents;
    if (recipients === 'activos')    targets = _allStudents.filter(s => s.remainingClasses > 0);
    if (recipients === 'pendientes') targets = _allStudents.filter(s => s.remainingClasses <= 0);
    if (recipients === 'nuevos') {
        const thisMonth = new Date().getMonth();
        targets = _allStudents.filter(s => {
            if (!s.createdAt) return false;
            const d = s.createdAt.toDate ? s.createdAt.toDate() : new Date(s.createdAt.seconds * 1000);
            return d.getMonth() === thisMonth;
        });
    }

    if (targets.length === 0) { showNotification('No hay alumnos en el grupo seleccionado', 'warning'); return; }

    targets.forEach((s, i) => {
        const phone     = (s.phone || '').replace(/\D/g, '');
        if (!phone) return;
        const intlPhone = phone.startsWith('52') ? phone : '521' + phone;
        const days      = daysUntilExpiry(s.expiryDate);
        const expiryStr = s.expiryDate || 'próximamente';
        const personalised = msg
            .replace(/\{nombre\}/g, s.name || 'Alumno')
            .replace(/\{monto\}/g, '$' + (currentPricing[s.plan] || 700) + ' MXN')
            .replace(/\{fecha_vencimiento\}/g, expiryStr);
        setTimeout(() => window.open(`https://wa.me/${intlPhone}?text=${encodeURIComponent(personalised)}`, '_blank'), i * 400);
    });
    showNotification(`Enviando WhatsApp a ${targets.length} alumno(s)…`, 'success');
};

window.previewMessage = function () {
    const msg = document.getElementById('massMessageText')?.value;
    if (!msg?.trim()) { showNotification('Escribe un mensaje primero', 'warning'); return; }
    alert('Vista previa:\n\n' + msg
        .replace(/{nombre}/g, 'Juan Martínez')
        .replace(/{fecha_vencimiento}/g, '20 de Enero')
        .replace(/{monto}/g, '$700 MXN'));
};

// ── Individual WhatsApp student list ─────────────────────────
function renderIndivWaList(students) {
    window._indivWaStudents = students;
    window.filterIndivWaList();
}

window.filterIndivWaList = function () {
    const list    = document.getElementById('indivWaList');
    if (!list) return;
    const search  = (document.getElementById('indivWaSearch')?.value || '').toLowerCase();
    const all     = window._indivWaStudents || _allStudents;
    const filtered = all.filter(s => !search || (s.name || '').toLowerCase().includes(search));
    if (filtered.length === 0) {
        list.innerHTML = `<p style="text-align:center;color:var(--text-gray);padding:1rem;">Sin coincidencias.</p>`;
        return;
    }
    const planColors = { diario: '#F59E0B', semanal: '#3B82F6', mensual: '#10B981' };
    list.innerHTML = filtered.slice(0, 50).map(s => {
        const initials = (s.name || '?').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
        const days     = daysUntilExpiry(s.expiryDate);
        const planColor = planColors[s.plan] || '#6B7280';
        const planLabel = PLAN_LABELS[s.plan] || s.plan;
        let statusBadge = s.remainingClasses > 0
            ? `<span style="font-size:.7rem;color:#10B981;background:#10B98122;padding:.1rem .35rem;border-radius:4px;">Activo</span>`
            : `<span style="font-size:.7rem;color:#EF4444;background:#EF444422;padding:.1rem .35rem;border-radius:4px;">Vencido</span>`;
        if (days !== null && days >= 0 && days <= 3) {
            statusBadge += ` <span style="font-size:.7rem;color:#F59E0B;background:#F59E0B22;padding:.1rem .35rem;border-radius:4px;">Vence en ${days}d</span>`;
        }
        return `
        <div style="display:flex;align-items:center;gap:.6rem;padding:.5rem .25rem;border-bottom:1px solid var(--border);">
            <div class="avatar" style="min-width:32px;width:32px;height:32px;font-size:.75rem;">${initials}</div>
            <div style="flex:1;min-width:0;">
                <div style="font-weight:600;font-size:.85rem;">${esc(s.name)}</div>
                <div style="display:flex;gap:.3rem;flex-wrap:wrap;margin-top:.1rem;">
                    <span style="font-size:.7rem;font-weight:700;color:${planColor};">${planLabel}</span>
                    ${statusBadge}
                </div>
            </div>
            <button class="btn btn-whatsapp btn-sm" style="padding:.3rem .6rem;font-size:.78rem;white-space:nowrap;"
                onclick="openCustomWhatsApp('${s.id}')">
                <i class="fab fa-whatsapp"></i> Mensaje
            </button>
        </div>`;
    }).join('');
};

window.sendWhatsAppReminder = function (phone, name, amount, days) {
    const msg = `¡Hola ${name}! 🥊\n\nTu pago de *$${amount} MXN* vence en *${days} día(s)*.\n\n📅 Paga a tiempo para seguir entrenando.\n📞 686 348 4588`;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank');
    showNotification(`Mensaje enviado a ${name}`, 'success');
};

window.sendBirthdayWish = function (phone, name) {
    const msg = `¡Feliz Cumpleaños ${name}! 🎂🥊\n\nDe parte de *Escuela de Boxeo Franco*. ¡Sigue entrenando fuerte! 💪`;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank');
    showNotification(`Felicitación enviada a ${name}`, 'success');
};

// ══════════════════════════════════════════════════════════════
//  MISC STUBS (panels not yet fully wired)
// ══════════════════════════════════════════════════════════════

window.handleAdminSearch   = e => console.log('Buscando:', e.target.value);
window.toggleNotifications = function() {
    const dropdown = document.getElementById('topNavNotifDropdown');
    if (dropdown) dropdown.classList.toggle('active');
};

document.addEventListener('click', (e) => {
    const wrapper = document.querySelector('.notifications-wrapper');
    const dropdown = document.getElementById('topNavNotifDropdown');
    if (wrapper && dropdown && !wrapper.contains(e.target)) {
        dropdown.classList.remove('active');
    }
});

window.updateNotificationsDropdown = function(students) {
    const list = document.getElementById('topNavNotifList');
    const badge = document.getElementById('topNavNotifBadge');
    if (!list || !badge) return;

    const today = new Date();
    const alerts = [];

    students.forEach(s => {
        const days = daysUntilExpiry(s.expiryDate);
        if (s.remainingClasses <= 0 || (days !== null && days <= 3)) {
            alerts.push({
                type: 'warning',
                icon: 'fa-exclamation-circle',
                color: 'var(--warning)',
                title: 'Pago pendiente',
                text: `${s.name} - ${s.remainingClasses <= 0 ? 'Vencido' : `Vence en ${days} día(s)`}`
            });
        }
        if (s.birthday) {
            const [y, m, d] = s.birthday.split('-');
            if (parseInt(m) === today.getMonth() + 1) {
                alerts.push({
                    type: 'info',
                    icon: 'fa-birthday-cake',
                    color: 'var(--info)',
                    title: 'Cumpleaños',
                    text: `${s.name} - ${d} de ${['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'][parseInt(m)-1]}`
                });
            }
        }
    });

    if (alerts.length > 0) {
        badge.style.display = 'flex';
        badge.textContent = alerts.length;
        list.innerHTML = alerts.map(a => `
            <div class="notif-item">
                <div class="notif-item-icon" style="background: ${a.color}22; color: ${a.color};">
                    <i class="fas ${a.icon}"></i>
                </div>
                <div class="notif-item-content">
                    <h5>${a.title}</h5>
                    <p>${a.text}</p>
                </div>
            </div>
        `).join('');
    } else {
        badge.style.display = 'none';
        list.innerHTML = `<p style="text-align:center;color:var(--text-gray);padding:1.5rem;">Al día. Sin notificaciones.</p>`;
    }
};
window.openAddClassModal = function () {
    document.getElementById('addClassForm')?.reset();
    document.getElementById('addClassModal')?.classList.add('active');
};

window.saveNewClass = async function (e) {
    e.preventDefault();
    const btn = e.submitter || e.target.querySelector('[type=submit]');
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }

    const name        = document.getElementById('className')?.value.trim();
    const instructor  = document.getElementById('classInstructor')?.value.trim() || 'Roy Franco';
    const schedule    = document.getElementById('classSchedule')?.value.trim();
    const days        = document.getElementById('classDays')?.value.trim();
    const capacity    = parseInt(document.getElementById('classCapacity')?.value || '20');
    const level       = document.getElementById('classLevel')?.value || 'todos';
    const description = document.getElementById('classDescription')?.value.trim();

    try {
        await addClassDoc({ name, instructor, schedule, days, capacity, enrolled: 0, level, description });
        showNotification(`Clase "${name}" registrada correctamente`, 'success');
        closeAdminModal('addClassModal');
    } catch (err) {
        showNotification('Error al guardar: ' + err.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Guardar Clase'; }
    }
};
window.viewClassDetails    = () => showNotification('Ver clase — próximamente', 'success');
// manageClass is now fully implemented above
window.sendReminder        = () => showNotification('Recordatorio enviado', 'success');
window.sendAutoReminders   = function () {
    const expiring = _allStudents.filter(s => {
        const d = daysUntilExpiry(s.expiryDate);
        return d !== null && d >= 0 && d <= 3;
    });
    if (expiring.length === 0) {
        showNotification('No hay alumnos con vencimiento en los próximos 3 días', 'warning');
        return;
    }
    expiring.forEach((s, i) => {
        const phone     = (s.phone || '').replace(/\D/g, '');
        const intlPhone = phone.startsWith('52') ? phone : '521' + phone;
        const amount    = PLAN_PRICES[s.plan] || 700;
        const days      = daysUntilExpiry(s.expiryDate);
        const daysTxt   = days === 0 ? '*hoy*' : `en *${days} día(s)* (${s.expiryDate})`;
        const msg = `¡Hola ${s.name}! 🥊\n\nTe recordamos que tu ${PLAN_LABELS[s.plan] || s.plan} de *$${amount} MXN* vence ${daysTxt}.\n\n📅 Renueva a tiempo para seguir entrenando. 💪\n📞 686 348 4588`;
        setTimeout(() => {
            window.open(`https://wa.me/${intlPhone}?text=${encodeURIComponent(msg)}`, '_blank');
        }, i * 400);
    });
    showNotification(`Abriendo WhatsApp para ${expiring.length} alumno(s) con vencimiento próximo`, 'success');
};
window.editSchedule        = () => showNotification('Editar horarios — próximamente', 'success');
window.downloadReport = function () {
    const now        = new Date();
    const dateStr    = now.toLocaleDateString('es-MX', { year:'numeric', month:'long', day:'numeric' });
    const students   = _allStudents;
    const active     = students.filter(s => s.remainingClasses > 0);
    const expired    = students.filter(s => s.remainingClasses <= 0);
    const expiring   = students.filter(s => { const d = daysUntilExpiry(s.expiryDate); return d !== null && d <= 5 && d >= 0; });
    const newMonth   = students.filter(s => {
        if (!s.createdAt) return false;
        const d = s.createdAt.toDate ? s.createdAt.toDate() : new Date(s.createdAt.seconds * 1000);
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });

    // Estimated income from active students this month
    const income = active.reduce((acc, s) => acc + (PLAN_PRICES[s.plan] || 0), 0);

    const planCounts = {};
    students.forEach(s => { planCounts[s.plan] = (planCounts[s.plan] || 0) + 1; });
    const planRows = Object.entries(planCounts).map(([plan, count]) =>
        `<tr><td>${PLAN_LABELS[plan] || plan}</td><td>${count}</td><td>${students.length ? Math.round(count / students.length * 100) : 0}%</td><td>$${formatMXN(count * (PLAN_PRICES[plan] || 0))}</td></tr>`
    ).join('');

    const studentRows = students.slice(0, 50).map(s => {
        const d    = daysUntilExpiry(s.expiryDate);
        const stat = s.remainingClasses > 0 ? 'Activo' : 'Vencido';
        const exp  = d !== null && d <= 5 ? `⚠ ${d}d` : (s.expiryDate || '—');
        return `<tr>
            <td>${esc(s.name)}</td>
            <td>${esc(s.phone || '—')}</td>
            <td>${PLAN_LABELS[s.plan] || s.plan}</td>
            <td>${stat}</td>
            <td>${exp}</td>
            <td>$${formatMXN(PLAN_PRICES[s.plan] || 0)}</td>
        </tr>`;
    }).join('');

    const html = `<!DOCTYPE html><html lang="es"><head>
        <meta charset="UTF-8">
        <title>Reporte Boxeo Franco — ${dateStr}</title>
        <style>
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body { font-family: Arial, sans-serif; font-size: 12px; color: #111; background: #fff; padding: 2rem; }
            .rpt-header { border-bottom: 3px solid #E63946; padding-bottom: 1rem; margin-bottom: 1.5rem; display: flex; justify-content: space-between; align-items: flex-end; }
            .rpt-title { font-size: 22px; font-weight: 800; color: #E63946; letter-spacing: 2px; }
            .rpt-subtitle { font-size: 11px; color: #666; margin-top: 3px; }
            .rpt-date { font-size: 11px; color: #999; }
            .rpt-section { margin-bottom: 1.5rem; }
            .rpt-section h3 { font-size: 13px; font-weight: 700; border-left: 4px solid #E63946; padding-left: 8px; margin-bottom: 10px; color: #0F172A; }
            .rpt-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 1rem; }
            .rpt-stat { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px; text-align: center; }
            .rpt-stat strong { display: block; font-size: 22px; font-weight: 800; color: #E63946; }
            .rpt-stat span { font-size: 10px; color: #666; }
            table { width: 100%; border-collapse: collapse; }
            th { background: #0F172A; color: #fff; padding: 7px 10px; text-align: left; font-size: 10px; letter-spacing: 0.5px; }
            td { padding: 6px 10px; border-bottom: 1px solid #e2e8f0; }
            tr:nth-child(even) td { background: #f8fafc; }
            .rpt-footer { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid #e2e8f0; font-size: 10px; color: #999; text-align: center; }
            @media print { body { padding: 1rem; } }
        </style>
    </head><body>
        <div class="rpt-header">
            <div>
                <div class="rpt-title">🥊 BOXEO FRANCO</div>
                <div class="rpt-subtitle">Reporte General del Gimnasio</div>
            </div>
            <div class="rpt-date">Generado: ${dateStr}</div>
        </div>

        <div class="rpt-section">
            <h3>Resumen General</h3>
            <div class="rpt-grid">
                <div class="rpt-stat"><strong>${students.length}</strong><span>Total Alumnos</span></div>
                <div class="rpt-stat"><strong>${active.length}</strong><span>Alumnos Activos</span></div>
                <div class="rpt-stat"><strong>${expired.length}</strong><span>Vencidos</span></div>
                <div class="rpt-stat"><strong>${expiring.length}</strong><span>Vencen en 5 días</span></div>
                <div class="rpt-stat"><strong>${newMonth.length}</strong><span>Nuevos este mes</span></div>
                <div class="rpt-stat" style="grid-column:span 3;"><strong style="font-size:18px;">$${formatMXN(income)}</strong><span>Ingreso estimado (alumnos activos)</span></div>
            </div>
        </div>

        <div class="rpt-section">
            <h3>Distribución por Plan</h3>
            <table>
                <thead><tr><th>Plan</th><th>Alumnos</th><th>%</th><th>Ingreso Est.</th></tr></thead>
                <tbody>${planRows}</tbody>
            </table>
        </div>

        <div class="rpt-section">
            <h3>Lista de Alumnos (${students.length} total${students.length > 50 ? ' — mostrando primeros 50' : ''})</h3>
            <table>
                <thead><tr><th>Nombre</th><th>Teléfono</th><th>Plan</th><th>Estado</th><th>Vencimiento</th><th>Monto</th></tr></thead>
                <tbody>${studentRows}</tbody>
            </table>
        </div>

        <div class="rpt-footer">Reporte generado automáticamente por el sistema de gestión Boxeo Franco · ${dateStr}</div>
        <script>window.onload = () => { window.print(); };<\/script>
    </body></html>`;

    const w = window.open('', '_blank', 'width=900,height=700');
    if (!w) { showNotification('Activa las ventanas emergentes para generar el PDF', 'warning'); return; }
    w.document.write(html);
    w.document.close();
    showNotification('Reporte generado — usa Ctrl+P / Cmd+P para guardar como PDF', 'success');
};
window.saveSettings = async function () {
    const gymName = document.getElementById('settingsGymName')?.value?.trim();
    const phone   = document.getElementById('settingsPhone')?.value?.trim();
    const email   = document.getElementById('settingsEmail')?.value?.trim();
    const address = document.getElementById('settingsAddress')?.value?.trim();
    const pMensual  = parseFloat(document.getElementById('settingsPriceMensual')?.value || '700');
    const pSemanal  = parseFloat(document.getElementById('settingsPriceSemanal')?.value || '300');
    const pDiario   = parseFloat(document.getElementById('settingsPriceDiario')?.value || '100');
    const pPersonal = parseFloat(document.getElementById('settingsPricePersonal')?.value || '200');

    try {
        await saveSettingsDoc('gymInfo', {
            name: gymName, phone, email, address
        });
        await saveSettingsDoc('pricing', {
            mensual: pMensual,
            semanal: pSemanal,
            diario: pDiario,
            personal: pPersonal
        });
        showNotification('✓ Configuración de precios guardada correctamente', 'success');
    } catch (err) {
        showNotification('Error al guardar: ' + err.message, 'error');
    }
};

window.saveNotificationsConfig = async function () {
    const rem3   = document.getElementById('notifReminder3Days')?.checked;
    const remDay = document.getElementById('notifReminderDay')?.checked;
    const birth  = document.getElementById('notifBirthday')?.checked;
    const welc   = document.getElementById('notifWelcome')?.checked;

    try {
        await saveSettingsDoc('notifications', {
            reminder3Days: rem3,
            reminderDay: remDay,
            birthday: birth,
            welcome: welc
        });
        showNotification('Preferencias de notificaciones guardadas', 'success');
    } catch (err) {
        showNotification('Error: ' + err.message, 'error');
    }
};

window.exportData            = type => showNotification(`Exportando ${type}…`, 'success');
window.markAsPaid            = id   => paymentMarkPaid(id);

// ══════════════════════════════════════════════════════════════
//  NOTIFICATION TOAST
// ══════════════════════════════════════════════════════════════

window.showNotification = function (message, type = 'success') {
    const colors = { success: '#10B981', warning: '#F59E0B', error: '#EF4444' };
    const icons  = { success: 'check-circle', warning: 'exclamation-triangle', error: 'exclamation-circle' };

    const el = document.createElement('div');
    const isMobile = window.innerWidth <= 768;
    if (isMobile) {
        el.style.cssText = `position:fixed;bottom:calc(env(safe-area-inset-bottom,0px) + 5.5rem);left:50%;transform:translateX(-50%);padding:.75rem 1.25rem;background:${colors[type]||colors.success};color:#fff;border-radius:10px;box-shadow:0 4px 20px rgba(0,0,0,.25);z-index:9999;animation:slideIn .3s ease;font-weight:500;font-size:.875rem;display:flex;align-items:center;gap:.5rem;max-width:90vw;text-align:center;`;
    } else {
        el.style.cssText = `position:fixed;top:80px;right:20px;padding:.85rem 1.5rem;background:${colors[type]||colors.success};color:#fff;border-radius:10px;box-shadow:0 4px 20px rgba(0,0,0,.2);z-index:9999;animation:slideIn .3s ease;font-weight:500;font-size:.9rem;display:flex;align-items:center;gap:.5rem;max-width:360px;`;
    }
    el.innerHTML = `<i class="fas fa-${icons[type]||icons.success}"></i> ${message}`;
    document.body.appendChild(el);

    setTimeout(() => {
        el.style.animation = 'slideOut .3s ease forwards';
        setTimeout(() => el.remove(), 300);
    }, 3500);
};

// ══════════════════════════════════════════════════════════════
//  UTILITIES
// ══════════════════════════════════════════════════════════════

/** Set the textContent of an element by ID (no-op if missing). */
function set(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

/** HTML-escape a string. */
function esc(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/** Capitalize first letter. */
function capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
}
