
import { db } from '../db';
import { User } from '../types';

class AuthService {
  
  async login(username: string, password: string): Promise<User | null> {
    // WARNING: This mimics server-side logic on the client because we cannot modify PHP.
    // In a real app, password checking MUST happen on the server.
    try {
        const users = await db.users.toArray();
        console.log(`[Auth] Checking login for ${username} among ${users.length} users.`);
        
        const user = users.find(u => u.username === username && u.password === password);
        
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
        // Ensure we have latest users
        const users = await db.users.toArray();
        
        if (users.some(u => u.username === username)) {
            return { success: false, message: 'El usuario ya existe' };
        }

        // First user is admin by default, others are users
        const role = users.length === 0 ? 'admin' : 'user';

        await db.users.add({
            username,
            password, // Storing raw/simple hash is insecure but required by constraints (no backend access)
            role
        });
        
        console.log(`[Auth] Registered user: ${username} as ${role}`);
        return { success: true };
    } catch (error: any) {
        console.error("[Auth] Registration Error:", error);
        return { success: false, message: 'Error de conexión con Base de Datos. Revisa la API.' };
    }
  }
}

export const authService = new AuthService();
