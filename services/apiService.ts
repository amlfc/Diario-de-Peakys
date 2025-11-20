
export class ApiService {
  
  isConfigured(): boolean {
    return !!localStorage.getItem('HOSTINGER_API_URL');
  }

  private getUrl() {
    const url = localStorage.getItem('HOSTINGER_API_URL');
    if (!url) return null;
    return url;
  }

  async get(table: string) {
    const url = this.getUrl();
    if (!url) {
        // Silent return to avoid UI crashes before config
        return []; 
    }
    try {
      const res = await fetch(`${url}?table=${table}`);
      if (!res.ok) throw new Error(`API Error: ${res.statusText}`);
      return await res.json();
    } catch (error) {
      console.error(`Error fetching ${table}:`, error);
      // Return empty on error to keep UI alive
      return [];
    }
  }

  async add(table: string, data: any) {
    const url = this.getUrl();
    if (!url) throw new Error("API URL no configurada. Ve a Configuración.");

    try {
      const res = await fetch(`${url}?table=${table}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) throw new Error(`API Error: ${res.statusText}`);
      return await res.json();
    } catch (error) {
      console.error(`Error adding to ${table}:`, error);
      throw error;
    }
  }

  async update(table: string, id: number, data: any) {
    const payload = { ...data, id };
    return this.add(table, payload);
  }

  async delete(table: string, id: number) {
    const url = this.getUrl();
    if (!url) throw new Error("API URL no configurada");

    try {
        const res = await fetch(`${url}?table=${table}&id=${id}`, {
            method: 'DELETE'
        });
        if (!res.ok) throw new Error(`API Error: ${res.statusText}`);
        return await res.json();
    } catch (error) {
        console.error(`Error deleting from ${table}:`, error);
        throw error;
    }
  }

  async clear(table: string) {
    const url = this.getUrl();
    if (!url) throw new Error("API URL no configurada");

    try {
        const res = await fetch(`${url}?table=${table}&confirm=all`, {
            method: 'DELETE'
        });
        if (!res.ok) throw new Error(`API Error: ${res.statusText}`);
        return await res.json();
    } catch (error) {
        console.error(`Error clearing ${table}:`, error);
        throw error;
    }
  }
}

export const api = new ApiService();
