
import { db } from '../db';
import { User } from '../types';

class AuthService {
  
  async login(username: string, password: string): Promise<User | null> {
    // WARNING: This mimics server-side logic on the client because we cannot modify PHP.
    // In a real app, password checking MUST happen on the server.
    const users = await db.users.toArray();
    const user = users.find(u => u.username === username && u.password === password);
    
    if (user) {
        // Return user without password
        const { password, ...safeUser } = user;
        return safeUser as User;
    }
    return null;
  }

  async register(username: string, password: string): Promise<{success: boolean, message?: string}> {
    const users = await db.users.toArray();
    
    if (users.some(u => u.username === username)) {
        return { success: false, message: 'El usuario ya existe' };
    }

    // First user is admin by default, others are users
    const role = users.length === 0 ? 'admin' : 'user';

    try {
        await db.users.add({
            username,
            password, // Storing raw/simple hash is insecure but required by constraints (no backend access)
            role
        });
        return { success: true };
    } catch (error) {
        return { success: false, message: 'Error al crear usuario en base de datos' };
    }
  }
}

export const authService = new AuthService();
