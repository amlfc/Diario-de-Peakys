
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
      const record = await db.settings.get('autoSyncHandle');
      if (record && record.handle) {
         this.fileHandle = record.handle;
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

      // Guardar el handle en DB para el futuro
      await db.settings.put({ key: 'autoSyncHandle', handle: this.fileHandle });

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
       await db.settings.delete('autoSyncHandle');
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
           priceFeedUrl: localStorage.getItem('PRICE_FEED_URL') || '',
           historicalPriceFeedUrl: localStorage.getItem('HISTORICAL_PRICE_FEED_URL') || ''
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
