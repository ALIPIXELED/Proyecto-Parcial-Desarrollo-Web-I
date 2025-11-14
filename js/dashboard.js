import { initializeApp, getApp, getApps } from 'https://www.gstatic.com/firebasejs/10.13.1/firebase-app.js';
import {
  getAuth,
  signOut,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
} from 'https://www.gstatic.com/firebasejs/10.13.1/firebase-auth.js';
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  collection,
  getDocs,
  query,
  orderBy,
  addDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  where,
} from 'https://www.gstatic.com/firebasejs/10.13.1/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyAggSy9FTC9EJ1X2TRBBMtBjIsbnRM7rHQ',
  authDomain: 'equipo-deportivo.firebaseapp.com',
  projectId: 'equipo-deportivo',
  storageBucket: 'equipo-deportivo.firebasestorage.app',
  messagingSenderId: '174209800918',
  appId: '1:174209800918:web:26b4397b069a45014f4777',
  measurementId: 'G-CEP7G3QQ81',
};

const FALLBACK_ROLES = {
  'admin@barca.com': 'admin',
  'empleado@barca.com': 'empleado',
};

const LOCAL_EMPLOYEE_STORAGE_KEY = 'fcbarcelona_dashboard_employees';

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

let currentUser = null;
let currentRole = null;
let editingEmployeeId = null;
let editingPlayerId = null;

document.addEventListener('DOMContentLoaded', () => {
  const logoutBtn = document.getElementById('logout-btn');
  const userEmailDisplay = document.getElementById('user-email-display');
  const userRoleEl = document.getElementById('user-role');
  const registroEmpleadosSection = document.getElementById('registro-empleados');
  const employeeForm = document.getElementById('employee-form');
  const employeeError = document.getElementById('employee-error');
  const employeeSuccess = document.getElementById('employee-success');
  const employeeList = document.getElementById('employee-list');
  const employeeCancelEditBtn = document.getElementById('employee-cancel-edit');
  const employeePasswordGroup = document.getElementById('employee-password-group');
  const employeePasswordInput = document.getElementById('employee-password');
  const employeeSubmitBtn = document.getElementById('employee-submit-btn');
  const gestionPlantillaSection = document.getElementById('gestion-plantilla');
  const plantillaForm = document.getElementById('plantilla-form');
  const plantillaError = document.getElementById('plantilla-error');
  const plantillaSuccess = document.getElementById('plantilla-success');
  const plantillaList = document.getElementById('plantilla-list');
  const cancelEditBtn = document.getElementById('cancel-edit-btn');
  const storageReady = storageAvailable();

  if (!auth) {
    console.warn('Dashboard no puede inicializarse: falta Firebase.');
    return;
  }

  onAuthStateChanged(auth, async user => {
    if (!user) {
      window.location.href = '../index.html';
      return;
    }

    const role = await ensureUserDocument(user);
    currentUser = { uid: user.uid, email: user.email ?? '', role };
    currentRole = role;

    userEmailDisplay.textContent = currentUser.email;
    userRoleEl.textContent = roleLabels()[role] || role;
    await configureSections(role, {
      registroEmpleadosSection,
      employeeList,
      employeeForm,
      employeeError,
      employeeSuccess,
      gestionPlantillaSection,
      plantillaList,
    });
  });

  employeeCancelEditBtn?.addEventListener('click', () => {
    resetEmployeeFormState(employeeForm);
  });

  logoutBtn?.addEventListener('click', async () => {
    try {
      await signOut(auth);
    } finally {
      window.location.href = '../index.html';
    }
  });

  employeeForm?.addEventListener('submit', async event => {
    event.preventDefault();
    if (currentRole !== 'admin') return;
    clearEmployeeFeedback(employeeError, employeeSuccess);

    const name = event.target['employee-name'].value.trim();
    const email = event.target['employee-email'].value.trim().toLowerCase();
    const password = event.target['employee-password'].value.trim();
    const isEditingEmployee = Boolean(editingEmployeeId);

    if (!name || !email) {
      setEmployeeError('Completa nombre y correo institucional.', employeeError, employeeSuccess);
      return;
    }

    if (!isEditingEmployee && !password) {
      setEmployeeError('Completa la contraseña temporal para nuevos empleados.', employeeError, employeeSuccess);
      return;
    }

    if (isEditingEmployee) {
      const updatedEmployee = { id: editingEmployeeId, nombre: name, email, estado: 'activo' };
      upsertStoredEmployee(updatedEmployee);
      renderEmployeeList(employeeList, getStoredEmployees());
      resetEmployeeFormState(employeeForm, {
        preserveFeedback: true,
      });
      try {
        await setDoc(
          doc(db, 'users', editingEmployeeId),
          {
            nombre: name,
            email,
            estado: 'activo',
            updatedAt: serverTimestamp(),
            updatedBy: currentUser?.uid || 'sistema',
          },
          { merge: true },
        );
        setEmployeeSuccess('Empleado actualizado correctamente.', employeeError, employeeSuccess);
      } catch (error) {
        console.error('Error actualizando empleado', error);
        setEmployeeSuccess(
          'Empleado actualizado localmente. No se pudo sincronizar con el servidor.',
          employeeError,
          employeeSuccess,
        );
      }
      renderEmployeeList(employeeList, getStoredEmployees());
      return;
    }

    try {
      const credential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
      await persistRole(credential.user.uid, { email, role: 'empleado', nombre: name, estado: 'activo' });
      setEmployeeSuccess('Empleado registrado correctamente.', employeeError, employeeSuccess);
      resetEmployeeFormState(employeeForm, {
        preserveFeedback: true,
      });
      const newEmployee = { id: credential.user.uid, nombre: name, email, estado: 'activo' };
      upsertStoredEmployee(newEmployee);
      await loadEmployees(employeeList);
    } catch (error) {
      if (error?.code === 'auth/email-already-in-use') {
        const synced = await syncExistingEmployeeByEmail(email, name, employeeList, employeeError, employeeSuccess);
        if (synced) {
          resetEmployeeFormState(employeeForm, { preserveFeedback: true });
          return;
        }
      }
      handleAuthError(error, message => setEmployeeError(message, employeeError, employeeSuccess));
    } finally {
      try {
        await signOut(secondaryAuth);
      } catch (logoutError) {
        if (logoutError.code !== 'auth/no-current-user') {
          console.warn('Error cerrando sesión secundaria', logoutError);
        }
      }
    }
  });

  plantillaForm?.addEventListener('submit', async event => {
    event.preventDefault();
    if (!['admin', 'empleado'].includes(currentRole)) return;
    clearPlantillaFeedback(plantillaError, plantillaSuccess);

    const nombre = event.target['player-name'].value.trim();
    const posicion = event.target['player-position'].value.trim();
    const numero = event.target['player-number'].value.trim();
    const notas = event.target['player-notes'].value.trim();

    if (!nombre || !posicion) {
      setPlantillaError('Nombre y posición son obligatorios.', plantillaError, plantillaSuccess);
      return;
    }

    try {
      if (editingPlayerId) {
        await updateDoc(doc(db, 'plantilla', editingPlayerId), {
          nombre,
          posicion,
          numero: numero || '',
          notas,
          updatedAt: serverTimestamp(),
          updatedBy: currentUser?.uid || 'sistema',
        });
        setPlantillaSuccess('Integrante actualizado.', plantillaError, plantillaSuccess);
      } else {
        await addDoc(collection(db, 'plantilla'), {
          nombre,
          posicion,
          numero: numero || '',
          notas,
          createdAt: serverTimestamp(),
          createdBy: currentUser?.uid || 'sistema',
        });
        setPlantillaSuccess('Integrante agregado.', plantillaError, plantillaSuccess);
      }
      resetPlantillaForm(plantillaForm, cancelEditBtn, true, plantillaError, plantillaSuccess);
      await loadPlantilla(plantillaList);
    } catch (error) {
      console.error('Error guardando integrante', error);
      setPlantillaError('No se pudo guardar el integrante.', plantillaError, plantillaSuccess);
    }
  });

  cancelEditBtn?.addEventListener('click', () => resetPlantillaForm(plantillaForm, cancelEditBtn, true, plantillaError, plantillaSuccess));

  employeeList?.addEventListener('click', async event => {
    const actionBtn = event.target.closest('[data-action]');
    if (!actionBtn) return;
    const li = actionBtn.closest('li[data-id]');
    if (!li) return;
    const { id } = li.dataset;
    if (!id) return;

    if (actionBtn.dataset.action === 'edit') {
      enterEmployeeEditMode(
        {
          id,
          nombre: li.dataset.nombre || '',
          email: li.dataset.email || '',
        },
        employeeForm,
        employeeCancelEditBtn,
        employeeSubmitBtn,
      );
      return;
    }

    if (actionBtn.dataset.action === 'delete') {
      if (!confirm('¿Eliminar este empleado registrado? Se revocará su acceso al panel.')) return;
      removeStoredEmployee(id);
      renderEmployeeList(employeeList, getStoredEmployees());
      if (editingEmployeeId === id) {
        resetEmployeeFormState(employeeForm, { preserveFeedback: true });
      }
      try {
        await setDoc(
          doc(db, 'users', id),
          {
            estado: 'eliminado',
            role: 'revocado',
            deletedAt: serverTimestamp(),
            deletedBy: currentUser?.uid || 'sistema',
          },
          { merge: true },
        );
        setEmployeeSuccess(
          'Empleado eliminado. Recuerda quitar su cuenta en Firebase Authentication si ya no debe acceder.',
          employeeError,
          employeeSuccess,
        );
      } catch (error) {
        console.error('Error eliminando empleado', error);
        setEmployeeSuccess(
          'Empleado eliminado localmente. No se pudo sincronizar con el servidor.',
          employeeError,
          employeeSuccess,
        );
      }
    }
  });

  plantillaList?.addEventListener('click', async event => {
    const actionBtn = event.target.closest('[data-action]');
    if (!actionBtn) return;
    const li = actionBtn.closest('li[data-id]');
    if (!li) return;
    const id = li.dataset.id;

    if (actionBtn.dataset.action === 'edit') {
      enterEditMode(li.dataset, plantillaForm, cancelEditBtn, plantillaSuccess);
    }

    if (actionBtn.dataset.action === 'delete') {
      if (!confirm('¿Eliminar este integrante de la plantilla?')) return;
      try {
        await deleteDoc(doc(db, 'plantilla', id));
        setPlantillaSuccess('Integrante eliminado.', plantillaError, plantillaSuccess);
        if (editingPlayerId === id) {
          resetPlantillaForm(plantillaForm, cancelEditBtn, false, plantillaError, plantillaSuccess);
        }
        await loadPlantilla(plantillaList);
      } catch (error) {
        console.error('Error eliminando integrante', error);
        setPlantillaError('No se pudo eliminar el integrante.', plantillaError, plantillaSuccess);
      }
    }
  });

  async function configureSections(role, refs) {
    if (role === 'admin') {
      refs.registroEmpleadosSection?.classList.remove('hidden');
      await loadEmployees(refs.employeeList);
    } else {
      refs.registroEmpleadosSection?.classList.add('hidden');
      if (refs.employeeList) refs.employeeList.innerHTML = '';
    }

    if (['admin', 'empleado'].includes(role)) {
      refs.gestionPlantillaSection?.classList.remove('hidden');
      await loadPlantilla(refs.plantillaList);
    } else {
      refs.gestionPlantillaSection?.classList.add('hidden');
      if (refs.plantillaList) refs.plantillaList.innerHTML = '';
    }
  }

  function getStoredEmployees() {
    if (!storageReady) return [];
    try {
      const raw = window.localStorage.getItem(LOCAL_EMPLOYEE_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function persistStoredEmployees(employees) {
    if (!storageReady) return;
    try {
      window.localStorage.setItem(LOCAL_EMPLOYEE_STORAGE_KEY, JSON.stringify(employees));
    } catch (error) {
      console.warn('No se pudo guardar la lista local de empleados.', error);
    }
  }

  function upsertStoredEmployee(employee) {
    if (!storageReady || !employee) return;
    const employees = getStoredEmployees();
    const index = employees.findIndex(
      item =>
        (item.id && employee.id && item.id === employee.id) ||
        (item.email && employee.email && item.email === employee.email),
    );
    if (index >= 0) {
      employees[index] = { ...employees[index], ...employee };
    } else {
      employees.unshift(employee);
    }
    persistStoredEmployees(employees);
  }

  function removeStoredEmployee(employeeId) {
    if (!storageReady || !employeeId) return;
    const filtered = getStoredEmployees().filter(emp => emp.id !== employeeId);
    persistStoredEmployees(filtered);
  }

  async function syncExistingEmployeeByEmail(email, providedName, listEl, errorEl, successEl) {
    if (!email) return false;
    try {
      const existingSnapshot = await getDocs(query(collection(db, 'users'), where('email', '==', email)));
      if (existingSnapshot.empty) {
        setEmployeeError(
          'Ese correo ya está en uso en Firebase Auth. Pide al empleado que inicie sesión una vez para sincronizarlo.',
          errorEl,
          successEl,
        );
        return false;
      }
      const docSnap = existingSnapshot.docs[0];
      const currentData = docSnap.data();
      const normalizedEmployee = {
        id: docSnap.id,
        nombre: providedName || currentData.nombre || '',
        email: currentData.email || email,
        estado: 'activo',
      };
      await setDoc(
        doc(db, 'users', docSnap.id),
        {
          nombre: normalizedEmployee.nombre,
          email: normalizedEmployee.email,
          role: 'empleado',
          estado: 'activo',
          updatedAt: serverTimestamp(),
          updatedBy: currentUser?.uid || 'sistema',
        },
        { merge: true },
      );
      upsertStoredEmployee(normalizedEmployee);
      renderEmployeeList(listEl, getStoredEmployees());
      setEmployeeSuccess('El empleado ya existía. Se reactivó y aparece en la lista.', errorEl, successEl);
      return true;
    } catch (syncError) {
      console.error('No se pudo sincronizar el empleado existente', syncError);
      setEmployeeError(
        'Ese correo ya pertenece a otra cuenta y no se pudo sincronizar automáticamente. Revisa Firebase Auth/Firestore.',
        errorEl,
        successEl,
      );
      return false;
    }
  }

  function renderEmployeeList(listEl, employees) {
    if (!listEl) return;
    const visibleEmployees = Array.isArray(employees)
      ? employees.filter(emp => (emp.estado || 'activo') !== 'eliminado')
      : [];
    if (!visibleEmployees.length) {
      listEl.innerHTML = '<li>No hay empleados registrados.</li>';
      listEl.dataset.initialized = '';
      return;
    }
    listEl.innerHTML = '';
    listEl.dataset.initialized = 'true';
    const sorted = [...visibleEmployees].sort((a, b) =>
      (a.nombre || a.email || '').localeCompare(b.nombre || b.email || ''),
    );
    for (let i = sorted.length - 1; i >= 0; i -= 1) {
      appendEmployeeToList(listEl, sorted[i]);
    }
  }

  async function loadEmployees(listEl) {
    if (!listEl) return;
    const cachedEmployees = getStoredEmployees();
    const hasCache = cachedEmployees.length > 0;
    renderEmployeeList(listEl, cachedEmployees);
    try {
      const snapshot = await getDocs(collection(db, 'users'));
      const employees = [];
      snapshot.forEach(docSnap => {
        const data = docSnap.data();
        if (data.role === 'empleado' && data.estado !== 'eliminado') {
          employees.push({
            id: docSnap.id,
            nombre: data.nombre || '',
            email: data.email || '',
            estado: data.estado || 'activo',
          });
        }
      });
      renderEmployeeList(listEl, employees);
      persistStoredEmployees(employees);
    } catch (error) {
      console.error('Error cargando empleados desde Firestore', error);
      if (!hasCache) {
        listEl.innerHTML = '<li>No se pudo sincronizar con el servidor. Agrega un empleado nuevo para iniciar la lista.</li>';
        listEl.dataset.initialized = '';
      }
    }
  }

  function appendEmployeeToList(listEl, emp) {
    if (!listEl || !emp) return;
    if (!listEl.dataset.initialized) {
      listEl.innerHTML = '';
      listEl.dataset.initialized = 'true';
    }
    const li = document.createElement('li');
    li.dataset.id = emp.id || '';
    li.dataset.nombre = emp.nombre || '';
    li.dataset.email = emp.email || '';
    const info = document.createElement('div');
    info.className = 'list-info';
    const name = document.createElement('strong');
    name.textContent = emp.nombre || 'Sin nombre';
    const meta = document.createElement('span');
    meta.className = 'plantilla-role';
    meta.textContent = emp.email || '';
    info.appendChild(name);
    info.appendChild(meta);
    li.appendChild(info);
    if (currentRole === 'admin') {
      const actions = document.createElement('div');
      actions.className = 'list-actions';
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'list-btn edit';
      editBtn.dataset.action = 'edit';
      editBtn.textContent = 'Editar';
      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'list-btn delete';
      deleteBtn.dataset.action = 'delete';
      deleteBtn.textContent = 'Eliminar';
      actions.appendChild(editBtn);
      actions.appendChild(deleteBtn);
      li.appendChild(actions);
    }
    listEl.prepend(li);
  }

  function enterEmployeeEditMode(employee, form, cancelBtn, submitBtn) {
    if (!form || !employee) return;
    form['employee-name'].value = employee.nombre || '';
    form['employee-email'].value = employee.email || '';
    editingEmployeeId = employee.id || null;
    toggleEmployeePasswordField(false);
    if (submitBtn) submitBtn.textContent = 'Guardar cambios';
    cancelBtn?.classList.remove('hidden');
    setEmployeeSuccess('Editando empleado. Guarda o cancela los cambios.', employeeError, employeeSuccess);
  }

  function resetEmployeeFormState(form, options = {}) {
    if (!form) return;
    const { preserveFeedback = false } = options;
    form.reset();
    editingEmployeeId = null;
    if (employeeSubmitBtn) employeeSubmitBtn.textContent = 'Registrar empleado';
    employeeCancelEditBtn?.classList.add('hidden');
    toggleEmployeePasswordField(true);
    if (!preserveFeedback) {
      clearEmployeeFeedback(employeeError, employeeSuccess);
    }
  }

  function toggleEmployeePasswordField(show) {
    if (!employeePasswordGroup || !employeePasswordInput) return;
    if (show) {
      employeePasswordGroup.classList.remove('hidden');
      employeePasswordInput.disabled = false;
      employeePasswordInput.required = true;
    } else {
      employeePasswordGroup.classList.add('hidden');
      employeePasswordInput.disabled = true;
      employeePasswordInput.required = false;
      employeePasswordInput.value = '';
    }
  }

  async function loadPlantilla(listEl) {
    if (!listEl) return;
    try {
      const q = query(collection(db, 'plantilla'), orderBy('createdAt', 'desc'));
      const snapshot = await getDocs(q);
      if (snapshot.empty) {
        listEl.innerHTML = '<li>Aún no hay integrantes registrados.</li>';
        return;
      }
      listEl.innerHTML = '';
      snapshot.forEach(docSnap => {
        const data = docSnap.data();
        const li = document.createElement('li');
        li.dataset.id = docSnap.id;
        li.dataset.nombre = data.nombre || '';
        li.dataset.posicion = data.posicion || '';
        li.dataset.numero = data.numero || '';
        li.dataset.notas = data.notas || '';

        const info = document.createElement('div');
        info.className = 'list-info';
        const title = document.createElement('strong');
        title.textContent = data.nombre || 'Sin nombre';
        const meta = document.createElement('div');
        meta.className = 'plantilla-meta';
        const posSpan = document.createElement('span');
        posSpan.textContent = data.posicion || 'Sin posición';
        meta.appendChild(posSpan);
        if (data.numero) {
          const numSpan = document.createElement('span');
          numSpan.textContent = `#${data.numero}`;
          meta.appendChild(numSpan);
        }
        if (data.notas) {
          const notes = document.createElement('span');
          notes.textContent = data.notas;
          meta.appendChild(notes);
        }
        info.appendChild(title);
        info.appendChild(meta);
        li.appendChild(info);

        if (['admin', 'empleado'].includes(currentRole)) {
          const actions = document.createElement('div');
          actions.className = 'list-actions';
          const editBtn = document.createElement('button');
          editBtn.type = 'button';
          editBtn.className = 'list-btn edit';
          editBtn.dataset.action = 'edit';
          editBtn.textContent = 'Editar';
          const deleteBtn = document.createElement('button');
          deleteBtn.type = 'button';
          deleteBtn.className = 'list-btn delete';
          deleteBtn.dataset.action = 'delete';
          deleteBtn.textContent = 'Eliminar';
          actions.appendChild(editBtn);
          actions.appendChild(deleteBtn);
          li.appendChild(actions);
        }
        listEl.appendChild(li);
      });
    } catch (error) {
      console.error('Error cargando plantilla', error);
      listEl.innerHTML = '<li>Error al cargar la plantilla.</li>';
    }
  }

  function enterEditMode(data, form, cancelBtn, successEl) {
    if (!form) return;
    form['player-name'].value = data.nombre || '';
    form['player-position'].value = data.posicion || '';
    form['player-number'].value = data.numero || '';
    form['player-notes'].value = data.notas || '';
    editingPlayerId = data.id;
    cancelBtn?.classList.remove('hidden');
    if (successEl) successEl.textContent = 'Editando integrante. Guarda o cancela los cambios.';
  }

  function resetPlantillaForm(form, cancelBtn, clearMessages, errorEl, successEl) {
    if (!form) return;
    form.reset();
    editingPlayerId = null;
    cancelBtn?.classList.add('hidden');
    if (clearMessages) {
      clearPlantillaFeedback(errorEl, successEl);
    }
  }

  function roleLabels() {
    return {
      admin: 'Administrador general',
      empleado: 'Empleado',
      revocado: 'Acceso revocado',
    };
  }

  function clearEmployeeFeedback(errorEl, successEl) {
    if (errorEl) errorEl.textContent = '';
    if (successEl) successEl.textContent = '';
  }

  function setEmployeeError(message, errorEl, successEl) {
    if (errorEl) errorEl.textContent = message;
    if (successEl) successEl.textContent = '';
  }

  function setEmployeeSuccess(message, errorEl, successEl) {
    if (successEl) successEl.textContent = message;
    if (errorEl) errorEl.textContent = '';
  }

  function clearPlantillaFeedback(errorEl, successEl) {
    if (errorEl) errorEl.textContent = '';
    if (successEl) successEl.textContent = '';
  }

  function setPlantillaError(message, errorEl, successEl) {
    if (errorEl) errorEl.textContent = message;
    if (successEl) successEl.textContent = '';
  }

  function setPlantillaSuccess(message, errorEl, successEl) {
    if (successEl) successEl.textContent = message;
    if (errorEl) errorEl.textContent = '';
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

async function persistRole(uid, account) {
  try {
    await setDoc(
      doc(getFirestore(), 'users', uid),
      {
        email: account.email,
        role: account.role,
        nombre: account.nombre || '',
        estado: account.estado || 'activo',
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

function storageAvailable() {
  if (typeof window === 'undefined' || !window.localStorage) return false;
  try {
    const testKey = '__dashboard_storage_test__';
    window.localStorage.setItem(testKey, testKey);
    window.localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}
