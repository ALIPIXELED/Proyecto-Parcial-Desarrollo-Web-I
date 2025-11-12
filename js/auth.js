import { initializeApp, getApp, getApps } from 'https://www.gstatic.com/firebasejs/10.13.1/firebase-app.js';
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.13.1/firebase-auth.js';
import { getFirestore, doc, setDoc, getDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.13.1/firebase-firestore.js';

const DASHBOARD_URL = 'pages/dashboard.html';

const firebaseConfig = {
  apiKey: 'AIzaSyAggSy9FTC9EJ1X2TRBBMtBjIsbnRM7rHQ',
  authDomain: 'equipo-deportivo.firebaseapp.com',
  projectId: 'equipo-deportivo',
  storageBucket: 'equipo-deportivo.firebasestorage.app',
  messagingSenderId: '174209800918',
  appId: '1:174209800918:web:26b4397b069a45014f4777',
  measurementId: 'G-CEP7G3QQ81',
};

const DEFAULT_ACCOUNTS = [
  { email: 'admin@barca.com', password: 'AdminFCB123', role: 'admin', nombre: 'Administrador General' },
  { email: 'empleado@barca.com', password: 'EmpleadoFCB123', role: 'empleado', nombre: 'Empleado Demo' },
];

const FALLBACK_ROLES = {
  'admin@barca.com': 'admin',
  'empleado@barca.com': 'empleado',
};

const primaryApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(primaryApp);
const db = getFirestore(primaryApp);

let secondaryApp;
try {
  secondaryApp = getApp('SecondaryApp');
} catch (_error) {
  secondaryApp = initializeApp(firebaseConfig, 'SecondaryApp');
}
const secondaryAuth = getAuth(secondaryApp);

let redirectPending = false;
let activeUser = null;

document.addEventListener('DOMContentLoaded', () => {
  const loginModal = document.getElementById('login-modal');
  const footerTrigger = document.getElementById('footer-login-trigger');
  const loginCloseBtn = document.getElementById('login-close-btn');
  const loginForm = document.getElementById('login-form');
  const loginErrorEl = document.getElementById('login-error');
  const authStatus = document.getElementById('auth-status');

  if (!loginModal || !footerTrigger || !auth) {
    console.warn('El módulo de autenticación no está disponible en esta página.');
    return;
  }

  seedDefaultAccounts();

  footerTrigger.addEventListener('click', () => {
    if (activeUser) {
      window.location.href = DASHBOARD_URL;
      return;
    }
    openModal(loginModal);
  });
  loginCloseBtn?.addEventListener('click', () => closeModal(loginModal));

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      closeModal(loginModal);
    }
  });

  loginForm?.addEventListener('submit', async event => {
    event.preventDefault();
    clearLoginFeedback();

    const email = loginForm.email.value.trim().toLowerCase();
    const password = loginForm.password.value.trim();

    if (!email || !password) {
      setLoginError('Completa correo y contraseña.');
      return;
    }

    try {
      await signInWithEmailAndPassword(auth, email, password);
      redirectPending = true;
      setAuthStatus('Sesión iniciada. Redirigiendo...', 'info');
    } catch (error) {
      handleAuthError(error, setLoginError);
    }
  });

  onAuthStateChanged(auth, async user => {
    activeUser = user;
    if (!user) {
      redirectPending = false;
      footerTrigger.textContent = 'Iniciar sesión';
      return;
    }

    footerTrigger.textContent = 'Abrir panel';

    await ensureUserDocument(user);

    if (redirectPending) {
      window.location.href = DASHBOARD_URL;
    }
  });

  function openModal(modal) {
    modal.classList.remove('hidden');
    document.body.classList.add('modal-open');
  }

  function closeModal(modal) {
    modal.classList.add('hidden');
    document.body.classList.remove('modal-open');
    loginForm?.reset();
    clearLoginFeedback();
  }

  function clearLoginFeedback() {
    if (loginErrorEl) loginErrorEl.textContent = '';
    setAuthStatus('', 'info');
  }

  function setLoginError(message) {
    if (loginErrorEl) loginErrorEl.textContent = message;
    setAuthStatus('', 'error');
  }

  function setAuthStatus(message, status = 'info') {
    if (!authStatus) return;
    authStatus.textContent = message;
    authStatus.dataset.status = status;
  }
});

async function ensureUserDocument(user) {
  if (!user) return 'empleado';
  const userDocRef = doc(getFirestore(), 'users', user.uid);
  const fallbackRole = FALLBACK_ROLES[user.email?.toLowerCase() || ''] || 'empleado';

  try {
    const snapshot = await getDoc(userDocRef);
    if (snapshot.exists()) {
      return snapshot.data().role || fallbackRole;
    }
    await setDoc(
      userDocRef,
      {
        email: user.email || 'sin-correo',
        role: fallbackRole,
        createdAt: serverTimestamp(),
      },
      { merge: true },
    );
    return fallbackRole;
  } catch (error) {
    console.warn('No se pudo sincronizar el rol, usando valor por defecto.', error);
    return fallbackRole;
  }
}

async function seedDefaultAccounts() {
  for (const account of DEFAULT_ACCOUNTS) {
    try {
      const credential = await createUserWithEmailAndPassword(
        secondaryAuth,
        account.email,
        account.password,
      );
      await persistRole(credential.user.uid, account);
    } catch (error) {
      if (error.code === 'auth/email-already-in-use') {
        try {
          const existing = await signInWithEmailAndPassword(
            secondaryAuth,
            account.email,
            account.password,
          );
          await persistRole(existing.user.uid, account);
        } catch (innerError) {
          console.warn('No se pudo verificar la cuenta demo', account.email, innerError);
        }
      } else {
        console.warn('No se pudo crear la cuenta demo', account.email, error);
      }
    } finally {
      try {
        await signOut(secondaryAuth);
      } catch (logoutError) {
        if (logoutError.code !== 'auth/no-current-user') {
          console.warn('No se pudo cerrar sesión del semillado', logoutError);
        }
      }
    }
  }
}

async function persistRole(uid, account) {
  try {
    await setDoc(
      doc(getFirestore(), 'users', uid),
      {
        email: account.email,
        role: account.role,
        nombre: account.nombre || '',
        createdAt: serverTimestamp(),
      },
      { merge: true },
    );
  } catch (error) {
    console.warn('No se pudo guardar el rol para', account.email, error);
  }
}

function handleAuthError(error, callback) {
  const message = translateAuthError(error);
  callback(message);
}

function translateAuthError(error) {
  const code = error?.code || 'desconocido';
  const messages = {
    'auth/invalid-email': 'El correo no es válido.',
    'auth/email-already-in-use': 'Ese correo ya está registrado.',
    'auth/wrong-password': 'Contraseña incorrecta.',
    'auth/user-not-found': 'No existe una cuenta con ese correo.',
    'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres.',
    'auth/operation-not-allowed': 'Operación no permitida. Revisa la consola de Firebase.',
    'auth/too-many-requests': 'Demasiados intentos. Intenta más tarde.',
    'secondary-auth-not-ready': 'No se pudo preparar la autenticación secundaria. Refresca la página.',
  };
  return messages[code] || 'Ocurrió un error con la autenticación.';
}
