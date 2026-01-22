import React, { useEffect, useState } from 'react';
import { Icons } from './ui/Icons';

interface PositionNotesModalProps {
  isOpen: boolean;
  title: string;
  initialNote: string;
  onClose: () => void;
  onSave: (note: string) => Promise<void> | void;
}

const PositionNotesModal: React.FC<PositionNotesModalProps> = ({
  isOpen,
  title,
  initialNote,
  onClose,
  onSave,
}) => {
  const [note, setNote] = useState(initialNote || '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) setNote(initialNote || '');
  }, [isOpen, initialNote]);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSave = async () => {
    try {
      setSaving(true);
      await onSave(note);
      onClose();
    } catch (e) {
      console.error('Error saving position note', e);
      alert('Error al guardar la nota');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      <div className="relative w-[92vw] max-w-2xl bg-slate-800 border border-slate-700 rounded-xl shadow-xl">
        <div className="px-5 py-4 border-b border-slate-700 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icons.PDF size={18} />
            <h3 className="text-slate-100 font-medium">{title}</h3>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 transition-colors"
            title="Cerrar"
          >
            ✕
          </button>
        </div>

        <div className="p-5">
          <label className="block text-xs text-slate-400 mb-2">Notas (diario)</label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={10}
            placeholder="Escribe aquí tus notas..."
            className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-slate-100 focus:border-blue-500 outline-none resize-y"
          />
          <div className="mt-4 flex justify-end gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-slate-300 hover:bg-slate-700 transition-colors"
              disabled={saving}
            >
              Cancelar
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition-colors font-medium flex items-center gap-2"
              disabled={saving}
              title="Guardar"
            >
              <Icons.Save size={16} />
              {saving ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PositionNotesModal;
