
import React, { useState } from 'react';
import { db } from '../db';
import { api } from '../services/apiService';
import { Icons } from './ui/Icons';
import { Card } from './ui/Card';
import { useLiveData } from '../hooks/useLiveData';

const AdminView: React.FC = () => {
    const users = useLiveData(() => db.users.toArray()) || [];
    const portfolios = useLiveData(async () => (await api.get('pky_portfolios')) || [], [updatingId]) || [];
    
    const [updatingId, setUpdatingId] = useState<number | null>(null);

    const normalizeId = (value: unknown): number | undefined => {
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        if (typeof value === 'string') {
            const parsed = Number(value);
            if (Number.isFinite(parsed)) return parsed;
        }
        return undefined;
    };

    const handleAssignPortfolio = async (portfolioId: number, newOwnerIdStr: string) => {
        if (!portfolioId) return;
        
        const newOwnerId = Number.parseInt(newOwnerIdStr, 10);
        const nextOwnerId = Number.isNaN(newOwnerId) || newOwnerId === -1 ? undefined : newOwnerId;

        setUpdatingId(portfolioId);
        try {
            await api.update('pky_portfolios', portfolioId, {
                owner_id: nextOwnerId,
                user_id: nextOwnerId
            });
            db.notify();
        } catch (error) {
            console.error("Error assigning portfolio", error);
            alert("Error al asignar cartera. Revisa la consola.");
        } finally {
            setUpdatingId(null);
        }
    };

    return (
        <div className="space-y-6 animate-fade-in">
            <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                    <Icons.Settings className="text-purple-500" /> Panel de Administración
                </h2>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* 1. LISTADO DE USUARIOS */}
                <Card title="Usuarios Registrados">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left">
                            <thead className="text-xs text-slate-400 uppercase bg-slate-900/50">
                                <tr>
                                    <th className="px-4 py-3">ID</th>
                                    <th className="px-4 py-3">Usuario</th>
                                    <th className="px-4 py-3">Rol</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-700">
                                {users.map(u => (
                                    <tr key={u.id} className="hover:bg-slate-700/30">
                                        <td className="px-4 py-3 text-slate-500 font-mono text-xs">#{u.id}</td>
                                        <td className="px-4 py-3 text-white font-bold">{u.username}</td>
                                        <td className="px-4 py-3">
                                            <span className={`px-2 py-1 rounded text-xs font-medium ${u.role === 'admin' ? 'bg-purple-900/30 text-purple-400' : 'bg-slate-700 text-slate-300'}`}>
                                                {u.role}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </Card>

                {/* 2. ASIGNACIÓN DE CARTERAS */}
                <Card title="Asignación de Carteras">
                    <p className="text-xs text-slate-400 mb-4">Selecciona qué usuario es el dueño de cada cartera.</p>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left">
                            <thead className="text-xs text-slate-400 uppercase bg-slate-900/50">
                                <tr>
                                    <th className="px-4 py-3">Cartera</th>
                                    <th className="px-4 py-3">Propietario Actual</th>
                                    <th className="px-4 py-3">Acción</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-700">
                                {portfolios.map(p => {
                                    const portfolioOwnerId = normalizeId((p as any).owner_id);
                                    const currentOwner = users.find(u => normalizeId(u.id) === portfolioOwnerId);
                                    return (
                                        <tr key={p.id} className="hover:bg-slate-700/30">
                                            <td className="px-4 py-3 text-white font-medium">{p.name}</td>
                                            <td className="px-4 py-3 text-slate-300">
                                                {currentOwner ? (
                                                    <span className="flex items-center gap-1">
                                                        <span className="w-2 h-2 rounded-full bg-emerald-500"></span> 
                                                        {currentOwner.username}
                                                    </span>
                                                ) : (
                                                    <span className="text-rose-400 text-xs italic">Sin Asignar</span>
                                                )}
                                            </td>
                                            <td className="px-4 py-3">
                                                <select 
                                                    className="bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs text-white outline-none focus:border-blue-500"
                                                    value={portfolioOwnerId ?? -1}
                                                    onChange={(e) => handleAssignPortfolio(p.id!, e.target.value)}
                                                    disabled={updatingId === p.id}
                                                >
                                                    <option value={-1}>-- Seleccionar --</option>
                                                    {users.map(u => (
                                                        <option key={u.id} value={u.id}>{u.username}</option>
                                                    ))}
                                                </select>
                                                {updatingId === p.id && <span className="ml-2 text-xs text-blue-400">...</span>}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </Card>
            </div>
        </div>
    );
};

export default AdminView;
