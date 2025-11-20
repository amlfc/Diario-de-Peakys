
import { db } from '../db';

// Definiciones de tipos para la API de File System Access (aún experimental en TS)
interface FileSystemHandle {
  kind: 'file' | 'directory';
  name: string;
  isSameEntry: (other: FileSystemHandle) => Promise<boolean>;
}

interface FileSystemFileHandle extends FileSystemHandle {
  getFile: () => Promise<File>;
  createWritable: () => Promise<FileSystemWritableFileStream>;
  queryPermission: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<'granted' | 'denied' | 'prompt'>;
  requestPermission: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<'granted' | 'denied' | 'prompt'>;
}

interface FileSystemWritableFileStream extends WritableStream {
  write: (data: any) => Promise<void>;
  seek: (position: number) => Promise<void>;
  truncate: (size: number) => Promise<void>;
  close: () => Promise<void>;
}

declare global {
  interface Window {
    showSaveFilePicker: (options?: any) => Promise<FileSystemFileHandle>;
  }
}

// --- LOCAL INDEXEDDB HELPERS FOR FILE HANDLES ---
// Necesitamos IndexedDB local porque los FileSystemHandles no se pueden enviar al servidor (MySQL)
// Solo viven en el contexto del navegador local.
const IDB_NAME = 'PeakysLocalDB';
const IDB_STORE = 'handles';

const openIDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, 1);
    request.onupgradeneeded = (event: any) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    request.onsuccess = (event: any) => resolve(event.target.result);
    request.onerror = (event: any) => reject(event.target.error);
  });
};

const getHandle = async (key: string): Promise<FileSystemFileHandle | undefined> => {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const store = tx.objectStore(IDB_STORE);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
};

const saveHandle = async (key: string, handle: FileSystemFileHandle): Promise<void> => {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    const store = tx.objectStore(IDB_STORE);
    const req = store.put(handle, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
};

const deleteHandle = async (key: string): Promise<void> => {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    const store = tx.objectStore(IDB_STORE);
    const req = store.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
};
// ------------------------------------------------

class AutoSyncService {
  private fileHandle: FileSystemFileHandle | null = null;
  private isSyncing: boolean = false;
  private saveTimeout: any = null;
  private lastSaved: Date | null = null;
  
  // Callbacks para actualizar UI
  public onStatusChange: ((linked: boolean, lastSaved: Date | null, canRestore: boolean) => void) | null = null;

  constructor() {
    // Constructor vacío para evitar problemas de dependencia circular con db.ts.
    // La inicialización se realiza explícitamente a través del método init().
  }

  public async init() {
    await this.restoreHandleFromDB();
  }

  // 0. Intentar recuperar el handle guardado en la sesión anterior
  private async restoreHandleFromDB() {
    try {
      const handle = await getHandle('autoSyncHandle');
      if (handle) {
         this.fileHandle = handle;
         // Notificamos que "Podemos Restaurar" (aunque aún no tenemos permiso activo)
         this.updateStatus(false, true);
      }
    } catch (e) {
      console.error("No se pudo restaurar el handle de sincronización", e);
    }
  }

  // 1. Vincular un archivo local (Primera vez)
  async linkFile() {
    if (!window.showSaveFilePicker) {
      alert("Tu navegador no soporta el acceso a archivos locales (usa Chrome, Edge u Opera).");
      return;
    }

    try {
      // Pedir al usuario donde crear o elegir el archivo
      this.fileHandle = await window.showSaveFilePicker({
        suggestedName: 'Peakys_Database_Auto.json',
        types: [{
          description: 'JSON Database',
          accept: { 'application/json': ['.json'] },
        }],
      });

      // Guardar el handle en DB Local para el futuro
      if (this.fileHandle) {
         await saveHandle('autoSyncHandle', this.fileHandle);
      }

      // Guardar inmediatamente para confirmar permisos y estado inicial
      await this.triggerSave();
      this.updateStatus();
      
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error("Error vinculando archivo:", error);
        alert("No se pudo vincular el archivo: " + error.message);
      }
    }
  }

  // 1.5 Reactivar Permisos (Cuando recargas la página)
  async restorePermission() {
    if (!this.fileHandle) return;
    
    try {
       // Verificar estado actual
       const options = { mode: 'readwrite' as const };
       if ((await this.fileHandle.queryPermission(options)) === 'granted') {
           this.updateStatus();
           return;
       }
       
       // Pedir permiso (El navegador mostrará un popup pequeño)
       if ((await this.fileHandle.requestPermission(options)) === 'granted') {
           this.updateStatus();
           // Forzamos un guardado para asegurar que todo funciona
           this.notifyChange();
       } else {
           alert("Permiso denegado. Debes dar permiso para usar la sincronización.");
       }
    } catch (e) {
       console.error("Error restaurando permiso", e);
       alert("El archivo vinculado ya no es válido. Por favor, vincúlalo de nuevo.");
       this.fileHandle = null;
       await deleteHandle('autoSyncHandle');
       this.updateStatus();
    }
  }

  // 2. Trigger que se llama desde db.ts cuando hay cambios
  public notifyChange() {
    if (!this.fileHandle) return; 

    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    
    this.saveTimeout = setTimeout(() => {
      this.triggerSave();
    }, 2000);
  }

  private async triggerSave() {
    if (!this.fileHandle || this.isSyncing) return;

    // Verificación rápida de permisos antes de intentar escribir
    try {
       if ((await this.fileHandle.queryPermission({ mode: 'readwrite' })) !== 'granted') {
           console.warn("Permiso de escritura perdido. Esperando reactivación manual.");
           this.updateStatus(false, true); // Mostrar botón de reactivar
           return;
       }
    } catch(e) { return; }

    try {
      this.isSyncing = true;
      
      const data = {
        transactions: await db.transactions.toArray(),
        liquidity: await db.liquidity.toArray(),
        portfolios: await db.portfolios.toArray(),
        assetTypes: await db.assetTypes.toArray(),
        allocationTargets: await db.allocationTargets.toArray(),
        metadata: {
           version: 4,
           savedAt: new Date().toISOString(),
           priceFeedUrl: localStorage.getItem('PRICE_FEED_URL') || ''
        }
      };

      const jsonString = JSON.stringify(data, null, 2);

      const writable = await this.fileHandle.createWritable();
      await writable.write(jsonString);
      await writable.close();

      this.lastSaved = new Date();
      console.log("Auto-saved to disk at", this.lastSaved);
      this.updateStatus();

    } catch (error) {
      console.error("Auto-save failed:", error);
    } finally {
      this.isSyncing = false;
    }
  }

  private updateStatus(forceLinkedState?: boolean, forceCanRestore?: boolean) {
    if (this.onStatusChange) {
      // Está vinculado si tenemos handle Y tenemos permiso (lo comprobamos indirectamente con forceLinkedState o success previo)
      // Simplificación: Si tenemos lastSaved reciente, asumimos vinculado.
      // Si forceCanRestore es true, es que tenemos handle pero falta permiso.
      
      const hasHandle = !!this.fileHandle;
      this.onStatusChange(hasHandle && !forceCanRestore, this.lastSaved, !!forceCanRestore);
    }
  }

  public isLinked() {
    return !!this.fileHandle;
  }
}

export const autoSyncService = new AutoSyncService();
