
import React, { useEffect, useState } from 'react';
import { db } from '../db';
import { User, Portfolio } from '../types';
import { Icons } from './ui/Icons';
import { Card } from './ui/Card';
import { useLiveData } from '../hooks/useLiveData';

interface UserPortfolioMap {
    user: User;
    portfolios: Portfolio[];
}

const AdminView: React.FC = () => {
    const [data, setData] = useState<UserPortfolioMap[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    // Fetch all data live
    const users = useLiveData(() => db.users.toArray()) || [];
    const portfolios = useLiveData(() => db.portfolios.toArray()) || [];

    useEffect(() => {
        if (users.length > 0) {
            const mapped = users.map(u => {
                return {
                    user: u,
                    portfolios: portfolios.filter(p => p.owner_id === u.id)
                };
            });
            
            // Also find orphan portfolios (legacy data or created before auth)
            const orphanPortfolios = portfolios.filter(p => !p.owner_id);
            if (orphanPortfolios.length > 0) {
                mapped.push({
                    user: { id: -1, username: 'SIN ASIGNAR (Legacy)', role: 'user' },
                    portfolios: orphanPortfolios
                });
            }

            setData(mapped);
            setIsLoading(false);
        }
    }, [users, portfolios]);

    if (isLoading) return <div className="p-8 text-center text-slate-500">Cargando datos de administración...</div>;

    return (
        <div className="space-y-6 animate-fade-in">
            <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                    <Icons.Settings className="text-purple-500" /> Panel de Administración
                </h2>
            </div>

            <div className="grid grid-cols-1 gap-6">
                <Card title="Usuarios y Carteras Asignadas">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left">
                            <thead className="text-xs text-slate-400 uppercase bg-slate-900/50">
                                <tr>
                                    <th className="px-6 py-3">ID Usuario</th>
                                    <th className="px-6 py-3">Usuario</th>
                                    <th className="px-6 py-3">Rol</th>
                                    <th className="px-6 py-3">Carteras (Portfolios)</th>
                                    <th className="px-6 py-3 text-right">Total Carteras</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-700">
                                {data.map((row) => (
                                    <tr key={row.user.id} className="hover:bg-slate-700/30">
                                        <td className="px-6 py-4 text-slate-500 font-mono text-xs">#{row.user.id}</td>
                                        <td className="px-6 py-4 font-bold text-white">{row.user.username}</td>
                                        <td className="px-6 py-4">
                                            <span className={`px-2 py-1 rounded text-xs font-medium ${row.user.role === 'admin' ? 'bg-purple-900/30 text-purple-400 border border-purple-900/50' : 'bg-slate-700 text-slate-300'}`}>
                                                {row.user.role}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-slate-300">
                                            {row.portfolios.length > 0 ? (
                                                <div className="flex flex-wrap gap-1">
                                                    {row.portfolios.map(p => (
                                                        <span key={p.id} className="px-2 py-0.5 bg-blue-900/30 border border-blue-900/50 text-blue-300 rounded text-xs">
                                                            {p.name}
                                                        </span>
                                                    ))}
                                                </div>
                                            ) : (
                                                <span className="text-slate-600 italic">Sin carteras</span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 text-right font-mono text-slate-400">{row.portfolios.length}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </Card>
            </div>
        </div>
    );
};

export default AdminView;
