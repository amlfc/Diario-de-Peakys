
import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Icons } from './ui/Icons';
import { api } from '../services/apiService';

const LoginView: React.FC = () => {
  const { login, register } = useAuth();
  const [isRegistering, setIsRegistering] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [apiUrl, setApiUrl] = useState(localStorage.getItem('HOSTINGER_API_URL') || '');
  const [configMode, setConfigMode] = useState(!api.isConfigured());

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    if (!username || !password) {
        setError('Rellena todos los campos');
        setIsLoading(false);
        return;
    }

    try {
        if (isRegistering) {
            const res = await register(username, password);
            if (res.success) {
                alert('Cuenta creada con éxito. Ahora puedes iniciar sesión.');
                setIsRegistering(false);
            } else {
                setError(res.message || 'Error al registrar');
            }
        } else {
            const success = await login(username, password);
            if (!success) {
                if (api.hasError) {
                    setError('Error de conexión con la Base de Datos. Revisa que las tablas existan en Hostinger.');
                } else {
                    setError('Usuario o contraseña incorrectos.');
                }
            }
        }
    } catch (err) {
        setError('Error inesperado de red. Intenta de nuevo.');
    } finally {
        setIsLoading(false);
    }
  };

  const handleSaveConfig = () => {
      if (!apiUrl) return;
      localStorage.setItem('HOSTINGER_API_URL', apiUrl);
      window.location.reload();
  };

  if (configMode) {
      return (
        <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
            <div className="bg-slate-800 border border-slate-700 p-8 rounded-xl w-full max-w-md shadow-2xl">
                <h1 className="text-2xl font-bold text-white mb-4 flex items-center gap-2">
                    <Icons.Settings className="text-blue-500"/> Configuración Inicial
                </h1>
                <p className="text-slate-400 text-sm mb-6">
                    Antes de iniciar sesión, indica la URL de tu API (archivo PHP en Hostinger).
                </p>
                <div className="space-y-4">
                    <div>
                        <label className="block text-xs text-slate-500 mb-1 uppercase">URL de la API</label>
                        <input 
                            type="text" 
                            value={apiUrl}
                            onChange={e => setApiUrl(e.target.value)}
                            placeholder="https://tudominio.com/api-peakys/index.php"
                            className="w-full bg-slate-900 border border-slate-600 rounded p-3 text-white focus:border-blue-500 outline-none"
                        />
                    </div>
                    <button onClick={handleSaveConfig} className="w-full bg-blue-600 hover:bg-blue-500 text-white py-3 rounded-lg font-bold transition-colors">
                        Guardar y Continuar
                    </button>
                </div>
            </div>
        </div>
      );
  }

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute top-[-10%] left-[-10%] w-96 h-96 bg-blue-600/20 rounded-full blur-3xl pointer-events-none"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-96 h-96 bg-purple-600/20 rounded-full blur-3xl pointer-events-none"></div>

      <div className="bg-slate-800 border border-slate-700 p-8 rounded-xl w-full max-w-md shadow-2xl z-10 animate-fade-in">
        <div className="text-center mb-8">
            <div className="inline-flex p-3 bg-slate-900 rounded-full mb-4 border border-slate-700 shadow-inner">
                <Icons.Wallet size={32} className="text-blue-500" />
            </div>
            <h1 className="text-3xl font-bold text-white tracking-tight">Diario de <span className="text-blue-500">Peakys</span></h1>
            <p className="text-slate-400 mt-2 text-sm">Gestión profesional de inversiones</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
            <div>
                <label className="block text-xs text-slate-500 mb-1 uppercase font-semibold tracking-wider">Usuario</label>
                <div className="relative">
                    <Icons.Mobile className="absolute left-3 top-3 text-slate-500" size={18} />
                    <input 
                        type="text" 
                        value={username}
                        onChange={e => setUsername(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-600 rounded-lg p-2.5 pl-10 text-white focus:border-blue-500 outline-none transition-colors"
                        placeholder="Nombre de usuario"
                        disabled={isLoading}
                    />
                </div>
            </div>
            <div>
                <label className="block text-xs text-slate-500 mb-1 uppercase font-semibold tracking-wider">Contraseña</label>
                <div className="relative">
                    <Icons.Settings className="absolute left-3 top-3 text-slate-500" size={18} />
                    <input 
                        type="password" 
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-600 rounded-lg p-2.5 pl-10 text-white focus:border-blue-500 outline-none transition-colors"
                        placeholder="••••••••"
                        disabled={isLoading}
                    />
                </div>
            </div>

            {error && (
                <div className="p-3 bg-rose-900/30 border border-rose-900/50 rounded text-rose-400 text-sm">
                    <div className="flex items-center gap-2">
                        <Icons.Trash size={16} className="shrink-0" /> 
                        <span>{error}</span>
                    </div>
                    
                    {(error.includes('Bloqueo de Backend') || error.includes('missing table')) && (
                        <div className="mt-3 pt-3 border-t border-rose-900/50 text-left">
                            <p className="text-xs text-white font-bold mb-2">POSIBLES SOLUCIONES:</p>
                            
                            <div className="space-y-4">
                                <div>
                                    <p className="text-[10px] text-slate-300 mb-1">1. ¿Creaste la tabla en SQL?</p>
                                    <details className="group">
                                        <summary className="text-[10px] text-blue-400 cursor-pointer hover:underline">Ver código SQL</summary>
                                        <div className="bg-slate-950 p-2 rounded border border-slate-700 mt-1">
                                            <pre className="text-[10px] text-emerald-400 font-mono whitespace-pre-wrap overflow-x-auto">
{`CREATE TABLE IF NOT EXISTS pky_users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  role VARCHAR(20) DEFAULT 'user',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);`}
                                            </pre>
                                        </div>
                                    </details>
                                </div>

                                <div>
                                    <p className="text-[10px] text-slate-300 mb-1">2. ¿Actualizaste el index.php?</p>
                                    <p className="text-[10px] text-slate-400 mb-1">Si la tabla YA existe, el problema es que <b>index.php</b> no la permite. Añádela a la lista:</p>
                                    <details className="group" open>
                                        <summary className="text-[10px] text-blue-400 cursor-pointer hover:underline">Ver código PHP (Hostinger)</summary>
                                        <div className="bg-slate-950 p-2 rounded border border-slate-700 mt-1">
                                            <pre className="text-[10px] text-yellow-200 font-mono whitespace-pre-wrap overflow-x-auto">
{`// Busca esta línea en tu index.php:
$allowed_tables = [
  'pky_transactions', 
  'pky_liquidity', 
  'pky_portfolios', 
  'pky_asset_types', 
  'pky_allocation_targets',
  'pky_users',     // <--- AÑADE ESTA LÍNEA
  'pky_settings'   // <--- Y ESTA
];`}
                                            </pre>
                                        </div>
                                    </details>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            <button 
                type="submit" 
                disabled={isLoading}
                className={`w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white py-3 rounded-lg font-bold shadow-lg shadow-blue-900/20 transition-all transform hover:scale-[1.02] flex justify-center items-center gap-2 ${isLoading ? 'opacity-70 cursor-wait' : ''}`}
            >
                {isLoading && <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>}
                {isLoading ? 'Procesando...' : (isRegistering ? 'Crear Cuenta' : 'Iniciar Sesión')}
            </button>
        </form>

        <div className="mt-6 text-center pt-6 border-t border-slate-700">
            <p className="text-slate-400 text-sm">
                {isRegistering ? '¿Ya tienes cuenta?' : '¿No tienes cuenta?'}
                <button 
                    onClick={() => { setIsRegistering(!isRegistering); setError(''); }}
                    className="ml-2 text-blue-400 hover:text-blue-300 font-medium hover:underline"
                    disabled={isLoading}
                >
                    {isRegistering ? 'Inicia sesión' : 'Regístrate'}
                </button>
            </p>
        </div>
        
        <div className="mt-4 text-center">
            <button onClick={() => setConfigMode(true)} className="text-xs text-slate-600 hover:text-slate-400 flex items-center justify-center gap-1 w-full" disabled={isLoading}>
                <Icons.Settings size={12} /> Configurar conexión API
            </button>
        </div>
      </div>
    </div>
  );
};

export default LoginView;
