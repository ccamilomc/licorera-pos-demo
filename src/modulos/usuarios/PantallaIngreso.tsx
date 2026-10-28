/**
 * Pantalla de ingreso.
 *
 * La primera vez que se abre el sistema no hay ninguna cuenta, asi que en
 * vez de pedir un usuario que no existe, pide crear el del dueño. Es el
 * unico momento en que se puede crear un administrador sin permiso.
 */

import { useState } from 'react';
import type { FormEvent } from 'react';
import { Eye, EyeOff, LogIn, ShieldCheck } from 'lucide-react';

import { mensajeDeError } from '@/nucleo/puente';
import { useSesion } from '@/nucleo/sesion';

function Campo({ etiqueta, ...props }: {
  readonly etiqueta: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] font-semibold text-tinta-2">{etiqueta}</span>
      <input
        {...props}
        className="rounded border border-linea-2 bg-panel px-3 py-2.5 text-[15px] text-tinta
                   outline-none placeholder:text-tinta-3 focus:border-acento"
      />
    </label>
  );
}

export function PantallaIngreso() {
  const { entrar, crearPrimerAdministrador, hayUsuarios, nombreNegocio } = useSesion();
  const primeraVez = !hayUsuarios;

  const [usuario, setUsuario] = useState('');
  const [nombre, setNombre] = useState('');
  /** Cómo se llama el local. Solo la primera vez. */
  const [negocio, setNegocio] = useState('');
  const [contrasena, setContrasena] = useState('');
  const [repetida, setRepetida] = useState('');
  const [verClave, setVerClave] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    setError(null);

    if (primeraVez && contrasena !== repetida) {
      setError('Las dos contraseñas no coinciden.');
      return;
    }

    setEnviando(true);
    try {
      if (primeraVez) {
        await crearPrimerAdministrador(usuario, nombre, contrasena, negocio);
      } else {
        await entrar(usuario, contrasena);
      }
    } catch (causa) {
      setError(mensajeDeError(causa));
      setContrasena('');
      setRepetida('');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <main className="flex min-h-full items-center justify-center bg-fondo p-6">
      <div className="w-full max-w-sm">
        <div className="mb-7 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center
                          rounded-xl bg-acento-suave">
            <ShieldCheck size={26} className="text-acento" aria-hidden />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">
            {/* El nombre del local si ya lo pusieron; si no, el del
                programa. Poner aquí el del programa cuando el local sí
                tiene nombre sería saludar con el nombre equivocado. */}
            {nombreNegocio.trim() !== '' ? nombreNegocio : 'Punto de Venta'}
          </h1>
          <p className="mt-1.5 text-sm text-tinta-2">
            {primeraVez
              ? 'Es la primera vez que abres el sistema. Crea tu cuenta de administrador.'
              : 'Ingresa para comenzar tu turno.'}
          </p>
        </div>

        <form onSubmit={enviar} className="flex flex-col gap-3.5 rounded-lg border
                                           border-linea bg-panel p-6">
          <Campo
            etiqueta="Usuario"
            value={usuario}
            onChange={(e) => setUsuario(e.target.value)}
            autoComplete="username"
            autoFocus
            required
            placeholder="camilo"
          />

          {primeraVez && (
            <Campo
              etiqueta="Tu nombre"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              required
              placeholder="Camilo"
            />
          )}

          {primeraVez && (
            <Campo
              etiqueta="Cómo se llama el negocio"
              value={negocio}
              onChange={(e) => setNegocio(e.target.value)}
              required
              placeholder="Licorera Demo"
            />
          )}

          <div className="relative">
            <Campo
              etiqueta="Contraseña"
              type={verClave ? 'text' : 'password'}
              value={contrasena}
              onChange={(e) => setContrasena(e.target.value)}
              autoComplete={primeraVez ? 'new-password' : 'current-password'}
              required
              minLength={6}
            />
            <button
              type="button"
              onClick={() => setVerClave((v) => !v)}
              aria-label={verClave ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              className="absolute right-2.5 top-[30px] rounded p-1 text-tinta-3 hover:text-tinta"
            >
              {verClave ? <EyeOff size={17} aria-hidden /> : <Eye size={17} aria-hidden />}
            </button>
          </div>

          {primeraVez && (
            <Campo
              etiqueta="Repite la contraseña"
              type={verClave ? 'text' : 'password'}
              value={repetida}
              onChange={(e) => setRepetida(e.target.value)}
              autoComplete="new-password"
              required
              minLength={6}
            />
          )}

          {error !== null && (
            <p role="alert" className="rounded border border-grave/30 bg-grave-suave
                                       px-3 py-2 text-sm text-grave">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={enviando}
            className="mt-1 inline-flex items-center justify-center gap-2 rounded bg-acento
                       px-4 py-2.5 text-sm font-semibold text-sobre-acento hover:bg-acento-fuerte
                       disabled:cursor-not-allowed disabled:opacity-60"
          >
            <LogIn size={16} aria-hidden />
            {enviando
              ? 'Un momento…'
              : primeraVez ? 'Crear mi cuenta y entrar' : 'Entrar'}
          </button>

          {primeraVez && (
            <p className="text-xs leading-relaxed text-tinta-3">
              Esta cuenta podra administrar todo el sistema. La contraseña se guarda
              cifrada: si la olvidas se restablece, no se recupera.
            </p>
          )}
        </form>
      </div>
    </main>
  );
}
