
import { db } from '../db';
import { User } from '../types';

class AuthService {
  private normalizeUsername(username: string): string {
    return username.trim().toLowerCase();
  }

  private normalizePassword(password: string): string {
    return password.trim();
  }
  
  async login(username: string, password: string): Promise<User | null> {
    // WARNING: This mimics server-side logic on the client because we cannot modify PHP.
    // In a real app, password checking MUST happen on the server.
    try {
        const users = await db.users.toArray();
        const normalizedUsername = this.normalizeUsername(username);
        const normalizedPassword = this.normalizePassword(password);
        console.log(`[Auth] Checking login for ${normalizedUsername} among ${users.length} users.`);
        
        const user = users.find(u => {
            const storedUsername = this.normalizeUsername(u.username);
            const storedPassword = this.normalizePassword(u.password || '');
            return storedUsername === normalizedUsername && storedPassword === normalizedPassword;
        });
        
        if (user) {
            // Return user without password
            const { password, ...safeUser } = user;
            return safeUser as User;
        }
        return null;
    } catch (e) {
        console.error("[Auth] Login failed due to DB error", e);
        return null;
    }
  }

  async register(username: string, password: string): Promise<{success: boolean, message?: string}> {
    try {
        const normalizedUsername = this.normalizeUsername(username);
        const normalizedPassword = this.normalizePassword(password);

        if (!normalizedUsername || !normalizedPassword) {
            return { success: false, message: 'Usuario y contraseña son obligatorios.' };
        }

        // Ensure we have latest users
        const users = await db.users.toArray();
        
        if (users.some(u => this.normalizeUsername(u.username) === normalizedUsername)) {
            return { success: false, message: 'El usuario ya existe' };
        }

        // First user is admin by default, others are users
        const role = users.length === 0 ? 'admin' : 'user';

        await db.users.add({
            username: normalizedUsername,
            password: normalizedPassword, // Storing raw/simple hash is insecure but required by constraints (no backend access)
            role
        });

        // Verificación para evitar falsos positivos cuando el backend no persiste el registro.
        const usersAfterInsert = await db.users.toArray();
        const persistedUser = usersAfterInsert.find(u => this.normalizeUsername(u.username) === normalizedUsername);
        if (!persistedUser) {
            return {
              success: false,
              message: 'La cuenta no se guardó en la base de datos. Revisa la URL/API de Hostinger y permisos de la tabla pky_users.'
            };
        }
        
        console.log(`[Auth] Registered user: ${normalizedUsername} as ${role}`);
        return { success: true };
    } catch (error: any) {
        console.error("[Auth] Registration Error:", error);
        
        const msg = error.message || error.toString();
        if (msg.includes('Invalid or missing table') || msg.includes('pky_users')) {
             return { 
               success: false, 
               message: 'Bloqueo de Backend: La tabla "pky_users" no existe o no está permitida en index.php.' 
             };
        }

        return { success: false, message: 'Error de conexión: ' + msg };
    }
  }
}

export const authService = new AuthService();
