
export class ApiService {
  public hasError = false;

  private sanitizeUrl(value: string | null): string | null {
    if (!value) return null;
    const trimmed = value.trim();
    if (!trimmed) return null;

    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
      return trimmed;
    } catch {
      return null;
    }
  }
  
  isConfigured(): boolean {
    return !!this.sanitizeUrl(localStorage.getItem('HOSTINGER_API_URL'));
  }

  private getUrl() {
    return this.sanitizeUrl(localStorage.getItem('HOSTINGER_API_URL'));
  }

  async get(table: string) {
    const url = this.getUrl();
    if (!url) return [];

    try {
      const res = await fetch(`${url}?table=${table}`, {
        headers: { 'Accept': 'application/json' }
      });

      if (!res.ok) {
        // Only mark as error for critical tables, ignore optional tables
        const optional = table === 'pky_settings' || table === 'pky_position_notes';
        if (!optional) {
            this.hasError = true;
            console.warn(`[API] Fetch failed for ${table}: ${res.status} ${res.statusText}`);
        }
        return [];
      }
      
      const text = await res.text();
      let json: any;

      try {
        json = JSON.parse(text);
      } catch (e) {
        this.hasError = true;
        console.warn(`[API] Invalid JSON response for ${table}:`, text.substring(0, 50));
        return [];
      }

      if (json && json.success === false) {
          // If table is missing (common for optional tables), just return empty without setting global error
          const isMissingTable = (json.error || '').includes('exist');
          if ((table === 'pky_settings' || table === 'pky_position_notes') && isMissingTable) {
             return [];
          }
          
          // For other tables, it's a logic error
          console.warn(`[API] Backend Error (${table}): ${json.error}`);
          return [];
      }

      // CRITICAL FIX: Ensure we always return an array
      return Array.isArray(json.data) ? json.data : [];

    } catch (error) {
      this.hasError = true;
      console.warn(`[API] Connection Error fetching ${table}`, error);
      return [];
    }
  }

  async add(table: string, data: any) {
    // REMOVED: Safety Valve used to block writes if reads failed. 
    // We removed it so Registration (POST pky_users) works even if GET failed initially.
    
    const url = this.getUrl();
    if (!url) throw new Error("API URL no configurada. Ve a Configuración.");

    try {
      const res = await fetch(`${url}?table=${table}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(data)
      });
      
      if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
      
      const text = await res.text();
      const json = JSON.parse(text);

      if (json && json.success === false) {
        throw new Error(json.error || 'Error saving data');
      }

      return json.data;
    } catch (error) {
      console.error(`Error adding to ${table}:`, error);
      throw error;
    }
  }

  async update(table: string, id: number, data: any) {
    // Allow updates even if read had hiccups
    const payload = { ...data, id };
    return this.add(table, payload);
  }

  async delete(table: string, id: number) {
    const url = this.getUrl();
    if (!url) throw new Error("API URL no configurada");

    try {
        const res = await fetch(`${url}?table=${table}&id=${id}`, {
            method: 'DELETE',
            headers: { 'Accept': 'application/json' }
        });
        
        if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
        
        const json = await res.json();

        if (json && json.success === false) {
            throw new Error(json.error || 'Error deleting data');
        }

        return json.data;
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
            method: 'DELETE',
            headers: { 'Accept': 'application/json' }
        });
        
        if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
        
        const json = await res.json();

        if (json && json.success === false) {
            throw new Error(json.error || 'Error clearing table');
        }

        return json.data;
    } catch (error) {
        console.error(`Error clearing ${table}:`, error);
        throw error;
    }
  }
}

export const api = new ApiService();
