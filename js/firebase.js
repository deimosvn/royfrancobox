/**
 * ROY FRANCO BOX — Firebase Module
 * Handles all Firestore & Auth operations.
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
    getFirestore,
    collection,
    doc,
    addDoc,
    setDoc,
    getDoc,
    getDocs,
    updateDoc,
    deleteDoc,
    query,
    where,
    orderBy,
    onSnapshot,
    serverTimestamp,
    increment,
    Timestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import {
    getAuth,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

// ── Initialize ─────────────────────────────────────────────────
const firebaseConfig = {
    apiKey:            'AIzaSyB6EOIYGLm0Y6NOI67KCStnrmwkEinfQWg',
    authDomain:        'roybox-f84b7.firebaseapp.com',
    projectId:         'roybox-f84b7',
    storageBucket:     'roybox-f84b7.firebasestorage.app',
    messagingSenderId: '715944947026',
    appId:             '1:715944947026:web:18b6bde2ae164722d0de8b',
    measurementId:     'G-L8RH3MN9QG',
};

const app  = initializeApp(firebaseConfig);
export const db   = getFirestore(app);
export const auth = getAuth(app);

// ── Auth ───────────────────────────────────────────────────────

/**
 * Sign in with email and password.
 * @returns {Promise<UserCredential>}
 */
export function loginAdmin(email, password) {
    return signInWithEmailAndPassword(auth, email, password);
}

/**
 * Sign out the current admin.
 */
export function logoutAdmin() {
    return signOut(auth);
}

/**
 * Register a new admin user, validated against the secret code
 * stored in Firestore at settings/registration → { secretCode: "..." }.
 * Throws if the code is wrong or the doc doesn't exist.
 */
export async function registerAdmin(email, password, inputCode) {
    const snap = await getDoc(doc(db, 'settings', 'registration'));
    if (!snap.exists()) {
        throw new Error('NO_SECRET_DOC');
    }
    const stored = snap.data().secretCode;
    if (!stored || inputCode.trim() !== stored.trim()) {
        throw new Error('WRONG_CODE');
    }
    return createUserWithEmailAndPassword(auth, email, password);
}

/**
 * Listen to auth state changes.
 * @param {(user: User|null) => void} callback
 */
export function onAuthChange(callback) {
    return onAuthStateChanged(auth, callback);
}

// ── Students ───────────────────────────────────────────────────

const STUDENTS = 'students';

/**
 * Add a new student document.
 * @param {object} data
 */
export async function addStudent(data) {
    return addDoc(collection(db, STUDENTS), {
        ...data,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
    });
}

/**
 * Get a single student by ID.
 */
export async function getStudent(id) {
    const snap = await getDoc(doc(db, STUDENTS, id));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/**
 * Get all students once (for exports).
 */
export async function getAllStudents() {
    const snap = await getDocs(query(collection(db, STUDENTS), orderBy('createdAt', 'desc')));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * Real-time listener for the students collection.
 * @param {(students: object[]) => void} callback
 * @returns unsubscribe function
 */
export function onStudentsChange(callback) {
    return onSnapshot(
        query(collection(db, STUDENTS), orderBy('createdAt', 'desc')),
        snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    );
}

/**
 * Update fields on a student.
 */
export async function updateStudent(id, data) {
    return updateDoc(doc(db, STUDENTS, id), {
        ...data,
        updatedAt: serverTimestamp(),
    });
}

/**
 * Delete a student.
 */
export async function deleteStudentById(id) {
    return deleteDoc(doc(db, STUDENTS, id));
}

/**
 * Register attendance for a student: decrement remainingClasses by 1.
 * Prevents double-marking on the same calendar day.
 */
export async function registerStudentAttendance(studentId) {
    const student = await getStudent(studentId);
    if (!student) throw new Error('Estudiante no encontrado');

    const todayStr = new Date().toDateString();
    const history  = student.attendanceHistory || [];

    if (history.includes(todayStr)) {
        throw new Error('Ya se registró asistencia hoy para este alumno');
    }
    if (student.remainingClasses <= 0) {
        throw new Error(`${student.name} no tiene clases restantes. Debe renovar su plan.`);
    }

    const newRemaining = student.remainingClasses - 1;
    return updateDoc(doc(db, STUDENTS, studentId), {
        remainingClasses:   newRemaining,
        attendanceHistory:  [...history, todayStr],
        status:             newRemaining === 0 ? 'Plan Vencido' : 'Activo',
        updatedAt:          serverTimestamp(),
    });
}

// ── Payments ───────────────────────────────────────────────────

const PAYMENTS = 'payments';

/**
 * Add a payment record.
 */
export async function addPayment(data) {
    return addDoc(collection(db, PAYMENTS), {
        ...data,
        date:      serverTimestamp(),
        createdAt: serverTimestamp(),
    });
}

/**
 * Real-time listener for payments.
 */
export function onPaymentsChange(callback) {
    return onSnapshot(
        query(collection(db, PAYMENTS), orderBy('createdAt', 'desc')),
        snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    );
}

/**
 * Get payments for the current calendar month.
 */
export async function getMonthlyPayments() {
    const now   = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    const snap = await getDocs(
        query(
            collection(db, PAYMENTS),
            where('createdAt', '>=', Timestamp.fromDate(start)),
            where('createdAt', '<=', Timestamp.fromDate(end)),
            orderBy('createdAt', 'desc')
        )
    );
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * Mark a payment as paid.
 */
export async function markPaymentPaid(id) {
    return updateDoc(doc(db, PAYMENTS, id), {
        status:    'Pagado',
        paidAt:    serverTimestamp(),
    });
}

// ── Finances ───────────────────────────────────────────────────

const FINANCES = 'finances';

/**
 * Add an income or expense entry.
 * @param {'income'|'expense'} type
 */
export async function addFinanceEntry(type, concept, amount, notes = '', studentName = '') {
    return addDoc(collection(db, FINANCES), {
        type,
        concept,
        amount:     Number(amount),
        notes,
        studentName,
        createdAt:  serverTimestamp(),
    });
}

/**
 * Real-time listener for finances.
 */
export function onFinancesChange(callback) {
    return onSnapshot(
        query(collection(db, FINANCES), orderBy('createdAt', 'desc')),
        snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    );
}

// ── Classes ────────────────────────────────────────────────────

const CLASSES = 'classes';

/**
 * Real-time listener for classes collection.
 */
export function onClassesChange(callback) {
    return onSnapshot(
        query(collection(db, CLASSES), orderBy('createdAt', 'desc')),
        snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    );
}

// ── Settings ───────────────────────────────────────────────────

const SETTINGS = 'settings';

/**
 * Get gym settings.
 */
export async function getSettings() {
    const snap = await getDoc(doc(db, SETTINGS, 'general'));
    return snap.exists() ? snap.data() : {};
}

/**
 * Save gym settings (creates or merges the 'general' document).
 */
export async function saveSettingsDoc(data) {
    return setDoc(doc(db, SETTINGS, 'general'), data, { merge: true });
}

/**
 * Save the registration secret code.
 */
export async function saveRegistrationCode(code) {
    return setDoc(doc(db, SETTINGS, 'registration'), { secretCode: code }, { merge: true });
}

/**
 * Get the registration secret code.
 */
export async function getRegistrationCode() {
    const snap = await getDoc(doc(db, SETTINGS, 'registration'));
    return snap.exists() ? (snap.data().secretCode || '') : '';
}

// ── Utility helpers ────────────────────────────────────────────

/**
 * Format a Firestore Timestamp (or JS Date / seconds number) to a readable string.
 */
export function formatDate(ts) {
    if (!ts) return '—';
    let date;
    if (ts.toDate) {
        date = ts.toDate();
    } else if (ts.seconds) {
        date = new Date(ts.seconds * 1000);
    } else {
        date = new Date(ts);
    }
    return date.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * Format currency.
 */
export function formatMXN(amount) {
    return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(amount || 0);
}
